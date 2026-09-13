BEGIN;

-- =========================================================
-- Journey lifecycle: secure state transitions
-- =========================================================
-- This migration implements the full journey lifecycle as a series of state 
-- transitions controlled by authenticated server-side RPCs. The flow is:
--
--   activation → journey created (not_started)
--   → offering member requests start
--   → primary requester confirms start (in_progress)
--   → offering member requests completion
--   → primary requester confirms completion (completed)
--
-- Financial credit will be handled in a later migration.

-- =========================================================
-- 1. Add journey lifecycle timestamp columns
-- =========================================================
-- Inspect existing public.journeys columns from 0001:
-- - id, alignment_id, vehicle_id, status, started_at, completed_at, created_at, updated_at
-- Add the missing request timestamp columns for state transitions.

ALTER TABLE public.journeys
  ADD COLUMN IF NOT EXISTS start_requested_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS completion_requested_at TIMESTAMPTZ NULL;

-- =========================================================
-- 2. Trigger: auto-create journey on alignment activation
-- =========================================================
-- When an alignment transitions to 'activated', insert exactly one journey
-- if one does not already exist. Use the vehicle from the accepted offer.

CREATE OR REPLACE FUNCTION public.create_journey_on_alignment_activation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_journey_exists BOOLEAN;
  v_vehicle_id UUID;
  v_offer_record public.movement_offers%ROWTYPE;
BEGIN
  -- Only react when transitioning INTO 'activated'
  IF NEW.status = 'activated' AND (OLD.status IS NULL OR OLD.status <> 'activated') THEN
    
    -- Check if journey already exists for this alignment
    SELECT EXISTS(
      SELECT 1
      FROM public.journeys j
      WHERE j.alignment_id = NEW.id
    ) INTO v_journey_exists;
    
    IF NOT v_journey_exists THEN
      -- Load the accepted movement offer to get the vehicle
      SELECT *
      INTO v_offer_record
      FROM public.movement_offers mo
      WHERE mo.id = NEW.movement_offer_id
      FOR SHARE;
      
      IF FOUND THEN
        v_vehicle_id := v_offer_record.vehicle_id;
      ELSE
        -- This should not happen if alignment is well-formed, but protect against it
        RAISE EXCEPTION 'Movement offer not found for alignment';
      END IF;
      
      -- Insert journey with status 'not_started'
      INSERT INTO public.journeys (
        alignment_id,
        vehicle_id,
        status,
        created_at,
        updated_at
      )
      VALUES (
        NEW.id,
        v_vehicle_id,
        'not_started',
        NOW(),
        NOW()
      );
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Drop existing trigger if it exists from prior work
DROP TRIGGER IF EXISTS trg_create_journey_on_alignment_activation
  ON public.alignments;

-- Create the trigger
CREATE TRIGGER trg_create_journey_on_alignment_activation
  AFTER UPDATE ON public.alignments
  FOR EACH ROW
  EXECUTE FUNCTION public.create_journey_on_alignment_activation();

-- =========================================================
-- 3. Backfill: create journeys for already-activated alignments
-- =========================================================
-- Safely insert journeys for alignments that are already 'activated'
-- but do not yet have a journey. Use ON CONFLICT to avoid duplicates.

INSERT INTO public.journeys (alignment_id, vehicle_id, status, created_at, updated_at)
SELECT
  a.id AS alignment_id,
  mo.vehicle_id,
  'not_started' AS status,
  NOW() AS created_at,
  NOW() AS updated_at
FROM public.alignments a
  INNER JOIN public.movement_offers mo
    ON mo.id = a.movement_offer_id
WHERE a.status = 'activated'
  AND NOT EXISTS (
    SELECT 1
    FROM public.journeys j
    WHERE j.alignment_id = a.id
  )
ON CONFLICT (alignment_id) DO NOTHING;

-- =========================================================
-- 4. RPC: request_journey_start
-- =========================================================
-- The offering member initiates the start request.
-- If already requested while journey is still not_started, idempotent.
-- Does NOT transition the journey to in_progress; only the primary requester can do that.

CREATE OR REPLACE FUNCTION public.request_journey_start(
  p_journey_id uuid
)
RETURNS TABLE (
  journey_id uuid,
  journey_status text,
  start_requested_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_member_id uuid;
  v_journey_record public.journeys%ROWTYPE;
  v_alignment_record public.alignments%ROWTYPE;
  v_returned_timestamp timestamptz;
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
  
  -- Caller must be the offering member
  IF v_alignment_record.offering_member_id <> v_caller_member_id THEN
    RAISE EXCEPTION 'Only the offering member may request journey start';
  END IF;
  
  -- Alignment must be activated
  IF v_alignment_record.status <> 'activated' THEN
    RAISE EXCEPTION 'Alignment is not activated';
  END IF;
  
  -- Journey must be not_started
  IF v_journey_record.status <> 'not_started' THEN
    RAISE EXCEPTION 'Journey is not in not_started state';
  END IF;
  
  -- Journey must not be completed, cancelled, or failed
  IF v_journey_record.status IN ('completed', 'cancelled', 'failed') THEN
    RAISE EXCEPTION 'Journey is in a terminal state';
  END IF;
  
  -- Idempotency: if start_requested_at already exists and journey is still not_started, return existing
  IF v_journey_record.start_requested_at IS NOT NULL THEN
    v_returned_timestamp := v_journey_record.start_requested_at;
  ELSE
    -- Set start_requested_at to now
    UPDATE public.journeys j
    SET start_requested_at = NOW(), updated_at = NOW()
    WHERE j.id = p_journey_id
    RETURNING j.start_requested_at
    INTO v_returned_timestamp;
  END IF;
  
  RETURN QUERY
  SELECT
    p_journey_id AS journey_id,
    'not_started'::text AS journey_status,
    v_returned_timestamp AS start_requested_at;
END;
$$;

REVOKE ALL ON FUNCTION public.request_journey_start(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.request_journey_start(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.request_journey_start(uuid) TO authenticated;

-- =========================================================
-- 5. RPC: confirm_journey_start
-- =========================================================
-- The primary requester (member_needing_movement_id) confirms the start.
-- Atomically transitions both journey and alignment to in_progress.
-- Idempotent if both are already in_progress.

CREATE OR REPLACE FUNCTION public.confirm_journey_start(
  p_journey_id uuid
)
RETURNS TABLE (
  journey_id uuid,
  journey_status text,
  started_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_member_id uuid;
  v_journey_record public.journeys%ROWTYPE;
  v_alignment_record public.alignments%ROWTYPE;
  v_returned_started_at timestamptz;
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
  
  -- Caller must be the primary requester (member_needing_movement_id)
  IF v_alignment_record.member_needing_movement_id <> v_caller_member_id THEN
    RAISE EXCEPTION 'Only the primary requester may confirm journey start';
  END IF;
  
  -- Idempotency check: if both already in_progress, return existing started_at
  IF v_journey_record.status = 'in_progress' AND v_alignment_record.status = 'in_progress' THEN
    v_returned_started_at := v_journey_record.started_at;
    RETURN QUERY
    SELECT
      p_journey_id AS journey_id,
      'in_progress'::text AS journey_status,
      v_returned_started_at AS started_at;
    RETURN;
  END IF;
  
  -- Validate journey state
  IF v_journey_record.status <> 'not_started' THEN
    RAISE EXCEPTION 'Journey is not in not_started state';
  END IF;
  
  -- Validate start was requested
  IF v_journey_record.start_requested_at IS NULL THEN
    RAISE EXCEPTION 'Journey start has not been requested';
  END IF;
  
  -- Validate alignment state
  IF v_alignment_record.status <> 'activated' THEN
    RAISE EXCEPTION 'Alignment is not activated';
  END IF;
  
  -- Atomically update both journey and alignment
  UPDATE public.journeys j
  SET
    status = 'in_progress',
    started_at = NOW(),
    updated_at = NOW()
  WHERE j.id = p_journey_id
  RETURNING j.started_at
  INTO v_returned_started_at;
  
  UPDATE public.alignments a
  SET
    status = 'in_progress',
    updated_at = NOW()
  WHERE a.id = v_alignment_record.id;
  
  RETURN QUERY
  SELECT
    p_journey_id AS journey_id,
    'in_progress'::text AS journey_status,
    v_returned_started_at AS started_at;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_journey_start(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_journey_start(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.confirm_journey_start(uuid) TO authenticated;

-- =========================================================
-- 6. RPC: request_journey_completion
-- =========================================================
-- The offering member requests completion.
-- Journey must be in_progress, started_at must be set.
-- If already requested while still in_progress, idempotent.
-- Does NOT mark the journey completed; only the primary requester can do that.

CREATE OR REPLACE FUNCTION public.request_journey_completion(
  p_journey_id uuid
)
RETURNS TABLE (
  journey_id uuid,
  journey_status text,
  completion_requested_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_member_id uuid;
  v_journey_record public.journeys%ROWTYPE;
  v_alignment_record public.alignments%ROWTYPE;
  v_returned_timestamp timestamptz;
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
  
  -- Caller must be the offering member
  IF v_alignment_record.offering_member_id <> v_caller_member_id THEN
    RAISE EXCEPTION 'Only the offering member may request journey completion';
  END IF;
  
  -- Journey must be in_progress
  IF v_journey_record.status <> 'in_progress' THEN
    RAISE EXCEPTION 'Journey is not in_progress';
  END IF;
  
  -- Alignment must be in_progress
  IF v_alignment_record.status <> 'in_progress' THEN
    RAISE EXCEPTION 'Alignment is not in_progress';
  END IF;
  
  -- started_at must not be null
  IF v_journey_record.started_at IS NULL THEN
    RAISE EXCEPTION 'Journey has not been started';
  END IF;
  
  -- Idempotency: if completion_requested_at already exists while still in_progress, return existing
  IF v_journey_record.completion_requested_at IS NOT NULL THEN
    v_returned_timestamp := v_journey_record.completion_requested_at;
  ELSE
    -- Set completion_requested_at to now
    UPDATE public.journeys j
    SET completion_requested_at = NOW(), updated_at = NOW()
    WHERE j.id = p_journey_id
    RETURNING j.completion_requested_at
    INTO v_returned_timestamp;
  END IF;
  
  RETURN QUERY
  SELECT
    p_journey_id AS journey_id,
    'in_progress'::text AS journey_status,
    v_returned_timestamp AS completion_requested_at;
END;
$$;

REVOKE ALL ON FUNCTION public.request_journey_completion(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.request_journey_completion(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.request_journey_completion(uuid) TO authenticated;

-- =========================================================
-- 7. RPC: confirm_journey_completion
-- =========================================================
-- The primary requester (member_needing_movement_id) confirms completion.
-- Atomically transitions both journey and alignment to completed.
-- This is the authoritative event: "movement successfully ended"
-- Idempotent if both are already completed.

CREATE OR REPLACE FUNCTION public.confirm_journey_completion(
  p_journey_id uuid
)
RETURNS TABLE (
  journey_id uuid,
  journey_status text,
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
  v_returned_completed_at timestamptz;
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
  
  -- Caller must be the primary requester (member_needing_movement_id)
  IF v_alignment_record.member_needing_movement_id <> v_caller_member_id THEN
    RAISE EXCEPTION 'Only the primary requester may confirm journey completion';
  END IF;
  
  -- Idempotency check: if both already completed, return existing completed_at
  IF v_journey_record.status = 'completed' AND v_alignment_record.status = 'completed' THEN
    v_returned_completed_at := v_journey_record.completed_at;
    RETURN QUERY
    SELECT
      p_journey_id AS journey_id,
      'completed'::text AS journey_status,
      v_returned_completed_at AS completed_at;
    RETURN;
  END IF;
  
  -- Validate journey state
  IF v_journey_record.status <> 'in_progress' THEN
    RAISE EXCEPTION 'Journey is not in_progress';
  END IF;
  
  -- Validate alignment state
  IF v_alignment_record.status <> 'in_progress' THEN
    RAISE EXCEPTION 'Alignment is not in_progress';
  END IF;
  
  -- Validate journey has been started
  IF v_journey_record.started_at IS NULL THEN
    RAISE EXCEPTION 'Journey has not been started';
  END IF;
  
  -- Validate completion was requested
  IF v_journey_record.completion_requested_at IS NULL THEN
    RAISE EXCEPTION 'Journey completion has not been requested';
  END IF;
  
  -- Atomically update both journey and alignment
  UPDATE public.journeys j
  SET
    status = 'completed',
    completed_at = NOW(),
    updated_at = NOW()
  WHERE j.id = p_journey_id
  RETURNING j.completed_at
  INTO v_returned_completed_at;
  
  UPDATE public.alignments a
  SET
    status = 'completed',
    updated_at = NOW()
  WHERE a.id = v_alignment_record.id;
  
  RETURN QUERY
  SELECT
    p_journey_id AS journey_id,
    'completed'::text AS journey_status,
    v_returned_completed_at AS completed_at;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_journey_completion(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_journey_completion(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.confirm_journey_completion(uuid) TO authenticated;

-- =========================================================
-- 8. RPC: get_my_journey_status
-- =========================================================
-- Safe query to inspect journey lifecycle state.
-- Caller must be either participant in the alignment.
-- Returns only timestamps and journey status; no participant UUIDs.

CREATE OR REPLACE FUNCTION public.get_my_journey_status(
  p_journey_id uuid
)
RETURNS TABLE (
  journey_id uuid,
  journey_status text,
  start_requested_at timestamptz,
  started_at timestamptz,
  completion_requested_at timestamptz,
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
  
  -- Caller must be one of the two participants
  IF v_alignment_record.member_needing_movement_id <> v_caller_member_id
    AND v_alignment_record.offering_member_id <> v_caller_member_id THEN
    RAISE EXCEPTION 'You are not a participant in this journey';
  END IF;
  
  RETURN QUERY
  SELECT
    v_journey_record.id AS journey_id,
    v_journey_record.status AS journey_status,
    v_journey_record.start_requested_at,
    v_journey_record.started_at,
    v_journey_record.completion_requested_at,
    v_journey_record.completed_at;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_journey_status(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_journey_status(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_journey_status(uuid) TO authenticated;

-- =========================================================
-- 9. Permissions: Revoke direct writes to public.journeys
-- =========================================================
-- Ordinary authenticated clients should only modify journey state through the RPCs,
-- not by direct INSERT/UPDATE/DELETE.

REVOKE INSERT ON TABLE public.journeys FROM authenticated;
REVOKE UPDATE ON TABLE public.journeys FROM authenticated;
REVOKE DELETE ON TABLE public.journeys FROM authenticated;

-- The trigger and service_role can still insert/update as needed.
-- RLS continues to govern SELECT access via the existing policy.

COMMIT;
