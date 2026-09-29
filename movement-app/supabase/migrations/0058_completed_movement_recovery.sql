BEGIN;

-- Historical visibility only. No pricing, settlement execution or lifecycle repair.
-- Preserve 0012's settlement projection, with stricter evidence checks in one
-- statement snapshot. Its legacy RPC permits no_settlement and contradictory
-- entitlements; those are deliberately omitted here instead of repaired.
CREATE FUNCTION public.list_my_completed_movement_recoveries(p_limit integer DEFAULT 20)
RETURNS TABLE (movement_need_id uuid, origin_area text, destination_area text,
  completed_at timestamptz, settlement_status text, settlement_is_for_me boolean, settled_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE caller uuid := auth.uid();
BEGIN
  IF caller IS NULL OR NOT EXISTS (SELECT 1 FROM public.members m WHERE m.id=caller) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Authenticated member required';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Recovery limit must be between 1 and 50';
  END IF;
  RETURN QUERY
  SELECT a.movement_need_id, od.discovery_area_label, dd.discovery_area_label,
    j.completed_at, s.status, s.beneficiary_member_id=caller, s.settled_at
  FROM public.alignments a
  JOIN public.journeys j ON j.alignment_id=a.id
  JOIN private.movement_settlements s ON s.journey_id=j.id AND s.alignment_id=a.id
    AND s.beneficiary_member_id=a.offering_member_id
  JOIN private.movement_need_locations ol ON ol.movement_need_id=a.movement_need_id AND ol.role='origin'
  JOIN private.trusted_location_discovery_areas od ON od.resolved_location_reference_id=ol.location_reference_id
  JOIN private.movement_need_locations dl ON dl.movement_need_id=a.movement_need_id AND dl.role='destination'
  JOIN private.trusted_location_discovery_areas dd ON dd.resolved_location_reference_id=dl.location_reference_id
  WHERE caller IN (a.offering_member_id,a.member_needing_movement_id)
    AND a.status='completed' AND j.status='completed'
    AND j.started_at IS NOT NULL AND isfinite(j.started_at)
    AND j.completed_at IS NOT NULL AND isfinite(j.completed_at)
    AND j.started_at<=j.completed_at
    AND j.end_method='mutual_user_end'
    AND j.end_requested_by_member_id IN (a.offering_member_id,a.member_needing_movement_id)
    AND j.end_confirmed_by_member_id IN (a.offering_member_id,a.member_needing_movement_id)
    AND j.end_requested_by_member_id<>j.end_confirmed_by_member_id
    AND j.end_requested_at IS NOT NULL AND isfinite(j.end_requested_at)
    AND j.end_confirmed_at IS NOT NULL AND isfinite(j.end_confirmed_at)
    AND j.end_requested_at<=j.end_confirmed_at AND j.end_confirmed_at=j.completed_at
    AND NOT EXISTS (SELECT 1 FROM private.mutual_no_travel_closures n WHERE n.journey_id=j.id)
    -- Count all mappings, not only otherwise eligible ones; ambiguity is hidden.
    AND (SELECT count(*) FROM public.alignments x JOIN public.journeys y ON y.alignment_id=x.id
      WHERE x.movement_need_id=a.movement_need_id)=1
    -- Reuse canonical accepted-offer, closed-need, participant and activation
    -- evidence without testing current discovery or availability deadlines.
    AND EXISTS (SELECT 1 FROM private.post_activation_reveal_subjects(a.movement_need_id,caller) c
      WHERE c.alignment_id=a.id)
    AND s.status IN ('pending_amount','pending_settlement','settled','failed')
    AND ((s.status='settled' AND s.settled_at IS NOT NULL AND isfinite(s.settled_at)
          AND s.settled_at>=j.completed_at)
      OR (s.status<>'settled' AND s.settled_at IS NULL))
  ORDER BY j.completed_at DESC, a.movement_need_id DESC
  LIMIT p_limit;
END;
$$;
REVOKE ALL ON FUNCTION public.list_my_completed_movement_recoveries(integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_my_completed_movement_recoveries(integer) TO authenticated;

COMMIT;
