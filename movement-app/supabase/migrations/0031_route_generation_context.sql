BEGIN;

-- Server-only read boundary for generating an offerer's own trusted route.
-- This does not create a journey, perform matching, or expose location data
-- directly to authenticated clients.
CREATE OR REPLACE FUNCTION public.get_offering_route_generation_context_for_server(
  p_offering_movement_intent_id uuid,
  p_offering_member_id uuid
)
RETURNS TABLE (
  offering_movement_intent_id uuid,
  offering_member_id uuid,
  origin_location_reference_id uuid,
  origin_latitude numeric,
  origin_longitude numeric,
  destination_location_reference_id uuid,
  destination_latitude numeric,
  destination_longitude numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_intent private.offering_movement_intents%ROWTYPE;
  v_origin_id uuid;
  v_destination_id uuid;
  v_origin private.movement_location_references%ROWTYPE;
  v_destination private.movement_location_references%ROWTYPE;
  v_now timestamptz;
BEGIN
  IF p_offering_movement_intent_id IS NULL
     OR p_offering_member_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22004',
      MESSAGE = 'Offering movement intent and member are required';
  END IF;

  SELECT i.*
  INTO v_intent
  FROM private.offering_movement_intents i
  WHERE i.id = p_offering_movement_intent_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Offering movement intent not found';
  END IF;

  v_now := clock_timestamp();

  IF v_intent.offering_member_id <> p_offering_member_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Offering movement intent does not belong to member';
  END IF;

  IF v_intent.status <> 'current'
     OR (
       v_intent.expires_at IS NOT NULL
       AND v_intent.expires_at <= v_now
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Offering movement intent is not eligible for route generation';
  END IF;

  PERFORM private.assert_offering_movement_intent(v_intent.id);

  SELECT il.location_reference_id
  INTO STRICT v_origin_id
  FROM private.offering_movement_intent_locations il
  WHERE il.intent_id = v_intent.id
    AND il.role = 'origin';

  SELECT il.location_reference_id
  INTO STRICT v_destination_id
  FROM private.offering_movement_intent_locations il
  WHERE il.intent_id = v_intent.id
    AND il.role = 'destination';

  IF v_origin_id = v_destination_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Route generation requires distinct origin and destination';
  END IF;

  SELECT lr.*
  INTO STRICT v_origin
  FROM private.movement_location_references lr
  WHERE lr.id = v_origin_id
  FOR SHARE;

  SELECT lr.*
  INTO STRICT v_destination
  FROM private.movement_location_references lr
  WHERE lr.id = v_destination_id
  FOR SHARE;

  v_now := clock_timestamp();

  IF v_origin.owner_member_id <> v_intent.offering_member_id
     OR v_destination.owner_member_id <> v_intent.offering_member_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Route generation endpoint ownership is invalid';
  END IF;

  IF v_origin.resolution_status <> 'resolved'
     OR v_destination.resolution_status <> 'resolved'
     OR v_origin.source_kind <> 'provider_resolved'
     OR v_destination.source_kind <> 'provider_resolved' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Route generation requires resolved provider endpoints';
  END IF;

  IF v_origin.latitude IS NULL
     OR v_origin.longitude IS NULL
     OR v_destination.latitude IS NULL
     OR v_destination.longitude IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Route generation coordinates are incomplete';
  END IF;

  IF NOT (v_origin.latitude BETWEEN -90 AND 90)
     OR NOT (v_origin.longitude BETWEEN -180 AND 180)
     OR NOT (v_destination.latitude BETWEEN -90 AND 90)
     OR NOT (v_destination.longitude BETWEEN -180 AND 180)
     OR v_origin.latitude::text IN ('NaN','Infinity','-Infinity')
     OR v_origin.longitude::text IN ('NaN','Infinity','-Infinity')
     OR v_destination.latitude::text IN ('NaN','Infinity','-Infinity')
     OR v_destination.longitude::text IN ('NaN','Infinity','-Infinity') THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Route generation coordinates are invalid';
  END IF;

  IF (
       v_origin.expires_at IS NOT NULL
       AND v_origin.expires_at <= v_now
     )
     OR (
       v_destination.expires_at IS NOT NULL
       AND v_destination.expires_at <= v_now
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Route generation endpoints are expired';
  END IF;

  RETURN QUERY
  SELECT
    v_intent.id,
    v_intent.offering_member_id,
    v_origin.id,
    v_origin.latitude,
    v_origin.longitude,
    v_destination.id,
    v_destination.latitude,
    v_destination.longitude;
END;
$$;

REVOKE ALL ON FUNCTION public.get_offering_route_generation_context_for_server(
  uuid,
  uuid
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.get_offering_route_generation_context_for_server(
  uuid,
  uuid
) TO service_role;

COMMIT;