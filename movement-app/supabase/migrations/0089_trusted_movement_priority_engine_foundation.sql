BEGIN;

-- WE DO NOT CREATE JOURNEYS. Eligibility first; humans make the final choice.
-- movement_priority_v1 is immutable policy, not mutable configuration.
CREATE FUNCTION private.movement_priority_strengths_v1(
 p_completed bigint,p_rating_sum numeric,p_rating_count bigint,p_wait_minutes numeric,p_tau numeric
) RETURNS TABLE(history numeric,reputation numeric,waiting numeric)
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $strengths$
BEGIN
 IF p_completed IS NULL OR p_completed<0 OR p_rating_count IS NULL OR p_rating_count<0
  OR p_rating_sum IS NULL OR p_rating_sum NOT BETWEEN p_rating_count::numeric AND p_rating_count::numeric*5
  OR p_wait_minutes IS NULL OR p_wait_minutes<0 OR p_wait_minutes::text IN('NaN','Infinity','-Infinity')
  OR p_tau IS NULL OR p_tau<=0 OR p_tau::text IN('NaN','Infinity','-Infinity') THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Finite valid priority evidence required'; END IF;
 RETURN QUERY SELECT 100::numeric*p_completed/(p_completed::numeric+3),
  greatest(0::numeric,least(100::numeric,100*((20::numeric+p_rating_sum)/(5::numeric+p_rating_count)-3)/2)),
  100::numeric*p_wait_minutes/(p_wait_minutes+p_tau);
END; $strengths$;

CREATE FUNCTION private.movement_priority_v1(
 p_completed bigint,p_rating_sum numeric,p_rating_count bigint,p_wait_minutes numeric,p_context text
) RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $priority$
DECLARE tau numeric; hw numeric; rw numeric; ww numeric; s record;
BEGIN
 CASE p_context
 WHEN 'offerer_initiated_1_seat_v1' THEN tau:=135;hw:=0.40;rw:=0.35;ww:=0.25;
 WHEN 'offerer_initiated_2_seat_v1' THEN tau:=75;hw:=0.30;rw:=0.25;ww:=0.45;
 WHEN 'offerer_initiated_3_seat_v1' THEN tau:=45;hw:=0.22;rw:=0.18;ww:=0.60;
 WHEN 'offerer_initiated_4_seat_v1' THEN tau:=20;hw:=0.15;rw:=0.10;ww:=0.75;
 WHEN 'requester_initiated_v1' THEN tau:=60;hw:=0.35;rw:=0.40;ww:=0.25;
 ELSE RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Unknown movement_priority_v1 context'; END CASE;
 SELECT * INTO s FROM private.movement_priority_strengths_v1(p_completed,p_rating_sum,p_rating_count,p_wait_minutes,tau);
 RETURN hw*s.history+rw*s.reputation+ww*s.waiting;
END; $priority$;

-- STABLE binds both authoritative aggregates to the invoking SELECT snapshot.
-- Neither display aggregates nor generic lifecycle/review data participate.
CREATE FUNCTION private.movement_member_priority_v1(p_member uuid,p_wait_minutes numeric,p_context text)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $member$
 SELECT private.movement_priority_v1(
  (SELECT count(*) FROM private.completed_movement_principals p WHERE p.member_id=p_member),
  (SELECT coalesce(sum(r.stars::numeric),0) FROM private.completed_movement_ratings r WHERE r.reviewed_member_id=p_member),
  (SELECT count(*) FROM private.completed_movement_ratings r WHERE r.reviewed_member_id=p_member),
  p_wait_minutes,p_context);
$member$;
REVOKE ALL ON FUNCTION private.movement_priority_strengths_v1(bigint,numeric,bigint,numeric,numeric),
 private.movement_priority_v1(bigint,numeric,bigint,numeric,text),
 private.movement_member_priority_v1(uuid,numeric,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.list_requester_movement_interests_for_offerer(
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
  v_now timestamptz;
  v_score numeric;
  v_rows jsonb := '[]'::jsonb;
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

  v_now := clock_timestamp();

  -- Candidate selection is private and ownership-scoped. The result limit is
  -- applied AFTER authoritative validation, so stale history cannot crowd out
  -- later actionable interests. The existing 0047 offerer index supports order.
  <<candidates>>
  FOR v_candidate IN
    SELECT i.id, i.created_at AS wait_start, a.total_places,
      (SELECT count(*) FROM private.completed_movement_principals p WHERE p.member_id=i.requesting_member_id) AS completed,
      (SELECT count(*) FROM private.completed_movement_ratings r WHERE r.reviewed_member_id=i.requesting_member_id) AS rating_count,
      (SELECT coalesce(sum(r.stars::numeric),0) FROM private.completed_movement_ratings r WHERE r.reviewed_member_id=i.requesting_member_id) AS rating_sum
    FROM private.requester_movement_interests i
    JOIN private.offering_movement_availability a ON a.id = i.availability_id
    WHERE i.offering_member_id = v_member_id
      AND a.offering_member_id = v_member_id
      AND i.status = 'active'
      AND i.expires_at > v_now
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
      IF v_visible THEN
        v_score := private.movement_priority_v1(
          v_candidate.completed,v_candidate.rating_sum,v_candidate.rating_count,
          greatest(0::numeric,extract(epoch FROM (v_now-v_candidate.wait_start))/60),
          'offerer_initiated_'||least(v_candidate.total_places,4)||'_seat_v1');
      END IF;

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
      v_rows := v_rows || jsonb_build_array(jsonb_build_object(
        'interest_id',interest_id,'movement_need_id',movement_need_id,'availability_id',availability_id,
        'origin_area',origin_area,'destination_area',destination_area,'people_count',people_count,
        'earliest_departure_at',earliest_departure_at,'latest_departure_at',latest_departure_at,
        'requester_origin_distance_to_route_meters',requester_origin_distance_to_route_meters,
        'interest_created_at',interest_created_at,'priority',v_score));
    END IF;
  END LOOP candidates;
  RETURN QUERY SELECT x.interest_id,x.movement_need_id,x.availability_id,
    x.origin_area,x.destination_area,x.people_count,x.earliest_departure_at,x.latest_departure_at,
    x.requester_origin_distance_to_route_meters,x.interest_created_at
  FROM jsonb_to_recordset(v_rows) AS x(interest_id uuid,movement_need_id uuid,availability_id uuid,
    origin_area text,destination_area text,people_count integer,earliest_departure_at timestamptz,
    latest_departure_at timestamptz,requester_origin_distance_to_route_meters bigint,
    interest_created_at timestamptz,priority numeric)
  ORDER BY x.priority DESC,x.interest_created_at ASC,x.interest_id ASC LIMIT p_limit;
END;
$inbox$;

REVOKE ALL ON FUNCTION public.list_requester_movement_interests_for_offerer(uuid,integer)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_requester_movement_interests_for_offerer(uuid,integer)
TO authenticated;

COMMIT;
