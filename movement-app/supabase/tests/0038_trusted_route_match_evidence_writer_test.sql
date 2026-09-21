BEGIN;

SET TRANSACTION ISOLATION LEVEL READ COMMITTED;


-- =========================================================
-- Results
-- =========================================================

CREATE TEMP TABLE pg_temp.route_match_writer_results (
  test_number integer GENERATED ALWAYS AS IDENTITY,
  test_name text NOT NULL UNIQUE,
  passed boolean NOT NULL,
  diagnostic text
) ON COMMIT DROP;


CREATE FUNCTION pg_temp.route_match_writer_check(
  p_name text,
  p_passed boolean,
  p_diagnostic text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $check$
BEGIN
  INSERT INTO pg_temp.route_match_writer_results(
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
ON FUNCTION pg_temp.route_match_writer_check(
  text,
  boolean,
  text
)
FROM PUBLIC;


-- =========================================================
-- Execute one SELECT as a simulated API role/member
-- =========================================================

CREATE FUNCTION pg_temp.route_match_writer_select_as(
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
ON FUNCTION pg_temp.route_match_writer_select_as(
  text,
  uuid,
  text
)
FROM PUBLIC;


-- =========================================================
-- Behavioral tests
-- =========================================================

DO $writer_test$
DECLARE
  requester_id uuid :=
    gen_random_uuid();

  offerer_id uuid :=
    gen_random_uuid();

  requester_request_id uuid :=
    gen_random_uuid();

  offerer_request_id uuid :=
    gen_random_uuid();

  requester_origin_id uuid;
  requester_destination_id uuid;

  offerer_origin_id uuid;
  offerer_destination_id uuid;

  v_movement_need_id uuid;
  offering_intent_id uuid;

  route_evidence_id_v1 uuid;
  route_evidence_id_v2 uuid;

  route_match_evidence_id_v1 uuid;
  route_match_evidence_id_v2 uuid;

  base_time timestamptz;

  departure_earliest timestamptz;
  departure_latest timestamptz;

  calculated_time_v1 timestamptz;
  calculated_time_v2 timestamptz;

  requested_expiry_v1 timestamptz;
  requested_expiry_v2 timestamptz;

  route_shape jsonb :=
    '{
      "type":"LineString",
      "coordinates":[
        [3.5852,6.4698],
        [3.5200,6.4300],
        [3.4900,6.4320],
        [3.4430,6.4310],
        [3.4219,6.4281]
      ]
    }'::jsonb;

  r jsonb;

  rejected boolean;
BEGIN

  -- =======================================================
  -- Members
  -- =======================================================

  base_time :=
    clock_timestamp();

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
  SELECT
    id,
    'authenticated',
    'authenticated',
    id::text || '@test-0038.invalid',
    base_time,
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    base_time,
    base_time
  FROM unnest(
    ARRAY[
      requester_id,
      offerer_id
    ]
  ) ids(id);


  PERFORM pg_temp.route_match_writer_check(
    '01 auth trigger created requester and offerer members',
    (
      SELECT count(*) = 2
      FROM public.members m
      WHERE m.id IN (
        requester_id,
        offerer_id
      )
    )
  );


  -- =======================================================
  -- Trusted requester locations
  -- =======================================================

  base_time :=
    clock_timestamp();

  INSERT INTO private.movement_location_references(
    owner_member_id,
    declared_label,
    source_kind,
    resolution_status,
    latitude,
    longitude,
    provider_namespace,
    provider_place_reference,
    resolution_version,
    created_at,
    resolved_at,
    expires_at
  )
  VALUES (
    requester_id,
    'Agungi, Lagos',
    'provider_resolved',
    'resolved',
    6.4300,
    3.5200,
    'test-provider',
    '0038-requester-origin',
    'test-resolution-v1',
    base_time,
    base_time,
    base_time + interval '4 hours'
  )
  RETURNING id
  INTO requester_origin_id;


  base_time :=
    clock_timestamp();

  INSERT INTO private.movement_location_references(
    owner_member_id,
    declared_label,
    source_kind,
    resolution_status,
    latitude,
    longitude,
    provider_namespace,
    provider_place_reference,
    resolution_version,
    created_at,
    resolved_at,
    expires_at
  )
  VALUES (
    requester_id,
    'Oniru, Lagos',
    'provider_resolved',
    'resolved',
    6.4310,
    3.4430,
    'test-provider',
    '0038-requester-destination',
    'test-resolution-v1',
    base_time,
    base_time,
    base_time + interval '4 hours'
  )
  RETURNING id
  INTO requester_destination_id;


  -- =======================================================
  -- Trusted offerer locations
  -- =======================================================

  base_time :=
    clock_timestamp();

  INSERT INTO private.movement_location_references(
    owner_member_id,
    declared_label,
    source_kind,
    resolution_status,
    latitude,
    longitude,
    provider_namespace,
    provider_place_reference,
    resolution_version,
    created_at,
    resolved_at,
    expires_at
  )
  VALUES (
    offerer_id,
    'Ajah, Lagos',
    'provider_resolved',
    'resolved',
    6.4698,
    3.5852,
    'test-provider',
    '0038-offerer-origin',
    'test-resolution-v1',
    base_time,
    base_time,
    base_time + interval '4 hours'
  )
  RETURNING id
  INTO offerer_origin_id;


  base_time :=
    clock_timestamp();

  INSERT INTO private.movement_location_references(
    owner_member_id,
    declared_label,
    source_kind,
    resolution_status,
    latitude,
    longitude,
    provider_namespace,
    provider_place_reference,
    resolution_version,
    created_at,
    resolved_at,
    expires_at
  )
  VALUES (
    offerer_id,
    'Victoria Island, Lagos',
    'provider_resolved',
    'resolved',
    6.4281,
    3.4219,
    'test-provider',
    '0038-offerer-destination',
    'test-resolution-v1',
    base_time,
    base_time,
    base_time + interval '4 hours'
  )
  RETURNING id
  INTO offerer_destination_id;


  -- =======================================================
  -- Trusted requester movement need through 0035
  -- =======================================================

  departure_earliest :=
    statement_timestamp()
      + interval '1 hour';

  departure_latest :=
    statement_timestamp()
      + interval '2 hours';


  r :=
    pg_temp.route_match_writer_select_as(
      'authenticated',
      requester_id,
      format(
        'SELECT *
         FROM public.create_movement_need(
           %L::uuid,
           %L::uuid,
           %L::uuid,
           %L::timestamptz,
           %L::timestamptz,
           1
         )',
        requester_request_id,
        requester_origin_id,
        requester_destination_id,
        departure_earliest,
        departure_latest
      )
    );


  v_movement_need_id :=
    (
      r #>>
        '{rows,0,movement_need_id}'
    )::uuid;


  PERFORM pg_temp.route_match_writer_check(
    '02 requester trusted movement need created',
    r->>'ok' = 'true'
      AND v_movement_need_id IS NOT NULL,
    r::text
  );


  -- =======================================================
  -- Independent offerer movement intent through 0034
  -- =======================================================

  r :=
    pg_temp.route_match_writer_select_as(
      'authenticated',
      offerer_id,
      format(
        'SELECT *
         FROM public.create_offering_movement_intent(
           %L::uuid,
           %L::uuid,
           %L::uuid,
           %L::timestamptz,
           %L::timestamptz
         )',
        offerer_request_id,
        offerer_origin_id,
        offerer_destination_id,
        departure_earliest,
        departure_latest
      )
    );


  offering_intent_id :=
    (
      r #>>
        '{rows,0,offering_movement_intent_id}'
    )::uuid;


  PERFORM pg_temp.route_match_writer_check(
    '03 offerer trusted independent movement intent created',
    r->>'ok' = 'true'
      AND offering_intent_id IS NOT NULL,
    r::text
  );


  -- =======================================================
  -- Trusted route evidence v1 through 0025
  -- =======================================================

  base_time :=
    clock_timestamp();


  r :=
    pg_temp.route_match_writer_select_as(
      'service_role',
      NULL,
      format(
        'SELECT *
         FROM public.record_offering_route_evidence_for_server(
           %L::uuid,
           ''test-router'',
           ''directions'',
           ''v1'',
           ''0038-route-1'',
           %L::jsonb,
           18000,
           2400,
           %L::timestamptz,
           %L::timestamptz
         )',
        offering_intent_id,
        route_shape::text,
        base_time,
        base_time + interval '3 hours'
      )
    );


  route_evidence_id_v1 :=
    (
      r #>>
        '{rows,0,route_evidence_id}'
    )::uuid;


  PERFORM pg_temp.route_match_writer_check(
    '04 trusted offering route evidence v1 recorded',
    r->>'ok' = 'true'
      AND route_evidence_id_v1 IS NOT NULL
      AND
        r #>>
          '{rows,0,route_evidence_version}'
        = '1',
    r::text
  );


  -- =======================================================
  -- Writer privilege boundary
  -- =======================================================

  PERFORM pg_temp.route_match_writer_check(
    '05 route-match writer execute is service-only',
    has_function_privilege(
      'service_role',
      'public.record_trusted_route_match_evidence_for_server(uuid,uuid,uuid,integer,bigint,bigint,bigint,bigint,bigint,numeric,numeric,numeric,numeric,timestamptz,timestamptz)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'authenticated',
      'public.record_trusted_route_match_evidence_for_server(uuid,uuid,uuid,integer,bigint,bigint,bigint,bigint,bigint,numeric,numeric,numeric,numeric,timestamptz,timestamptz)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'anon',
      'public.record_trusted_route_match_evidence_for_server(uuid,uuid,uuid,integer,bigint,bigint,bigint,bigint,bigint,numeric,numeric,numeric,numeric,timestamptz,timestamptz)',
      'EXECUTE'
    )
    AND NOT has_table_privilege(
      'service_role',
      'private.trusted_route_match_evidence',
      'INSERT'
    )
    AND NOT has_table_privilege(
      'service_role',
      'private.trusted_route_match_evidence',
      'UPDATE'
    )
    AND NOT has_table_privilege(
      'service_role',
      'private.trusted_route_match_evidence',
      'DELETE'
    )
  );


  -- =======================================================
  -- Authenticated and anon cannot invoke writer
  -- =======================================================

  calculated_time_v1 :=
    clock_timestamp();

  requested_expiry_v1 :=
    calculated_time_v1
      + interval '2 hours';


  r :=
    pg_temp.route_match_writer_select_as(
      'authenticated',
      offerer_id,
      format(
        'SELECT *
         FROM public.record_trusted_route_match_evidence_for_server(
           %L::uuid,
           %L::uuid,
           %L::uuid,
           1,
           250000,
           400000,
           18000,
           1000,
           12000,
           6.4300,
           3.5200,
           6.4310,
           3.4430,
           %L::timestamptz,
           %L::timestamptz
         )',
        v_movement_need_id,
        offering_intent_id,
        route_evidence_id_v1,
        calculated_time_v1,
        requested_expiry_v1
      )
    );


  PERFORM pg_temp.route_match_writer_check(
    '06 authenticated cannot invoke route-match writer',
    r->>'ok' = 'false'
      AND r->>'state' = '42501',
    r::text
  );


  r :=
    pg_temp.route_match_writer_select_as(
      'anon',
      NULL,
      format(
        'SELECT *
         FROM public.record_trusted_route_match_evidence_for_server(
           %L::uuid,
           %L::uuid,
           %L::uuid,
           1,
           250000,
           400000,
           18000,
           1000,
           12000,
           6.4300,
           3.5200,
           6.4310,
           3.4430,
           %L::timestamptz,
           %L::timestamptz
         )',
        v_movement_need_id,
        offering_intent_id,
        route_evidence_id_v1,
        calculated_time_v1,
        requested_expiry_v1
      )
    );


  PERFORM pg_temp.route_match_writer_check(
    '07 anon cannot invoke route-match writer',
    r->>'ok' = 'false'
      AND r->>'state' = '42501',
    r::text
  );


  -- =======================================================
  -- Valid server write
  --
  -- Distances are intentionally very large.
  -- There is no maximum-detour rejection rule.
  -- =======================================================

  r :=
    pg_temp.route_match_writer_select_as(
      'service_role',
      NULL,
      format(
        'SELECT *
         FROM public.record_trusted_route_match_evidence_for_server(
           %L::uuid,
           %L::uuid,
           %L::uuid,
           1,
           250000,
           400000,
           18000,
           1000,
           12000,
           6.4300,
           3.5200,
           6.4310,
           3.4430,
           %L::timestamptz,
           %L::timestamptz
         )',
        v_movement_need_id,
        offering_intent_id,
        route_evidence_id_v1,
        calculated_time_v1,
        requested_expiry_v1
      )
    );


  route_match_evidence_id_v1 :=
    (
      r #>>
        '{rows,0,route_match_evidence_id}'
    )::uuid;


  PERFORM pg_temp.route_match_writer_check(
    '08 service writer records large objective distances without a maximum-detour rule',
    r->>'ok' = 'true'
      AND route_match_evidence_id_v1
        IS NOT NULL
      AND
        r #>>
          '{rows,0,route_match_evidence_version}'
        = '1'
      AND
        r #>>
          '{rows,0,route_match_evidence_status}'
        = 'current'
      AND EXISTS (
        SELECT 1
        FROM private.trusted_route_match_evidence e
        WHERE e.id =
          route_match_evidence_id_v1
          AND e.requester_origin_distance_to_route_meters
            = 250000
          AND e.requester_destination_distance_to_route_meters
            = 400000
      ),
    r::text
  );


  -- =======================================================
  -- Database derives authoritative identities and versions
  -- =======================================================

  PERFORM pg_temp.route_match_writer_check(
    '09 writer derives trusted members endpoints intent version and route version',
    EXISTS (
      SELECT 1
      FROM private.trusted_route_match_evidence e
      WHERE e.id =
        route_match_evidence_id_v1

        AND e.movement_need_id =
          v_movement_need_id

        AND e.requesting_member_id =
          requester_id

        AND e.requester_origin_location_reference_id =
          requester_origin_id

        AND e.requester_destination_location_reference_id =
          requester_destination_id

        AND e.offering_member_id =
          offerer_id

        AND e.offering_movement_intent_id =
          offering_intent_id

        AND e.offering_intent_version =
          1

        AND e.route_evidence_id =
          route_evidence_id_v1

        AND e.route_evidence_version =
          1

        AND e.version =
          1

        AND e.evidence_schema_version =
          'trusted_route_match_evidence_v1'

        AND e.algorithm_version =
          'route_match_geometry_v1'

        AND e.route_order =
          'forward'
    )
  );


  -- =======================================================
  -- Requested expiry is respected when it is the earliest
  -- dependency
  -- =======================================================

  PERFORM pg_temp.route_match_writer_check(
    '10 writer stores dependency-bounded expiry',
    (
      SELECT e.expires_at =
        requested_expiry_v1
      FROM private.trusted_route_match_evidence e
      WHERE e.id =
        route_match_evidence_id_v1
    )
  );


  -- =======================================================
  -- Exact replay is idempotent
  -- =======================================================

  r :=
    pg_temp.route_match_writer_select_as(
      'service_role',
      NULL,
      format(
        'SELECT *
         FROM public.record_trusted_route_match_evidence_for_server(
           %L::uuid,
           %L::uuid,
           %L::uuid,
           1,
           250000,
           400000,
           18000,
           1000,
           12000,
           6.4300,
           3.5200,
           6.4310,
           3.4430,
           %L::timestamptz,
           %L::timestamptz
         )',
        v_movement_need_id,
        offering_intent_id,
        route_evidence_id_v1,
        calculated_time_v1,
        requested_expiry_v1
      )
    );


  PERFORM pg_temp.route_match_writer_check(
    '11 exact replay returns original route-match evidence',
    r->>'ok' = 'true'
      AND (
        r #>>
          '{rows,0,route_match_evidence_id}'
      )::uuid =
        route_match_evidence_id_v1
      AND
        r #>>
          '{rows,0,route_match_evidence_version}'
        = '1'
      AND (
        SELECT count(*) = 1
        FROM private.trusted_route_match_evidence e
        WHERE e.movement_need_id =
          v_movement_need_id
          AND e.offering_movement_intent_id =
            offering_intent_id
      ),
    r::text
  );


  -- =======================================================
  -- Same trusted route identity with changed facts is not
  -- an idempotent replay
  -- =======================================================

  r :=
    pg_temp.route_match_writer_select_as(
      'service_role',
      NULL,
      format(
        'SELECT *
         FROM public.record_trusted_route_match_evidence_for_server(
           %L::uuid,
           %L::uuid,
           %L::uuid,
           1,
           250001,
           400000,
           18000,
           1000,
           12000,
           6.4300,
           3.5200,
           6.4310,
           3.4430,
           %L::timestamptz,
           %L::timestamptz
         )',
        v_movement_need_id,
        offering_intent_id,
        route_evidence_id_v1,
        calculated_time_v1,
        requested_expiry_v1
      )
    );


  PERFORM pg_temp.route_match_writer_check(
    '12 mismatched replay payload fails closed',
    r->>'ok' = 'false'
      AND r->>'state' = '23514'
      AND (
        SELECT count(*) = 1
        FROM private.trusted_route_match_evidence e
        WHERE e.movement_need_id =
          v_movement_need_id
          AND e.offering_movement_intent_id =
            offering_intent_id
      ),
    r::text
  );


  -- =======================================================
  -- Expected trusted route identity must match current
  -- =======================================================

  r :=
    pg_temp.route_match_writer_select_as(
      'service_role',
      NULL,
      format(
        'SELECT *
         FROM public.record_trusted_route_match_evidence_for_server(
           %L::uuid,
           %L::uuid,
           %L::uuid,
           99,
           250000,
           400000,
           18000,
           1000,
           12000,
           6.4300,
           3.5200,
           6.4310,
           3.4430,
           %L::timestamptz,
           %L::timestamptz
         )',
        v_movement_need_id,
        offering_intent_id,
        route_evidence_id_v1,
        calculated_time_v1,
        requested_expiry_v1
      )
    );


  PERFORM pg_temp.route_match_writer_check(
    '13 writer rejects stale or mismatched expected route identity',
    r->>'ok' = 'false'
      AND r->>'state' = '23514'
      AND r->>'message'
        = 'Trusted route-match calculation route is no longer current',
    r::text
  );


  -- =======================================================
  -- A new trusted route version produces a new route-match
  -- evidence version and supersedes the old current version
  -- =======================================================

  base_time :=
    clock_timestamp();


  r :=
    pg_temp.route_match_writer_select_as(
      'service_role',
      NULL,
      format(
        'SELECT *
         FROM public.record_offering_route_evidence_for_server(
           %L::uuid,
           ''test-router'',
           ''directions'',
           ''v1'',
           ''0038-route-2'',
           %L::jsonb,
           18100,
           2410,
           %L::timestamptz,
           %L::timestamptz
         )',
        offering_intent_id,
        route_shape::text,
        base_time,
        base_time + interval '3 hours'
      )
    );


  route_evidence_id_v2 :=
    (
      r #>>
        '{rows,0,route_evidence_id}'
    )::uuid;


  PERFORM pg_temp.route_match_writer_check(
    '14 trusted offering route evidence v2 supersedes v1',
    r->>'ok' = 'true'
      AND route_evidence_id_v2 IS NOT NULL
      AND route_evidence_id_v2 <>
        route_evidence_id_v1
      AND
        r #>>
          '{rows,0,route_evidence_version}'
        = '2'
      AND (
        SELECT e.status =
          'superseded'
        FROM private.offering_route_evidence e
        WHERE e.id =
          route_evidence_id_v1
      ),
    r::text
  );


  calculated_time_v2 :=
    clock_timestamp();

  requested_expiry_v2 :=
    calculated_time_v2
      + interval '2 hours';


  r :=
    pg_temp.route_match_writer_select_as(
      'service_role',
      NULL,
      format(
        'SELECT *
         FROM public.record_trusted_route_match_evidence_for_server(
           %L::uuid,
           %L::uuid,
           %L::uuid,
           2,
           240000,
           390000,
           18100,
           900,
           12100,
           6.4301,
           3.5201,
           6.4311,
           3.4431,
           %L::timestamptz,
           %L::timestamptz
         )',
        v_movement_need_id,
        offering_intent_id,
        route_evidence_id_v2,
        calculated_time_v2,
        requested_expiry_v2
      )
    );


  route_match_evidence_id_v2 :=
    (
      r #>>
        '{rows,0,route_match_evidence_id}'
    )::uuid;


  PERFORM pg_temp.route_match_writer_check(
    '15 new trusted route creates route-match version two and supersedes version one',
    r->>'ok' = 'true'
      AND route_match_evidence_id_v2
        IS NOT NULL
      AND route_match_evidence_id_v2
        <> route_match_evidence_id_v1
      AND
        r #>>
          '{rows,0,route_match_evidence_version}'
        = '2'
      AND EXISTS (
        SELECT 1
        FROM private.trusted_route_match_evidence e
        WHERE e.id =
          route_match_evidence_id_v1
          AND e.version = 1
          AND e.status = 'superseded'
      )
      AND EXISTS (
        SELECT 1
        FROM private.trusted_route_match_evidence e
        WHERE e.id =
          route_match_evidence_id_v2
          AND e.version = 2
          AND e.status = 'current'
          AND e.route_evidence_id =
            route_evidence_id_v2
          AND e.route_evidence_version = 2
      ),
    r::text
  );


  -- =======================================================
  -- Writer does not create operational movement state
  -- =======================================================

  PERFORM pg_temp.route_match_writer_check(
    '16 route-match writer creates no alignment or journey',
    NOT EXISTS (
      SELECT 1
      FROM public.alignments a
      WHERE a.movement_need_id =
        v_movement_need_id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.journeys j
      JOIN public.alignments a
        ON a.id = j.alignment_id
      WHERE a.movement_need_id =
        v_movement_need_id
    )
  );

END;
$writer_test$;


-- =========================================================
-- Results
-- =========================================================

TABLE pg_temp.route_match_writer_results;


DO $assert$
DECLARE
  failed_count integer;
BEGIN
  SELECT count(*)
  INTO failed_count
  FROM pg_temp.route_match_writer_results
  WHERE NOT passed;

  IF failed_count <> 0 THEN
    RAISE EXCEPTION
      '0038 trusted route-match writer tests failed: %',
      failed_count;
  END IF;
END;
$assert$;


ROLLBACK;