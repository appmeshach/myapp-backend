BEGIN;

-- Lifecycle only. No historical repair, money allocation or refund execution.
-- See docs/mutual-no-travel.md for the incomplete financial/refusal workflows.
CREATE TABLE private.mutual_no_travel_closures (
  journey_id uuid PRIMARY KEY REFERENCES public.journeys(id),
  first_principal_id uuid NOT NULL REFERENCES public.members(id),
  second_principal_id uuid NOT NULL REFERENCES public.members(id),
  first_consented_at timestamptz NOT NULL,
  closed_at timestamptz NOT NULL,
  invalidated_start_requested_at timestamptz,
  reason text NOT NULL DEFAULT 'mutual_no_travel_after_activation'
    CHECK (reason='mutual_no_travel_after_activation'),
  CHECK (first_principal_id<>second_principal_id),
  CHECK (closed_at>=first_consented_at)
);
ALTER TABLE private.mutual_no_travel_closures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.mutual_no_travel_closures FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON private.mutual_no_travel_closures TO service_role;

CREATE FUNCTION private.close_mutual_no_travel(p_journey_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE j public.journeys%ROWTYPE; a public.alignments%ROWTYPE;
  caller uuid := auth.uid(); closed_time timestamptz;
BEGIN
  SELECT * INTO STRICT j FROM public.journeys WHERE id=p_journey_id FOR UPDATE;
  SELECT * INTO STRICT a FROM public.alignments WHERE id=j.alignment_id FOR UPDATE;
  closed_time := clock_timestamp();
  IF caller IS NULL OR caller NOT IN (a.offering_member_id,a.member_needing_movement_id)
    OR j.end_requested_by_member_id IS NULL OR j.end_requested_at IS NULL
    OR j.end_requested_by_member_id NOT IN (a.offering_member_id,a.member_needing_movement_id)
    OR j.end_requested_by_member_id=caller THEN
    RAISE EXCEPTION 'Two principal consents required';
  END IF;
  IF a.status<>'activated' OR j.status<>'not_started' OR j.started_at IS NOT NULL
    OR j.completed_at IS NOT NULL OR a.activated_at IS NULL THEN
    RAISE EXCEPTION 'Movement is not eligible for no-travel closure';
  END IF;
  -- State/timestamps alone are not payment evidence (trusted historical imports
  -- can contain inconsistent rows). Match the existing 0014 activation evidence.
  -- Do not lock payment after alignment: payment success uses payment->alignment.
  IF NOT EXISTS (
    SELECT 1 FROM private.alignment_activation_payments p
    WHERE p.alignment_id=a.id AND p.status='succeeded' AND p.succeeded_at IS NOT NULL
      AND p.payer_member_id=a.offering_member_id
      AND p.amount_minor=a.activation_fee_minor AND p.currency=a.activation_currency
  ) THEN
    RAISE EXCEPTION 'Successful activation payment required';
  END IF;
  -- Never silently delete an inconsistent pre-existing entitlement.
  IF EXISTS (SELECT 1 FROM private.movement_settlements s WHERE s.journey_id=j.id OR s.alignment_id=a.id) THEN
    RAISE EXCEPTION 'Existing settlement requires reviewed resolution';
  END IF;
  UPDATE public.journeys SET status='cancelled',start_requested_at=NULL,
    end_confirmed_by_member_id=caller,end_confirmed_at=closed_time,
    end_method='mutual_no_travel_after_activation',updated_at=now() WHERE id=j.id;
  UPDATE public.alignments SET status='cancelled',updated_at=now() WHERE id=a.id;
  INSERT INTO private.mutual_no_travel_closures
    (journey_id,first_principal_id,second_principal_id,first_consented_at,closed_at,invalidated_start_requested_at)
    VALUES(j.id,j.end_requested_by_member_id,caller,j.end_requested_at,closed_time,j.start_requested_at);
END;
$$;
REVOKE ALL ON FUNCTION private.close_mutual_no_travel(uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Retained legacy server RPCs cannot reopen terminal evidence either.
CREATE FUNCTION private.protect_no_travel_journey()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM private.mutual_no_travel_closures c WHERE c.journey_id=OLD.id)
    AND (to_jsonb(NEW)-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'updated_at') THEN
    RAISE EXCEPTION 'Mutual no-travel closure is terminal';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.protect_no_travel_journey() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER protect_no_travel_journey BEFORE UPDATE ON public.journeys
FOR EACH ROW EXECUTE FUNCTION private.protect_no_travel_journey();

CREATE FUNCTION private.protect_no_travel_alignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND EXISTS (
    SELECT 1 FROM private.mutual_no_travel_closures c JOIN public.journeys j ON j.id=c.journey_id
    WHERE j.alignment_id=OLD.id
  ) THEN RAISE EXCEPTION 'Mutual no-travel closure is terminal'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.protect_no_travel_alignment() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER protect_no_travel_alignment BEFORE UPDATE OF status ON public.alignments
FOR EACH ROW EXECUTE FUNCTION private.protect_no_travel_alignment();

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

  -- Terminal retries cannot create another consent or settlement.
  IF v_journey_record.status='cancelled' AND v_alignment_record.status='cancelled'
    AND EXISTS (SELECT 1 FROM private.mutual_no_travel_closures c WHERE c.journey_id=p_journey_id) THEN
    RETURN QUERY SELECT p_journey_id, 'cancelled'::text, 'cancelled'::text, 'mutual_no_travel'::text, false::boolean, false::boolean, NULL::timestamptz;
    RETURN;
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
      -- Both rows are locked in journey-then-alignment order. A request is not a start.
      IF v_alignment_record.status='activated' AND v_journey_record.status='not_started' THEN
        PERFORM private.close_mutual_no_travel(p_journey_id);
        RETURN QUERY SELECT p_journey_id, 'cancelled'::text, 'cancelled'::text, 'mutual_no_travel'::text, false::boolean, false::boolean, NULL::timestamptz;
        RETURN;
      END IF;
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

  -- Terminal retries cannot create another consent or settlement.
  IF v_journey_record.status='cancelled' AND v_alignment_record.status='cancelled'
    AND EXISTS (SELECT 1 FROM private.mutual_no_travel_closures c WHERE c.journey_id=p_journey_id) THEN
    RETURN QUERY SELECT p_journey_id, 'cancelled'::text, 'cancelled'::text, 'mutual_no_travel'::text, NULL::timestamptz, false::boolean;
    RETURN;
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

  -- Both rows are locked in journey-then-alignment order. A request is not a start.
  IF v_alignment_record.status='activated' AND v_journey_record.status='not_started' THEN
    PERFORM private.close_mutual_no_travel(p_journey_id);
    RETURN QUERY SELECT p_journey_id, 'cancelled'::text, 'cancelled'::text, 'mutual_no_travel'::text, NULL::timestamptz, false::boolean;
    RETURN;
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

  -- Terminal consent must never be cleared.
  IF v_journey_record.status IN ('completed','cancelled','failed') THEN
    RAISE EXCEPTION 'Movement is already terminal';
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
  IF v_journey_record.status='cancelled' AND v_alignment_record.status='cancelled'
    AND EXISTS (SELECT 1 FROM private.mutual_no_travel_closures c WHERE c.journey_id=p_journey_id) THEN
    v_end_status := 'mutual_no_travel';
    v_requested_by_me := false;
    v_action_required_from_me := false;
  ELSIF v_journey_record.status = 'completed' THEN
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

COMMIT;
