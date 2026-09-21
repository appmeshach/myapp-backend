BEGIN;

SET TRANSACTION ISOLATION LEVEL READ COMMITTED;


-- =========================================================
-- Results
-- =========================================================

CREATE TEMP TABLE pg_temp.route_match_results (
  test_number integer GENERATED ALWAYS AS IDENTITY,
  test_name text NOT NULL UNIQUE,
  passed boolean NOT NULL,
  diagnostic text
) ON COMMIT DROP;


CREATE FUNCTION pg_temp.route_match_check(
  p_name text,
  p_passed boolean,
  p_diagnostic text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $check$
BEGIN
  INSERT INTO pg_temp.route_match_results(
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
ON FUNCTION pg_temp.route_match_check(
  text,
  boolean,
  text
)
FROM PUBLIC;


-- =========================================================
-- Execute one SELECT as a simulated API role/member
-- =========================================================

CREATE FUNCTION pg_temp.route_match_select_as(
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

  previous_role := current_setting('role');

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

    result_json := jsonb_build_object(
      'ok', true,
      'rows', rows_json
    );

  EXCEPTION
    WHEN OTHERS THEN
      result_json := jsonb_build_object(
        'ok', false,
        'state', SQLSTATE,
        'message', SQLERRM
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
ON FUNCTION pg_temp.route_match_select_as(
  text,
  uuid,
  text
)
FROM PUBLIC;


-- =========================================================
-- Execute one non-query statement as a simulated API role
-- =========================================================

CREATE FUNCTION pg_temp.route_match_exec_as(
  p_role text,
  p_member_id uuid,
  p_sql text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $exec_as$
DECLARE
  previous_role text;
  previous_sub text;
  previous_jwt_role text;
  previous_claims text;

  result_json jsonb;
BEGIN
  IF p_role NOT IN (
    'authenticated',
    'anon',
    'service_role'
  ) THEN
    RAISE EXCEPTION 'Unsupported test role';
  END IF;

  previous_role := current_setting('role');

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
    EXECUTE p_sql;

    result_json := jsonb_build_object(
      'ok', true
    );

  EXCEPTION
    WHEN OTHERS THEN
      result_json := jsonb_build_object(
        'ok', false,
        'state', SQLSTATE,
        'message', SQLERRM
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
$exec_as$;


REVOKE ALL
ON FUNCTION pg_temp.route_match_exec_as(
  text,
  uuid,
  text
)
FROM PUBLIC;


-- =========================================================
-- Behavioral tests
-- =========================================================

DO $test$
DECLARE
  requester_id uuid := gen_random_uuid();
  offerer_id uuid := gen_random_uuid();

  requester_request_id uuid := gen_random_uuid();
  offerer_request_id uuid := gen_random_uuid();

  requester_origin_id uuid;
  requester_destination_id uuid;

  offerer_origin_id uuid;
  offerer_destination_id uuid;

  movement_need_id uuid;
  offering_intent_id uuid;
  route_evidence_id uuid;
  route_match_evidence_id uuid;

  base_time timestamptz;
  departure_earliest timestamptz;
  departure_latest timestamptz;
  calculated_time timestamptz;

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

  base_time := clock_timestamp();

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
    id::text || '@test-0037.invalid',
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


  PERFORM pg_temp.route_match_check(
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

  base_time := clock_timestamp();

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
    '0037-requester-origin',
    'test-resolution-v1',
    base_time,
    base_time,
    base_time + interval '4 hours'
  )
  RETURNING id
  INTO requester_origin_id;


  base_time := clock_timestamp();

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
    '0037-requester-destination',
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

  base_time := clock_timestamp();

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
    '0037-offerer-origin',
    'test-resolution-v1',
    base_time,
    base_time,
    base_time + interval '4 hours'
  )
  RETURNING id
  INTO offerer_origin_id;


  base_time := clock_timestamp();

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
    '0037-offerer-destination',
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
    statement_timestamp() + interval '1 hour';

  departure_latest :=
    statement_timestamp() + interval '2 hours';


  r := pg_temp.route_match_select_as(
    'authenticated',
    requester_id,
    format(
      'SELECT * FROM public.create_movement_need(
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


  movement_need_id :=
    (r #>> '{rows,0,movement_need_id}')::uuid;


  PERFORM pg_temp.route_match_check(
    '02 requester trusted movement need created',
    r->>'ok' = 'true'
      AND movement_need_id IS NOT NULL,
    r::text
  );


  -- =======================================================
  -- Independent offerer movement intent through 0034
  -- =======================================================

  r := pg_temp.route_match_select_as(
    'authenticated',
    offerer_id,
    format(
      'SELECT * FROM public.create_offering_movement_intent(
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


  PERFORM pg_temp.route_match_check(
    '03 offerer trusted independent movement intent created',
    r->>'ok' = 'true'
      AND offering_intent_id IS NOT NULL,
    r::text
  );


  -- =======================================================
  -- Trusted route evidence through existing server writer
  -- =======================================================

  base_time := clock_timestamp();

  r := pg_temp.route_match_select_as(
    'service_role',
    NULL,
    format(
      'SELECT *
       FROM public.record_offering_route_evidence_for_server(
         %L::uuid,
         ''test-router'',
         ''directions'',
         ''v1'',
         ''0037-route-1'',
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


  route_evidence_id :=
    (
      r #>>
        '{rows,0,route_evidence_id}'
    )::uuid;


  PERFORM pg_temp.route_match_check(
    '04 trusted offering route evidence recorded',
    r->>'ok' = 'true'
      AND route_evidence_id IS NOT NULL
      AND r #>> '{rows,0,route_evidence_version}' = '1',
    r::text
  );


  -- =======================================================
  -- Static privilege boundary
  -- =======================================================

  PERFORM pg_temp.route_match_check(
    '05 route-match evidence is service-read-only and client-private',
    has_table_privilege(
      'service_role',
      'private.trusted_route_match_evidence',
      'SELECT'
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
    AND NOT has_table_privilege(
      'authenticated',
      'private.trusted_route_match_evidence',
      'SELECT'
    )
    AND NOT has_table_privilege(
      'anon',
      'private.trusted_route_match_evidence',
      'SELECT'
    )
    AND NOT has_function_privilege(
      'service_role',
      'private.protect_trusted_route_match_evidence()',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'authenticated',
      'private.protect_trusted_route_match_evidence()',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'anon',
      'private.protect_trusted_route_match_evidence()',
      'EXECUTE'
    )
  );


  -- =======================================================
  -- Actual direct mutation denial
  -- =======================================================

  r := pg_temp.route_match_exec_as(
    'authenticated',
    offerer_id,
    'INSERT INTO private.trusted_route_match_evidence DEFAULT VALUES'
  );

  PERFORM pg_temp.route_match_check(
    '06 authenticated cannot directly insert route-match evidence',
    r->>'ok' = 'false'
      AND r->>'state' = '42501',
    r::text
  );


  r := pg_temp.route_match_exec_as(
    'anon',
    NULL,
    'INSERT INTO private.trusted_route_match_evidence DEFAULT VALUES'
  );

  PERFORM pg_temp.route_match_check(
    '07 anon cannot directly insert route-match evidence',
    r->>'ok' = 'false'
      AND r->>'state' = '42501',
    r::text
  );


  r := pg_temp.route_match_exec_as(
    'service_role',
    NULL,
    'INSERT INTO private.trusted_route_match_evidence DEFAULT VALUES'
  );

  PERFORM pg_temp.route_match_check(
    '08 service role cannot bypass future reviewed writer',
    r->>'ok' = 'false'
      AND r->>'state' = '42501',
    r::text
  );


  -- =======================================================
  -- Valid objective evidence
  --
  -- Distances are intentionally very large. There is no
  -- maximum-detour or maximum-distance acceptance rule.
  -- =======================================================

  calculated_time := clock_timestamp();

  INSERT INTO private.trusted_route_match_evidence(
    movement_need_id,
    requesting_member_id,
    requester_origin_location_reference_id,
    requester_destination_location_reference_id,
    offering_member_id,
    offering_movement_intent_id,
    offering_intent_version,
    route_evidence_id,
    route_evidence_version,
    version,
    evidence_schema_version,
    algorithm_version,
    requester_origin_distance_to_route_meters,
    requester_destination_distance_to_route_meters,
    calculated_route_shape_length_meters,
    requester_origin_position_along_route_meters,
    requester_destination_position_along_route_meters,
    requester_origin_closest_route_latitude,
    requester_origin_closest_route_longitude,
    requester_destination_closest_route_latitude,
    requester_destination_closest_route_longitude,
    route_order,
    calculated_at,
    expires_at,
    status
  )
  VALUES (
    movement_need_id,
    requester_id,
    requester_origin_id,
    requester_destination_id,
    offerer_id,
    offering_intent_id,
    1,
    route_evidence_id,
    1,
    1,
    'trusted_route_match_evidence_v1',
    'route_match_geometry_v1',
    250000,
    400000,
    18000,
    1000,
    12000,
    6.4300,
    3.5200,
    6.4310,
    3.4430,
    'forward',
    calculated_time,
    calculated_time + interval '2 hours',
    'current'
  )
  RETURNING id
  INTO route_match_evidence_id;


  -- Force the deferred cross-table integrity validator to run
  -- now so this test proves the valid evidence really matches
  -- the trusted requester/offerer/route context.
  SET CONSTRAINTS
    private.trusted_route_match_evidence_complete
    IMMEDIATE;

  SET CONSTRAINTS
    private.trusted_route_match_evidence_complete
    DEFERRED;


  PERFORM pg_temp.route_match_check(
    '09 large requester distances are accepted as facts without a maximum-detour rule',
    route_match_evidence_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM private.trusted_route_match_evidence e
        WHERE e.id = route_match_evidence_id
          AND e.requester_origin_distance_to_route_meters = 250000
          AND e.requester_destination_distance_to_route_meters = 400000
          AND e.status = 'current'
      )
  );


  PERFORM pg_temp.route_match_check(
    '10 objective route positions and order are preserved',
    EXISTS (
      SELECT 1
      FROM private.trusted_route_match_evidence e
      WHERE e.id = route_match_evidence_id
        AND e.calculated_route_shape_length_meters = 18000
        AND e.requester_origin_position_along_route_meters = 1000
        AND e.requester_destination_position_along_route_meters = 12000
        AND e.route_order = 'forward'
    )
  );


  -- =======================================================
  -- Evidence must start current
  -- =======================================================

  rejected := false;

  BEGIN
    INSERT INTO private.trusted_route_match_evidence(
      movement_need_id,
      requesting_member_id,
      requester_origin_location_reference_id,
      requester_destination_location_reference_id,
      offering_member_id,
      offering_movement_intent_id,
      offering_intent_version,
      route_evidence_id,
      route_evidence_version,
      version,
      evidence_schema_version,
      algorithm_version,
      requester_origin_distance_to_route_meters,
      requester_destination_distance_to_route_meters,
      calculated_route_shape_length_meters,
      requester_origin_position_along_route_meters,
      requester_destination_position_along_route_meters,
      requester_origin_closest_route_latitude,
      requester_origin_closest_route_longitude,
      requester_destination_closest_route_latitude,
      requester_destination_closest_route_longitude,
      route_order,
      calculated_at,
      expires_at,
      status
    )
    SELECT
      e.movement_need_id,
      e.requesting_member_id,
      e.requester_origin_location_reference_id,
      e.requester_destination_location_reference_id,
      e.offering_member_id,
      e.offering_movement_intent_id,
      e.offering_intent_version,
      e.route_evidence_id,
      e.route_evidence_version,
      2,
      e.evidence_schema_version,
      e.algorithm_version,
      e.requester_origin_distance_to_route_meters,
      e.requester_destination_distance_to_route_meters,
      e.calculated_route_shape_length_meters,
      e.requester_origin_position_along_route_meters,
      e.requester_destination_position_along_route_meters,
      e.requester_origin_closest_route_latitude,
      e.requester_origin_closest_route_longitude,
      e.requester_destination_closest_route_latitude,
      e.requester_destination_closest_route_longitude,
      e.route_order,
      e.calculated_at,
      e.expires_at,
      'superseded'
    FROM private.trusted_route_match_evidence e
    WHERE e.id = route_match_evidence_id;

  EXCEPTION
    WHEN check_violation THEN
      rejected := true;
  END;


  PERFORM pg_temp.route_match_check(
    '11 new evidence cannot start in a terminal state',
    rejected
  );


  -- =======================================================
  -- Facts are immutable
  -- =======================================================

  rejected := false;

  BEGIN
    UPDATE private.trusted_route_match_evidence
    SET requester_origin_distance_to_route_meters =
          requester_origin_distance_to_route_meters + 1
    WHERE id = route_match_evidence_id;

  EXCEPTION
    WHEN check_violation THEN
      rejected := true;
  END;


  PERFORM pg_temp.route_match_check(
    '12 recorded route-match facts are immutable',
    rejected
  );


  -- =======================================================
  -- History cannot be deleted
  -- =======================================================

  rejected := false;

  BEGIN
    DELETE FROM private.trusted_route_match_evidence
    WHERE id = route_match_evidence_id;

  EXCEPTION
    WHEN check_violation THEN
      rejected := true;
  END;


  PERFORM pg_temp.route_match_check(
    '13 route-match evidence history cannot be deleted',
    rejected
      AND EXISTS (
        SELECT 1
        FROM private.trusted_route_match_evidence
        WHERE id = route_match_evidence_id
      )
  );


  -- =======================================================
  -- Route ordering must agree with stored positions
  -- =======================================================

  rejected := false;

  BEGIN
    INSERT INTO private.trusted_route_match_evidence(
      movement_need_id,
      requesting_member_id,
      requester_origin_location_reference_id,
      requester_destination_location_reference_id,
      offering_member_id,
      offering_movement_intent_id,
      offering_intent_version,
      route_evidence_id,
      route_evidence_version,
      version,
      evidence_schema_version,
      algorithm_version,
      requester_origin_distance_to_route_meters,
      requester_destination_distance_to_route_meters,
      calculated_route_shape_length_meters,
      requester_origin_position_along_route_meters,
      requester_destination_position_along_route_meters,
      requester_origin_closest_route_latitude,
      requester_origin_closest_route_longitude,
      requester_destination_closest_route_latitude,
      requester_destination_closest_route_longitude,
      route_order,
      calculated_at,
      expires_at,
      status
    )

    SELECT
      e.movement_need_id,
      e.requesting_member_id,
      e.requester_origin_location_reference_id,
      e.requester_destination_location_reference_id,
      e.offering_member_id,
      e.offering_movement_intent_id,
      e.offering_intent_version,
      e.route_evidence_id,
      e.route_evidence_version,
      2,
      e.evidence_schema_version,
      e.algorithm_version,
      e.requester_origin_distance_to_route_meters,
      e.requester_destination_distance_to_route_meters,
      e.calculated_route_shape_length_meters,
      e.requester_origin_position_along_route_meters,
      e.requester_destination_position_along_route_meters,
      e.requester_origin_closest_route_latitude,
      e.requester_origin_closest_route_longitude,
      e.requester_destination_closest_route_latitude,
      e.requester_destination_closest_route_longitude,
      'reverse',
      e.calculated_at,
      e.expires_at,
      'current'
    FROM private.trusted_route_match_evidence e
    WHERE e.id = route_match_evidence_id;

  EXCEPTION
    WHEN check_violation THEN
      rejected := true;
  END;


  PERFORM pg_temp.route_match_check(
    '14 route order must agree with objective positions',
    rejected
  );


  -- =======================================================
  -- Positions cannot exceed calculated route length
  -- =======================================================

  rejected := false;

  BEGIN
    INSERT INTO private.trusted_route_match_evidence(
      movement_need_id,
      requesting_member_id,
      requester_origin_location_reference_id,
      requester_destination_location_reference_id,
      offering_member_id,
      offering_movement_intent_id,
      offering_intent_version,
      route_evidence_id,
      route_evidence_version,
      version,
      evidence_schema_version,
      algorithm_version,
      requester_origin_distance_to_route_meters,
      requester_destination_distance_to_route_meters,
      calculated_route_shape_length_meters,
      requester_origin_position_along_route_meters,
      requester_destination_position_along_route_meters,
      requester_origin_closest_route_latitude,
      requester_origin_closest_route_longitude,
      requester_destination_closest_route_latitude,
      requester_destination_closest_route_longitude,
      route_order,
      calculated_at,
      expires_at,
      status
    )
        SELECT
      e.movement_need_id,
      e.requesting_member_id,
      e.requester_origin_location_reference_id,
      e.requester_destination_location_reference_id,
      e.offering_member_id,
      e.offering_movement_intent_id,
      e.offering_intent_version,
      e.route_evidence_id,
      e.route_evidence_version,
      2,
      e.evidence_schema_version,
      e.algorithm_version,
      e.requester_origin_distance_to_route_meters,
      e.requester_destination_distance_to_route_meters,
      e.calculated_route_shape_length_meters,
      e.requester_origin_position_along_route_meters,
      e.calculated_route_shape_length_meters + 1,
      e.requester_origin_closest_route_latitude,
      e.requester_origin_closest_route_longitude,
      e.requester_destination_closest_route_latitude,
      e.requester_destination_closest_route_longitude,
      'forward',
      e.calculated_at,
      e.expires_at,
      'current'
    FROM private.trusted_route_match_evidence e
    WHERE e.id = route_match_evidence_id;

  EXCEPTION
    WHEN check_violation THEN
      rejected := true;
  END;


  PERFORM pg_temp.route_match_check(
    '15 route positions cannot exceed calculated route length',
    rejected
  );


  -- =======================================================
  -- Requester and offerer must be different people
  -- =======================================================

  rejected := false;

  BEGIN
    INSERT INTO private.trusted_route_match_evidence(
      movement_need_id,
      requesting_member_id,
      requester_origin_location_reference_id,
      requester_destination_location_reference_id,
      offering_member_id,
      offering_movement_intent_id,
      offering_intent_version,
      route_evidence_id,
      route_evidence_version,
      version,
      evidence_schema_version,
      algorithm_version,
      requester_origin_distance_to_route_meters,
      requester_destination_distance_to_route_meters,
      calculated_route_shape_length_meters,
      requester_origin_position_along_route_meters,
      requester_destination_position_along_route_meters,
      requester_origin_closest_route_latitude,
      requester_origin_closest_route_longitude,
      requester_destination_closest_route_latitude,
      requester_destination_closest_route_longitude,
      route_order,
      calculated_at,
      expires_at,
      status
    )
    SELECT
      e.movement_need_id,
      e.offering_member_id,
      e.requester_origin_location_reference_id,
      e.requester_destination_location_reference_id,
      e.offering_member_id,
      e.offering_movement_intent_id,
      e.offering_intent_version,
      e.route_evidence_id,
      e.route_evidence_version,
      2,
      e.evidence_schema_version,
      e.algorithm_version,
      e.requester_origin_distance_to_route_meters,
      e.requester_destination_distance_to_route_meters,
      e.calculated_route_shape_length_meters,
      e.requester_origin_position_along_route_meters,
      e.requester_destination_position_along_route_meters,
      e.requester_origin_closest_route_latitude,
      e.requester_origin_closest_route_longitude,
      e.requester_destination_closest_route_latitude,
      e.requester_destination_closest_route_longitude,
      e.route_order,
      e.calculated_at,
      e.expires_at,
      'current'
    FROM private.trusted_route_match_evidence e
    WHERE e.id = route_match_evidence_id;

  EXCEPTION
    WHEN check_violation THEN
      rejected := true;
  END;


  PERFORM pg_temp.route_match_check(
    '16 requester and offerer cannot be the same member',
    rejected
  );


  -- =======================================================
  -- Duplicate evidence is rejected
  -- =======================================================

  rejected := false;

  BEGIN
    INSERT INTO private.trusted_route_match_evidence(
      movement_need_id,
      requesting_member_id,
      requester_origin_location_reference_id,
      requester_destination_location_reference_id,
      offering_member_id,
      offering_movement_intent_id,
      offering_intent_version,
      route_evidence_id,
      route_evidence_version,
      version,
      evidence_schema_version,
      algorithm_version,
      requester_origin_distance_to_route_meters,
      requester_destination_distance_to_route_meters,
      calculated_route_shape_length_meters,
      requester_origin_position_along_route_meters,
      requester_destination_position_along_route_meters,
      requester_origin_closest_route_latitude,
      requester_origin_closest_route_longitude,
      requester_destination_closest_route_latitude,
      requester_destination_closest_route_longitude,
      route_order,
      calculated_at,
      expires_at,
      status
    )
    SELECT
      e.movement_need_id,
      e.requesting_member_id,
      e.requester_origin_location_reference_id,
      e.requester_destination_location_reference_id,
      e.offering_member_id,
      e.offering_movement_intent_id,
      e.offering_intent_version,
      e.route_evidence_id,
      e.route_evidence_version,
      2,
      e.evidence_schema_version,
      e.algorithm_version,
      e.requester_origin_distance_to_route_meters,
      e.requester_destination_distance_to_route_meters,
      e.calculated_route_shape_length_meters,
      e.requester_origin_position_along_route_meters,
      e.requester_destination_position_along_route_meters,
      e.requester_origin_closest_route_latitude,
      e.requester_origin_closest_route_longitude,
      e.requester_destination_closest_route_latitude,
      e.requester_destination_closest_route_longitude,
      e.route_order,
      e.calculated_at,
      e.expires_at,
      'current'
    FROM private.trusted_route_match_evidence e
    WHERE e.id = route_match_evidence_id;

  EXCEPTION
    WHEN unique_violation THEN
      rejected := true;
  END;


  PERFORM pg_temp.route_match_check(
    '17 duplicate current or exact route evidence cannot be recorded',
    rejected
  );


  -- =======================================================
  -- Narrow lifecycle: current -> superseded
  -- =======================================================

  UPDATE private.trusted_route_match_evidence
  SET status = 'superseded'
  WHERE id = route_match_evidence_id;


  PERFORM pg_temp.route_match_check(
    '18 current evidence may become superseded',
    (
      SELECT status = 'superseded'
      FROM private.trusted_route_match_evidence
      WHERE id = route_match_evidence_id
    )
  );


  -- =======================================================
  -- Terminal evidence cannot reopen
  -- =======================================================

  rejected := false;

  BEGIN
    UPDATE private.trusted_route_match_evidence
    SET status = 'current'
    WHERE id = route_match_evidence_id;

  EXCEPTION
    WHEN check_violation THEN
      rejected := true;
  END;


  PERFORM pg_temp.route_match_check(
    '19 superseded evidence cannot reopen',
    rejected
      AND (
        SELECT status = 'superseded'
        FROM private.trusted_route_match_evidence
        WHERE id = route_match_evidence_id
      )
  );


  -- =======================================================
  -- Foundation introduces no operational rows
  -- =======================================================

  PERFORM pg_temp.route_match_check(
    '20 route-match evidence does not create an alignment or journey',
    NOT EXISTS (
      SELECT 1
      FROM public.alignments a
      WHERE a.movement_need_id = (
        SELECT e.movement_need_id
        FROM private.trusted_route_match_evidence e
        WHERE e.id = route_match_evidence_id
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.journeys j
      JOIN public.alignments a
        ON a.id = j.alignment_id
      WHERE a.movement_need_id = (
        SELECT e.movement_need_id
        FROM private.trusted_route_match_evidence e
        WHERE e.id = route_match_evidence_id
      )
    )
  );


  -- =======================================================
  -- Cross-table validator rejects a false intent version
  -- =======================================================

  r := pg_temp.route_match_select_as(
    'authenticated',
    requester_id,
    format(
      'SELECT * FROM public.create_movement_need(
         %L::uuid,
         %L::uuid,
         %L::uuid,
         %L::timestamptz,
         %L::timestamptz,
         1
       )',
      gen_random_uuid(),
      requester_origin_id,
      requester_destination_id,
      departure_earliest,
      departure_latest
    )
  );


  rejected := false;

  BEGIN
    INSERT INTO private.trusted_route_match_evidence(
      movement_need_id,
      requesting_member_id,
      requester_origin_location_reference_id,
      requester_destination_location_reference_id,
      offering_member_id,
      offering_movement_intent_id,
      offering_intent_version,
      route_evidence_id,
      route_evidence_version,
      version,
      evidence_schema_version,
      algorithm_version,
      requester_origin_distance_to_route_meters,
      requester_destination_distance_to_route_meters,
      calculated_route_shape_length_meters,
      requester_origin_position_along_route_meters,
      requester_destination_position_along_route_meters,
      requester_origin_closest_route_latitude,
      requester_origin_closest_route_longitude,
      requester_destination_closest_route_latitude,
      requester_destination_closest_route_longitude,
      route_order,
      calculated_at,
      expires_at,
      status
    )
    VALUES (
      (r #>> '{rows,0,movement_need_id}')::uuid,
      requester_id,
      requester_origin_id,
      requester_destination_id,
      offerer_id,
      offering_intent_id,
      2,
      route_evidence_id,
      1,
      1,
      'trusted_route_match_evidence_v1',
      'route_match_geometry_v1',
      250000,
      400000,
      18000,
      1000,
      12000,
      6.4300,
      3.5200,
      6.4310,
      3.4430,
      'forward',
      clock_timestamp(),
      clock_timestamp() + interval '1 hour',
      'current'
    );


    SET CONSTRAINTS
      private.trusted_route_match_evidence_complete
      IMMEDIATE;

  EXCEPTION
    WHEN check_violation THEN
      rejected := true;
  END;


  SET CONSTRAINTS
    private.trusted_route_match_evidence_complete
    DEFERRED;


  PERFORM pg_temp.route_match_check(
    '21 cross-table validator rejects a false offering intent version',
    r->>'ok' = 'true'
      AND rejected,
    r::text
  );


  -- =======================================================
  -- Route-match evidence cannot outlive trusted dependencies
  -- =======================================================

  r := pg_temp.route_match_select_as(
    'authenticated',
    requester_id,
    format(
      'SELECT * FROM public.create_movement_need(
         %L::uuid,
         %L::uuid,
         %L::uuid,
         %L::timestamptz,
         %L::timestamptz,
         1
       )',
      gen_random_uuid(),
      requester_origin_id,
      requester_destination_id,
      departure_earliest,
      departure_latest
    )
  );


  rejected := false;

  BEGIN
    INSERT INTO private.trusted_route_match_evidence(
      movement_need_id,
      requesting_member_id,
      requester_origin_location_reference_id,
      requester_destination_location_reference_id,
      offering_member_id,
      offering_movement_intent_id,
      offering_intent_version,
      route_evidence_id,
      route_evidence_version,
      version,
      evidence_schema_version,
      algorithm_version,
      requester_origin_distance_to_route_meters,
      requester_destination_distance_to_route_meters,
      calculated_route_shape_length_meters,
      requester_origin_position_along_route_meters,
      requester_destination_position_along_route_meters,
      requester_origin_closest_route_latitude,
      requester_origin_closest_route_longitude,
      requester_destination_closest_route_latitude,
      requester_destination_closest_route_longitude,
      route_order,
      calculated_at,
      expires_at,
      status
    )
    VALUES (
      (r #>> '{rows,0,movement_need_id}')::uuid,
      requester_id,
      requester_origin_id,
      requester_destination_id,
      offerer_id,
      offering_intent_id,
      1,
      route_evidence_id,
      1,
      1,
      'trusted_route_match_evidence_v1',
      'route_match_geometry_v1',
      250000,
      400000,
      18000,
      1000,
      12000,
      6.4300,
      3.5200,
      6.4310,
      3.4430,
      'forward',
      clock_timestamp(),
      clock_timestamp() + interval '5 hours',
      'current'
    );


    SET CONSTRAINTS
      private.trusted_route_match_evidence_complete
      IMMEDIATE;

  EXCEPTION
    WHEN check_violation THEN
      rejected := true;
  END;


  SET CONSTRAINTS
    private.trusted_route_match_evidence_complete
    DEFERRED;


  PERFORM pg_temp.route_match_check(
    '22 route-match evidence cannot outlive trusted dependencies',
    r->>'ok' = 'true'
      AND rejected,
    r::text
  );


  -- =======================================================
  -- Requester endpoints must match exact trusted bindings
  -- =======================================================

  r := pg_temp.route_match_select_as(
    'authenticated',
    requester_id,
    format(
      'SELECT * FROM public.create_movement_need(
         %L::uuid,
         %L::uuid,
         %L::uuid,
         %L::timestamptz,
         %L::timestamptz,
         1
       )',
      gen_random_uuid(),
      requester_origin_id,
      requester_destination_id,
      departure_earliest,
      departure_latest
    )
  );


  rejected := false;

  BEGIN
    INSERT INTO private.trusted_route_match_evidence(
      movement_need_id,
      requesting_member_id,
      requester_origin_location_reference_id,
      requester_destination_location_reference_id,
      offering_member_id,
      offering_movement_intent_id,
      offering_intent_version,
      route_evidence_id,
      route_evidence_version,
      version,
      evidence_schema_version,
      algorithm_version,
      requester_origin_distance_to_route_meters,
      requester_destination_distance_to_route_meters,
      calculated_route_shape_length_meters,
      requester_origin_position_along_route_meters,
      requester_destination_position_along_route_meters,
      requester_origin_closest_route_latitude,
      requester_origin_closest_route_longitude,
      requester_destination_closest_route_latitude,
      requester_destination_closest_route_longitude,
      route_order,
      calculated_at,
      expires_at,
      status
    )
    VALUES (
      (r #>> '{rows,0,movement_need_id}')::uuid,
      requester_id,

      -- Deliberately reversed trusted bindings.
      requester_destination_id,
      requester_origin_id,

      offerer_id,
      offering_intent_id,
      1,
      route_evidence_id,
      1,
      1,
      'trusted_route_match_evidence_v1',
      'route_match_geometry_v1',
      250000,
      400000,
      18000,
      1000,
      12000,
      6.4300,
      3.5200,
      6.4310,
      3.4430,
      'forward',
      clock_timestamp(),
      clock_timestamp() + interval '1 hour',
      'current'
    );


    SET CONSTRAINTS
      private.trusted_route_match_evidence_complete
      IMMEDIATE;

  EXCEPTION
    WHEN check_violation THEN
      rejected := true;
  END;


  SET CONSTRAINTS
    private.trusted_route_match_evidence_complete
    DEFERRED;


  PERFORM pg_temp.route_match_check(
    '23 cross-table validator rejects reversed requester endpoint bindings',
    r->>'ok' = 'true'
      AND rejected,
    r::text
  );


  -- =======================================================
  -- Route evidence version must match exact trusted route
  -- =======================================================

  r := pg_temp.route_match_select_as(
    'authenticated',
    requester_id,
    format(
      'SELECT * FROM public.create_movement_need(
         %L::uuid,
         %L::uuid,
         %L::uuid,
         %L::timestamptz,
         %L::timestamptz,
         1
       )',
      gen_random_uuid(),
      requester_origin_id,
      requester_destination_id,
      departure_earliest,
      departure_latest
    )
  );


  rejected := false;

  BEGIN
    INSERT INTO private.trusted_route_match_evidence(
      movement_need_id,
      requesting_member_id,
      requester_origin_location_reference_id,
      requester_destination_location_reference_id,
      offering_member_id,
      offering_movement_intent_id,
      offering_intent_version,
      route_evidence_id,
      route_evidence_version,
      version,
      evidence_schema_version,
      algorithm_version,
      requester_origin_distance_to_route_meters,
      requester_destination_distance_to_route_meters,
      calculated_route_shape_length_meters,
      requester_origin_position_along_route_meters,
      requester_destination_position_along_route_meters,
      requester_origin_closest_route_latitude,
      requester_origin_closest_route_longitude,
      requester_destination_closest_route_latitude,
      requester_destination_closest_route_longitude,
      route_order,
      calculated_at,
      expires_at,
      status
    )
    VALUES (
      (r #>> '{rows,0,movement_need_id}')::uuid,
      requester_id,
      requester_origin_id,
      requester_destination_id,
      offerer_id,
      offering_intent_id,
      1,
      route_evidence_id,

      -- Deliberately false route-evidence version.
      2,

      1,
      'trusted_route_match_evidence_v1',
      'route_match_geometry_v1',
      250000,
      400000,
      18000,
      1000,
      12000,
      6.4300,
      3.5200,
      6.4310,
      3.4430,
      'forward',
      clock_timestamp(),
      clock_timestamp() + interval '1 hour',
      'current'
    );


    SET CONSTRAINTS
      private.trusted_route_match_evidence_complete
      IMMEDIATE;

  EXCEPTION
    WHEN check_violation THEN
      rejected := true;
  END;


  SET CONSTRAINTS
    private.trusted_route_match_evidence_complete
    DEFERRED;


  PERFORM pg_temp.route_match_check(
    '24 cross-table validator rejects a false route evidence version',
    r->>'ok' = 'true'
      AND rejected,
    r::text
  );


  -- =======================================================
  -- Match calculation cannot predate trusted route
  -- =======================================================

  r := pg_temp.route_match_select_as(
    'authenticated',
    requester_id,
    format(
      'SELECT * FROM public.create_movement_need(
         %L::uuid,
         %L::uuid,
         %L::uuid,
         %L::timestamptz,
         %L::timestamptz,
         1
       )',
      gen_random_uuid(),
      requester_origin_id,
      requester_destination_id,
      departure_earliest,
      departure_latest
    )
  );


  rejected := false;

  BEGIN
    INSERT INTO private.trusted_route_match_evidence(
      movement_need_id,
      requesting_member_id,
      requester_origin_location_reference_id,
      requester_destination_location_reference_id,
      offering_member_id,
      offering_movement_intent_id,
      offering_intent_version,
      route_evidence_id,
      route_evidence_version,
      version,
      evidence_schema_version,
      algorithm_version,
      requester_origin_distance_to_route_meters,
      requester_destination_distance_to_route_meters,
      calculated_route_shape_length_meters,
      requester_origin_position_along_route_meters,
      requester_destination_position_along_route_meters,
      requester_origin_closest_route_latitude,
      requester_origin_closest_route_longitude,
      requester_destination_closest_route_latitude,
      requester_destination_closest_route_longitude,
      route_order,
      calculated_at,
      expires_at,
      status
    )
    SELECT
      (r #>> '{rows,0,movement_need_id}')::uuid,
      requester_id,
      requester_origin_id,
      requester_destination_id,
      offerer_id,
      offering_intent_id,
      1,
      route_evidence_id,
      1,
      1,
      'trusted_route_match_evidence_v1',
      'route_match_geometry_v1',
      250000,
      400000,
      18000,
      1000,
      12000,
      6.4300,
      3.5200,
      6.4310,
      3.4430,
      'forward',

      -- Deliberately earlier than the trusted route generation.
      e.generated_at - interval '1 second',

      e.generated_at + interval '1 hour',
      'current'
    FROM private.offering_route_evidence e
    WHERE e.id = route_evidence_id;


    SET CONSTRAINTS
      private.trusted_route_match_evidence_complete
      IMMEDIATE;

  EXCEPTION
    WHEN check_violation THEN
      rejected := true;
  END;


  SET CONSTRAINTS
    private.trusted_route_match_evidence_complete
    DEFERRED;


  PERFORM pg_temp.route_match_check(
    '25 cross-table validator rejects a calculation predating trusted route evidence',
    r->>'ok' = 'true'
      AND rejected,
    r::text
  );

END;
$test$;


-- =========================================================
-- Results
-- =========================================================

TABLE pg_temp.route_match_results;


DO $assert$
DECLARE
  failed_count integer;
BEGIN
  SELECT count(*)
  INTO failed_count
  FROM pg_temp.route_match_results
  WHERE NOT passed;

  IF failed_count <> 0 THEN
    RAISE EXCEPTION
      '0037 trusted route-match evidence tests failed: %',
      failed_count;
  END IF;
END;
$assert$;


ROLLBACK;