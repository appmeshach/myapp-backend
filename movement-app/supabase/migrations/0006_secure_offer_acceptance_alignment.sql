BEGIN;

-- Raw alignment access is intentionally removed before activation so participants
-- cannot read the other member's UUID directly through public.alignments.
DROP POLICY IF EXISTS "alignments_select_participants"
ON public.alignments;

REVOKE SELECT ON TABLE public.alignments FROM authenticated;

-- Direct client updates on movement needs are intentionally removed so clients
-- cannot bypass controlled movement-state transitions after acceptance.
REVOKE UPDATE ON TABLE public.movement_needs FROM authenticated;

-- =========================================================
-- public.create_movement_offer
-- =========================================================
-- This is the controlled offer-creation RPC for authenticated members.
-- It preserves the masked-privacy flow from 0005 and serializes with acceptance
-- through a shared movement_need row lock.
CREATE OR REPLACE FUNCTION public.create_movement_offer(
  p_movement_need_id uuid,
  p_vehicle_id uuid,
  p_seats_offered integer,
  p_proposed_pickup_area text DEFAULT NULL,
  p_proposed_dropoff_area text DEFAULT NULL,
  p_estimated_arrival_minutes integer DEFAULT NULL
)
RETURNS TABLE (
  movement_offer_id uuid,
  status text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id uuid;
  v_need_record public.movement_needs%ROWTYPE;
  v_vehicle_record public.vehicles%ROWTYPE;
  v_pickup_area text;
  v_dropoff_area text;
  v_offer_id uuid;
  v_offer_status text;
  v_created_at timestamptz;
BEGIN
  v_member_id := auth.uid();

  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT *
  INTO v_need_record
  FROM public.movement_needs AS mn
  WHERE mn.id = p_movement_need_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Movement need not found';
  END IF;

  IF v_need_record.status <> 'discoverable' THEN
    RAISE EXCEPTION 'Movement need is not discoverable';
  END IF;

  IF v_need_record.member_id = v_member_id THEN
    RAISE EXCEPTION 'You cannot offer on your own movement need';
  END IF;

  SELECT *
  INTO v_vehicle_record
  FROM public.vehicles AS v
  WHERE v.id = p_vehicle_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vehicle not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.member_vehicle_access AS mva
    WHERE mva.member_id = v_member_id
      AND mva.vehicle_id = p_vehicle_id
      AND mva.active = TRUE
  ) THEN
    RAISE EXCEPTION 'Vehicle access not found for the authenticated user';
  END IF;

  IF p_seats_offered IS NULL THEN
    RAISE EXCEPTION 'Seats offered is required';
  END IF;

  IF p_seats_offered < 1 THEN
    RAISE EXCEPTION 'Seats offered must be at least 1';
  END IF;

  IF p_seats_offered > v_vehicle_record.seat_capacity THEN
    RAISE EXCEPTION 'Seats offered cannot exceed the vehicle seat capacity';
  END IF;

  IF p_estimated_arrival_minutes IS NOT NULL AND p_estimated_arrival_minutes < 0 THEN
    RAISE EXCEPTION 'Estimated arrival minutes cannot be negative';
  END IF;

  v_pickup_area := p_proposed_pickup_area;
  IF v_pickup_area IS NOT NULL THEN
    v_pickup_area := trim(v_pickup_area);
    IF v_pickup_area = '' THEN
      v_pickup_area := NULL;
    END IF;
    IF length(v_pickup_area) > 200 THEN
      RAISE EXCEPTION 'Proposed pickup area must be 200 characters or fewer';
    END IF;
  END IF;

  v_dropoff_area := p_proposed_dropoff_area;
  IF v_dropoff_area IS NOT NULL THEN
    v_dropoff_area := trim(v_dropoff_area);
    IF v_dropoff_area = '' THEN
      v_dropoff_area := NULL;
    END IF;
    IF length(v_dropoff_area) > 200 THEN
      RAISE EXCEPTION 'Proposed dropoff area must be 200 characters or fewer';
    END IF;
  END IF;

  INSERT INTO public.movement_offers (
    movement_need_id,
    offering_member_id,
    vehicle_id,
    seats_offered,
    proposed_pickup_area,
    proposed_dropoff_area,
    estimated_arrival_minutes,
    status,
    created_at,
    updated_at
  )
  VALUES (
    p_movement_need_id,
    v_member_id,
    p_vehicle_id,
    p_seats_offered,
    v_pickup_area,
    v_dropoff_area,
    p_estimated_arrival_minutes,
    'pending',
    NOW(),
    NOW()
  )
  RETURNING public.movement_offers.id,
            public.movement_offers.status,
            public.movement_offers.created_at
  INTO v_offer_id, v_offer_status, v_created_at;

  RETURN QUERY
  SELECT v_offer_id, v_offer_status, v_created_at;
END;
$$;

REVOKE ALL ON FUNCTION public.create_movement_offer(uuid, uuid, integer, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_movement_offer(uuid, uuid, integer, text, text, integer) TO authenticated;

-- =========================================================
-- public.accept_movement_offer
-- =========================================================
-- This is the controlled acceptance path for an offer sent to a movement need.
-- Acceptance creates a masked alignment state without revealing identities,
-- chat, exact pickup coordination, or payment details before activation.
CREATE OR REPLACE FUNCTION public.accept_movement_offer(
  p_movement_offer_id uuid
)
RETURNS TABLE (
  alignment_id uuid,
  alignment_status text,
  movement_need_id uuid,
  movement_offer_id uuid,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id uuid;
  v_need_id uuid;
  v_offer_record public.movement_offers%ROWTYPE;
  v_need_record public.movement_needs%ROWTYPE;
  v_alignment_id uuid;
  v_created_at timestamptz;
BEGIN
  v_member_id := auth.uid();

  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT mo.movement_need_id
  INTO v_need_id
  FROM public.movement_offers AS mo
  WHERE mo.id = p_movement_offer_id;

  IF v_need_id IS NULL THEN
    RAISE EXCEPTION 'Movement offer not found';
  END IF;

  SELECT *
  INTO v_need_record
  FROM public.movement_needs AS mn
  WHERE mn.id = v_need_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Movement need not found';
  END IF;

  SELECT *
  INTO v_offer_record
  FROM public.movement_offers AS mo
  WHERE mo.id = p_movement_offer_id
    AND mo.movement_need_id = v_need_record.id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Movement offer not found';
  END IF;

  IF v_offer_record.status <> 'pending' THEN
    RAISE EXCEPTION 'Movement offer is not pending';
  END IF;

  IF v_need_record.status <> 'discoverable' THEN
    RAISE EXCEPTION 'Movement need is not discoverable';
  END IF;

  IF v_need_record.member_id <> v_member_id THEN
    RAISE EXCEPTION 'Only the movement need owner may accept an offer';
  END IF;

  IF v_need_record.member_id = v_offer_record.offering_member_id THEN
    RAISE EXCEPTION 'The offering member cannot accept their own offer';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.member_vehicle_access AS mva
    WHERE mva.member_id = v_offer_record.offering_member_id
      AND mva.vehicle_id = v_offer_record.vehicle_id
      AND mva.active = TRUE
  ) THEN
    RAISE EXCEPTION 'The offering member no longer has active access to this vehicle';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.alignments AS a
    WHERE a.movement_need_id = v_need_record.id
      AND a.status IN (
        'awaiting_activation_payment',
        'activated',
        'in_progress',
        'completed'
      )
  ) THEN
    RAISE EXCEPTION 'This movement need already has an active or completed alignment';
  END IF;

  INSERT INTO public.alignments (
    movement_need_id,
    movement_offer_id,
    member_needing_movement_id,
    offering_member_id,
    activation_fee_minor,
    activation_currency,
    status,
    activated_at,
    created_at,
    updated_at
  )
  VALUES (
    v_need_record.id,
    v_offer_record.id,
    v_member_id,
    v_offer_record.offering_member_id,
    NULL,
    'NGN',
    'awaiting_activation_payment',
    NULL,
    NOW(),
    NOW()
  )
  RETURNING public.alignments.id, public.alignments.created_at
  INTO v_alignment_id, v_created_at;

  UPDATE public.movement_offers AS mo
  SET status = 'accepted',
      updated_at = NOW()
  WHERE mo.id = v_offer_record.id;

  UPDATE public.movement_needs AS mn
  SET status = 'closed',
      updated_at = NOW()
  WHERE mn.id = v_need_record.id;

  UPDATE public.movement_offers AS mo
  SET status = 'rejected',
      updated_at = NOW()
  WHERE mo.movement_need_id = v_need_record.id
    AND mo.id <> v_offer_record.id
    AND mo.status = 'pending';

  RETURN QUERY
  SELECT
    v_alignment_id,
    'awaiting_activation_payment'::text,
    v_need_record.id,
    v_offer_record.id,
    v_created_at;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_movement_offer(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_movement_offer(uuid) TO authenticated;

-- =========================================================
-- public.get_my_alignment_status
-- =========================================================
-- This RPC provides a safe alignment-state check so either participant can inspect
-- status without receiving the other participant's identity or raw profile data.
CREATE OR REPLACE FUNCTION public.get_my_alignment_status(
  p_alignment_id uuid
)
RETURNS TABLE (
  alignment_id uuid,
  movement_need_id uuid,
  movement_offer_id uuid,
  alignment_status text,
  activation_fee_minor bigint,
  activation_currency text,
  activated_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id uuid;
  v_alignment_record public.alignments%ROWTYPE;
BEGIN
  v_member_id := auth.uid();

  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT *
  INTO v_alignment_record
  FROM public.alignments AS a
  WHERE a.id = p_alignment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Alignment not found';
  END IF;

  IF v_alignment_record.member_needing_movement_id <> v_member_id
    AND v_alignment_record.offering_member_id <> v_member_id THEN
    RAISE EXCEPTION 'You are not a participant in this alignment';
  END IF;

  RETURN QUERY
  SELECT
    a.id AS alignment_id,
    a.movement_need_id,
    a.movement_offer_id,
    a.status AS alignment_status,
    a.activation_fee_minor,
    a.activation_currency,
    a.activated_at,
    a.created_at,
    a.updated_at
  FROM public.alignments AS a
  WHERE a.id = p_alignment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_alignment_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_alignment_status(uuid) TO authenticated;

COMMIT;
