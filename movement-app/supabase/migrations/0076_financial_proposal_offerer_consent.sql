BEGIN;

-- WE DO NOT CREATE JOURNEYS. Consent binds an existing authorized pending offer;
-- it neither reserves capacity nor performs requester consent/materialization.
CREATE FUNCTION public.accept_my_financial_proposal_as_offerer(
  p_financial_proposal_id uuid,
  p_expected_proposal_version integer,
  p_movement_offer_id uuid
)
RETURNS TABLE (proposal_id uuid, proposal_version integer, proposal_status text,
  movement_offer_id uuid, offering_accepted_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $consent$
DECLARE
  caller uuid := auth.uid();
  p private.financial_proposals%ROWTYPE;
  s private.movement_context_snapshots%ROWTYPE;
  accepted_at timestamptz;
BEGIN
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION USING ERRCODE='25000', MESSAGE='Financial proposal consent requires READ COMMITTED';
  END IF;
  IF p_financial_proposal_id IS NULL OR p_expected_proposal_version IS NULL OR p_movement_offer_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22004', MESSAGE='Complete exact proposal and offer identities required';
  END IF;
  IF p_expected_proposal_version<1 THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Positive expected proposal version required';
  END IF;
  IF caller IS NULL OR NOT EXISTS (SELECT 1 FROM public.members m WHERE m.id=caller) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Authenticated member required';
  END IF;
  -- Discover immutable selectors only; reject foreign principals/offers before
  -- locking another movement need. Never lock proposal history first.
  SELECT x.* INTO p FROM private.financial_proposals x WHERE x.id=p_financial_proposal_id;
  IF NOT FOUND OR p.offering_member_id IS DISTINCT FROM caller THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Own financial proposal required';
  END IF;
  IF p.version IS DISTINCT FROM p_expected_proposal_version OR p.status<>'current'
    OR p.expires_at IS NULL OR p.expires_at<=clock_timestamp()
    OR p.requester_accepted_at IS NOT NULL OR p.alignment_id IS NOT NULL
    OR p.financial_agreement_id IS NOT NULL OR p.materialized_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Exact current unmaterialized proposal required';
  END IF;
  SELECT x.* INTO STRICT s FROM private.movement_context_snapshots x WHERE x.id=p.movement_context_snapshot_id;
  IF s.movement_offer_id IS DISTINCT FROM p_movement_offer_id THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Proposal operational offer must equal its historical snapshot source';
  END IF;
  PERFORM private.assert_financial_proposal_quote_binding(p);
  PERFORM private.assert_financial_proposal_movement_context_binding(p);
  PERFORM private.assert_financial_proposal_source_compatibility(p);

  -- Same strong-dependency order as 0074/0045: need UPDATE -> offer UPDATE ->
  -- requester endpoints -> intent UPDATE -> route -> availability UPDATE ->
  -- vehicle/access -> quote SHARE -> snapshot SHARE -> proposal history UPDATE.
  PERFORM private.assert_movement_offer_availability_binding(s.movement_offer_id);
  PERFORM private.assert_pricing_quote(p.pricing_quote_id);
  PERFORM private.assert_movement_context_snapshot_offer_binding(s);
  PERFORM private.assert_movement_context_snapshot(s.id);
  PERFORM x.id FROM private.financial_proposals x
    WHERE x.movement_need_id=p.movement_need_id AND x.offering_member_id=p.offering_member_id
    ORDER BY x.version FOR UPDATE;

  -- READ COMMITTED fresh reads after every possible blocking dependency/history
  -- wait. Existing immutable selectors cannot change; live sources can expire.
  SELECT x.* INTO STRICT p FROM private.financial_proposals x WHERE x.id=p_financial_proposal_id;
  SELECT x.* INTO STRICT s FROM private.movement_context_snapshots x WHERE x.id=p.movement_context_snapshot_id;
  IF p.offering_member_id IS DISTINCT FROM caller OR p.version IS DISTINCT FROM p_expected_proposal_version
    OR p.status<>'current' OR p.expires_at IS NULL OR NOT isfinite(p.expires_at)
    OR p.expires_at<=clock_timestamp() OR p.created_at>clock_timestamp()
    OR p.requester_accepted_at IS NOT NULL OR p.alignment_id IS NOT NULL
    OR p.financial_agreement_id IS NOT NULL OR p.materialized_at IS NOT NULL
    OR s.movement_offer_id IS DISTINCT FROM p_movement_offer_id
    OR (p.movement_offer_id IS NOT NULL AND p.movement_offer_id IS DISTINCT FROM p_movement_offer_id)
    OR (p.offering_accepted_at IS NULL) IS DISTINCT FROM (p.movement_offer_id IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Exact current unmaterialized proposal required';
  END IF;
  PERFORM private.assert_movement_offer_availability_binding(s.movement_offer_id);
  PERFORM private.assert_pricing_quote(p.pricing_quote_id);
  PERFORM private.assert_movement_context_snapshot_offer_binding(s);
  PERFORM private.assert_movement_context_snapshot(s.id);
  PERFORM private.assert_financial_proposal_quote_binding(p);
  PERFORM private.assert_financial_proposal_movement_context_binding(p);
  PERFORM private.assert_financial_proposal_source_compatibility(p);
  PERFORM private.assert_financial_proposal_context(p.id);
  PERFORM private.assert_financial_proposal_snapshot_roster(p.id);
  IF NOT EXISTS (SELECT 1 FROM public.movement_needs n WHERE n.id=p.movement_need_id AND n.status='discoverable')
    OR EXISTS (SELECT 1 FROM public.alignments a WHERE a.movement_need_id=p.movement_need_id
      AND a.status IN ('awaiting_activation_payment','activated','in_progress','completed')) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Unmaterialized proposal requires an available movement need';
  END IF;
  accepted_at:=clock_timestamp();
  IF accepted_at<p.created_at OR accepted_at>=p.expires_at THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Proposal expired before consent';
  END IF;
  IF p.offering_accepted_at IS NOT NULL THEN
    IF NOT isfinite(p.offering_accepted_at) OR p.offering_accepted_at<p.created_at
      OR p.offering_accepted_at>=p.expires_at OR p.offering_accepted_at>accepted_at THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Invalid existing offering consent';
    END IF;
    RETURN QUERY SELECT p.id,p.version,p.status,p.movement_offer_id,p.offering_accepted_at;
    RETURN;
  END IF;

  -- One UPDATE supplies both fields: no intermediate incomplete consent state,
  -- even when the caller already has completeness constraints IMMEDIATE.
  UPDATE private.financial_proposals x
    SET movement_offer_id=p_movement_offer_id, offering_accepted_at=accepted_at
    WHERE x.id=p.id RETURNING x.* INTO p;
  -- Drain only the two parent UPDATE checks, then restore the established
  -- producer convention (INITIALLY DEFERRED). Errors roll back the whole call.
  SET CONSTRAINTS private.financial_proposal_complete,private.financial_proposal_movement_context_complete IMMEDIATE;
  SET CONSTRAINTS private.financial_proposal_complete,private.financial_proposal_movement_context_complete DEFERRED;
  RETURN QUERY SELECT p.id,p.version,p.status,p.movement_offer_id,p.offering_accepted_at;
END;
$consent$;
REVOKE ALL ON FUNCTION public.accept_my_financial_proposal_as_offerer(uuid,integer,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.accept_my_financial_proposal_as_offerer(uuid,integer,uuid) TO authenticated;

-- Narrow need-level cutover: ANY proposal history marks a financially managed
-- need, including expired/superseded history and competing offers/offerers. An
-- exact-offer-only guard would let requester acceptance choose another offer
-- and reject the consented one. No automatic issuance or materialization here.
-- Preserve the reviewed 0045 body by relocation, just as 0049 did for creation.
ALTER FUNCTION public.accept_movement_offer(uuid) SET SCHEMA private;
ALTER FUNCTION private.accept_movement_offer(uuid) RENAME TO accept_movement_offer_legacy_internal;
REVOKE ALL ON FUNCTION private.accept_movement_offer_legacy_internal(uuid)
  FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.accept_movement_offer(p_movement_offer_id uuid)
RETURNS TABLE (alignment_id uuid, alignment_status text, movement_need_id uuid,
  movement_offer_id uuid, created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $cutover$
DECLARE caller uuid := auth.uid(); need_id uuid;
BEGIN
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION USING ERRCODE='25000', MESSAGE='Movement offer acceptance requires READ COMMITTED';
  END IF;
  IF caller IS NULL OR NOT EXISTS (SELECT 1 FROM public.members m WHERE m.id=caller) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Authenticated member required';
  END IF;
  SELECT o.movement_need_id INTO need_id FROM public.movement_offers o WHERE o.id=p_movement_offer_id;
  PERFORM n.id FROM public.movement_needs n WHERE n.id=need_id AND n.member_id=caller FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Own movement need required';
  END IF;
  -- Fresh query AFTER the need wait sees concurrent committed issuance. No
  -- proposal locks here; future financial writers retain the 0074 order.
  IF EXISTS (SELECT 1 FROM private.financial_proposals p WHERE p.movement_need_id=need_id) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Financial proposal sequence requires financial requester materialization';
  END IF;
  RETURN QUERY SELECT * FROM private.accept_movement_offer_legacy_internal(p_movement_offer_id);
END;
$cutover$;
REVOKE ALL ON FUNCTION public.accept_movement_offer(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.accept_movement_offer(uuid) TO authenticated;

COMMIT;
