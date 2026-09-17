BEGIN;

-- Run this WHOLE file as the database administrator after migrations 0001-0027.
-- No real users, provider calls, coordinates, routes, payments, or network calls
-- are used.
--
-- All fixtures, temporary helpers, JWT/role settings, location selections and
-- test results roll back.
--
-- Do not change the final ROLLBACK to COMMIT.

CREATE TEMP TABLE selected_location_test_results (
  check_number integer GENERATED ALWAYS AS IDENTITY,
  test_name text NOT NULL UNIQUE,
  passed boolean NOT NULL
) ON COMMIT DROP;

CREATE FUNCTION pg_temp.selected_location_check(
  p_name text,
  p_passed boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  INSERT INTO pg_temp.selected_location_test_results(test_name, passed)
  VALUES (p_name, coalesce(p_passed, false));
END;
$$;

-- Administrator-only test harness.
-- This is NOT an application RPC.
--
-- Role switching occurs before the error-catching subtransaction so a role
-- switching failure cannot accidentally look like an expected application
-- denial.

CREATE FUNCTION pg_temp.selected_location_as(
  p_role text,
  p_member uuid,
  p_sql text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  previous_role text := current_setting('role');
  previous_sub text :=
    current_setting('request.jwt.claim.sub', true);
  previous_claims text :=
    current_setting('request.jwt.claims', true);
  previous_jwt_role text :=
    current_setting('request.jwt.claim.role', true);

  rows_json jsonb;
  result_json jsonb;
BEGIN
  IF p_role NOT IN ('authenticated', 'anon', 'service_role') THEN
    RAISE EXCEPTION 'Unsupported test role';
  END IF;

  PERFORM set_config(
    'request.jwt.claim.sub',
    coalesce(p_member::text, ''),
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
      'sub', p_member,
      'role', p_role
    )::text,
    true
  );

  PERFORM set_config('role', p_role, true);

  BEGIN
    EXECUTE
      'SELECT coalesce(jsonb_agg(to_jsonb(q)), ''[]''::jsonb)
       FROM (' || p_sql || ') AS q'
    INTO rows_json;

    result_json := jsonb_build_object(
      'ok', true,
      'rows', rows_json
    );

  EXCEPTION
    WHEN OTHERS THEN
      -- Any writes from the failed statement are rolled back with this
      -- subtransaction.
      result_json := jsonb_build_object(
        'ok', false,
        'state', SQLSTATE,
        'message', SQLERRM
      );
  END;

  PERFORM set_config('role', previous_role, true);

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
$$;

REVOKE ALL
ON FUNCTION pg_temp.selected_location_as(text, uuid, text)
FROM PUBLIC;

-- DML-specific harness for INSERT/UPDATE/DELETE permission checks.
CREATE FUNCTION pg_temp.selected_location_write_as(
  p_role text,
  p_member uuid,
  p_sql text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  previous_role text := current_setting('role');
  previous_sub text :=
    current_setting('request.jwt.claim.sub', true);
  previous_claims text :=
    current_setting('request.jwt.claims', true);
  previous_jwt_role text :=
    current_setting('request.jwt.claim.role', true);

  affected_rows bigint;
  result_json jsonb;
BEGIN
  IF p_role NOT IN ('authenticated', 'anon', 'service_role') THEN
    RAISE EXCEPTION 'Unsupported test role';
  END IF;

  PERFORM set_config(
    'request.jwt.claim.sub',
    coalesce(p_member::text, ''),
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
      'sub', p_member,
      'role', p_role
    )::text,
    true
  );

  PERFORM set_config('role', p_role, true);

  BEGIN
    EXECUTE p_sql;

    GET DIAGNOSTICS affected_rows = ROW_COUNT;

    result_json := jsonb_build_object(
      'ok', true,
      'count', affected_rows
    );

  EXCEPTION
    WHEN OTHERS THEN
      result_json := jsonb_build_object(
        'ok', false,
        'state', SQLSTATE,
        'message', SQLERRM
      );
  END;

  PERFORM set_config('role', previous_role, true);

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
$$;

REVOKE ALL
ON FUNCTION pg_temp.selected_location_write_as(text, uuid, text)
FROM PUBLIC;

CREATE FUNCTION pg_temp.selected_location_denied(
  p_name text,
  p_role text,
  p_member uuid,
  p_sql text,
  p_state text,
  p_message text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  r jsonb;
BEGIN
  r := pg_temp.selected_location_as(
    p_role,
    p_member,
    p_sql
  );

  PERFORM pg_temp.selected_location_check(
    p_name,
    r->>'ok' = 'false'
    AND r->>'state' = p_state
    AND (
      p_message IS NULL
      OR r->>'message' = p_message
    )
  );
END;
$$;

REVOKE ALL
ON FUNCTION pg_temp.selected_location_denied(
  text,
  text,
  uuid,
  text,
  text,
  text
)
FROM PUBLIC;

DO $test$
DECLARE
  member_a uuid := gen_random_uuid();
  member_b uuid := gen_random_uuid();

  request_a uuid := gen_random_uuid();
  request_b uuid := gen_random_uuid();

  invalid_request_1 uuid := gen_random_uuid();
  invalid_request_2 uuid := gen_random_uuid();
  invalid_request_3 uuid := gen_random_uuid();
  invalid_request_4 uuid := gen_random_uuid();

  location_a uuid;
  location_a_replay uuid;
  location_b uuid;

  r jsonb;

  before_intents bigint;
  before_intent_locations bigint;
  before_routes bigint;
  before_resolutions bigint;

  after_intents bigint;
  after_intent_locations bigint;
  after_routes bigint;
  after_resolutions bigint;

  n bigint;
BEGIN
  -- =======================================================
  -- Fixtures
  -- =======================================================

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
    id::text || '@test-0027.invalid',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  FROM unnest(ARRAY[member_a, member_b]) ids(id);

  PERFORM pg_temp.selected_location_check(
    'auth trigger created both member rows',
    (
      SELECT count(*) = 2
      FROM public.members
      WHERE id IN (member_a, member_b)
    )
  );

  SELECT count(*)
  INTO before_intents
  FROM private.offering_movement_intents;

  SELECT count(*)
  INTO before_intent_locations
  FROM private.offering_movement_intent_locations;

  SELECT count(*)
  INTO before_routes
  FROM private.offering_route_evidence;

  SELECT count(*)
  INTO before_resolutions
  FROM private.movement_location_resolution_evidence;

  -- =======================================================
  -- First valid selected location
  -- =======================================================

  r := pg_temp.selected_location_as(
    'authenticated',
    member_a,
    format(
      'SELECT * FROM public.record_selected_location_for_member(%L,%L,%L,%L)',
      request_a,
      'Ologolo, Lekki, Lagos',
      'test-provider',
      'place-ologolo'
    )
  );

  location_a :=
    (r #>> '{rows,0,location_reference_id}')::uuid;

  PERFORM pg_temp.selected_location_check(
    'authenticated member can record a selected provider result',
    r->>'ok' = 'true'
    AND location_a IS NOT NULL
    AND r #>> '{rows,0,declared_label}'
      = 'Ologolo, Lekki, Lagos'
  );

  PERFORM pg_temp.selected_location_check(
    'selected location owner is derived from auth uid',
    (
      SELECT count(*) = 1
      FROM private.movement_location_references
      WHERE id = location_a
        AND owner_member_id = member_a
    )
  );

  PERFORM pg_temp.selected_location_check(
    'selected location is unresolved member-selected provenance',
    (
      SELECT count(*) = 1
      FROM private.movement_location_references
      WHERE id = location_a
        AND source_kind = 'member_selected'
        AND resolution_status = 'unresolved'
    )
  );

  PERFORM pg_temp.selected_location_check(
    'selected location contains no trusted coordinates or resolution result',
    (
      SELECT count(*) = 1
      FROM private.movement_location_references
      WHERE id = location_a
        AND latitude IS NULL
        AND longitude IS NULL
        AND resolution_version IS NULL
        AND resolved_at IS NULL
    )
  );

  PERFORM pg_temp.selected_location_check(
    'selected provider identity hint is preserved exactly',
    (
      SELECT count(*) = 1
      FROM private.movement_location_references
      WHERE id = location_a
        AND declared_label = 'Ologolo, Lekki, Lagos'
        AND provider_namespace = 'test-provider'
        AND provider_place_reference = 'place-ologolo'
    )
  );

  PERFORM pg_temp.selected_location_check(
    'successful selection creates exactly one immutable retry receipt',
    (
      SELECT count(*) = 1
      FROM private.movement_location_selection_receipts
      WHERE request_id = request_a
        AND location_reference_id = location_a
    )
  );

  PERFORM pg_temp.selected_location_check(
    'receipt and selected location share the same trusted creation instant',
    (
      SELECT count(*) = 1
      FROM private.movement_location_selection_receipts receipt
      JOIN private.movement_location_references location
        ON location.id = receipt.location_reference_id
      WHERE receipt.request_id = request_a
        AND receipt.recorded_at = location.created_at
    )
  );

  -- =======================================================
  -- Exact idempotent replay
  -- =======================================================

  r := pg_temp.selected_location_as(
    'authenticated',
    member_a,
    format(
      'SELECT * FROM public.record_selected_location_for_member(%L,%L,%L,%L)',
      request_a,
      'Ologolo, Lekki, Lagos',
      'test-provider',
      'place-ologolo'
    )
  );

  location_a_replay :=
    (r #>> '{rows,0,location_reference_id}')::uuid;

  PERFORM pg_temp.selected_location_check(
    'exact retry succeeds',
    r->>'ok' = 'true'
  );

  PERFORM pg_temp.selected_location_check(
    'exact retry returns the original location identity',
    location_a_replay = location_a
  );

  PERFORM pg_temp.selected_location_check(
    'exact retry does not duplicate the location or receipt',
    (
      SELECT
        (
          SELECT count(*)
          FROM private.movement_location_references
          WHERE id = location_a
        ) = 1
        AND
        (
          SELECT count(*)
          FROM private.movement_location_selection_receipts
          WHERE request_id = request_a
        ) = 1
    )
  );

  -- =======================================================
  -- Changed replay must fail closed
  -- =======================================================

  PERFORM pg_temp.selected_location_denied(
    'changed label replay is rejected',
    'authenticated',
    member_a,
    format(
      'SELECT * FROM public.record_selected_location_for_member(%L,%L,%L,%L)',
      request_a,
      'Ologolo Bus Stop, Lekki, Lagos',
      'test-provider',
      'place-ologolo'
    ),
    '23514',
    'Selection request replay does not match the original request'
  );

  PERFORM pg_temp.selected_location_denied(
    'changed provider reference replay is rejected',
    'authenticated',
    member_a,
    format(
      'SELECT * FROM public.record_selected_location_for_member(%L,%L,%L,%L)',
      request_a,
      'Ologolo, Lekki, Lagos',
      'test-provider',
      'different-place'
    ),
    '23514',
    'Selection request replay does not match the original request'
  );

  PERFORM pg_temp.selected_location_denied(
    'another member cannot reuse the first member request identity',
    'authenticated',
    member_b,
    format(
      'SELECT * FROM public.record_selected_location_for_member(%L,%L,%L,%L)',
      request_a,
      'Ologolo, Lekki, Lagos',
      'test-provider',
      'place-ologolo'
    ),
    '23514',
    'Selection request replay does not match the original request'
  );

  -- =======================================================
  -- Independent selection by another member
  -- =======================================================

  r := pg_temp.selected_location_as(
    'authenticated',
    member_b,
    format(
      'SELECT * FROM public.record_selected_location_for_member(%L,%L,%L,%L)',
      request_b,
      'Ikeja City Mall, Ikeja, Lagos',
      'test-provider',
      'place-ikeja-city-mall'
    )
  );

  location_b :=
    (r #>> '{rows,0,location_reference_id}')::uuid;

  PERFORM pg_temp.selected_location_check(
    'second member can create an independent selection',
    r->>'ok' = 'true'
    AND location_b IS NOT NULL
    AND location_b <> location_a
  );

  PERFORM pg_temp.selected_location_check(
    'second selection belongs only to the authenticated second member',
    (
      SELECT count(*) = 1
      FROM private.movement_location_references
      WHERE id = location_b
        AND owner_member_id = member_b
        AND source_kind = 'member_selected'
        AND resolution_status = 'unresolved'
    )
  );

  -- =======================================================
  -- Input validation
  -- =======================================================

  PERFORM pg_temp.selected_location_denied(
    'blank selected label is rejected',
    'authenticated',
    member_a,
    format(
      'SELECT * FROM public.record_selected_location_for_member(%L,%L,%L,%L)',
      invalid_request_1,
      '',
      'test-provider',
      'place-invalid-1'
    ),
    '23514',
    'Selected location label is invalid'
  );

  PERFORM pg_temp.selected_location_denied(
    'untrimmed selected label is rejected',
    'authenticated',
    member_a,
    format(
      'SELECT * FROM public.record_selected_location_for_member(%L,%L,%L,%L)',
      invalid_request_2,
      ' Ologolo, Lekki, Lagos ',
      'test-provider',
      'place-invalid-2'
    ),
    '23514',
    'Selected location label is invalid'
  );

  PERFORM pg_temp.selected_location_denied(
    'blank provider namespace is rejected',
    'authenticated',
    member_a,
    format(
      'SELECT * FROM public.record_selected_location_for_member(%L,%L,%L,%L)',
      invalid_request_3,
      'Ologolo, Lekki, Lagos',
      '',
      'place-invalid-3'
    ),
    '23514',
    'Selected location provider namespace is invalid'
  );

  PERFORM pg_temp.selected_location_denied(
    'blank provider place reference is rejected',
    'authenticated',
    member_a,
    format(
      'SELECT * FROM public.record_selected_location_for_member(%L,%L,%L,%L)',
      invalid_request_4,
      'Ologolo, Lekki, Lagos',
      'test-provider',
      ''
    ),
    '23514',
    'Selected location provider reference is invalid'
  );

  PERFORM pg_temp.selected_location_check(
    'failed input attempts create no extra selected-location rows',
    (
      SELECT count(*) = 2
      FROM private.movement_location_references
      WHERE owner_member_id IN (member_a, member_b)
    )
  );

  PERFORM pg_temp.selected_location_check(
    'failed input attempts create no extra retry receipts',
    (
      SELECT count(*) = 2
      FROM private.movement_location_selection_receipts
      WHERE location_reference_id IN (location_a, location_b)
    )
  );

  -- =======================================================
  -- ACL enforcement
  -- =======================================================

  PERFORM pg_temp.selected_location_denied(
    'anonymous role cannot execute selected-location writer',
    'anon',
    NULL,
    format(
      'SELECT * FROM public.record_selected_location_for_member(%L,%L,%L,%L)',
      gen_random_uuid(),
      'Lekki Phase 1, Lagos',
      'test-provider',
      'place-anon'
    ),
    '42501'
  );

  PERFORM pg_temp.selected_location_denied(
    'service role cannot execute member selected-location writer',
    'service_role',
    NULL,
    format(
      'SELECT * FROM public.record_selected_location_for_member(%L,%L,%L,%L)',
      gen_random_uuid(),
      'Lekki Phase 1, Lagos',
      'test-provider',
      'place-service'
    ),
    '42501'
  );

  PERFORM pg_temp.selected_location_denied(
    'authenticated client cannot directly read private selection receipts',
    'authenticated',
    member_a,
    'SELECT * FROM private.movement_location_selection_receipts',
    '42501'
  );

  r := pg_temp.selected_location_write_as(
    'authenticated',
    member_a,
    format(
      'INSERT INTO private.movement_location_selection_receipts(request_id,location_reference_id) VALUES (%L,%L)',
      gen_random_uuid(),
      location_a
    )
  );

  PERFORM pg_temp.selected_location_check(
    'authenticated client cannot directly insert private selection receipts',
    r->>'ok' = 'false'
    AND r->>'state' = '42501'
  );

  -- =======================================================
  -- Receipt immutability, tested as administrator
  -- =======================================================

  BEGIN
    UPDATE private.movement_location_selection_receipts
    SET recorded_at = recorded_at
    WHERE request_id = request_a;

    PERFORM pg_temp.selected_location_check(
      'receipt no-op update is rejected',
      false
    );

  EXCEPTION
    WHEN OTHERS THEN
      PERFORM pg_temp.selected_location_check(
        'receipt no-op update is rejected',
        SQLSTATE = '23514'
        AND SQLERRM = 'Selected location receipt history is immutable'
      );
  END;

  BEGIN
    DELETE FROM private.movement_location_selection_receipts
    WHERE request_id = request_a;

    PERFORM pg_temp.selected_location_check(
      'receipt deletion is rejected',
      false
    );

  EXCEPTION
    WHEN OTHERS THEN
      PERFORM pg_temp.selected_location_check(
        'receipt deletion is rejected',
        SQLSTATE = '23514'
        AND SQLERRM = 'Selected location receipt history cannot be deleted'
      );
  END;

  -- =======================================================
  -- 0027 must not create later-stage movement objects
  -- =======================================================

  SELECT count(*)
  INTO after_intents
  FROM private.offering_movement_intents;

  SELECT count(*)
  INTO after_intent_locations
  FROM private.offering_movement_intent_locations;

  SELECT count(*)
  INTO after_routes
  FROM private.offering_route_evidence;

  SELECT count(*)
  INTO after_resolutions
  FROM private.movement_location_resolution_evidence;

  PERFORM pg_temp.selected_location_check(
    'selected-location intake creates no offering intent',
    after_intents = before_intents
  );

  PERFORM pg_temp.selected_location_check(
    'selected-location intake binds no offering intent endpoint',
    after_intent_locations = before_intent_locations
  );

  PERFORM pg_temp.selected_location_check(
    'selected-location intake creates no route evidence',
    after_routes = before_routes
  );

  PERFORM pg_temp.selected_location_check(
    'selected-location intake creates no trusted resolution evidence',
    after_resolutions = before_resolutions
  );

  PERFORM pg_temp.selected_location_check(
    'neither selected location has been silently resolved',
    (
      SELECT count(*) = 2
      FROM private.movement_location_references
      WHERE id IN (location_a, location_b)
        AND source_kind = 'member_selected'
        AND resolution_status = 'unresolved'
        AND latitude IS NULL
        AND longitude IS NULL
        AND resolved_at IS NULL
        AND resolution_version IS NULL
    )
  );

  SELECT count(*)
  INTO n
  FROM private.movement_location_resolution_evidence
  WHERE source_location_reference_id IN (location_a, location_b)
     OR resolved_location_reference_id IN (location_a, location_b);

  PERFORM pg_temp.selected_location_check(
    'selected locations have no resolution evidence',
    n = 0
  );

END;
$test$;

-- Show every named behavioral result.
SELECT
  check_number,
  test_name,
  passed
FROM pg_temp.selected_location_test_results
ORDER BY check_number;

-- Final summary must report failed = 0.
SELECT
  count(*) AS checks,
  count(*) FILTER (WHERE passed) AS passed,
  count(*) FILTER (WHERE NOT passed) AS failed
FROM pg_temp.selected_location_test_results;

ROLLBACK;