BEGIN;

-- Forward-only repair: keep the 0023 validator's interface and private ACL.
CREATE OR REPLACE FUNCTION private.assert_geojson_linestring_v1(p_shape jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $shape_validator$
DECLARE
  point jsonb;
  longitude_value numeric;
  latitude_value numeric;
BEGIN
  -- Separate type guards from array operations: SQL does not promise OR order.
  IF jsonb_typeof(p_shape) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Route shape must be an object';
  END IF;
  IF p_shape->>'type' IS DISTINCT FROM 'LineString'
    OR jsonb_typeof(p_shape->'coordinates') IS DISTINCT FROM 'array'
    OR (p_shape - 'type' - 'coordinates') IS DISTINCT FROM '{}'::jsonb THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Route shape must be normalized GeoJSON LineString v1';
  END IF;
  IF jsonb_array_length(p_shape->'coordinates') < 2 THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Route shape requires at least two points';
  END IF;
  FOR point IN SELECT value FROM jsonb_array_elements(p_shape->'coordinates')
  LOOP
    IF jsonb_typeof(point) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Route shape coordinates must be arrays';
    END IF;
    IF jsonb_array_length(point) <> 2
      OR jsonb_typeof(point->0) IS DISTINCT FROM 'number'
      OR jsonb_typeof(point->1) IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Route shape coordinates are invalid';
    END IF;
    longitude_value := (point->>0)::numeric;
    latitude_value := (point->>1)::numeric;
    IF longitude_value < -180 OR longitude_value > 180
      OR latitude_value < -90 OR latitude_value > 90 THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Route shape coordinates are out of range';
    END IF;
  END LOOP;
END;
$shape_validator$;

REVOKE ALL ON FUNCTION private.assert_geojson_linestring_v1(jsonb)
FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.record_offering_route_evidence_for_server(
  p_offering_movement_intent_id uuid,
  p_provider_namespace text,
  p_provider_product text,
  p_provider_version text,
  p_provider_route_reference text,
  p_route_shape jsonb,
  p_route_distance_meters bigint,
  p_route_duration_seconds bigint,
  p_generated_at timestamptz,
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS TABLE (
  route_evidence_id uuid,
  route_evidence_version integer,
  route_evidence_status text,
  route_evidence_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_intent private.offering_movement_intents%ROWTYPE;
  v_origin private.movement_location_references%ROWTYPE;
  v_destination private.movement_location_references%ROWTYPE;
  v_existing private.offering_route_evidence%ROWTYPE;
  v_origin_id uuid;
  v_destination_id uuid;
  v_effective_expires_at timestamptz;
  v_next_version integer;
  v_new_id uuid;
  v_now timestamptz;
BEGIN
  IF p_offering_movement_intent_id IS NULL
    OR p_provider_namespace IS NULL
    OR p_provider_product IS NULL
    OR p_provider_version IS NULL
    OR p_provider_route_reference IS NULL
    OR p_route_shape IS NULL
    OR p_route_distance_meters IS NULL
    OR p_route_duration_seconds IS NULL
    OR p_generated_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22004', MESSAGE='Complete trusted route evidence is required';
  END IF;

  SELECT i.* INTO v_intent
  FROM private.offering_movement_intents i
  WHERE i.id=p_offering_movement_intent_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='Offering movement intent not found';
  END IF;

  v_now := clock_timestamp();
  IF v_intent.status<>'current'
    OR (v_intent.expires_at IS NOT NULL AND v_intent.expires_at<=v_now) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Offering movement intent is not eligible for route evidence';
  END IF;

  PERFORM private.assert_offering_movement_intent(v_intent.id);

  SELECT il.location_reference_id INTO STRICT v_origin_id
  FROM private.offering_movement_intent_locations il
  WHERE il.intent_id=v_intent.id AND il.role='origin';

  SELECT il.location_reference_id INTO STRICT v_destination_id
  FROM private.offering_movement_intent_locations il
  WHERE il.intent_id=v_intent.id AND il.role='destination';

  SELECT lr.* INTO STRICT v_origin
  FROM private.movement_location_references lr
  WHERE lr.id=v_origin_id FOR SHARE;

  SELECT lr.* INTO STRICT v_destination
  FROM private.movement_location_references lr
  WHERE lr.id=v_destination_id FOR SHARE;

  v_now := clock_timestamp();
  IF v_origin.owner_member_id<>v_intent.offering_member_id
    OR v_destination.owner_member_id<>v_intent.offering_member_id
    OR v_origin.resolution_status<>'resolved'
    OR v_destination.resolution_status<>'resolved'
    OR v_origin.source_kind<>'provider_resolved'
    OR v_destination.source_kind<>'provider_resolved'
    OR (v_origin.expires_at IS NOT NULL AND v_origin.expires_at<=v_now)
    OR (v_destination.expires_at IS NOT NULL AND v_destination.expires_at<=v_now) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Trusted route evidence requires resolved eligible intent endpoints';
  END IF;

  IF NOT isfinite(p_generated_at)
    OR p_generated_at>v_now
    OR p_generated_at<v_intent.created_at
    OR p_generated_at<v_origin.resolved_at
    OR p_generated_at<v_destination.resolved_at THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Trusted route evidence generation time is invalid';
  END IF;

  IF p_expires_at IS NOT NULL
    AND (NOT isfinite(p_expires_at) OR p_expires_at<=v_now) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Trusted route evidence expiry is invalid';
  END IF;

  IF p_route_distance_meters<=0 OR p_route_duration_seconds<=0 THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Trusted route evidence distance and duration must be positive';
  END IF;

  PERFORM private.assert_geojson_linestring_v1(p_route_shape);

  v_effective_expires_at := LEAST(
    p_expires_at,
    v_intent.expires_at,
    v_origin.expires_at,
    v_destination.expires_at
  );

  IF v_effective_expires_at IS NOT NULL AND v_effective_expires_at<=v_now THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Trusted route evidence dependencies are expired';
  END IF;

  SELECT e.* INTO v_existing
  FROM private.offering_route_evidence e
  WHERE e.provider_namespace=p_provider_namespace
    AND e.provider_product=p_provider_product
    AND e.provider_version=p_provider_version
    AND e.provider_route_reference=p_provider_route_reference
  FOR UPDATE;

  IF FOUND THEN
    v_now := clock_timestamp();
    IF v_existing.offering_movement_intent_id IS DISTINCT FROM v_intent.id
      OR v_existing.offering_member_id IS DISTINCT FROM v_intent.offering_member_id
      OR v_existing.origin_location_reference_id IS DISTINCT FROM v_origin.id
      OR v_existing.destination_location_reference_id IS DISTINCT FROM v_destination.id
      OR v_existing.evidence_schema_version IS DISTINCT FROM 'offering_route_evidence_v1'
      OR v_existing.route_shape_format IS DISTINCT FROM 'geojson_linestring_v1'
      OR v_existing.route_shape IS DISTINCT FROM p_route_shape
      OR v_existing.route_distance_meters IS DISTINCT FROM p_route_distance_meters
      OR v_existing.route_duration_seconds IS DISTINCT FROM p_route_duration_seconds
      OR v_existing.generated_at IS DISTINCT FROM p_generated_at
      OR v_existing.expires_at IS DISTINCT FROM v_effective_expires_at THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Provider route reference does not match recorded evidence';
    END IF;

    IF v_existing.status<>'current'
      OR (v_existing.expires_at IS NOT NULL AND v_existing.expires_at<=v_now) THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Provider route reference belongs to stale evidence';
    END IF;

    PERFORM private.assert_offering_route_evidence(v_existing.id);
    RETURN QUERY SELECT v_existing.id, v_existing.version, v_existing.status, v_existing.expires_at;
    RETURN;
  END IF;

  SELECT COALESCE(MAX(e.version),0)+1 INTO v_next_version
  FROM private.offering_route_evidence e
  WHERE e.offering_movement_intent_id=v_intent.id;

  UPDATE private.offering_route_evidence e
  SET status='superseded'
  WHERE e.offering_movement_intent_id=v_intent.id
    AND e.status='current';

  INSERT INTO private.offering_route_evidence(
    offering_movement_intent_id, offering_member_id,
    origin_location_reference_id, destination_location_reference_id,
    version, evidence_schema_version,
    provider_namespace, provider_product, provider_version, provider_route_reference,
    route_shape_format, route_shape, route_distance_meters, route_duration_seconds,
    generated_at, expires_at, status
  )
  VALUES(
    v_intent.id, v_intent.offering_member_id,
    v_origin.id, v_destination.id,
    v_next_version, 'offering_route_evidence_v1',
    p_provider_namespace, p_provider_product, p_provider_version, p_provider_route_reference,
    'geojson_linestring_v1', p_route_shape, p_route_distance_meters, p_route_duration_seconds,
    p_generated_at, v_effective_expires_at, 'current'
  )
  RETURNING id INTO v_new_id;

  PERFORM private.assert_offering_route_evidence(v_new_id);

  -- Drain pending INSERT checks while this version is still current. Otherwise
  -- a later call in this transaction could supersede it before validation.
  SET CONSTRAINTS private.offering_route_evidence_complete IMMEDIATE;
  SET CONSTRAINTS private.offering_route_evidence_complete DEFERRED;

  RETURN QUERY
  SELECT e.id,e.version,e.status,e.expires_at
  FROM private.offering_route_evidence e
  WHERE e.id=v_new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_offering_route_evidence_for_server(
  uuid,text,text,text,text,jsonb,bigint,bigint,timestamptz,timestamptz
) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.record_offering_route_evidence_for_server(
  uuid,text,text,text,text,jsonb,bigint,bigint,timestamptz,timestamptz
) TO service_role;

COMMIT;
