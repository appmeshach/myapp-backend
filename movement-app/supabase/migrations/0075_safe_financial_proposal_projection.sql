BEGIN;

-- WE DO NOT CREATE JOURNEYS. Observe exact immutable proposal terms only.
CREATE FUNCTION public.get_my_financial_proposal(p_financial_proposal_id uuid)
RETURNS TABLE (
  proposal_id uuid,
  proposal_version integer,
  proposal_status text,
  created_at timestamptz,
  expires_at timestamptz,
  caller_role text,
  currency text,
  quoted_platform_fee_total_minor bigint,
  quoted_movement_contribution_minor bigint,
  origin_area text,
  destination_area text,
  earliest_departure_at timestamptz,
  latest_departure_at timestamptz,
  people_count integer,
  seats_offered integer,
  vehicle_seat_capacity integer,
  proposed_pickup_area text,
  proposed_dropoff_area text,
  estimated_arrival_minutes integer,
  offering_accepted_at timestamptz,
  requester_accepted_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE caller uuid := auth.uid();
BEGIN
  IF p_financial_proposal_id IS NULL OR caller IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.members m WHERE m.id=caller) THEN
    RETURN;
  END IF;
  -- Exact historical IDs remain readable; no current/expiry filter or replacement.
  RETURN QUERY SELECT p.id,p.version,p.status,p.created_at,p.expires_at,
    CASE WHEN p.member_needing_movement_id=caller THEN 'requester'::text ELSE 'offerer'::text END,
    p.currency,p.quoted_platform_fee_total_minor,p.quoted_movement_contribution_minor,
    p.origin_area,p.destination_area,p.earliest_departure_at,p.latest_departure_at,
    p.people_count,p.seats_offered,p.vehicle_seat_capacity,
    p.proposed_pickup_area,p.proposed_dropoff_area,p.estimated_arrival_minutes,
    p.offering_accepted_at,p.requester_accepted_at
  FROM private.financial_proposals p
  WHERE p.id=p_financial_proposal_id
    AND caller IN (p.member_needing_movement_id,p.offering_member_id);
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_financial_proposal(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_my_financial_proposal(uuid) TO authenticated;

COMMIT;
