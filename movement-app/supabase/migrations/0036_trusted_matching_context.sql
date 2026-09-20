BEGIN;

-- =========================================================
-- 0036 Trusted matching context
-- =========================================================
--
-- Server-only read boundary for evaluating whether an
-- offerer's independently established movement can serve a
-- requester's trusted movement need.
--
-- This function:
-- - does not create a journey;
-- - does not create a movement offer;
-- - does not decide geographic compatibility;
-- - does not define detour/distance thresholds;
-- - does not expose private coordinates or route geometry
--   directly to authenticated clients.
--
-- The future trusted matcher may consume this context and
-- calculate compatibility outside the client trust boundary.

CREATE OR REPLACE FUNCTION
public.get_trusted_matching_context_for_server(
  p_movement_need_id uuid,
  p_offering_movement_intent_id uuid,
  p_offering_member_id uuid
)
RETURNS TABLE (
  movement_need_id uuid,
  requesting_member_id uuid,

  requester_origin_location_reference_id uuid,
  requester_origin_latitude numeric,
  requester_origin_longitude numeric,

  requester_destination_location_reference_id uuid,
  requester_destination_latitude numeric,
  requester_destination_longitude numeric,

  requester_earliest_departure_at timestamptz,
  requester_latest_departure_at timestamptz,

  offering_movement_intent_id uuid,
  offering_member_id uuid,
  offering_intent_version integer,

  offering_earliest_departure_at timestamptz,
  offering_latest_departure_at timestamptz,

  route_evidence_id uuid,
  route_evidence_version integer,
  route_shape_format text,
  route_shape jsonb,
  route_distance_meters bigint,
  route_duration_seconds bigint,
  route_generated_at timestamptz,
  route_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $trusted_matching_context$
DECLARE
  v_need public.movement_needs%ROWTYPE;

  v_requester_origin_id uuid;
  v_requester_destination_id uuid;

  v_requester_origin
    private.movement_location_references%ROWTYPE;

  v_requester_destination
    private.movement_location_references%ROWTYPE;

  v_intent
    private.offering_movement_intents%ROWTYPE;

  v_evidence
    private.offering_route_evidence%ROWTYPE;

  v_now timestamptz;
BEGIN
  IF current_setting('transaction_isolation')
       <> 'read committed' THEN
    RAISE EXCEPTION USING
      ERRCODE = '25000',
      MESSAGE =
        'Trusted matching context requires READ COMMITTED';
  END IF;


  -- =======================================================
  -- Required identities
  -- =======================================================

  IF p_movement_need_id IS NULL
     OR p_offering_movement_intent_id IS NULL
     OR p_offering_member_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22004',
      MESSAGE =
        'Movement need, offering intent and offering member are required';
  END IF;


  -- =======================================================
  -- Requester movement need
  --
  -- Lock the need first. Future matching/materialization
  -- writers must preserve this lock order.
  -- =======================================================

  SELECT n.*
  INTO v_need
  FROM public.movement_needs n
  WHERE n.id = p_movement_need_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Movement need not found';
  END IF;

  IF v_need.status <> 'discoverable' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Movement need is not available for matching';
  END IF;

  IF v_need.member_id = p_offering_member_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Offering member cannot match their own movement need';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.alignments a
    WHERE a.movement_need_id = v_need.id
      AND a.status IN (
        'awaiting_activation_payment',
        'activated',
        'in_progress',
        'completed'
      )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Movement need already has an active or completed alignment';
  END IF;


  -- =======================================================
  -- Trusted requester endpoint bindings
  -- =======================================================

  SELECT l.location_reference_id
  INTO v_requester_origin_id
  FROM private.movement_need_locations l
  WHERE l.movement_need_id = v_need.id
    AND l.role = 'origin';

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Movement need trusted origin is unavailable';
  END IF;


  SELECT l.location_reference_id
  INTO v_requester_destination_id
  FROM private.movement_need_locations l
  WHERE l.movement_need_id = v_need.id
    AND l.role = 'destination';

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Movement need trusted destination is unavailable';
  END IF;


  IF v_requester_origin_id
       = v_requester_destination_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Movement need trusted endpoints must be distinct';
  END IF;


  IF (
    SELECT count(*)
    FROM private.movement_need_locations l
    WHERE l.movement_need_id = v_need.id
  ) <> 2 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Movement need must have exactly two trusted endpoints';
  END IF;


  SELECT lr.*
  INTO STRICT v_requester_origin
  FROM private.movement_location_references lr
  WHERE lr.id = v_requester_origin_id
  FOR SHARE;


  SELECT lr.*
  INTO STRICT v_requester_destination
  FROM private.movement_location_references lr
  WHERE lr.id = v_requester_destination_id
  FOR SHARE;


  v_now := clock_timestamp();

  IF v_requester_origin.owner_member_id
       <> v_need.member_id
     OR v_requester_destination.owner_member_id
       <> v_need.member_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Movement need trusted endpoint ownership is invalid';
  END IF;


  IF v_requester_origin.resolution_status
       <> 'resolved'
     OR v_requester_destination.resolution_status
       <> 'resolved'
     OR v_requester_origin.source_kind
       <> 'provider_resolved'
     OR v_requester_destination.source_kind
       <> 'provider_resolved' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Movement need requires resolved provider endpoints';
  END IF;


  IF v_requester_origin.latitude IS NULL
     OR v_requester_origin.longitude IS NULL
     OR v_requester_destination.latitude IS NULL
     OR v_requester_destination.longitude IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Movement need trusted coordinates are incomplete';
  END IF;


  IF NOT (
       v_requester_origin.latitude BETWEEN -90 AND 90
     )
     OR NOT (
       v_requester_origin.longitude BETWEEN -180 AND 180
     )
     OR NOT (
       v_requester_destination.latitude BETWEEN -90 AND 90
     )
     OR NOT (
       v_requester_destination.longitude BETWEEN -180 AND 180
     )
     OR v_requester_origin.latitude::text
       IN ('NaN', 'Infinity', '-Infinity')
     OR v_requester_origin.longitude::text
       IN ('NaN', 'Infinity', '-Infinity')
     OR v_requester_destination.latitude::text
       IN ('NaN', 'Infinity', '-Infinity')
     OR v_requester_destination.longitude::text
       IN ('NaN', 'Infinity', '-Infinity') THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Movement need trusted coordinates are invalid';
  END IF;


  IF (
       v_requester_origin.expires_at IS NOT NULL
       AND v_requester_origin.expires_at <= v_now
     )
     OR (
       v_requester_destination.expires_at IS NOT NULL
       AND v_requester_destination.expires_at <= v_now
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Movement need trusted endpoint has expired';
  END IF;


  -- =======================================================
  -- Offerer's independently established movement intent
  -- =======================================================

  SELECT i.*
  INTO v_intent
  FROM private.offering_movement_intents i
  WHERE i.id = p_offering_movement_intent_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE =
        'Offering movement intent not found';
  END IF;


  IF v_intent.offering_member_id
       <> p_offering_member_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE =
        'Offering movement intent does not belong to member';
  END IF;


  v_now := clock_timestamp();

  IF v_intent.status <> 'current'
     OR (
       v_intent.expires_at IS NOT NULL
       AND v_intent.expires_at <= v_now
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Offering movement intent is not current and unexpired';
  END IF;


  PERFORM
    private.assert_offering_movement_intent(
      v_intent.id
    );


  -- =======================================================
  -- Exact current trusted route evidence
  --
  -- This is selected only after the offering-intent lock.
  -- The route producer uses the intent as its serialization
  -- boundary, so a competing route replacement cannot race
  -- this context read.
  -- =======================================================

  SELECT e.*
  INTO v_evidence
  FROM private.offering_route_evidence e
  WHERE e.offering_movement_intent_id
          = v_intent.id
    AND e.status = 'current'
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Current trusted offering route evidence is unavailable';
  END IF;


  v_now := clock_timestamp();

  IF v_evidence.offering_member_id
       <> p_offering_member_id
     OR v_evidence.status <> 'current'
     OR (
       v_evidence.expires_at IS NOT NULL
       AND v_evidence.expires_at <= v_now
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Offering route evidence is not eligible for matching';
  END IF;


  IF NOT EXISTS (
    SELECT 1
    FROM private.offering_movement_intent_locations il
    WHERE il.intent_id = v_intent.id
      AND il.role = 'origin'
      AND il.location_reference_id
            = v_evidence.origin_location_reference_id
  )
  OR NOT EXISTS (
    SELECT 1
    FROM private.offering_movement_intent_locations il
    WHERE il.intent_id = v_intent.id
      AND il.role = 'destination'
      AND il.location_reference_id
            = v_evidence.destination_location_reference_id
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Offering route evidence endpoints do not match intent';
  END IF;


  IF EXISTS (
    SELECT 1
    FROM private.movement_location_references lr
    WHERE lr.id IN (
      v_evidence.origin_location_reference_id,
      v_evidence.destination_location_reference_id
    )
      AND (
        lr.owner_member_id <> p_offering_member_id
        OR lr.resolution_status <> 'resolved'
        OR lr.source_kind <> 'provider_resolved'
        OR lr.latitude IS NULL
        OR lr.longitude IS NULL
        OR (
          lr.expires_at IS NOT NULL
          AND lr.expires_at <= v_now
        )
      )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Offering route evidence endpoints are not eligible for matching';
  END IF;


  IF (
    SELECT count(*)
    FROM private.movement_location_references lr
    WHERE lr.id IN (
      v_evidence.origin_location_reference_id,
      v_evidence.destination_location_reference_id
    )
  ) <> 2 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Offering route evidence endpoints are unavailable';
  END IF;


  IF v_evidence.route_shape_format
       <> 'geojson_linestring_v1' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Offering route evidence shape format is unsupported';
  END IF;


  PERFORM
    private.assert_geojson_linestring_v1(
      v_evidence.route_shape
    );


  IF v_evidence.route_distance_meters <= 0
     OR v_evidence.route_duration_seconds <= 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Offering route evidence distance or duration is invalid';
  END IF;


  -- =======================================================
  -- Return private matching inputs only to the trusted
  -- server caller.
  -- =======================================================

  RETURN QUERY
  SELECT
    v_need.id,
    v_need.member_id,

    v_requester_origin.id,
    v_requester_origin.latitude,
    v_requester_origin.longitude,

    v_requester_destination.id,
    v_requester_destination.latitude,
    v_requester_destination.longitude,

    v_need.earliest_departure_at,
    v_need.latest_departure_at,

    v_intent.id,
    v_intent.offering_member_id,
    v_intent.version,

    v_intent.earliest_departure_at,
    v_intent.latest_departure_at,

    v_evidence.id,
    v_evidence.version,
    v_evidence.route_shape_format,
    v_evidence.route_shape,
    v_evidence.route_distance_meters,
    v_evidence.route_duration_seconds,
    v_evidence.generated_at,
    v_evidence.expires_at;
END;
$trusted_matching_context$;


REVOKE ALL
ON FUNCTION
public.get_trusted_matching_context_for_server(
  uuid,
  uuid,
  uuid
)
FROM PUBLIC, anon, authenticated, service_role;


GRANT EXECUTE
ON FUNCTION
public.get_trusted_matching_context_for_server(
  uuid,
  uuid,
  uuid
)
TO service_role;


COMMIT;