BEGIN;

-- Immutable proposed obligations only. No issuer, pricing engine, client RPC,
-- operational-table trigger, model cutover, or automatic materialization.
CREATE TABLE private.financial_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_need_id uuid NOT NULL REFERENCES public.movement_needs(id),
  offering_member_id uuid NOT NULL REFERENCES public.members(id),
  member_needing_movement_id uuid NOT NULL REFERENCES public.members(id),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id),
  version integer NOT NULL CHECK (version >= 1),
  financial_model_version text NOT NULL CHECK (financial_model_version = 'shared_platform_fee_v1'),
  pricing_policy_version text NOT NULL CHECK (
    length(pricing_policy_version) BETWEEN 1 AND 100
    AND pricing_policy_version ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]*$'),
  platform_fee_allocation_policy_version text NOT NULL
    CHECK (platform_fee_allocation_policy_version = 'equal_split_requester_remainder_v1'),
  currency text NOT NULL CHECK (length(currency)=3 AND currency ~ '^[A-Z]{3}$'),
  quoted_platform_fee_total_minor bigint NOT NULL CHECK (quoted_platform_fee_total_minor >= 0),
  quoted_movement_contribution_minor bigint NOT NULL CHECK (quoted_movement_contribution_minor >= 0),
  -- Exact declarations, not geocoded locations or trusted route measurements.
  origin_area text NOT NULL,
  destination_area text NOT NULL,
  earliest_departure_at timestamptz NOT NULL,
  latest_departure_at timestamptz,
  people_count integer NOT NULL CHECK (people_count >= 1),
  seats_offered integer NOT NULL CHECK (seats_offered >= people_count),
  vehicle_seat_capacity integer NOT NULL CHECK (vehicle_seat_capacity BETWEEN 1 AND 12),
  proposed_pickup_area text,
  proposed_dropoff_area text,
  estimated_arrival_minutes integer CHECK (estimated_arrival_minutes >= 0),
  -- Reserved, deliberately unusable reference. A future migration must replace
  -- this guard with a real evidence FK/validation before non-NULL is permitted.
  route_evidence_id uuid CHECK (route_evidence_id IS NULL),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  status text NOT NULL DEFAULT 'current' CHECK (status IN ('current','superseded')),
  offering_accepted_at timestamptz,
  requester_accepted_at timestamptz,
  movement_offer_id uuid UNIQUE REFERENCES public.movement_offers(id),
  alignment_id uuid UNIQUE REFERENCES public.alignments(id),
  financial_agreement_id uuid UNIQUE REFERENCES private.financial_agreements(id),
  materialized_at timestamptz,
  UNIQUE (movement_need_id,offering_member_id,version),
  CHECK (offering_member_id <> member_needing_movement_id),
  CHECK (seats_offered <= vehicle_seat_capacity),
  CHECK (latest_departure_at IS NULL OR latest_departure_at >= earliest_departure_at),
  CHECK (expires_at IS NULL OR expires_at > created_at),
  CHECK (offering_accepted_at IS NULL OR (offering_accepted_at >= created_at
    AND (expires_at IS NULL OR offering_accepted_at < expires_at))),
  CONSTRAINT financial_proposals_requester_consent_check CHECK (requester_accepted_at IS NULL OR (
    offering_accepted_at IS NOT NULL
    AND requester_accepted_at >= offering_accepted_at
    AND requester_accepted_at >= created_at
    AND (expires_at IS NULL OR requester_accepted_at < expires_at)
  )),
  CHECK ((alignment_id IS NULL AND financial_agreement_id IS NULL AND materialized_at IS NULL)
    OR (alignment_id IS NOT NULL AND financial_agreement_id IS NOT NULL
      AND materialized_at IS NOT NULL AND movement_offer_id IS NOT NULL
      AND offering_accepted_at IS NOT NULL AND requester_accepted_at IS NOT NULL
      AND materialized_at >= offering_accepted_at AND materialized_at >= requester_accepted_at))
);
CREATE UNIQUE INDEX financial_proposals_one_current
  ON private.financial_proposals(movement_need_id,offering_member_id) WHERE status='current';

-- No FK to the mutable participant row: removing/replacing that source row must
-- not rewrite this historical snapshot. Its identity is verified on construction.
CREATE TABLE private.financial_proposal_travellers (
  proposal_id uuid NOT NULL REFERENCES private.financial_proposals(id),
  member_id uuid NOT NULL REFERENCES public.members(id),
  participant_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('primary_requester','invited_participant')),
  PRIMARY KEY (proposal_id,member_id),
  UNIQUE (proposal_id,participant_id)
);

ALTER TABLE private.financial_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.financial_proposal_travellers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.financial_proposals,private.financial_proposal_travellers
  FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON private.financial_proposals,private.financial_proposal_travellers TO service_role;

-- Reads/locks only. Future writers must lock need -> proposal -> vehicle/access
-- consistently before mutations and retry whole transactions on lock conflicts.
-- Current participant mutations already lock the need; no revision is invented.
CREATE FUNCTION private.assert_financial_proposal_context(p_proposal_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE p private.financial_proposals%ROWTYPE; n public.movement_needs%ROWTYPE;
  capacity integer;
BEGIN
  SELECT * INTO STRICT p FROM private.financial_proposals WHERE id=p_proposal_id FOR UPDATE;
  SELECT * INTO STRICT n FROM public.movement_needs WHERE id=p.movement_need_id FOR SHARE;
  IF ROW(n.member_id,n.origin_area,n.destination_area,n.earliest_departure_at,n.latest_departure_at,n.people_count)
    IS DISTINCT FROM ROW(p.member_needing_movement_id,p.origin_area,p.destination_area,
      p.earliest_departure_at,p.latest_departure_at,p.people_count) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Proposal need snapshot does not match';
  END IF;
  SELECT v.seat_capacity INTO STRICT capacity FROM public.vehicles v WHERE v.id=p.vehicle_id FOR SHARE;
  PERFORM 1 FROM public.member_vehicle_access mva
    WHERE mva.member_id=p.offering_member_id AND mva.vehicle_id=p.vehicle_id AND mva.active FOR SHARE;
  IF NOT FOUND OR capacity<>p.vehicle_seat_capacity THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Proposal vehicle access or capacity does not match';
  END IF;
  IF (SELECT count(*) FROM private.financial_proposal_travellers t WHERE t.proposal_id=p.id)<>p.people_count
    OR (SELECT count(*) FROM public.movement_participants mp
      WHERE mp.movement_need_id=p.movement_need_id AND mp.status='confirmed')<>p.people_count
    OR EXISTS (SELECT 1 FROM public.movement_participants mp
      WHERE mp.movement_need_id=p.movement_need_id AND mp.status='invited')
    OR EXISTS (
      SELECT 1 FROM private.financial_proposal_travellers t WHERE t.proposal_id=p.id AND (
        t.member_id=p.offering_member_id
        OR NOT EXISTS (SELECT 1 FROM public.movement_participants mp
          WHERE mp.id=t.participant_id AND mp.movement_need_id=p.movement_need_id
            AND mp.member_id=t.member_id AND mp.role=t.role AND mp.status='confirmed')
        OR (t.role='primary_requester') IS DISTINCT FROM (t.member_id=p.member_needing_movement_id)
      )
    ) OR NOT EXISTS (SELECT 1 FROM private.financial_proposal_travellers t
      WHERE t.proposal_id=p.id AND t.role='primary_requester' AND t.member_id=p.member_needing_movement_id) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Proposal requires the exact complete confirmed roster';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.assert_financial_proposal_context(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.protect_financial_proposal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Proposal history cannot be deleted';
  END IF;
  IF TG_OP='INSERT' THEN
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
CREATE TRIGGER protect_financial_proposal BEFORE INSERT OR UPDATE OR DELETE ON private.financial_proposals
  FOR EACH ROW EXECUTE FUNCTION private.protect_financial_proposal();

CREATE FUNCTION private.protect_financial_proposal_traveller()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE p private.financial_proposals%ROWTYPE;
BEGIN
  IF TG_OP<>'INSERT' THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Proposal roster history is immutable';
  END IF;
  SELECT * INTO STRICT p FROM private.financial_proposals WHERE id=NEW.proposal_id FOR UPDATE;
  IF p.status<>'current' OR p.offering_accepted_at IS NOT NULL OR p.requester_accepted_at IS NOT NULL
    OR p.movement_offer_id IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Proposal roster construction has ended';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.protect_financial_proposal_traveller() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER protect_financial_proposal_traveller BEFORE INSERT OR UPDATE OR DELETE ON private.financial_proposal_travellers
  FOR EACH ROW EXECUTE FUNCTION private.protect_financial_proposal_traveller();

-- Deferred for parent + individual roster INSERTs, and final-state offer /
-- alignment / agreement creation within a future single trusted transaction.
-- Historical supersession/no-op updates do not revalidate mutable source rows.
CREATE FUNCTION private.validate_financial_proposal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE proposal_to_check uuid; p private.financial_proposals%ROWTYPE;
  o public.movement_offers%ROWTYPE; a public.alignments%ROWTYPE;
  g private.financial_agreements%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME='financial_proposal_travellers' THEN proposal_to_check:=NEW.proposal_id;
  ELSE
    IF TG_OP='UPDATE' THEN
      IF (to_jsonb(NEW)-'status') IS NOT DISTINCT FROM (to_jsonb(OLD)-'status') THEN RETURN NULL; END IF;
    END IF;
    proposal_to_check:=NEW.id;
  END IF;
  PERFORM private.assert_financial_proposal_context(proposal_to_check);
  SELECT * INTO STRICT p FROM private.financial_proposals WHERE id=proposal_to_check;
  IF (p.offering_accepted_at IS NOT NULL OR p.requester_accepted_at IS NOT NULL OR p.movement_offer_id IS NOT NULL)
    AND p.expires_at IS NOT NULL AND p.expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Proposal expired before deferred validation';
  END IF;
  IF p.alignment_id IS NULL AND (
    NOT EXISTS (SELECT 1 FROM public.movement_needs n WHERE n.id=p.movement_need_id AND n.status='discoverable')
    OR EXISTS (
  SELECT 1
  FROM public.alignments existing_alignment
  WHERE existing_alignment.movement_need_id = p.movement_need_id
    AND existing_alignment.status IN (
      'awaiting_activation_payment',
      'activated',
      'in_progress',
      'completed'
    )
)
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Unmaterialized proposal requires an available movement need';
  END IF;
  IF p.movement_offer_id IS NULL THEN
    IF p.offering_accepted_at IS NOT NULL
      OR p.requester_accepted_at IS NOT NULL
      OR p.alignment_id IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Proposal consent requires its bound movement offer';
    END IF;
  ELSE
    IF p.offering_accepted_at IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Bound movement offer requires offering-member acceptance';
    END IF;

    SELECT * INTO STRICT o
    FROM public.movement_offers
    WHERE id=p.movement_offer_id
    FOR SHARE;

    IF ROW(o.movement_need_id,o.offering_member_id,o.vehicle_id,o.seats_offered,
        o.proposed_pickup_area,o.proposed_dropoff_area,o.estimated_arrival_minutes)
      IS DISTINCT FROM ROW(p.movement_need_id,p.offering_member_id,p.vehicle_id,p.seats_offered,
        p.proposed_pickup_area,p.proposed_dropoff_area,p.estimated_arrival_minutes) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Proposal offer binding does not match';
    END IF;

    IF p.alignment_id IS NULL AND o.status <> 'pending' THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Unmaterialized proposal requires a pending bound offer';
    END IF;

    IF p.alignment_id IS NOT NULL AND o.status <> 'accepted' THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Materialized proposal requires an accepted bound offer';
    END IF;
  END IF;

  IF p.requester_accepted_at IS NULL AND p.alignment_id IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Materialization requires requester acceptance';
  END IF;

  IF p.requester_accepted_at IS NOT NULL AND p.alignment_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Requester acceptance must materialize in the same transaction';
  END IF;

  IF p.alignment_id IS NOT NULL THEN
    SELECT * INTO STRICT a FROM public.alignments WHERE id=p.alignment_id FOR SHARE;
    SELECT * INTO STRICT g FROM private.financial_agreements WHERE id=p.financial_agreement_id FOR SHARE;
    IF a.status<>'awaiting_activation_payment' OR g.status<>'current'
      OR ROW(a.movement_need_id,a.movement_offer_id,a.offering_member_id,a.member_needing_movement_id)
      IS DISTINCT FROM ROW(p.movement_need_id,p.movement_offer_id,p.offering_member_id,p.member_needing_movement_id)
      OR ROW(g.alignment_id,g.offering_member_id,g.member_needing_movement_id,g.financial_model_version,
        g.pricing_policy_version,g.platform_fee_allocation_policy_version,g.currency,g.quoted_platform_fee_total_minor,
        g.offering_accepted_at,g.requester_accepted_at)
      IS DISTINCT FROM ROW(p.alignment_id,p.offering_member_id,p.member_needing_movement_id,p.financial_model_version,
        p.pricing_policy_version,p.platform_fee_allocation_policy_version,p.currency,p.quoted_platform_fee_total_minor,
        p.offering_accepted_at,p.requester_accepted_at)
      OR NOT EXISTS (SELECT 1 FROM private.financial_components c
        WHERE c.agreement_id=g.id AND c.component_key='movement_contribution'
          AND c.amount_minor=p.quoted_movement_contribution_minor) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Proposal materialization does not match';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.validate_financial_proposal() FROM PUBLIC,anon,authenticated,service_role;
CREATE CONSTRAINT TRIGGER financial_proposal_complete AFTER INSERT OR UPDATE ON private.financial_proposals
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.validate_financial_proposal();
CREATE CONSTRAINT TRIGGER financial_proposal_roster_complete AFTER INSERT ON private.financial_proposal_travellers
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.validate_financial_proposal();

COMMIT;
