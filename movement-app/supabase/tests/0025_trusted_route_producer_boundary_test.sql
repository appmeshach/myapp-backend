BEGIN;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;

CREATE TEMP TABLE route_producer_test_results(
  check_number integer GENERATED ALWAYS AS IDENTITY,
  test_name text NOT NULL UNIQUE,
  passed boolean NOT NULL
) ON COMMIT DROP;

CREATE FUNCTION pg_temp.route_check(p_name text,p_passed boolean)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $helper$
BEGIN
  INSERT INTO pg_temp.route_producer_test_results(test_name,passed)
  VALUES(p_name,coalesce(p_passed,false));
END;
$helper$;

CREATE FUNCTION pg_temp.route_as(p_role text,p_sql text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $helper$
DECLARE previous_role text:=current_setting('role'); rows_json jsonb; result_json jsonb;
BEGIN
  IF p_role NOT IN ('authenticated','anon','service_role') THEN RAISE EXCEPTION 'Unsupported test role'; END IF;
  PERFORM set_config('role',p_role,true);
  BEGIN
    EXECUTE 'SELECT coalesce(jsonb_agg(to_jsonb(q)),''[]''::jsonb) FROM ('||p_sql||') q' INTO rows_json;
    result_json:=jsonb_build_object('ok',true,'rows',rows_json);
  EXCEPTION WHEN OTHERS THEN
    result_json:=jsonb_build_object('ok',false,'sqlstate',SQLSTATE,'message',SQLERRM);
  END;
  PERFORM set_config('role',previous_role,true);
  RETURN result_json;
END;
$helper$;

DO $route_test$
DECLARE
  member_id uuid:=gen_random_uuid();
  intent_id uuid:=gen_random_uuid();
  intent_key uuid:=gen_random_uuid();
  origin_id uuid:=gen_random_uuid();
  destination_id uuid:=gen_random_uuid();
  base_time timestamptz:=transaction_timestamp();
  dep_expiry timestamptz:=transaction_timestamp()+interval '2 hours';
  generated_time timestamptz:=transaction_timestamp();
  shape1 jsonb:='{"type":"LineString","coordinates":[[3.489,6.434],[3.421,6.455],[3.389,6.469]]}'::jsonb;
  shape2 jsonb:='{"type":"LineString","coordinates":[[3.489,6.434],[3.445,6.448],[3.389,6.469]]}'::jsonb;
  bad_shape jsonb:='{"type":"Point","coordinates":[3.489,6.434]}'::jsonb;
  r jsonb; first_id uuid; second_id uuid; count_before bigint;
  shape_case record; shape_rejected boolean;
BEGIN
  INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  VALUES(member_id,'authenticated','authenticated',member_id::text||'@test-0025.invalid',base_time,
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,base_time,base_time);

  INSERT INTO private.movement_location_references(
    id,owner_member_id,declared_label,source_kind,resolution_status,latitude,longitude,
    provider_namespace,provider_place_reference,resolution_version,created_at,resolved_at,expires_at
  ) VALUES
    (origin_id,member_id,'Test origin 0025','provider_resolved','resolved',6.434,3.489,
     'test-location','origin-0025','resolver-v1',base_time,base_time,dep_expiry),
    (destination_id,member_id,'Test destination 0025','provider_resolved','resolved',6.469,3.389,
     'test-location','destination-0025','resolver-v1',base_time,base_time,dep_expiry);

  INSERT INTO private.offering_movement_intents(
    id,offering_member_id,intent_key,version,earliest_departure_at,latest_departure_at,
    created_at,expires_at,status
  ) VALUES(
    intent_id,member_id,intent_key,1,statement_timestamp()+interval '1 hour',
    statement_timestamp()+interval '90 minutes',base_time,dep_expiry,'current');

  INSERT INTO private.offering_movement_intent_locations(intent_id,role,location_reference_id)
  VALUES(intent_id,'origin',origin_id),(intent_id,'destination',destination_id);

  SET CONSTRAINTS private.offering_intent_complete,private.offering_intent_locations_complete IMMEDIATE;
  SET CONSTRAINTS private.offering_intent_complete,private.offering_intent_locations_complete DEFERRED;

  PERFORM pg_temp.route_check('01 writer execute is service-only',
    has_function_privilege('service_role','public.record_offering_route_evidence_for_server(uuid,text,text,text,text,jsonb,bigint,bigint,timestamptz,timestamptz)','EXECUTE')
    AND NOT has_function_privilege('authenticated','public.record_offering_route_evidence_for_server(uuid,text,text,text,text,jsonb,bigint,bigint,timestamptz,timestamptz)','EXECUTE')
    AND NOT has_function_privilege('anon','public.record_offering_route_evidence_for_server(uuid,text,text,text,text,jsonb,bigint,bigint,timestamptz,timestamptz)','EXECUTE'));

  PERFORM pg_temp.route_check('02 service role still lacks direct mutation',
    NOT has_table_privilege('service_role','private.offering_route_evidence','INSERT')
    AND NOT has_table_privilege('service_role','private.offering_route_evidence','UPDATE')
    AND NOT has_table_privilege('service_role','private.offering_route_evidence','DELETE')
    AND has_table_privilege('service_role','private.offering_route_evidence','SELECT'));

  r:=pg_temp.route_as('authenticated',format(
    $sql$SELECT * FROM public.record_offering_route_evidence_for_server(%L::uuid,'test-router','directions','v1','route-a',%L::jsonb,12000,1500,%L::timestamptz,%L::timestamptz)$sql$,
    intent_id,shape1::text,generated_time,dep_expiry+interval '1 hour'));
  PERFORM pg_temp.route_check('03 authenticated cannot execute',r->>'ok'='false' AND r->>'sqlstate'='42501');

  r:=pg_temp.route_as('service_role',format(
    $sql$SELECT * FROM public.record_offering_route_evidence_for_server(%L::uuid,'test-router','directions','v1','route-a',%L::jsonb,12000,1500,%L::timestamptz,%L::timestamptz)$sql$,
    intent_id,shape1::text,generated_time,dep_expiry+interval '1 hour'));
  first_id:=(r#>>'{rows,0,route_evidence_id}')::uuid;
  PERFORM pg_temp.route_check('04 first evidence recorded',r->>'ok'='true' AND first_id IS NOT NULL AND r#>>'{rows,0,route_evidence_version}'='1');

  PERFORM pg_temp.route_check('05 database derives trusted bindings',
    EXISTS(SELECT 1 FROM private.offering_route_evidence e WHERE e.id=first_id
      AND e.offering_member_id=member_id AND e.origin_location_reference_id=origin_id
      AND e.destination_location_reference_id=destination_id
      AND e.evidence_schema_version='offering_route_evidence_v1'
      AND e.route_shape_format='geojson_linestring_v1'));

  PERFORM pg_temp.route_check('06 expiry bounded by dependencies',
    EXISTS(SELECT 1 FROM private.offering_route_evidence e WHERE e.id=first_id AND e.expires_at=dep_expiry));

  r:=pg_temp.route_as('service_role',format(
    $sql$SELECT * FROM public.record_offering_route_evidence_for_server(%L::uuid,'test-router','directions','v1','route-a',%L::jsonb,12000,1500,%L::timestamptz,%L::timestamptz)$sql$,
    intent_id,shape1::text,generated_time,dep_expiry+interval '1 hour'));
  PERFORM pg_temp.route_check('07 exact retry is idempotent',
    r->>'ok'='true' AND (r#>>'{rows,0,route_evidence_id}')::uuid=first_id
    AND (SELECT count(*) FROM private.offering_route_evidence WHERE offering_movement_intent_id=intent_id)=1);

  count_before:=(SELECT count(*) FROM private.offering_route_evidence WHERE offering_movement_intent_id=intent_id);
  r:=pg_temp.route_as('service_role',format(
    $sql$SELECT * FROM public.record_offering_route_evidence_for_server(%L::uuid,'test-router','directions','v1','route-a',%L::jsonb,12001,1500,%L::timestamptz,%L::timestamptz)$sql$,
    intent_id,shape1::text,generated_time,dep_expiry+interval '1 hour'));
  PERFORM pg_temp.route_check('08 provider replay mismatch rejected',
    r->>'ok'='false' AND r->>'sqlstate'='23514'
    AND (SELECT count(*) FROM private.offering_route_evidence WHERE offering_movement_intent_id=intent_id)=count_before
    AND EXISTS(SELECT 1 FROM private.offering_route_evidence WHERE id=first_id AND status='current'));

  r:=pg_temp.route_as('service_role',format(
    $sql$SELECT * FROM public.record_offering_route_evidence_for_server(%L::uuid,'test-router','directions','v1','route-b',%L::jsonb,12100,1490,%L::timestamptz,%L::timestamptz)$sql$,
    intent_id,shape2::text,generated_time,dep_expiry+interval '1 hour'));
  second_id:=(r#>>'{rows,0,route_evidence_id}')::uuid;
  PERFORM pg_temp.route_check('09 regeneration versions and supersedes',
    r->>'ok'='true' AND second_id IS NOT NULL AND r#>>'{rows,0,route_evidence_version}'='2'
    AND EXISTS(SELECT 1 FROM private.offering_route_evidence WHERE id=first_id AND status='superseded')
    AND EXISTS(SELECT 1 FROM private.offering_route_evidence WHERE id=second_id AND status='current'));

  PERFORM pg_temp.route_check('10 exactly one current evidence',
    (SELECT count(*) FROM private.offering_route_evidence WHERE offering_movement_intent_id=intent_id AND status='current')=1);

  count_before:=(SELECT count(*) FROM private.offering_route_evidence WHERE offering_movement_intent_id=intent_id);
  r:=pg_temp.route_as('service_role',format(
    $sql$SELECT * FROM public.record_offering_route_evidence_for_server(%L::uuid,'test-router','directions','v1','route-bad',%L::jsonb,100,60,%L::timestamptz,%L::timestamptz)$sql$,
    intent_id,bad_shape::text,generated_time,dep_expiry));
  PERFORM pg_temp.route_check('11 invalid shape rejected before supersede',
    r->>'ok'='false' AND r->>'sqlstate'='23514'
    AND (SELECT count(*) FROM private.offering_route_evidence WHERE offering_movement_intent_id=intent_id)=count_before
    AND EXISTS(SELECT 1 FROM private.offering_route_evidence WHERE id=second_id AND status='current'));

  r:=pg_temp.route_as('service_role',format(
    $sql$SELECT * FROM public.record_offering_route_evidence_for_server(%L::uuid,'test-router','directions','v1','route-stale',%L::jsonb,100,60,%L::timestamptz,%L::timestamptz)$sql$,
    intent_id,shape1::text,base_time-interval '1 second',dep_expiry));
  PERFORM pg_temp.route_check('12 stale generation time rejected',r->>'ok'='false' AND r->>'sqlstate'='23514');

  r:=pg_temp.route_as('service_role',format(
    $sql$SELECT * FROM public.record_offering_route_evidence_for_server(%L::uuid,'test-router','directions','v1','route-missing',%L::jsonb,100,60,%L::timestamptz,NULL)$sql$,
    gen_random_uuid(),shape1::text,generated_time));
  PERFORM pg_temp.route_check('13 unknown intent rejected',r->>'ok'='false' AND r->>'message'='Offering movement intent not found');

  r:=pg_temp.route_as('service_role',format(
    $sql$SELECT * FROM public.record_offering_route_evidence_for_server(%L::uuid,'test-router','directions','v1','route-a',%L::jsonb,12000,1500,%L::timestamptz,%L::timestamptz)$sql$,
    intent_id,shape1::text,generated_time,dep_expiry+interval '1 hour'));
  PERFORM pg_temp.route_check('15 superseded reference replay rejected',
    r->>'ok'='false' AND r->>'sqlstate'='23514');

  -- Direct validator tests include SQL NULL, JSON null and every structural guard.
  FOR shape_case IN SELECT * FROM (VALUES
    ('SQL null',NULL::jsonb),
    ('JSON null','null'::jsonb),
    ('non-object','[]'::jsonb),
    ('empty object','{}'::jsonb),
    ('missing type','{"coordinates":[[3,6],[4,7]]}'::jsonb),
    ('missing coordinates','{"type":"LineString"}'::jsonb),
    ('wrong type','{"type":"Point","coordinates":[[3,6],[4,7]]}'::jsonb),
    ('null type','{"type":null,"coordinates":[[3,6],[4,7]]}'::jsonb),
    ('non-array coordinates','{"type":"LineString","coordinates":{}}'::jsonb),
    ('null coordinates','{"type":"LineString","coordinates":null}'::jsonb),
    ('empty coordinates','{"type":"LineString","coordinates":[]}'::jsonb),
    ('one point','{"type":"LineString","coordinates":[[3,6]]}'::jsonb),
    ('extra key','{"type":"LineString","coordinates":[[3,6],[4,7]],"extra":1}'::jsonb),
    ('non-array point','{"type":"LineString","coordinates":[{},[4,7]]}'::jsonb),
    ('short point','{"type":"LineString","coordinates":[[3],[4,7]]}'::jsonb),
    ('long point','{"type":"LineString","coordinates":[[3,6,0],[4,7]]}'::jsonb),
    ('string longitude','{"type":"LineString","coordinates":[["3",6],[4,7]]}'::jsonb),
    ('null latitude','{"type":"LineString","coordinates":[[3,null],[4,7]]}'::jsonb),
    ('low longitude','{"type":"LineString","coordinates":[[-181,6],[4,7]]}'::jsonb),
    ('high longitude','{"type":"LineString","coordinates":[[181,6],[4,7]]}'::jsonb),
    ('low latitude','{"type":"LineString","coordinates":[[3,-91],[4,7]]}'::jsonb),
    ('high latitude','{"type":"LineString","coordinates":[[3,91],[4,7]]}'::jsonb)
  ) AS cases(label,shape)
  LOOP
    shape_rejected:=false;
    BEGIN
      PERFORM private.assert_geojson_linestring_v1(shape_case.shape);
    EXCEPTION WHEN check_violation THEN
      shape_rejected:=true;
    END;
    PERFORM pg_temp.route_check('shape rejects '||shape_case.label,shape_rejected);
  END LOOP;
  PERFORM private.assert_geojson_linestring_v1(shape1);
  PERFORM private.assert_geojson_linestring_v1(
    '{"type":"LineString","coordinates":[[-180,-90],[180,90]]}'::jsonb);
  PERFORM pg_temp.route_check('16 normalized linestring and boundary coordinates accepted',true);

  -- Verify malformed payloads fail through the writer without superseding history.
  FOR shape_case IN SELECT * FROM (VALUES
    ('empty object','{}'::jsonb),
    ('missing type','{"coordinates":[[3,6],[4,7]]}'::jsonb),
    ('missing coordinates','{"type":"LineString"}'::jsonb)
  ) AS cases(label,shape)
  LOOP
    r:=pg_temp.route_as('service_role',format(
      $sql$SELECT * FROM public.record_offering_route_evidence_for_server(%L::uuid,'test-router','directions','v1',%L,%L::jsonb,100,60,%L::timestamptz,%L::timestamptz)$sql$,
      intent_id,'invalid-'||shape_case.label,shape_case.shape::text,generated_time,dep_expiry));
    PERFORM pg_temp.route_check('writer rejects '||shape_case.label,
      r->>'ok'='false' AND r->>'sqlstate'='23514'
      AND (SELECT count(*) FROM private.offering_route_evidence WHERE offering_movement_intent_id=intent_id)=2
      AND EXISTS(SELECT 1 FROM private.offering_route_evidence WHERE id=second_id AND status='current'));
  END LOOP;

  -- All writer calls above share this transaction. Flush before reporting success.
  SET CONSTRAINTS private.offering_route_evidence_complete IMMEDIATE;
  PERFORM pg_temp.route_check('17 same-transaction regeneration has no pending failure',true);

  PERFORM pg_temp.route_check('14 immutable history preserved',
    EXISTS(SELECT 1 FROM private.offering_route_evidence WHERE id=first_id AND status='superseded')
    AND EXISTS(SELECT 1 FROM private.offering_route_evidence WHERE id=second_id AND status='current'));
END;
$route_test$;

SELECT count(*) AS tests,
  count(*) FILTER(WHERE passed) AS passed,
  count(*) FILTER(WHERE NOT passed) AS failed
FROM route_producer_test_results;

SELECT check_number,test_name,passed
FROM route_producer_test_results
ORDER BY check_number;

ROLLBACK;
