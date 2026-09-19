BEGIN;

CREATE TEMP TABLE pg_temp.offering_intent_results (
  test_name text PRIMARY KEY,
  passed boolean NOT NULL,
  diagnostic text
) ON COMMIT DROP;


CREATE FUNCTION pg_temp.offering_intent_check(
  p_name text,
  p_passed boolean,
  p_diagnostic text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  INSERT INTO pg_temp.offering_intent_results(
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
$$;

REVOKE ALL
ON FUNCTION pg_temp.offering_intent_check(text, boolean, text)
FROM PUBLIC;


-- Execute one SELECT as a simulated API role/member and return either:
--
-- {
--   "ok": true,
--   "rows": [...]
-- }
--
-- or:
--
-- {
--   "ok": false,
--   "state": "...",
--   "message": "..."
-- }
CREATE FUNCTION pg_temp.offering_intent_as(
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
  IF p_role NOT IN (
    'authenticated',
    'anon',
    'service_role'
  ) THEN
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
ON FUNCTION pg_temp.offering_intent_as(text, uuid, text)
FROM PUBLIC;


CREATE FUNCTION pg_temp.offering_intent_error(
  p_name text,
  p_sql text,
  p_state text,
  p_message text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  observed_state text;
  observed_message text;
BEGIN
  BEGIN
    EXECUTE p_sql;

    observed_state := 'NO_ERROR';
    observed_message := 'statement unexpectedly succeeded';
  EXCEPTION
    WHEN OTHERS THEN
      observed_state := SQLSTATE;
      observed_message := SQLERRM;
  END;

  PERFORM pg_temp.offering_intent_check(
    p_name,
    observed_state = p_state
      AND (
        p_message IS NULL
        OR observed_message = p_message
      ),
    observed_state || ': ' || coalesce(observed_message, '')
  );
END;
$$;

REVOKE ALL
ON FUNCTION pg_temp.offering_intent_error(
  text,
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
  request_c uuid := gen_random_uuid();
  request_d uuid := gen_random_uuid();
  request_e uuid := gen_random_uuid();
  request_f uuid := gen_random_uuid();

  origin_a uuid;
  destination_a uuid;
  origin_b uuid;
  destination_b uuid;
  unresolved_a uuid;
  expiring_a uuid;

  intent_a uuid;
  replay_intent uuid;

  created_time timestamptz;
  departure_earliest timestamptz;
  departure_latest timestamptz;

  r jsonb;

  before_routes bigint;
  before_alignments bigint;
  before_journeys bigint;
  before_payments bigint;
  before_settlements bigint;
  before_snapshots bigint;

  after_routes bigint;
  after_alignments bigint;
  after_journeys bigint;
  after_payments bigint;
  after_settlements bigint;
  after_snapshots bigint;

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
    id::text || '@test-0034.invalid',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  FROM unnest(ARRAY[member_a, member_b]) ids(id);

  PERFORM pg_temp.offering_intent_check(
    'auth trigger created both member rows',
    (
      SELECT count(*) = 2
      FROM public.members
      WHERE id IN (member_a, member_b)
    )
  );

  created_time := clock_timestamp();

  -- Trusted provider-resolved endpoints owned by member A.
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
    'Ologolo, Lekki, Lagos',
    'provider_resolved',
    'resolved',
    6.4310,
    3.4990,
    'test-provider',
    'place-ologolo',
    'test-resolution-v1',
    created_time,
    created_time,
    created_time + interval '2 hours'
  )
  RETURNING id INTO origin_a;

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
    'Victoria Island, Lagos',
    'provider_resolved',
    'resolved',
    6.4281,
    3.4219,
    'test-provider',
    'place-vi',
    'test-resolution-v1',
    created_time,
    created_time,
    created_time + interval '2 hours'
  )
  RETURNING id INTO destination_a;

  -- Trusted provider-resolved endpoints owned by member B.
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
  RETURNING id INTO origin_b;

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
  RETURNING id INTO destination_b;

  -- An unresolved member-selected location must never be accepted
  -- as an offering route endpoint.
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
  RETURNING id INTO unresolved_a;

  -- Short-lived valid location used to prove elapsed trusted
  -- endpoints are rejected.
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
    'Short-lived test point',
    'provider_resolved',
    'resolved',
    6.5000,
    3.4000,
    'test-provider',
    'place-short-lived',
    'test-resolution-v1',
    created_time,
    created_time,
    created_time + interval '1 second'
  )
  RETURNING id INTO expiring_a;

  departure_earliest :=
    statement_timestamp() + interval '2 hours';

  departure_latest :=
    statement_timestamp() + interval '3 hours';

  SELECT count(*)
  INTO before_routes
  FROM private.offering_route_evidence;

  SELECT count(*)
  INTO before_alignments
  FROM public.alignments;

  SELECT count(*)
  INTO before_journeys
  FROM public.journeys;

  SELECT count(*)
  INTO before_payments
  FROM private.alignment_activation_payments;

  SELECT count(*)
  INTO before_settlements
  FROM private.movement_settlements;

  SELECT count(*)
  INTO before_snapshots
  FROM private.movement_context_snapshots;


  -- =======================================================
  -- ACL / private-table boundary
  -- =======================================================

  PERFORM pg_temp.offering_intent_check(
    'authenticated role can execute offering intent intake',
    has_function_privilege(
      'authenticated',
      'public.create_offering_movement_intent(uuid,uuid,uuid,timestamptz,timestamptz)',
      'EXECUTE'
    )
  );

  PERFORM pg_temp.offering_intent_check(
    'anon cannot execute offering intent intake',
    NOT has_function_privilege(
      'anon',
      'public.create_offering_movement_intent(uuid,uuid,uuid,timestamptz,timestamptz)',
      'EXECUTE'
    )
  );

  PERFORM pg_temp.offering_intent_check(
    'service role cannot execute member offering intent intake',
    NOT has_function_privilege(
      'service_role',
      'public.create_offering_movement_intent(uuid,uuid,uuid,timestamptz,timestamptz)',
      'EXECUTE'
    )
  );

  PERFORM pg_temp.offering_intent_check(
    'creation receipt table has RLS enabled',
    (
      SELECT c.relrowsecurity
      FROM pg_class c
      JOIN pg_namespace n
        ON n.oid = c.relnamespace
      WHERE n.nspname = 'private'
        AND c.relname =
          'offering_movement_intent_creation_receipts'
    )
  );

  PERFORM pg_temp.offering_intent_check(
    'creation receipt table has no application policies',
    NOT EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'private'
        AND tablename =
          'offering_movement_intent_creation_receipts'
    )
  );

  PERFORM pg_temp.offering_intent_check(
    'authenticated has no direct receipt table privileges',
    NOT has_table_privilege(
      'authenticated',
      'private.offering_movement_intent_creation_receipts',
      'SELECT'
    )
    AND NOT has_table_privilege(
      'authenticated',
      'private.offering_movement_intent_creation_receipts',
      'INSERT'
    )
    AND NOT has_table_privilege(
      'authenticated',
      'private.offering_movement_intent_creation_receipts',
      'UPDATE'
    )
    AND NOT has_table_privilege(
      'authenticated',
      'private.offering_movement_intent_creation_receipts',
      'DELETE'
    )
  );


  -- =======================================================
  -- First valid creation
  -- =======================================================

  r := pg_temp.offering_intent_as(
    'authenticated',
    member_a,
    format(
      'SELECT * FROM public.create_offering_movement_intent(
        %L::uuid,
        %L::uuid,
        %L::uuid,
        %L::timestamptz,
        %L::timestamptz
      )',
      request_a,
      origin_a,
      destination_a,
      departure_earliest,
      departure_latest
    )
  );

  intent_a :=
    (r #>> '{rows,0,offering_movement_intent_id}')::uuid;

  PERFORM pg_temp.offering_intent_check(
    'authenticated member can create independent offering intent',
    r->>'ok' = 'true'
      AND intent_a IS NOT NULL,
    r::text
  );

  PERFORM pg_temp.offering_intent_check(
    'offering member identity is derived from auth uid',
    (
      SELECT i.offering_member_id = member_a
      FROM private.offering_movement_intents i
      WHERE i.id = intent_a
    )
  );

  PERFORM pg_temp.offering_intent_check(
    'server derives fresh intent key version one and current status',
    (
      SELECT
        i.intent_key IS NOT NULL
        AND i.version = 1
        AND i.status = 'current'
        AND i.expires_at IS NULL
      FROM private.offering_movement_intents i
      WHERE i.id = intent_a
    )
  );

  PERFORM pg_temp.offering_intent_check(
    'departure declarations are preserved exactly',
    (
      SELECT
        i.earliest_departure_at = departure_earliest
        AND i.latest_departure_at = departure_latest
      FROM private.offering_movement_intents i
      WHERE i.id = intent_a
    )
  );

  PERFORM pg_temp.offering_intent_check(
    'intent has exactly origin and destination',
    (
      SELECT count(*) = 2
      FROM private.offering_movement_intent_locations il
      WHERE il.intent_id = intent_a
    )
    AND EXISTS (
      SELECT 1
      FROM private.offering_movement_intent_locations il
      WHERE il.intent_id = intent_a
        AND il.role = 'origin'
        AND il.location_reference_id = origin_a
    )
    AND EXISTS (
      SELECT 1
      FROM private.offering_movement_intent_locations il
      WHERE il.intent_id = intent_a
        AND il.role = 'destination'
        AND il.location_reference_id = destination_a
    )
  );

  PERFORM pg_temp.offering_intent_check(
    'creation receipt binds request to exact authenticated input',
    EXISTS (
      SELECT 1
      FROM private.offering_movement_intent_creation_receipts cr
      WHERE cr.request_id = request_a
        AND cr.offering_member_id = member_a
        AND cr.offering_movement_intent_id = intent_a
        AND cr.origin_location_reference_id = origin_a
        AND cr.destination_location_reference_id = destination_a
        AND cr.earliest_departure_at = departure_earliest
        AND cr.latest_departure_at = departure_latest
    )
  );


  -- =======================================================
  -- Exact idempotent replay
  -- =======================================================

  r := pg_temp.offering_intent_as(
    'authenticated',
    member_a,
    format(
      'SELECT * FROM public.create_offering_movement_intent(
        %L::uuid,
        %L::uuid,
        %L::uuid,
        %L::timestamptz,
        %L::timestamptz
      )',
      request_a,
      origin_a,
      destination_a,
      departure_earliest,
      departure_latest
    )
  );

  replay_intent :=
    (r #>> '{rows,0,offering_movement_intent_id}')::uuid;

  PERFORM pg_temp.offering_intent_check(
    'exact replay returns same offering intent',
    r->>'ok' = 'true'
      AND replay_intent = intent_a,
    r::text
  );

  SELECT count(*)
  INTO n
  FROM private.offering_movement_intent_creation_receipts
  WHERE request_id = request_a;

  PERFORM pg_temp.offering_intent_check(
    'exact replay does not create second receipt',
    n = 1,
    n::text
  );

  SELECT count(*)
  INTO n
  FROM private.offering_movement_intents
  WHERE id = intent_a;

  PERFORM pg_temp.offering_intent_check(
    'exact replay does not create second intent version',
    n = 1,
    n::text
  );


  -- =======================================================
  -- Replay mutation / request identity protection
  -- =======================================================

  r := pg_temp.offering_intent_as(
    'authenticated',
    member_a,
    format(
      'SELECT * FROM public.create_offering_movement_intent(
        %L::uuid,
        %L::uuid,
        %L::uuid,
        %L::timestamptz,
        %L::timestamptz
      )',
      request_a,
      origin_a,
      destination_a,
      departure_earliest + interval '1 minute',
      departure_latest
    )
  );

  PERFORM pg_temp.offering_intent_check(
    'changed departure replay is rejected',
    r->>'ok' = 'false'
      AND r->>'state' = '23514'
      AND r->>'message' =
        'Offering movement intent request replay does not match the original request',
    r::text
  );

  r := pg_temp.offering_intent_as(
    'authenticated',
    member_b,
    format(
      'SELECT * FROM public.create_offering_movement_intent(
        %L::uuid,
        %L::uuid,
        %L::uuid,
        %L::timestamptz,
        %L::timestamptz
      )',
      request_a,
      origin_a,
      destination_a,
      departure_earliest,
      departure_latest
    )
  );

  PERFORM pg_temp.offering_intent_check(
    'another member cannot reuse first member request identity',
    r->>'ok' = 'false'
      AND r->>'state' = '23514'
      AND r->>'message' =
        'Offering movement intent request replay does not match the original request',
    r::text
  );


  -- =======================================================
  -- Trusted endpoint enforcement
  -- =======================================================

  r := pg_temp.offering_intent_as(
    'authenticated',
    member_a,
    format(
      'SELECT * FROM public.create_offering_movement_intent(
        %L::uuid,
        %L::uuid,
        %L::uuid,
        statement_timestamp() + interval ''2 hours'',
        NULL
      )',
      request_b,
      unresolved_a,
      destination_a
    )
  );

  PERFORM pg_temp.offering_intent_check(
    'unresolved selected endpoint is rejected',
    r->>'ok' = 'false'
      AND r->>'state' = '23514'
      AND r->>'message' =
        'Offering movement intent requires trusted resolved locations',
    r::text
  );

  r := pg_temp.offering_intent_as(
    'authenticated',
    member_a,
    format(
      'SELECT * FROM public.create_offering_movement_intent(
        %L::uuid,
        %L::uuid,
        %L::uuid,
        statement_timestamp() + interval ''2 hours'',
        NULL
      )',
      request_c,
      origin_b,
      destination_a
    )
  );

  PERFORM pg_temp.offering_intent_check(
    'foreign member endpoint is rejected',
    r->>'ok' = 'false'
      AND r->>'state' = '42501'
      AND r->>'message' =
        'Offering movement intent locations do not belong to the authenticated member',
    r::text
  );

  r := pg_temp.offering_intent_as(
    'authenticated',
    member_a,
    format(
      'SELECT * FROM public.create_offering_movement_intent(
        %L::uuid,
        %L::uuid,
        %L::uuid,
        statement_timestamp() + interval ''2 hours'',
        NULL
      )',
      request_d,
      origin_a,
      origin_a
    )
  );

  PERFORM pg_temp.offering_intent_check(
    'same origin and destination are rejected',
    r->>'ok' = 'false'
      AND r->>'state' = '23514'
      AND r->>'message' =
        'Offering movement intent requires distinct origin and destination',
    r::text
  );


  -- =======================================================
  -- Existing database planning horizon remains authoritative
  -- =======================================================

  r := pg_temp.offering_intent_as(
    'authenticated',
    member_a,
    format(
      'SELECT * FROM public.create_offering_movement_intent(
        %L::uuid,
        %L::uuid,
        %L::uuid,
        statement_timestamp() + interval ''24 hours 1 minute'',
        NULL
      )',
      request_e,
      origin_a,
      destination_a
    )
  );

  PERFORM pg_temp.offering_intent_check(
    'offering intake cannot bypass 24 hour planning horizon',
    r->>'ok' = 'false'
      AND r->>'state' = '23514'
      AND r->>'message' =
        'Earliest departure must be within the next 24 hours',
    r::text
  );

  r := pg_temp.offering_intent_as(
    'authenticated',
    member_a,
    format(
      'SELECT * FROM public.create_offering_movement_intent(
        %L::uuid,
        %L::uuid,
        %L::uuid,
        statement_timestamp() - interval ''1 second'',
        NULL
      )',
      request_f,
      origin_a,
      destination_a
    )
  );

  PERFORM pg_temp.offering_intent_check(
    'offering intake cannot create past departure',
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

  r := pg_temp.offering_intent_as(
    'authenticated',
    member_a,
    format(
      'SELECT * FROM public.create_offering_movement_intent(
        %L::uuid,
        %L::uuid,
        %L::uuid,
        statement_timestamp() + interval ''2 hours'',
        NULL
      )',
      gen_random_uuid(),
      expiring_a,
      destination_a
    )
  );

  PERFORM pg_temp.offering_intent_check(
    'expired trusted endpoint is rejected',
    r->>'ok' = 'false'
      AND r->>'state' = '23514'
      AND r->>'message' =
        'Offering movement intent trusted location has expired',
    r::text
  );


  -- =======================================================
  -- Private receipt immutability
  -- =======================================================

  PERFORM pg_temp.offering_intent_error(
    'creation receipt cannot be updated',
    format(
      'UPDATE private.offering_movement_intent_creation_receipts
       SET recorded_at = recorded_at
       WHERE request_id = %L',
      request_a
    ),
    '23514',
    'Offering movement intent creation receipts are immutable'
  );

  PERFORM pg_temp.offering_intent_error(
    'creation receipt cannot be deleted',
    format(
      'DELETE FROM private.offering_movement_intent_creation_receipts
       WHERE request_id = %L',
      request_a
    ),
    '23514',
    'Offering movement intent creation receipts are immutable'
  );


  -- =======================================================
  -- No operational side effects
  -- =======================================================

  SELECT count(*)
  INTO after_routes
  FROM private.offering_route_evidence;

  SELECT count(*)
  INTO after_alignments
  FROM public.alignments;

  SELECT count(*)
  INTO after_journeys
  FROM public.journeys;

  SELECT count(*)
  INTO after_payments
  FROM private.alignment_activation_payments;

  SELECT count(*)
  INTO after_settlements
  FROM private.movement_settlements;

  SELECT count(*)
  INTO after_snapshots
  FROM private.movement_context_snapshots;

  PERFORM pg_temp.offering_intent_check(
    'intent intake creates no route evidence',
    after_routes = before_routes,
    before_routes::text || ' -> ' || after_routes::text
  );

  PERFORM pg_temp.offering_intent_check(
    'intent intake creates no alignment',
    after_alignments = before_alignments,
    before_alignments::text || ' -> ' || after_alignments::text
  );

  PERFORM pg_temp.offering_intent_check(
    'intent intake creates no journey',
    after_journeys = before_journeys,
    before_journeys::text || ' -> ' || after_journeys::text
  );

  PERFORM pg_temp.offering_intent_check(
    'intent intake creates no activation payment',
    after_payments = before_payments,
    before_payments::text || ' -> ' || after_payments::text
  );

  PERFORM pg_temp.offering_intent_check(
    'intent intake creates no settlement',
    after_settlements = before_settlements,
    before_settlements::text || ' -> ' || after_settlements::text
  );

  PERFORM pg_temp.offering_intent_check(
    'intent intake creates no movement context snapshot',
    after_snapshots = before_snapshots,
    before_snapshots::text || ' -> ' || after_snapshots::text
  );

END;
$test$;


SELECT
  test_name,
  passed,
  diagnostic
FROM pg_temp.offering_intent_results
ORDER BY test_name;

SELECT
  count(*) AS tests,
  count(*) FILTER (WHERE passed) AS passed,
  count(*) FILTER (WHERE NOT passed) AS failed
FROM pg_temp.offering_intent_results;

ROLLBACK;