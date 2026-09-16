BEGIN;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;

CREATE TEMP TABLE route_results (
  test_name text PRIMARY KEY,
  passed boolean NOT NULL,
  diagnostic text
) ON COMMIT DROP;

CREATE FUNCTION pg_temp.route_check(p_name text,p_pass boolean,p_diagnostic text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO pg_temp.route_results VALUES(p_name,coalesce(p_pass,false),p_diagnostic);
END $$;

CREATE FUNCTION pg_temp.route_error(p_name text,p_sql text,p_state text DEFAULT '23514',p_message text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE observed text; observed_message text;
BEGIN
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  BEGIN
    EXECUTE p_sql;
    SET CONSTRAINTS ALL IMMEDIATE;
    observed:='00000'; observed_message:='unexpected success';
    RAISE EXCEPTION USING ERRCODE='ZX023',MESSAGE='restore attempted mutation';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE<>'ZX023' THEN observed:=SQLSTATE; observed_message:=SQLERRM; END IF;
  END;
  SET CONSTRAINTS ALL DEFERRED;
  PERFORM pg_temp.route_check(p_name,observed=p_state AND (p_message IS NULL OR observed_message=p_message),observed||': '||observed_message);
END $$;

CREATE FUNCTION pg_temp.route_resolved_location(p_owner uuid,p_label text DEFAULT 'Resolved private point')
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE result_id uuid; created_time timestamptz:=clock_timestamp();
BEGIN
  INSERT INTO private.movement_location_references(
    owner_member_id,declared_label,source_kind,resolution_status,latitude,longitude,
    provider_namespace,provider_place_reference,resolution_version,created_at,resolved_at,expires_at)
  VALUES(p_owner,p_label,'provider_resolved','resolved',6.45,3.47,'fixture','place-'||gen_random_uuid()::text,
    'v1',created_time,created_time-interval '1 second',created_time+interval '2 days')
  RETURNING id INTO result_id;
  RETURN result_id;
END $$;

CREATE FUNCTION pg_temp.route_unresolved_location(p_owner uuid)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE result_id uuid;
BEGIN
  INSERT INTO private.movement_location_references(owner_member_id,declared_label,source_kind,resolution_status,created_at)
  VALUES(p_owner,'Unresolved declaration','member_declared','unresolved',clock_timestamp()) RETURNING id INTO result_id;
  RETURN result_id;
END $$;

CREATE FUNCTION pg_temp.route_intent(p_owner uuid,p_origin uuid,p_destination uuid,p_key uuid DEFAULT gen_random_uuid(),p_version integer DEFAULT 1)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE result_id uuid;
BEGIN
  INSERT INTO private.offering_movement_intents(
    offering_member_id,intent_key,version,earliest_departure_at,latest_departure_at,created_at,expires_at,status)
  VALUES(p_owner,p_key,p_version,now()+interval '1 hour',now()+interval '2 hours',clock_timestamp(),clock_timestamp()+interval '3 days','current')
  RETURNING id INTO result_id;
  INSERT INTO private.offering_movement_intent_locations(intent_id,role,location_reference_id)
    VALUES(result_id,'origin',p_origin),(result_id,'destination',p_destination);
  RETURN result_id;
END $$;

CREATE FUNCTION pg_temp.route_evidence(p_intent uuid,p_owner uuid,p_origin uuid,p_destination uuid,p_version integer DEFAULT 1,p_override jsonb DEFAULT '{}')
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE result_id uuid; created_time timestamptz:=clock_timestamp();
BEGIN
  INSERT INTO private.offering_route_evidence
  SELECT r.* FROM jsonb_populate_record(NULL::private.offering_route_evidence,
    jsonb_build_object(
      'id',gen_random_uuid(),
      'offering_movement_intent_id',p_intent,
      'offering_member_id',p_owner,
      'origin_location_reference_id',p_origin,
      'destination_location_reference_id',p_destination,
      'version',p_version,
      'evidence_schema_version','offering_route_evidence_v1',
      'provider_namespace','fixture-provider',
      'provider_product','fixture-routing',
      'provider_version','v1',
      'provider_route_reference','route-'||gen_random_uuid()::text,
      'route_shape_format','geojson_linestring_v1',
      'route_shape',jsonb_build_object('type','LineString','coordinates',jsonb_build_array(jsonb_build_array(3.47,6.45),jsonb_build_array(3.50,6.50))),
      'route_distance_meters',12000,
      'route_duration_seconds',1800,
      'generated_at',created_time-interval '1 second',
      'created_at',created_time,
      'expires_at',created_time+interval '1 day',
      'status','current') || p_override) r
  RETURNING id INTO result_id;
  RETURN result_id;
END $$;

DO $test$
DECLARE
  offering uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
  origin_id uuid; destination_id uuid; wrong_origin uuid; unresolved_id uuid;
  intent_id uuid; intent_key uuid:=gen_random_uuid(); evidence_id uuid; second_intent uuid; unresolved_intent uuid;
  wrong_endpoint_intent uuid; wrong_member_intent uuid;
  terminal_id uuid; expiring_id uuid; future_expiry_intent uuid; future_expiry_evidence uuid; result_count bigint; role_name text; old_role text; observed text;
  signature text; mutation text; before_counts jsonb; after_counts jsonb;
BEGIN
  INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  SELECT x,'authenticated','authenticated',x::text||'@test-0023.invalid','{}','{}',now(),now()
  FROM unnest(ARRAY[offering,outsider]) x;

  origin_id:=pg_temp.route_resolved_location(offering,'Offer origin');
  destination_id:=pg_temp.route_resolved_location(offering,'Offer destination');
  wrong_origin:=pg_temp.route_resolved_location(outsider,'Wrong owner point');
  unresolved_id:=pg_temp.route_unresolved_location(offering);
  intent_id:=pg_temp.route_intent(offering,origin_id,destination_id,intent_key,1);
  SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED;

  SELECT jsonb_build_object(
    'alignments',(SELECT count(*) FROM public.alignments),
    'journeys',(SELECT count(*) FROM public.journeys),
    'financial_proposals',(SELECT count(*) FROM private.financial_proposals),
    'financial_agreements',(SELECT count(*) FROM private.financial_agreements),
    'financial_components',(SELECT count(*) FROM private.financial_components),
    'payments',(SELECT count(*) FROM private.alignment_activation_payments),
    'settlements',(SELECT count(*) FROM private.movement_settlements)) INTO before_counts;

  evidence_id:=pg_temp.route_evidence(intent_id,offering,origin_id,destination_id,1);
  SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED;
  PERFORM pg_temp.route_check('valid offering route evidence accepted',EXISTS(SELECT 1 FROM private.offering_route_evidence WHERE id=evidence_id));
  PERFORM pg_temp.route_check('route evidence tied only to offering intent',EXISTS(
    SELECT 1 FROM private.offering_route_evidence e WHERE e.id=evidence_id AND e.offering_movement_intent_id=intent_id AND e.offering_member_id=offering));
  PERFORM pg_temp.route_check('normalized route totals stored',EXISTS(
    SELECT 1 FROM private.offering_route_evidence e WHERE e.id=evidence_id AND e.route_distance_meters=12000 AND e.route_duration_seconds=1800));
  PERFORM pg_temp.route_check('route shape remains private table data',EXISTS(
    SELECT 1 FROM private.offering_route_evidence e WHERE e.id=evidence_id AND e.route_shape->>'type'='LineString'));

  PERFORM pg_temp.route_error('invalid route coordinate rejected',format(
    'SELECT private.assert_geojson_linestring_v1(%L::jsonb)',
    '{"type":"LineString","coordinates":[[181,6.4],[3.5,6.5]]}'),
    '23514','Route shape coordinates are out of range');
  PERFORM pg_temp.route_error('one-point route rejected',format(
    'SELECT private.assert_geojson_linestring_v1(%L::jsonb)',
    '{"type":"LineString","coordinates":[[3.4,6.4]]}'),
    '23514','Route shape must be normalized GeoJSON LineString v1');
  PERFORM pg_temp.route_error('extra route shape property rejected',format(
    'SELECT private.assert_geojson_linestring_v1(%L::jsonb)',
    '{"type":"LineString","coordinates":[[3.4,6.4],[3.5,6.5]],"vendor":"x"}'),
    '23514','Route shape must be normalized GeoJSON LineString v1');

  wrong_endpoint_intent:=pg_temp.route_intent(offering,origin_id,destination_id,gen_random_uuid(),1);
  SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED;
  PERFORM pg_temp.route_error('wrong endpoint rejected',format(
    'SELECT pg_temp.route_evidence(%L,%L,%L,%L,1)',wrong_endpoint_intent,offering,wrong_origin,destination_id),
    '23514','Offering route evidence endpoints do not match intent');
  unresolved_intent:=pg_temp.route_intent(offering,unresolved_id,destination_id,gen_random_uuid(),1);
  SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED;
  PERFORM pg_temp.route_error('unresolved endpoint rejected',format(
    'SELECT pg_temp.route_evidence(%L,%L,%L,%L,1)',unresolved_intent,offering,unresolved_id,destination_id),
    '23514','Offering route evidence requires resolved eligible endpoints');
  wrong_member_intent:=pg_temp.route_intent(offering,origin_id,destination_id,gen_random_uuid(),1);
  SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED;
  PERFORM pg_temp.route_error('wrong offering member rejected',format(
    'SELECT pg_temp.route_evidence(%L,%L,%L,%L,1)',wrong_member_intent,outsider,origin_id,destination_id),
    '23514','Offering route evidence intent is not eligible');

  PERFORM pg_temp.route_error('blank provider namespace rejected',format(
    'SELECT pg_temp.route_evidence(%L,%L,%L,%L,2,%L::jsonb)',intent_id,offering,origin_id,destination_id,'{"provider_namespace":"   "}'),
    '23514');
  PERFORM pg_temp.route_error('negative route distance rejected',format(
    'SELECT pg_temp.route_evidence(%L,%L,%L,%L,2,%L::jsonb)',intent_id,offering,origin_id,destination_id,'{"route_distance_meters":-1}'),
    '23514');
  PERFORM pg_temp.route_error('future generated time rejected',format(
    'SELECT pg_temp.route_evidence(%L,%L,%L,%L,2,%L::jsonb)',intent_id,offering,origin_id,destination_id,'{"generated_at":"2999-01-01T00:00:00Z","created_at":"2999-01-02T00:00:00Z","expires_at":"2999-01-03T00:00:00Z"}'),
    '23514','Offering route evidence timestamps are invalid');

  PERFORM pg_temp.route_error('evidence fields immutable',format(
    'UPDATE private.offering_route_evidence SET route_distance_meters=12001 WHERE id=%L',evidence_id),
    '23514','Offering route evidence fields are immutable');
  PERFORM pg_temp.route_error('evidence deletion blocked',format(
    'DELETE FROM private.offering_route_evidence WHERE id=%L',evidence_id),
    '23514','Offering route evidence history cannot be deleted');

  PERFORM pg_temp.route_error('duplicate current evidence rejected',format(
    'SELECT pg_temp.route_evidence(%L,%L,%L,%L,2)',intent_id,offering,origin_id,destination_id),
    '23505');

  UPDATE private.offering_route_evidence SET status='superseded' WHERE id=evidence_id;
  second_intent:=pg_temp.route_intent(offering,origin_id,destination_id,gen_random_uuid(),1);
  SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED;
  terminal_id:=pg_temp.route_evidence(second_intent,offering,origin_id,destination_id,1);
  SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED;
  UPDATE private.offering_route_evidence SET status='superseded' WHERE id=terminal_id;
  PERFORM pg_temp.route_error('superseded cannot reopen',format(
    'UPDATE private.offering_route_evidence SET status=''current'' WHERE id=%L',terminal_id),
    '23514','Offering route evidence lifecycle cannot reopen or change terminal state');

  future_expiry_intent:=pg_temp.route_intent(offering,origin_id,destination_id,gen_random_uuid(),1);
  SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED;
  future_expiry_evidence:=pg_temp.route_evidence(future_expiry_intent,offering,origin_id,destination_id,1,
    jsonb_build_object('expires_at',clock_timestamp()+interval '1 hour'));
  SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED;
  PERFORM pg_temp.route_error('expired transition before deadline rejected',format(
    'UPDATE private.offering_route_evidence SET status=''expired'' WHERE id=%L',future_expiry_evidence),
    '23514','Offering route evidence expiry has not elapsed');

  -- Create an already-short-lived valid row, wait for its deadline, then expire it.
  expiring_id:=pg_temp.route_evidence(intent_id,offering,origin_id,destination_id,2,
    jsonb_build_object('expires_at',clock_timestamp()+interval '1 second'));
  SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED;
  PERFORM pg_sleep(1.1);
  UPDATE private.offering_route_evidence SET status='expired' WHERE id=expiring_id;
  PERFORM pg_temp.route_check('elapsed evidence can become expired',(SELECT status='expired' FROM private.offering_route_evidence WHERE id=expiring_id));
  PERFORM pg_temp.route_error('expired cannot reopen',format(
    'UPDATE private.offering_route_evidence SET status=''current'' WHERE id=%L',expiring_id),
    '23514','Offering route evidence lifecycle cannot reopen or change terminal state');

  -- Actual privilege checks. service_role can SELECT but cannot mutate.
  PERFORM pg_temp.route_check('route evidence RLS no policies PUBLIC denied',(
    SELECT c.relrowsecurity AND NOT EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid)
      AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee=0)
    FROM pg_class c WHERE c.oid='private.offering_route_evidence'::regclass));
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    PERFORM pg_temp.route_check(role_name||' cannot mutate route evidence',
      NOT has_table_privilege(role_name,'private.offering_route_evidence','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'));
    old_role:=current_setting('role');
    PERFORM set_config('role',role_name,true);
    BEGIN
      SELECT count(*) INTO result_count FROM private.offering_route_evidence;
      observed:='00000';
    EXCEPTION WHEN OTHERS THEN observed:=SQLSTATE;
    END;
    PERFORM set_config('role',old_role,true);
    IF role_name='authenticated' THEN
      PERFORM pg_temp.route_check('authenticated cannot read route evidence',observed='42501',observed);
    ELSIF role_name='anon' THEN
      PERFORM pg_temp.route_check('anon cannot read route evidence',observed='42501',observed);
    ELSE
      PERFORM pg_temp.route_check('service SELECT works',observed='00000',observed);
    END IF;
  END LOOP;

  FOREACH signature IN ARRAY ARRAY[
    'assert_geojson_linestring_v1(jsonb)',
    'assert_offering_route_evidence(uuid)',
    'protect_offering_route_evidence()',
    'validate_offering_route_evidence()'
  ] LOOP
    PERFORM pg_temp.route_check('helper isolated and restricted: '||signature,
      NOT has_function_privilege('anon','private.'||signature,'EXECUTE')
      AND NOT has_function_privilege('authenticated','private.'||signature,'EXECUTE')
      AND NOT has_function_privilege('service_role','private.'||signature,'EXECUTE')
      AND (SELECT p.prosecdef AND p.proconfig=ARRAY['search_path=""']::text[]
        AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0)
        FROM pg_proc p WHERE p.oid=to_regprocedure('private.'||signature)));
  END LOOP;

  PERFORM pg_temp.route_check('route evidence gate remains closed',EXISTS(
    SELECT 1 FROM pg_constraint c WHERE c.conrelid='private.financial_proposals'::regclass
      AND pg_get_constraintdef(c.oid)='CHECK ((route_evidence_id IS NULL))'));

  SELECT jsonb_build_object(
    'alignments',(SELECT count(*) FROM public.alignments),
    'journeys',(SELECT count(*) FROM public.journeys),
    'financial_proposals',(SELECT count(*) FROM private.financial_proposals),
    'financial_agreements',(SELECT count(*) FROM private.financial_agreements),
    'financial_components',(SELECT count(*) FROM private.financial_components),
    'payments',(SELECT count(*) FROM private.alignment_activation_payments),
    'settlements',(SELECT count(*) FROM private.movement_settlements)) INTO after_counts;
  PERFORM pg_temp.route_check('no operational rows created',before_counts=after_counts,after_counts::text);

  PERFORM pg_temp.route_check('no public route RPC exists',NOT EXISTS(
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname ~ '(route|evidence)'));
END
$test$;

SELECT test_name,passed,diagnostic FROM pg_temp.route_results ORDER BY test_name;
SELECT count(*) AS tests,count(*) FILTER(WHERE passed) AS passed,count(*) FILTER(WHERE NOT passed) AS failed
FROM pg_temp.route_results;

ROLLBACK;
