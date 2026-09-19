BEGIN;

SET TRANSACTION ISOLATION LEVEL READ COMMITTED;

CREATE TEMP TABLE route_generation_claim_test_results (
  check_number integer GENERATED ALWAYS AS IDENTITY,
  test_name text NOT NULL UNIQUE,
  passed boolean NOT NULL
) ON COMMIT DROP;

CREATE FUNCTION pg_temp.route_claim_check(
  p_name text,
  p_passed boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $helper$
BEGIN
  INSERT INTO pg_temp.route_generation_claim_test_results(
    test_name,
    passed
  )
  VALUES(
    p_name,
    coalesce(p_passed, false)
  );
END;
$helper$;

CREATE FUNCTION pg_temp.route_claim_as(
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
  IF p_role NOT IN (
    'authenticated',
    'anon',
    'service_role'
  ) THEN
    RAISE EXCEPTION 'Unsupported test role';
  END IF;

  PERFORM set_config(
    'role',
    p_role,
    true
  );

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

  PERFORM set_config(
    'role',
    previous_role,
    true
  );

  RETURN result_json;
END;
$helper$;

DO $route_claim_test$
DECLARE
  member_id uuid := gen_random_uuid();
  other_member_id uuid := gen_random_uuid();

  intent_id uuid := gen_random_uuid();
  intent_key uuid := gen_random_uuid();

  origin_id uuid := gen_random_uuid();
  destination_id uuid := gen_random_uuid();

  initial_claim_token uuid;
  expired_claim_token uuid :=
    gen_random_uuid();
  takeover_claim_token uuid;

  route_evidence_id uuid;

  base_time timestamptz :=
    transaction_timestamp();

  dependency_expiry timestamptz :=
    transaction_timestamp()
      + interval '2 hours';

  route_generated_at timestamptz;

  route_shape jsonb :=
    jsonb_build_object(
      'type',
      'LineString',
      'coordinates',
      jsonb_build_array(
        jsonb_build_array(
          3.489,
          6.434
        ),
        jsonb_build_array(
          3.450,
          6.450
        ),
        jsonb_build_array(
          3.389,
          6.469
        )
      )
    );

  r jsonb;

  route_count_before bigint;

  lease_mutation_rejected boolean :=
    false;

  delete_rejected boolean :=
    false;
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
      member_id::text
        || '@test-0033.invalid',
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
      other_member_id::text
        || '@test-0033.invalid',
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
      'Test origin 0033',
      'provider_resolved',
      'resolved',
      6.434,
      3.489,
      'test-location',
      'origin-0033',
      'resolver-v1',
      base_time,
      base_time,
      dependency_expiry
    ),
    (
      destination_id,
      member_id,
      'Test destination 0033',
      'provider_resolved',
      'resolved',
      6.469,
      3.389,
      'test-location',
      'destination-0033',
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
    statement_timestamp()
      + interval '1 hour',
    statement_timestamp()
      + interval '90 minutes',
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
      intent_id,
      'origin',
      origin_id
    ),
    (
      intent_id,
      'destination',
      destination_id
    );

  SET CONSTRAINTS
    private.offering_intent_complete,
    private.offering_intent_locations_complete
    IMMEDIATE;

  SET CONSTRAINTS
    private.offering_intent_complete,
    private.offering_intent_locations_complete
    DEFERRED;

  PERFORM pg_temp.route_claim_check(
    '01 claim RPC execute is service-only',
    has_function_privilege(
      'service_role',
      'public.claim_offering_route_generation_for_server(uuid,uuid)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'authenticated',
      'public.claim_offering_route_generation_for_server(uuid,uuid)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'anon',
      'public.claim_offering_route_generation_for_server(uuid,uuid)',
      'EXECUTE'
    )
  );

  PERFORM pg_temp.route_claim_check(
    '02 claimed writer execute is service-only',
    has_function_privilege(
      'service_role',
      'public.record_claimed_offering_route_evidence_for_server(uuid,uuid,uuid,text,text,text,text,jsonb,bigint,bigint,timestamptz,timestamptz)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'authenticated',
      'public.record_claimed_offering_route_evidence_for_server(uuid,uuid,uuid,text,text,text,text,jsonb,bigint,bigint,timestamptz,timestamptz)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'anon',
      'public.record_claimed_offering_route_evidence_for_server(uuid,uuid,uuid,text,text,text,text,jsonb,bigint,bigint,timestamptz,timestamptz)',
      'EXECUTE'
    )
  );

  PERFORM pg_temp.route_claim_check(
    '03 claim table has RLS',
    (
      SELECT c.relrowsecurity
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n
        ON n.oid = c.relnamespace
      WHERE n.nspname = 'private'
        AND c.relname =
          'offering_route_generation_claims'
    )
  );

  PERFORM pg_temp.route_claim_check(
    '04 claim table has no RLS policies',
    (
      SELECT count(*) = 0
      FROM pg_catalog.pg_policy p
      JOIN pg_catalog.pg_class c
        ON c.oid = p.polrelid
      JOIN pg_catalog.pg_namespace n
        ON n.oid = c.relnamespace
      WHERE n.nspname = 'private'
        AND c.relname =
          'offering_route_generation_claims'
    )
  );

  PERFORM pg_temp.route_claim_check(
    '05 application roles have no claim table privileges',
    NOT has_table_privilege(
      'service_role',
      'private.offering_route_generation_claims',
      'SELECT'
    )
    AND NOT has_table_privilege(
      'service_role',
      'private.offering_route_generation_claims',
      'INSERT'
    )
    AND NOT has_table_privilege(
      'service_role',
      'private.offering_route_generation_claims',
      'UPDATE'
    )
    AND NOT has_table_privilege(
      'service_role',
      'private.offering_route_generation_claims',
      'DELETE'
    )
    AND NOT has_table_privilege(
      'authenticated',
      'private.offering_route_generation_claims',
      'SELECT'
    )
    AND NOT has_table_privilege(
      'anon',
      'private.offering_route_generation_claims',
      'SELECT'
    )
  );

  r := pg_temp.route_claim_as(
    'authenticated',
    format(
      $sql$
        SELECT *
        FROM public.claim_offering_route_generation_for_server(
          %L::uuid,
          %L::uuid
        )
      $sql$,
      intent_id,
      member_id
    )
  );

  PERFORM pg_temp.route_claim_check(
    '06 authenticated cannot execute claim RPC',
    r->>'ok' = 'false'
    AND r->>'sqlstate' = '42501'
  );

  r := pg_temp.route_claim_as(
    'anon',
    format(
      $sql$
        SELECT *
        FROM public.claim_offering_route_generation_for_server(
          %L::uuid,
          %L::uuid
        )
      $sql$,
      intent_id,
      member_id
    )
  );

  PERFORM pg_temp.route_claim_check(
    '07 anon cannot execute claim RPC',
    r->>'ok' = 'false'
    AND r->>'sqlstate' = '42501'
  );

  r := pg_temp.route_claim_as(
    'service_role',
    format(
      $sql$
        SELECT *
        FROM public.claim_offering_route_generation_for_server(
          %L::uuid,
          %L::uuid
        )
      $sql$,
      intent_id,
      other_member_id
    )
  );

  PERFORM pg_temp.route_claim_check(
    '08 wrong member cannot claim intent',
    r->>'ok' = 'false'
    AND r->>'sqlstate' = '42501'
  );

  route_count_before := (
    SELECT count(*)
    FROM private.offering_route_evidence
  );

  r := pg_temp.route_claim_as(
    'service_role',
    format(
      $sql$
        SELECT *
        FROM public.claim_offering_route_generation_for_server(
          %L::uuid,
          %L::uuid
        )
      $sql$,
      intent_id,
      member_id
    )
  );

  PERFORM pg_temp.route_claim_check(
    '09 first valid request wins claim',
    r->>'ok' = 'true'
    AND jsonb_array_length(
      r->'rows'
    ) = 1
    AND r#>>'{rows,0,generation_state}'
      = 'claimed'
    AND (
      r#>>'{rows,0,generation_claim_token}'
    ) IS NOT NULL
    AND (
      r#>>'{rows,0,retry_after_seconds}'
    )::integer = 0
  );

  initial_claim_token :=
    (
      r#>>'{rows,0,generation_claim_token}'
    )::uuid;

  PERFORM pg_temp.route_claim_check(
    '10 claimed response contains trusted endpoint context',
    r#>>'{rows,0,origin_location_reference_id}'
      = origin_id::text
    AND (
      r#>>'{rows,0,origin_latitude}'
    )::numeric = 6.434
    AND (
      r#>>'{rows,0,origin_longitude}'
    )::numeric = 3.489
    AND r#>>'{rows,0,destination_location_reference_id}'
      = destination_id::text
    AND (
      r#>>'{rows,0,destination_latitude}'
    )::numeric = 6.469
    AND (
      r#>>'{rows,0,destination_longitude}'
    )::numeric = 3.389
  );

  PERFORM pg_temp.route_claim_check(
    '11 claiming alone creates no route evidence',
    (
      SELECT count(*)
      FROM private.offering_route_evidence
    ) = route_count_before
  );

  r := pg_temp.route_claim_as(
    'service_role',
    format(
      $sql$
        SELECT *
        FROM public.claim_offering_route_generation_for_server(
          %L::uuid,
          %L::uuid
        )
      $sql$,
      intent_id,
      member_id
    )
  );

  PERFORM pg_temp.route_claim_check(
    '12 second active request is busy',
    r->>'ok' = 'true'
    AND r#>>'{rows,0,generation_state}'
      = 'busy'
    AND (
      r#>>'{rows,0,generation_claim_token}'
    ) IS NULL
    AND (
      r#>>'{rows,0,retry_after_seconds}'
    )::integer BETWEEN 1 AND 30
  );

  BEGIN
    UPDATE private.offering_route_generation_claims
    SET
      claimed_at =
        claimed_at + interval '1 second',
      lease_expires_at =
        lease_expires_at
          + interval '1 second'
    WHERE offering_movement_intent_id
            = intent_id;

    RAISE EXCEPTION
      'same-token lease mutation unexpectedly accepted';

  EXCEPTION
    WHEN check_violation THEN
      lease_mutation_rejected := true;
  END;

  PERFORM pg_temp.route_claim_check(
    '13 same token cannot extend or move its lease',
    lease_mutation_rejected
  );

  BEGIN
    DELETE FROM
      private.offering_route_generation_claims
    WHERE offering_movement_intent_id
            = intent_id;

    RAISE EXCEPTION
      'claim deletion unexpectedly accepted';

  EXCEPTION
    WHEN check_violation THEN
      delete_rejected := true;
  END;

  PERFORM pg_temp.route_claim_check(
    '14 claim history cannot be deleted',
    delete_rejected
  );

  r := pg_temp.route_claim_as(
    'service_role',
    format(
      $sql$
        SELECT *
        FROM public.record_claimed_offering_route_evidence_for_server(
          %L::uuid,
          %L::uuid,
          %L::uuid,
          'mapbox-directions-v5',
          'mapbox-directions',
          'v5-driving-geojson-full-v1',
          'wrong-token-route:0',
          %L::jsonb,
          8421,
          1197,
          %L::timestamptz,
          NULL
        )
      $sql$,
      intent_id,
      member_id,
      gen_random_uuid(),
      route_shape::text,
      clock_timestamp()
    )
  );

  PERFORM pg_temp.route_claim_check(
    '15 wrong claim token cannot write route',
    r->>'ok' = 'false'
    AND r->>'sqlstate' = '23514'
  );

  -- Simulate a crashed owner whose lease has elapsed.
  -- Changing the token represents a new claim generation and is
  -- permitted only while the row remains incomplete.
    UPDATE private.offering_route_generation_claims
  SET
    claim_token =
      expired_claim_token,
    claimed_at =
      expired_time.claimed_at,
    lease_expires_at =
      expired_time.claimed_at
        + interval '30 seconds',
    completed_route_evidence_id = NULL,
    completed_at = NULL
  FROM (
    SELECT
      clock_timestamp()
        - interval '60 seconds'
          AS claimed_at
  ) AS expired_time
  WHERE offering_movement_intent_id
          = intent_id;

  r := pg_temp.route_claim_as(
    'service_role',
    format(
      $sql$
        SELECT *
        FROM public.record_claimed_offering_route_evidence_for_server(
          %L::uuid,
          %L::uuid,
          %L::uuid,
          'mapbox-directions-v5',
          'mapbox-directions',
          'v5-driving-geojson-full-v1',
          'expired-claim-route:0',
          %L::jsonb,
          8421,
          1197,
          %L::timestamptz,
          NULL
        )
      $sql$,
      intent_id,
      member_id,
      expired_claim_token,
      route_shape::text,
      clock_timestamp()
    )
  );

  PERFORM pg_temp.route_claim_check(
    '16 expired incomplete claim cannot write route',
    r->>'ok' = 'false'
    AND r->>'sqlstate' = '23514'
  );

  r := pg_temp.route_claim_as(
    'service_role',
    format(
      $sql$
        SELECT *
        FROM public.claim_offering_route_generation_for_server(
          %L::uuid,
          %L::uuid
        )
      $sql$,
      intent_id,
      member_id
    )
  );

  takeover_claim_token :=
    (
      r#>>'{rows,0,generation_claim_token}'
    )::uuid;

  PERFORM pg_temp.route_claim_check(
    '17 expired claim can be taken over',
    r->>'ok' = 'true'
    AND r#>>'{rows,0,generation_state}'
      = 'claimed'
    AND takeover_claim_token IS NOT NULL
    AND takeover_claim_token
      <> expired_claim_token
    AND takeover_claim_token
      <> initial_claim_token
  );

  r := pg_temp.route_claim_as(
    'service_role',
    format(
      $sql$
        SELECT *
        FROM public.record_claimed_offering_route_evidence_for_server(
          %L::uuid,
          %L::uuid,
          %L::uuid,
          'mapbox-directions-v5',
          'mapbox-directions',
          'v5-driving-geojson-full-v1',
          'stale-original-route:0',
          %L::jsonb,
          8421,
          1197,
          %L::timestamptz,
          NULL
        )
      $sql$,
      intent_id,
      member_id,
      initial_claim_token,
      route_shape::text,
      clock_timestamp()
    )
  );

  PERFORM pg_temp.route_claim_check(
    '18 superseded old claim token cannot write',
    r->>'ok' = 'false'
    AND r->>'sqlstate' = '23514'
  );

  route_generated_at :=
    clock_timestamp();

  r := pg_temp.route_claim_as(
    'service_role',
    format(
      $sql$
        SELECT *
        FROM public.record_claimed_offering_route_evidence_for_server(
          %L::uuid,
          %L::uuid,
          %L::uuid,
          'mapbox-directions-v5',
          'mapbox-directions',
          'v5-driving-geojson-full-v1',
          'route-0033-success:0',
          %L::jsonb,
          8421,
          1197,
          %L::timestamptz,
          NULL
        )
      $sql$,
      intent_id,
      member_id,
      takeover_claim_token,
      route_shape::text,
      route_generated_at
    )
  );

  route_evidence_id :=
    (
      r#>>'{rows,0,route_evidence_id}'
    )::uuid;

  PERFORM pg_temp.route_claim_check(
    '19 valid active claim records route evidence',
    r->>'ok' = 'true'
    AND jsonb_array_length(
      r->'rows'
    ) = 1
    AND route_evidence_id IS NOT NULL
    AND (
      r#>>'{rows,0,route_evidence_version}'
    )::integer = 1
    AND r#>>'{rows,0,route_evidence_status}'
      = 'current'
  );

  PERFORM pg_temp.route_claim_check(
    '20 successful writer binds claim to completed evidence',
    (
      SELECT
        c.completed_route_evidence_id
          = route_evidence_id
        AND c.completed_at IS NOT NULL
      FROM private.offering_route_generation_claims c
      WHERE c.offering_movement_intent_id
              = intent_id
    )
  );

  PERFORM pg_temp.route_claim_check(
    '21 exactly one route evidence row exists after first write',
    (
      SELECT count(*)
      FROM private.offering_route_evidence e
      WHERE e.offering_movement_intent_id
              = intent_id
    ) = 1
  );

  r := pg_temp.route_claim_as(
    'service_role',
    format(
      $sql$
        SELECT *
        FROM public.record_claimed_offering_route_evidence_for_server(
          %L::uuid,
          %L::uuid,
          %L::uuid,
          'mapbox-directions-v5',
          'mapbox-directions',
          'v5-driving-geojson-full-v1',
          'route-0033-success:0',
          %L::jsonb,
          8421,
          1197,
          %L::timestamptz,
          NULL
        )
      $sql$,
      intent_id,
      member_id,
      takeover_claim_token,
      route_shape::text,
      route_generated_at
    )
  );

  PERFORM pg_temp.route_claim_check(
    '22 exact completed-claim replay returns original evidence',
    r->>'ok' = 'true'
    AND (
      r#>>'{rows,0,route_evidence_id}'
    )::uuid = route_evidence_id
    AND (
      r#>>'{rows,0,route_evidence_version}'
    )::integer = 1
  );

  PERFORM pg_temp.route_claim_check(
    '23 exact replay creates no second route version',
    (
      SELECT count(*)
      FROM private.offering_route_evidence e
      WHERE e.offering_movement_intent_id
              = intent_id
    ) = 1
  );

  r := pg_temp.route_claim_as(
    'service_role',
    format(
      $sql$
        SELECT *
        FROM public.record_claimed_offering_route_evidence_for_server(
          %L::uuid,
          %L::uuid,
          %L::uuid,
          'mapbox-directions-v5',
          'mapbox-directions',
          'v5-driving-geojson-full-v1',
          'different-route-0033:0',
          %L::jsonb,
          8421,
          1197,
          %L::timestamptz,
          NULL
        )
      $sql$,
      intent_id,
      member_id,
      takeover_claim_token,
      route_shape::text,
      route_generated_at
    )
  );

  PERFORM pg_temp.route_claim_check(
    '24 completed claim cannot bind a different provider route',
    r->>'ok' = 'false'
    AND r->>'sqlstate' = '23514'
    AND r->>'message'
      = 'Completed route generation claim does not match'
  );

  PERFORM pg_temp.route_claim_check(
    '25 mismatched completed replay creates no route version',
    (
      SELECT count(*)
      FROM private.offering_route_evidence e
      WHERE e.offering_movement_intent_id
              = intent_id
    ) = 1
  );

  r := pg_temp.route_claim_as(
    'service_role',
    format(
      $sql$
        SELECT *
        FROM public.claim_offering_route_generation_for_server(
          %L::uuid,
          %L::uuid
        )
      $sql$,
      intent_id,
      member_id
    )
  );

  PERFORM pg_temp.route_claim_check(
    '26 later claim recovers existing current route',
    r->>'ok' = 'true'
    AND r#>>'{rows,0,generation_state}'
      = 'existing'
    AND (
      r#>>'{rows,0,route_evidence_id}'
    )::uuid = route_evidence_id
    AND (
      r#>>'{rows,0,route_evidence_version}'
    )::integer = 1
    AND r#>>'{rows,0,route_evidence_status}'
      = 'current'
  );

  PERFORM pg_temp.route_claim_check(
    '27 existing route response exposes no claim or endpoint coordinates',
    (
      r#>>'{rows,0,generation_claim_token}'
    ) IS NULL
    AND (
      r#>>'{rows,0,retry_after_seconds}'
    )::integer = 0
    AND (
      r#>>'{rows,0,origin_location_reference_id}'
    ) IS NULL
    AND (
      r#>>'{rows,0,origin_latitude}'
    ) IS NULL
    AND (
      r#>>'{rows,0,origin_longitude}'
    ) IS NULL
    AND (
      r#>>'{rows,0,destination_location_reference_id}'
    ) IS NULL
    AND (
      r#>>'{rows,0,destination_latitude}'
    ) IS NULL
    AND (
      r#>>'{rows,0,destination_longitude}'
    ) IS NULL
  );

  PERFORM pg_temp.route_claim_check(
    '28 completed route remains the only current route',
    (
      SELECT count(*)
      FROM private.offering_route_evidence e
      WHERE e.offering_movement_intent_id
              = intent_id
        AND e.status = 'current'
    ) = 1
  );

  SET CONSTRAINTS
    private.offering_intent_complete,
    private.offering_intent_locations_complete,
    private.offering_route_evidence_complete
    IMMEDIATE;

  PERFORM pg_temp.route_claim_check(
    '29 valid fixture has no deferred constraint failure',
    true
  );
END;
$route_claim_test$;

SELECT
  count(*) AS tests,
  count(*) FILTER (
    WHERE passed
  ) AS passed,
  count(*) FILTER (
    WHERE NOT passed
  ) AS failed
FROM route_generation_claim_test_results;

SELECT
  check_number,
  test_name,
  passed
FROM route_generation_claim_test_results
ORDER BY check_number;

ROLLBACK;