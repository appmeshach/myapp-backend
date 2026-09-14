BEGIN;

-- =========================================================
-- Fix: Explicitly schema-qualify gen_random_bytes
-- =========================================================
-- Migration 0010 had SET search_path = '' which breaks unqualified
-- extension function calls. The pgcrypto functions are in the
-- extensions schema, so they must be explicitly called as
-- extensions.gen_random_bytes() to work correctly.

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
  
  -- Generate a high-entropy opaque token using explicitly qualified extension function
  v_share_token := encode(extensions.gen_random_bytes(32), 'hex');
  
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

COMMIT;
