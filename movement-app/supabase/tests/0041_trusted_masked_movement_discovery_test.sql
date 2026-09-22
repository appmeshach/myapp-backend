BEGIN;

SET TRANSACTION ISOLATION LEVEL READ COMMITTED;


CREATE TEMP TABLE pg_temp.discovery_results (
  test_number integer GENERATED ALWAYS AS IDENTITY,
  test_name text NOT NULL UNIQUE,
  passed boolean NOT NULL,
  diagnostic text
) ON COMMIT DROP;


CREATE FUNCTION pg_temp.discovery_check(
  p_name text,
  p_passed boolean,
  p_diagnostic text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $check$
BEGIN
  INSERT INTO pg_temp.discovery_results(
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
ON FUNCTION pg_temp.discovery_check(
  text,
  boolean,
  text
)
FROM PUBLIC;


CREATE FUNCTION pg_temp.discovery_as(
  p_role text,
  p_member_id uuid,
  p_sql text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $as_role$
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
$as_role$;


REVOKE ALL
ON FUNCTION pg_temp.discovery_as(
  text,
  uuid,
  text
)
FROM PUBLIC;


DO $test$
<<trusted_discovery_test>>
DECLARE
  requester_id uuid :=
    gen_random_uuid();

  viewer_id uuid :=
    gen_random_uuid();

  trusted_origin_source uuid;
  trusted_destination_source uuid;

  trusted_origin_resolved uuid;
  trusted_destination_resolved uuid;

  legacy_origin_source uuid;
  legacy_destination_source uuid;

  legacy_origin_resolved uuid;
  legacy_destination_resolved uuid;

  trusted_need_id uuid;
  legacy_need_id uuid;

  base_time timestamptz :=
    clock_timestamp();

  proof_issued_at timestamptz :=
    clock_timestamp()
      - interval '1 minute';

  proof_expires_at timestamptz :=
    clock_timestamp()
      + interval '1 hour';

  resolved_at timestamptz;

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
  VALUES
    (
      requester_id,
      'authenticated',
      'authenticated',
      requester_id::text
        || '@test-0041-requester.invalid',
      base_time,
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      base_time,
      base_time
    ),
    (
      viewer_id,
      'authenticated',
      'authenticated',
      viewer_id::text
        || '@test-0041-viewer.invalid',
      base_time,
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      base_time,
      base_time
    );


  PERFORM pg_temp.discovery_check(
    '01 member fixtures exist',
    (
      SELECT count(*) = 2
      FROM public.members m
      WHERE m.id IN (
        requester_id,
        viewer_id
      )
    )
  );


  PERFORM pg_temp.discovery_check(
    '02 discovery RPC is authenticated only',
    has_function_privilege(
      'authenticated',
      'public.discover_masked_movement_needs(integer)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'anon',
      'public.discover_masked_movement_needs(integer)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'service_role',
      'public.discover_masked_movement_needs(integer)',
      'EXECUTE'
    )
  );


  r := pg_temp.discovery_as(
    'service_role',
    requester_id,
    format(
      'SELECT *
       FROM public.record_verified_selected_location_for_server(
         %L::uuid,
         %L::uuid,
         %L,
         %L,
         %L,
         %L,
         %L::timestamptz,
         %L::timestamptz
       )',
      requester_id,
      gen_random_uuid(),
      '12 Precise Origin Road, Ologolo, Lekki, Lagos, Nigeria',
      'test_provider',
      'trusted-origin-place',
      'selection_proof_v1',
      proof_issued_at,
      proof_expires_at
    )
  );

  trusted_origin_source :=
    (
      r->'rows'->0
        ->>'location_reference_id'
    )::uuid;


  r := pg_temp.discovery_as(
    'service_role',
    requester_id,
    format(
      'SELECT *
       FROM public.record_verified_selected_location_for_server(
         %L::uuid,
         %L::uuid,
         %L,
         %L,
         %L,
         %L,
         %L::timestamptz,
         %L::timestamptz
       )',
      requester_id,
      gen_random_uuid(),
      '98 Precise Destination Avenue, Ikeja, Lagos, Nigeria',
      'test_provider',
      'trusted-destination-place',
      'selection_proof_v1',
      proof_issued_at,
      proof_expires_at
    )
  );

  trusted_destination_source :=
    (
      r->'rows'->0
        ->>'location_reference_id'
    )::uuid;


  resolved_at :=
    clock_timestamp();


  r := pg_temp.discovery_as(
    'service_role',
    requester_id,
    format(
      'SELECT *
       FROM public.record_attested_location_resolution_for_server(
         %L::uuid,
         %L::uuid,
         %L::uuid,
         %L,
         %L,
         %L,
         %L,
         %L,
         %L,
         6.437,
         3.501,
         %L::timestamptz,
         NULL
       )',
      requester_id,
      trusted_origin_source,
      gen_random_uuid(),
      'test_provider',
      'geocode',
      'test_v1',
      'trusted-origin-place',
      'resolution_v1',
      'Ologolo, Lagos',
      resolved_at
    )
  );

  trusted_origin_resolved :=
    (
      r->'rows'->0
        ->>'resolved_location_reference_id'
    )::uuid;


  r := pg_temp.discovery_as(
    'service_role',
    requester_id,
    format(
      'SELECT *
       FROM public.record_attested_location_resolution_for_server(
         %L::uuid,
         %L::uuid,
         %L::uuid,
         %L,
         %L,
         %L,
         %L,
         %L,
         %L,
         6.6018,
         3.3515,
         %L::timestamptz,
         NULL
       )',
      requester_id,
      trusted_destination_source,
      gen_random_uuid(),
      'test_provider',
      'geocode',
      'test_v1',
      'trusted-destination-place',
      'resolution_v1',
      'Ikeja, Lagos',
      resolved_at
    )
  );

  trusted_destination_resolved :=
    (
      r->'rows'->0
        ->>'resolved_location_reference_id'
    )::uuid;


  PERFORM pg_temp.discovery_check(
    '03 trusted broad-area evidence exists for both endpoints',
    (
      SELECT count(*) = 2
      FROM private.trusted_location_discovery_areas d
      WHERE d.resolved_location_reference_id IN (
        trusted_origin_resolved,
        trusted_destination_resolved
      )
    )
  );


  r := pg_temp.discovery_as(
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
         2
       )',
      gen_random_uuid(),
      trusted_origin_resolved,
      trusted_destination_resolved,
      clock_timestamp() + interval '1 hour',
      clock_timestamp() + interval '2 hours'
    )
  );

  trusted_need_id :=
    (
      r->'rows'->0
        ->>'movement_need_id'
    )::uuid;


  PERFORM pg_temp.discovery_check(
    '04 trusted movement need is created through real intake',
    r->>'ok' = 'true'
      AND trusted_need_id IS NOT NULL,
    r::text
  );


  PERFORM pg_temp.discovery_check(
    '05 precise labels remain stored on movement need',
    EXISTS (
      SELECT 1
      FROM public.movement_needs mn
      WHERE mn.id = trusted_need_id
        AND mn.origin_area =
          '12 Precise Origin Road, Ologolo, Lekki, Lagos, Nigeria'
        AND mn.destination_area =
          '98 Precise Destination Avenue, Ikeja, Lagos, Nigeria'
    )
  );


  r := pg_temp.discovery_as(
    'authenticated',
    viewer_id,
    'SELECT *
     FROM public.discover_masked_movement_needs(20)'
  );


  PERFORM pg_temp.discovery_check(
    '06 trusted movement need is discoverable',
    r->>'ok' = 'true'
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(
          r->'rows'
        ) row_value
        WHERE (
          row_value->>'movement_need_id'
        )::uuid = trusted_need_id
      ),
    r::text
  );


  PERFORM pg_temp.discovery_check(
    '07 discovery returns trusted broad origin and destination',
    EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        r->'rows'
      ) row_value
      WHERE (
        row_value->>'movement_need_id'
      )::uuid = trusted_need_id
        AND row_value->>'origin_area' =
          'Ologolo, Lagos'
        AND row_value->>'destination_area' =
          'Ikeja, Lagos'
    ),
    r::text
  );


  PERFORM pg_temp.discovery_check(
    '08 discovery does not expose precise movement need labels',
    NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        r->'rows'
      ) row_value
      WHERE row_value->>'origin_area' =
          '12 Precise Origin Road, Ologolo, Lekki, Lagos, Nigeria'
         OR row_value->>'destination_area' =
          '98 Precise Destination Avenue, Ikeja, Lagos, Nigeria'
    ),
    r::text
  );


  r := pg_temp.discovery_as(
    'service_role',
    requester_id,
    format(
      'SELECT *
       FROM public.record_verified_selected_location_for_server(
         %L::uuid,
         %L::uuid,
         %L,
         %L,
         %L,
         %L,
         %L::timestamptz,
         %L::timestamptz
       )',
      requester_id,
      gen_random_uuid(),
      '44 Legacy Origin Street, Lagos, Nigeria',
      'test_provider',
      'legacy-origin-place',
      'selection_proof_v1',
      proof_issued_at,
      proof_expires_at
    )
  );

  legacy_origin_source :=
    (
      r->'rows'->0
        ->>'location_reference_id'
    )::uuid;


  r := pg_temp.discovery_as(
    'service_role',
    requester_id,
    format(
      'SELECT *
       FROM public.record_verified_selected_location_for_server(
         %L::uuid,
         %L::uuid,
         %L,
         %L,
         %L,
         %L,
         %L::timestamptz,
         %L::timestamptz
       )',
      requester_id,
      gen_random_uuid(),
      '77 Legacy Destination Road, Lagos, Nigeria',
      'test_provider',
      'legacy-destination-place',
      'selection_proof_v1',
      proof_issued_at,
      proof_expires_at
    )
  );

  legacy_destination_source :=
    (
      r->'rows'->0
        ->>'location_reference_id'
    )::uuid;


  resolved_at :=
    clock_timestamp();


  SELECT x.resolved_location_reference_id
  INTO legacy_origin_resolved
  FROM public.record_location_resolution_for_server(
    legacy_origin_source,
    gen_random_uuid(),
    'test_provider',
    'geocode',
    'test_v1',
    'legacy-origin-place',
    'resolution_v1',
    6.45,
    3.40,
    resolved_at,
    NULL
  ) x;


  SELECT x.resolved_location_reference_id
  INTO legacy_destination_resolved
  FROM public.record_location_resolution_for_server(
    legacy_destination_source,
    gen_random_uuid(),
    'test_provider',
    'geocode',
    'test_v1',
    'legacy-destination-place',
    'resolution_v1',
    6.55,
    3.35,
    resolved_at,
    NULL
  ) x;


  PERFORM pg_temp.discovery_check(
    '09 legacy resolved endpoints have no trusted discovery area',
    NOT EXISTS (
      SELECT 1
      FROM private.trusted_location_discovery_areas d
      WHERE d.resolved_location_reference_id IN (
        legacy_origin_resolved,
        legacy_destination_resolved
      )
    )
  );


  r := pg_temp.discovery_as(
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
      gen_random_uuid(),
      legacy_origin_resolved,
      legacy_destination_resolved,
      clock_timestamp() + interval '3 hours',
      clock_timestamp() + interval '4 hours'
    )
  );

  legacy_need_id :=
    (
      r->'rows'->0
        ->>'movement_need_id'
    )::uuid;


  PERFORM pg_temp.discovery_check(
    '10 legacy movement need remains otherwise discoverable',
    r->>'ok' = 'true'
      AND EXISTS (
        SELECT 1
        FROM public.movement_needs mn
        WHERE mn.id = legacy_need_id
          AND mn.status = 'discoverable'
          AND mn.origin_area =
            '44 Legacy Origin Street, Lagos, Nigeria'
          AND mn.destination_area =
            '77 Legacy Destination Road, Lagos, Nigeria'
      ),
    r::text
  );


  r := pg_temp.discovery_as(
    'authenticated',
    viewer_id,
    'SELECT *
     FROM public.discover_masked_movement_needs(20)'
  );


  PERFORM pg_temp.discovery_check(
    '11 legacy need without trusted broad area is excluded',
    r->>'ok' = 'true'
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(
          r->'rows'
        ) row_value
        WHERE (
          row_value->>'movement_need_id'
        )::uuid = legacy_need_id
      ),
    r::text
  );


  r := pg_temp.discovery_as(
    'authenticated',
    requester_id,
    'SELECT *
     FROM public.discover_masked_movement_needs(20)'
  );


  PERFORM pg_temp.discovery_check(
    '12 requester cannot discover own trusted movement need',
    r->>'ok' = 'true'
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(
          r->'rows'
        ) row_value
        WHERE (
          row_value->>'movement_need_id'
        )::uuid = trusted_need_id
      ),
    r::text
  );


  r := pg_temp.discovery_as(
    'anon',
    NULL,
    'SELECT *
     FROM public.discover_masked_movement_needs(20)'
  );


  PERFORM pg_temp.discovery_check(
    '13 anon cannot invoke masked movement discovery',
    r->>'ok' = 'false'
      AND r->>'state' = '42501',
    r::text
  );


  r := pg_temp.discovery_as(
    'authenticated',
    viewer_id,
    'SELECT *
     FROM public.discover_masked_movement_needs(NULL)'
  );


  PERFORM pg_temp.discovery_check(
    '14 null discovery limit is rejected',
    r->>'ok' = 'false',
    r::text
  );


  r := pg_temp.discovery_as(
    'authenticated',
    viewer_id,
    'SELECT *
     FROM public.discover_masked_movement_needs(51)'
  );


  PERFORM pg_temp.discovery_check(
    '15 discovery limit above fifty is rejected',
    r->>'ok' = 'false',
    r::text
  );

END;
$test$;


TABLE pg_temp.discovery_results;


DO $assert$
DECLARE
  total_count integer;
  failed_count integer;
BEGIN
  SELECT count(*)
  INTO total_count
  FROM pg_temp.discovery_results;

  SELECT count(*)
  INTO failed_count
  FROM pg_temp.discovery_results
  WHERE NOT passed;

  IF total_count <> 15 THEN
    RAISE EXCEPTION
      '0041 expected exactly 15 named results, got %',
      total_count;
  END IF;

  IF failed_count <> 0 THEN
    RAISE EXCEPTION
      '0041 trusted masked movement discovery tests failed:%',
      failed_count;
  END IF;
END;
$assert$;


ROLLBACK;