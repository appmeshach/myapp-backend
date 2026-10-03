BEGIN;

-- WE DO NOT CREATE JOURNEYS. Only immutable proposal issuance and its roster.
CREATE FUNCTION public.issue_financial_proposal_for_server(
  p_pricing_quote_id uuid,
  p_expected_pricing_quote_version integer,
  p_movement_context_snapshot_id uuid,
  p_expected_movement_context_snapshot_version integer
)
RETURNS TABLE (
  proposal_id uuid,
  proposal_version integer,
  proposal_status text,
  proposal_created_at timestamptz,
  proposal_expires_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  q private.pricing_quotes%ROWTYPE;
  s private.movement_context_snapshots%ROWTYPE;
  p private.financial_proposals%ROWTYPE;
  previous private.financial_proposals%ROWTYPE;
  economics record;
  replay_count bigint;
  next_version bigint;
BEGIN
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION USING ERRCODE='25000', MESSAGE='Financial proposal issuer requires READ COMMITTED';
  END IF;
  IF p_pricing_quote_id IS NULL OR p_expected_pricing_quote_version IS NULL
    OR p_movement_context_snapshot_id IS NULL OR p_expected_movement_context_snapshot_version IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22004', MESSAGE='Complete exact proposal source identities required';
  END IF;
  IF p_expected_pricing_quote_version<1 OR p_expected_movement_context_snapshot_version<1 THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Positive expected proposal source versions required';
  END IF;

  -- Discover immutable selectors without locking quote/snapshot/history first.
  SELECT x.* INTO q FROM private.pricing_quotes x WHERE x.id=p_pricing_quote_id;
  IF NOT FOUND OR q.version IS DISTINCT FROM p_expected_pricing_quote_version THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Exact proposal pricing quote unavailable';
  END IF;
  SELECT x.* INTO s FROM private.movement_context_snapshots x WHERE x.id=p_movement_context_snapshot_id;
  IF NOT FOUND OR s.version IS DISTINCT FROM p_expected_movement_context_snapshot_version THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Exact proposal movement snapshot unavailable';
  END IF;
  -- Reject cross-need/intent selectors before they can acquire a second need lock.
  p.pricing_quote_id:=q.id;
  p.movement_context_snapshot_id:=s.id;
  PERFORM private.assert_financial_proposal_source_compatibility(p);

  -- 0045 owns need UPDATE -> offer UPDATE -> requester endpoints -> intent
  -- UPDATE -> route -> availability UPDATE -> vehicle/access. Strong locks first.
  PERFORM private.assert_movement_offer_availability_binding(s.movement_offer_id);
  PERFORM private.assert_pricing_quote(q.id);
  PERFORM private.assert_movement_context_snapshot_offer_binding(s);
  PERFORM private.assert_movement_context_snapshot(s.id);
  -- The need UPDATE lock serializes this scope even when history is empty.
  PERFORM x.id FROM private.financial_proposals x
    WHERE x.movement_need_id=s.movement_need_id AND x.offering_member_id=s.offering_member_id
    ORDER BY x.version FOR UPDATE;
  -- Fresh eligibility and clock checks after all waits, with dependencies retained.
  PERFORM private.assert_movement_offer_availability_binding(s.movement_offer_id);
  PERFORM private.assert_pricing_quote(q.id);
  PERFORM private.assert_movement_context_snapshot(s.id);
  SELECT x.* INTO STRICT q FROM private.pricing_quotes x WHERE x.id=p_pricing_quote_id;
  SELECT x.* INTO STRICT s FROM private.movement_context_snapshots x WHERE x.id=p_movement_context_snapshot_id;

  p.id:=gen_random_uuid();
  p.movement_need_id:=s.movement_need_id;
  p.offering_member_id:=s.offering_member_id;
  p.member_needing_movement_id:=s.requesting_member_id;
  p.vehicle_id:=s.vehicle_id;
  p.financial_model_version:='shared_platform_fee_v1';
  p.platform_fee_allocation_policy_version:='equal_split_requester_remainder_v1';
  p.pricing_policy_version:=q.pricing_policy_version;
  p.currency:=q.currency;
  SELECT * INTO STRICT economics FROM private.calculate_financial_proposal_economics(
    q.seat_price_minor,s.people_count,p.financial_model_version,p.platform_fee_allocation_policy_version);
  p.quoted_platform_fee_total_minor:=economics.quoted_platform_fee_total_minor;
  p.quoted_movement_contribution_minor:=economics.quoted_movement_contribution_minor;
  p.origin_area:=s.requester_origin_area;
  p.destination_area:=s.requester_destination_area;
  p.earliest_departure_at:=s.requester_earliest_departure_at;
  p.latest_departure_at:=s.requester_latest_departure_at;
  p.people_count:=s.people_count;
  p.seats_offered:=s.seats_offered;
  p.vehicle_seat_capacity:=s.vehicle_seat_capacity;
  p.proposed_pickup_area:=s.proposed_pickup_area;
  p.proposed_dropoff_area:=s.proposed_dropoff_area;
  p.estimated_arrival_minutes:=s.declared_arrival_minutes;
  p.route_evidence_id:=NULL;
  p.pricing_quote_id:=q.id;
  p.pricing_quote_version:=q.version;
  p.movement_context_snapshot_id:=s.id;
  p.movement_context_snapshot_version:=s.version;
  p.created_at:=clock_timestamp();
  p.expires_at:=least(q.expires_at,s.expires_at);
  p.status:='current';
  p.offering_accepted_at:=NULL;
  p.requester_accepted_at:=NULL;
  p.movement_offer_id:=NULL;
  p.alignment_id:=NULL;
  p.financial_agreement_id:=NULL;
  p.materialized_at:=NULL;
  PERFORM private.assert_financial_proposal_quote_binding(p);
  PERFORM private.assert_financial_proposal_movement_context_binding(p);
  PERFORM private.assert_financial_proposal_source_compatibility(p);

  -- Replay includes terminal proposal history, never resurrects it, and requires
  -- live eligible sources just like new issuance. Fail closed on ambiguous history.
  SELECT count(*) INTO replay_count FROM private.financial_proposals x
    WHERE x.pricing_quote_id=q.id AND x.pricing_quote_version=q.version
      AND x.movement_context_snapshot_id=s.id AND x.movement_context_snapshot_version=s.version
      AND x.financial_model_version=p.financial_model_version
      AND x.platform_fee_allocation_policy_version=p.platform_fee_allocation_policy_version;
  IF replay_count>1 THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Ambiguous financial proposal replay history';
  END IF;
  IF replay_count=1 THEN
    SELECT x.* INTO STRICT previous FROM private.financial_proposals x
      WHERE x.pricing_quote_id=q.id AND x.pricing_quote_version=q.version
        AND x.movement_context_snapshot_id=s.id AND x.movement_context_snapshot_version=s.version
        AND x.financial_model_version=p.financial_model_version
        AND x.platform_fee_allocation_policy_version=p.platform_fee_allocation_policy_version;
    IF (to_jsonb(previous)-ARRAY['id','version','created_at','expires_at','status',
        'offering_accepted_at','requester_accepted_at','movement_offer_id','alignment_id','financial_agreement_id','materialized_at'])
      IS DISTINCT FROM (to_jsonb(p)-ARRAY['id','version','created_at','expires_at','status',
        'offering_accepted_at','requester_accepted_at','movement_offer_id','alignment_id','financial_agreement_id','materialized_at']) THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Financial proposal replay payload mismatch';
    END IF;
    PERFORM private.assert_financial_proposal_quote_binding(previous);
    PERFORM private.assert_financial_proposal_movement_context_binding(previous);
    PERFORM private.assert_financial_proposal_source_compatibility(previous);
    PERFORM private.assert_financial_proposal_snapshot_roster(previous.id);
    RETURN QUERY SELECT previous.id,previous.version,previous.status,previous.created_at,previous.expires_at;
    RETURN;
  END IF;

  SELECT coalesce(max(x.version)::bigint,0)+1 INTO next_version FROM private.financial_proposals x
    WHERE x.movement_need_id=s.movement_need_id AND x.offering_member_id=s.offering_member_id;
  IF next_version>2147483647 THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Financial proposal version exhausted';
  END IF;
  p.version:=next_version::integer;
  IF EXISTS (SELECT 1 FROM private.financial_proposals x
    WHERE x.movement_need_id=s.movement_need_id AND x.offering_member_id=s.offering_member_id
      AND x.status='current' AND (x.offering_accepted_at IS NOT NULL OR x.requester_accepted_at IS NOT NULL
        OR x.movement_offer_id IS NOT NULL OR x.alignment_id IS NOT NULL
        OR x.financial_agreement_id IS NOT NULL OR x.materialized_at IS NOT NULL)) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Progressed financial proposal cannot be superseded by issuance';
  END IF;
  -- Follow existing producer convention: scope construction deferral to the four
  -- parent/child checks, force final validation, then leave them normally deferred.
  SET CONSTRAINTS private.financial_proposal_complete,private.financial_proposal_roster_complete,
    private.financial_proposal_movement_context_complete,private.financial_proposal_snapshot_roster_complete DEFERRED;
  UPDATE private.financial_proposals x SET status='superseded'
    WHERE x.movement_need_id=s.movement_need_id AND x.offering_member_id=s.offering_member_id AND x.status='current';
  INSERT INTO private.financial_proposals SELECT p.*;
  INSERT INTO private.financial_proposal_travellers(proposal_id,member_id,participant_id,role)
    SELECT p.id,t.member_id,t.movement_participant_id,t.role
    FROM private.movement_context_snapshot_travellers t WHERE t.snapshot_id=s.id ORDER BY t.movement_participant_id;
  PERFORM private.assert_financial_proposal_snapshot_roster(p.id);
  SET CONSTRAINTS private.financial_proposal_complete,private.financial_proposal_roster_complete,
    private.financial_proposal_movement_context_complete,private.financial_proposal_snapshot_roster_complete IMMEDIATE;
  SET CONSTRAINTS private.financial_proposal_complete,private.financial_proposal_roster_complete,
    private.financial_proposal_movement_context_complete,private.financial_proposal_snapshot_roster_complete DEFERRED;
  RETURN QUERY SELECT p.id,p.version,p.status,p.created_at,p.expires_at;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_financial_proposal_for_server(uuid,integer,uuid,integer)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.issue_financial_proposal_for_server(uuid,integer,uuid,integer) TO service_role;

COMMIT;
