BEGIN;

-- =========================================================
-- 0039 Authorized trusted matching context
-- =========================================================
--
-- WE DO NOT CREATE JOURNEYS.
--
-- This migration adds the participant-authorization boundary
-- in front of the private trusted matching context.
--
-- A server-verified authenticated member may request the
-- trusted matching context only when that member is:
--   * the requester who owns the movement need; or
--   * the offerer who owns the offering movement intent.
--
-- An unrelated member is rejected before private requester
-- coordinates or trusted route geometry are returned.
--
-- This function does NOT:
-- - calculate route-match geometry;
-- - create route-match evidence;
-- - create an offer, alignment or journey;
-- - define a maximum detour or distance;
-- - decide whether a requester and offerer should move
--   together;
-- - expose this context directly to authenticated clients.

CREATE FUNCTION
public.get_authorized_trusted_matching_context_for_server(
  p_verified_member_id uuid,
  p_movement_need_id uuid,
  p_offering_movement_intent_id uuid
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
AS $authorized_trusted_matching_context$
DECLARE
  v_requesting_member_id uuid;
  v_offering_member_id uuid;
BEGIN
  IF current_setting('transaction_isolation')
       <> 'read committed' THEN
    RAISE EXCEPTION USING
      ERRCODE = '25000',
      MESSAGE =
        'Authorized trusted matching context requires READ COMMITTED';
  END IF;


  IF p_verified_member_id IS NULL
     OR p_movement_need_id IS NULL
     OR p_offering_movement_intent_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22004',
      MESSAGE =
        'Verified member, movement need and offering intent are required';
  END IF;


  -- Preserve the same lock order used by the trusted matching
  -- context and route-match writer: movement need first.
  SELECT n.member_id
  INTO v_requesting_member_id
  FROM public.movement_needs n
  WHERE n.id = p_movement_need_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE =
        'Movement need not found';
  END IF;


  SELECT i.offering_member_id
  INTO v_offering_member_id
  FROM private.offering_movement_intents i
  WHERE i.id = p_offering_movement_intent_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE =
        'Offering movement intent not found';
  END IF;


  -- Authorization happens before 0036 is allowed to return
  -- private coordinates or route geometry to the server caller.
  IF p_verified_member_id
       IS DISTINCT FROM v_requesting_member_id
     AND p_verified_member_id
       IS DISTINCT FROM v_offering_member_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE =
        'Member is not authorized for this trusted matching context';
  END IF;


  RETURN QUERY
  SELECT c.*
  FROM public.get_trusted_matching_context_for_server(
    p_movement_need_id,
    p_offering_movement_intent_id,
    v_offering_member_id
  ) c;
END;
$authorized_trusted_matching_context$;


REVOKE ALL
ON FUNCTION
public.get_authorized_trusted_matching_context_for_server(
  uuid,
  uuid,
  uuid
)
FROM PUBLIC, anon, authenticated, service_role;


GRANT EXECUTE
ON FUNCTION
public.get_authorized_trusted_matching_context_for_server(
  uuid,
  uuid,
  uuid
)
TO service_role;


COMMIT;
