BEGIN;

-- One opening is the entire active state. Resolution is deliberately absent.
CREATE TABLE private.funded_movement_disputes (
 alignment_id uuid PRIMARY KEY REFERENCES private.funded_movement_activations(alignment_id),
 financial_agreement_id uuid NOT NULL UNIQUE REFERENCES private.movement_funding_holds(financial_agreement_id),
 journey_id uuid NOT NULL UNIQUE REFERENCES public.journeys(id),
 opened_by_member_id uuid NOT NULL REFERENCES public.members(id),
 opened_at timestamptz NOT NULL CHECK(isfinite(opened_at)),
 reason_category text NOT NULL CHECK(reason_category IN ('unable_to_agree','movement_concern'))
);
ALTER TABLE private.funded_movement_disputes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.funded_movement_disputes FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER protect_funded_movement_disputes BEFORE UPDATE OR DELETE OR TRUNCATE ON private.funded_movement_disputes
 FOR EACH STATEMENT EXECUTE FUNCTION private.protect_wallet_ledger_row();

-- Scoped copy of 0085's exact graph checks. No historical function is replaced.
-- Dispute intake admits only undisposed pre-start evidence; independent server
-- observations are finite metadata, not causal ordering or later-clock limits.
CREATE FUNCTION private.assert_undisposed_funded_graph(p_alignment uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $no_travel_graph$
DECLARE a public.alignments%ROWTYPE; j public.journeys%ROWTYPE; g private.financial_agreements%ROWTYPE;
 e private.funded_movement_coordination_entries%ROWTYPE; r private.funded_no_travel_requests%ROWTYPE;
 d private.funded_no_travel_closures%ROWTYPE; c private.financial_components%ROWTYPE;
 t private.wallet_transactions%ROWTYPE; sr private.funded_movement_start_requests%ROWTYPE;
 mp private.journey_meeting_points%ROWTYPE; available_id uuid; held_id uuid; n bigint; matches bigint;
BEGIN
 SELECT x.* INTO STRICT a FROM public.alignments x WHERE x.id=p_alignment;
 IF EXISTS(SELECT 1 FROM private.funded_no_travel_closures WHERE alignment_id=a.id) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Undisposed pre-start graph required'; END IF;
 SELECT x.* INTO STRICT e FROM private.funded_movement_coordination_entries x WHERE x.alignment_id=a.id;
 SELECT x.* INTO STRICT j FROM public.journeys x WHERE x.id=e.journey_id;
 SELECT x.* INTO STRICT g FROM private.financial_agreements x WHERE x.id=e.financial_agreement_id;
 g:=private.movement_funding_agreement(g.id,g.member_needing_movement_id,g.version);
 PERFORM private.assert_funded_activation(g,a);
 -- Reuse 0083's complete absence/partial-settlement proof, including component
 -- keys whose transaction alignment was forged or belongs to another graph.
 PERFORM private.assert_funded_completion(a.id);
 SELECT x.* INTO d FROM private.funded_no_travel_closures x WHERE x.alignment_id=a.id;
 IF j.alignment_id IS DISTINCT FROM a.id OR g.alignment_id IS DISTINCT FROM a.id
  OR (SELECT count(*) FROM public.journeys WHERE alignment_id=a.id)<>1
  OR j.vehicle_id IS DISTINCT FROM (SELECT vehicle_id FROM public.movement_offers WHERE id=a.movement_offer_id)
  OR j.created_at IS DISTINCT FROM e.created_at OR NOT isfinite(e.created_at)
  OR j.started_at IS NOT NULL OR j.completed_at IS NOT NULL OR j.completion_requested_at IS NOT NULL
  OR j.end_requested_by_member_id IS NOT NULL OR j.end_requested_at IS NOT NULL
  OR j.end_confirmed_by_member_id IS NOT NULL OR j.end_confirmed_at IS NOT NULL OR j.end_method IS NOT NULL OR j.end_reason IS NOT NULL
  OR EXISTS(SELECT 1 FROM private.funded_movement_starts WHERE alignment_id=a.id OR journey_id=j.id)
  OR EXISTS(SELECT 1 FROM private.funded_movement_completion_requests WHERE alignment_id=a.id OR journey_id=j.id)
  OR EXISTS(SELECT 1 FROM private.funded_movement_completions WHERE alignment_id=a.id OR journey_id=j.id)
  OR EXISTS(SELECT 1 FROM private.completed_movement_principals WHERE alignment_id=a.id)
  OR EXISTS(SELECT 1 FROM private.completed_movement_ratings WHERE alignment_id=a.id)
  OR EXISTS(SELECT 1 FROM private.movement_settlements WHERE alignment_id=a.id OR journey_id=j.id)
  OR EXISTS(SELECT 1 FROM private.mutual_no_travel_closures WHERE journey_id=j.id)
  OR EXISTS(SELECT 1 FROM private.wallet_transactions WHERE alignment_id=a.id
    AND transaction_kind IN ('requester_platform_charge','offering_platform_charge','movement_contribution_settlement')) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact unstarted funded lifecycle required'; END IF;
 SELECT x.* INTO sr FROM private.funded_movement_start_requests x WHERE x.alignment_id=a.id;
 IF sr.alignment_id IS NULL THEN
  IF j.start_requested_at IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact pending start required'; END IF;
 ELSE
  SELECT x.* INTO mp FROM private.journey_meeting_points x WHERE x.journey_id=j.id;
  IF sr.journey_id IS DISTINCT FROM j.id OR sr.requested_at IS DISTINCT FROM j.start_requested_at
   OR NOT isfinite(sr.requested_at)
   OR mp.journey_id IS NULL OR mp.revision IS DISTINCT FROM sr.meeting_point_revision
   OR mp.place_text<>btrim(mp.place_text) OR length(mp.place_text) NOT BETWEEN 1 AND 200 OR mp.place_text !~ '[^[:space:]]' THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact frozen pending start required'; END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM private.funded_no_travel_requests q WHERE q.alignment_id=a.id AND
  (q.financial_agreement_id IS DISTINCT FROM g.id OR q.journey_id IS DISTINCT FROM j.id
   OR q.first_principal_id NOT IN (a.offering_member_id,a.member_needing_movement_id)
   OR NOT isfinite(q.requested_at)))
  OR EXISTS(SELECT 1 FROM private.funded_no_travel_declines z JOIN private.funded_no_travel_requests q ON q.id=z.request_id
   WHERE q.alignment_id=a.id AND (z.second_principal_id=q.first_principal_id
    OR z.second_principal_id NOT IN(a.offering_member_id,a.member_needing_movement_id)
    OR NOT isfinite(z.declined_at)))
  OR (SELECT count(*) FROM private.funded_no_travel_requests q WHERE q.alignment_id=a.id
   AND NOT EXISTS(SELECT 1 FROM private.funded_no_travel_declines z WHERE z.request_id=q.id))>1 THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact principal intent history required'; END IF;
 IF d.alignment_id IS NULL THEN
  IF a.status<>'activated' OR j.status<>'not_started' THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact pre-start lifecycle required'; END IF;
 ELSE
  SELECT x.* INTO STRICT r FROM private.funded_no_travel_requests x WHERE x.id=d.request_id;
  IF d.financial_agreement_id IS DISTINCT FROM g.id OR d.journey_id IS DISTINCT FROM j.id
   OR r.alignment_id IS DISTINCT FROM a.id OR d.first_principal_id IS DISTINCT FROM r.first_principal_id
   OR d.second_principal_id NOT IN(a.offering_member_id,a.member_needing_movement_id)
   OR d.requested_at IS DISTINCT FROM r.requested_at OR NOT isfinite(d.released_at)
   OR d.pending_start_requested_at IS DISTINCT FROM j.start_requested_at
   OR EXISTS(SELECT 1 FROM private.funded_no_travel_declines WHERE request_id=r.id)
   OR a.status<>'cancelled' OR j.status<>'cancelled' THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Complete exact funded disposition required'; END IF;
 END IF;
 SELECT id INTO STRICT available_id FROM private.wallet_accounts WHERE member_id=g.member_needing_movement_id AND currency=g.currency AND account_kind='member_available';
 SELECT id INTO STRICT held_id FROM private.wallet_accounts WHERE member_id=g.member_needing_movement_id AND currency=g.currency AND account_kind='member_held';
 FOR c IN SELECT * FROM private.financial_components WHERE agreement_id=g.id ORDER BY id LOOP
  SELECT x.* INTO t FROM private.wallet_transactions x WHERE x.idempotency_key='movement_hold_release:'||c.id::text;
  SELECT count(*) INTO n FROM private.wallet_transactions WHERE financial_component_id=c.id AND transaction_kind='movement_hold_release';
  IF d.alignment_id IS NULL OR c.amount_minor=0 OR c.component_key='offering_platform_share' THEN
   IF t.id IS NOT NULL OR n<>0 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Partial or zero release forbidden'; END IF;
   CONTINUE;
  END IF;
  IF n<>1 OR t.id IS NULL OR t.transaction_kind IS DISTINCT FROM 'movement_hold_release'
   OR t.financial_component_id IS DISTINCT FROM c.id OR t.alignment_id IS DISTINCT FROM a.id OR t.currency IS DISTINCT FROM g.currency
   OR t.provider IS NOT NULL OR t.provider_reference IS NOT NULL OR t.created_at IS DISTINCT FROM d.released_at THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact release transaction required'; END IF;
  SELECT count(*),count(*) FILTER(WHERE amount_minor=c.amount_minor AND created_at=d.released_at
   AND ((account_id=held_id AND direction='debit') OR (account_id=available_id AND direction='credit')))
   INTO n,matches FROM private.wallet_postings WHERE transaction_id=t.id;
  IF n<>2 OR matches<>2 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact release postings required'; END IF;
  PERFORM private.assert_wallet_transaction_balanced(t.id);
 END LOOP;
 IF EXISTS(SELECT 1 FROM private.wallet_transactions wx WHERE wx.alignment_id=a.id AND wx.transaction_kind='movement_hold_release'
  AND NOT EXISTS(SELECT 1 FROM private.financial_components fc WHERE fc.id=wx.financial_component_id AND fc.agreement_id=g.id)) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Competing release history forbidden'; END IF;
END;
$no_travel_graph$;

CREATE FUNCTION private.funded_dispute_alignment(p_need uuid)
RETURNS public.alignments LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.alignments%ROWTYPE; g private.financial_agreements%ROWTYPE;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION USING ERRCODE='25000',MESSAGE='READ COMMITTED required'; END IF;
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.members WHERE id=auth.uid())
  OR p_need IS NULL OR (SELECT count(*) FROM public.alignments WHERE movement_need_id=p_need)<>1 THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Movement end unavailable'; END IF;
 SELECT * INTO STRICT a FROM public.alignments WHERE movement_need_id=p_need;
 IF auth.uid() NOT IN(a.offering_member_id,a.member_needing_movement_id) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Movement end unavailable'; END IF;
 SELECT x.* INTO STRICT g FROM private.financial_agreements x JOIN private.funded_movement_activations f ON f.financial_agreement_id=x.id WHERE f.alignment_id=a.id;
 PERFORM x.id FROM private.financial_agreements x WHERE x.id=g.id FOR SHARE;
 SELECT * INTO STRICT a FROM public.alignments WHERE id=g.alignment_id FOR UPDATE;
 IF a.movement_need_id IS DISTINCT FROM p_need OR auth.uid() NOT IN(a.offering_member_id,a.member_needing_movement_id) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Movement end unavailable'; END IF;
 -- materialization assertion takes the compatible offer SHARE before journey.
 g:=private.movement_funding_agreement(g.id,g.member_needing_movement_id,g.version);
 PERFORM x.id FROM public.journeys x WHERE x.alignment_id=a.id FOR UPDATE;
 PERFORM private.assert_undisposed_funded_graph(a.id);
 RETURN a;
END;
$$;

CREATE FUNCTION private.assert_funded_dispute(p_alignment uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d private.funded_movement_disputes%ROWTYPE; a public.alignments%ROWTYPE;
 e private.funded_movement_coordination_entries%ROWTYPE;
BEGIN
 SELECT * INTO d FROM private.funded_movement_disputes WHERE alignment_id=p_alignment;
 IF d.alignment_id IS NULL THEN RETURN; END IF;
 SELECT * INTO STRICT a FROM public.alignments WHERE id=p_alignment;
 SELECT * INTO STRICT e FROM private.funded_movement_coordination_entries WHERE alignment_id=a.id;
 -- 0085 already proves the complete held graph, including absent/partial
 -- release and settlement evidence and exact optional pending start history.
 PERFORM private.assert_undisposed_funded_graph(a.id);
 IF d.financial_agreement_id IS DISTINCT FROM e.financial_agreement_id
  OR d.journey_id IS DISTINCT FROM e.journey_id
  OR d.opened_by_member_id NOT IN(a.offering_member_id,a.member_needing_movement_id)
  -- Server-observed metadata is finite, never a cross-sample ordering proof.
  OR NOT isfinite(d.opened_at)
  OR a.status<>'activated'
  OR EXISTS(SELECT 1 FROM private.funded_no_travel_closures WHERE alignment_id=a.id) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact frozen funded graph required'; END IF;
END;
$$;

CREATE FUNCTION private.require_funded_dispute_actor()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.alignments%ROWTYPE; e private.funded_movement_coordination_entries%ROWTYPE;
BEGIN
 SELECT * INTO STRICT a FROM public.alignments WHERE id=NEW.alignment_id;
 a:=private.funded_dispute_alignment(a.movement_need_id);
 PERFORM m.id FROM public.members m WHERE m.id IN(a.offering_member_id,a.member_needing_movement_id) ORDER BY m.id FOR UPDATE;
 SELECT * INTO STRICT e FROM private.funded_movement_coordination_entries WHERE alignment_id=a.id;
 IF a.status<>'activated' OR NEW.opened_by_member_id IS DISTINCT FROM auth.uid()
  OR NEW.financial_agreement_id IS DISTINCT FROM e.financial_agreement_id
  OR NEW.journey_id IS DISTINCT FROM e.journey_id
  OR NOT isfinite(NEW.opened_at)
  OR EXISTS(SELECT 1 FROM private.funded_no_travel_closures WHERE alignment_id=a.id) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact authenticated pre-start dispute required'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER require_funded_dispute_actor BEFORE INSERT ON private.funded_movement_disputes
 FOR EACH ROW EXECUTE FUNCTION private.require_funded_dispute_actor();

-- Add gates to decisive evidence, preserving every existing producer and its
-- economics. Parent locks serialize the check with opening even for trusted
-- direct writers. No wallet-account lock is acquired here.
CREATE FUNCTION private.reject_disputed_funded_progress()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE selected uuid; g private.financial_agreements%ROWTYPE;
BEGIN
 selected:=NEW.alignment_id;
 IF TG_TABLE_NAME='wallet_transactions' THEN
  IF NEW.transaction_kind NOT IN('movement_hold_release','requester_platform_charge','offering_platform_charge','movement_contribution_settlement') THEN RETURN NEW; END IF;
  IF NEW.financial_component_id IS NOT NULL THEN
   SELECT x.* INTO g FROM private.financial_agreements x JOIN private.financial_components c ON c.agreement_id=x.id WHERE c.id=NEW.financial_component_id;
   selected:=g.alignment_id;
  END IF;
 END IF;
 IF selected IS NULL THEN RETURN NEW; END IF;
 SELECT x.* INTO g FROM private.financial_agreements x JOIN private.funded_movement_activations f ON f.financial_agreement_id=x.id WHERE f.alignment_id=selected;
 IF g.id IS NULL THEN RETURN NEW; END IF;
 PERFORM id FROM private.financial_agreements WHERE id=g.id FOR SHARE;
 PERFORM id FROM public.alignments WHERE id=selected FOR UPDATE;
 IF EXISTS(SELECT 1 FROM private.funded_movement_disputes WHERE alignment_id=selected) THEN
  PERFORM private.assert_funded_dispute(selected);
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Funded movement is under review'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER dispute_blocks_start BEFORE INSERT ON private.funded_movement_starts
 FOR EACH ROW EXECUTE FUNCTION private.reject_disputed_funded_progress();
CREATE TRIGGER dispute_blocks_no_travel_closure BEFORE INSERT ON private.funded_no_travel_closures
 FOR EACH ROW EXECUTE FUNCTION private.reject_disputed_funded_progress();
CREATE TRIGGER dispute_blocks_completion_request BEFORE INSERT ON private.funded_movement_completion_requests
 FOR EACH ROW EXECUTE FUNCTION private.reject_disputed_funded_progress();
CREATE TRIGGER dispute_blocks_completion BEFORE INSERT ON private.funded_movement_completions
 FOR EACH ROW EXECUTE FUNCTION private.reject_disputed_funded_progress();
CREATE TRIGGER dispute_blocks_financial_disposition BEFORE INSERT ON private.wallet_transactions
 FOR EACH ROW EXECUTE FUNCTION private.reject_disputed_funded_progress();

CREATE FUNCTION private.validate_funded_dispute_graph()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_TABLE_NAME='alignments' THEN
  PERFORM private.assert_funded_dispute(NEW.id);
 ELSE
  PERFORM private.assert_funded_dispute(NEW.alignment_id);
 END IF;
 RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER funded_dispute_complete AFTER INSERT ON private.funded_movement_disputes
 DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION private.validate_funded_dispute_graph();
CREATE CONSTRAINT TRIGGER funded_dispute_journey_frozen AFTER UPDATE ON public.journeys
 DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION private.validate_funded_dispute_graph();
CREATE CONSTRAINT TRIGGER funded_dispute_alignment_frozen AFTER UPDATE ON public.alignments
 DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION private.validate_funded_dispute_graph();

CREATE FUNCTION public.get_my_funded_movement_dispute_status(p_movement_need_id uuid)
RETURNS TABLE(dispute_active boolean,can_open boolean,opened_by_me boolean,opened_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.alignments%ROWTYPE; j public.journeys%ROWTYPE; d private.funded_movement_disputes%ROWTYPE;
BEGIN
 IF EXISTS(SELECT 1 FROM private.funded_movement_disputes receipt JOIN public.alignments x ON x.id=receipt.alignment_id WHERE x.movement_need_id=p_movement_need_id) THEN
  a:=private.funded_dispute_alignment(p_movement_need_id);
  SELECT * INTO STRICT j FROM public.journeys WHERE alignment_id=a.id;
 ELSE
 -- Terminal mutual no-travel is readable through its exact historical selector.
 IF EXISTS(SELECT 1 FROM public.alignments WHERE movement_need_id=p_movement_need_id AND status='cancelled') THEN
  a:=private.funded_no_travel_alignment(p_movement_need_id);
 ELSE
  a:=private.funded_coordination_alignment(p_movement_need_id);
  PERFORM id FROM public.journeys WHERE alignment_id=a.id FOR UPDATE;
 END IF;
 j:=private.assert_funded_coordination_entry(a.id);
 END IF;
 PERFORM private.assert_funded_dispute(a.id);
 SELECT * INTO d FROM private.funded_movement_disputes WHERE alignment_id=a.id;
 RETURN QUERY SELECT d.alignment_id IS NOT NULL,
  d.alignment_id IS NULL AND a.status='activated' AND j.status='not_started',
  coalesce(d.opened_by_member_id=auth.uid(),false),d.opened_at;
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Movement review unavailable';
END;
$$;

CREATE FUNCTION public.open_my_funded_movement_dispute(p_movement_need_id uuid,p_reason_category text)
RETURNS TABLE(dispute_active boolean,can_open boolean,opened_by_me boolean,opened_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.alignments%ROWTYPE; d private.funded_movement_disputes%ROWTYPE;
BEGIN
 IF p_reason_category IS NULL OR p_reason_category NOT IN('unable_to_agree','movement_concern') THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Bounded dispute category required'; END IF;
 a:=private.funded_dispute_alignment(p_movement_need_id);
 PERFORM m.id FROM public.members m WHERE m.id IN(a.offering_member_id,a.member_needing_movement_id) ORDER BY m.id FOR UPDATE;
 PERFORM private.assert_funded_dispute(a.id);
 SELECT * INTO d FROM private.funded_movement_disputes WHERE alignment_id=a.id;
 IF d.alignment_id IS NOT NULL THEN
  IF d.opened_by_member_id IS DISTINCT FROM auth.uid() OR d.reason_category IS DISTINCT FROM p_reason_category THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Conflicting dispute opening'; END IF;
 ELSE
  IF a.status<>'activated' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Pre-start dispute required'; END IF;
  INSERT INTO private.funded_movement_disputes
   -- Observe once after construction locks. Provenance/state establish causality;
   -- this sample may equal or precede earlier server timestamps (0082).
   SELECT a.id,e.financial_agreement_id,e.journey_id,auth.uid(),clock_timestamp(),p_reason_category
   FROM private.funded_movement_coordination_entries e WHERE e.alignment_id=a.id;
 END IF;
 RETURN QUERY SELECT * FROM public.get_my_funded_movement_dispute_status(p_movement_need_id);
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Movement review unavailable';
END;
$$;
REVOKE ALL ON FUNCTION private.assert_undisposed_funded_graph(uuid),private.funded_dispute_alignment(uuid),
 private.assert_funded_dispute(uuid),private.require_funded_dispute_actor(),
 private.reject_disputed_funded_progress(),private.validate_funded_dispute_graph() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.get_my_funded_movement_dispute_status(uuid),public.open_my_funded_movement_dispute(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_my_funded_movement_dispute_status(uuid),public.open_my_funded_movement_dispute(uuid,text) TO authenticated;
COMMIT;
