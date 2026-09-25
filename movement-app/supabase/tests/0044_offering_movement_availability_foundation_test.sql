BEGIN;

SET TRANSACTION ISOLATION LEVEL READ COMMITTED;


-- =========================================================
-- Results
-- =========================================================

CREATE TEMP TABLE pg_temp.availability_results (
  test_number integer GENERATED ALWAYS AS IDENTITY,
  test_name text NOT NULL UNIQUE,
  passed boolean NOT NULL,
  diagnostic text
) ON COMMIT DROP;


CREATE FUNCTION pg_temp.availability_check(
  p_name text,
  p_passed boolean,
  p_diagnostic text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $check$
BEGIN
  INSERT INTO pg_temp.availability_results(
    test_name,
    passed,
    diagnostic
  )
  VALUES (
    p_name,
    coalesce(p_passed, false),
    p_diagnostic
  );
END;
$check$;


REVOKE ALL
ON FUNCTION pg_temp.availability_check(
  text,
  boolean,
  text
)
FROM PUBLIC;


-- =========================================================
-- Execute one SELECT as a simulated API role/member
-- =========================================================

CREATE FUNCTION pg_temp.availability_select_as(
  p_role text,
  p_member_id uuid,
  p_sql text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $select_as$
DECLARE
  previous_role text;
  previous_sub text;
  previous_jwt_role text;
  previous_claims text;

  rows_json jsonb;
  result_json jsonb;
BEGIN
  IF p_role NOT IN (
    'authenticated',
    'anon',
    'service_role'
  ) THEN
    RAISE EXCEPTION 'Unsupported test role';
  END IF;

  previous_role :=
    current_setting('role');

  previous_sub :=
    current_setting(
      'request.jwt.claim.sub',
      true
    );

  previous_jwt_role :=
    current_setting(
      'request.jwt.claim.role',
      true
    );

  previous_claims :=
    current_setting(
      'request.jwt.claims',
      true
    );

  PERFORM set_config(
    'request.jwt.claim.sub',
    coalesce(p_member_id::text, ''),
    true
  );

  PERFORM set_config(
    'request.jwt.claim.role',
    p_role,
    true
  );

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub',
      p_member_id,
      'role',
      p_role
    )::text,
    true
  );

  PERFORM set_config(
    'role',
    p_role,
    true
  );

  BEGIN
    EXECUTE
      'SELECT coalesce(
         jsonb_agg(to_jsonb(q)),
         ''[]''::jsonb
       )
       FROM (' || p_sql || ') AS q'
    INTO rows_json;

    result_json :=
      jsonb_build_object(
        'ok',
        true,
        'rows',
        rows_json
      );

  EXCEPTION
    WHEN OTHERS THEN
      result_json :=
        jsonb_build_object(
          'ok',
          false,
          'state',
          SQLSTATE,
          'message',
          SQLERRM
        );
  END;

  PERFORM set_config(
    'role',
    previous_role,
    true
  );

  PERFORM set_config(
    'request.jwt.claim.sub',
    coalesce(previous_sub, ''),
    true
  );

  PERFORM set_config(
    'request.jwt.claim.role',
    coalesce(previous_jwt_role, ''),
    true
  );

  PERFORM set_config(
    'request.jwt.claims',
    coalesce(previous_claims, '{}'),
    true
  );

  RETURN result_json;
END;
$select_as$;


REVOKE ALL
ON FUNCTION pg_temp.availability_select_as(
  text,
  uuid,
  text
)
FROM PUBLIC;


-- =========================================================

-- Reuse the 0041 trusted selection/resolution chain and 0042 role simulator.
CREATE FUNCTION pg_temp.availability_fixture(p_label text,p_areas boolean DEFAULT true,p_departure interval DEFAULT interval '1 hour')
RETURNS TABLE(member_id uuid,intent_id uuid,route_id uuid,vehicle_id uuid)
LANGUAGE plpgsql AS $fixture$
DECLARE
  m uuid:=gen_random_uuid(); v uuid:=gen_random_uuid(); i uuid; e uuid;
  source_id uuid; resolved_id uuid; endpoints uuid[]:=ARRAY[]::uuid[];
  n integer; place text; r jsonb;
BEGIN
  INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  VALUES(m,'authenticated','authenticated',m::text||'@test-0044.invalid',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now());
  FOR n IN 1..2 LOOP
    place:=p_label||'-'||n;
    SELECT x.location_reference_id INTO source_id
    FROM public.record_verified_selected_location_for_server(m,gen_random_uuid(),
      'Precise private address '||place,'test_provider',place,'selection_proof_v1',
      clock_timestamp()-interval '1 minute',clock_timestamp()+interval '2 hours') x;
    IF p_areas THEN
      SELECT x.resolved_location_reference_id INTO resolved_id
      FROM public.record_attested_location_resolution_for_server(m,source_id,gen_random_uuid(),
        'test_provider','geocode','test_v1',place,'resolution_v1',
        CASE n WHEN 1 THEN 'Ologolo, Lagos' ELSE 'Ikeja, Lagos' END,
        6.437+n*0.01,3.501+n*0.01,clock_timestamp(),NULL) x;
    ELSE
      -- Legacy trusted resolution intentionally has no discovery-area evidence.
      SELECT x.resolved_location_reference_id INTO resolved_id
      FROM public.record_attested_location_resolution_for_server(m,source_id,gen_random_uuid(),
        'test_provider','geocode','test_v1',place,'resolution_v1',
        6.437+n*0.01,3.501+n*0.01,clock_timestamp(),NULL) x;
    END IF;
    endpoints:=array_append(endpoints,resolved_id);
  END LOOP;
  r:=pg_temp.availability_select_as('authenticated',m,format(
    'SELECT * FROM public.create_offering_movement_intent(%L::uuid,%L::uuid,%L::uuid,%L::timestamptz,NULL)',
    gen_random_uuid(),endpoints[1],endpoints[2],clock_timestamp()+p_departure));
  i:=(r#>>'{rows,0,offering_movement_intent_id}')::uuid;
  IF i IS NULL THEN RAISE EXCEPTION 'Fixture intent failed: %',r; END IF;
  SELECT x.route_evidence_id INTO e FROM public.record_offering_route_evidence_for_server(
    i,'test_router','directions','v1',p_label,
    '{"type":"LineString","coordinates":[[3.511,6.447],[3.521,6.457]]}'::jsonb,
    12000,1500,clock_timestamp(),NULL) x;
  INSERT INTO public.vehicles(id,make,model,year,color,seat_capacity,plate_number)
  VALUES(v,'Test make','Test model',2020,'Blue',3,'T0044-'||left(v::text,8));
  INSERT INTO public.member_vehicle_access(member_id,vehicle_id,active) VALUES(m,v,true);
  RETURN QUERY SELECT m,i,e,v;
END;
$fixture$;

DO $test$
DECLARE
  f record; other record; no_areas record; short_lived record;
  r jsonb; req uuid:=gen_random_uuid(); a uuid; a_other uuid; a_missing uuid; a_short uuid;
  command text; scenario text; rejected boolean; columns text[];
BEGIN
  SELECT * INTO f FROM pg_temp.availability_fixture('primary');
  SELECT * INTO other FROM pg_temp.availability_fixture('other');
  SELECT * INTO no_areas FROM pg_temp.availability_fixture('no-areas',false);
  command:=format('SELECT * FROM public.open_offering_movement_availability(%L::uuid,%L::uuid,%L::uuid,2)',req,f.intent_id,f.vehicle_id);

  r:=pg_temp.availability_select_as('anon',NULL,command);
  PERFORM pg_temp.availability_check('anon cannot execute opening',r->>'state'='42501',r::text);
  r:=pg_temp.availability_select_as('authenticated',NULL,command);
  PERFORM pg_temp.availability_check('unauthenticated caller rejected',r->>'state'='42501',r::text);
  r:=pg_temp.availability_select_as('authenticated',gen_random_uuid(),command);
  PERFORM pg_temp.availability_check('missing member rejected',r->>'state'='42501',r::text);
  r:=pg_temp.availability_select_as('authenticated',other.member_id,command);
  PERFORM pg_temp.availability_check('cannot expose another members intent',r->>'state'='42501',r::text);

  UPDATE public.member_vehicle_access SET active=false WHERE member_id=f.member_id AND vehicle_id=f.vehicle_id;
  r:=pg_temp.availability_select_as('authenticated',f.member_id,command);
  PERFORM pg_temp.availability_check('inactive vehicle access rejected',r->>'state'='23514',r::text);
  UPDATE public.member_vehicle_access SET active=true WHERE member_id=f.member_id AND vehicle_id=f.vehicle_id;
  r:=pg_temp.availability_select_as('authenticated',f.member_id,replace(command,',2)',',4)'));
  PERFORM pg_temp.availability_check('capacity above vehicle rejected',r->>'state'='23514',r::text);
  r:=pg_temp.availability_select_as('authenticated',f.member_id,replace(command,',2)',',0)'));
  PERFORM pg_temp.availability_check('zero places rejected',r->>'state'='23514',r::text);
  r:=pg_temp.availability_select_as('authenticated',f.member_id,replace(command,f.vehicle_id::text,gen_random_uuid()::text));
  PERFORM pg_temp.availability_check('missing vehicle rejected',r->>'ok'='false',r::text);

  -- Even trusted direct construction cannot cross-bind another intent's route.
  rejected:=false;
  BEGIN
    INSERT INTO private.offering_movement_availability(request_id,offering_movement_intent_id,offering_member_id,
      route_evidence_id,route_evidence_version,vehicle_id,total_places,remaining_places,expires_at)
    VALUES(gen_random_uuid(),f.intent_id,f.member_id,other.route_id,1,f.vehicle_id,2,2,clock_timestamp()+interval '30 minutes');
  EXCEPTION WHEN check_violation THEN rejected:=true;
  END;
  PERFORM pg_temp.availability_check('route from different intent or member rejected',rejected);

  r:=pg_temp.availability_select_as('authenticated',f.member_id,command);
  a:=(r#>>'{rows,0,availability_id}')::uuid;
  PERFORM pg_temp.availability_check('valid opening succeeds without requester',r->>'ok'='true' AND a IS NOT NULL,r::text);
  PERFORM pg_temp.availability_check('authoritative route version member and capacity bound',
    EXISTS(SELECT 1 FROM private.offering_movement_availability x WHERE x.id=a AND x.route_evidence_id=f.route_id
      AND x.route_evidence_version=1 AND x.offering_member_id=f.member_id AND x.total_places=2 AND x.remaining_places=2));
  r:=pg_temp.availability_select_as('authenticated',f.member_id,command);
  PERFORM pg_temp.availability_check('identical retry returns original availability',
    r->>'ok'='true' AND (r#>>'{rows,0,availability_id}')::uuid=a,r::text);
  r:=pg_temp.availability_select_as('authenticated',f.member_id,replace(command,',2)',',1)'));
  PERFORM pg_temp.availability_check('retry cannot change total places',r->>'state'='23514',r::text);
  r:=pg_temp.availability_select_as('authenticated',f.member_id,replace(command,f.vehicle_id::text,other.vehicle_id::text));
  PERFORM pg_temp.availability_check('retry cannot change vehicle',r->>'state'='23514',r::text);
  r:=pg_temp.availability_select_as('authenticated',f.member_id,replace(command,req::text,gen_random_uuid()::text));
  PERFORM pg_temp.availability_check('new request cannot duplicate intent availability',r->>'state'='23514',r::text);

  r:=pg_temp.availability_select_as('authenticated',other.member_id,
    format('SELECT * FROM public.discover_offering_movement_availability(50) WHERE availability_id=%L::uuid',a));
  SELECT array_agg(k ORDER BY k) INTO columns FROM jsonb_object_keys(r#>'{rows,0}') k;
  PERFORM pg_temp.availability_check('discovery has only the ten safe output fields',columns=ARRAY[
    'availability_id','color','destination_area','earliest_departure_at','latest_departure_at','make','model','origin_area','remaining_places','year']);
  PERFORM pg_temp.availability_check('eligible other member visible with trusted broad labels',
    r->>'ok'='true' AND r#>>'{rows,0,origin_area}'='Ologolo, Lagos' AND r#>>'{rows,0,destination_area}'='Ikeja, Lagos',r::text);
  r:=pg_temp.availability_select_as('authenticated',f.member_id,
    format('SELECT * FROM public.discover_offering_movement_availability(50) WHERE availability_id=%L::uuid',a));
  PERFORM pg_temp.availability_check('own availability excluded',r->>'ok'='true' AND r->'rows'='[]'::jsonb,r::text);
  r:=pg_temp.availability_select_as('authenticated',NULL,'SELECT * FROM public.discover_offering_movement_availability(20)');
  PERFORM pg_temp.availability_check('discovery requires authentication',r->>'state'='42501',r::text);
  r:=pg_temp.availability_select_as('authenticated',other.member_id,'SELECT * FROM public.discover_offering_movement_availability(51)');
  PERFORM pg_temp.availability_check('discovery limit bounded',r->>'state'='23514',r::text);

  r:=pg_temp.availability_select_as('authenticated',no_areas.member_id,format(
    'SELECT * FROM public.open_offering_movement_availability(%L::uuid,%L::uuid,%L::uuid,2)',gen_random_uuid(),no_areas.intent_id,no_areas.vehicle_id));
  a_missing:=(r#>>'{rows,0,availability_id}')::uuid;
  r:=pg_temp.availability_select_as('authenticated',other.member_id,format(
    'SELECT * FROM public.discover_offering_movement_availability(50) WHERE availability_id=%L::uuid',a_missing));
  PERFORM pg_temp.availability_check('no trusted area means no discovery fallback',
    a_missing IS NOT NULL AND r->>'ok'='true' AND r->'rows'='[]'::jsonb,r::text);

  -- Each scenario is rolled back independently so it tests the same valid row.
  FOREACH scenario IN ARRAY ARRAY['withdrawn','full','unavailable','inactive access','reduced vehicle capacity','withdrawn intent','superseded route'] LOOP
    BEGIN
      CASE scenario
        WHEN 'withdrawn' THEN UPDATE private.offering_movement_availability SET status='withdrawn' WHERE id=a;
        WHEN 'full' THEN UPDATE private.offering_movement_availability SET remaining_places=0,status='full' WHERE id=a;
        WHEN 'unavailable' THEN UPDATE private.offering_movement_availability SET status='unavailable' WHERE id=a;
        WHEN 'inactive access' THEN UPDATE public.member_vehicle_access SET active=false WHERE member_id=f.member_id AND vehicle_id=f.vehicle_id;
        WHEN 'reduced vehicle capacity' THEN UPDATE public.vehicles SET seat_capacity=1 WHERE id=f.vehicle_id;
        WHEN 'withdrawn intent' THEN UPDATE private.offering_movement_intents SET status='withdrawn' WHERE id=f.intent_id;
        WHEN 'superseded route' THEN UPDATE private.offering_route_evidence SET status='superseded' WHERE id=f.route_id;
      END CASE;
      r:=pg_temp.availability_select_as('authenticated',other.member_id,format(
        'SELECT * FROM public.discover_offering_movement_availability(50) WHERE availability_id=%L::uuid',a));
      IF r->>'ok'<>'true' OR r->'rows'<>'[]'::jsonb THEN RAISE EXCEPTION 'Discovery exposed invalid state: % %',scenario,r; END IF;
      rejected:=false;
      BEGIN PERFORM private.assert_offering_movement_availability(a);
      EXCEPTION WHEN check_violation THEN rejected:=true; END;
      IF NOT rejected THEN RAISE EXCEPTION 'Assertion accepted invalid state: %',scenario; END IF;
      RAISE EXCEPTION USING ERRCODE='ZX044',MESSAGE='rollback successful scenario';
    EXCEPTION WHEN SQLSTATE 'ZX044' THEN NULL;
    END;
    PERFORM pg_temp.availability_check(scenario||' excluded and rejected by assertion',true);
  END LOOP;

  rejected:=false;
  BEGIN UPDATE private.offering_movement_availability SET route_evidence_id=other.route_id WHERE id=a;
  EXCEPTION WHEN check_violation THEN rejected:=true; END;
  PERFORM pg_temp.availability_check('route binding immutable',rejected);
  rejected:=false;
  BEGIN DELETE FROM private.offering_movement_availability WHERE id=a;
  EXCEPTION WHEN check_violation THEN rejected:=true; END;
  PERFORM pg_temp.availability_check('history cannot be deleted',rejected);

  UPDATE private.offering_movement_availability SET remaining_places=1 WHERE id=a;
  r:=pg_temp.availability_select_as('authenticated',f.member_id,command);
  PERFORM pg_temp.availability_check('retry preserves consumed capacity',r->>'ok'='true'
    AND (SELECT remaining_places=1 FROM private.offering_movement_availability WHERE id=a),r::text);
  rejected:=false;
  BEGIN UPDATE private.offering_movement_availability SET remaining_places=2 WHERE id=a;
  EXCEPTION WHEN check_violation THEN rejected:=true; END;
  PERFORM pg_temp.availability_check('capacity cannot be replenished by update',rejected);
  UPDATE private.offering_movement_availability SET status='withdrawn' WHERE id=a;
  rejected:=false;
  BEGIN UPDATE private.offering_movement_availability SET status='open' WHERE id=a;
  EXCEPTION WHEN check_violation THEN rejected:=true; END;
  PERFORM pg_temp.availability_check('terminal history cannot reopen',rejected);
  r:=pg_temp.availability_select_as('authenticated',f.member_id,command);
  PERFORM pg_temp.availability_check('terminal retry fails closed',r->>'state'='23514',r::text);
  PERFORM pg_temp.availability_check('availability withdrawal preserves intent and route history',
    EXISTS(SELECT 1 FROM private.offering_movement_intents WHERE id=f.intent_id AND status='current')
    AND EXISTS(SELECT 1 FROM private.offering_route_evidence WHERE id=f.route_id AND status='current'));

  -- Time-based exclusion without altering immutable timestamps or disabling triggers.
  SELECT * INTO short_lived FROM pg_temp.availability_fixture('departure',true,interval '2 seconds');
  r:=pg_temp.availability_select_as('authenticated',short_lived.member_id,format(
    'SELECT * FROM public.open_offering_movement_availability(%L::uuid,%L::uuid,%L::uuid,2)',
    gen_random_uuid(),short_lived.intent_id,short_lived.vehicle_id));
  a_short:=(r#>>'{rows,0,availability_id}')::uuid;
  IF a_short IS NULL THEN RAISE EXCEPTION 'Short-lived opening failed: %',r; END IF;
  PERFORM pg_sleep(2.1);
  r:=pg_temp.availability_select_as('authenticated',other.member_id,format(
    'SELECT * FROM public.discover_offering_movement_availability(50) WHERE availability_id=%L::uuid',a_short));
  PERFORM pg_temp.availability_check('elapsed departure excluded while status still open',r->>'ok'='true' AND r->'rows'='[]'::jsonb,r::text);
  UPDATE private.offering_movement_availability SET status='expired' WHERE id=a_short;
  r:=pg_temp.availability_select_as('authenticated',other.member_id,format(
    'SELECT * FROM public.discover_offering_movement_availability(50) WHERE availability_id=%L::uuid',a_short));
  PERFORM pg_temp.availability_check('expired availability excluded',r->>'ok'='true' AND r->'rows'='[]'::jsonb,r::text);

  PERFORM pg_temp.availability_check('RLS enabled with no public policies',
    (SELECT relrowsecurity FROM pg_class WHERE oid='private.offering_movement_availability'::regclass)
    AND NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='private.offering_movement_availability'::regclass));
  FOREACH scenario IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
    PERFORM pg_temp.availability_check('authenticated lacks direct '||scenario,
      NOT has_table_privilege('authenticated','private.offering_movement_availability',scenario));
  END LOOP;
  r:=pg_temp.availability_select_as('authenticated',f.member_id,'SELECT * FROM private.offering_movement_availability');
  PERFORM pg_temp.availability_check('direct client read rejected',r->>'state'='42501',r::text);
  PERFORM pg_temp.availability_check('private assertion not callable by clients or service role',
    NOT has_function_privilege('authenticated','private.assert_offering_movement_availability(uuid)','EXECUTE')
    AND NOT has_function_privilege('service_role','private.assert_offering_movement_availability(uuid)','EXECUTE'));
  SET CONSTRAINTS ALL IMMEDIATE;
END;
$test$;

SELECT test_number,test_name,passed,diagnostic FROM pg_temp.availability_results ORDER BY test_number;
DO $verify$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_temp.availability_results WHERE NOT passed) THEN
    RAISE EXCEPTION '0044 availability regression failed';
  END IF;
END;
$verify$;
ROLLBACK;
