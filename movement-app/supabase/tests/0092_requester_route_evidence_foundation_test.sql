BEGIN;

SET TRANSACTION ISOLATION LEVEL READ COMMITTED;

CREATE TEMP TABLE requester_route_results (
  check_number integer GENERATED ALWAYS AS IDENTITY,
  test_name text NOT NULL UNIQUE,
  passed boolean NOT NULL
) ON COMMIT DROP;

CREATE FUNCTION pg_temp.requester_route_check(
  p_name text,
  p_passed boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  INSERT INTO requester_route_results(test_name, passed)
  VALUES (p_name, coalesce(p_passed, false));
END;
$$;

CREATE FUNCTION pg_temp.requester_route_insert(
  p_need_id uuid,
  p_member_id uuid,
  p_origin_id uuid,
  p_destination_id uuid,
  p_version integer,
  p_reference text,
  p_shape jsonb DEFAULT '{"type":"LineString","coordinates":[[3.489,6.434],[3.421,6.455],[3.389,6.469]]}'::jsonb,
  p_distance bigint DEFAULT 12000,
  p_duration bigint DEFAULT 1500,
  p_generated_at timestamptz DEFAULT clock_timestamp() - interval '1 minute',
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  result_id uuid;
BEGIN
  INSERT INTO private.requester_route_evidence (
    movement_need_id,
    requesting_member_id,
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
    p_need_id,
    p_member_id,
    p_origin_id,
    p_destination_id,
    p_version,
    'requester_route_evidence_v1',
    'test-provider',
    'directions',
    'v1',
    p_reference,
    'geojson_linestring_v1',
    p_shape,
    p_distance,
    p_duration,
    p_generated_at,
    clock_timestamp(),
    p_expires_at,
    'current'
  )
  RETURNING id INTO result_id;

  RETURN result_id;
END;
$$;

DO $setup$
DECLARE
  requester_id uuid := gen_random_uuid();
  other_member_id uuid := gen_random_uuid();
  mismatch_member_id uuid := gen_random_uuid();
  need_id uuid := gen_random_uuid();
  other_need_id uuid := gen_random_uuid();
  second_current_need_id uuid := gen_random_uuid();
  member_mismatch_need_id uuid := gen_random_uuid();
  endpoint_mismatch_need_id uuid := gen_random_uuid();
  freshness_need_id uuid := gen_random_uuid();
  endpoint_ownership_need_id uuid := gen_random_uuid();
  invalid_shape_need_id uuid := gen_random_uuid();
  expiry_need_id uuid := gen_random_uuid();
  expired_reopen_need_id uuid := gen_random_uuid();
  reopen_need_id uuid := gen_random_uuid();
  origin_id uuid := gen_random_uuid();
  destination_id uuid := gen_random_uuid();
  other_origin_id uuid := gen_random_uuid();
  other_destination_id uuid := gen_random_uuid();
  second_current_origin_id uuid := gen_random_uuid();
  second_current_destination_id uuid := gen_random_uuid();
  freshness_origin_id uuid := gen_random_uuid();
  freshness_destination_id uuid := gen_random_uuid();
  member_mismatch_origin_id uuid := gen_random_uuid();
  member_mismatch_destination_id uuid := gen_random_uuid();
  endpoint_mismatch_origin_id uuid := gen_random_uuid();
  endpoint_mismatch_destination_id uuid := gen_random_uuid();
  endpoint_ownership_origin_id uuid := gen_random_uuid();
  endpoint_ownership_destination_id uuid := gen_random_uuid();
  invalid_shape_origin_id uuid := gen_random_uuid();
  invalid_shape_destination_id uuid := gen_random_uuid();
  expiry_origin_id uuid := gen_random_uuid();
  expiry_destination_id uuid := gen_random_uuid();
  expired_reopen_origin_id uuid := gen_random_uuid();
  expired_reopen_destination_id uuid := gen_random_uuid();
  reopen_origin_id uuid := gen_random_uuid();
  reopen_destination_id uuid := gen_random_uuid();
  stray_id uuid := gen_random_uuid();
  other_member_origin_id uuid := gen_random_uuid();
  other_member_destination_id uuid := gen_random_uuid();
  current_id uuid;
  expired_id uuid;
  second_current_id uuid;
  freshness_id uuid;
  freshness_case_need_id uuid := gen_random_uuid();
  freshness_case_origin_id uuid := gen_random_uuid();
  freshness_case_destination_id uuid := gen_random_uuid();
  route_shape jsonb := '{"type":"LineString","coordinates":[[3.489,6.434],[3.421,6.455],[3.389,6.469]]}'::jsonb;
  now timestamptz := clock_timestamp();
BEGIN
  INSERT INTO auth.users (
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
      requester_id::text || '@test-0092.invalid',
      now,
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      now,
      now
    ),
    (
      other_member_id,
      'authenticated',
      'authenticated',
      other_member_id::text || '@test-0092.invalid',
      now,
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      now,
      now
    ),
    (
      mismatch_member_id,
      'authenticated',
      'authenticated',
      mismatch_member_id::text || '@test-0092.invalid',
      now,
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      now,
      now
    );

  INSERT INTO public.movement_needs (
    id,
    member_id,
    origin_area,
    destination_area,
    earliest_departure_at,
    latest_departure_at,
    people_count,
    status,
    created_at,
    updated_at
  )
  VALUES
    (
      need_id,
      requester_id,
      'Test origin',
      'Test destination',
      now + interval '30 minutes',
      now + interval '90 minutes',
      1,
      'discoverable',
      now,
      now
    ),
    (
      other_need_id,
      requester_id,
      'Other origin',
      'Other destination',
      now + interval '45 minutes',
      now + interval '2 hours',
      1,
      'discoverable',
      now,
      now
    ),
    (
      second_current_need_id,
      requester_id,
      'Second current origin',
      'Second current destination',
      now + interval '55 minutes',
      now + interval '2 hours 15 minutes',
      1,
      'discoverable',
      now,
      now
    ),
    (
      member_mismatch_need_id,
      requester_id,
      'Mismatch origin',
      'Mismatch destination',
      now + interval '35 minutes',
      now + interval '95 minutes',
      1,
      'discoverable',
      now,
      now
    ),
    (
      freshness_need_id,
      requester_id,
      'Freshness origin',
      'Freshness destination',
      now + interval '42 minutes',
      now + interval '102 minutes',
      1,
      'discoverable',
      now,
      now
    ),
    (
      endpoint_mismatch_need_id,
      requester_id,
      'Endpoint mismatch origin',
      'Endpoint mismatch destination',
      now + interval '40 minutes',
      now + interval '100 minutes',
      1,
      'discoverable',
      now,
      now
    ),
    (
      endpoint_ownership_need_id,
      requester_id,
      'Endpoint ownership origin',
      'Endpoint ownership destination',
      now + interval '50 minutes',
      now + interval '110 minutes',
      1,
      'discoverable',
      now,
      now
    ),
    (
      invalid_shape_need_id,
      requester_id,
      'Bad shape origin',
      'Bad shape destination',
      now + interval '60 minutes',
      now + interval '120 minutes',
      1,
      'discoverable',
      now,
      now
    ),
    (
      expiry_need_id,
      requester_id,
      'Expiry origin',
      'Expiry destination',
      now + interval '70 minutes',
      now + interval '130 minutes',
      1,
      'discoverable',
      now,
      now
    ),
    (
      expired_reopen_need_id,
      requester_id,
      'Expired reopen origin',
      'Expired reopen destination',
      now + interval '80 minutes',
      now + interval '150 minutes',
      1,
      'discoverable',
      now,
      now
    ),
    (
      reopen_need_id,
      requester_id,
      'Reopen origin',
      'Reopen destination',
      now + interval '90 minutes',
      now + interval '160 minutes',
      1,
      'discoverable',
      now,
      now
    );

  INSERT INTO private.movement_location_references (
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
      requester_id,
      'Requester origin',
      'provider_resolved',
      'resolved',
      6.434,
      3.489,
      'test-provider',
      'origin-0092',
      'resolver-v1',
      now,
      now,
      now + interval '2 hours'
    ),
    (
      destination_id,
      requester_id,
      'Requester destination',
      'provider_resolved',
      'resolved',
      6.469,
      3.389,
      'test-provider',
      'destination-0092',
      'resolver-v1',
      now,
      now,
      now + interval '2 hours'
    ),
    (
      other_origin_id,
      requester_id,
      'Other origin',
      'provider_resolved',
      'resolved',
      6.500,
      3.500,
      'test-provider',
      'other-origin-0092',
      'resolver-v1',
      now,
      now,
      now + interval '2 hours'
    ),
    (
      other_destination_id,
      requester_id,
      'Other destination',
      'provider_resolved',
      'resolved',
      6.600,
      3.600,
      'test-provider',
      'other-destination-0092',
      'resolver-v1',
      now,
      now,
      now + interval '2 hours'
    ),
    (
      second_current_origin_id,
      requester_id,
      'Second current origin',
      'provider_resolved',
      'resolved',
      6.700,
      3.700,
      'test-provider',
      'second-current-origin-0092',
      'resolver-v1',
      now,
      now,
      now + interval '2 hours'
    ),
    (
      second_current_destination_id,
      requester_id,
      'Second current destination',
      'provider_resolved',
      'resolved',
      6.710,
      3.710,
      'test-provider',
      'second-current-destination-0092',
      'resolver-v1',
      now,
      now,
      now + interval '2 hours'
    ),
    (
      member_mismatch_origin_id,
      requester_id,
      'Mismatch origin',
      'provider_resolved',
      'resolved',
      6.720,
      3.720,
      'test-provider',
      'member-mismatch-origin-0092',
      'resolver-v1',
      now,
      now,
      now + interval '2 hours'
    ),
    (
      freshness_origin_id,
      requester_id,
      'Freshness origin',
      'provider_resolved',
      'resolved',
      6.710,
      3.710,
      'test-provider',
      'freshness-origin-0092',
      'resolver-v1',
      now,
      now,
      now + interval '2 hours'
    ),
    (
      freshness_destination_id,
      requester_id,
      'Freshness destination',
      'provider_resolved',
      'resolved',
      6.715,
      3.715,
      'test-provider',
      'freshness-destination-0092',
      'resolver-v1',
      now,
      now,
      now + interval '2 hours'
    ),
    (
      member_mismatch_destination_id,
      requester_id,
      'Mismatch destination',
      'provider_resolved',
      'resolved',
      6.730,
      3.730,
      'test-provider',
      'member-mismatch-destination-0092',
      'resolver-v1',
      now,
      now,
      now + interval '2 hours'
    ),
    (
      endpoint_mismatch_origin_id,
      requester_id,
      'Endpoint mismatch origin',
      'provider_resolved',
      'resolved',
      6.740,
      3.740,
      'test-provider',
      'endpoint-mismatch-origin-0092',
      'resolver-v1',
      now,
      now,
      now + interval '2 hours'
    ),
    (
      endpoint_mismatch_destination_id,
      requester_id,
      'Endpoint mismatch destination',
      'provider_resolved',
      'resolved',
      6.750,
      3.750,
      'test-provider',
      'endpoint-mismatch-destination-0092',
      'resolver-v1',
      now,
      now,
      now + interval '2 hours'
    ),
    (
      endpoint_ownership_origin_id,
      other_member_id,
      'Ownership origin',
      'provider_resolved',
      'resolved',
      6.760,
      3.760,
      'test-provider',
      'endpoint-ownership-origin-0092',
      'resolver-v1',
      now,
      now,
      now + interval '2 hours'
    ),
    (
      endpoint_ownership_destination_id,
      other_member_id,
      'Ownership destination',
      'provider_resolved',
      'resolved',
      6.770,
      3.770,
      'test-provider',
      'endpoint-ownership-destination-0092',
      'resolver-v1',
      now,
      now,
      now + interval '2 hours'
    ),
    (
      invalid_shape_origin_id,
      requester_id,
      'Bad shape origin',
      'provider_resolved',
      'resolved',
      6.780,
      3.780,
      'test-provider',
      'invalid-shape-origin-0092',
      'resolver-v1',
      now,
      now,
      now + interval '2 hours'
    ),
    (
      invalid_shape_destination_id,
      requester_id,
      'Bad shape destination',
      'provider_resolved',
      'resolved',
      6.790,
      3.790,
      'test-provider',
      'invalid-shape-destination-0092',
      'resolver-v1',
      now,
      now,
      now + interval '2 hours'
    ),
    (
      expiry_origin_id,
      requester_id,
      'Expiry origin',
      'provider_resolved',
      'resolved',
      6.810,
      3.810,
      'test-provider',
      'expiry-origin-0092',
      'resolver-v1',
      now,
      now,
      now + interval '2 hours'
    ),
    (
      expiry_destination_id,
      requester_id,
      'Expiry destination',
      'provider_resolved',
      'resolved',
      6.820,
      3.820,
      'test-provider',
      'expiry-destination-0092',
      'resolver-v1',
      now,
      now,
      now + interval '2 hours'
    ),
    (
      expired_reopen_origin_id,
      requester_id,
      'Expired reopen origin',
      'provider_resolved',
      'resolved',
      6.830,
      3.830,
      'test-provider',
      'expired-reopen-origin-0092',
      'resolver-v1',
      now,
      now,
      now + interval '2 hours'
    ),
    (
      expired_reopen_destination_id,
      requester_id,
      'Expired reopen destination',
      'provider_resolved',
      'resolved',
      6.840,
      3.840,
      'test-provider',
      'expired-reopen-destination-0092',
      'resolver-v1',
      now,
      now,
      now + interval '2 hours'
    ),
    (
      reopen_origin_id,
      requester_id,
      'Reopen origin',
      'provider_resolved',
      'resolved',
      6.850,
      3.850,
      'test-provider',
      'reopen-origin-0092',
      'resolver-v1',
      now,
      now,
      now + interval '2 hours'
    ),
    (
      reopen_destination_id,
      requester_id,
      'Reopen destination',
      'provider_resolved',
      'resolved',
      6.860,
      3.860,
      'test-provider',
      'reopen-destination-0092',
      'resolver-v1',
      now,
      now,
      now + interval '2 hours'
    ),
    (
      stray_id,
      requester_id,
      'Stray endpoint',
      'provider_resolved',
      'resolved',
      6.800,
      3.800,
      'test-provider',
      'stray-0092',
      'resolver-v1',
      now,
      now,
      now + interval '2 hours'
    ),
    (
      other_member_origin_id,
      other_member_id,
      'Other-member origin',
      'provider_resolved',
      'resolved',
      6.850,
      3.850,
      'test-provider',
      'other-member-origin-0092',
      'resolver-v1',
      now,
      now,
      now + interval '2 hours'
    ),
    (
      other_member_destination_id,
      other_member_id,
      'Other-member destination',
      'provider_resolved',
      'resolved',
      6.860,
      3.860,
      'test-provider',
      'other-member-destination-0092',
      'resolver-v1',
      now,
      now,
      now + interval '2 hours'
    );

  INSERT INTO private.movement_need_locations (movement_need_id, role, location_reference_id)
  VALUES
    (need_id, 'origin', origin_id),
    (need_id, 'destination', destination_id),
    (other_need_id, 'origin', other_origin_id),
    (other_need_id, 'destination', other_destination_id),
    (second_current_need_id, 'origin', second_current_origin_id),
    (second_current_need_id, 'destination', second_current_destination_id),
    (member_mismatch_need_id, 'origin', member_mismatch_origin_id),
    (member_mismatch_need_id, 'destination', member_mismatch_destination_id),
    (freshness_need_id, 'origin', freshness_origin_id),
    (freshness_need_id, 'destination', freshness_destination_id),
    (endpoint_mismatch_need_id, 'origin', endpoint_mismatch_origin_id),
    (endpoint_mismatch_need_id, 'destination', endpoint_mismatch_destination_id),
    (endpoint_ownership_need_id, 'origin', endpoint_ownership_origin_id),
    (endpoint_ownership_need_id, 'destination', endpoint_ownership_destination_id),
    (invalid_shape_need_id, 'origin', invalid_shape_origin_id),
    (invalid_shape_need_id, 'destination', invalid_shape_destination_id),
    (expiry_need_id, 'origin', expiry_origin_id),
    (expiry_need_id, 'destination', expiry_destination_id),
    (expired_reopen_need_id, 'origin', expired_reopen_origin_id),
    (expired_reopen_need_id, 'destination', expired_reopen_destination_id),
    (reopen_need_id, 'origin', reopen_origin_id),
    (reopen_need_id, 'destination', reopen_destination_id);

  current_id := pg_temp.requester_route_insert(
    need_id,
    requester_id,
    origin_id,
    destination_id,
    1,
    'requester-route-0092'
  );

  second_current_id := pg_temp.requester_route_insert(
    second_current_need_id,
    requester_id,
    second_current_origin_id,
    second_current_destination_id,
    1,
    'second-current-route-0092'
  );

  PERFORM pg_temp.requester_route_check(
    'valid requester route evidence accepted',
    EXISTS (SELECT 1 FROM private.requester_route_evidence WHERE id = current_id)
  );

  PERFORM pg_temp.requester_route_insert(
    other_need_id,
    requester_id,
    other_origin_id,
    other_destination_id,
    1,
    'other-requester-route-0092'
  );

  PERFORM pg_temp.requester_route_check(
    'same provider identity across distinct movement needs remains valid',
    EXISTS (
      SELECT 1
      FROM private.requester_route_evidence e
      WHERE e.movement_need_id = other_need_id
      AND e.provider_route_reference = 'other-requester-route-0092'
    )
  );

  UPDATE private.requester_route_evidence
  SET status = 'superseded'
  WHERE movement_need_id = other_need_id
    AND version = 1
    AND provider_route_reference = 'other-requester-route-0092';

  PERFORM pg_temp.requester_route_insert(
    other_need_id,
    requester_id,
    other_origin_id,
    other_destination_id,
    2,
    'other-requester-route-0092-v2'
  );

  PERFORM pg_temp.requester_route_check(
    'version continuation keeps one current row',
    EXISTS (
      SELECT 1
      FROM private.requester_route_evidence e
      WHERE e.movement_need_id = other_need_id
        AND e.version = 1
        AND e.status = 'superseded'
    )
    AND EXISTS (
      SELECT 1
      FROM private.requester_route_evidence e
      WHERE e.movement_need_id = other_need_id
        AND e.version = 2
        AND e.status = 'current'
    )
    AND (SELECT count(*)
         FROM private.requester_route_evidence e
         WHERE e.movement_need_id = other_need_id
           AND e.status = 'current') = 1
  );

  BEGIN
    PERFORM private.validate_requester_route_evidence_structure(
      (SELECT e FROM private.requester_route_evidence e WHERE e.movement_need_id = other_need_id AND e.version = 1 LIMIT 1)
    );
    PERFORM pg_temp.requester_route_check('superseded evidence remains structurally valid', true);
  EXCEPTION
    WHEN OTHERS THEN
      PERFORM pg_temp.requester_route_check('superseded evidence remains structurally valid', false);
  END;

  BEGIN
    PERFORM private.assert_requester_route_evidence(
      (SELECT id FROM private.requester_route_evidence WHERE movement_need_id = other_need_id AND version = 1 LIMIT 1)
    );
    PERFORM pg_temp.requester_route_check('superseded evidence is not current usable', false);
  EXCEPTION
    WHEN check_violation THEN
      PERFORM pg_temp.requester_route_check('superseded evidence is not current usable', true);
  END;

  INSERT INTO public.movement_needs (
    id,
    member_id,
    origin_area,
    destination_area,
    earliest_departure_at,
    latest_departure_at,
    people_count,
    status,
    created_at,
    updated_at
  )
  VALUES (
    freshness_case_need_id,
    requester_id,
    'Freshness origin',
    'Freshness destination',
    now + interval '42 minutes',
    now + interval '102 minutes',
    1,
    'discoverable',
    now,
    now
  );

  INSERT INTO private.movement_location_references (
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
  VALUES (
    freshness_case_origin_id,
    requester_id,
    'Freshness origin',
    'provider_resolved',
    'resolved',
    6.710,
    3.710,
    'test-provider',
    'freshness-case-origin-0092',
    'resolver-v1',
    now,
    now,
    clock_timestamp() + interval '1 second'
  ), (
    freshness_case_destination_id,
    requester_id,
    'Freshness destination',
    'provider_resolved',
    'resolved',
    6.715,
    3.715,
    'test-provider',
    'freshness-case-destination-0092',
    'resolver-v1',
    now,
    now,
    clock_timestamp() + interval '2 minutes'
  );

  INSERT INTO private.movement_need_locations (movement_need_id, role, location_reference_id)
  VALUES
    (freshness_case_need_id, 'origin', freshness_case_origin_id),
    (freshness_case_need_id, 'destination', freshness_case_destination_id);

  BEGIN
    SET CONSTRAINTS ALL IMMEDIATE;
    SET CONSTRAINTS ALL DEFERRED;
    INSERT INTO private.requester_route_evidence (
      movement_need_id,
      requesting_member_id,
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
      freshness_case_need_id,
      requester_id,
      freshness_case_origin_id,
      freshness_case_destination_id,
      1,
      'requester_route_evidence_v1',
      'test-provider',
      'directions',
      'v1',
      'freshness-route-0092',
      'geojson_linestring_v1',
      route_shape,
      12000,
      1500,
      clock_timestamp() - interval '1 minute',
      clock_timestamp(),
      clock_timestamp() + interval '2 minutes',
      'current'
    )
    RETURNING id INTO freshness_id;
  END;

  PERFORM pg_sleep(1.2);

  BEGIN
    PERFORM private.assert_requester_route_evidence(freshness_id);
    PERFORM pg_temp.requester_route_check('current endpoint freshness blocks current use', false);
  EXCEPTION
    WHEN check_violation THEN
      PERFORM pg_temp.requester_route_check('current endpoint freshness blocks current use', true);
    WHEN OTHERS THEN
      PERFORM pg_temp.requester_route_check('current endpoint freshness blocks current use', false);
      RAISE;
  END;

  BEGIN
    PERFORM private.validate_requester_route_evidence_structure(
      (SELECT e FROM private.requester_route_evidence e WHERE e.id = freshness_id)
    );
    PERFORM pg_temp.requester_route_check('historical provenance remains structurally valid after endpoint expiry', true);
  EXCEPTION
    WHEN OTHERS THEN
      PERFORM pg_temp.requester_route_check('historical provenance remains structurally valid after endpoint expiry', false);
  END;

  BEGIN
    SET CONSTRAINTS ALL IMMEDIATE;
    SET CONSTRAINTS ALL DEFERRED;
    BEGIN
      PERFORM pg_temp.requester_route_insert(
        need_id,
        requester_id,
        origin_id,
        destination_id,
        1,
        'requester-route-0092',
        route_shape,
        13000,
        1600
      );
      RAISE EXCEPTION USING
        ERRCODE = 'ZX023',
        MESSAGE = 'duplicate movement need version unexpectedly succeeded';
    EXCEPTION
      WHEN unique_violation THEN
        PERFORM pg_temp.requester_route_check('duplicate movement need version rejected', true);
      WHEN OTHERS THEN
        PERFORM pg_temp.requester_route_check('duplicate movement need version rejected', false);
        RAISE;
    END;
  END;

  BEGIN
    SET CONSTRAINTS ALL IMMEDIATE;
    SET CONSTRAINTS ALL DEFERRED;
    BEGIN
      PERFORM pg_temp.requester_route_insert(
        second_current_need_id,
        requester_id,
        second_current_origin_id,
        second_current_destination_id,
        2,
        'second-current-route-0092',
        route_shape,
        13000,
        1600
      );
      RAISE EXCEPTION USING
        ERRCODE = 'ZX023',
        MESSAGE = 'second current evidence unexpectedly succeeded';
    EXCEPTION
      WHEN unique_violation THEN
        PERFORM pg_temp.requester_route_check('second current evidence rejected', true);
      WHEN OTHERS THEN
        PERFORM pg_temp.requester_route_check('second current evidence rejected', false);
        RAISE;
    END;
  END;

  BEGIN
    BEGIN
      INSERT INTO private.requester_route_evidence (
        movement_need_id,
        requesting_member_id,
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
        member_mismatch_need_id,
        mismatch_member_id,
        member_mismatch_origin_id,
        member_mismatch_destination_id,
        1,
        'requester_route_evidence_v1',
        'test-provider',
        'directions',
        'v1',
        'member-mismatch-route-0092',
        'geojson_linestring_v1',
        route_shape,
        14000,
        1700,
        now - interval '1 minute',
        now,
        now + interval '2 hours',
        'current'
      );
      SET CONSTRAINTS ALL IMMEDIATE;
      RAISE EXCEPTION USING
        ERRCODE = 'ZX023',
        MESSAGE = 'member mismatch unexpectedly succeeded';
    EXCEPTION
      WHEN check_violation THEN
        PERFORM pg_temp.requester_route_check('member mismatch rejected', true);
      WHEN OTHERS THEN
        PERFORM pg_temp.requester_route_check('member mismatch rejected', false);
        RAISE;
    END;
    SET CONSTRAINTS ALL DEFERRED;
  END;

  BEGIN
    BEGIN
      INSERT INTO private.requester_route_evidence (
        movement_need_id,
        requesting_member_id,
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
        endpoint_mismatch_need_id,
        requester_id,
        stray_id,
        endpoint_mismatch_destination_id,
        1,
        'requester_route_evidence_v1',
        'test-provider',
        'directions',
        'v1',
        'stray-endpoint-route-0092',
        'geojson_linestring_v1',
        route_shape,
        9000,
        1400,
        now - interval '1 minute',
        now,
        now + interval '2 hours',
        'current'
      );
      SET CONSTRAINTS ALL IMMEDIATE;
      RAISE EXCEPTION USING
        ERRCODE = 'ZX023',
        MESSAGE = 'endpoint mismatch unexpectedly succeeded';
    EXCEPTION
      WHEN check_violation THEN
        PERFORM pg_temp.requester_route_check('endpoint mismatch outside movement need rejected', true);
      WHEN OTHERS THEN
        PERFORM pg_temp.requester_route_check('endpoint mismatch outside movement need rejected', false);
        RAISE;
    END;
    SET CONSTRAINTS ALL DEFERRED;
  END;

  BEGIN
    BEGIN
      INSERT INTO private.requester_route_evidence (
        movement_need_id,
        requesting_member_id,
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
        endpoint_ownership_need_id,
        requester_id,
        endpoint_ownership_origin_id,
        endpoint_ownership_destination_id,
        1,
        'requester_route_evidence_v1',
        'test-provider',
        'directions',
        'v1',
        'endpoint-ownership-route-0092',
        'geojson_linestring_v1',
        route_shape,
        9500,
        1500,
        now - interval '1 minute',
        now,
        now + interval '2 hours',
        'current'
      );
      SET CONSTRAINTS ALL IMMEDIATE;
      RAISE EXCEPTION USING
        ERRCODE = 'ZX023',
        MESSAGE = 'endpoint ownership mismatch unexpectedly succeeded';
    EXCEPTION
      WHEN check_violation THEN
        PERFORM pg_temp.requester_route_check('endpoint ownership mismatch rejected', true);
      WHEN OTHERS THEN
        PERFORM pg_temp.requester_route_check('endpoint ownership mismatch rejected', false);
        RAISE;
    END;
    SET CONSTRAINTS ALL DEFERRED;
  END;

  BEGIN
    BEGIN
      INSERT INTO private.requester_route_evidence (
        movement_need_id,
        requesting_member_id,
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
        invalid_shape_need_id,
        requester_id,
        invalid_shape_origin_id,
        invalid_shape_destination_id,
        1,
        'requester_route_evidence_v1',
        'test-provider',
        'directions',
        'v1',
        'bad-shape-route-0092',
        'geojson_linestring_v1',
        '{"type":"Point","coordinates":[3.489,6.434]}'::jsonb,
        9000,
        1400,
        now - interval '1 minute',
        now,
        now + interval '2 hours',
        'current'
      );
      SET CONSTRAINTS ALL IMMEDIATE;
      RAISE EXCEPTION USING
        ERRCODE = 'ZX023',
        MESSAGE = 'invalid shape unexpectedly succeeded';
    EXCEPTION
      WHEN check_violation THEN
        PERFORM pg_temp.requester_route_check('invalid GeoJSON LineString is rejected', true);
      WHEN OTHERS THEN
        PERFORM pg_temp.requester_route_check('invalid GeoJSON LineString is rejected', false);
        RAISE;
    END;
    SET CONSTRAINTS ALL DEFERRED;
  END;

  BEGIN
    SET CONSTRAINTS ALL IMMEDIATE;
    SET CONSTRAINTS ALL DEFERRED;
    UPDATE private.requester_route_evidence
    SET route_distance_meters = 999999
    WHERE id = current_id;
    PERFORM pg_temp.requester_route_check('immutable route row fields fail closed', false);
  EXCEPTION
    WHEN check_violation THEN
      PERFORM pg_temp.requester_route_check('immutable route row fields fail closed', true);
  END;

  BEGIN
    SET CONSTRAINTS ALL IMMEDIATE;
    SET CONSTRAINTS ALL DEFERRED;
    DELETE FROM private.requester_route_evidence WHERE id = current_id;
    PERFORM pg_temp.requester_route_check('delete blocked for route evidence history', false);
  EXCEPTION
    WHEN check_violation THEN
      PERFORM pg_temp.requester_route_check('delete blocked for route evidence history', true);
  END;

  UPDATE private.requester_route_evidence
  SET status = 'superseded'
  WHERE id = current_id;

  BEGIN
    SET CONSTRAINTS ALL IMMEDIATE;
    SET CONSTRAINTS ALL DEFERRED;
    UPDATE private.requester_route_evidence
    SET status = 'current'
    WHERE id = current_id;
    PERFORM pg_temp.requester_route_check('reopening a terminal state is rejected', false);
  EXCEPTION
    WHEN check_violation THEN
      PERFORM pg_temp.requester_route_check('reopening a terminal state is rejected', true);
  END;

  expired_id := pg_temp.requester_route_insert(
    expiry_need_id,
    requester_id,
    expiry_origin_id,
    expiry_destination_id,
    1,
    'future-expiry-route-0092',
    route_shape,
    9000,
    1400,
    now - interval '1 minute',
    now + interval '1 hour'
  );

  BEGIN
    SET CONSTRAINTS ALL IMMEDIATE;
    SET CONSTRAINTS ALL DEFERRED;
    UPDATE private.requester_route_evidence
    SET status = 'expired'
    WHERE id = expired_id;
    PERFORM pg_temp.requester_route_check('expired transition before deadline rejected', false);
  EXCEPTION
    WHEN check_violation THEN
      PERFORM pg_temp.requester_route_check('expired transition before deadline rejected', true);
  END;

  expired_id := pg_temp.requester_route_insert(
    expired_reopen_need_id,
    requester_id,
    expired_reopen_origin_id,
    expired_reopen_destination_id,
    1,
    'elapsed-expiry-route-0092',
    route_shape,
    9000,
    1400,
    clock_timestamp() - interval '1 minute',
    clock_timestamp() + interval '1 second'
  );

  PERFORM pg_sleep(1.1);
  UPDATE private.requester_route_evidence
  SET status = 'expired'
  WHERE id = expired_id;

  BEGIN
    SET CONSTRAINTS ALL IMMEDIATE;
    SET CONSTRAINTS ALL DEFERRED;
    UPDATE private.requester_route_evidence
    SET status = 'current'
    WHERE id = expired_id;
    PERFORM pg_temp.requester_route_check('expired route cannot reopen', false);
  EXCEPTION
    WHEN check_violation THEN
      PERFORM pg_temp.requester_route_check('expired route cannot reopen', true);
  END;

  BEGIN
    PERFORM private.validate_requester_route_evidence_structure(
      (SELECT e FROM private.requester_route_evidence e WHERE e.id = expired_id)
    );
    BEGIN
      PERFORM private.assert_requester_route_evidence(expired_id);
      PERFORM pg_temp.requester_route_check('elapsed route evidence is not current usable', false);
    EXCEPTION
      WHEN check_violation THEN
        PERFORM pg_temp.requester_route_check('elapsed route evidence is not current usable', true);
    END;
  EXCEPTION
    WHEN OTHERS THEN
      PERFORM pg_temp.requester_route_check('elapsed route evidence is not current usable', false);
  END;

  PERFORM pg_temp.requester_route_check(
    'anon cannot read requester route evidence',
    NOT has_table_privilege('anon', 'private.requester_route_evidence', 'SELECT')
  );

  PERFORM pg_temp.requester_route_check(
    'authenticated cannot read requester route evidence',
    NOT has_table_privilege('authenticated', 'private.requester_route_evidence', 'SELECT')
  );

  PERFORM pg_temp.requester_route_check(
    'anon cannot mutate requester route evidence',
    NOT has_table_privilege('anon', 'private.requester_route_evidence', 'INSERT,UPDATE,DELETE,TRUNCATE')
  );

  PERFORM pg_temp.requester_route_check(
    'authenticated cannot mutate requester route evidence',
    NOT has_table_privilege('authenticated', 'private.requester_route_evidence', 'INSERT,UPDATE,DELETE,TRUNCATE')
  );

  PERFORM pg_temp.requester_route_check(
    'service role gets select without public mutation privilege',
    has_table_privilege('service_role', 'private.requester_route_evidence', 'SELECT')
    AND NOT has_table_privilege('service_role', 'private.requester_route_evidence', 'INSERT,UPDATE,DELETE,TRUNCATE')
  );
END;
$setup$;

SELECT check_number, test_name, passed
FROM requester_route_results
ORDER BY check_number;

DO $verify$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM requester_route_results
    WHERE NOT passed
  ) THEN
    RAISE EXCEPTION '0092 requester route evidence regression failed';
  END IF;
END;
$verify$;

ROLLBACK;
