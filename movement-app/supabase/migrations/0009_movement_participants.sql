BEGIN;

-- =========================================================
-- Movement participants: multi-person journey support
-- =========================================================
-- This migration enables a primary requester to invite additional members
-- to participate in their movement need. Each participant must explicitly
-- accept the invitation before joining.
--
-- Rules:
-- - One movement has one PRIMARY REQUESTER (the creator)
-- - Additional invited participants must be authenticated members
-- - Each invitee must explicitly accept/decline before becoming confirmed
-- - The primary requester remains the official person for offer acceptance,
--   journey start/completion confirmations
-- - Post-activation identity reveal and group payment come later

-- =========================================================
-- 1. Create public.movement_participants table
-- =========================================================
CREATE TABLE public.movement_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_need_id UUID NOT NULL REFERENCES public.movement_needs(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  role TEXT NOT NULL
    CHECK (role IN ('primary_requester', 'invited_participant')),
  status TEXT NOT NULL
    CHECK (status IN ('confirmed', 'invited', 'declined', 'removed')),
  invited_by_member_id UUID NULL REFERENCES public.members(id),
  invited_at TIMESTAMPTZ NULL,
  responded_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE (movement_need_id, member_id),
  
  -- Defensive constraint: primary requester must always be confirmed
  CHECK (
    (role = 'primary_requester' AND status = 'confirmed')
    OR role = 'invited_participant'
  )
);

ALTER TABLE public.movement_participants ENABLE ROW LEVEL SECURITY;

-- Do NOT expose internal UUIDs (member_id, invited_by_member_id) via direct SELECT.
-- All participant reads must go through safe SECURITY DEFINER RPCs.
REVOKE ALL ON TABLE public.movement_participants FROM PUBLIC;
REVOKE ALL ON TABLE public.movement_participants FROM anon;
REVOKE ALL ON TABLE public.movement_participants FROM authenticated;

-- Indexes
CREATE INDEX idx_movement_participants_movement_need_id
  ON public.movement_participants (movement_need_id);

CREATE INDEX idx_movement_participants_member_id
  ON public.movement_participants (member_id);

CREATE INDEX idx_movement_participants_status
  ON public.movement_participants (status);

-- Enforce only one primary requester per movement need
CREATE UNIQUE INDEX ux_movement_participants_one_primary_requester
  ON public.movement_participants (movement_need_id)
  WHERE role = 'primary_requester';

-- =========================================================
-- IMPORTANT: people_count vs actual participants
-- =========================================================
-- movement_needs.people_count is intentionally NOT automatically derived
-- from confirmed participants in this migration. We have not yet decided whether:
--   - people_count should reflect only confirmed participants, or
--   - it may include planned/estimated seats before invites are accepted
-- This table will support either interpretation. For now, people_count
-- remains a human-provided estimate/declaration on the movement_need row.

-- =========================================================
-- 2. Backfill primary requesters from existing movement needs
-- =========================================================
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
SELECT
  mn.id,
  mn.member_id,
  'primary_requester'::text,
  'confirmed'::text,
  NULL::UUID,
  NULL::TIMESTAMPTZ,
  mn.created_at,
  mn.created_at,
  mn.created_at
FROM public.movement_needs mn
WHERE NOT EXISTS (
  SELECT 1
  FROM public.movement_participants mp
  WHERE mp.movement_need_id = mn.id
    AND mp.member_id = mn.member_id
    AND mp.role = 'primary_requester'
)
ON CONFLICT (movement_need_id, member_id) DO NOTHING;

-- =========================================================
-- 3. Trigger: auto-create primary requester for new movement needs
-- =========================================================
CREATE OR REPLACE FUNCTION public.create_primary_requester_on_movement_need()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
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
    NEW.id,
    NEW.member_id,
    'primary_requester',
    'confirmed',
    NULL,
    NULL,
    NEW.created_at,
    NOW(),
    NOW()
  )
  ON CONFLICT (movement_need_id, member_id) DO NOTHING;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_create_primary_requester_on_movement_need
  ON public.movement_needs;

CREATE TRIGGER trg_create_primary_requester_on_movement_need
  AFTER INSERT ON public.movement_needs
  FOR EACH ROW
  EXECUTE FUNCTION public.create_primary_requester_on_movement_need();

-- Protect the trigger function as internal infrastructure
REVOKE ALL ON FUNCTION public.create_primary_requester_on_movement_need() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_primary_requester_on_movement_need() FROM anon;
REVOKE ALL ON FUNCTION public.create_primary_requester_on_movement_need() FROM authenticated;

-- =========================================================
-- 4. RPC: invite_movement_participant
-- =========================================================
-- Primary requester invites another member to join their movement.
-- Invitee must exist as a member (authenticated).
-- Invitation is idempotent if already invited.

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
BEGIN
  v_caller_member_id := auth.uid();
  
  IF v_caller_member_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  
  -- Fetch the movement need
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
  
  -- Movement need must still be in a state where participants may be changed
  IF v_need_record.status <> 'discoverable' THEN
    RAISE EXCEPTION 'Movement need is not discoverable; cannot invite participants';
  END IF;
  
  -- Caller cannot invite themselves
  IF p_member_id = v_caller_member_id THEN
    RAISE EXCEPTION 'You cannot invite yourself';
  END IF;
  
  -- Target member must exist in public.members
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
    
    -- Declined or removed: allow re-invitation
    IF v_existing_participant.status IN ('declined', 'removed') THEN
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
    -- New invitation
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
GRANT EXECUTE ON FUNCTION public.invite_movement_participant(uuid, uuid) TO authenticated;

-- =========================================================
-- 5. RPC: respond_to_movement_invitation
-- =========================================================
-- Invited participant accepts or declines their invitation.
-- Only the invited member may respond.

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
  
  -- Set status based on acceptance
  IF p_accept THEN
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
-- 6. RPC: remove_movement_participant
-- =========================================================
-- Only the primary requester may remove invited or confirmed participants.
-- Cannot remove the primary requester row itself.
-- Movement need must still be discoverable.

CREATE OR REPLACE FUNCTION public.remove_movement_participant(
  p_participant_id uuid
)
RETURNS TABLE (
  participant_id uuid,
  movement_need_id uuid,
  participant_status text
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
BEGIN
  v_caller_member_id := auth.uid();
  
  IF v_caller_member_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
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
  
  -- Step 2: Lock the movement need FIRST
  SELECT *
  INTO v_need_record
  FROM public.movement_needs mn
  WHERE mn.id = v_movement_need_id
  FOR UPDATE;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Movement need not found';
  END IF;
  
  -- Step 3: Verify caller owns the movement need and it is discoverable
  IF v_need_record.member_id <> v_caller_member_id THEN
    RAISE EXCEPTION 'Only the movement need owner may remove participants';
  END IF;
  
  IF v_need_record.status <> 'discoverable' THEN
    RAISE EXCEPTION 'Movement need is not discoverable; cannot remove participants';
  END IF;
  
  -- Step 4: Now lock the participant row with the locked need context
  SELECT *
  INTO v_participant_record
  FROM public.movement_participants mp
  WHERE mp.id = p_participant_id
    AND mp.movement_need_id = v_need_record.id
  FOR UPDATE;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Participant row not found or does not match movement need';
  END IF;
  
  -- Cannot remove the primary requester row itself
  IF v_participant_record.role = 'primary_requester' THEN
    RAISE EXCEPTION 'Cannot remove the primary requester';
  END IF;
  
  -- Only remove if invited or confirmed invited participant
  IF v_participant_record.status NOT IN ('invited', 'confirmed') THEN
    RAISE EXCEPTION 'Participant is in a terminal state and cannot be removed';
  END IF;
  
  -- Mark as removed (do not physically delete to preserve history)
  UPDATE public.movement_participants mp
  SET
    status = 'removed',
    updated_at = NOW()
  WHERE mp.id = p_participant_id;
  
  RETURN QUERY
  SELECT
    p_participant_id,
    v_movement_need_id,
    'removed'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.remove_movement_participant(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remove_movement_participant(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.remove_movement_participant(uuid) TO authenticated;

-- =========================================================
-- 7. RPC: get_my_movement_participants
-- =========================================================
-- Primary requester views their invited group.
-- Derives age from date_of_birth (not returned raw).
-- Returns unified verified badge.

CREATE OR REPLACE FUNCTION public.get_my_movement_participants(
  p_movement_need_id uuid
)
RETURNS TABLE (
  participant_id uuid,
  participant_role text,
  participant_status text,
  first_name text,
  age integer,
  verified boolean,
  rating numeric,
  completed_movements integer,
  responded_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_member_id uuid;
  v_need_record public.movement_needs%ROWTYPE;
BEGIN
  v_caller_member_id := auth.uid();
  
  IF v_caller_member_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  
  -- Fetch the movement need
  SELECT *
  INTO v_need_record
  FROM public.movement_needs mn
  WHERE mn.id = p_movement_need_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Movement need not found';
  END IF;
  
  -- Caller must own the movement need
  IF v_need_record.member_id <> v_caller_member_id THEN
    RAISE EXCEPTION 'You may only view participants of your own movement need';
  END IF;
  
  -- Return participant list with member details
  RETURN QUERY
  SELECT
    mp.id AS participant_id,
    mp.role AS participant_role,
    mp.status AS participant_status,
    m.first_name,
    EXTRACT(YEAR FROM AGE(m.date_of_birth))::integer AS age,
    (m.identity_verified AND m.profile_media_verified)::boolean AS verified,
    m.rating,
    m.completed_movements,
    mp.responded_at
  FROM public.movement_participants mp
    INNER JOIN public.members m
      ON m.id = mp.member_id
  WHERE mp.movement_need_id = p_movement_need_id
  ORDER BY
    CASE
      WHEN mp.role = 'primary_requester' THEN 0
      ELSE 1
    END ASC,
    mp.created_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_movement_participants(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_movement_participants(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_movement_participants(uuid) TO authenticated;

-- =========================================================
-- 8. RPC: get_my_movement_invitations
-- =========================================================
-- Invited participant views their pending invitations.
-- Returns movement need details and invitation info.
-- Does NOT return the primary requester's UUID.

CREATE OR REPLACE FUNCTION public.get_my_movement_invitations()
RETURNS TABLE (
  participant_id uuid,
  movement_need_id uuid,
  origin_area text,
  destination_area text,
  earliest_departure_at timestamptz,
  latest_departure_at timestamptz,
  people_count integer,
  invited_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_member_id uuid;
BEGIN
  v_caller_member_id := auth.uid();
  
  IF v_caller_member_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  
  -- Return pending invitations for this caller (only from discoverable movement needs)
  RETURN QUERY
  SELECT
    mp.id AS participant_id,
    mn.id AS movement_need_id,
    mn.origin_area,
    mn.destination_area,
    mn.earliest_departure_at,
    mn.latest_departure_at,
    mn.people_count,
    mp.invited_at
  FROM public.movement_participants mp
    INNER JOIN public.movement_needs mn
      ON mn.id = mp.movement_need_id
  WHERE mp.member_id = v_caller_member_id
    AND mp.role = 'invited_participant'
    AND mp.status = 'invited'
    AND mn.status = 'discoverable'
  ORDER BY mp.invited_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_movement_invitations() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_movement_invitations() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_movement_invitations() TO authenticated;

COMMIT;
