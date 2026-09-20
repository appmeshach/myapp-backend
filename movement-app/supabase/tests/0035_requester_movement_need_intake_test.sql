BEGIN;

SET TRANSACTION ISOLATION LEVEL READ COMMITTED;


-- =========================================================
-- Results
-- =========================================================

CREATE TEMP TABLE requester_need_results (
  test_number integer GENERATED ALWAYS AS IDENTITY,
  test_name text NOT NULL UNIQUE,
  passed boolean NOT NULL,
  diagnostic text
) ON COMMIT DROP;


CREATE FUNCTION pg_temp.requester_need_check(
  p_name text,
  p_passed boolean,
  p_diagnostic text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $check$
BEGIN
  INSERT INTO pg_temp.requester_need_results(
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
ON FUNCTION pg_temp.requester_need_check(
  text,
  boolean,
  text
)
FROM PUBLIC;


-- =========================================================
-- Execute SQL as an application role/member
-- =========================================================

CREATE FUNCTION pg_temp.requester_need_as(
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
ON FUNCTION pg_temp.requester_need_as(
  text,
  uuid,
  text
)
FROM PUBLIC;


-- =========================================================
-- Execute a non-query statement as an application role/member
-- =========================================================

CREATE FUNCTION pg_temp.requester_need_exec_as(
  p_role text,
  p_member_id uuid,
  p_sql text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $exec_as_member$
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
$exec_as_member$;

REVOKE ALL
ON FUNCTION pg_temp.requester_need_exec_as(
  text,
  uuid,
  text
)
FROM PUBLIC;


-- =========================================================
-- Expected-error helper
-- =========================================================

CREATE FUNCTION pg_temp.requester_need_error(
  p_name text,
  p_sql text,
  p_state text,
  p_message text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $expected_error$
DECLARE
  observed_state text;
  observed_message text;
BEGIN
  BEGIN
    EXECUTE p_sql;

    observed_state := 'NO_ERROR';
    observed_message :=
      'statement unexpectedly succeeded';

  EXCEPTION
    WHEN OTHERS THEN
      observed_state := SQLSTATE;
      observed_message := SQLERRM;
  END;

  PERFORM pg_temp.requester_need_check(
    p_name,
    observed_state = p_state
      AND (
        p_message IS NULL
        OR observed_message = p_message
      ),
    observed_state
      || ': '
      || coalesce(observed_message, '')
  );
END;
$expected_error$;

REVOKE ALL
ON FUNCTION pg_temp.requester_need_error(
  text,
  text,
  text,
  text
)
FROM PUBLIC;


-- =========================================================
-- Behavioral tests
-- =========================================================

DO $test$
DECLARE
  member_a uuid := gen_random_uuid();
  member_b uuid := gen_random_uuid();

  request_a uuid := gen_random_uuid();
  request_b uuid := gen_random_uuid();
  request_c uuid := gen_random_uuid();
  request_d uuid := gen_random_uuid();
  request_e uuid := gen_random_uuid();
  request_f uuid := gen_random_uuid();
  request_g uuid := gen_random_uuid();
  request_h uuid := gen_random_uuid();

  origin_a uuid;
  destination_a uuid;

  origin_b uuid;
  destination_b uuid;

  unresolved_a uuid;
  expiring_a uuid;

  need_a uuid;
  replay_need uuid;
  deleted_need uuid;

  created_time timestamptz;
  departure_earliest timestamptz;
  departure_latest timestamptz;

  r jsonb;
  n bigint;

  before_offers bigint;
  before_alignments bigint;
  before_journeys bigint;
  before_routes bigint;
  before_snapshots bigint;

  after_offers bigint;
  after_alignments bigint;
  after_journeys bigint;
  after_routes bigint;
  after_snapshots bigint;
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
    id::text || '@test-0035.invalid',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  FROM unnest(
    ARRAY[
      member_a,
      member_b
    ]
  ) ids(id);


  PERFORM pg_temp.requester_need_check(
    'auth trigger created both member rows',
    (
      SELECT count(*) = 2
      FROM public.members
      WHERE id IN (
        member_a,
        member_b
      )
    )
  );


  -- -------------------------------------------------------
  -- Trusted endpoints owned by member A
  -- -------------------------------------------------------

  created_time := clock_timestamp();

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
    member_a,
    'Agungi, Lagos',
    'provider_resolved',
    'resolved',
    6.4300,
    3.5200,
    'test-provider',
    'place-agungi',
    'test-resolution-v1',
    created_time,
    created_time,
    created_time + interval '2 hours'
  )
  RETURNING id
  INTO origin_a;


  created_time := clock_timestamp();

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
    member_a,
    'Oniru, Lagos',
    'provider_resolved',
    'resolved',
    6.4310,
    3.4430,
    'test-provider',
    'place-oniru',
    'test-resolution-v1',
    created_time,
    created_time,
    created_time + interval '2 hours'
  )
  RETURNING id
  INTO destination_a;


  -- -------------------------------------------------------
  -- Trusted endpoints owned by member B
  -- -------------------------------------------------------

  created_time := clock_timestamp();

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
    member_b,
    'Ikeja, Lagos',
    'provider_resolved',
    'resolved',
    6.6018,
    3.3515,
    'test-provider',
    'place-ikeja',
    'test-resolution-v1',
    created_time,
    created_time,
    created_time + interval '2 hours'
  )
  RETURNING id
  INTO origin_b;


  created_time := clock_timestamp();

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
    member_b,
    'Yaba, Lagos',
    'provider_resolved',
    'resolved',
    6.5158,
    3.3707,
    'test-provider',
    'place-yaba',
    'test-resolution-v1',
    created_time,
    created_time,
    created_time + interval '2 hours'
  )
  RETURNING id
  INTO destination_b;


  -- -------------------------------------------------------
  -- Unresolved member-selected location
  -- -------------------------------------------------------

  created_time := clock_timestamp();

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
    member_a,
    'Lekki Phase 1, Lagos',
    'member_selected',
    'unresolved',
    NULL,
    NULL,
    'test-provider',
    'place-lekki-phase-1',
    NULL,
    created_time,
    NULL,
    NULL
  )
  RETURNING id
  INTO unresolved_a;


  -- -------------------------------------------------------
  -- Short-lived trusted endpoint
  -- -------------------------------------------------------

  created_time := clock_timestamp();

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
    member_a,
    'Short-lived requester test point',
    'provider_resolved',
    'resolved',
    6.5000,
    3.4000,
    'test-provider',
    'place-requester-short-lived',
    'test-resolution-v1',
    created_time,
    created_time,
    created_time + interval '1 second'
  )
  RETURNING id
  INTO expiring_a;


  departure_earliest :=
    statement_timestamp() + interval '2 hours';

  departure_latest :=
    statement_timestamp() + interval '3 hours';


  SELECT count(*)
  INTO before_offers
  FROM public.movement_offers;

  SELECT count(*)
  INTO before_alignments
  FROM public.alignments;

  SELECT count(*)
  INTO before_journeys
  FROM public.journeys;

  SELECT count(*)
  INTO before_routes
  FROM private.offering_route_evidence;

  SELECT count(*)
  INTO before_snapshots
  FROM private.movement_context_snapshots;


  -- =======================================================
  -- RPC / table security boundary
  -- =======================================================

  PERFORM pg_temp.requester_need_check(
    'authenticated can execute requester movement need intake',
    has_function_privilege(
      'authenticated',
      'public.create_movement_need(uuid,uuid,uuid,timestamptz,timestamptz,integer)',
      'EXECUTE'
    )
  );


  PERFORM pg_temp.requester_need_check(
    'anon cannot execute requester movement need intake',
    NOT has_function_privilege(
      'anon',
      'public.create_movement_need(uuid,uuid,uuid,timestamptz,timestamptz,integer)',
      'EXECUTE'
    )
  );


  PERFORM pg_temp.requester_need_check(
    'service role cannot execute member requester intake',
    NOT has_function_privilege(
      'service_role',
      'public.create_movement_need(uuid,uuid,uuid,timestamptz,timestamptz,integer)',
      'EXECUTE'
    )
  );


  PERFORM pg_temp.requester_need_check(
    'authenticated direct movement need insert privilege is removed',
    NOT has_table_privilege(
      'authenticated',
      'public.movement_needs',
      'INSERT'
    )
  );


  PERFORM pg_temp.requester_need_check(
    'legacy authenticated insert policy is removed',
    NOT EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'movement_needs'
        AND policyname = 'movement_needs_insert_own'
    )
  );


  PERFORM pg_temp.requester_need_check(
    'trusted requester location table has RLS enabled',
    (
      SELECT c.relrowsecurity
      FROM pg_class c
      JOIN pg_namespace n
        ON n.oid = c.relnamespace
      WHERE n.nspname = 'private'
        AND c.relname = 'movement_need_locations'
    )
  );


  PERFORM pg_temp.requester_need_check(
    'requester receipt table has RLS enabled',
    (
      SELECT c.relrowsecurity
      FROM pg_class c
      JOIN pg_namespace n
        ON n.oid = c.relnamespace
      WHERE n.nspname = 'private'
        AND c.relname =
          'movement_need_creation_receipts'
    )
  );


  PERFORM pg_temp.requester_need_check(
    'trusted requester location table has no application policies',
    NOT EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'private'
        AND tablename = 'movement_need_locations'
    )
  );


  PERFORM pg_temp.requester_need_check(
    'requester receipt table has no application policies',
    NOT EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'private'
        AND tablename =
          'movement_need_creation_receipts'
    )
  );


  PERFORM pg_temp.requester_need_check(
    'authenticated has no direct trusted requester location privileges',
    NOT has_table_privilege(
      'authenticated',
      'private.movement_need_locations',
      'SELECT'
    )
    AND NOT has_table_privilege(
      'authenticated',
      'private.movement_need_locations',
      'INSERT'
    )
    AND NOT has_table_privilege(
      'authenticated',
      'private.movement_need_locations',
      'UPDATE'
    )
    AND NOT has_table_privilege(
      'authenticated',
      'private.movement_need_locations',
      'DELETE'
    )
  );


  PERFORM pg_temp.requester_need_check(
    'authenticated has no direct requester receipt privileges',
    NOT has_table_privilege(
      'authenticated',
      'private.movement_need_creation_receipts',
      'SELECT'
    )
    AND NOT has_table_privilege(
      'authenticated',
      'private.movement_need_creation_receipts',
      'INSERT'
    )
    AND NOT has_table_privilege(
      'authenticated',
      'private.movement_need_creation_receipts',
      'UPDATE'
    )
    AND NOT has_table_privilege(
      'authenticated',
      'private.movement_need_creation_receipts',
      'DELETE'
    )
  );


  -- =======================================================
  -- Direct authenticated insert must fail
  -- =======================================================

    r := pg_temp.requester_need_exec_as(
    'authenticated',
    member_a,
    format(
      'INSERT INTO public.movement_needs(
         member_id,
         origin_area,
         destination_area,
         earliest_departure_at,
         people_count
       )
       VALUES(
         %L::uuid,
         ''Fake origin'',
         ''Fake destination'',
         statement_timestamp() + interval ''2 hours'',
         1
       )',
      member_a
    )
  );


  PERFORM pg_temp.requester_need_check(
    'authenticated client cannot bypass trusted intake with direct insert',
    r->>'ok' = 'false'
      AND r->>'state' = '42501',
    r::text
  );


  -- =======================================================
  -- First valid creation
  -- =======================================================

  r := pg_temp.requester_need_as(
    'authenticated',
    member_a,
    format(
      'SELECT * FROM public.create_movement_need(
         %L::uuid,
         %L::uuid,
         %L::uuid,
         %L::timestamptz,
         %L::timestamptz,
         1
       )',
      request_a,
      origin_a,
      destination_a,
      departure_earliest,
      departure_latest
    )
  );


  need_a :=
    (r #>> '{rows,0,movement_need_id}')::uuid;


  PERFORM pg_temp.requester_need_check(
    'authenticated member can create trusted movement need',
    r->>'ok' = 'true'
      AND need_a IS NOT NULL,
    r::text
  );


  PERFORM pg_temp.requester_need_check(
    'requesting member identity is derived from auth uid',
    (
      SELECT n.member_id = member_a
      FROM public.movement_needs n
      WHERE n.id = need_a
    )
  );


  PERFORM pg_temp.requester_need_check(
    'movement need status is server controlled',
    (
      SELECT n.status = 'discoverable'
      FROM public.movement_needs n
      WHERE n.id = need_a
    )
  );


  PERFORM pg_temp.requester_need_check(
    'legacy display labels are derived from trusted locations',
    (
      SELECT
        n.origin_area = 'Agungi, Lagos'
        AND n.destination_area = 'Oniru, Lagos'
      FROM public.movement_needs n
      WHERE n.id = need_a
    )
  );


  PERFORM pg_temp.requester_need_check(
    'departure window and people count are preserved',
    (
      SELECT
        n.earliest_departure_at = departure_earliest
        AND n.latest_departure_at = departure_latest
        AND n.people_count = 1
      FROM public.movement_needs n
      WHERE n.id = need_a
    )
  );


  PERFORM pg_temp.requester_need_check(
    'movement need has exactly trusted origin and destination bindings',
    (
      SELECT count(*) = 2
      FROM private.movement_need_locations l
      WHERE l.movement_need_id = need_a
    )
    AND EXISTS (
      SELECT 1
      FROM private.movement_need_locations l
      WHERE l.movement_need_id = need_a
        AND l.role = 'origin'
        AND l.location_reference_id = origin_a
    )
    AND EXISTS (
      SELECT 1
      FROM private.movement_need_locations l
      WHERE l.movement_need_id = need_a
        AND l.role = 'destination'
        AND l.location_reference_id = destination_a
    )
  );


  PERFORM pg_temp.requester_need_check(
    'creation receipt binds request to exact authenticated input',
    EXISTS (
      SELECT 1
      FROM private.movement_need_creation_receipts cr
      WHERE cr.request_id = request_a
        AND cr.requesting_member_id = member_a
        AND cr.movement_need_id = need_a
        AND cr.origin_location_reference_id = origin_a
        AND cr.destination_location_reference_id = destination_a
        AND cr.earliest_departure_at = departure_earliest
        AND cr.latest_departure_at = departure_latest
        AND cr.people_count = 1
    )
  );


  -- =======================================================
  -- Existing primary-requester trigger still works
  -- =======================================================

  PERFORM pg_temp.requester_need_check(
    'movement need automatically creates confirmed primary requester',
    EXISTS (
      SELECT 1
      FROM public.movement_participants mp
      WHERE mp.movement_need_id = need_a
        AND mp.member_id = member_a
        AND mp.role = 'primary_requester'
        AND mp.status = 'confirmed'
        AND mp.invited_by_member_id IS NULL
    )
  );


  PERFORM pg_temp.requester_need_check(
    'valid intake creates exactly one primary requester row',
    (
      SELECT count(*) = 1
      FROM public.movement_participants mp
      WHERE mp.movement_need_id = need_a
        AND mp.role = 'primary_requester'
    )
  );


  -- =======================================================
  -- Exact idempotent replay
  -- =======================================================

  r := pg_temp.requester_need_as(
    'authenticated',
    member_a,
    format(
      'SELECT * FROM public.create_movement_need(
         %L::uuid,
         %L::uuid,
         %L::uuid,
         %L::timestamptz,
         %L::timestamptz,
         1
       )',
      request_a,
      origin_a,
      destination_a,
      departure_earliest,
      departure_latest
    )
  );


  replay_need :=
    (r #>> '{rows,0,movement_need_id}')::uuid;


  PERFORM pg_temp.requester_need_check(
    'exact replay returns same movement need',
    r->>'ok' = 'true'
      AND replay_need = need_a,
    r::text
  );


  SELECT count(*)
  INTO n
  FROM private.movement_need_creation_receipts
  WHERE request_id = request_a;


  PERFORM pg_temp.requester_need_check(
    'exact replay does not create second receipt',
    n = 1,
    n::text
  );


  SELECT count(*)
  INTO n
  FROM public.movement_needs
  WHERE id = need_a;


  PERFORM pg_temp.requester_need_check(
    'exact replay does not create second movement need',
    n = 1,
    n::text
  );


  SELECT count(*)
  INTO n
  FROM public.movement_participants
  WHERE movement_need_id = need_a
    AND role = 'primary_requester';


  PERFORM pg_temp.requester_need_check(
    'exact replay does not duplicate primary requester',
    n = 1,
    n::text
  );


  -- =======================================================
  -- Deleted original remains a burned request identity
  -- =======================================================

  r := pg_temp.requester_need_as(
    'authenticated',
    member_a,
    format(
      'SELECT * FROM public.create_movement_need(
         %L::uuid,
         %L::uuid,
         %L::uuid,
         %L::timestamptz,
         %L::timestamptz,
         1
       )',
      request_h,
      origin_a,
      destination_a,
      departure_earliest,
      departure_latest
    )
  );

  deleted_need :=
    (r #>> '{rows,0,movement_need_id}')::uuid;

  PERFORM pg_temp.requester_need_check(
    'deletion replay fixture movement need is created',
    r->>'ok' = 'true'
      AND deleted_need IS NOT NULL,
    r::text
  );

  r := pg_temp.requester_need_exec_as(
    'authenticated',
    member_a,
    format(
      'DELETE FROM public.movement_needs
       WHERE id = %L::uuid',
      deleted_need
    )
  );

  PERFORM pg_temp.requester_need_check(
    'owner can delete movement need while creation receipt survives',
    r->>'ok' = 'true'
      AND NOT EXISTS (
        SELECT 1
        FROM public.movement_needs n
        WHERE n.id = deleted_need
      )
      AND EXISTS (
        SELECT 1
        FROM private.movement_need_creation_receipts cr
        WHERE cr.request_id = request_h
          AND cr.movement_need_id = deleted_need
      ),
    r::text
  );

  r := pg_temp.requester_need_as(
    'authenticated',
    member_a,
    format(
      'SELECT * FROM public.create_movement_need(
         %L::uuid,
         %L::uuid,
         %L::uuid,
         %L::timestamptz,
         %L::timestamptz,
         1
       )',
      request_h,
      origin_a,
      destination_a,
      departure_earliest,
      departure_latest
    )
  );

  PERFORM pg_temp.requester_need_check(
    'replay after original movement need deletion is rejected',
    r->>'ok' = 'false'
      AND r->>'state' = '23514'
      AND r->>'message' =
        'Original movement need for this request no longer exists',
    r::text
  );


  -- =======================================================
  -- Replay mutation protection
  -- =======================================================

  r := pg_temp.requester_need_as(
    'authenticated',
    member_a,
    format(
      'SELECT * FROM public.create_movement_need(
         %L::uuid,
         %L::uuid,
         %L::uuid,
         %L::timestamptz,
         %L::timestamptz,
         2
       )',
      request_a,
      origin_a,
      destination_a,
      departure_earliest,
      departure_latest
    )
  );


  PERFORM pg_temp.requester_need_check(
    'changed people count replay is rejected',
    r->>'ok' = 'false'
      AND r->>'state' = '23514'
      AND r->>'message' =
        'Movement need request replay does not match the original request',
    r::text
  );


  r := pg_temp.requester_need_as(
    'authenticated',
    member_a,
    format(
      'SELECT * FROM public.create_movement_need(
         %L::uuid,
         %L::uuid,
         %L::uuid,
         %L::timestamptz,
         %L::timestamptz,
         1
       )',
      request_a,
      origin_a,
      destination_a,
      departure_earliest + interval '1 minute',
      departure_latest
    )
  );


  PERFORM pg_temp.requester_need_check(
    'changed departure replay is rejected',
    r->>'ok' = 'false'
      AND r->>'state' = '23514'
      AND r->>'message' =
        'Movement need request replay does not match the original request',
    r::text
  );


  r := pg_temp.requester_need_as(
    'authenticated',
    member_b,
    format(
      'SELECT * FROM public.create_movement_need(
         %L::uuid,
         %L::uuid,
         %L::uuid,
         %L::timestamptz,
         %L::timestamptz,
         1
       )',
      request_a,
      origin_b,
      destination_b,
      departure_earliest,
      departure_latest
    )
  );


  PERFORM pg_temp.requester_need_check(
    'another member cannot reuse first member request identity',
    r->>'ok' = 'false'
      AND r->>'state' = '23514'
      AND r->>'message' =
        'Movement need request replay does not match the original request',
    r::text
  );


  -- =======================================================
  -- Trusted endpoint enforcement
  -- =======================================================

  r := pg_temp.requester_need_as(
    'authenticated',
    member_a,
    format(
      'SELECT * FROM public.create_movement_need(
         %L::uuid,
         %L::uuid,
         %L::uuid,
         statement_timestamp() + interval ''2 hours'',
         NULL,
         1
       )',
      request_b,
      unresolved_a,
      destination_a
    )
  );


  PERFORM pg_temp.requester_need_check(
    'unresolved selected requester endpoint is rejected',
    r->>'ok' = 'false'
      AND r->>'state' = '23514'
      AND r->>'message' =
        'Movement need requires trusted resolved locations',
    r::text
  );


  r := pg_temp.requester_need_as(
    'authenticated',
    member_a,
    format(
      'SELECT * FROM public.create_movement_need(
         %L::uuid,
         %L::uuid,
         %L::uuid,
         statement_timestamp() + interval ''2 hours'',
         NULL,
         1
       )',
      request_c,
      origin_b,
      destination_a
    )
  );


  PERFORM pg_temp.requester_need_check(
    'foreign member requester endpoint is rejected',
    r->>'ok' = 'false'
      AND r->>'state' = '42501'
      AND r->>'message' =
        'Movement need locations do not belong to the authenticated member',
    r::text
  );


  r := pg_temp.requester_need_as(
    'authenticated',
    member_a,
    format(
      'SELECT * FROM public.create_movement_need(
         %L::uuid,
         %L::uuid,
         %L::uuid,
         statement_timestamp() + interval ''2 hours'',
         NULL,
         1
       )',
      request_d,
      origin_a,
      origin_a
    )
  );


  PERFORM pg_temp.requester_need_check(
    'same requester origin and destination are rejected',
    r->>'ok' = 'false'
      AND r->>'state' = '23514'
      AND r->>'message' =
        'Movement need requires distinct origin and destination',
    r::text
  );


  r := pg_temp.requester_need_as(
    'authenticated',
    member_a,
    format(
      'SELECT * FROM public.create_movement_need(
         %L::uuid,
         %L::uuid,
         %L::uuid,
         statement_timestamp() + interval ''2 hours'',
         NULL,
         0
       )',
      request_e,
      origin_a,
      destination_a
    )
  );


  PERFORM pg_temp.requester_need_check(
    'zero people count is rejected',
    r->>'ok' = 'false'
      AND r->>'state' = '23514'
      AND r->>'message' =
        'Movement need people count must be at least one',
    r::text
  );


  -- =======================================================
  -- Existing 24-hour planning horizon remains authoritative
  -- =======================================================

  r := pg_temp.requester_need_as(
    'authenticated',
    member_a,
    format(
      'SELECT * FROM public.create_movement_need(
         %L::uuid,
         %L::uuid,
         %L::uuid,
         statement_timestamp() + interval ''24 hours 1 minute'',
         NULL,
         1
       )',
      request_f,
      origin_a,
      destination_a
    )
  );


  PERFORM pg_temp.requester_need_check(
    'requester intake cannot bypass 24 hour planning horizon',
    r->>'ok' = 'false'
      AND r->>'state' = '23514'
      AND r->>'message' =
        'Earliest departure must be within the next 24 hours',
    r::text
  );


  r := pg_temp.requester_need_as(
    'authenticated',
    member_a,
    format(
      'SELECT * FROM public.create_movement_need(
         %L::uuid,
         %L::uuid,
         %L::uuid,
         statement_timestamp() - interval ''1 second'',
         NULL,
         1
       )',
      request_g,
      origin_a,
      destination_a
    )
  );


  PERFORM pg_temp.requester_need_check(
    'requester intake cannot create past departure',
    r->>'ok' = 'false'
      AND r->>'state' = '23514'
      AND r->>'message' =
        'Earliest departure cannot be in the past',
    r::text
  );


  -- =======================================================
  -- Expired trusted endpoint
  -- =======================================================

  PERFORM pg_sleep(1.1);


  r := pg_temp.requester_need_as(
    'authenticated',
    member_a,
    format(
      'SELECT * FROM public.create_movement_need(
         %L::uuid,
         %L::uuid,
         %L::uuid,
         statement_timestamp() + interval ''2 hours'',
         NULL,
         1
       )',
      gen_random_uuid(),
      expiring_a,
      destination_a
    )
  );


  PERFORM pg_temp.requester_need_check(
    'expired trusted requester endpoint is rejected',
    r->>'ok' = 'false'
      AND r->>'state' = '23514'
      AND r->>'message' =
        'Movement need trusted location has expired',
    r::text
  );


  -- =======================================================
  -- Trusted binding immutability
  -- =======================================================

  PERFORM pg_temp.requester_need_error(
    'trusted origin binding cannot be changed',
    format(
      'UPDATE private.movement_need_locations
       SET location_reference_id = %L
       WHERE movement_need_id = %L
         AND role = ''origin''',
      destination_a,
      need_a
    ),
    '23514',
    'Movement need trusted location bindings are immutable'
  );


  -- =======================================================
  -- Receipt immutability
  -- =======================================================

  PERFORM pg_temp.requester_need_error(
    'movement need creation receipt cannot be updated',
    format(
      'UPDATE private.movement_need_creation_receipts
       SET recorded_at = recorded_at
       WHERE request_id = %L',
      request_a
    ),
    '23514',
    'Movement need creation receipts are immutable'
  );


  PERFORM pg_temp.requester_need_error(
    'movement need creation receipt cannot be deleted',
    format(
      'DELETE FROM private.movement_need_creation_receipts
       WHERE request_id = %L',
      request_a
    ),
    '23514',
    'Movement need creation receipts are immutable'
  );


  -- =======================================================
  -- No unrelated operational side effects
  -- =======================================================

  SELECT count(*)
  INTO after_offers
  FROM public.movement_offers;

  SELECT count(*)
  INTO after_alignments
  FROM public.alignments;

  SELECT count(*)
  INTO after_journeys
  FROM public.journeys;

  SELECT count(*)
  INTO after_routes
  FROM private.offering_route_evidence;

  SELECT count(*)
  INTO after_snapshots
  FROM private.movement_context_snapshots;


  PERFORM pg_temp.requester_need_check(
    'requester intake creates no movement offer',
    after_offers = before_offers,
    before_offers::text || ' -> ' || after_offers::text
  );


  PERFORM pg_temp.requester_need_check(
    'requester intake creates no alignment',
    after_alignments = before_alignments,
    before_alignments::text
      || ' -> '
      || after_alignments::text
  );


  PERFORM pg_temp.requester_need_check(
    'requester intake creates no journey',
    after_journeys = before_journeys,
    before_journeys::text
      || ' -> '
      || after_journeys::text
  );


  PERFORM pg_temp.requester_need_check(
    'requester intake creates no offering route evidence',
    after_routes = before_routes,
    before_routes::text
      || ' -> '
      || after_routes::text
  );


  PERFORM pg_temp.requester_need_check(
    'requester intake creates no movement context snapshot',
    after_snapshots = before_snapshots,
    before_snapshots::text
      || ' -> '
      || after_snapshots::text
  );

END;
$test$;


SELECT
  test_number,
  test_name,
  passed,
  diagnostic
FROM pg_temp.requester_need_results
ORDER BY test_number;


SELECT
  count(*) AS tests,
  count(*) FILTER (
    WHERE passed
  ) AS passed,
  count(*) FILTER (
    WHERE NOT passed
  ) AS failed
FROM pg_temp.requester_need_results;


ROLLBACK;
