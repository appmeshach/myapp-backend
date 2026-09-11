BEGIN;

-- Remove the raw incoming-offer access path. Need owners will review offers only
-- through discover_masked_offers_for_my_need so the offering member's raw UUID and
-- identifying information remain hidden before alignment activation.
DROP POLICY IF EXISTS "movement_offers_select_related_need"
ON public.movement_offers;

-- =========================================================
-- public.create_movement_offer
-- =========================================================
-- This is a controlled offer-creation RPC for authenticated members.
-- The need owner sees incoming offers only through the masked discovery RPC
-- below so protected identity information remains hidden until alignment.
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
  WHERE mn.id = p_movement_need_id;

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
-- public.discover_masked_offers_for_my_need
-- =========================================================
-- The need owner sees incoming offers only through this masked discovery RPC so
-- the offering member's raw UUID and identifying information remain hidden
-- before alignment activation.
CREATE OR REPLACE FUNCTION public.discover_masked_offers_for_my_need(
  p_movement_need_id uuid,
  p_limit integer DEFAULT 20
)
RETURNS TABLE (
  movement_offer_id uuid,
  seats_offered integer,
  estimated_arrival_minutes integer,
  offer_status text,
  offer_created_at timestamptz,
  vehicle_make text,
  vehicle_model text,
  vehicle_year integer,
  vehicle_color text,
  vehicle_seat_capacity integer,
  age integer,
  common_movement_area text,
  identity_verified boolean,
  profile_media_verified boolean,
  completed_movements integer,
  rating numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id uuid;
  v_need_owner_id uuid;
BEGIN
  v_member_id := auth.uid();

  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_limit IS NULL THEN
    RAISE EXCEPTION 'p_limit is required';
  END IF;

  IF p_limit < 1 OR p_limit > 50 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 50';
  END IF;

  SELECT mn.member_id
  INTO v_need_owner_id
  FROM public.movement_needs AS mn
  WHERE mn.id = p_movement_need_id;

  IF v_need_owner_id IS NULL THEN
    RAISE EXCEPTION 'Movement need not found';
  END IF;

  IF v_need_owner_id <> v_member_id THEN
    RAISE EXCEPTION 'Movement need does not belong to the authenticated user';
  END IF;

  RETURN QUERY
  SELECT
    mo.id AS movement_offer_id,
    mo.seats_offered,
    mo.estimated_arrival_minutes,
    mo.status AS offer_status,
    mo.created_at AS offer_created_at,
    v.make AS vehicle_make,
    v.model AS vehicle_model,
    v.year AS vehicle_year,
    v.color AS vehicle_color,
    v.seat_capacity AS vehicle_seat_capacity,
    CASE
      WHEN m.date_of_birth IS NOT NULL THEN
        EXTRACT(YEAR FROM age(CURRENT_DATE, m.date_of_birth))::integer
      ELSE NULL
    END AS age,
    m.common_movement_area,
    m.identity_verified,
    m.profile_media_verified,
    m.completed_movements,
    m.rating
  FROM public.movement_offers AS mo
  INNER JOIN public.vehicles AS v
    ON v.id = mo.vehicle_id
  INNER JOIN public.members AS m
    ON m.id = mo.offering_member_id
  WHERE mo.movement_need_id = p_movement_need_id
    AND mo.status = 'pending'
  ORDER BY
    mo.created_at ASC
  LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.discover_masked_offers_for_my_need(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.discover_masked_offers_for_my_need(uuid, integer) TO authenticated;

COMMIT;
