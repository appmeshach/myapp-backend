BEGIN;

SET TRANSACTION ISOLATION LEVEL READ COMMITTED;


-- =========================================================
-- Results
-- =========================================================

CREATE TEMP TABLE pg_temp.matching_context_results (
  test_number integer GENERATED ALWAYS AS IDENTITY,
  test_name text NOT NULL UNIQUE,
  passed boolean NOT NULL,
  diagnostic text
) ON COMMIT DROP;


CREATE FUNCTION pg_temp.matching_context_check(
  p_name text,
  p_passed boolean,
  p_diagnostic text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $check$
BEGIN
  INSERT INTO pg_temp.matching_context_results(
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
ON FUNCTION pg_temp.matching_context_check(
  text,
  boolean,
  text
)
FROM PUBLIC;


-- =========================================================
-- Execute one SELECT as a simulated API role/member
-- =========================================================

CREATE FUNCTION pg_temp.matching_context_as(
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
$as_member$;

REVOKE ALL
ON FUNCTION pg_temp.matching_context_as(
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

  base_time timestamptz;
  departure_earliest timestamptz;
  departure_latest timestamptz;

  route_shape jsonb :=
    '{
      "type":"LineString",
      "coordinates":[
        [3.5200,6.4300],
        [3.4900,6.4320],
        [3.4600,6.4330],
        [3.4430,6.4310]
      ]
    }'::jsonb;

  r jsonb;
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
    id::text || '@test-0036.invalid',
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


  PERFORM pg_temp.matching_context_check(
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
    '0036-requester-origin',
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
    '0036-requester-destination',
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
    '0036-offerer-origin',
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
    '0036-offerer-destination',
    'test-resolution-v1',
    base_time,
    base_time,
    base_time + interval '4 hours'
  )
  RETURNING id
  INTO offerer_destination_id;


  -- =======================================================
  -- Requester creates trusted movement need through 0035
  -- =======================================================

  departure_earliest :=
    statement_timestamp() + interval '1 hour';

  departure_latest :=
    statement_timestamp() + interval '2 hours';


  r := pg_temp.matching_context_as(
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


  PERFORM pg_temp.matching_context_check(
    '02 requester trusted movement need created',
    r->>'ok' = 'true'
      AND movement_need_id IS NOT NULL,
    r::text
  );


  -- =======================================================
  -- Offerer independently creates trusted movement intent
  -- through 0034
  -- =======================================================

  r := pg_temp.matching_context_as(
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


  PERFORM pg_temp.matching_context_check(
    '03 offerer trusted independent movement intent created',
    r->>'ok' = 'true'
      AND offering_intent_id IS NOT NULL,
    r::text
  );


  -- =======================================================
  -- No route means no trusted matching context
  -- =======================================================

  r := pg_temp.matching_context_as(
    'service_role',
    NULL,
    format(
      'SELECT *
       FROM public.get_trusted_matching_context_for_server(
         %L::uuid,
         %L::uuid,
         %L::uuid
       )',
      movement_need_id,
      offering_intent_id,
      offerer_id
    )
  );


  PERFORM pg_temp.matching_context_check(
    '04 matching context rejects offering intent without route evidence',
    r->>'ok' = 'false'
      AND r->>'state' = '23514'
      AND r->>'message'
        = 'Current trusted offering route evidence is unavailable',
    r::text
  );


  -- =======================================================
  -- Trusted server records route evidence through 0025
  -- =======================================================

  base_time := clock_timestamp();

  r := pg_temp.matching_context_as(
    'service_role',
    NULL,
    format(
      'SELECT *
       FROM public.record_offering_route_evidence_for_server(
         %L::uuid,
         ''test-router'',
         ''directions'',
         ''v1'',
         ''0036-route-1'',
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


  PERFORM pg_temp.matching_context_check(
    '05 trusted route evidence recorded',
    r->>'ok' = 'true'
      AND route_evidence_id IS NOT NULL
      AND r #>> '{rows,0,route_evidence_version}' = '1',
    r::text
  );


  -- =======================================================
  -- RPC privilege boundary
  -- =======================================================

  PERFORM pg_temp.matching_context_check(
    '06 trusted matching context execute is service-only',
    has_function_privilege(
      'service_role',
      'public.get_trusted_matching_context_for_server(uuid,uuid,uuid)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'authenticated',
      'public.get_trusted_matching_context_for_server(uuid,uuid,uuid)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'anon',
      'public.get_trusted_matching_context_for_server(uuid,uuid,uuid)',
      'EXECUTE'
    )
  );


  -- =======================================================
  -- Authenticated and anon callers cannot retrieve private
  -- matching coordinates or route geometry
  -- =======================================================

  r := pg_temp.matching_context_as(
    'authenticated',
    offerer_id,
    format(
      'SELECT *
       FROM public.get_trusted_matching_context_for_server(
         %L::uuid,
         %L::uuid,
         %L::uuid
       )',
      movement_need_id,
      offering_intent_id,
      offerer_id
    )
  );


  PERFORM pg_temp.matching_context_check(
    '07 authenticated member cannot read trusted matching context',
    r->>'ok' = 'false'
      AND r->>'state' = '42501',
    r::text
  );


  r := pg_temp.matching_context_as(
    'anon',
    NULL,
    format(
      'SELECT *
       FROM public.get_trusted_matching_context_for_server(
         %L::uuid,
         %L::uuid,
         %L::uuid
       )',
      movement_need_id,
      offering_intent_id,
      offerer_id
    )
  );


  PERFORM pg_temp.matching_context_check(
    '08 anon cannot read trusted matching context',
    r->>'ok' = 'false'
      AND r->>'state' = '42501',
    r::text
  );


  -- =======================================================
  -- Valid service-side matching context
  -- =======================================================

  r := pg_temp.matching_context_as(
    'service_role',
    NULL,
    format(
      'SELECT *
       FROM public.get_trusted_matching_context_for_server(
         %L::uuid,
         %L::uuid,
         %L::uuid
       )',
      movement_need_id,
      offering_intent_id,
      offerer_id
    )
  );


  PERFORM pg_temp.matching_context_check(
    '09 service role receives exactly one trusted matching context',
    r->>'ok' = 'true'
      AND jsonb_array_length(r->'rows') = 1,
    r::text
  );


  PERFORM pg_temp.matching_context_check(
    '10 context binds exact requester and offerer identities',
    (
      r #>> '{rows,0,movement_need_id}'
    )::uuid = movement_need_id
    AND (
      r #>> '{rows,0,requesting_member_id}'
    )::uuid = requester_id
    AND (
      r #>> '{rows,0,offering_movement_intent_id}'
    )::uuid = offering_intent_id
    AND (
      r #>> '{rows,0,offering_member_id}'
    )::uuid = offerer_id,
    r::text
  );


  PERFORM pg_temp.matching_context_check(
    '11 context returns exact trusted requester endpoint bindings',
    (
      r #>>
      '{rows,0,requester_origin_location_reference_id}'
    )::uuid = requester_origin_id
    AND (
      r #>>
      '{rows,0,requester_destination_location_reference_id}'
    )::uuid = requester_destination_id
    AND (
      r #>>
      '{rows,0,requester_origin_latitude}'
    )::numeric = 6.4300
    AND (
      r #>>
      '{rows,0,requester_origin_longitude}'
    )::numeric = 3.5200
    AND (
      r #>>
      '{rows,0,requester_destination_latitude}'
    )::numeric = 6.4310
    AND (
      r #>>
      '{rows,0,requester_destination_longitude}'
    )::numeric = 3.4430,
    r::text
  );


  PERFORM pg_temp.matching_context_check(
    '12 context returns exact current route evidence',
    (
      r #>> '{rows,0,route_evidence_id}'
    )::uuid = route_evidence_id
    AND (
      r #>> '{rows,0,route_evidence_version}'
    )::integer = 1
    AND (
      r #>> '{rows,0,route_shape_format}'
    ) = 'geojson_linestring_v1'
    AND (
      r #>> '{rows,0,route_distance_meters}'
    )::bigint = 18000
    AND (
      r #>> '{rows,0,route_duration_seconds}'
    )::bigint = 2400
    AND (
      r #> '{rows,0,route_shape}'
    ) = route_shape,
    r::text
  );


  PERFORM pg_temp.matching_context_check(
    '13 context preserves requester and offerer departure declarations',
    (
      r #>> '{rows,0,requester_earliest_departure_at}'
    )::timestamptz = departure_earliest
    AND (
      r #>> '{rows,0,requester_latest_departure_at}'
    )::timestamptz = departure_latest
    AND (
      r #>> '{rows,0,offering_earliest_departure_at}'
    )::timestamptz = departure_earliest
    AND (
      r #>> '{rows,0,offering_latest_departure_at}'
    )::timestamptz = departure_latest,
    r::text
  );


  -- =======================================================
  -- Wrong offering member cannot reuse another member's
  -- trusted offering intent
  -- =======================================================

  r := pg_temp.matching_context_as(
    'service_role',
    NULL,
    format(
      'SELECT *
       FROM public.get_trusted_matching_context_for_server(
         %L::uuid,
         %L::uuid,
         %L::uuid
       )',
      movement_need_id,
      offering_intent_id,
      requester_id
    )
  );


  PERFORM pg_temp.matching_context_check(
    '14 requester identity cannot be substituted as offering member',
    r->>'ok' = 'false'
      AND r->>'state' = '23514'
      AND r->>'message'
        = 'Offering member cannot match their own movement need',
    r::text
  );


  -- =======================================================
  -- Requester cannot be matched to their own offering
  -- identity merely by passing their member id
  -- =======================================================

  r := pg_temp.matching_context_as(
    'service_role',
    NULL,
    format(
      'SELECT *
       FROM public.get_trusted_matching_context_for_server(
         %L::uuid,
         %L::uuid,
         %L::uuid
       )',
      movement_need_id,
      offering_intent_id,
      requester_id
    )
  );


  PERFORM pg_temp.matching_context_check(
    '15 member identity cannot be substituted at matching boundary',
    r->>'ok' = 'false',
    r::text
  );

END;
$test$;


-- =========================================================
-- Results
-- =========================================================

TABLE pg_temp.matching_context_results;


DO $assert$
DECLARE
  failed_count integer;
BEGIN
  SELECT count(*)
  INTO failed_count
  FROM pg_temp.matching_context_results
  WHERE NOT passed;

  IF failed_count <> 0 THEN
    RAISE EXCEPTION
      '0036 trusted matching context tests failed: %',
      failed_count;
  END IF;
END;
$assert$;


ROLLBACK;