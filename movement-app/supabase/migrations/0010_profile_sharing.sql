BEGIN;

-- =========================================================
-- Profile sharing: safe member discovery without UUIDs
-- =========================================================
-- This migration enables intentional, time-limited profile sharing.
-- A member creates a share token that another person can use to:
-- 1. Preview a safe profile summary
-- 2. Invite that member into their movement need
--
-- Users never need to see or exchange internal member UUIDs.

-- =========================================================
-- 1. Create private.member_profile_shares table
-- =========================================================
-- The private schema already exists from 0007.
-- Add a new table for profile shares.

CREATE TABLE private.member_profile_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  share_token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'revoked', 'expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ NULL
);

ALTER TABLE private.member_profile_shares ENABLE ROW LEVEL SECURITY;

-- No direct access from PUBLIC, anon, or authenticated
REVOKE ALL ON TABLE private.member_profile_shares FROM PUBLIC;
REVOKE ALL ON TABLE private.member_profile_shares FROM anon;
REVOKE ALL ON TABLE private.member_profile_shares FROM authenticated;

GRANT ALL ON TABLE private.member_profile_shares TO service_role;

-- Indexes for lookups
CREATE INDEX idx_member_profile_shares_member_id
  ON private.member_profile_shares (member_id);

CREATE INDEX idx_member_profile_shares_share_token
  ON private.member_profile_shares (share_token);

CREATE INDEX idx_member_profile_shares_status
  ON private.member_profile_shares (status);

-- =========================================================
-- 2. RPC: create_my_profile_share
-- =========================================================
-- Create a new active share token for the authenticated caller.

CREATE OR REPLACE FUNCTION public.create_my_profile_share()
RETURNS TABLE (
  share_token text,
  expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_member_id uuid;
  v_share_token text;
  v_expires_at timestamptz;
BEGIN
  v_caller_member_id := auth.uid();
  
  IF v_caller_member_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  
  -- Verify caller exists in public.members
  IF NOT EXISTS (
    SELECT 1
    FROM public.members m
    WHERE m.id = v_caller_member_id
  ) THEN
    RAISE EXCEPTION 'Member profile not found';
  END IF;
  
  -- Generate a high-entropy opaque token
  v_share_token := encode(gen_random_bytes(32), 'hex');
  
  -- Set expiration to 24 hours from now
  v_expires_at := NOW() + INTERVAL '24 hours';
  
  -- Insert the share
  INSERT INTO private.member_profile_shares (
    member_id,
    share_token,
    status,
    expires_at,
    created_at
  )
  VALUES (
    v_caller_member_id,
    v_share_token,
    'active',
    v_expires_at,
    NOW()
  );
  
  RETURN QUERY
  SELECT v_share_token, v_expires_at;
END;
$$;

REVOKE ALL ON FUNCTION public.create_my_profile_share() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_my_profile_share() FROM anon;
GRANT EXECUTE ON FUNCTION public.create_my_profile_share() TO authenticated;

-- =========================================================
-- 3. RPC: revoke_my_profile_share
-- =========================================================
-- Revoke an active share token that belongs to the caller.

CREATE OR REPLACE FUNCTION public.revoke_my_profile_share(
  p_share_token text
)
RETURNS TABLE (
  revoked boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_member_id uuid;
  v_share_record private.member_profile_shares%ROWTYPE;
BEGIN
  v_caller_member_id := auth.uid();
  
  IF v_caller_member_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  
  -- Validate share token input
  IF p_share_token IS NULL OR trim(p_share_token) = '' THEN
    RAISE EXCEPTION 'Share token is required';
  END IF;
  
  -- Find the share token (lock for update to prevent concurrent revocations)
  SELECT *
  INTO v_share_record
  FROM private.member_profile_shares mps
  WHERE mps.share_token = p_share_token
  FOR UPDATE;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Share token not found';
  END IF;
  
  -- Token must belong to the caller
  IF v_share_record.member_id <> v_caller_member_id THEN
    RAISE EXCEPTION 'You may only revoke your own share tokens';
  END IF;
  
  -- Token must currently be active
  IF v_share_record.status <> 'active' THEN
    RAISE EXCEPTION 'Share token is not active';
  END IF;
  
  -- Mark as revoked
  UPDATE private.member_profile_shares mps
  SET
    status = 'revoked',
    revoked_at = NOW()
  WHERE mps.id = v_share_record.id;
  
  RETURN QUERY
  SELECT true::boolean;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_my_profile_share(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_my_profile_share(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.revoke_my_profile_share(text) TO authenticated;

-- =========================================================
-- 4. RPC: preview_shared_profile
-- =========================================================
-- Authenticated user can preview a shared member's safe profile.

CREATE OR REPLACE FUNCTION public.preview_shared_profile(
  p_share_token text
)
RETURNS TABLE (
  first_name text,
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
  v_share_record private.member_profile_shares%ROWTYPE;
  v_member_record public.members%ROWTYPE;
BEGIN
  v_caller_member_id := auth.uid();
  
  IF v_caller_member_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  
  -- Validate share token input
  IF p_share_token IS NULL OR trim(p_share_token) = '' THEN
    RAISE EXCEPTION 'Share token is required';
  END IF;
  
  -- Find the share token (share lock for concurrent-safe reads)
  SELECT *
  INTO v_share_record
  FROM private.member_profile_shares mps
  WHERE mps.share_token = p_share_token
  FOR SHARE;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Share token not found';
  END IF;
  
  -- Token must be active
  IF v_share_record.status = 'revoked' THEN
    RAISE EXCEPTION 'This share has been revoked';
  END IF;
  
  IF v_share_record.status <> 'active' THEN
    RAISE EXCEPTION 'This share token is not active';
  END IF;
  
  -- Check if expired (status may be 'active' but token can still expire)
  IF v_share_record.expires_at <= NOW() THEN
    RAISE EXCEPTION 'This share token has expired';
  END IF;
  
  -- Load the shared member's profile
  SELECT *
  INTO v_member_record
  FROM public.members m
  WHERE m.id = v_share_record.member_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member profile not found';
  END IF;
  
  -- Return safe preview (no member_id, email, phone, DOB, identity data, storage paths)
  RETURN QUERY
  SELECT
    v_member_record.first_name,
    EXTRACT(YEAR FROM AGE(v_member_record.date_of_birth))::integer AS age,
    (v_member_record.identity_verified AND v_member_record.profile_media_verified)::boolean AS verified,
    v_member_record.rating,
    v_member_record.completed_movements,
    v_member_record.common_movement_area;
END;
$$;

REVOKE ALL ON FUNCTION public.preview_shared_profile(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.preview_shared_profile(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.preview_shared_profile(text) TO authenticated;

-- =========================================================
-- 5. RPC: invite_movement_participant_by_share_token
-- =========================================================
-- Safely invite a member using their share token.
-- Resolves member_id internally from the token.
-- Applies the same invitation rules as the direct member-id version.

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
BEGIN
  v_caller_member_id := auth.uid();
  
  IF v_caller_member_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  
  -- Validate share token input
  IF p_share_token IS NULL OR trim(p_share_token) = '' THEN
    RAISE EXCEPTION 'Share token is required';
  END IF;
  
  -- Validate and resolve the share token (share lock for concurrent-safe reads)
  SELECT *
  INTO v_share_record
  FROM private.member_profile_shares mps
  WHERE mps.share_token = p_share_token
  FOR SHARE;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Share token not found';
  END IF;
  
  -- Token must be active
  IF v_share_record.status = 'revoked' THEN
    RAISE EXCEPTION 'This share has been revoked';
  END IF;
  
  IF v_share_record.status <> 'active' THEN
    RAISE EXCEPTION 'This share token is not active';
  END IF;
  
  -- Token must not be expired (status may be 'active' but token can still expire)
  IF v_share_record.expires_at <= NOW() THEN
    RAISE EXCEPTION 'This share token has expired';
  END IF;
  
  v_target_member_id := v_share_record.member_id;
  
  -- Fetch the movement need (locked)
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
  
  -- Movement need must be discoverable
  IF v_need_record.status <> 'discoverable' THEN
    RAISE EXCEPTION 'Movement need is not discoverable; cannot invite participants';
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
-- 6. RESTRICT: Revoke raw member-id invitation from authenticated clients
-- =========================================================
-- Ordinary mobile clients must use share tokens to invite members.
-- This ensures users never need to exchange internal UUIDs.
-- The function remains for trusted internal/service logic.

REVOKE EXECUTE ON FUNCTION public.invite_movement_participant(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.invite_movement_participant(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.invite_movement_participant(uuid, uuid) FROM authenticated;

COMMIT;
