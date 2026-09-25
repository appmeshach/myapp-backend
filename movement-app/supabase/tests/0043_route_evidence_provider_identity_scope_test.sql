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
  other_intent_id uuid:=gen_random_uuid();
  later_time timestamptz;
  mismatch record;
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
  VALUES(member_id,'authenticated','authenticated',member_id::text||'@test-0043.invalid',base_time,
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,base_time,base_time);

  INSERT INTO private.movement_location_references(
    id,owner_member_id,declared_label,source_kind,resolution_status,latitude,longitude,
    provider_namespace,provider_place_reference,resolution_version,created_at,resolved_at,expires_at
  ) VALUES
    (origin_id,member_id,'Test origin 0043','provider_resolved','resolved',6.434,3.489,
     'test-location','origin-0043','resolver-v1',base_time,base_time,dep_expiry),
    (destination_id,member_id,'Test destination 0043','provider_resolved','resolved',6.469,3.389,
     'test-location','destination-0043','resolver-v1',base_time,base_time,dep_expiry);

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


  INSERT INTO private.offering_movement_intents(
    id,offering_member_id,intent_key,version,earliest_departure_at,latest_departure_at,created_at,expires_at,status
  ) VALUES(other_intent_id,member_id,gen_random_uuid(),1,base_time+interval '1 hour',
    base_time+interval '90 minutes',base_time,dep_expiry,'current');
  INSERT INTO private.offering_movement_intent_locations(intent_id,role,location_reference_id)
  VALUES(other_intent_id,'origin',origin_id),(other_intent_id,'destination',destination_id);
  SET CONSTRAINTS private.offering_intent_complete,private.offering_intent_locations_complete IMMEDIATE;
  SET CONSTRAINTS private.offering_intent_complete,private.offering_intent_locations_complete DEFERRED;

  r:=pg_temp.route_as('service_role',format(
    $sql$SELECT * FROM public.record_offering_route_evidence_for_server(%L::uuid,'test-router','directions','v1','shared-route',%L::jsonb,12000,1500,%L::timestamptz,%L::timestamptz)$sql$,
    intent_id,shape1::text,generated_time,dep_expiry));
  first_id:=(r#>>'{rows,0,route_evidence_id}')::uuid;
  PERFORM pg_temp.route_check('first evidence created',r->>'ok'='true' AND first_id IS NOT NULL);

  r:=pg_temp.route_as('service_role',format(
    $sql$SELECT * FROM public.record_offering_route_evidence_for_server(%L::uuid,'test-router','directions','v1','shared-route',%L::jsonb,12000,1500,%L::timestamptz,%L::timestamptz)$sql$,
    other_intent_id,shape1::text,generated_time,dep_expiry));
  second_id:=(r#>>'{rows,0,route_evidence_id}')::uuid;
  PERFORM pg_temp.route_check('same provider identity permitted across intents',
    r->>'ok'='true' AND second_id IS NOT NULL AND second_id<>first_id);

  later_time:=clock_timestamp();
  r:=pg_temp.route_as('service_role',format(
    $sql$SELECT * FROM public.record_offering_route_evidence_for_server(%L::uuid,'test-router','directions','v1','shared-route',%L::jsonb,12000,1500,%L::timestamptz,%L::timestamptz)$sql$,
    intent_id,shape1::text,later_time,dep_expiry+interval '1 hour'));
  PERFORM pg_temp.route_check('later observation returns existing evidence with same effective expiry',
    later_time>generated_time AND r->>'ok'='true' AND (r#>>'{rows,0,route_evidence_id}')::uuid=first_id);
  PERFORM pg_temp.route_check('replay preserves original timestamp version and current count',
    EXISTS(SELECT 1 FROM private.offering_route_evidence WHERE id=first_id AND generated_at=generated_time AND version=1)
    AND (SELECT count(*) FROM private.offering_route_evidence WHERE offering_movement_intent_id=intent_id)=1
    AND (SELECT count(*) FROM private.offering_route_evidence WHERE offering_movement_intent_id=intent_id AND status='current')=1);

  FOR mismatch IN SELECT * FROM (VALUES
    ('shape',shape2,12000::bigint,1500::bigint,dep_expiry),
    ('distance',shape1,12001::bigint,1500::bigint,dep_expiry),
    ('duration',shape1,12000::bigint,1501::bigint,dep_expiry),
    ('expiry',shape1,12000::bigint,1500::bigint,dep_expiry-interval '1 minute')
  ) cases(label,shape,distance,duration,expiry)
  LOOP
    r:=pg_temp.route_as('service_role',format(
      $sql$SELECT * FROM public.record_offering_route_evidence_for_server(%L::uuid,'test-router','directions','v1','shared-route',%L::jsonb,%L::bigint,%L::bigint,%L::timestamptz,%L::timestamptz)$sql$,
      intent_id,mismatch.shape::text,mismatch.distance,mismatch.duration,later_time,mismatch.expiry));
    PERFORM pg_temp.route_check('changed '||mismatch.label||' fails closed',
      r->>'ok'='false' AND r->>'sqlstate'='23514' AND r->>'message'='Provider route reference does not match recorded evidence');
  END LOOP;

  -- Endpoints cannot be submitted to the writer or changed on the intent.
  -- Exercise both immutable bindings without disabling any protection.
  shape_rejected:=false;
  BEGIN
    UPDATE private.offering_movement_intent_locations il SET location_reference_id=destination_id
    WHERE il.intent_id=other_intent_id AND il.role='origin';
  EXCEPTION WHEN check_violation THEN shape_rejected:=true;
  END;
  PERFORM pg_temp.route_check('changed intent endpoint fails closed',shape_rejected);
  shape_rejected:=false;
  BEGIN
    UPDATE private.offering_route_evidence SET origin_location_reference_id=destination_id,
      destination_location_reference_id=origin_id WHERE id=first_id;
  EXCEPTION WHEN check_violation THEN shape_rejected:=true;
  END;
  PERFORM pg_temp.route_check('changed evidence endpoints fail closed',shape_rejected);

  PERFORM pg_temp.route_check('failed replays preserve both current rows',
    (SELECT count(*) FROM private.offering_route_evidence WHERE offering_movement_intent_id IN (intent_id,other_intent_id))=2
    AND (SELECT count(*) FROM private.offering_route_evidence WHERE offering_movement_intent_id IN (intent_id,other_intent_id) AND status='current')=2);
  SET CONSTRAINTS ALL IMMEDIATE;
END;
$route_test$;

SELECT check_number,test_name,passed FROM route_producer_test_results ORDER BY check_number;
DO $verify$
BEGIN
  IF EXISTS(SELECT 1 FROM route_producer_test_results WHERE NOT passed) THEN
    RAISE EXCEPTION '0043 route identity regression failed';
  END IF;
END;
$verify$;
ROLLBACK;
