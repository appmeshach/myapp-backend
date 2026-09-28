BEGIN;

SET TRANSACTION ISOLATION LEVEL READ COMMITTED;


-- =========================================================
-- Results
-- =========================================================

CREATE TEMP TABLE pg_temp.recovery_results (
  test_number integer GENERATED ALWAYS AS IDENTITY,
  test_name text NOT NULL UNIQUE,
  passed boolean NOT NULL,
  diagnostic text
) ON COMMIT DROP;


CREATE FUNCTION pg_temp.recovery_check(
  p_name text,
  p_passed boolean,
  p_diagnostic text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $check$
BEGIN
  INSERT INTO pg_temp.recovery_results(
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
ON FUNCTION pg_temp.recovery_check(
  text,
  boolean,
  text
)
FROM PUBLIC;


-- =========================================================
-- Execute one SELECT as a simulated API role/member
-- =========================================================

CREATE FUNCTION pg_temp.recovery_as(
  p_role text,
  p_member_id uuid,
  p_sql text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $as_member$
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
$as_member$;


REVOKE ALL
ON FUNCTION pg_temp.recovery_as(
  text,
  uuid,
  text
)
FROM PUBLIC;


-- =========================================================
-- Trusted offering fixture
-- =========================================================

CREATE FUNCTION pg_temp.recovery_offering_fixture(
  p_label text,
  p_total_places integer DEFAULT 3,
  p_departure interval DEFAULT interval '1 hour',
  p_member_id uuid DEFAULT NULL
)
RETURNS TABLE (
  member_id uuid,
  intent_id uuid,
  route_id uuid,
  vehicle_id uuid,
  availability_id uuid
)
LANGUAGE plpgsql
AS $fixture$
DECLARE
  m uuid := coalesce(p_member_id, gen_random_uuid());
  v uuid := gen_random_uuid();

  i uuid;
  e uuid;
  a uuid;

  source_id uuid;
  resolved_id uuid;

  endpoints uuid[] := ARRAY[]::uuid[];

  n integer;
  place text;
  r jsonb;
BEGIN
  IF p_member_id IS NULL THEN
  INSERT INTO auth.users(
    id,
    aud,
    role,
    email,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  )
  VALUES (
    m,
    'authenticated',
    'authenticated',
    m::text || '@test-0054-offerer.invalid',
    clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    clock_timestamp(),
    clock_timestamp()
  );
  END IF;


  FOR n IN 1..2 LOOP
    place :=
      p_label || '-offerer-' || n;


    SELECT x.location_reference_id
    INTO source_id
    FROM public.record_verified_selected_location_for_server(
      m,
      gen_random_uuid(),
      'Precise private address ' || place,
      'test_provider',
      place,
      'selection_proof_v1',
      clock_timestamp() - interval '1 minute',
      clock_timestamp() + interval '4 hours'
    ) x;


    SELECT x.resolved_location_reference_id
    INTO resolved_id
    FROM public.record_attested_location_resolution_for_server(
      m,
      source_id,
      gen_random_uuid(),
      'test_provider',
      'geocode',
      'test_v1',
      place,
      'resolution_v1',
      CASE n
        WHEN 1 THEN 'Ologolo, Lagos'
        ELSE 'Victoria Island, Lagos'
      END,
      CASE n
        WHEN 1 THEN 6.4300
        ELSE 6.4281
      END,
      CASE n
        WHEN 1 THEN 3.5200
        ELSE 3.4219
      END,
      clock_timestamp(),
      NULL
    ) x;


    endpoints :=
      array_append(
        endpoints,
        resolved_id
      );
  END LOOP;


  r :=
    pg_temp.recovery_as(
      'authenticated',
      m,
      format(
        'SELECT *
         FROM public.create_offering_movement_intent(
           %L::uuid,
           %L::uuid,
           %L::uuid,
           %L::timestamptz,
           %L::timestamptz
         )',
        gen_random_uuid(),
        endpoints[1],
        endpoints[2],
        clock_timestamp() + p_departure,
        clock_timestamp() + p_departure + interval '1 hour'
      )
    );


  i :=
    (
      r #>>
      '{rows,0,offering_movement_intent_id}'
    )::uuid;


  IF i IS NULL THEN
    RAISE EXCEPTION
      '0054 offering fixture intent failed: %',
      r;
  END IF;


  SELECT x.route_evidence_id
  INTO e
  FROM public.record_offering_route_evidence_for_server(
    i,
    'test_router',
    'directions',
    'v1',
    p_label || '-route',
    '{
      "type":"LineString",
      "coordinates":[
        [3.5200,6.4300],
        [3.4900,6.4320],
        [3.4600,6.4330],
        [3.4219,6.4281]
      ]
    }'::jsonb,
    12000,
    1500,
    clock_timestamp(),
    NULL
  ) x;


  INSERT INTO public.vehicles(
    id,
    make,
    model,
    year,
    color,
    seat_capacity,
    plate_number
  )
  VALUES (
    v,
    'Test make',
    'Test model',
    2020,
    'Blue',
    greatest(p_total_places, 1),
    'T0054-' || left(v::text, 8)
  );


  INSERT INTO public.member_vehicle_access(
    member_id,
    vehicle_id,
    active
  )
  VALUES (
    m,
    v,
    true
  );


  r :=
    pg_temp.recovery_as(
      'authenticated',
      m,
      format(
        'SELECT *
         FROM public.open_offering_movement_availability(
           %L::uuid,
           %L::uuid,
           %L::uuid,
           %s
         )',
        gen_random_uuid(),
        i,
        v,
        p_total_places
      )
    );


  a :=
    (
      r #>>
      '{rows,0,availability_id}'
    )::uuid;


  IF a IS NULL THEN
    RAISE EXCEPTION
      '0054 offering fixture availability failed: %',
      r;
  END IF;


  RETURN QUERY
  SELECT
    m,
    i,
    e,
    v,
    a;
END;
$fixture$;

CREATE FUNCTION pg_temp.recovery_list(p_member uuid, p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  RETURN pg_temp.recovery_as('authenticated',p_member,
    format('SELECT * FROM public.list_my_open_offering_movement_availabilities(%L)',p_limit));
END;
$$;

DO $test$
DECLARE
  a record; b record; foreign_a record; short_a record;
  r jsonb; baseline jsonb; before_rows jsonb; after_rows jsonb;
  scenario text; passed boolean; expected uuid[]; keys text[];
  empty_member uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    VALUES(empty_member,'authenticated','authenticated',empty_member::text||'@test-0054.invalid','{}','{}',now(),now());
  PERFORM pg_temp.recovery_check('zero eligible rows',pg_temp.recovery_list(empty_member)='{"ok":true,"rows":[]}'::jsonb);
  r := pg_temp.recovery_list(NULL);
  PERFORM pg_temp.recovery_check('missing auth rejected',r->>'state'='42501');
  r := pg_temp.recovery_list(gen_random_uuid());
  PERFORM pg_temp.recovery_check('existing member required',r->>'state'='42501');
  SELECT * INTO a FROM pg_temp.recovery_offering_fixture('first',3,interval '1 hour');
  SELECT * INTO b FROM pg_temp.recovery_offering_fixture('second',2,interval '2 hours',a.member_id);
  SELECT * INTO foreign_a FROM pg_temp.recovery_offering_fixture('foreign');
  baseline := pg_temp.recovery_list(a.member_id);
  PERFORM pg_temp.recovery_check('multiple current intents recovered in departure order',
    baseline->>'ok'='true' AND jsonb_array_length(baseline->'rows')=2
    AND baseline#>>'{rows,0,availability_id}'=a.availability_id::text
    AND baseline#>>'{rows,1,availability_id}'=b.availability_id::text,baseline::text);
  PERFORM pg_temp.recovery_check('foreign availability not returned',NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(baseline->'rows') x WHERE x->>'availability_id'=foreign_a.availability_id::text));
  SELECT array_agg(k ORDER BY k) INTO keys FROM jsonb_object_keys(baseline#>'{rows,0}') k;
  PERFORM pg_temp.recovery_check('exact safe output shape',keys=ARRAY[
    'availability_id','destination_area','earliest_departure_at','expires_at','latest_departure_at',
    'offering_movement_intent_id','origin_area','remaining_places','total_places',
    'vehicle_color','vehicle_id','vehicle_make','vehicle_model','vehicle_year']);
  PERFORM pg_temp.recovery_check('trusted broad labels not private provider address',
    baseline#>>'{rows,0,origin_area}'='Ologolo, Lagos'
    AND baseline#>>'{rows,0,destination_area}'='Victoria Island, Lagos'
    AND baseline::text NOT LIKE '%Precise private address%');
  PERFORM pg_temp.recovery_check('own bindings and fixed capacity',
    baseline#>>'{rows,0,offering_movement_intent_id}'=a.intent_id::text
    AND baseline#>>'{rows,0,vehicle_id}'=a.vehicle_id::text
    AND baseline#>>'{rows,0,total_places}'='3' AND baseline#>>'{rows,0,remaining_places}'='3');
  PERFORM pg_temp.recovery_check('repeat order stable',pg_temp.recovery_list(a.member_id)=baseline);
  PERFORM pg_temp.recovery_check('max limit accepted',pg_temp.recovery_list(a.member_id,50)=baseline);
  r := pg_temp.recovery_as('authenticated',a.member_id,'SELECT * FROM public.list_my_open_offering_movement_availabilities()');
  PERFORM pg_temp.recovery_check('default limit accepted',r=baseline);
  FOREACH scenario IN ARRAY ARRAY['NULL','0','-1','51'] LOOP
    r := pg_temp.recovery_as('authenticated',a.member_id,'SELECT * FROM public.list_my_open_offering_movement_availabilities('||scenario||')');
    PERFORM pg_temp.recovery_check('invalid limit '||scenario,r->>'state'='23514');
  END LOOP;
  FOREACH scenario IN ARRAY ARRAY['anon','service_role'] LOOP
    r := pg_temp.recovery_as(scenario,a.member_id,'SELECT * FROM public.list_my_open_offering_movement_availabilities()');
    PERFORM pg_temp.recovery_check(scenario||' cannot execute',r->>'state'='42501');
  END LOOP;
  PERFORM pg_temp.recovery_check('PUBLIC cannot execute',NOT EXISTS(
    SELECT 1 FROM pg_proc p, LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
    WHERE p.oid='public.list_my_open_offering_movement_availabilities(integer)'::regprocedure
    AND acl.grantee=0 AND acl.privilege_type='EXECUTE'));

  FOREACH scenario IN ARRAY ARRAY['withdrawn','unavailable','full_zero_remaining','revoked_access','vehicle_capacity','stale_intent','stale_route'] LOOP
    BEGIN
      CASE scenario
        WHEN 'withdrawn' THEN UPDATE private.offering_movement_availability SET status='withdrawn' WHERE id=a.availability_id;
        WHEN 'unavailable' THEN UPDATE private.offering_movement_availability SET status='unavailable' WHERE id=a.availability_id;
        WHEN 'full_zero_remaining' THEN UPDATE private.offering_movement_availability SET status='full',remaining_places=0 WHERE id=a.availability_id;
        WHEN 'revoked_access' THEN UPDATE public.member_vehicle_access SET active=false WHERE member_id=a.member_id AND vehicle_id=a.vehicle_id;
        WHEN 'vehicle_capacity' THEN UPDATE public.vehicles SET seat_capacity=1 WHERE id=a.vehicle_id;
        WHEN 'stale_intent' THEN UPDATE private.offering_movement_intents SET status='superseded' WHERE id=a.intent_id;
        WHEN 'stale_route' THEN UPDATE private.offering_route_evidence SET status='superseded' WHERE id=a.route_id;
      END CASE;
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) INTO before_rows FROM private.offering_movement_availability x;
      r := pg_temp.recovery_list(a.member_id,1);
      passed := r->>'ok'='true' AND jsonb_array_length(r->'rows')=1 AND r#>>'{rows,0,availability_id}'=b.availability_id::text;
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) INTO after_rows FROM private.offering_movement_availability x;
      RAISE SQLSTATE 'ZT054';
    EXCEPTION WHEN SQLSTATE 'ZT054' THEN NULL;
    END;
    PERFORM pg_temp.recovery_check('ineligible skipped before limit: '||scenario,passed,r::text);
    PERFORM pg_temp.recovery_check('read leaves availability unchanged: '||scenario,before_rows=after_rows);
  END LOOP;
  PERFORM pg_temp.recovery_check('scenario subtransactions restored eligible rows',pg_temp.recovery_list(a.member_id)=baseline);
  SELECT * INTO short_a FROM pg_temp.recovery_offering_fixture('short',3,interval '2 seconds',a.member_id);
  PERFORM pg_sleep(2.1);
  PERFORM pg_temp.recovery_check('elapsed expiry skipped without changing open status',
    pg_temp.recovery_list(a.member_id)=baseline AND (SELECT status='open' FROM private.offering_movement_availability WHERE id=short_a.availability_id));
  UPDATE private.offering_movement_availability SET status='expired' WHERE id=short_a.availability_id;
  PERFORM pg_temp.recovery_check('explicit expired excluded',pg_temp.recovery_list(a.member_id)=baseline);
END;
$test$;

TABLE pg_temp.recovery_results;
DO $results$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_temp.recovery_results WHERE NOT passed)
     OR (SELECT count(*) FROM pg_temp.recovery_results) <> 35 THEN
    RAISE EXCEPTION '0054 recovery behavioral checks failed or missing';
  END IF;
END;
$results$;
SELECT count(*) AS passed_checks FROM pg_temp.recovery_results WHERE passed;
ROLLBACK;
