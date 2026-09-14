BEGIN;

-- =========================================================
-- Group capacity and masked group discovery
-- =========================================================
-- This migration enforces group capacity limits during participant
-- invitation and offer acceptance, and adds safe pre-activation group
-- inspection for prospective offering members.
--
-- Core product rule:
-- movement_needs.people_count is the TOTAL number of travellers
-- including the primary requester.
--
-- Active participant slots = status IN ('confirmed', 'invited')
-- Primary requester counts as one confirmed slot.
--
-- Before offer acceptance:
-- - confirmed_count must equal people_count
-- - pending_invitation_count must be 0
-- - offer.seats_offered must be >= people_count

-- =========================================================
-- 1. Update: invite_movement_participant (capacity check)
-- =========================================================
-- Add group capacity validation before inviting a participant.

CREATE OR REPLACE FUNCTION public.invite_movement_participant(
  p_movement_need_id uuid,
  p_member_id uuid
)
RETURNS TABLE (
  participant_id uuid,
  movement_need_id uuid,
  participant_status text,
  invited_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_member_id uuid;
  v_need_record public.movement_needs%ROWTYPE;
  v_target_member_exists boolean;
  v_existing_participant public.movement_participants%ROWTYPE;
  v_new_participant_id uuid;
  v_invited_at timestamptz;
  v_active_slot_count integer;
BEGIN
  v_caller_member_id := auth.uid();
  
  IF v_caller_member_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  
  -- Fetch and lock the movement need FIRST (consistent lock order)
  SELECT *
  INTO v_need_record
  FROM public.movement_needs mn
  WHERE mn.id = p_movement_need_id
  FOR UPDATE;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Movement need not found';
  END IF;
  
  -- Caller must own the movement need
  IF v_need_record.member_id <> v_caller_member_id THEN
    RAISE EXCEPTION 'Only the movement need owner may invite participants';
  END IF;
  
  -- Movement need must still be discoverable
  IF v_need_record.status <> 'discoverable' THEN
    RAISE EXCEPTION 'Movement need is not discoverable; cannot invite participants';
  END IF;
  
  -- Caller cannot invite themselves
  IF p_member_id = v_caller_member_id THEN
    RAISE EXCEPTION 'You cannot invite yourself';
  END IF;
  
  -- Target member must exist
  SELECT EXISTS(
    SELECT 1
    FROM public.members m
    WHERE m.id = p_member_id
  ) INTO v_target_member_exists;
  
  IF NOT v_target_member_exists THEN
    RAISE EXCEPTION 'Target member does not exist';
  END IF;
  
  -- Check for existing participant row (with lock to prevent concurrent updates)
  SELECT *
  INTO v_existing_participant
  FROM public.movement_participants mp
  WHERE mp.movement_need_id = p_movement_need_id
    AND mp.member_id = p_member_id
  FOR UPDATE;
  
  IF FOUND THEN
    -- Already confirmed: reject clearly
    IF v_existing_participant.status = 'confirmed' THEN
      RAISE EXCEPTION 'This member is already a confirmed participant';
    END IF;
    
    -- Already invited: idempotent return
    IF v_existing_participant.status = 'invited' THEN
      RETURN QUERY
      SELECT
        v_existing_participant.id,
        v_existing_participant.movement_need_id,
        v_existing_participant.status,
        v_existing_participant.invited_at;
      RETURN;
    END IF;
    
    -- Declined or removed: allow re-invitation, but check capacity first
    IF v_existing_participant.status IN ('declined', 'removed') THEN
      -- Check current active slots (before re-inviting this member)
      SELECT COUNT(*)
      INTO v_active_slot_count
      FROM public.movement_participants mp
      WHERE mp.movement_need_id = p_movement_need_id
        AND mp.status IN ('confirmed', 'invited');
      
      IF v_active_slot_count >= v_need_record.people_count THEN
        RAISE EXCEPTION 'Movement group already has all declared traveller slots filled';
      END IF;
      
      UPDATE public.movement_participants mp
      SET
        status = 'invited',
        invited_by_member_id = v_caller_member_id,
        invited_at = NOW(),
        responded_at = NULL,
        updated_at = NOW()
      WHERE mp.id = v_existing_participant.id;
      
      v_invited_at := NOW();
      v_new_participant_id := v_existing_participant.id;
    END IF;
  ELSE
    -- New invitation: check capacity first
    SELECT COUNT(*)
    INTO v_active_slot_count
    FROM public.movement_participants mp
    WHERE mp.movement_need_id = p_movement_need_id
      AND mp.status IN ('confirmed', 'invited');
    
    IF v_active_slot_count >= v_need_record.people_count THEN
      RAISE EXCEPTION 'Movement group already has all declared traveller slots filled';
    END IF;
    
    INSERT INTO public.movement_participants (
      movement_need_id,
      member_id,
      role,
      status,
      invited_by_member_id,
      invited_at,
      responded_at,
      created_at,
      updated_at
    )
    VALUES (
      p_movement_need_id,
      p_member_id,
      'invited_participant',
      'invited',
      v_caller_member_id,
      NOW(),
      NULL,
      NOW(),
      NOW()
    )
    RETURNING public.movement_participants.id, public.movement_participants.invited_at
    INTO v_new_participant_id, v_invited_at;
  END IF;
  
  RETURN QUERY
  SELECT
    v_new_participant_id,
    p_movement_need_id,
    'invited'::text,
    v_invited_at;
END;
$$;

REVOKE ALL ON FUNCTION public.invite_movement_participant(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.invite_movement_participant(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.invite_movement_participant(uuid, uuid) FROM authenticated;

-- =========================================================
-- 2. Update: invite_movement_participant_by_share_token (capacity check)
-- =========================================================
-- Add group capacity validation to share-token-based invitations.

CREATE OR REPLACE FUNCTION public.invite_movement_participant_by_share_token(
  p_movement_need_id uuid,
  p_share_token text
)
RETURNS TABLE (
  participant_id uuid,
  movement_need_id uuid,
  participant_status text,
  invited_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_member_id uuid;
  v_share_record private.member_profile_shares%ROWTYPE;
  v_target_member_id uuid;
  v_need_record public.movement_needs%ROWTYPE;
  v_target_member_exists boolean;
  v_existing_participant public.movement_participants%ROWTYPE;
  v_new_participant_id uuid;
  v_invited_at timestamptz;
  v_active_slot_count integer;
BEGIN
  v_caller_member_id := auth.uid();
  
  IF v_caller_member_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  
  -- Validate share token input
  IF p_share_token IS NULL OR trim(p_share_token) = '' THEN
    RAISE EXCEPTION 'Share token is required';
  END IF;
  
    -- Initial token read WITHOUT row lock.
  -- We only use this first read to identify the intended target member.
  SELECT *
  INTO v_share_record
  FROM private.member_profile_shares mps
  WHERE mps.share_token = p_share_token;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Share token not found';
  END IF;

  v_target_member_id := v_share_record.member_id;

  -- Lock the movement need FIRST so all group mutations serialize
  -- consistently through the movement need.
  SELECT *
  INTO v_need_record
  FROM public.movement_needs mn
  WHERE mn.id = p_movement_need_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Movement need not found';
  END IF;

  -- Caller must own the movement need.
  IF v_need_record.member_id <> v_caller_member_id THEN
    RAISE EXCEPTION 'Only the movement need owner may invite participants';
  END IF;

  -- Movement need must still be discoverable.
  IF v_need_record.status <> 'discoverable' THEN
    RAISE EXCEPTION 'Movement need is not discoverable; cannot invite participants';
  END IF;

  -- Re-read and lock the SAME share token AFTER movement_need is locked.
  -- This second read is authoritative and protects against concurrent revocation.
  SELECT *
  INTO v_share_record
  FROM private.member_profile_shares mps
  WHERE mps.share_token = p_share_token
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Share token not found';
  END IF;

  -- Token must still resolve to the same target member.
  IF v_share_record.member_id <> v_target_member_id THEN
    RAISE EXCEPTION 'Share token target changed unexpectedly';
  END IF;

  -- Token must still be active.
  IF v_share_record.status = 'revoked' THEN
    RAISE EXCEPTION 'This share has been revoked';
  END IF;

  IF v_share_record.status <> 'active' THEN
    RAISE EXCEPTION 'This share token is not active';
  END IF;

  -- Token must still be unexpired.
  IF v_share_record.expires_at <= NOW() THEN
    RAISE EXCEPTION 'This share token has expired';
  END IF;
  
  -- Caller cannot invite themselves
  IF v_target_member_id = v_caller_member_id THEN
    RAISE EXCEPTION 'You cannot invite yourself';
  END IF;
  
  -- Target member must exist
  SELECT EXISTS(
    SELECT 1
    FROM public.members m
    WHERE m.id = v_target_member_id
  ) INTO v_target_member_exists;
  
  IF NOT v_target_member_exists THEN
    RAISE EXCEPTION 'Target member does not exist';
  END IF;
  
  -- Check for existing participant row (with lock)
  SELECT *
  INTO v_existing_participant
  FROM public.movement_participants mp
  WHERE mp.movement_need_id = p_movement_need_id
    AND mp.member_id = v_target_member_id
  FOR UPDATE;
  
  IF FOUND THEN
    -- Already confirmed: reject clearly
    IF v_existing_participant.status = 'confirmed' THEN
      RAISE EXCEPTION 'This member is already a confirmed participant';
    END IF;
    
    -- Already invited: idempotent return
    IF v_existing_participant.status = 'invited' THEN
      RETURN QUERY
      SELECT
        v_existing_participant.id,
        v_existing_participant.movement_need_id,
        v_existing_participant.status,
        v_existing_participant.invited_at;
      RETURN;
    END IF;
    
    -- Declined or removed: allow re-invitation, but check capacity first
    IF v_existing_participant.status IN ('declined', 'removed') THEN
      -- Check current active slots (before re-inviting this member)
      SELECT COUNT(*)
      INTO v_active_slot_count
      FROM public.movement_participants mp
      WHERE mp.movement_need_id = p_movement_need_id
        AND mp.status IN ('confirmed', 'invited');
      
      IF v_active_slot_count >= v_need_record.people_count THEN
        RAISE EXCEPTION 'Movement group already has all declared traveller slots filled';
      END IF;
      
      UPDATE public.movement_participants mp
      SET
        status = 'invited',
        invited_by_member_id = v_caller_member_id,
        invited_at = NOW(),
        responded_at = NULL,
        updated_at = NOW()
      WHERE mp.id = v_existing_participant.id;
      
      v_invited_at := NOW();
      v_new_participant_id := v_existing_participant.id;
    END IF;
  ELSE
    -- New invitation: check capacity first
    SELECT COUNT(*)
    INTO v_active_slot_count
    FROM public.movement_participants mp
    WHERE mp.movement_need_id = p_movement_need_id
      AND mp.status IN ('confirmed', 'invited');
    
    IF v_active_slot_count >= v_need_record.people_count THEN
      RAISE EXCEPTION 'Movement group already has all declared traveller slots filled';
    END IF;
    
    INSERT INTO public.movement_participants (
      movement_need_id,
      member_id,
      role,
      status,
      invited_by_member_id,
      invited_at,
      responded_at,
      created_at,
      updated_at
    )
    VALUES (
      p_movement_need_id,
      v_target_member_id,
      'invited_participant',
      'invited',
      v_caller_member_id,
      NOW(),
      NULL,
      NOW(),
      NOW()
    )
    RETURNING public.movement_participants.id, public.movement_participants.invited_at
    INTO v_new_participant_id, v_invited_at;
  END IF;
  
  RETURN QUERY
  SELECT
    v_new_participant_id,
    p_movement_need_id,
    'invited'::text,
    v_invited_at;
END;
$$;

REVOKE ALL ON FUNCTION public.invite_movement_participant_by_share_token(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.invite_movement_participant_by_share_token(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.invite_movement_participant_by_share_token(uuid, text) TO authenticated;

-- =========================================================
-- 3. Update: respond_to_movement_invitation (capacity check)
-- =========================================================
-- Enforce group capacity when accepting invitations.

CREATE OR REPLACE FUNCTION public.respond_to_movement_invitation(
  p_participant_id uuid,
  p_accept boolean
)
RETURNS TABLE (
  participant_id uuid,
  movement_need_id uuid,
  participant_status text,
  responded_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_member_id uuid;
  v_movement_need_id uuid;
  v_participant_record public.movement_participants%ROWTYPE;
  v_need_record public.movement_needs%ROWTYPE;
  v_new_status text;
  v_responded_at timestamptz;
  v_confirmed_count integer;
BEGIN
  v_caller_member_id := auth.uid();
  
  IF v_caller_member_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  
  IF p_accept IS NULL THEN
    RAISE EXCEPTION 'Invitation response is required';
  END IF;
  
  -- Step 1: Read participant WITHOUT lock to obtain movement_need_id
  SELECT *
  INTO v_participant_record
  FROM public.movement_participants mp
  WHERE mp.id = p_participant_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Participant row not found';
  END IF;
  
  v_movement_need_id := v_participant_record.movement_need_id;
  
  -- Step 2: Lock the movement need FIRST to prevent state transitions
  SELECT *
  INTO v_need_record
  FROM public.movement_needs mn
  WHERE mn.id = v_movement_need_id
  FOR UPDATE;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Movement need not found';
  END IF;
  
  -- Step 3: Verify movement need is still discoverable
  IF v_need_record.status <> 'discoverable' THEN
    RAISE EXCEPTION 'Movement need is no longer discoverable; invitation can no longer be changed';
  END IF;
  
  -- Step 4: Now load and lock the participant row with the locked need context
  SELECT *
  INTO v_participant_record
  FROM public.movement_participants mp
  WHERE mp.id = p_participant_id
    AND mp.movement_need_id = v_need_record.id
  FOR UPDATE;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Participant row not found or does not match movement need';
  END IF;
  
  -- Caller must be the participant
  IF v_participant_record.member_id <> v_caller_member_id THEN
    RAISE EXCEPTION 'Only the invited member may respond to their own invitation';
  END IF;
  
  -- Participant must have role 'invited_participant'
  IF v_participant_record.role <> 'invited_participant' THEN
    RAISE EXCEPTION 'Only invited participants may respond to invitations';
  END IF;
  
  -- Current status must be 'invited'
  IF v_participant_record.status = 'confirmed' THEN
    RAISE EXCEPTION 'This invitation has already been accepted';
  END IF;
  
  IF v_participant_record.status = 'declined' THEN
    RAISE EXCEPTION 'This invitation has already been declined';
  END IF;
  
  IF v_participant_record.status = 'removed' THEN
    RAISE EXCEPTION 'This invitation has been removed';
  END IF;
  
  IF v_participant_record.status <> 'invited' THEN
    RAISE EXCEPTION 'Participant is not in invited state';
  END IF;
  
  -- If accepting, check group capacity
  IF p_accept THEN
    -- Count currently confirmed participants (not including this one, which is still invited)
    SELECT COUNT(*)
    INTO v_confirmed_count
    FROM public.movement_participants mp
    WHERE mp.movement_need_id = v_need_record.id
      AND mp.status = 'confirmed';
    
    -- If confirmed count is already at people_count, reject
    IF v_confirmed_count >= v_need_record.people_count THEN
      RAISE EXCEPTION 'Movement group is already full';
    END IF;
    
    v_new_status := 'confirmed';
  ELSE
    v_new_status := 'declined';
  END IF;
  
  -- Update the participant row
  UPDATE public.movement_participants mp
  SET
    status = v_new_status,
    responded_at = NOW(),
    updated_at = NOW()
  WHERE mp.id = p_participant_id
  RETURNING mp.responded_at
  INTO v_responded_at;
  
  RETURN QUERY
  SELECT
    p_participant_id,
    v_movement_need_id,
    v_new_status,
    v_responded_at;
END;
$$;

REVOKE ALL ON FUNCTION public.respond_to_movement_invitation(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.respond_to_movement_invitation(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.respond_to_movement_invitation(uuid, boolean) TO authenticated;

-- =========================================================
-- 4. RPC: get_my_movement_group_readiness
-- =========================================================
-- Primary requester inspects their movement group readiness.
-- Returns participant counts and completion status.

CREATE OR REPLACE FUNCTION public.get_my_movement_group_readiness(
  p_movement_need_id uuid
)
RETURNS TABLE (
  movement_need_id uuid,
  people_count integer,
  confirmed_traveller_count integer,
  pending_invitation_count integer,
  remaining_traveller_slots integer,
  group_ready boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_member_id uuid;
  v_need_record public.movement_needs%ROWTYPE;
  v_confirmed_count integer;
  v_pending_count integer;
BEGIN
  v_caller_member_id := auth.uid();
  
  IF v_caller_member_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  
  -- Load the movement need
  SELECT *
  INTO v_need_record
  FROM public.movement_needs mn
  WHERE mn.id = p_movement_need_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Movement need not found';
  END IF;
  
  -- Caller must own the movement need
  IF v_need_record.member_id <> v_caller_member_id THEN
    RAISE EXCEPTION 'Only the movement need owner may view group readiness';
  END IF;
  
  -- Count confirmed participants
  SELECT COUNT(*)
  INTO v_confirmed_count
  FROM public.movement_participants mp
  WHERE mp.movement_need_id = p_movement_need_id
    AND mp.status = 'confirmed';
  
  -- Count pending (invited) participants
  SELECT COUNT(*)
  INTO v_pending_count
  FROM public.movement_participants mp
  WHERE mp.movement_need_id = p_movement_need_id
    AND mp.status = 'invited';
  
  RETURN QUERY
  SELECT
    p_movement_need_id,
    v_need_record.people_count,
    v_confirmed_count,
    v_pending_count,
    GREATEST(v_need_record.people_count - v_confirmed_count - v_pending_count, 0)::integer,
    (v_confirmed_count = v_need_record.people_count AND v_pending_count = 0)::boolean;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_movement_group_readiness(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_movement_group_readiness(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_movement_group_readiness(uuid) TO authenticated;

-- =========================================================
-- 5. RPC: discover_masked_movement_group
-- =========================================================
-- Prospective offering members view a masked group before activating.
-- Shows one row per confirmed participant with safe fields only.
-- No member UUIDs, names, or identifiable information.

CREATE OR REPLACE FUNCTION public.discover_masked_movement_group(
  p_movement_need_id uuid
)
RETURNS TABLE (
  traveller_number integer,
  traveller_role text,
  age integer,
  verified boolean,
  rating numeric,
  completed_movements integer,
  common_movement_area text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_member_id uuid;
  v_need_record public.movement_needs%ROWTYPE;
  v_row_count integer;
BEGIN
  v_caller_member_id := auth.uid();
  
  IF v_caller_member_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  
  -- Load the movement need
  SELECT *
  INTO v_need_record
  FROM public.movement_needs mn
  WHERE mn.id = p_movement_need_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Movement need not found';
  END IF;
  
  -- Movement need must be discoverable
  IF v_need_record.status <> 'discoverable' THEN
    RAISE EXCEPTION 'Movement need is not discoverable';
  END IF;
  
  -- Caller must NOT be the movement need owner
  IF v_need_record.member_id = v_caller_member_id THEN
    RAISE EXCEPTION 'You cannot view your own movement group';
  END IF;
  
  -- Return confirmed participants with masked data
  -- Primary requester first, then other confirmed participants by created_at
  RETURN QUERY
  WITH confirmed_travellers AS (
        SELECT
      mp.id,
      mp.member_id,
      mp.role,
      mp.created_at,
      ROW_NUMBER() OVER (
        ORDER BY
          CASE WHEN mp.role = 'primary_requester' THEN 0 ELSE 1 END,
          mp.created_at,
          mp.id
      ) AS traveller_number
    FROM public.movement_participants mp
    WHERE mp.movement_need_id = p_movement_need_id
      AND mp.status = 'confirmed'
  )
  SELECT
    ct.traveller_number::integer,
    ct.role::text,
    CASE
      WHEN m.date_of_birth IS NOT NULL THEN
        EXTRACT(YEAR FROM age(CURRENT_DATE, m.date_of_birth))::integer
      ELSE NULL
    END AS age,
    (m.identity_verified AND m.profile_media_verified)::boolean AS verified,
    m.rating,
    m.completed_movements,
    m.common_movement_area
  FROM confirmed_travellers ct
  INNER JOIN public.members m
    ON m.id = ct.member_id
  ORDER BY ct.traveller_number;
END;
$$;

REVOKE ALL ON FUNCTION public.discover_masked_movement_group(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.discover_masked_movement_group(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.discover_masked_movement_group(uuid) TO authenticated;

-- =========================================================
-- 6. Update: create_movement_offer (seats >= people_count)
-- =========================================================
-- Enforce that seats_offered is sufficient for the declared group size.

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

  -- NEW: Check seats_offered >= people_count
  IF p_seats_offered < v_need_record.people_count THEN
    RAISE EXCEPTION 'Seats offered are fewer than the travellers declared for this movement';
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
REVOKE ALL ON FUNCTION public.create_movement_offer(uuid, uuid, integer, text, text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_movement_offer(uuid, uuid, integer, text, text, integer) TO authenticated;

-- =========================================================
-- 7. Update: accept_movement_offer (group completeness check)
-- =========================================================
-- Enforce that all declared travellers are confirmed and no pending
-- invitations remain before accepting an offer.

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
  v_vehicle_record public.vehicles%ROWTYPE;
  v_alignment_id uuid;
  v_created_at timestamptz;
  v_confirmed_count integer;
  v_pending_count integer;
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

    -- Re-read the selected vehicle at acceptance time.
  -- The offer must still fit the vehicle's current seat capacity.
  SELECT *
  INTO v_vehicle_record
  FROM public.vehicles AS v
  WHERE v.id = v_offer_record.vehicle_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vehicle not found';
  END IF;

  IF v_offer_record.seats_offered > v_vehicle_record.seat_capacity THEN
    RAISE EXCEPTION 'This offer now exceeds the vehicle seat capacity';
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

  -- NEW: Check group completeness
  -- Count confirmed participants
  SELECT COUNT(*)
  INTO v_confirmed_count
  FROM public.movement_participants mp
  WHERE mp.movement_need_id = v_need_record.id
    AND mp.status = 'confirmed';

  -- Count pending (invited) participants
  SELECT COUNT(*)
  INTO v_pending_count
  FROM public.movement_participants mp
  WHERE mp.movement_need_id = v_need_record.id
    AND mp.status = 'invited';

  -- Confirmed count must equal people_count
  IF v_confirmed_count <> v_need_record.people_count THEN
    RAISE EXCEPTION 'All declared travellers must be confirmed before accepting an offer';
  END IF;

  -- No pending invitations allowed
  IF v_pending_count > 0 THEN
    RAISE EXCEPTION 'Pending traveller invitations must be resolved before accepting an offer';
  END IF;

  -- NEW: Check offer seats are sufficient
  IF v_offer_record.seats_offered < v_need_record.people_count THEN
    RAISE EXCEPTION 'This offer does not provide enough seats for the confirmed movement group';
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
  SELECT v_alignment_id, 'awaiting_activation_payment'::text, v_need_record.id, v_offer_record.id, v_created_at;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_movement_offer(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_movement_offer(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.accept_movement_offer(uuid) TO authenticated;

COMMIT;
