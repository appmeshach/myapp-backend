BEGIN;

SET TRANSACTION ISOLATION LEVEL READ COMMITTED;


CREATE TEMP TABLE pg_temp.authorized_matching_results (
  test_number integer GENERATED ALWAYS AS IDENTITY,
  test_name text NOT NULL UNIQUE,
  passed boolean NOT NULL,
  diagnostic text
) ON COMMIT DROP;


CREATE FUNCTION pg_temp.authorized_matching_check(
  p_name text,
  p_passed boolean,
  p_diagnostic text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $check$
BEGIN
  INSERT INTO pg_temp.authorized_matching_results(
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
ON FUNCTION pg_temp.authorized_matching_check(
  text,
  boolean,
  text
)
FROM PUBLIC;


CREATE FUNCTION pg_temp.authorized_matching_as(
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
        'ok', true,
        'rows', rows_json
      );

  EXCEPTION
    WHEN OTHERS THEN
      result_json :=
        jsonb_build_object(
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
ON FUNCTION pg_temp.authorized_matching_as(
  text,
  uuid,
  text
)
FROM PUBLIC;


DO $test$
<<authorized_matching_test>>
DECLARE
  requester_id uuid := gen_random_uuid();
  offerer_id uuid := gen_random_uuid();
  unrelated_id uuid := gen_random_uuid();

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
    id::text || '@test-0039.invalid',
    base_time,
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    base_time,
    base_time
  FROM unnest(
    ARRAY[
      requester_id,
      offerer_id,
      unrelated_id
    ]
  ) ids(id);


  PERFORM pg_temp.authorized_matching_check(
    '01 auth trigger created all three members',
    (
      SELECT count(*) = 3
      FROM public.members m
      WHERE m.id IN (
        requester_id,
        offerer_id,
        unrelated_id
      )
    )
  );


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
    'Ologolo, Lagos',
    'provider_resolved',
    'resolved',
    6.4300,
    3.5200,
    'test-provider',
    '0039-requester-origin',
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
    'Ikeja, Lagos',
    'provider_resolved',
    'resolved',
    6.6018,
    3.3515,
    'test-provider',
    '0039-requester-destination',
    'test-resolution-v1',
    base_time,
    base_time,
    base_time + interval '4 hours'
  )
  RETURNING id
  INTO requester_destination_id;


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
    'Ologolo, Lagos',
    'provider_resolved',
    'resolved',
    6.4300,
    3.5200,
    'test-provider',
    '0039-offerer-origin',
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
    '0039-offerer-destination',
    'test-resolution-v1',
    base_time,
    base_time,
    base_time + interval '4 hours'
  )
  RETURNING id
  INTO offerer_destination_id;


  departure_earliest :=
    statement_timestamp()
    + interval '1 hour';

  departure_latest :=
    statement_timestamp()
    + interval '2 hours';


  r := pg_temp.authorized_matching_as(
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
    (
      r #>>
      '{rows,0,movement_need_id}'
    )::uuid;


  PERFORM pg_temp.authorized_matching_check(
    '02 requester trusted movement need created',
    r->>'ok' = 'true'
      AND movement_need_id IS NOT NULL,
    r::text
  );


  r := pg_temp.authorized_matching_as(
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


  PERFORM pg_temp.authorized_matching_check(
    '03 offerer trusted independent movement intent created',
    r->>'ok' = 'true'
      AND offering_intent_id IS NOT NULL,
    r::text
  );


  base_time := clock_timestamp();

  r := pg_temp.authorized_matching_as(
    'service_role',
    NULL,
    format(
      'SELECT *
       FROM public.record_offering_route_evidence_for_server(
         %L::uuid,
         ''test-router'',
         ''directions'',
         ''v1'',
         ''0039-route-1'',
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


  PERFORM pg_temp.authorized_matching_check(
    '04 trusted route evidence recorded',
    r->>'ok' = 'true'
      AND route_evidence_id IS NOT NULL,
    r::text
  );


  PERFORM pg_temp.authorized_matching_check(
    '05 authorized matching context execute is service-only',
    has_function_privilege(
      'service_role',
      'public.get_authorized_trusted_matching_context_for_server(uuid,uuid,uuid)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'authenticated',
      'public.get_authorized_trusted_matching_context_for_server(uuid,uuid,uuid)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'anon',
      'public.get_authorized_trusted_matching_context_for_server(uuid,uuid,uuid)',
      'EXECUTE'
    )
  );


  r := pg_temp.authorized_matching_as(
    'service_role',
    NULL,
    format(
      'SELECT *
       FROM public.get_authorized_trusted_matching_context_for_server(
         %L::uuid,
         %L::uuid,
         %L::uuid
       )',
      requester_id,
      movement_need_id,
      offering_intent_id
    )
  );


  PERFORM pg_temp.authorized_matching_check(
    '06 requester owner is authorized',
    r->>'ok' = 'true'
      AND jsonb_array_length(r->'rows') = 1
      AND (
        r #>> '{rows,0,requesting_member_id}'
      )::uuid = requester_id
      AND (
        r #>> '{rows,0,offering_member_id}'
      )::uuid = offerer_id
      AND (
        r #>> '{rows,0,route_evidence_id}'
      )::uuid = route_evidence_id,
    r::text
  );


  r := pg_temp.authorized_matching_as(
    'service_role',
    NULL,
    format(
      'SELECT *
       FROM public.get_authorized_trusted_matching_context_for_server(
         %L::uuid,
         %L::uuid,
         %L::uuid
       )',
      offerer_id,
      movement_need_id,
      offering_intent_id
    )
  );


  PERFORM pg_temp.authorized_matching_check(
    '07 offerer owner is authorized',
    r->>'ok' = 'true'
      AND jsonb_array_length(r->'rows') = 1
      AND (
        r #>> '{rows,0,requesting_member_id}'
      )::uuid = requester_id
      AND (
        r #>> '{rows,0,offering_member_id}'
      )::uuid = offerer_id,
    r::text
  );


  r := pg_temp.authorized_matching_as(
    'service_role',
    NULL,
    format(
      'SELECT *
       FROM public.get_authorized_trusted_matching_context_for_server(
         %L::uuid,
         %L::uuid,
         %L::uuid
       )',
      unrelated_id,
      movement_need_id,
      offering_intent_id
    )
  );


  PERFORM pg_temp.authorized_matching_check(
    '08 unrelated member is rejected before trusted context is returned',
    r->>'ok' = 'false'
      AND r->>'state' = '42501'
      AND r->>'message'
        = 'Member is not authorized for this trusted matching context',
    r::text
  );


  r := pg_temp.authorized_matching_as(
    'authenticated',
    requester_id,
    format(
      'SELECT *
       FROM public.get_authorized_trusted_matching_context_for_server(
         %L::uuid,
         %L::uuid,
         %L::uuid
       )',
      requester_id,
      movement_need_id,
      offering_intent_id
    )
  );


  PERFORM pg_temp.authorized_matching_check(
    '09 authenticated role cannot invoke server authorization RPC directly',
    r->>'ok' = 'false'
      AND r->>'state' = '42501',
    r::text
  );


  r := pg_temp.authorized_matching_as(
    'anon',
    NULL,
    format(
      'SELECT *
       FROM public.get_authorized_trusted_matching_context_for_server(
         %L::uuid,
         %L::uuid,
         %L::uuid
       )',
      requester_id,
      movement_need_id,
      offering_intent_id
    )
  );


  PERFORM pg_temp.authorized_matching_check(
    '10 anon cannot invoke server authorization RPC directly',
    r->>'ok' = 'false'
      AND r->>'state' = '42501',
    r::text
  );


  PERFORM pg_temp.authorized_matching_check(
    '11 authorization lookup creates no route-match evidence',
    NOT EXISTS (
      SELECT 1
      FROM private.trusted_route_match_evidence e
      WHERE e.movement_need_id =
          authorized_matching_test.movement_need_id
        AND e.offering_movement_intent_id =
          authorized_matching_test.offering_intent_id
    )
  );


  PERFORM pg_temp.authorized_matching_check(
    '12 authorization lookup creates no alignment or journey state',
    NOT EXISTS (
      SELECT 1
      FROM public.alignments a
      WHERE a.movement_need_id =
        authorized_matching_test.movement_need_id
    )
  );

END;
$test$;


TABLE pg_temp.authorized_matching_results;


DO $assert$
DECLARE
  failed_count integer;
BEGIN
  SELECT count(*)
  INTO failed_count
  FROM pg_temp.authorized_matching_results
  WHERE NOT passed;

  IF failed_count <> 0 THEN
    RAISE EXCEPTION
      '0039 authorized trusted matching context tests failed: %',
      failed_count;
  END IF;
END;
$assert$;


ROLLBACK;
