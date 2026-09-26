BEGIN;

-- WE DO NOT CREATE JOURNEYS. Share the exact 0045 implementation, including
-- auth.uid(), all validation, locks, and both immutable offer bindings.
-- Moving the function preserves its body instead of copying offer logic.
ALTER FUNCTION public.create_movement_offer(uuid,uuid,uuid,integer,text,text,integer)
SET SCHEMA private;
ALTER FUNCTION private.create_movement_offer(uuid,uuid,uuid,integer,text,text,integer)
RENAME TO create_movement_offer_internal;
REVOKE ALL ON FUNCTION private.create_movement_offer_internal(uuid,uuid,uuid,integer,text,text,integer)
FROM PUBLIC, anon, authenticated, service_role;

-- Preserve the request-first API, defaults, return shape and authorization.
CREATE FUNCTION public.create_movement_offer(
  p_movement_need_id uuid,
  p_route_match_evidence_id uuid,
  p_availability_id uuid,
  p_seats_offered integer,
  p_proposed_pickup_area text DEFAULT NULL,
  p_proposed_dropoff_area text DEFAULT NULL,
  p_estimated_arrival_minutes integer DEFAULT NULL
)
RETURNS TABLE (movement_offer_id uuid, status text, created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $request_first$
BEGIN
  RETURN QUERY SELECT * FROM private.create_movement_offer_internal(
    p_movement_need_id, p_route_match_evidence_id, p_availability_id,
    p_seats_offered, p_proposed_pickup_area, p_proposed_dropoff_area,
    p_estimated_arrival_minutes);
END;
$request_first$;
REVOKE ALL ON FUNCTION public.create_movement_offer(uuid,uuid,uuid,integer,text,text,integer)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_movement_offer(uuid,uuid,uuid,integer,text,text,integer)
TO authenticated;

CREATE FUNCTION public.create_movement_offer_from_interest(
  p_interest_id uuid,
  p_seats_offered integer,
  p_proposed_pickup_area text DEFAULT NULL,
  p_proposed_dropoff_area text DEFAULT NULL,
  p_estimated_arrival_minutes integer DEFAULT NULL
)
RETURNS TABLE (movement_offer_id uuid, status text, created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $interest_offer$
DECLARE
  v_member_id uuid := auth.uid();
  v_interest private.requester_movement_interests%ROWTYPE;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION USING ERRCODE = '25000',
      MESSAGE = 'Interest offer creation requires READ COMMITTED';
  END IF;
  IF v_member_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.members m WHERE m.id = v_member_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Authenticated member required';
  END IF;
  IF p_interest_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22004', MESSAGE = 'Interest is required';
  END IF;

  -- Preliminary immutable bindings only: do not lock interest before support.
  SELECT i.* INTO v_interest FROM private.requester_movement_interests i
  WHERE i.id = p_interest_id AND i.offering_member_id = v_member_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Requester interest unavailable';
  END IF;

  -- 0047 takes need UPDATE -> requester endpoints SHARE -> intent UPDATE ->
  -- exact route -> availability UPDATE -> vehicle/access -> match SHARE ->
  -- interest SHARE. It proves every immutable binding and current support.
  -- Withdrawal locks only interest; the SHARE lock blocks withdrawal through
  -- offer construction. No support lock is upgraded by this wrapper.
  PERFORM private.assert_requester_movement_interest(v_interest.id);
  SELECT i.* INTO STRICT v_interest FROM private.requester_movement_interests i
  WHERE i.id = p_interest_id;

  -- Explicit final ownership/lifecycle check under the assertion's locks.
  IF v_interest.offering_member_id IS DISTINCT FROM v_member_id
    OR v_interest.requesting_member_id = v_member_id
    OR v_interest.status <> 'active'
    OR v_interest.expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Interest is not actionable';
  END IF;

  -- Reuse objective evidence, never recompute it. The unchanged constructor
  -- revalidates evidence/availability and proposal fields before inserting.
  -- Existing 0042 evidence-to-offer uniqueness remains in force.
  RETURN QUERY SELECT * FROM private.create_movement_offer_internal(
    v_interest.movement_need_id, v_interest.route_match_evidence_id,
    v_interest.availability_id, p_seats_offered, p_proposed_pickup_area,
    p_proposed_dropoff_area, p_estimated_arrival_minutes);
END;
$interest_offer$;
REVOKE ALL ON FUNCTION public.create_movement_offer_from_interest(uuid,integer,text,text,integer)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_movement_offer_from_interest(uuid,integer,text,text,integer)
TO authenticated;

COMMIT;
