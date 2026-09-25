BEGIN;

-- =========================================================
-- 0046 Requester availability matching context
-- =========================================================
--
-- WE DO NOT CREATE JOURNEYS.
--
-- This server-only boundary allows a verified requester to
-- privately evaluate one independently offered movement by
-- referring to its public-safe availability id.
--
-- The requester does not supply or receive the offerer's
-- private movement-intent id, route-evidence id or route
-- geometry.
--
-- This function:
-- - does not create interest;
-- - does not create a movement offer;
-- - does not create an alignment or journey;
-- - does not reserve or consume capacity;
-- - does not notify or expose the requester to the offerer;
-- - does not define a maximum detour or distance;
-- - does not decide whether two people should move together.
--
-- It privately resolves the availability's immutable trusted
-- bindings, revalidates live availability eligibility, and
-- then reuses the existing trusted matching context from 0036.

CREATE FUNCTION
public.get_requester_availability_matching_context_for_server(
  p_verified_member_id uuid,
  p_movement_need_id uuid,
  p_availability_id uuid
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
AS $requester_availability_matching_context$
DECLARE
  v_need
    public.movement_needs%ROWTYPE;

  v_preliminary_availability
    private.offering_movement_availability%ROWTYPE;

  v_availability
    private.offering_movement_availability%ROWTYPE;

  v_context record;
BEGIN
  -- Keep the same transaction-isolation contract used by the
  -- existing trusted matching and availability machinery.
  IF current_setting('transaction_isolation')
       <> 'read committed' THEN
    RAISE EXCEPTION USING
      ERRCODE = '25000',
      MESSAGE =
        'Requester availability matching context requires READ COMMITTED';
  END IF;


  IF p_verified_member_id IS NULL
     OR p_movement_need_id IS NULL
     OR p_availability_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22004',
      MESSAGE =
        'Verified member, movement need and availability are required';
  END IF;


  -- =======================================================
  -- Resolve immutable availability bindings without taking
  -- locks out of order.
  --
  -- Availability intent/member/route bindings are immutable.
  -- Mutable eligibility is NOT trusted from this preliminary
  -- read and is revalidated under locks below.
  -- =======================================================

  SELECT a.*
  INTO v_preliminary_availability
  FROM private.offering_movement_availability a
  WHERE a.id = p_availability_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Offering movement availability not found';
  END IF;


  -- =======================================================
  -- Requester authorization and serialization boundary
  -- =======================================================

  SELECT n.*
  INTO v_need
  FROM public.movement_needs n
  WHERE n.id = p_movement_need_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Movement need not found';
  END IF;


  -- This availability-based path belongs specifically to the
  -- requester. Owning the offered movement does not authorize
  -- use of this endpoint.
  IF v_need.member_id
       IS DISTINCT FROM p_verified_member_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE =
        'Verified member does not own this movement need';
  END IF;


  -- Reuse the lock convention established by 0045:
  --
  -- movement need
  -- -> requester trusted endpoint references
  -- -> offering intent
  --
  -- The availability assertion below then continues with:
  --
  -- exact trusted route
  -- -> availability
  -- -> vehicle
  -- -> active member vehicle access.
  --
  -- The preliminary availability read above is used only to
  -- discover the immutable intent binding needed to establish
  -- this lock order.
  PERFORM
    private.lock_offer_availability_intent(
      v_need.id,
      v_preliminary_availability
        .offering_movement_intent_id
    );


  -- =======================================================
  -- Authoritative availability eligibility
  -- =======================================================
  --
  -- Do not trust the earlier discovery snapshot.
  --
  -- 0044 revalidates the current intent, exact trusted route,
  -- availability lifecycle/expiry/capacity and active vehicle
  -- access while taking the authoritative locks.

  PERFORM
    private.assert_offering_movement_availability(
      p_availability_id
    );


  -- Re-read the authoritative row while its availability lock
  -- is held by the current transaction.
  SELECT a.*
  INTO STRICT v_availability
  FROM private.offering_movement_availability a
  WHERE a.id = p_availability_id
  FOR UPDATE;


  -- Group travel is all-or-nothing. This private relationship
  -- check does not reserve capacity, but an availability that
  -- cannot currently hold the requester's complete declared
  -- group is not eligible for this matching context.
  IF v_need.people_count
       > v_availability.remaining_places THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Availability cannot serve the complete requester group';
  END IF;


  -- The availability's trusted bindings are immutable, but
  -- verify that the row used after locking still represents
  -- exactly the context resolved before locking.
  IF v_availability.offering_movement_intent_id
       IS DISTINCT FROM
         v_preliminary_availability
           .offering_movement_intent_id
     OR v_availability.offering_member_id
       IS DISTINCT FROM
         v_preliminary_availability
           .offering_member_id
     OR v_availability.route_evidence_id
       IS DISTINCT FROM
         v_preliminary_availability
           .route_evidence_id
     OR v_availability.route_evidence_version
       IS DISTINCT FROM
         v_preliminary_availability
           .route_evidence_version THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Availability trusted binding changed during matching';
  END IF;


  -- =======================================================
  -- Existing trusted matching context
  -- =======================================================
  --
  -- Reuse 0036 rather than duplicating requester-coordinate,
  -- intent, route, expiry or trusted-location validation.

  SELECT c.*
  INTO STRICT v_context
  FROM public.get_trusted_matching_context_for_server(
    v_need.id,
    v_availability.offering_movement_intent_id,
    v_availability.offering_member_id
  ) c;


  -- =======================================================
  -- Exact cross-boundary binding check
  -- =======================================================
  --
  -- The trusted context must still describe the exact
  -- requester and exact route version represented by this
  -- availability.

  IF v_context.movement_need_id
       IS DISTINCT FROM v_need.id
     OR v_context.requesting_member_id
       IS DISTINCT FROM p_verified_member_id
     OR v_context.offering_movement_intent_id
       IS DISTINCT FROM
         v_availability.offering_movement_intent_id
     OR v_context.offering_member_id
       IS DISTINCT FROM
         v_availability.offering_member_id
     OR v_context.route_evidence_id
       IS DISTINCT FROM
         v_availability.route_evidence_id
     OR v_context.route_evidence_version
       IS DISTINCT FROM
         v_availability.route_evidence_version THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Availability does not match trusted matching context';
  END IF;


  -- Return the normal TrustedMatchingContext shape only to the
  -- trusted server caller. The authenticated application client
  -- has no EXECUTE privilege on this function.
  RETURN QUERY
  SELECT
    v_context.movement_need_id,
    v_context.requesting_member_id,

    v_context.requester_origin_location_reference_id,
    v_context.requester_origin_latitude,
    v_context.requester_origin_longitude,

    v_context.requester_destination_location_reference_id,
    v_context.requester_destination_latitude,
    v_context.requester_destination_longitude,

    v_context.requester_earliest_departure_at,
    v_context.requester_latest_departure_at,

    v_context.offering_movement_intent_id,
    v_context.offering_member_id,
    v_context.offering_intent_version,

    v_context.offering_earliest_departure_at,
    v_context.offering_latest_departure_at,

    v_context.route_evidence_id,
    v_context.route_evidence_version,
    v_context.route_shape_format,
    v_context.route_shape,
    v_context.route_distance_meters,
    v_context.route_duration_seconds,
    v_context.route_generated_at,
    v_context.route_expires_at;
END;
$requester_availability_matching_context$;


REVOKE ALL
ON FUNCTION
public.get_requester_availability_matching_context_for_server(
  uuid,
  uuid,
  uuid
)
FROM PUBLIC, anon, authenticated, service_role;


GRANT EXECUTE
ON FUNCTION
public.get_requester_availability_matching_context_for_server(
  uuid,
  uuid,
  uuid
)
TO service_role;


COMMIT;