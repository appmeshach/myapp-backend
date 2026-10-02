BEGIN;

-- WE DO NOT CREATE JOURNEYS. Provenance only; no proposal issuer or economics.
-- Serialize the empty-table precondition with every concurrent constructor.
LOCK TABLE private.financial_proposals IN ACCESS EXCLUSIVE MODE;
DO $precondition$
BEGIN
  IF EXISTS (SELECT 1 FROM private.financial_proposals) THEN
    RAISE EXCEPTION USING ERRCODE='23514',
      MESSAGE='0070 requires empty financial proposal history; never fabricate quote provenance';
  END IF;
END;
$precondition$;

ALTER TABLE private.financial_proposals
  ADD COLUMN pricing_quote_id uuid NOT NULL
    REFERENCES private.pricing_quotes(id),
  ADD COLUMN pricing_quote_version integer NOT NULL CHECK (pricing_quote_version>=1);

-- Historical identity assertion: no live-status checks or upstream locks.
-- Safe after supersession, expiry, and movement lifecycle transitions.
CREATE FUNCTION private.assert_financial_proposal_quote_binding(p private.financial_proposals)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE q private.pricing_quotes%ROWTYPE;
BEGIN
  SELECT x.* INTO q FROM private.pricing_quotes x WHERE x.id=p.pricing_quote_id;
  IF NOT FOUND OR p.pricing_quote_version IS NULL OR
    ROW(p.pricing_quote_version,p.movement_need_id,p.member_needing_movement_id,
      p.offering_member_id,p.currency,p.pricing_policy_version)
    IS DISTINCT FROM ROW(q.version,q.movement_need_id,q.requesting_member_id,
      q.offering_member_id,q.currency,q.pricing_policy_version) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Proposal requires exact pricing quote provenance';
  END IF;
  IF p.created_at IS NULL OR NOT isfinite(p.created_at) OR p.created_at<q.created_at
    OR p.expires_at IS NULL OR NOT isfinite(p.expires_at)
    OR p.expires_at<=p.created_at OR p.expires_at>q.expires_at THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Proposal lifetime must be finite and quote-bounded';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.assert_financial_proposal_quote_binding(private.financial_proposals)
  FROM PUBLIC,anon,authenticated,service_role;

-- Preserve every 0021 guard. Its complete-row comparison automatically includes
-- the new quote fields: neither is in the mutable-field exclusion list.
CREATE OR REPLACE FUNCTION private.protect_financial_proposal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Proposal history cannot be deleted';
  END IF;
  IF TG_OP='INSERT' THEN
    -- Validate immutable selectors before acquiring any quote/FK locks.
    PERFORM private.assert_financial_proposal_quote_binding(NEW);
    -- Owns need UPDATE -> endpoints -> intent -> route -> match -> geography
    -- -> quote SHARE. Initial construction only, never historical updates.
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

-- Existing triggers, deferred completeness/consent checks, route NULL guard,
-- traveller protection, RLS and table ACLs are unchanged.
COMMIT;
