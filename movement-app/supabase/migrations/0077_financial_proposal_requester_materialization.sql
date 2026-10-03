BEGIN;

-- WE DO NOT CREATE JOURNEYS. This validates persisted historical materialization
-- without requiring its consumed availability or accepted offer to be pending.
CREATE FUNCTION private.assert_financial_proposal_materialization(p private.financial_proposals)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $graph$
DECLARE a public.alignments%ROWTYPE; g private.financial_agreements%ROWTYPE;
BEGIN
  PERFORM private.assert_financial_proposal_quote_binding(p);
  PERFORM private.assert_financial_proposal_movement_context_binding(p);
  PERFORM private.assert_financial_proposal_source_compatibility(p);
  PERFORM private.assert_financial_proposal_snapshot_roster(p.id);
  IF p.offering_accepted_at IS NULL OR p.movement_offer_id IS NULL OR p.requester_accepted_at IS NULL
    OR p.alignment_id IS NULL OR p.financial_agreement_id IS NULL OR p.materialized_at IS NULL
    OR p.created_at IS NULL OR NOT isfinite(p.created_at) OR p.expires_at IS NULL OR NOT isfinite(p.expires_at)
    OR p.expires_at<=p.created_at OR NOT isfinite(p.offering_accepted_at) OR NOT isfinite(p.requester_accepted_at) OR NOT isfinite(p.materialized_at)
    OR p.offering_accepted_at<p.created_at OR p.requester_accepted_at<p.offering_accepted_at
    OR p.requester_accepted_at>=p.expires_at OR p.materialized_at<p.requester_accepted_at
    OR p.materialized_at>=p.expires_at OR p.materialized_at>clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Complete consistent financial materialization required';
  END IF;
  -- Replay owns only proposal UPDATE; it never locks need. Take alignment SHARE before
  -- offer SHARE, matching activation's alignment -> offer dependency; taking
  -- offer UPDATE first on replay could deadlock its journey trigger. First
  -- construction already owns offer UPDATE and its new alignment is private
  -- to this transaction. Replay never upgrades locks into live pending checks.
  SELECT x.* INTO a FROM public.alignments x WHERE x.id=p.alignment_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Materialized alignment unavailable';
  END IF;
  PERFORM x.id FROM public.movement_offers x WHERE x.id=p.movement_offer_id FOR SHARE;
  SELECT x.* INTO g FROM private.financial_agreements x WHERE x.id=p.financial_agreement_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Materialized financial agreement unavailable';
  END IF;
  -- Replay validates historical identity; operational lifecycle and legacy fee
  -- may progress after acceptance. 0019 also permits no-travel cancellation.
  IF a.status NOT IN ('awaiting_activation_payment','activated','in_progress','completed','cancelled')
    OR a.activation_currency<>p.currency
    OR ROW(a.movement_need_id,a.movement_offer_id,a.offering_member_id,a.member_needing_movement_id)
      IS DISTINCT FROM ROW(p.movement_need_id,p.movement_offer_id,p.offering_member_id,p.member_needing_movement_id)
    -- 0020 permits consent-preserving supersession; validate the exact original
    -- agreement, not whichever version is current later.
    OR g.status NOT IN ('current','superseded') OR g.version<>1
    OR ROW(g.alignment_id,g.offering_member_id,g.member_needing_movement_id,g.financial_model_version,
      g.pricing_policy_version,g.platform_fee_allocation_policy_version,g.currency,g.quoted_platform_fee_total_minor,
      g.offering_accepted_at,g.requester_accepted_at)
      IS DISTINCT FROM ROW(p.alignment_id,p.offering_member_id,p.member_needing_movement_id,p.financial_model_version,
      p.pricing_policy_version,p.platform_fee_allocation_policy_version,p.currency,p.quoted_platform_fee_total_minor,
      p.offering_accepted_at,p.requester_accepted_at)
    OR NOT EXISTS (SELECT 1 FROM public.movement_needs n WHERE n.id=p.movement_need_id
      AND n.member_id=p.member_needing_movement_id AND n.status='closed')
    OR NOT EXISTS (SELECT 1 FROM public.movement_offers o WHERE o.id=p.movement_offer_id AND o.status='accepted')
    OR EXISTS (SELECT 1 FROM public.alignments x WHERE x.movement_need_id=p.movement_need_id
      AND x.id<>p.alignment_id AND x.status IN ('awaiting_activation_payment','activated','in_progress','completed'))
    OR (SELECT count(*) FROM private.financial_components c WHERE c.agreement_id=g.id)<>3
    OR EXISTS (SELECT 1 FROM public.movement_offers o WHERE o.movement_need_id=p.movement_need_id AND o.status='pending')
    OR EXISTS (
      SELECT component_key,amount_minor,responsible_member_id,beneficiary_kind,beneficiary_member_id
      FROM private.financial_components c WHERE c.agreement_id=g.id
      EXCEPT
      SELECT * FROM (VALUES
        ('offering_platform_share'::text,p.quoted_platform_fee_total_minor/2,p.offering_member_id,'platform'::text,NULL::uuid),
        ('requester_platform_share'::text,p.quoted_platform_fee_total_minor-p.quoted_platform_fee_total_minor/2,p.member_needing_movement_id,'platform'::text,NULL::uuid),
        ('movement_contribution'::text,p.quoted_movement_contribution_minor,p.member_needing_movement_id,'member'::text,p.offering_member_id)
      ) expected
    ) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Financial materialization graph does not match proposal';
  END IF;
  -- Return status from the same SHARE-locked row whose graph was validated.
  RETURN a.status;
END;
$graph$;
REVOKE ALL ON FUNCTION private.assert_financial_proposal_materialization(private.financial_proposals)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.accept_my_financial_proposal_as_requester(
  p_financial_proposal_id uuid,
  p_expected_proposal_version integer
)
RETURNS TABLE (proposal_id uuid,proposal_version integer,proposal_status text,movement_offer_id uuid,
  alignment_id uuid,alignment_status text,financial_agreement_id uuid,
  requester_accepted_at timestamptz,materialized_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $materialize$
DECLARE caller uuid:=auth.uid(); p private.financial_proposals%ROWTYPE;
  s private.movement_context_snapshots%ROWTYPE; n public.movement_needs%ROWTYPE;
  operational record; replay_alignment_status text; created_agreement_id uuid; agreement_version bigint; accepted_at timestamptz; completed_at timestamptz;
BEGIN
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION USING ERRCODE='25000', MESSAGE='Financial materialization requires READ COMMITTED';
  END IF;
  IF p_financial_proposal_id IS NULL OR p_expected_proposal_version IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22004', MESSAGE='Exact proposal identity and version required';
  END IF;
  IF p_expected_proposal_version<1 THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Positive expected proposal version required';
  END IF;
  IF caller IS NULL OR NOT EXISTS (SELECT 1 FROM public.members m WHERE m.id=caller) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Authenticated member required';
  END IF;
  -- Immutable discovery only; no history/FK locks before the need boundary.
  SELECT x.* INTO p FROM private.financial_proposals x WHERE x.id=p_financial_proposal_id;
  IF NOT FOUND OR p.member_needing_movement_id IS DISTINCT FROM caller THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Own requester financial proposal required';
  END IF;
  PERFORM private.assert_financial_proposal_quote_binding(p);
  PERFORM private.assert_financial_proposal_movement_context_binding(p);
  PERFORM private.assert_financial_proposal_source_compatibility(p);
  SELECT x.* INTO STRICT s FROM private.movement_context_snapshots x WHERE x.id=p.movement_context_snapshot_id;
  -- Isolate construction locks. If another requester finishes while our need
  -- lock waits, roll this subtransaction back before entering historical replay.
  -- Payment/face readiness locks alignment BEFORE need; retaining construction's
  -- need lock while waiting for that alignment would create a reverse-order cycle.
  BEGIN
  IF p.requester_accepted_at IS NOT NULL OR p.alignment_id IS NOT NULL
    OR p.financial_agreement_id IS NOT NULL OR p.materialized_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE='Z7701', MESSAGE='Switch to materialization replay';
  END IF;
  SELECT x.* INTO STRICT n FROM public.movement_needs x WHERE x.id=p.movement_need_id FOR UPDATE;
  IF n.member_id IS DISTINCT FROM caller THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Authoritative movement requester required';
  END IF;
  -- A concurrent duplicate can have completed while the need lock waited.
  -- Fresh-read BEFORE pending-offer/availability assertions: replay must not
  -- reserve capacity again or validate consumed support as a pending offer.
  SELECT x.* INTO STRICT p FROM private.financial_proposals x WHERE x.id=p_financial_proposal_id;
  IF p.requester_accepted_at IS NOT NULL OR p.alignment_id IS NOT NULL
    OR p.financial_agreement_id IS NOT NULL OR p.materialized_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE='Z7701', MESSAGE='Switch to materialization replay';
  END IF;
  IF p.member_needing_movement_id IS DISTINCT FROM caller OR p.version IS DISTINCT FROM p_expected_proposal_version
    OR p.status<>'current' OR p.expires_at IS NULL OR NOT isfinite(p.expires_at)
    OR p.expires_at<=clock_timestamp() OR p.created_at>clock_timestamp()
    OR p.offering_accepted_at IS NULL OR p.movement_offer_id IS NULL
    OR p.movement_offer_id IS DISTINCT FROM s.movement_offer_id THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Exact current offerer-consented proposal required';
  END IF;


  IF n.status<>'discoverable' OR EXISTS (SELECT 1 FROM public.alignments a
    WHERE a.movement_need_id=n.id AND a.status IN ('awaiting_activation_payment','activated','in_progress','completed')) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Unmaterialized proposal requires an available movement need';
  END IF;
  PERFORM x.id FROM public.movement_offers x WHERE x.id=s.movement_offer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Exact movement offer unavailable';
  END IF;

  -- Same canonical strong dependencies as 0074/0076 before proposal history:
  -- need UPDATE -> offer UPDATE -> endpoints -> intent UPDATE -> route ->
  -- availability UPDATE -> vehicle/access -> quote SHARE -> snapshot SHARE.
  PERFORM private.assert_movement_offer_availability_binding(s.movement_offer_id);
  PERFORM private.assert_pricing_quote(p.pricing_quote_id);
  PERFORM private.assert_movement_context_snapshot_offer_binding(s);
  PERFORM private.assert_movement_context_snapshot(s.id);
  PERFORM x.id FROM private.financial_proposals x
    WHERE x.movement_need_id=p.movement_need_id AND x.offering_member_id=p.offering_member_id
    ORDER BY x.version FOR UPDATE;
  SELECT x.* INTO STRICT p FROM private.financial_proposals x WHERE x.id=p_financial_proposal_id;
  SELECT x.* INTO STRICT s FROM private.movement_context_snapshots x WHERE x.id=p.movement_context_snapshot_id;
  SELECT x.* INTO STRICT n FROM public.movement_needs x WHERE x.id=p.movement_need_id;
  IF p.version IS DISTINCT FROM p_expected_proposal_version OR p.status<>'current'
    OR p.member_needing_movement_id IS DISTINCT FROM caller OR n.member_id IS DISTINCT FROM caller
    OR p.expires_at<=clock_timestamp() OR p.created_at>clock_timestamp()
    OR p.offering_accepted_at IS NULL OR NOT isfinite(p.offering_accepted_at)
    OR p.offering_accepted_at<p.created_at OR p.offering_accepted_at>clock_timestamp()
    OR p.offering_accepted_at>=p.expires_at OR p.movement_offer_id IS DISTINCT FROM s.movement_offer_id
    OR p.requester_accepted_at IS NOT NULL OR p.alignment_id IS NOT NULL
    OR p.financial_agreement_id IS NOT NULL OR p.materialized_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Exact unmaterialized offerer-consented proposal required';
  END IF;
  PERFORM private.assert_movement_offer_availability_binding(p.movement_offer_id);
  PERFORM private.assert_pricing_quote(p.pricing_quote_id);
  PERFORM private.assert_movement_context_snapshot_offer_binding(s);
  PERFORM private.assert_movement_context_snapshot(s.id);
  PERFORM private.assert_financial_proposal_quote_binding(p);
  PERFORM private.assert_financial_proposal_movement_context_binding(p);
  PERFORM private.assert_financial_proposal_source_compatibility(p);
  PERFORM private.assert_financial_proposal_context(p.id);
  PERFORM private.assert_financial_proposal_snapshot_roster(p.id);
  accepted_at:=clock_timestamp();
  IF accepted_at<p.offering_accepted_at OR accepted_at>=p.expires_at THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Proposal expired before requester acceptance';
  END IF;
  -- If trusted snapshot construction happened earlier in this transaction,
  -- drain its INSERT checks while the offer/need are still pending/available.
  -- Those construction-only validators cannot be deferred past consumption.
  SET CONSTRAINTS private.movement_context_snapshot_complete,private.movement_context_travellers_complete IMMEDIATE;
  SET CONSTRAINTS private.movement_context_snapshot_complete,private.movement_context_travellers_complete DEFERRED;

  -- Reuse 0045 exactly, under already-owned stronger dependencies/history.
  -- It asserts live eligibility again and atomically consumes people_count,
  -- creates the pre-payment alignment, accepts/closes/rejects operational rows.
  -- No proposal row is written until the complete financial graph exists.
  SELECT x.* INTO STRICT operational FROM private.accept_movement_offer_legacy_internal(p.movement_offer_id) x;
  IF operational.movement_offer_id IS DISTINCT FROM p.movement_offer_id
    OR operational.movement_need_id IS DISTINCT FROM p.movement_need_id
    OR operational.alignment_status IS DISTINCT FROM 'awaiting_activation_payment' THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Operational materialization identity mismatch';
  END IF;
  -- Construction alone must prove the exact initial legacy alignment shape.
  PERFORM x.id FROM public.alignments x WHERE x.id=operational.alignment_id
    AND x.status='awaiting_activation_payment' AND x.activated_at IS NULL
    AND x.activation_fee_minor IS NULL AND x.activation_currency='NGN'
    AND ROW(x.movement_need_id,x.movement_offer_id,x.offering_member_id,x.member_needing_movement_id)
      IS NOT DISTINCT FROM ROW(p.movement_need_id,p.movement_offer_id,p.offering_member_id,p.member_needing_movement_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Exact initial pre-payment alignment required';
  END IF;
  -- New alignment is transaction-owned, with no prior agreement history. The
  -- 0020 history scope is alignment_id, NOT proposal history's version scope.
  SELECT coalesce(max(x.version)::bigint,0)+1 INTO agreement_version
    FROM private.financial_agreements x WHERE x.alignment_id=operational.alignment_id;
  IF agreement_version<>1 THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='New alignment must have empty agreement history';
  END IF;
  SET CONSTRAINTS private.financial_agreement_complete,private.financial_components_complete DEFERRED;
  INSERT INTO private.financial_agreements(alignment_id,offering_member_id,member_needing_movement_id,version,
    financial_model_version,pricing_policy_version,platform_fee_allocation_policy_version,currency,
    quoted_platform_fee_total_minor,created_at,status)
  VALUES(operational.alignment_id,p.offering_member_id,p.member_needing_movement_id,agreement_version::integer,
    p.financial_model_version,p.pricing_policy_version,p.platform_fee_allocation_policy_version,p.currency,
    p.quoted_platform_fee_total_minor,clock_timestamp(),'current') RETURNING id INTO created_agreement_id;
  INSERT INTO private.financial_components(agreement_id,component_key,amount_minor,responsible_member_id,
    beneficiary_kind,beneficiary_member_id,created_at) VALUES
    (created_agreement_id,'offering_platform_share',p.quoted_platform_fee_total_minor/2,p.offering_member_id,'platform',NULL,clock_timestamp()),
    (created_agreement_id,'requester_platform_share',p.quoted_platform_fee_total_minor-p.quoted_platform_fee_total_minor/2,p.member_needing_movement_id,'platform',NULL,clock_timestamp()),
    (created_agreement_id,'movement_contribution',p.quoted_movement_contribution_minor,p.member_needing_movement_id,'member',p.offering_member_id,clock_timestamp());
  UPDATE private.financial_agreements x SET offering_accepted_at=p.offering_accepted_at,requester_accepted_at=accepted_at
    WHERE x.id=created_agreement_id;
  completed_at:=clock_timestamp();
  IF completed_at<accepted_at OR completed_at>=p.expires_at THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Proposal expired during materialization';
  END IF;
  UPDATE private.financial_proposals x SET requester_accepted_at=accepted_at,alignment_id=operational.alignment_id,
    financial_agreement_id=created_agreement_id,materialized_at=completed_at WHERE x.id=p.id RETURNING x.* INTO p;
  PERFORM private.assert_financial_proposal_materialization(p);
  SET CONSTRAINTS private.financial_agreement_complete,private.financial_components_complete,
    private.financial_proposal_complete,private.financial_proposal_movement_context_complete IMMEDIATE;
  SET CONSTRAINTS private.financial_agreement_complete,private.financial_components_complete,
    private.financial_proposal_complete,private.financial_proposal_movement_context_complete DEFERRED;
  RETURN QUERY SELECT p.id,p.version,p.status,p.movement_offer_id,p.alignment_id,
    operational.alignment_status,p.financial_agreement_id,p.requester_accepted_at,p.materialized_at;
  RETURN;
  EXCEPTION WHEN SQLSTATE 'Z7701' THEN
    -- Rollback releases ONLY locks acquired in this construction subtransaction.
    -- No write has happened on either switch path, and all other errors propagate.
    NULL;
  END;

  -- Persisted graph replay: no live need/intent/availability/quote locks and no
  -- mutations. Never upgrade historical locks back into construction support.
  -- Original expiry bounds recorded consent/materialization, not historical reads.
  -- 0021 makes materialized proposals immutable, including their current status.
  SELECT x.* INTO STRICT p FROM private.financial_proposals x WHERE x.id=p_financial_proposal_id FOR UPDATE;
  IF p.member_needing_movement_id IS DISTINCT FROM caller OR p.version IS DISTINCT FROM p_expected_proposal_version
    OR p.status<>'current' OR p.expires_at IS NULL OR NOT isfinite(p.expires_at)
    OR p.created_at>clock_timestamp()
    OR NOT EXISTS(SELECT 1 FROM public.movement_needs replay_need WHERE replay_need.id=p.movement_need_id AND replay_need.member_id=caller) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Own exact materialized proposal required';
  END IF;
  replay_alignment_status:=private.assert_financial_proposal_materialization(p);
  RETURN QUERY SELECT p.id,p.version,p.status,p.movement_offer_id,p.alignment_id,
    replay_alignment_status,p.financial_agreement_id,p.requester_accepted_at,p.materialized_at;
END;
$materialize$;
REVOKE ALL ON FUNCTION public.accept_my_financial_proposal_as_requester(uuid,integer)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.accept_my_financial_proposal_as_requester(uuid,integer) TO authenticated;

COMMIT;
