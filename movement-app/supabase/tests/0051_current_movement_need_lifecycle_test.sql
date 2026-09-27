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


CREATE FUNCTION pg_temp.make_endpoint(
  p_owner_member_id uuid,
  p_label text,
  p_provider_place_reference text,
  p_latitude numeric,
  p_longitude numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
AS $endpoint$
DECLARE
  v_source_id uuid;
  v_target_id uuid;
  v_evidence_id uuid;
  v_now timestamptz;
BEGIN
  v_now := clock_timestamp();

  INSERT INTO private.movement_location_references(
    owner_member_id,
    declared_label,
    source_kind,
    resolution_status,
    provider_namespace,
    provider_place_reference,
    created_at
  )
  VALUES (
    p_owner_member_id,
    p_label,
    'member_selected',
    'unresolved',
    'test-provider',
    p_provider_place_reference,
    v_now
  )
  RETURNING id
  INTO v_source_id;


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
    resolved_at,
    created_at
  )
  VALUES (
    p_owner_member_id,
    p_label,
    'provider_resolved',
    'resolved',
    p_latitude,
    p_longitude,
    'test-provider',
    p_provider_place_reference,
    'test-resolution-v1',
    v_now,
    v_now
  )
  RETURNING id
  INTO v_target_id;


  INSERT INTO private.movement_location_resolution_evidence(
    source_location_reference_id,
    resolved_location_reference_id,
    version,
    producer_request_id,
    provider_product,
    provider_version,
    resolution_schema_version,
    requested_expires_at,
    recorded_at
  )
  VALUES (
    v_source_id,
    v_target_id,
    1,
    gen_random_uuid(),
    'test-geocoder',
    'v1',
    'movement_location_resolution_v1',
    NULL,
    v_now
  )
  RETURNING id
  INTO v_evidence_id;


  INSERT INTO private.trusted_location_discovery_areas(resolution_evidence_id, resolved_location_reference_id, discovery_area_label) VALUES (v_evidence_id, v_target_id, 'Broad test area');
  RETURN v_target_id;
END;
$endpoint$;



-- Requires 0051 already installed in a disposable test database.
-- Never installs migrations or disables security checks.
DO $test$
DECLARE
  owner_id uuid := gen_random_uuid();
  viewer_id uuid := gen_random_uuid();
  past_owner_id uuid := gen_random_uuid();
  past_origin_id uuid;
  past_destination_id uuid;
  origin_id uuid;
  destination_id uuid;
  past_id uuid := gen_random_uuid();
  future_id uuid := gen_random_uuid();
  window_id uuid := gen_random_uuid();
  expired_window_id uuid := gen_random_uuid();
  paused_id uuid := gen_random_uuid();
  t timestamptz := clock_timestamp();
  r jsonb;
BEGIN
  INSERT INTO auth.users(id, aud, role, email, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  SELECT id, 'authenticated', 'authenticated', id::text || '@test-0051.invalid',
    t, '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, t, t
  FROM unnest(ARRAY[owner_id, viewer_id, past_owner_id]) AS users(id);

  origin_id := pg_temp.make_endpoint(owner_id, 'Precise origin', 'origin', 6.4, 3.4);
  destination_id := pg_temp.make_endpoint(owner_id, 'Precise destination', 'destination', 6.5, 3.5);

  past_origin_id := pg_temp.make_endpoint(past_owner_id, 'Precise origin', 'past-origin', 6.4, 3.4);
  past_destination_id := pg_temp.make_endpoint(past_owner_id, 'Precise destination', 'past-destination', 6.5, 3.5);

  -- Capture time immediately before insertion. All departures are future and
  -- comfortably inside the 24-hour planning horizon; production triggers run.
  t := clock_timestamp();
  INSERT INTO public.movement_needs(id, member_id, origin_area, destination_area,
    earliest_departure_at, latest_departure_at, created_at, status)
  VALUES
    (past_id, past_owner_id, 'Precise origin', 'Precise destination', t + interval '1 second', NULL, t, 'discoverable'),
    (expired_window_id, past_owner_id, 'Precise origin', 'Precise destination', t + interval '1 second', t + interval '2 seconds', t, 'discoverable'),
    (future_id, owner_id, 'Precise origin', 'Precise destination', t + interval '10 minutes', NULL, t - interval '2 hours', 'discoverable'),
    (window_id, owner_id, 'Precise origin', 'Precise destination', t + interval '1 second', t + interval '10 minutes', t - interval '1 hour', 'discoverable'),
    (paused_id, owner_id, 'Precise origin', 'Precise destination', t + interval '10 minutes', NULL, t, 'discoverable');

  INSERT INTO private.movement_need_locations(movement_need_id, role, location_reference_id)
  SELECT id, role, location_id FROM unnest(ARRAY[past_id, expired_window_id]) AS needs(id)
  CROSS JOIN (VALUES ('origin', past_origin_id), ('destination', past_destination_id)) AS endpoints(role, location_id);
  INSERT INTO private.movement_need_locations(movement_need_id, role, location_reference_id)
  SELECT id, role, location_id FROM unnest(ARRAY[future_id, window_id, paused_id]) AS needs(id)
  CROSS JOIN (VALUES ('origin', origin_id), ('destination', destination_id)) AS endpoints(role, location_id);

  UPDATE public.movement_needs SET status = 'paused' WHERE id = paused_id;
  -- One natural-expiry wait, following 0042's deadline-relative pattern.
  PERFORM pg_sleep(greatest(0, extract(epoch FROM t + interval '2 seconds' - clock_timestamp())) + 0.1);

  r := pg_temp.discovery_as('authenticated', past_owner_id, 'SELECT * FROM public.get_my_current_movement_need()');
  PERFORM pg_temp.discovery_check('own past requests are not recovered',
    r->>'ok' = 'true' AND r->'rows' = '[]'::jsonb, r::text);
  r := pg_temp.discovery_as('authenticated', viewer_id, 'SELECT * FROM public.discover_masked_movement_needs(50)');
  PERFORM pg_temp.discovery_check('past single departure is absent from discovery',
    r->>'ok' = 'true' AND NOT (r->'rows' @> jsonb_build_array(jsonb_build_object('movement_need_id', past_id))), r::text);
  PERFORM pg_temp.discovery_check('expired latest departure is absent from discovery',
    r->>'ok' = 'true' AND NOT (r->'rows' @> jsonb_build_array(jsonb_build_object('movement_need_id', expired_window_id))), r::text);
  PERFORM pg_temp.discovery_check('future single departure remains discoverable',
    r->>'ok' = 'true' AND r->'rows' @> jsonb_build_array(jsonb_build_object('movement_need_id', future_id)), r::text);
  PERFORM pg_temp.discovery_check('latest departure keeps an open window discoverable with masked labels',
    r->>'ok' = 'true' AND r->'rows' @> jsonb_build_array(jsonb_build_object(
      'movement_need_id', window_id, 'origin_area', 'Broad test area', 'destination_area', 'Broad test area')), r::text);
  PERFORM pg_temp.discovery_check('paused request is absent from discovery',
    r->>'ok' = 'true' AND NOT (r->'rows' @> jsonb_build_array(jsonb_build_object('movement_need_id', paused_id))), r::text);

  r := pg_temp.discovery_as('authenticated', viewer_id, 'SELECT * FROM public.get_my_current_movement_need()');
  PERFORM pg_temp.discovery_check('member with no requests cannot recover another member request',
    r->>'ok' = 'true' AND r->'rows' = '[]'::jsonb, r::text);

  r := pg_temp.discovery_as('authenticated', owner_id, 'SELECT * FROM public.get_my_current_movement_need()');
  PERFORM pg_temp.discovery_check('newest current request is recovered using latest departure',
    r->>'ok' = 'true' AND r->'rows' = jsonb_build_array(jsonb_build_object('movement_need_id', window_id)), r::text);

  r := pg_temp.discovery_as('authenticated', owner_id, 'SELECT * FROM public.discover_masked_movement_needs(50)');
  PERFORM pg_temp.discovery_check('own current requests are excluded from discovery',
    r->>'ok' = 'true' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r->'rows') AS x
      WHERE (x->>'movement_need_id')::uuid IN (future_id, window_id)), r::text);

  r := pg_temp.discovery_as('anon', NULL, 'SELECT * FROM public.get_my_current_movement_need()');
  PERFORM pg_temp.discovery_check('anonymous recovery is denied',
    r->>'ok' = 'false' AND r->>'state' = '42501', r::text);
  r := pg_temp.discovery_as('authenticated', NULL, 'SELECT * FROM public.get_my_current_movement_need()');
  PERFORM pg_temp.discovery_check('recovery without auth uid is denied',
    r->>'ok' = 'false' AND r->>'message' = 'Authentication required', r::text);
  PERFORM pg_temp.discovery_check('past rows remain stored for history',
    (SELECT count(*) = 2 FROM public.movement_needs WHERE id IN (past_id, expired_window_id) AND status = 'discoverable'));
END;
$test$;

TABLE pg_temp.discovery_results;
DO $assert$
BEGIN
  IF (SELECT count(*) FROM pg_temp.discovery_results) <> 12 THEN
    RAISE EXCEPTION '0051 expected exactly 12 checks';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_temp.discovery_results WHERE NOT passed) THEN
    RAISE EXCEPTION '0051 lifecycle behavioral tests failed';
  END IF;
END;
$assert$;
ROLLBACK;
