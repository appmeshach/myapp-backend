BEGIN;

SET TRANSACTION ISOLATION LEVEL READ COMMITTED;


CREATE TEMP TABLE pg_temp.discovery_area_results (
  test_number integer GENERATED ALWAYS AS IDENTITY,
  test_name text NOT NULL UNIQUE,
  passed boolean NOT NULL,
  diagnostic text
) ON COMMIT DROP;


CREATE FUNCTION pg_temp.discovery_area_check(
  p_name text,
  p_passed boolean,
  p_diagnostic text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $check$
BEGIN
  INSERT INTO pg_temp.discovery_area_results(
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
ON FUNCTION pg_temp.discovery_area_check(
  text,
  boolean,
  text
)
FROM PUBLIC;


CREATE FUNCTION pg_temp.discovery_area_as(
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
ON FUNCTION pg_temp.discovery_area_as(
  text,
  uuid,
  text
)
FROM PUBLIC;


CREATE FUNCTION pg_temp.discovery_area_exec_as(
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
    EXECUTE p_sql;

    result_json :=
      jsonb_build_object(
        'ok', true
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
$exec_as$;


REVOKE ALL
ON FUNCTION pg_temp.discovery_area_exec_as(
  text,
  uuid,
  text
)
FROM PUBLIC;


DO $test$
<<discovery_area_test>>
DECLARE
  member_id uuid := gen_random_uuid();

  selection_request_id uuid :=
    gen_random_uuid();

  producer_request_id uuid :=
    gen_random_uuid();

  source_location_reference_id uuid;

  resolved_location_reference_id uuid;

  resolution_evidence_id uuid;

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
  VALUES (
    member_id,
    'authenticated',
    'authenticated',
    member_id::text
      || '@test-0040.invalid',
    base_time,
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    base_time,
    base_time
  );


  PERFORM pg_temp.discovery_area_check(
    '01 member fixture exists',
    EXISTS (
      SELECT 1
      FROM public.members m
      WHERE m.id =
        discovery_area_test.member_id
    )
  );


  r := pg_temp.discovery_area_as(
    'service_role',
    member_id,
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
      member_id,
      selection_request_id,
      '12 Example Road, Ologolo, Lekki, Lagos, Nigeria',
      'test_provider',
      'place-1',
      'selection_proof_v1',
      proof_issued_at,
      proof_expires_at
    )
  );


  PERFORM pg_temp.discovery_area_check(
    '02 verified selected location intake succeeds',
    r->>'ok' = 'true',
    r::text
  );


  source_location_reference_id :=
    (
      r->'rows'->0
        ->>'location_reference_id'
    )::uuid;


  PERFORM pg_temp.discovery_area_check(
    '03 selected source remains precise-label private input',
    EXISTS (
      SELECT 1
      FROM private.movement_location_references l
      WHERE l.id =
          discovery_area_test
            .source_location_reference_id
        AND l.declared_label =
          '12 Example Road, Ologolo, Lekki, Lagos, Nigeria'
        AND l.source_kind =
          'member_selected'
        AND l.resolution_status =
          'unresolved'
        AND l.latitude IS NULL
        AND l.longitude IS NULL
    )
  );


  PERFORM pg_temp.discovery_area_check(
    '04 old twelve-parameter resolution RPC denies service role',
    NOT has_function_privilege(
      'service_role',
      'public.record_attested_location_resolution_for_server(uuid,uuid,uuid,text,text,text,text,text,numeric,numeric,timestamptz,timestamptz)',
      'EXECUTE'
    )
  );


  PERFORM pg_temp.discovery_area_check(
    '05 new thirteen-parameter resolution RPC allows service role only',
    has_function_privilege(
      'service_role',
      'public.record_attested_location_resolution_for_server(uuid,uuid,uuid,text,text,text,text,text,text,numeric,numeric,timestamptz,timestamptz)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'authenticated',
      'public.record_attested_location_resolution_for_server(uuid,uuid,uuid,text,text,text,text,text,text,numeric,numeric,timestamptz,timestamptz)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'anon',
      'public.record_attested_location_resolution_for_server(uuid,uuid,uuid,text,text,text,text,text,text,numeric,numeric,timestamptz,timestamptz)',
      'EXECUTE'
    )
  );


  PERFORM pg_temp.discovery_area_check(
    '06 discovery area table is private and service role read only',
    has_table_privilege(
      'service_role',
      'private.trusted_location_discovery_areas',
      'SELECT'
    )
    AND NOT has_table_privilege(
      'service_role',
      'private.trusted_location_discovery_areas',
      'INSERT'
    )
    AND NOT has_table_privilege(
      'service_role',
      'private.trusted_location_discovery_areas',
      'UPDATE'
    )
    AND NOT has_table_privilege(
      'service_role',
      'private.trusted_location_discovery_areas',
      'DELETE'
    )
    AND NOT has_table_privilege(
      'authenticated',
      'private.trusted_location_discovery_areas',
      'SELECT'
    )
    AND NOT has_table_privilege(
      'anon',
      'private.trusted_location_discovery_areas',
      'SELECT'
    )
  );


  resolved_at :=
    clock_timestamp();


  r := pg_temp.discovery_area_as(
    'service_role',
    member_id,
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
      member_id,
      source_location_reference_id,
      producer_request_id,
      'test_provider',
      'geocode',
      'test_v1',
      'place-1',
      'resolution_v1',
      'Ologolo, Lagos',
      resolved_at
    )
  );


  PERFORM pg_temp.discovery_area_check(
    '07 trusted resolution with broad discovery area succeeds',
    r->>'ok' = 'true',
    r::text
  );


  resolution_evidence_id :=
    (
      r->'rows'->0
        ->>'evidence_id'
    )::uuid;

  resolved_location_reference_id :=
    (
      r->'rows'->0
        ->>'resolved_location_reference_id'
    )::uuid;


  PERFORM pg_temp.discovery_area_check(
    '08 trusted discovery area is stored against exact resolution evidence',
    EXISTS (
      SELECT 1
      FROM private.trusted_location_discovery_areas d
      WHERE d.resolution_evidence_id =
          discovery_area_test
            .resolution_evidence_id
        AND d.resolved_location_reference_id =
          discovery_area_test
            .resolved_location_reference_id
        AND d.discovery_area_label =
          'Ologolo, Lagos'
        AND d.schema_version =
          'trusted_location_discovery_area_v1'
    )
  );


  PERFORM pg_temp.discovery_area_check(
    '09 precise selected label is not replaced by broad label',
    EXISTS (
      SELECT 1
      FROM private.movement_location_references l
      WHERE l.id =
          discovery_area_test
            .resolved_location_reference_id
        AND l.declared_label =
          '12 Example Road, Ologolo, Lekki, Lagos, Nigeria'
        AND l.declared_label <>
          'Ologolo, Lagos'
        AND l.source_kind =
          'provider_resolved'
        AND l.resolution_status =
          'resolved'
    )
  );


  r := pg_temp.discovery_area_as(
    'service_role',
    member_id,
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
      member_id,
      source_location_reference_id,
      producer_request_id,
      'test_provider',
      'geocode',
      'test_v1',
      'place-1',
      'resolution_v1',
      'Ologolo, Lagos',
      resolved_at
    )
  );


  PERFORM pg_temp.discovery_area_check(
    '10 exact trusted resolution replay succeeds',
    r->>'ok' = 'true'
      AND (
        r->'rows'->0
          ->>'evidence_id'
      )::uuid =
        discovery_area_test.resolution_evidence_id
      AND (
        r->'rows'->0
          ->>'resolved_location_reference_id'
      )::uuid =
        discovery_area_test
          .resolved_location_reference_id,
    r::text
  );


  r := pg_temp.discovery_area_as(
    'service_role',
    member_id,
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
      member_id,
      source_location_reference_id,
      producer_request_id,
      'test_provider',
      'geocode',
      'test_v1',
      'place-1',
      'resolution_v1',
      'Ikeja, Lagos',
      resolved_at
    )
  );


  PERFORM pg_temp.discovery_area_check(
    '11 changed broad area on exact replay is rejected',
    r->>'ok' = 'false'
      AND r->>'state' = '23514',
    r::text
  );


  r := pg_temp.discovery_area_as(
    'service_role',
    member_id,
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
      member_id,
      source_location_reference_id,
      gen_random_uuid(),
      'test_provider',
      'geocode',
      'test_v1',
      'place-1',
      'resolution_v1',
      '   ',
      resolved_at
    )
  );


  PERFORM pg_temp.discovery_area_check(
    '12 whitespace discovery area is rejected',
    r->>'ok' = 'false'
      AND r->>'state' = '23514',
    r::text
  );


  r := pg_temp.discovery_area_as(
    'authenticated',
    member_id,
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
      member_id,
      source_location_reference_id,
      gen_random_uuid(),
      'test_provider',
      'geocode',
      'test_v1',
      'place-1',
      'resolution_v1',
      'Ologolo, Lagos',
      resolved_at
    )
  );


  PERFORM pg_temp.discovery_area_check(
    '13 authenticated member cannot invoke trusted resolution writer',
    r->>'ok' = 'false'
      AND r->>'state' = '42501',
    r::text
  );


  r := pg_temp.discovery_area_as(
    'anon',
    NULL,
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
      member_id,
      source_location_reference_id,
      gen_random_uuid(),
      'test_provider',
      'geocode',
      'test_v1',
      'place-1',
      'resolution_v1',
      'Ologolo, Lagos',
      resolved_at
    )
  );


  PERFORM pg_temp.discovery_area_check(
    '14 anon cannot invoke trusted resolution writer',
    r->>'ok' = 'false'
      AND r->>'state' = '42501',
    r::text
  );


  r := pg_temp.discovery_area_exec_as(
    'service_role',
    member_id,
    format(
      'UPDATE private.trusted_location_discovery_areas
       SET discovery_area_label=%L
       WHERE resolution_evidence_id=%L::uuid',
      'Changed, Lagos',
      resolution_evidence_id
    )
  );



  PERFORM pg_temp.discovery_area_check(
    '15 service role cannot directly update trusted discovery area',
    r->>'ok' = 'false'
      AND r->>'state' = '42501',
    r::text
  );


  r := pg_temp.discovery_area_exec_as(
    'service_role',
    member_id,
    format(
      'DELETE FROM private.trusted_location_discovery_areas
       WHERE resolution_evidence_id=%L::uuid',
      resolution_evidence_id
    )
  );



  PERFORM pg_temp.discovery_area_check(
    '16 service role cannot directly delete trusted discovery area',
    r->>'ok' = 'false'
      AND r->>'state' = '42501',
    r::text
  );

END;
$test$;


TABLE pg_temp.discovery_area_results;


DO $assert$
DECLARE
  total_count integer;
  failed_count integer;
BEGIN
  SELECT count(*)
  INTO total_count
  FROM pg_temp.discovery_area_results;

  SELECT count(*)
  INTO failed_count
  FROM pg_temp.discovery_area_results
  WHERE NOT passed;

  IF total_count <> 16 THEN
    RAISE EXCEPTION
      '0040 expected exactly 16 named results, got %',
      total_count;
  END IF;

  IF failed_count <> 0 THEN
    RAISE EXCEPTION
      '0040 trusted location discovery area tests failed:%',
      failed_count;
  END IF;
END;
$assert$;


ROLLBACK;