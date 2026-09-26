BEGIN;

SET TRANSACTION ISOLATION LEVEL READ COMMITTED;


CREATE TEMP TABLE pg_temp.state_bound_results (
  test_number integer GENERATED ALWAYS AS IDENTITY,
  test_name text NOT NULL UNIQUE,
  passed boolean NOT NULL,
  diagnostic text
) ON COMMIT DROP;


CREATE FUNCTION pg_temp.state_bound_check(
  p_name text,
  p_passed boolean,
  p_diagnostic text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $check$
BEGIN
  INSERT INTO pg_temp.state_bound_results(
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


CREATE FUNCTION pg_temp.make_state_endpoint(
  p_owner_member_id uuid,
  p_label text,
  p_provider_place_reference text,
  p_latitude numeric,
  p_longitude numeric,
  p_state_provider_reference text,
  p_state_name text
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


  INSERT INTO private.trusted_location_state_evidence(
    resolution_evidence_id,
    resolved_location_reference_id,
    provider_namespace,
    state_provider_reference,
    state_name,
    state_key,
    recorded_at
  )
  VALUES (
    v_evidence_id,
    v_target_id,
    'test-provider',
    p_state_provider_reference,
    p_state_name,
    private.canonical_nigerian_state_key(
      p_state_name
    ),
    clock_timestamp()
  );


  RETURN v_target_id;
END;
$endpoint$;


CREATE FUNCTION pg_temp.make_route(
  p_offering_member_id uuid,
  p_origin_id uuid,
  p_destination_id uuid,
  p_route_reference text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
AS $route$
DECLARE
  v_intent_id uuid;
  v_route_id uuid;
  v_now timestamptz;
  v_origin private.movement_location_references%ROWTYPE;
  v_destination private.movement_location_references%ROWTYPE;
BEGIN
  v_now := clock_timestamp();

  SELECT *
  INTO STRICT v_origin
  FROM private.movement_location_references
  WHERE id=p_origin_id;

  SELECT *
  INTO STRICT v_destination
  FROM private.movement_location_references
  WHERE id=p_destination_id;


  INSERT INTO private.offering_movement_intents(
    offering_member_id,
    intent_key,
    version,
    earliest_departure_at,
    latest_departure_at,
    created_at,
    expires_at,
    status
  )
  VALUES (
    p_offering_member_id,
    gen_random_uuid(),
    1,
    v_now + interval '1 hour',
    v_now + interval '2 hours',
    v_now,
    v_now + interval '3 hours',
    'current'
  )
  RETURNING id
  INTO v_intent_id;


  INSERT INTO private.offering_movement_intent_locations(
    intent_id,
    role,
    location_reference_id
  )
  VALUES
    (
      v_intent_id,
      'origin',
      p_origin_id
    ),
    (
      v_intent_id,
      'destination',
      p_destination_id
    );


  INSERT INTO private.offering_route_evidence(
    offering_movement_intent_id,
    offering_member_id,
    origin_location_reference_id,
    destination_location_reference_id,
    version,
    evidence_schema_version,
    provider_namespace,
    provider_product,
    provider_version,
    provider_route_reference,
    route_shape_format,
    route_shape,
    route_distance_meters,
    route_duration_seconds,
    generated_at,
    created_at,
    expires_at,
    status
  )
  VALUES (
    v_intent_id,
    p_offering_member_id,
    p_origin_id,
    p_destination_id,
    1,
    'offering_route_evidence_v1',
    'test-router',
    'directions',
    'v1',
    p_route_reference,
    'geojson_linestring_v1',
    jsonb_build_object(
      'type',
      'LineString',
      'coordinates',
      jsonb_build_array(
        jsonb_build_array(
          v_origin.longitude,
          v_origin.latitude
        ),
        jsonb_build_array(
          v_destination.longitude,
          v_destination.latitude
        )
      )
    ),
    10000,
    1200,
    v_now,
    v_now,
    v_now + interval '2 hours',
    'current'
  )
  RETURNING id
  INTO v_route_id;


  -- Validate this fixture explicitly without changing the
  -- transaction-wide mode of the existing deferred constraint
  -- triggers. Later make_route() calls must still be able to
  -- insert the intent before its two endpoint bindings.
  PERFORM private.assert_offering_movement_intent(
    v_intent_id
  );

  PERFORM private.assert_offering_route_evidence(
    v_route_id
  );


  RETURN v_route_id;
END;
$route$;


DO $test$
DECLARE
  requester_id uuid := gen_random_uuid();
  offerer_id uuid := gen_random_uuid();

  requester_lagos_origin uuid;
  requester_lagos_destination uuid;
  requester_ogun_destination uuid;

  requester_fct_origin uuid;
  requester_fct_destination uuid;

  offerer_lagos_origin uuid;
  offerer_lagos_destination uuid;

  offerer_ogun_origin uuid;
  offerer_ogun_destination uuid;

  offerer_fct_origin uuid;
  offerer_fct_destination uuid;

  missing_state_requester_origin uuid;

  lagos_route uuid;
  ogun_route uuid;
  fct_route uuid;

  lagos_intent_id uuid;

  lagos_movement_need_id uuid;
  cross_state_movement_need_id uuid;

  v_error_state text;
  v_error_message text;

  v_now timestamptz;
BEGIN
  v_now := clock_timestamp();


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
        || '@test-0050.invalid',
      v_now,
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      v_now,
      v_now
    ),
    (
      offerer_id,
      'authenticated',
      'authenticated',
      offerer_id::text
        || '@test-0050.invalid',
      v_now,
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      v_now,
      v_now
    );


  PERFORM pg_temp.state_bound_check(
    '01 members created',
    EXISTS (
      SELECT 1
      FROM public.members
      WHERE id=requester_id
    )
    AND EXISTS (
      SELECT 1
      FROM public.members
      WHERE id=offerer_id
    )
  );


  requester_lagos_origin :=
    pg_temp.make_state_endpoint(
      requester_id,
      'Requester Lagos Origin',
      '0050-requester-lagos-origin',
      6.4300,
      3.5200,
      'mapbox-region-lagos',
      'Lagos'
    );

  requester_lagos_destination :=
    pg_temp.make_state_endpoint(
      requester_id,
      'Requester Lagos Destination',
      '0050-requester-lagos-destination',
      6.6018,
      3.3515,
      'mapbox-region-lagos',
      'Lagos State'
    );

  requester_ogun_destination :=
    pg_temp.make_state_endpoint(
      requester_id,
      'Requester Ogun Destination',
      '0050-requester-ogun-destination',
      6.8200,
      3.9200,
      'mapbox-region-ogun',
      'Ogun'
    );


  requester_fct_origin :=
    pg_temp.make_state_endpoint(
      requester_id,
      'Requester FCT Origin',
      '0050-requester-fct-origin',
      9.0579,
      7.4951,
      'mapbox-region-fct',
      'Federal Capital Territory'
    );

  requester_fct_destination :=
    pg_temp.make_state_endpoint(
      requester_id,
      'Requester FCT Destination',
      '0050-requester-fct-destination',
      9.0765,
      7.3986,
      'mapbox-region-fct',
      'Federal Capital Territory'
    );


  offerer_lagos_origin :=
    pg_temp.make_state_endpoint(
      offerer_id,
      'Offerer Lagos Origin',
      '0050-offerer-lagos-origin',
      6.4281,
      3.4219,
      'mapbox-region-lagos',
      'Lagos'
    );

  offerer_lagos_destination :=
    pg_temp.make_state_endpoint(
      offerer_id,
      'Offerer Lagos Destination',
      '0050-offerer-lagos-destination',
      6.5244,
      3.3792,
      'mapbox-region-lagos',
      'Lagos State'
    );


  offerer_ogun_origin :=
    pg_temp.make_state_endpoint(
      offerer_id,
      'Offerer Ogun Origin',
      '0050-offerer-ogun-origin',
      6.6800,
      3.3500,
      'mapbox-region-ogun',
      'Ogun'
    );

  offerer_ogun_destination :=
    pg_temp.make_state_endpoint(
      offerer_id,
      'Offerer Ogun Destination',
      '0050-offerer-ogun-destination',
      6.8500,
      3.6500,
      'mapbox-region-ogun',
      'Ogun State'
    );


  offerer_fct_origin :=
    pg_temp.make_state_endpoint(
      offerer_id,
      'Offerer FCT Origin',
      '0050-offerer-fct-origin',
      9.0500,
      7.4500,
      'mapbox-region-fct',
      'Federal Capital Territory'
    );

  offerer_fct_destination :=
    pg_temp.make_state_endpoint(
      offerer_id,
      'Offerer FCT Destination',
      '0050-offerer-fct-destination',
      9.0800,
      7.3600,
      'mapbox-region-fct',
      'Federal Capital Territory'
    );


  lagos_route :=
    pg_temp.make_route(
      offerer_id,
      offerer_lagos_origin,
      offerer_lagos_destination,
      '0050-lagos-route'
    );

  ogun_route :=
    pg_temp.make_route(
      offerer_id,
      offerer_ogun_origin,
      offerer_ogun_destination,
      '0050-ogun-route'
    );

  fct_route :=
    pg_temp.make_route(
      offerer_id,
      offerer_fct_origin,
      offerer_fct_destination,
      '0050-fct-route'
    );


  SELECT e.offering_movement_intent_id
  INTO STRICT lagos_intent_id
  FROM private.offering_route_evidence e
  WHERE e.id=lagos_route;


  -- create_movement_need derives its member from auth.uid().
  -- These are genuine movement-need records with the normal
  -- trusted endpoint bindings used by 0036.
  PERFORM set_config(
    'request.jwt.claim.sub',
    requester_id::text,
    true
  );

  PERFORM set_config(
    'request.jwt.claim.role',
    'authenticated',
    true
  );


  SELECT x.movement_need_id
  INTO STRICT lagos_movement_need_id
  FROM public.create_movement_need(
    gen_random_uuid(),
    requester_lagos_origin,
    requester_lagos_destination,
    clock_timestamp() + interval '1 hour',
    clock_timestamp() + interval '2 hours',
    1
  ) x;


  SELECT x.movement_need_id
  INTO STRICT cross_state_movement_need_id
  FROM public.create_movement_need(
    gen_random_uuid(),
    requester_lagos_origin,
    requester_ogun_destination,
    clock_timestamp() + interval '1 hour',
    clock_timestamp() + interval '2 hours',
    1
  ) x;


  PERFORM
    private.assert_state_bound_matching_context(
      requester_lagos_origin,
      requester_lagos_destination,
      lagos_route
    );

  PERFORM pg_temp.state_bound_check(
    '02 Lagos requester and Lagos offered movement allowed',
    true
  );


  BEGIN
    PERFORM
      private.assert_state_bound_matching_context(
        requester_lagos_origin,
        requester_ogun_destination,
        lagos_route
      );

    PERFORM pg_temp.state_bound_check(
      '03 requester Lagos to Ogun rejected',
      false,
      'state assertion unexpectedly succeeded'
    );
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS
        v_error_state = RETURNED_SQLSTATE,
        v_error_message = MESSAGE_TEXT;

      PERFORM pg_temp.state_bound_check(
        '03 requester Lagos to Ogun rejected',
        v_error_state='23514'
        AND v_error_message=
          'Requester movement crosses a state boundary',
        v_error_state || ': ' || v_error_message
      );
  END;


  BEGIN
    PERFORM
      private.assert_state_bound_matching_context(
        requester_lagos_origin,
        requester_lagos_destination,
        ogun_route
      );

    PERFORM pg_temp.state_bound_check(
      '04 Lagos requester cannot connect to Ogun offered movement',
      false,
      'state assertion unexpectedly succeeded'
    );
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS
        v_error_state = RETURNED_SQLSTATE,
        v_error_message = MESSAGE_TEXT;

      PERFORM pg_temp.state_bound_check(
        '04 Lagos requester cannot connect to Ogun offered movement',
        v_error_state='23514'
        AND v_error_message=
          'Requester and offered movements are in different states',
        v_error_state || ': ' || v_error_message
      );
  END;


  PERFORM
    private.assert_state_bound_matching_context(
      requester_fct_origin,
      requester_fct_destination,
      fct_route
    );

  PERFORM pg_temp.state_bound_check(
    '05 FCT requester and FCT offered movement allowed',
    true
  );


  v_now := clock_timestamp();

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
    requester_id,
    'Legacy Resolved Without State',
    'provider_resolved',
    'resolved',
    6.5000,
    3.4000,
    'test-provider',
    '0050-missing-state-target',
    'test-resolution-v1',
    v_now,
    v_now
  )
  RETURNING id
  INTO missing_state_requester_origin;


  BEGIN
    PERFORM
      private.assert_state_bound_matching_context(
        missing_state_requester_origin,
        requester_lagos_destination,
        lagos_route
      );

    PERFORM pg_temp.state_bound_check(
      '06 missing state evidence fails closed',
      false,
      'state assertion unexpectedly succeeded'
    );
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS
        v_error_state = RETURNED_SQLSTATE,
        v_error_message = MESSAGE_TEXT;

      PERFORM pg_temp.state_bound_check(
        '06 missing state evidence fails closed',
        v_error_state='23514'
        AND v_error_message=
          'Requester origin trusted state evidence is unavailable',
        v_error_state || ': ' || v_error_message
      );
  END;


  PERFORM pg_temp.state_bound_check(
    '07 Lagos State suffix normalizes to Lagos',
    private.canonical_nigerian_state_key(
      'Lagos State'
    )='lagos'
  );


  PERFORM pg_temp.state_bound_check(
    '08 FCT canonical jurisdiction key is fct',
    private.canonical_nigerian_state_key(
      'Federal Capital Territory'
    )='fct'
  );


  PERFORM pg_temp.state_bound_check(
    '09 unknown jurisdiction fails closed',
    private.canonical_nigerian_state_key(
      'Not A Nigerian State'
    ) IS NULL
  );


  PERFORM pg_temp.state_bound_check(
    '10 state evidence rows are bound to resolution evidence',
    (
      SELECT count(*) >= 10
      FROM private.trusted_location_state_evidence
    )
  );


  -- =======================================================
  -- Real 0036 public boundary propagation
  -- =======================================================

  PERFORM 1
  FROM public.get_trusted_matching_context_for_server(
    lagos_movement_need_id,
    lagos_intent_id,
    offerer_id
  );

  PERFORM pg_temp.state_bound_check(
    '11 public trusted matching context allows same-state movement',
    true
  );


  BEGIN
    PERFORM 1
    FROM public.get_trusted_matching_context_for_server(
      cross_state_movement_need_id,
      lagos_intent_id,
      offerer_id
    );

    PERFORM pg_temp.state_bound_check(
      '12 public trusted matching context rejects cross-state requester',
      false,
      'public trusted matching context unexpectedly succeeded'
    );
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS
        v_error_state = RETURNED_SQLSTATE,
        v_error_message = MESSAGE_TEXT;

      PERFORM pg_temp.state_bound_check(
        '12 public trusted matching context rejects cross-state requester',
        v_error_state='23514'
        AND v_error_message=
          'Requester movement crosses a state boundary',
        v_error_state || ': ' || v_error_message
      );
  END;


  -- =======================================================
  -- Existing downstream 0039 authorization boundary
  --
  -- This is specifically important after moving the mature
  -- 0036 object: it proves an already-installed downstream
  -- function reaches the NEW public state-bound wrapper.
  -- =======================================================

  PERFORM 1
  FROM public.get_authorized_trusted_matching_context_for_server(
    requester_id,
    lagos_movement_need_id,
    lagos_intent_id
  );

  PERFORM pg_temp.state_bound_check(
    '13 authorized trusted matching context preserves same-state path',
    true
  );


  BEGIN
    PERFORM 1
    FROM public.get_authorized_trusted_matching_context_for_server(
      requester_id,
      cross_state_movement_need_id,
      lagos_intent_id
    );

    PERFORM pg_temp.state_bound_check(
      '14 authorized trusted matching context inherits state rejection',
      false,
      'authorized trusted matching context unexpectedly bypassed state gate'
    );
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS
        v_error_state = RETURNED_SQLSTATE,
        v_error_message = MESSAGE_TEXT;

      PERFORM pg_temp.state_bound_check(
        '14 authorized trusted matching context inherits state rejection',
        v_error_state='23514'
        AND v_error_message=
          'Requester movement crosses a state boundary',
        v_error_state || ': ' || v_error_message
      );
  END;
END;
$test$;


TABLE pg_temp.state_bound_results;


DO $assert$
DECLARE
  failed_count integer;
BEGIN
  SELECT count(*)
  INTO failed_count
  FROM pg_temp.state_bound_results
  WHERE NOT passed;

  IF failed_count <> 0 THEN
    RAISE EXCEPTION
      '0050 state-bound movement matching tests failed: %',
      failed_count;
  END IF;
END;
$assert$;


ROLLBACK;