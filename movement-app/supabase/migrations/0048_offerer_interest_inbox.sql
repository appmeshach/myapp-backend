BEGIN;

-- WE DO NOT CREATE JOURNEYS. This inbox reads explicit interest only.
-- No operational state, notifications, capacity reservations or ranking.
CREATE FUNCTION public.list_requester_movement_interests_for_offerer(
  p_availability_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 20
)
RETURNS TABLE (
  interest_id uuid,
  movement_need_id uuid,
  availability_id uuid,
  origin_area text,
  destination_area text,
  people_count integer,
  earliest_departure_at timestamptz,
  latest_departure_at timestamptz,
  requester_origin_distance_to_route_meters bigint,
  interest_created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $inbox$
DECLARE
  v_member_id uuid := auth.uid();
  v_candidate record;
  v_visible boolean;
  v_returned integer := 0;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION USING
      ERRCODE = '25000', MESSAGE = 'Interest inbox requires READ COMMITTED';
  END IF;
  IF v_member_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.members m WHERE m.id = v_member_id
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501', MESSAGE = 'Authenticated member required';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514', MESSAGE = 'Inbox limit must be between 1 and 50';
  END IF;

  -- Missing and foreign availability ids are indistinguishable to the caller.
  IF p_availability_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM private.offering_movement_availability a
    WHERE a.id = p_availability_id AND a.offering_member_id = v_member_id
  ) THEN
    RETURN;
  END IF;

  -- Candidate selection is private and ownership-scoped. The result limit is
  -- applied AFTER authoritative validation, so stale history cannot crowd out
  -- later actionable interests. The existing 0047 offerer index supports order.
  <<candidates>>
  FOR v_candidate IN
    SELECT i.id
    FROM private.requester_movement_interests i
    JOIN private.offering_movement_availability a ON a.id = i.availability_id
    WHERE i.offering_member_id = v_member_id
      AND a.offering_member_id = v_member_id
      AND i.status = 'active'
      AND i.expires_at > clock_timestamp()
      AND (p_availability_id IS NULL OR i.availability_id = p_availability_id)
    ORDER BY i.created_at ASC, i.id ASC
  LOOP
    v_visible := false;
    BEGIN
      -- Preserve 0047's complete authoritative support and lock contract.
      -- Expected eligibility exceptions are caught ONLY around this assertion;
      -- SQL/projection errors, deadlocks and cancellations propagate normally.
      BEGIN
        PERFORM private.assert_requester_movement_interest(v_candidate.id);
      EXCEPTION
        WHEN check_violation OR no_data_found THEN
          CONTINUE candidates;
        WHEN raise_exception THEN
          IF SQLERRM IN (
            'Movement need not found',
            'Offering movement availability not found',
            'Offering movement intent not found'
          ) THEN
            CONTINUE candidates;
          END IF;
          RAISE;
        WHEN insufficient_privilege THEN
          IF SQLERRM IN (
            'Verified member does not own this movement need',
            'Offering movement intent does not belong to member'
          ) THEN
            CONTINUE candidates;
          END IF;
          RAISE;
      END;

      -- Project only the established 0047 safe fields, plus availability id.
      -- No precise-label fallback and no profile/contact/media expansion.
      SELECT i.id, n.id, a.id,
        od.discovery_area_label, dd.discovery_area_label, n.people_count,
        n.earliest_departure_at, n.latest_departure_at,
        e.requester_origin_distance_to_route_meters, i.created_at
      INTO interest_id, movement_need_id, availability_id,
        origin_area, destination_area, people_count,
        earliest_departure_at, latest_departure_at,
        requester_origin_distance_to_route_meters, interest_created_at
      FROM private.requester_movement_interests i
      JOIN private.offering_movement_availability a ON a.id = i.availability_id
      JOIN public.movement_needs n ON n.id = i.movement_need_id
      JOIN private.trusted_route_match_evidence e ON e.id = i.route_match_evidence_id
      JOIN private.trusted_location_discovery_areas od
        ON od.resolved_location_reference_id = e.requester_origin_location_reference_id
      JOIN private.trusted_location_discovery_areas dd
        ON dd.resolved_location_reference_id = e.requester_destination_location_reference_id
      WHERE i.id = v_candidate.id
        AND i.offering_member_id = v_member_id
        AND a.offering_member_id = v_member_id
        AND i.status = 'active'
        AND i.expires_at > clock_timestamp();
      v_visible := FOUND;

      -- Release this candidate's validation locks even on success. Otherwise
      -- a multi-need inbox would hold intent/availability locks from one need
      -- while acquiring the next need lock, reversing 0045/0046's lock order.
      -- PostgreSQL exception rollback releases locks acquired in this block;
      -- local output variables survive. ZX048 is an internal control signal,
      -- never a caught database-error category. There are no persistent writes.
      -- https://www.postgresql.org/docs/current/explicit-locking.html
      RAISE SQLSTATE 'ZX048' USING MESSAGE = 'Release inbox candidate locks';
    EXCEPTION WHEN SQLSTATE 'ZX048' THEN
      NULL;
    END;

    IF v_visible THEN
      RETURN NEXT;
      v_returned := v_returned + 1;
      EXIT candidates WHEN v_returned >= p_limit;
    END IF;
  END LOOP candidates;
END;
$inbox$;

REVOKE ALL ON FUNCTION public.list_requester_movement_interests_for_offerer(uuid,integer)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_requester_movement_interests_for_offerer(uuid,integer)
TO authenticated;

COMMIT;
