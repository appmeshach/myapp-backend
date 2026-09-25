BEGIN;

SET TRANSACTION ISOLATION LEVEL READ COMMITTED;


-- =========================================================
-- Results
-- =========================================================

CREATE TEMP TABLE pg_temp.requester_availability_matching_results (
  test_number integer GENERATED ALWAYS AS IDENTITY,
  test_name text NOT NULL UNIQUE,
  passed boolean NOT NULL,
  diagnostic text
) ON COMMIT DROP;


CREATE FUNCTION pg_temp.requester_availability_matching_check(
  p_name text,
  p_passed boolean,
  p_diagnostic text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $check$
BEGIN
  INSERT INTO pg_temp.requester_availability_matching_results(
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
ON FUNCTION pg_temp.requester_availability_matching_check(
  text,
  boolean,
  text
)
FROM PUBLIC;


-- =========================================================
-- Execute one SELECT as a simulated API role/member
-- =========================================================

CREATE FUNCTION pg_temp.requester_availability_matching_as(
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
ON FUNCTION pg_temp.requester_availability_matching_as(
  text,
  uuid,
  text
)
FROM PUBLIC;


-- =========================================================
-- Trusted offering fixture
-- =========================================================

CREATE FUNCTION pg_temp.requester_availability_offering_fixture(
  p_label text,
  p_total_places integer DEFAULT 3,
  p_departure interval DEFAULT interval '1 hour'
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
  m uuid := gen_random_uuid();
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
    m::text || '@test-0046-offerer.invalid',
    clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    clock_timestamp(),
    clock_timestamp()
  );


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
    pg_temp.requester_availability_matching_as(
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
      '0046 offering fixture intent failed: %',
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
    'T0046-' || left(v::text, 8)
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
    pg_temp.requester_availability_matching_as(
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
      '0046 offering fixture availability failed: %',
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


-- =========================================================
-- Trusted requester fixture
-- =========================================================

CREATE FUNCTION pg_temp.requester_availability_requester_fixture(
  p_label text,
  p_people_count integer DEFAULT 1
)
RETURNS TABLE (
  member_id uuid,
  movement_need_id uuid
)
LANGUAGE plpgsql
AS $fixture$
DECLARE
  m uuid := gen_random_uuid();

  source_id uuid;
  resolved_id uuid;

  endpoints uuid[] := ARRAY[]::uuid[];

  n integer;
  place text;

  r jsonb;
  need_id uuid;
BEGIN
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
    m::text || '@test-0046-requester.invalid',
    clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    clock_timestamp(),
    clock_timestamp()
  );


  FOR n IN 1..2 LOOP
    place :=
      p_label || '-requester-' || n;


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
        ELSE 'Ikeja, Lagos'
      END,
      CASE n
        WHEN 1 THEN 6.4300
        ELSE 6.6018
      END,
      CASE n
        WHEN 1 THEN 3.5200
        ELSE 3.3515
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
    pg_temp.requester_availability_matching_as(
      'authenticated',
      m,
      format(
        'SELECT *
         FROM public.create_movement_need(
           %L::uuid,
           %L::uuid,
           %L::uuid,
           %L::timestamptz,
           %L::timestamptz,
           %s
         )',
        gen_random_uuid(),
        endpoints[1],
        endpoints[2],
        clock_timestamp() + interval '45 minutes',
        clock_timestamp() + interval '2 hours',
        p_people_count
      )
    );


  need_id :=
    (
      r #>>
      '{rows,0,movement_need_id}'
    )::uuid;


  IF need_id IS NULL THEN
    RAISE EXCEPTION
      '0046 requester fixture need failed: %',
      r;
  END IF;


  RETURN QUERY
  SELECT
    m,
    need_id;
END;
$fixture$;


-- =========================================================
-- Behavioral matrix
-- =========================================================

DO $test$
<<requester_availability_matching_test>>
DECLARE
  offerer record;
  other_offerer record;
  requester record;
  other_requester record;
  large_group record;

  r jsonb;

  command text;
  scenario text;

  original_remaining integer;
  original_status text;

  route_id uuid;
  route_version integer;
  resolved_intent uuid;
  resolved_offerer uuid;
BEGIN
  SELECT *
  INTO offerer
  FROM pg_temp.requester_availability_offering_fixture(
    'primary',
    3
  );


  SELECT *
  INTO other_offerer
  FROM pg_temp.requester_availability_offering_fixture(
    'other',
    3
  );


  SELECT *
  INTO requester
  FROM pg_temp.requester_availability_requester_fixture(
    'primary',
    1
  );


  SELECT *
  INTO other_requester
  FROM pg_temp.requester_availability_requester_fixture(
    'other',
    1
  );


  SELECT *
  INTO large_group
  FROM pg_temp.requester_availability_requester_fixture(
    'large-group',
    3
  );


  command :=
    format(
      'SELECT *
       FROM public.get_requester_availability_matching_context_for_server(
         %L::uuid,
         %L::uuid,
         %L::uuid
       )',
      requester.member_id,
      requester.movement_need_id,
      offerer.availability_id
    );


  PERFORM pg_temp.requester_availability_matching_check(
    '01 trusted requester movement need exists',
    EXISTS (
      SELECT 1
      FROM public.movement_needs n
      WHERE n.id = requester.movement_need_id
        AND n.member_id = requester.member_id
        AND n.status = 'discoverable'
    )
  );


  PERFORM pg_temp.requester_availability_matching_check(
    '02 independent offerer intent route and availability exist',
    EXISTS (
      SELECT 1
      FROM private.offering_movement_availability a
      WHERE a.id = offerer.availability_id
        AND a.offering_movement_intent_id =
              offerer.intent_id
        AND a.offering_member_id =
              offerer.member_id
        AND a.route_evidence_id =
              offerer.route_id
        AND a.status = 'open'
        AND a.remaining_places = 3
    )
  );


  PERFORM pg_temp.requester_availability_matching_check(
    '03 requester availability matching RPC execute is service-only',
    has_function_privilege(
      'service_role',
      'public.get_requester_availability_matching_context_for_server(uuid,uuid,uuid)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'authenticated',
      'public.get_requester_availability_matching_context_for_server(uuid,uuid,uuid)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'anon',
      'public.get_requester_availability_matching_context_for_server(uuid,uuid,uuid)',
      'EXECUTE'
    )
  );


  r :=
    pg_temp.requester_availability_matching_as(
      'authenticated',
      requester.member_id,
      command
    );


  PERFORM pg_temp.requester_availability_matching_check(
    '04 authenticated client cannot invoke server RPC directly',
    r->>'ok' = 'false'
      AND r->>'state' = '42501',
    r::text
  );


  r :=
    pg_temp.requester_availability_matching_as(
      'anon',
      NULL,
      command
    );


  PERFORM pg_temp.requester_availability_matching_check(
    '05 anon cannot invoke server RPC directly',
    r->>'ok' = 'false'
      AND r->>'state' = '42501',
    r::text
  );


  r :=
    pg_temp.requester_availability_matching_as(
      'service_role',
      NULL,
      command
    );


  SELECT
    (
      r #>>
      '{rows,0,offering_movement_intent_id}'
    )::uuid,
    (
      r #>>
      '{rows,0,offering_member_id}'
    )::uuid,
    (
      r #>>
      '{rows,0,route_evidence_id}'
    )::uuid,
    (
      r #>>
      '{rows,0,route_evidence_version}'
    )::integer
  INTO
    resolved_intent,
    resolved_offerer,
    route_id,
    route_version;


  PERFORM pg_temp.requester_availability_matching_check(
    '06 requester owner is authorized through trusted server identity',
    r->>'ok' = 'true'
      AND jsonb_array_length(
        r->'rows'
      ) = 1
      AND (
        r #>>
        '{rows,0,movement_need_id}'
      )::uuid = requester.movement_need_id
      AND (
        r #>>
        '{rows,0,requesting_member_id}'
      )::uuid = requester.member_id,
    r::text
  );


  PERFORM pg_temp.requester_availability_matching_check(
    '07 availability privately resolves the exact hidden offering intent and member',
    resolved_intent = offerer.intent_id
      AND resolved_offerer = offerer.member_id,
    r::text
  );


  PERFORM pg_temp.requester_availability_matching_check(
    '08 returned trusted route exactly matches availability binding',
    route_id = offerer.route_id
      AND route_version = 1
      AND EXISTS (
        SELECT 1
        FROM private.offering_movement_availability a
        WHERE a.id = offerer.availability_id
          AND a.route_evidence_id = route_id
          AND a.route_evidence_version =
                route_version
      ),
    r::text
  );


  r :=
    pg_temp.requester_availability_matching_as(
      'service_role',
      NULL,
      format(
        'SELECT *
         FROM public.get_requester_availability_matching_context_for_server(
           %L::uuid,
           %L::uuid,
           %L::uuid
         )',
        other_requester.member_id,
        requester.movement_need_id,
        offerer.availability_id
      )
    );


  PERFORM pg_temp.requester_availability_matching_check(
    '09 unrelated member cannot spoof requester ownership',
    r->>'ok' = 'false'
      AND r->>'state' = '42501'
      AND r->>'message' =
        'Verified member does not own this movement need',
    r::text
  );


  r :=
    pg_temp.requester_availability_matching_as(
      'service_role',
      NULL,
      format(
        'SELECT *
         FROM public.get_requester_availability_matching_context_for_server(
           %L::uuid,
           %L::uuid,
           %L::uuid
         )',
        offerer.member_id,
        requester.movement_need_id,
        offerer.availability_id
      )
    );


  PERFORM pg_temp.requester_availability_matching_check(
    '10 offerer is not authorized through requester availability path',
    r->>'ok' = 'false'
      AND r->>'state' = '42501',
    r::text
  );


  r :=
    pg_temp.requester_availability_matching_as(
      'service_role',
      NULL,
      format(
        'SELECT *
         FROM public.get_requester_availability_matching_context_for_server(
           %L::uuid,
           %L::uuid,
           %L::uuid
         )',
        requester.member_id,
        requester.movement_need_id,
        gen_random_uuid()
      )
    );


  PERFORM pg_temp.requester_availability_matching_check(
    '11 missing availability rejected',
    r->>'ok' = 'false',
    r::text
  );


  -- An unrelated availability is resolved to its own trusted
  -- intent/route; it must never cross-bind to the first one.
  r :=
    pg_temp.requester_availability_matching_as(
      'service_role',
      NULL,
      format(
        'SELECT *
         FROM public.get_requester_availability_matching_context_for_server(
           %L::uuid,
           %L::uuid,
           %L::uuid
         )',
        requester.member_id,
        requester.movement_need_id,
        other_offerer.availability_id
      )
    );


  PERFORM pg_temp.requester_availability_matching_check(
    '12 another availability cannot cross-bind the first offering context',
    r->>'ok' = 'true'
      AND (
        r #>>
        '{rows,0,offering_movement_intent_id}'
      )::uuid = other_offerer.intent_id
      AND (
        r #>>
        '{rows,0,offering_member_id}'
      )::uuid = other_offerer.member_id
      AND (
        r #>>
        '{rows,0,route_evidence_id}'
      )::uuid = other_offerer.route_id
      AND (
        r #>>
        '{rows,0,offering_movement_intent_id}'
      )::uuid <> offerer.intent_id,
    r::text
  );


  -- =======================================================
  -- Hard availability eligibility scenarios
  -- =======================================================

  FOREACH scenario IN ARRAY ARRAY[
    'withdrawn',
    'full',
    'unavailable',
    'inactive access',
    'reduced vehicle capacity',
    'withdrawn intent',
    'superseded route'
  ]
  LOOP
    BEGIN
      CASE scenario
        WHEN 'withdrawn' THEN
          UPDATE private.offering_movement_availability
          SET status = 'withdrawn'
          WHERE id = offerer.availability_id;

        WHEN 'full' THEN
          UPDATE private.offering_movement_availability
          SET
            remaining_places = 0,
            status = 'full'
          WHERE id = offerer.availability_id;

        WHEN 'unavailable' THEN
          UPDATE private.offering_movement_availability
          SET status = 'unavailable'
          WHERE id = offerer.availability_id;

        WHEN 'inactive access' THEN
          UPDATE public.member_vehicle_access
          SET active = false
          WHERE member_id = offerer.member_id
            AND vehicle_id = offerer.vehicle_id;

        WHEN 'reduced vehicle capacity' THEN
          UPDATE public.vehicles
          SET seat_capacity = 2
          WHERE id = offerer.vehicle_id;

        WHEN 'withdrawn intent' THEN
          UPDATE private.offering_movement_intents
          SET status = 'withdrawn'
          WHERE id = offerer.intent_id;

        WHEN 'superseded route' THEN
          UPDATE private.offering_route_evidence
          SET status = 'superseded'
          WHERE id = offerer.route_id;
      END CASE;


      r :=
        pg_temp.requester_availability_matching_as(
          'service_role',
          NULL,
          command
        );


      IF r->>'ok' <> 'false' THEN
        RAISE EXCEPTION
          '0046 invalid availability scenario did not fail: % %',
          scenario,
          r;
      END IF;


      RAISE EXCEPTION USING
        ERRCODE = 'ZX046',
        MESSAGE =
          'rollback successful scenario';

    EXCEPTION
      WHEN SQLSTATE 'ZX046' THEN
        NULL;
    END;


    PERFORM pg_temp.requester_availability_matching_check(
      'invalid availability rejected: ' || scenario,
      true
    );
  END LOOP;


  -- =======================================================
  -- Complete requester group must fit
  -- =======================================================

  BEGIN
    UPDATE private.offering_movement_availability
    SET remaining_places = 2
    WHERE id = offerer.availability_id;


    r :=
      pg_temp.requester_availability_matching_as(
        'service_role',
        NULL,
        format(
          'SELECT *
           FROM public.get_requester_availability_matching_context_for_server(
             %L::uuid,
             %L::uuid,
             %L::uuid
           )',
          large_group.member_id,
          large_group.movement_need_id,
          offerer.availability_id
        )
      );


    IF r->>'ok' <> 'false'
       OR r->>'state' <> '23514'
       OR r->>'message'
            <> 'Availability cannot serve the complete requester group' THEN
      RAISE EXCEPTION
        '0046 incomplete group capacity was not rejected: %',
        r;
    END IF;


    RAISE EXCEPTION USING
      ERRCODE = 'ZX046',
      MESSAGE =
        'rollback successful group scenario';

  EXCEPTION
    WHEN SQLSTATE 'ZX046' THEN
      NULL;
  END;


  PERFORM pg_temp.requester_availability_matching_check(
    '20 complete requester group must fit remaining availability',
    true
  );


  -- =======================================================
  -- Lookup has no operational side effects
  -- =======================================================

  SELECT
    a.remaining_places,
    a.status
  INTO
    original_remaining,
    original_status
  FROM private.offering_movement_availability a
  WHERE a.id = offerer.availability_id;


  r :=
    pg_temp.requester_availability_matching_as(
      'service_role',
      NULL,
      command
    );


  PERFORM pg_temp.requester_availability_matching_check(
    '21 context lookup succeeds before side effect checks',
    r->>'ok' = 'true',
    r::text
  );


  PERFORM pg_temp.requester_availability_matching_check(
    '22 lookup alone creates no trusted route match evidence',
    NOT EXISTS (
      SELECT 1
      FROM private.trusted_route_match_evidence e
      WHERE e.movement_need_id =
              requester.movement_need_id
        AND e.offering_movement_intent_id =
              offerer.intent_id
    )
  );


  PERFORM pg_temp.requester_availability_matching_check(
    '23 lookup alone creates no movement offer',
    NOT EXISTS (
      SELECT 1
      FROM public.movement_offers o
      WHERE o.movement_need_id =
              requester.movement_need_id
    )
  );


  PERFORM pg_temp.requester_availability_matching_check(
    '24 lookup alone creates no alignment',
    NOT EXISTS (
      SELECT 1
      FROM public.alignments a
      WHERE a.movement_need_id =
              requester.movement_need_id
    )
  );


  PERFORM pg_temp.requester_availability_matching_check(
    '25 lookup does not decrement remaining places',
    EXISTS (
      SELECT 1
      FROM private.offering_movement_availability a
      WHERE a.id = offerer.availability_id
        AND a.remaining_places =
              original_remaining
    )
  );


  PERFORM pg_temp.requester_availability_matching_check(
    '26 lookup does not change availability status',
    EXISTS (
      SELECT 1
      FROM private.offering_movement_availability a
      WHERE a.id = offerer.availability_id
        AND a.status =
              original_status
    )
  );


  SET CONSTRAINTS ALL IMMEDIATE;
END;
$test$;


SELECT
  test_number,
  test_name,
  passed,
  diagnostic
FROM pg_temp.requester_availability_matching_results
ORDER BY test_number;


DO $verify$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_temp.requester_availability_matching_results
    WHERE NOT passed
  ) THEN
    RAISE EXCEPTION
      '0046 requester availability matching regression failed';
  END IF;
END;
$verify$;


ROLLBACK;