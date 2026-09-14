BEGIN;

-- =========================================================
-- Mutual movement completion model
-- =========================================================
-- This migration implements a correct two-party agreement model for
-- movement completion. Either principal member (offering or primary requester)
-- may initiate an end request. The movement completes only after BOTH
-- principals agree, either explicitly or by the second one pressing End.
--
-- Invited participants cannot end the entire movement.
-- GPS/live location does not determine completion.
-- Movements may end at any time after activation, regardless of journey state.

-- =========================================================
-- 1. Add mutual end-agreement columns to public.journeys
-- =========================================================

ALTER TABLE public.journeys
  ADD COLUMN IF NOT EXISTS end_requested_by_member_id UUID NULL REFERENCES public.members(id),
  ADD COLUMN IF NOT EXISTS end_requested_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS end_confirmed_by_member_id UUID NULL REFERENCES public.members(id),
  ADD COLUMN IF NOT EXISTS end_confirmed_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS end_reason TEXT NULL,
  ADD COLUMN IF NOT EXISTS end_method TEXT NULL;

-- =========================================================
-- SECURITY: Prevent raw journey UUID leakage
-- =========================================================
-- Authenticated clients MUST NOT directly read the internal end_requested_by_member_id
-- or end_confirmed_by_member_id columns. All journey access must go through safe RPCs.

-- Drop the old RLS policy that allowed direct SELECT
DROP POLICY IF EXISTS journeys_select_participants ON public.journeys;

-- Revoke direct table access from all client roles
REVOKE SELECT ON TABLE public.journeys FROM PUBLIC;
REVOKE SELECT ON TABLE public.journeys FROM anon;
REVOKE SELECT ON TABLE public.journeys FROM authenticated;

-- =========================================================
-- 2. Create private.movement_settlements table
-- =========================================================
-- Settlement entitlements are created only after BOTH principals agree
-- to end the movement. The actual amount and settlement mechanism are not
-- finalized yet, so settlement rows are created in 'pending_amount' status.

CREATE TABLE IF NOT EXISTS private.movement_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alignment_id UUID NOT NULL UNIQUE REFERENCES public.alignments(id),
  journey_id UUID NOT NULL UNIQUE REFERENCES public.journeys(id),
  beneficiary_member_id UUID NOT NULL REFERENCES public.members(id),
  status TEXT NOT NULL DEFAULT 'pending_amount'
    CHECK (status IN ('pending_amount', 'pending_settlement', 'settled', 'failed')),
  amount_minor BIGINT NULL CHECK (amount_minor IS NULL OR amount_minor >= 0),
  currency TEXT NULL CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at TIMESTAMPTZ NULL
);

ALTER TABLE private.movement_settlements ENABLE ROW LEVEL SECURITY;

-- No direct client access
REVOKE ALL ON TABLE private.movement_settlements FROM PUBLIC;
REVOKE ALL ON TABLE private.movement_settlements FROM anon;
REVOKE ALL ON TABLE private.movement_settlements FROM authenticated;

GRANT ALL ON TABLE private.movement_settlements TO service_role;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_movement_settlements_alignment_id
  ON private.movement_settlements (alignment_id);

CREATE INDEX IF NOT EXISTS idx_movement_settlements_journey_id
  ON private.movement_settlements (journey_id);

CREATE INDEX IF NOT EXISTS idx_movement_settlements_beneficiary_member_id
  ON private.movement_settlements (beneficiary_member_id);

CREATE INDEX IF NOT EXISTS idx_movement_settlements_status
  ON private.movement_settlements (status);

-- =========================================================
-- 3. RPC: request_movement_end
-- =========================================================
-- Either principal member (offering or primary requester) may initiate an end request.
-- If the other principal independently requests end, that counts as mutual agreement.
-- Invited participants cannot use this RPC.

CREATE OR REPLACE FUNCTION public.request_movement_end(
  p_journey_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS TABLE (
  journey_id uuid,
  journey_status text,
  alignment_status text,
  end_status text,
  requested_by_me boolean,
  waiting_for_other_member boolean,
  completed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_member_id uuid;
  v_journey_record public.journeys%ROWTYPE;
  v_alignment_record public.alignments%ROWTYPE;
  v_offering_member_id uuid;
  v_requester_member_id uuid;
  v_end_status text;
  v_requested_by_me boolean;
  v_waiting_for_other_member boolean;
BEGIN
  v_caller_member_id := auth.uid();
  
  IF v_caller_member_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  
  -- Load and lock the journey
  SELECT *
  INTO v_journey_record
  FROM public.journeys j
  WHERE j.id = p_journey_id
  FOR UPDATE;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journey not found';
  END IF;
  
  -- Load and lock the alignment
  SELECT *
  INTO v_alignment_record
  FROM public.alignments a
  WHERE a.id = v_journey_record.alignment_id
  FOR UPDATE;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Alignment not found';
  END IF;
  
  v_offering_member_id := v_alignment_record.offering_member_id;
  v_requester_member_id := v_alignment_record.member_needing_movement_id;
  
  -- Caller must be one of the two principal members
  IF v_caller_member_id <> v_offering_member_id AND v_caller_member_id <> v_requester_member_id THEN
    RAISE EXCEPTION 'Only principal movement members may end the movement';
  END IF;
  
  -- Allow ending only in valid states
  -- A: activated + not_started
  -- B: in_progress + in_progress
  -- C: already completed (idempotent)
  
  IF v_alignment_record.status = 'completed' AND v_journey_record.status = 'completed' THEN
    -- Already completed, return idempotently
    RETURN QUERY
    SELECT
      p_journey_id,
      v_journey_record.status,
      v_alignment_record.status,
      'completed'::text,
      false::boolean,
      false::boolean,
      v_journey_record.completed_at;
    RETURN;
  END IF;
  
  -- Reject if not in a valid ending state
  IF NOT (
    (v_alignment_record.status = 'activated' AND v_journey_record.status = 'not_started')
    OR
    (v_alignment_record.status = 'in_progress' AND v_journey_record.status = 'in_progress')
  ) THEN
    RAISE EXCEPTION 'Movement is not in a state that allows mutual ending';
  END IF;
  
  -- Check if an end request already exists
  IF v_journey_record.end_requested_by_member_id IS NOT NULL THEN
    -- End request already pending
    IF v_journey_record.end_requested_by_member_id = v_caller_member_id THEN
      -- Same member requesting again: idempotent
      v_end_status := 'awaiting_other_member';
      v_requested_by_me := true;
      v_waiting_for_other_member := true;
    ELSE
      -- OTHER principal member is now also requesting end: mutual agreement!
      -- Complete the movement
      UPDATE public.journeys j
      SET
        end_confirmed_by_member_id = v_caller_member_id,
        end_confirmed_at = NOW(),
        status = 'completed',
        completed_at = COALESCE(j.completed_at, NOW()),
        end_method = 'mutual_user_end',
        updated_at = NOW()
      WHERE j.id = p_journey_id;
      
      UPDATE public.alignments a
      SET
        status = 'completed',
        updated_at = NOW()
      WHERE a.id = v_alignment_record.id;
      
      -- Create settlement entitlement
      INSERT INTO private.movement_settlements (
        alignment_id,
        journey_id,
        beneficiary_member_id,
        status,
        created_at
      )
      VALUES (
        v_alignment_record.id,
        p_journey_id,
        v_offering_member_id,
        'pending_amount',
        NOW()
      )
      ON CONFLICT (alignment_id) DO NOTHING;
      
      v_end_status := 'completed';
      v_requested_by_me := false;
      v_waiting_for_other_member := false;
      
      -- Reload both records for accurate return
      SELECT *
      INTO v_journey_record
      FROM public.journeys j
      WHERE j.id = p_journey_id;
      
      SELECT *
      INTO v_alignment_record
      FROM public.alignments a
      WHERE a.id = v_alignment_record.id;
    END IF;
  ELSE
    -- No end request exists yet: create one
    -- Defensive: also clear any stale confirmation fields
    UPDATE public.journeys j
    SET
      end_requested_by_member_id = v_caller_member_id,
      end_requested_at = NOW(),
      end_confirmed_by_member_id = NULL,
      end_confirmed_at = NULL,
      end_reason = NULLIF(trim(p_reason), ''),
      updated_at = NOW()
    WHERE j.id = p_journey_id;
    
    v_end_status := 'awaiting_other_member';
    v_requested_by_me := true;
    v_waiting_for_other_member := true;
  END IF;
  
  RETURN QUERY
  SELECT
    p_journey_id,
    v_journey_record.status,
    v_alignment_record.status,
    v_end_status,
    v_requested_by_me,
    v_waiting_for_other_member,
    v_journey_record.completed_at;
END;
$$;

REVOKE ALL ON FUNCTION public.request_movement_end(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.request_movement_end(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.request_movement_end(uuid, text) TO authenticated;

-- =========================================================
-- 4. RPC: confirm_movement_end
-- =========================================================
-- Explicit confirmation by the OTHER principal member of a pending end request.

CREATE OR REPLACE FUNCTION public.confirm_movement_end(
  p_journey_id uuid
)
RETURNS TABLE (
  journey_id uuid,
  journey_status text,
  alignment_status text,
  end_status text,
  completed_at timestamptz,
  settlement_required boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_member_id uuid;
  v_journey_record public.journeys%ROWTYPE;
  v_alignment_record public.alignments%ROWTYPE;
  v_offering_member_id uuid;
  v_requester_member_id uuid;
  v_settlement_exists boolean;
BEGIN
  v_caller_member_id := auth.uid();
  
  IF v_caller_member_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  
  -- Load and lock the journey
  SELECT *
  INTO v_journey_record
  FROM public.journeys j
  WHERE j.id = p_journey_id
  FOR UPDATE;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journey not found';
  END IF;
  
  -- Load and lock the alignment
  SELECT *
  INTO v_alignment_record
  FROM public.alignments a
  WHERE a.id = v_journey_record.alignment_id
  FOR UPDATE;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Alignment not found';
  END IF;
  
  v_offering_member_id := v_alignment_record.offering_member_id;
  v_requester_member_id := v_alignment_record.member_needing_movement_id;
  
  -- Caller must be one of the principal members
  IF v_caller_member_id <> v_offering_member_id AND v_caller_member_id <> v_requester_member_id THEN
    RAISE EXCEPTION 'Only principal movement members may confirm movement end';
  END IF;
  
  -- Idempotency: if both already completed, return safely
  IF v_journey_record.status = 'completed' AND v_alignment_record.status = 'completed' THEN
    -- Verify settlement exists
    SELECT EXISTS(
      SELECT 1
      FROM private.movement_settlements ms
      WHERE ms.journey_id = p_journey_id
    ) INTO v_settlement_exists;
    
    RETURN QUERY
    SELECT
      p_journey_id,
      v_journey_record.status,
      v_alignment_record.status,
      'completed'::text,
      v_journey_record.completed_at,
      v_settlement_exists;
    RETURN;
  END IF;
  
  -- Must have a pending end request
  IF v_journey_record.end_requested_by_member_id IS NULL THEN
    RAISE EXCEPTION 'No pending end request to confirm';
  END IF;
  
  -- Caller cannot confirm their own request
  IF v_journey_record.end_requested_by_member_id = v_caller_member_id THEN
    RAISE EXCEPTION 'You cannot confirm your own end request';
  END IF;
  
  -- Validate state: must be in a valid ending state
  IF NOT (
    (v_alignment_record.status = 'activated' AND v_journey_record.status = 'not_started')
    OR
    (v_alignment_record.status = 'in_progress' AND v_journey_record.status = 'in_progress')
  ) THEN
    RAISE EXCEPTION 'Movement is not in a state that allows mutual ending';
  END IF;
  
  -- Confirm the end request
  UPDATE public.journeys j
  SET
    end_confirmed_by_member_id = v_caller_member_id,
    end_confirmed_at = NOW(),
    status = 'completed',
    completed_at = COALESCE(j.completed_at, NOW()),
    end_method = 'mutual_user_end',
    updated_at = NOW()
  WHERE j.id = p_journey_id;
  
  UPDATE public.alignments a
  SET
    status = 'completed',
    updated_at = NOW()
  WHERE a.id = v_alignment_record.id;
  
  -- Create settlement entitlement
  INSERT INTO private.movement_settlements (
    alignment_id,
    journey_id,
    beneficiary_member_id,
    status,
    created_at
  )
  VALUES (
    v_alignment_record.id,
    p_journey_id,
    v_offering_member_id,
    'pending_amount',
    NOW()
  )
  ON CONFLICT (alignment_id) DO NOTHING;
  
  -- Check if settlement was created
  SELECT EXISTS(
    SELECT 1
    FROM private.movement_settlements ms
    WHERE ms.journey_id = p_journey_id
  ) INTO v_settlement_exists;
  
  -- Reload both records for return
  SELECT *
  INTO v_journey_record
  FROM public.journeys j
  WHERE j.id = p_journey_id;
  
  SELECT *
  INTO v_alignment_record
  FROM public.alignments a
  WHERE a.id = v_alignment_record.id;
  
  RETURN QUERY
  SELECT
    p_journey_id,
    v_journey_record.status,
    v_alignment_record.status,
    'completed'::text,
    v_journey_record.completed_at,
    v_settlement_exists;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_movement_end(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_movement_end(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.confirm_movement_end(uuid) TO authenticated;

-- =========================================================
-- 5. RPC: decline_movement_end
-- =========================================================
-- The OTHER principal member may decline a pending end request.

CREATE OR REPLACE FUNCTION public.decline_movement_end(
  p_journey_id uuid
)
RETURNS TABLE (
  journey_id uuid,
  journey_status text,
  alignment_status text,
  end_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_member_id uuid;
  v_journey_record public.journeys%ROWTYPE;
  v_alignment_record public.alignments%ROWTYPE;
  v_offering_member_id uuid;
  v_requester_member_id uuid;
BEGIN
  v_caller_member_id := auth.uid();
  
  IF v_caller_member_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  
  -- Load and lock the journey
  SELECT *
  INTO v_journey_record
  FROM public.journeys j
  WHERE j.id = p_journey_id
  FOR UPDATE;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journey not found';
  END IF;
  
  -- Load and lock the alignment
  SELECT *
  INTO v_alignment_record
  FROM public.alignments a
  WHERE a.id = v_journey_record.alignment_id
  FOR UPDATE;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Alignment not found';
  END IF;
  
  v_offering_member_id := v_alignment_record.offering_member_id;
  v_requester_member_id := v_alignment_record.member_needing_movement_id;
  
  -- Caller must be one of the principal members
  IF v_caller_member_id <> v_offering_member_id AND v_caller_member_id <> v_requester_member_id THEN
    RAISE EXCEPTION 'Only principal movement members may decline movement end';
  END IF;
  
  -- Must have a pending end request
  IF v_journey_record.end_requested_by_member_id IS NULL THEN
    RAISE EXCEPTION 'No pending end request to decline';
  END IF;
  
  -- Caller cannot decline their own request
  IF v_journey_record.end_requested_by_member_id = v_caller_member_id THEN
    RAISE EXCEPTION 'You cannot decline your own end request';
  END IF;
  
  -- Movement must not already be completed
  IF v_journey_record.status = 'completed' THEN
    RAISE EXCEPTION 'Movement is already completed';
  END IF;
  
  -- Clear the pending end request and any stale confirmation fields
  UPDATE public.journeys j
  SET
    end_requested_by_member_id = NULL,
    end_requested_at = NULL,
    end_confirmed_by_member_id = NULL,
    end_confirmed_at = NULL,
    end_reason = NULL,
    updated_at = NOW()
  WHERE j.id = p_journey_id;
  
  RETURN QUERY
  SELECT
    p_journey_id,
    v_journey_record.status,
    v_alignment_record.status,
    'no_pending_end_request'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.decline_movement_end(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.decline_movement_end(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.decline_movement_end(uuid) TO authenticated;

-- =========================================================
-- 6. RPC: get_my_movement_end_status
-- =========================================================
-- Safe query to inspect end request status without exposing UUIDs.

CREATE OR REPLACE FUNCTION public.get_my_movement_end_status(
  p_journey_id uuid
)
RETURNS TABLE (
  journey_id uuid,
  journey_status text,
  alignment_status text,
  end_status text,
  requested_by_me boolean,
  action_required_from_me boolean,
  requested_at timestamptz,
  completed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_member_id uuid;
  v_journey_record public.journeys%ROWTYPE;
  v_alignment_record public.alignments%ROWTYPE;
  v_end_status text;
  v_requested_by_me boolean;
  v_action_required_from_me boolean;
BEGIN
  v_caller_member_id := auth.uid();
  
  IF v_caller_member_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  
  -- Load the journey
  SELECT *
  INTO v_journey_record
  FROM public.journeys j
  WHERE j.id = p_journey_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journey not found';
  END IF;
  
  -- Load the alignment
  SELECT *
  INTO v_alignment_record
  FROM public.alignments a
  WHERE a.id = v_journey_record.alignment_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Alignment not found';
  END IF;
  
  -- Caller must be a principal member
  IF v_caller_member_id <> v_alignment_record.offering_member_id
    AND v_caller_member_id <> v_alignment_record.member_needing_movement_id THEN
    RAISE EXCEPTION 'You are not a principal member of this movement';
  END IF;
  
  -- Determine end status
  IF v_journey_record.status = 'completed' THEN
    v_end_status := 'completed';
    v_requested_by_me := false;
    v_action_required_from_me := false;
  ELSIF v_journey_record.end_requested_by_member_id IS NULL THEN
    v_end_status := 'no_pending_end_request';
    v_requested_by_me := false;
    v_action_required_from_me := false;
  ELSIF v_journey_record.end_requested_by_member_id = v_caller_member_id THEN
    v_end_status := 'awaiting_other_member';
    v_requested_by_me := true;
    v_action_required_from_me := false;
  ELSE
    v_end_status := 'action_required_from_me';
    v_requested_by_me := false;
    v_action_required_from_me := true;
  END IF;
  
  RETURN QUERY
  SELECT
    p_journey_id,
    v_journey_record.status,
    v_alignment_record.status,
    v_end_status,
    v_requested_by_me,
    v_action_required_from_me,
    v_journey_record.end_requested_at,
    v_journey_record.completed_at;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_movement_end_status(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_movement_end_status(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_movement_end_status(uuid) TO authenticated;

-- =========================================================
-- 7. RPC: get_my_movement_settlement_status
-- =========================================================
-- Safe query to inspect settlement status without exposing internal UUIDs.

CREATE OR REPLACE FUNCTION public.get_my_movement_settlement_status(
  p_journey_id uuid
)
RETURNS TABLE (
  journey_id uuid,
  movement_completed boolean,
  settlement_status text,
  settlement_is_for_me boolean,
  settled_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_member_id uuid;
  v_journey_record public.journeys%ROWTYPE;
  v_alignment_record public.alignments%ROWTYPE;
  v_settlement_record private.movement_settlements%ROWTYPE;
  v_movement_completed boolean;
  v_settlement_is_for_me boolean;
BEGIN
  v_caller_member_id := auth.uid();
  
  IF v_caller_member_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  
  -- Load the journey
  SELECT *
  INTO v_journey_record
  FROM public.journeys j
  WHERE j.id = p_journey_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journey not found';
  END IF;
  
  -- Load the alignment
  SELECT *
  INTO v_alignment_record
  FROM public.alignments a
  WHERE a.id = v_journey_record.alignment_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Alignment not found';
  END IF;
  
  -- Caller must be a principal member
  IF v_caller_member_id <> v_alignment_record.offering_member_id
    AND v_caller_member_id <> v_alignment_record.member_needing_movement_id THEN
    RAISE EXCEPTION 'You are not a principal member of this movement';
  END IF;
  
  -- Check completion status
  v_movement_completed := (v_journey_record.status = 'completed' AND v_alignment_record.status = 'completed');
  
  -- Load settlement if it exists
  SELECT *
  INTO v_settlement_record
  FROM private.movement_settlements ms
  WHERE ms.journey_id = p_journey_id;
  
  IF FOUND THEN
    v_settlement_is_for_me := (v_settlement_record.beneficiary_member_id = v_caller_member_id);
  ELSE
    v_settlement_is_for_me := false;
  END IF;
  
  RETURN QUERY
  SELECT
    p_journey_id,
    v_movement_completed,
    COALESCE(v_settlement_record.status, 'no_settlement'::text),
    v_settlement_is_for_me,
    v_settlement_record.settled_at;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_movement_settlement_status(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_movement_settlement_status(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_movement_settlement_status(uuid) TO authenticated;

-- =========================================================
-- 8. REVOKE: Old one-sided completion flow
-- =========================================================
-- The old functions from 0008 are superseded by the mutual model.
-- Revoke them from client access. Keep them for internal/legacy logic.

REVOKE EXECUTE ON FUNCTION public.request_journey_completion(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.request_journey_completion(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.request_journey_completion(uuid) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.confirm_journey_completion(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.confirm_journey_completion(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.confirm_journey_completion(uuid) FROM authenticated;

-- =========================================================
-- 9. PRESERVE: Journey start functions
-- =========================================================
-- The start flow remains unchanged.
-- request_journey_start and confirm_journey_start continue to work as before.

COMMIT;
