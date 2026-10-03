BEGIN;

-- WE DO NOT CREATE JOURNEYS. Provenance only; no issuer or economics.
LOCK TABLE private.financial_proposals IN ACCESS EXCLUSIVE MODE;
DO $precondition$
BEGIN
  IF EXISTS (SELECT 1 FROM private.financial_proposals) THEN
    RAISE EXCEPTION USING ERRCODE='23514',
      MESSAGE='0073 requires empty financial proposal history; never fabricate movement context provenance';
  END IF;
END;
$precondition$;

ALTER TABLE private.financial_proposals
  ADD COLUMN movement_context_snapshot_id uuid NOT NULL
    REFERENCES private.movement_context_snapshots(id),
  ADD COLUMN movement_context_snapshot_version integer NOT NULL
    CHECK (movement_context_snapshot_version>=1);
CREATE INDEX financial_proposals_snapshot_status
  ON private.financial_proposals(movement_context_snapshot_id,status);

-- Historical assertions deliberately acquire no locks and consult no live state.
CREATE FUNCTION private.assert_financial_proposal_movement_context_binding(p private.financial_proposals)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s private.movement_context_snapshots%ROWTYPE;
BEGIN
  SELECT x.* INTO s FROM private.movement_context_snapshots x
    WHERE x.id=p.movement_context_snapshot_id;
  IF NOT FOUND OR s.context_schema_version IS DISTINCT FROM 'movement_context_v1'
    OR s.movement_offer_id IS NULL OR p.movement_context_snapshot_version IS NULL
    OR ROW(p.movement_context_snapshot_version,p.movement_need_id,p.member_needing_movement_id,
      p.offering_member_id,p.vehicle_id,p.people_count,p.seats_offered,p.vehicle_seat_capacity,
      p.origin_area,p.destination_area,p.earliest_departure_at,p.latest_departure_at,
      p.proposed_pickup_area,p.proposed_dropoff_area,p.estimated_arrival_minutes)
    IS DISTINCT FROM ROW(s.version,s.movement_need_id,s.requesting_member_id,
      s.offering_member_id,s.vehicle_id,s.people_count,s.seats_offered,s.vehicle_seat_capacity,
      s.requester_origin_area,s.requester_destination_area,s.requester_earliest_departure_at,
      s.requester_latest_departure_at,s.proposed_pickup_area,s.proposed_dropoff_area,s.declared_arrival_minutes) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Proposal requires exact movement context provenance';
  END IF;
  IF p.created_at IS NULL OR NOT isfinite(p.created_at) OR p.created_at<s.created_at
    OR p.expires_at IS NULL OR NOT isfinite(p.expires_at) OR p.expires_at<=p.created_at
    OR s.expires_at IS NULL OR NOT isfinite(s.expires_at) OR p.expires_at>s.expires_at THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Proposal lifetime must be finite and snapshot-bounded';
  END IF;
  IF p.movement_offer_id IS NOT NULL AND p.movement_offer_id IS DISTINCT FROM s.movement_offer_id THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Proposal operational offer must equal its historical snapshot source';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.assert_financial_proposal_movement_context_binding(private.financial_proposals)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.assert_financial_proposal_source_compatibility(p private.financial_proposals)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE q private.pricing_quotes%ROWTYPE; s private.movement_context_snapshots%ROWTYPE;
  g private.pricing_geography_evidence%ROWTYPE;
  qm private.trusted_route_match_evidence%ROWTYPE;
  sm private.trusted_route_match_evidence%ROWTYPE;
  rb private.movement_offer_route_match_bindings%ROWTYPE;
BEGIN
  SELECT x.* INTO q FROM private.pricing_quotes x WHERE x.id=p.pricing_quote_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Proposal quote source unavailable';
  END IF;
  SELECT x.* INTO s FROM private.movement_context_snapshots x WHERE x.id=p.movement_context_snapshot_id;
  IF NOT FOUND OR ROW(q.movement_need_id,q.requesting_member_id,q.offering_member_id,
      q.offering_movement_intent_id,q.offering_intent_version)
    IS DISTINCT FROM ROW(s.movement_need_id,s.requesting_member_id,s.offering_member_id,
      s.offering_movement_intent_id,s.offering_intent_version) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Proposal quote and snapshot movement identities differ';
  END IF;
  SELECT x.* INTO g FROM private.pricing_geography_evidence x WHERE x.id=q.pricing_geography_evidence_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Proposal pricing geography source unavailable';
  END IF;
  SELECT x.* INTO qm FROM private.trusted_route_match_evidence x WHERE x.id=g.route_match_evidence_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Proposal pricing match source unavailable';
  END IF;
  SELECT x.* INTO rb FROM private.movement_offer_route_match_bindings x WHERE x.movement_offer_id=s.movement_offer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Proposal snapshot offer authorization unavailable';
  END IF;
  SELECT x.* INTO sm FROM private.trusted_route_match_evidence x WHERE x.id=rb.route_match_evidence_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Proposal snapshot match source unavailable';
  END IF;
  -- 0059 copies the exact route and requester-origin state anchor from its match.
  -- 0072 binds the offer match's route to availability and copies its endpoints.
  -- Do not add redundant match-ID comparisons: 0037 already uniquely identifies
  -- a match by need/route/algorithm. Pricing classification identities may
  -- differ while the authoritative route and requester endpoints still agree.
  IF ROW(g.route_evidence_id,g.route_evidence_version,
      qm.requester_origin_location_reference_id,qm.requester_destination_location_reference_id,
      q.state_location_reference_id)
    IS DISTINCT FROM ROW(sm.route_evidence_id,sm.route_evidence_version,
      s.requester_origin_location_id,s.requester_destination_location_id,s.requester_origin_location_id) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Proposal quote and snapshot route or endpoint provenance differs';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.assert_financial_proposal_source_compatibility(private.financial_proposals)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.assert_financial_proposal_snapshot_roster(p_proposal_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE p private.financial_proposals%ROWTYPE; snapshot_count bigint; proposal_count bigint;
BEGIN
  SELECT x.* INTO STRICT p FROM private.financial_proposals x WHERE x.id=p_proposal_id;
  SELECT count(*) INTO proposal_count FROM private.financial_proposal_travellers t WHERE t.proposal_id=p.id;
  SELECT count(*) INTO snapshot_count FROM private.movement_context_snapshot_travellers t
    WHERE t.snapshot_id=p.movement_context_snapshot_id;
  IF proposal_count<>p.people_count OR snapshot_count<>p.people_count OR proposal_count<>snapshot_count
    OR EXISTS (
      SELECT t.member_id,t.participant_id,t.role FROM private.financial_proposal_travellers t WHERE t.proposal_id=p.id
      EXCEPT
      SELECT t.member_id,t.movement_participant_id,t.role FROM private.movement_context_snapshot_travellers t
        WHERE t.snapshot_id=p.movement_context_snapshot_id
    ) OR EXISTS (
      SELECT t.member_id,t.movement_participant_id,t.role FROM private.movement_context_snapshot_travellers t
        WHERE t.snapshot_id=p.movement_context_snapshot_id
      EXCEPT
      SELECT t.member_id,t.participant_id,t.role FROM private.financial_proposal_travellers t WHERE t.proposal_id=p.id
    ) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Proposal requires the exact historical snapshot roster';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.assert_financial_proposal_snapshot_roster(uuid)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.validate_financial_proposal_movement_context_binding()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE proposal_to_check uuid; p private.financial_proposals%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME='financial_proposal_travellers' THEN proposal_to_check:=NEW.proposal_id;
  ELSE proposal_to_check:=NEW.id; END IF;
  SELECT x.* INTO STRICT p FROM private.financial_proposals x WHERE x.id=proposal_to_check;
  PERFORM private.assert_financial_proposal_quote_binding(p);
  PERFORM private.assert_financial_proposal_movement_context_binding(p);
  PERFORM private.assert_financial_proposal_source_compatibility(p);
  PERFORM private.assert_financial_proposal_snapshot_roster(p.id);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.validate_financial_proposal_movement_context_binding()
  FROM PUBLIC,anon,authenticated,service_role;
CREATE CONSTRAINT TRIGGER financial_proposal_movement_context_complete
  AFTER INSERT OR UPDATE ON private.financial_proposals
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION private.validate_financial_proposal_movement_context_binding();
CREATE CONSTRAINT TRIGGER financial_proposal_snapshot_roster_complete
  AFTER INSERT ON private.financial_proposal_travellers
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION private.validate_financial_proposal_movement_context_binding();

CREATE FUNCTION private.protect_proposal_bound_movement_context_snapshot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.status='current' AND NEW.status='superseded' THEN
    IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
      RAISE EXCEPTION USING ERRCODE='25000',MESSAGE='Bound snapshot supersession requires READ COMMITTED';
    END IF;
    -- The UPDATE already owns the snapshot row lock. This volatile function's
    -- READ COMMITTED query sees constructors committed after the UPDATE waited.
    -- No proposal locks, need locks, or automatic lifecycle mutation here.
    IF EXISTS (SELECT 1 FROM private.financial_proposals p
      WHERE p.movement_context_snapshot_id=OLD.id AND p.status='current') THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Current financial proposal pins its movement context snapshot';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.protect_proposal_bound_movement_context_snapshot()
  FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER protect_proposal_bound_movement_context_snapshot
  BEFORE UPDATE ON private.movement_context_snapshots FOR EACH ROW
  EXECUTE FUNCTION private.protect_proposal_bound_movement_context_snapshot();

-- The replacement below retains every original 0021/0070 protection.
-- Need/dependencies must precede existing proposal history in future writers.
-- Materialized current proposals remain immutable and permanently pin snapshots.
CREATE OR REPLACE FUNCTION private.protect_financial_proposal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s private.movement_context_snapshots%ROWTYPE;
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Proposal history cannot be deleted';
  END IF;
  PERFORM private.assert_financial_proposal_quote_binding(NEW);
  PERFORM private.assert_financial_proposal_movement_context_binding(NEW);
  PERFORM private.assert_financial_proposal_source_compatibility(NEW);
  IF TG_OP='INSERT' THEN
    SELECT x.* INTO STRICT s FROM private.movement_context_snapshots x
      WHERE x.id=NEW.movement_context_snapshot_id;
    -- Stronger locks FIRST: 0045 owns need UPDATE -> offer UPDATE -> requester
    -- endpoints -> intent UPDATE -> route -> availability UPDATE -> vehicle/access.
    -- Never upgrade quote SHARE locks into this chain. Future writers must take
    -- these dependencies before existing proposal history rows.
    PERFORM private.assert_movement_offer_availability_binding(s.movement_offer_id);
    PERFORM private.assert_pricing_quote(NEW.pricing_quote_id);
    -- Dependencies are already locked. Retain snapshot SHARE until transaction
    -- end; FK KEY SHARE alone would not block a non-key status UPDATE.
    PERFORM private.assert_movement_context_snapshot(NEW.movement_context_snapshot_id);
    -- Fresh clock eligibility after quote/snapshot waits, with locks held.
    PERFORM private.assert_movement_offer_availability_binding(s.movement_offer_id);
    PERFORM private.assert_pricing_quote(NEW.pricing_quote_id);
    IF NEW.status<>'current' OR NEW.offering_accepted_at IS NOT NULL OR NEW.requester_accepted_at IS NOT NULL
      OR NEW.movement_offer_id IS NOT NULL OR NEW.alignment_id IS NOT NULL
      OR NEW.financial_agreement_id IS NOT NULL OR NEW.materialized_at IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Create an unaccepted unbound current proposal first';
    END IF;
    IF NEW.created_at > clock_timestamp() THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Proposal creation time cannot be future-dated';
    END IF;
    IF NEW.expires_at IS NOT NULL AND NEW.expires_at <= clock_timestamp() THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Proposal cannot be created already expired';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW)-ARRAY['status','offering_accepted_at','requester_accepted_at',
      'movement_offer_id','alignment_id','financial_agreement_id','materialized_at'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','offering_accepted_at','requester_accepted_at',
      'movement_offer_id','alignment_id','financial_agreement_id','materialized_at']) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Proposal economics and snapshots are immutable';
  END IF;
  IF OLD.status='superseded' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Superseded proposal is immutable';
  END IF;
  IF OLD.materialized_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Materialized proposal is immutable';
  END IF;
  IF (OLD.offering_accepted_at IS NOT NULL AND NEW.offering_accepted_at IS DISTINCT FROM OLD.offering_accepted_at)
    OR (OLD.requester_accepted_at IS NOT NULL AND NEW.requester_accepted_at IS DISTINCT FROM OLD.requester_accepted_at)
    OR (OLD.movement_offer_id IS NOT NULL AND NEW.movement_offer_id IS DISTINCT FROM OLD.movement_offer_id)
    OR (OLD.alignment_id IS NOT NULL AND NEW.alignment_id IS DISTINCT FROM OLD.alignment_id)
    OR (OLD.financial_agreement_id IS NOT NULL AND NEW.financial_agreement_id IS DISTINCT FROM OLD.financial_agreement_id)
    OR (OLD.materialized_at IS NOT NULL AND NEW.materialized_at IS DISTINCT FROM OLD.materialized_at) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Proposal consent and links are write-once';
  END IF;
  IF (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') THEN
    IF NEW.status<>'current' OR (NEW.expires_at IS NOT NULL AND NEW.expires_at<=clock_timestamp()) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Proposal is not current and unexpired';
    END IF;
    IF NEW.offering_accepted_at>clock_timestamp() OR NEW.requester_accepted_at>clock_timestamp()
      OR NEW.materialized_at>clock_timestamp() THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Proposal evidence cannot be future-dated';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.protect_financial_proposal() FROM PUBLIC,anon,authenticated,service_role;

COMMIT;
