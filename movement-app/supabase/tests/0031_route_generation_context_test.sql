BEGIN;

SET TRANSACTION ISOLATION LEVEL READ COMMITTED;

CREATE TEMP TABLE route_generation_context_test_results (
  check_number integer GENERATED ALWAYS AS IDENTITY,
  test_name text NOT NULL UNIQUE,
  passed boolean NOT NULL
) ON COMMIT DROP;

CREATE FUNCTION pg_temp.route_context_check(
  p_name text,
  p_passed boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $helper$
BEGIN
  INSERT INTO pg_temp.route_generation_context_test_results(
    test_name,
    passed
  )
  VALUES(
    p_name,
    coalesce(p_passed, false)
  );
END;
$helper$;

CREATE FUNCTION pg_temp.route_context_as(
  p_role text,
  p_sql text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $helper$
DECLARE
  previous_role text := current_setting('role');
  rows_json jsonb;
  result_json jsonb;
BEGIN
  IF p_role NOT IN ('authenticated', 'anon', 'service_role') THEN
    RAISE EXCEPTION 'Unsupported test role';
  END IF;

  PERFORM set_config('role', p_role, true);

  BEGIN
    EXECUTE
      'SELECT coalesce(jsonb_agg(to_jsonb(q)),''[]''::jsonb)
       FROM (' || p_sql || ') q'
    INTO rows_json;

    result_json := jsonb_build_object(
      'ok', true,
      'rows', rows_json
    );
  EXCEPTION
    WHEN OTHERS THEN
      result_json := jsonb_build_object(
        'ok', false,
        'sqlstate', SQLSTATE,
        'message', SQLERRM
      );
  END;

  PERFORM set_config('role', previous_role, true);

  RETURN result_json;
END;
$helper$;

DO $route_context_test$
DECLARE
  member_id uuid := gen_random_uuid();
  other_member_id uuid := gen_random_uuid();

  intent_id uuid := gen_random_uuid();
  intent_key uuid := gen_random_uuid();

  origin_id uuid := gen_random_uuid();
  destination_id uuid := gen_random_uuid();

  base_time timestamptz := transaction_timestamp();
  dependency_expiry timestamptz :=
    transaction_timestamp() + interval '2 hours';

  r jsonb;

  route_evidence_before bigint;
  journey_count_before bigint;
  alignment_count_before bigint;

  unresolved_rejected boolean := false;
  expired_rejected boolean := false;
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
      member_id,
      'authenticated',
      'authenticated',
      member_id::text || '@test-0031.invalid',
      base_time,
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      base_time,
      base_time
    ),
    (
      other_member_id,
      'authenticated',
      'authenticated',
      other_member_id::text || '@test-0031.invalid',
      base_time,
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      base_time,
      base_time
    );

  INSERT INTO private.movement_location_references(
    id,
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
  VALUES
    (
      origin_id,
      member_id,
      'Test origin 0031',
      'provider_resolved',
      'resolved',
      6.434,
      3.489,
      'test-location',
      'origin-0031',
      'resolver-v1',
      base_time,
      base_time,
      dependency_expiry
    ),
    (
      destination_id,
      member_id,
      'Test destination 0031',
      'provider_resolved',
      'resolved',
      6.469,
      3.389,
      'test-location',
      'destination-0031',
      'resolver-v1',
      base_time,
      base_time,
      dependency_expiry
    );

  INSERT INTO private.offering_movement_intents(
    id,
    offering_member_id,
    intent_key,
    version,
    earliest_departure_at,
    latest_departure_at,
    created_at,
    expires_at,
    status
  )
  VALUES(
    intent_id,
    member_id,
    intent_key,
    1,
    statement_timestamp() + interval '1 hour',
    statement_timestamp() + interval '90 minutes',
    base_time,
    dependency_expiry,
    'current'
  );

  INSERT INTO private.offering_movement_intent_locations(
    intent_id,
    role,
    location_reference_id
  )
  VALUES
    (intent_id, 'origin', origin_id),
    (intent_id, 'destination', destination_id);

  SET CONSTRAINTS
    private.offering_intent_complete,
    private.offering_intent_locations_complete
    IMMEDIATE;

  SET CONSTRAINTS
    private.offering_intent_complete,
    private.offering_intent_locations_complete
    DEFERRED;

  PERFORM pg_temp.route_context_check(
    '01 RPC execute is service-only',
    has_function_privilege(
      'service_role',
      'public.get_offering_route_generation_context_for_server(uuid,uuid)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'authenticated',
      'public.get_offering_route_generation_context_for_server(uuid,uuid)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'anon',
      'public.get_offering_route_generation_context_for_server(uuid,uuid)',
      'EXECUTE'
    )
  );

  r := pg_temp.route_context_as(
    'authenticated',
    format(
      $sql$
      SELECT *
      FROM public.get_offering_route_generation_context_for_server(
        %L::uuid,
        %L::uuid
      )
      $sql$,
      intent_id,
      member_id
    )
  );

  PERFORM pg_temp.route_context_check(
    '02 authenticated cannot execute',
    r->>'ok' = 'false'
    AND r->>'sqlstate' = '42501'
  );

  r := pg_temp.route_context_as(
    'anon',
    format(
      $sql$
      SELECT *
      FROM public.get_offering_route_generation_context_for_server(
        %L::uuid,
        %L::uuid
      )
      $sql$,
      intent_id,
      member_id
    )
  );

  PERFORM pg_temp.route_context_check(
    '03 anon cannot execute',
    r->>'ok' = 'false'
    AND r->>'sqlstate' = '42501'
  );

  route_evidence_before :=
    (
      SELECT count(*)
      FROM private.offering_route_evidence
    );

  journey_count_before :=
    (
      SELECT count(*)
      FROM public.journeys
    );

  alignment_count_before :=
    (
      SELECT count(*)
      FROM public.alignments
    );

  r := pg_temp.route_context_as(
    'service_role',
    format(
      $sql$
      SELECT *
      FROM public.get_offering_route_generation_context_for_server(
        %L::uuid,
        %L::uuid
      )
      $sql$,
      intent_id,
      member_id
    )
  );

  PERFORM pg_temp.route_context_check(
    '04 service role receives route-generation context',
    r->>'ok' = 'true'
    AND jsonb_array_length(r->'rows') = 1
  );

  PERFORM pg_temp.route_context_check(
    '05 returned intent and member are authoritative',
    r#>>'{rows,0,offering_movement_intent_id}' = intent_id::text
    AND r#>>'{rows,0,offering_member_id}' = member_id::text
  );

  PERFORM pg_temp.route_context_check(
    '06 returned endpoint IDs are derived from intent',
    r#>>'{rows,0,origin_location_reference_id}' = origin_id::text
    AND r#>>'{rows,0,destination_location_reference_id}' = destination_id::text
  );

  PERFORM pg_temp.route_context_check(
    '07 trusted origin coordinates returned',
    (r#>>'{rows,0,origin_latitude}')::numeric = 6.434
    AND (r#>>'{rows,0,origin_longitude}')::numeric = 3.489
  );

  PERFORM pg_temp.route_context_check(
    '08 trusted destination coordinates returned',
    (r#>>'{rows,0,destination_latitude}')::numeric = 6.469
    AND (r#>>'{rows,0,destination_longitude}')::numeric = 3.389
  );

  PERFORM pg_temp.route_context_check(
    '09 RPC creates no route evidence',
    (
      SELECT count(*)
      FROM private.offering_route_evidence
    ) = route_evidence_before
  );

  PERFORM pg_temp.route_context_check(
    '10 RPC creates no journey or alignment rows',
    (
      SELECT count(*)
      FROM public.journeys
    ) = journey_count_before
    AND
    (
      SELECT count(*)
      FROM public.alignments
    ) = alignment_count_before
  );

  r := pg_temp.route_context_as(
    'service_role',
    format(
      $sql$
      SELECT *
      FROM public.get_offering_route_generation_context_for_server(
        %L::uuid,
        %L::uuid
      )
      $sql$,
      intent_id,
      other_member_id
    )
  );

  PERFORM pg_temp.route_context_check(
    '11 wrong member is rejected',
    r->>'ok' = 'false'
    AND r->>'sqlstate' = '42501'
  );

  r := pg_temp.route_context_as(
    'service_role',
    format(
      $sql$
      SELECT *
      FROM public.get_offering_route_generation_context_for_server(
        %L::uuid,
        %L::uuid
      )
      $sql$,
      gen_random_uuid(),
      member_id
    )
  );

  PERFORM pg_temp.route_context_check(
    '12 unknown intent is rejected',
    r->>'ok' = 'false'
    AND r->>'message' = 'Offering movement intent not found'
  );

  /*
   * Deliberately create an invalid unresolved endpoint inside a nested
   * exception block. The exception rolls the fixture back automatically.
   */
  DECLARE
  unresolved_intent_id uuid := gen_random_uuid();
  unresolved_intent_key uuid := gen_random_uuid();
  unresolved_origin_id uuid := gen_random_uuid();
  unresolved_destination_id uuid := gen_random_uuid();
BEGIN
      INSERT INTO private.movement_location_references(
        id,
        owner_member_id,
        declared_label,
        source_kind,
        resolution_status,
        created_at,
        expires_at
      )
      VALUES
        (
          unresolved_origin_id,
          member_id,
          'Unresolved origin 0031',
          'member_selected',
          'unresolved',
          base_time,
          dependency_expiry
        );

      INSERT INTO private.movement_location_references(
        id,
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
      VALUES
        (
          unresolved_destination_id,
          member_id,
          'Resolved destination 0031',
          'provider_resolved',
          'resolved',
          6.500,
          3.400,
          'test-location',
          'unresolved-case-destination-0031',
          'resolver-v1',
          base_time,
          base_time,
          dependency_expiry
        );

      INSERT INTO private.offering_movement_intents(
        id,
        offering_member_id,
        intent_key,
        version,
        earliest_departure_at,
        created_at,
        expires_at,
        status
      )
      VALUES(
        unresolved_intent_id,
        member_id,
        unresolved_intent_key,
        1,
        statement_timestamp() + interval '1 hour',
        base_time,
        dependency_expiry,
        'current'
      );

      INSERT INTO private.offering_movement_intent_locations(
        intent_id,
        role,
        location_reference_id
      )
      VALUES
        (
          unresolved_intent_id,
          'origin',
          unresolved_origin_id
        ),
        (
          unresolved_intent_id,
          'destination',
          unresolved_destination_id
        );

      PERFORM
        public.get_offering_route_generation_context_for_server(
          unresolved_intent_id,
          member_id
        );

      RAISE EXCEPTION 'unresolved endpoint unexpectedly accepted';

    EXCEPTION
  WHEN check_violation THEN
    unresolved_rejected := true;
END;

  PERFORM pg_temp.route_context_check(
    '13 unresolved endpoint is rejected',
    unresolved_rejected
  );

  /*
   * Create an endpoint whose expires_at is valid relative to its created_at
   * but already elapsed relative to the current transaction time.
   * The nested exception block ensures this intentionally invalid fixture
   * leaves no pending constraint failure behind.
   */
  DECLARE
  expired_intent_id uuid := gen_random_uuid();
  expired_intent_key uuid := gen_random_uuid();
  expired_origin_id uuid := gen_random_uuid();
  expired_destination_id uuid := gen_random_uuid();

  old_created_at timestamptz :=
    transaction_timestamp() - interval '3 hours';

  old_resolved_at timestamptz :=
    transaction_timestamp() - interval '3 hours';

  old_expiry timestamptz :=
    transaction_timestamp() - interval '1 hour';
BEGIN
      INSERT INTO private.movement_location_references(
        id,
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
      VALUES
        (
          expired_origin_id,
          member_id,
          'Expired origin 0031',
          'provider_resolved',
          'resolved',
          6.410,
          3.410,
          'test-location',
          'expired-origin-0031',
          'resolver-v1',
          old_created_at,
          old_resolved_at,
          old_expiry
        ),
        (
          expired_destination_id,
          member_id,
          'Expired destination 0031',
          'provider_resolved',
          'resolved',
          6.420,
          3.420,
          'test-location',
          'expired-destination-0031',
          'resolver-v1',
          old_created_at,
          old_resolved_at,
          old_expiry
        );

      INSERT INTO private.offering_movement_intents(
        id,
        offering_member_id,
        intent_key,
        version,
        earliest_departure_at,
        created_at,
        expires_at,
        status
      )
      VALUES(
        expired_intent_id,
        member_id,
        expired_intent_key,
        1,
        statement_timestamp() + interval '1 hour',
        base_time,
        dependency_expiry,
        'current'
      );

      INSERT INTO private.offering_movement_intent_locations(
        intent_id,
        role,
        location_reference_id
      )
      VALUES
        (
          expired_intent_id,
          'origin',
          expired_origin_id
        ),
        (
          expired_intent_id,
          'destination',
          expired_destination_id
        );

      PERFORM
        public.get_offering_route_generation_context_for_server(
          expired_intent_id,
          member_id
        );

      RAISE EXCEPTION 'expired endpoint unexpectedly accepted';

    EXCEPTION
  WHEN check_violation THEN
    expired_rejected := true;
END;

  PERFORM pg_temp.route_context_check(
    '14 expired endpoint is rejected',
    expired_rejected
  );

  SET CONSTRAINTS
    private.offering_intent_complete,
    private.offering_intent_locations_complete
    IMMEDIATE;

  PERFORM pg_temp.route_context_check(
    '15 valid fixture has no deferred constraint failure',
    true
  );
END;
$route_context_test$;

SELECT
  count(*) AS tests,
  count(*) FILTER (WHERE passed) AS passed,
  count(*) FILTER (WHERE NOT passed) AS failed
FROM route_generation_context_test_results;

SELECT
  check_number,
  test_name,
  passed
FROM route_generation_context_test_results
ORDER BY check_number;

ROLLBACK;