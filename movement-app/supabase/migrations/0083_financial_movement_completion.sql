BEGIN;

-- WE DO NOT CREATE JOURNEYS. Complete only an already confirmed financial start.
CREATE TABLE private.funded_movement_completion_requests (
 alignment_id uuid PRIMARY KEY REFERENCES private.funded_movement_starts(alignment_id),
 financial_agreement_id uuid NOT NULL UNIQUE REFERENCES private.funded_movement_activations(financial_agreement_id),
 journey_id uuid NOT NULL UNIQUE REFERENCES public.journeys(id),
 requested_at timestamptz NOT NULL CHECK(isfinite(requested_at))
);
CREATE TABLE private.funded_movement_completions (
 alignment_id uuid PRIMARY KEY REFERENCES private.funded_movement_completion_requests(alignment_id),
 financial_agreement_id uuid NOT NULL UNIQUE REFERENCES private.funded_movement_activations(financial_agreement_id),
 journey_id uuid NOT NULL UNIQUE REFERENCES public.journeys(id),
 completed_at timestamptz NOT NULL CHECK(isfinite(completed_at))
);
ALTER TABLE private.funded_movement_completion_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.funded_movement_completions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.funded_movement_completion_requests,private.funded_movement_completions FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER protect_funded_completion_requests BEFORE UPDATE OR DELETE OR TRUNCATE ON private.funded_movement_completion_requests
 FOR EACH STATEMENT EXECUTE FUNCTION private.protect_wallet_ledger_row();
CREATE TRIGGER protect_funded_completions BEFORE UPDATE OR DELETE OR TRUNCATE ON private.funded_movement_completions
 FOR EACH STATEMENT EXECUTE FUNCTION private.protect_wallet_ledger_row();
CREATE UNIQUE INDEX wallet_transactions_one_component_settlement ON private.wallet_transactions(financial_component_id)
 WHERE transaction_kind IN ('requester_platform_charge','movement_contribution_settlement','offering_platform_charge');

-- No balance or present-day account status is historical settlement evidence.
CREATE FUNCTION private.assert_funded_completion(p_alignment uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $completion_graph$
DECLARE a public.alignments%ROWTYPE; j public.journeys%ROWTYPE; g private.financial_agreements%ROWTYPE;
 request private.funded_movement_completion_requests%ROWTYPE; receipt private.funded_movement_completions%ROWTYPE;
 c private.financial_components%ROWTYPE; t private.wallet_transactions%ROWTYPE;
 kind text; debit_id uuid; credit_id uuid; n bigint; matches bigint;
BEGIN
 SELECT x.* INTO STRICT a FROM public.alignments x WHERE x.id=p_alignment;
 SELECT x.* INTO STRICT j FROM public.journeys x JOIN private.funded_movement_coordination_entries e ON e.journey_id=x.id WHERE e.alignment_id=a.id;
 SELECT x.* INTO STRICT g FROM private.financial_agreements x JOIN private.funded_movement_activations e ON e.financial_agreement_id=x.id WHERE e.alignment_id=a.id;
 SELECT x.* INTO request FROM private.funded_movement_completion_requests x WHERE x.alignment_id=a.id;
 SELECT x.* INTO receipt FROM private.funded_movement_completions x WHERE x.alignment_id=a.id;
 IF request.alignment_id IS NULL THEN
  IF receipt.alignment_id IS NOT NULL OR j.completion_requested_at IS NOT NULL OR j.completed_at IS NOT NULL
   OR a.status='completed' OR j.status='completed' THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact completion request required'; END IF;
 ELSE
  IF request.financial_agreement_id IS DISTINCT FROM g.id OR request.journey_id IS DISTINCT FROM j.id
   OR request.requested_at IS DISTINCT FROM j.completion_requested_at OR j.started_at IS NULL
   OR request.requested_at<j.started_at OR request.requested_at>clock_timestamp() THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact historical completion request required'; END IF;
  IF receipt.alignment_id IS NULL THEN
   IF a.status<>'in_progress' OR j.status<>'in_progress' OR j.completed_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Unsettled completion must remain in progress'; END IF;
  ELSIF receipt.financial_agreement_id IS DISTINCT FROM g.id OR receipt.journey_id IS DISTINCT FROM j.id
   OR receipt.completed_at IS DISTINCT FROM j.completed_at OR receipt.completed_at<request.requested_at
   OR receipt.completed_at>clock_timestamp() OR a.status<>'completed' OR j.status<>'completed' THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Complete exact settled lifecycle required';
  END IF;
 END IF;
 FOR c IN SELECT x.* FROM private.financial_components x WHERE x.agreement_id=g.id ORDER BY x.id LOOP
  kind:=CASE c.component_key WHEN 'requester_platform_share' THEN 'requester_platform_charge'
   WHEN 'movement_contribution' THEN 'movement_contribution_settlement' ELSE 'offering_platform_charge' END;
  SELECT x.* INTO t FROM private.wallet_transactions x WHERE x.idempotency_key=kind||':'||c.id::text;
  SELECT count(*) INTO n FROM private.wallet_transactions x WHERE x.financial_component_id=c.id
   AND x.transaction_kind IN ('requester_platform_charge','movement_contribution_settlement','offering_platform_charge');
  IF receipt.alignment_id IS NULL OR c.amount_minor=0 THEN
   IF t.id IS NOT NULL OR n<>0 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Partial or zero settlement history forbidden'; END IF;
   CONTINUE;
  END IF;
  SELECT x.id INTO debit_id FROM private.wallet_accounts x WHERE x.currency=g.currency AND
   ((c.component_key='offering_platform_share' AND x.member_id=g.offering_member_id AND x.account_kind='member_withdrawable')
    OR (c.component_key<>'offering_platform_share' AND x.member_id=g.member_needing_movement_id AND x.account_kind='member_held'));
  SELECT x.id INTO credit_id FROM private.wallet_accounts x WHERE x.currency=g.currency AND
   ((c.component_key='movement_contribution' AND x.member_id=g.offering_member_id AND x.account_kind='member_withdrawable')
    OR (c.component_key<>'movement_contribution' AND x.member_id IS NULL AND x.account_kind='platform_revenue'));
  IF n<>1 OR t.id IS NULL OR t.transaction_kind IS DISTINCT FROM kind OR t.currency IS DISTINCT FROM g.currency
   OR t.alignment_id IS DISTINCT FROM a.id OR t.financial_component_id IS DISTINCT FROM c.id
   OR t.provider IS NOT NULL OR t.provider_reference IS NOT NULL OR debit_id IS NULL OR credit_id IS NULL
   OR NOT isfinite(t.created_at) OR t.created_at IS DISTINCT FROM receipt.completed_at THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact historical settlement transaction required'; END IF;
  SELECT count(*),count(*) FILTER(WHERE x.amount_minor=c.amount_minor AND isfinite(x.created_at) AND x.created_at=t.created_at
   AND ((x.account_id=debit_id AND x.direction='debit') OR (x.account_id=credit_id AND x.direction='credit')))
   INTO n,matches FROM private.wallet_postings x WHERE x.transaction_id=t.id;
  IF n<>2 OR matches<>2 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact historical settlement postings required'; END IF;
  PERFORM private.assert_wallet_transaction_balanced(t.id);
 END LOOP;
 IF EXISTS(SELECT 1 FROM private.wallet_transactions x WHERE x.alignment_id=a.id
  AND x.transaction_kind IN ('requester_platform_charge','movement_contribution_settlement','offering_platform_charge')
  AND NOT EXISTS(SELECT 1 FROM private.financial_components fc WHERE fc.id=x.financial_component_id AND fc.agreement_id=g.id)) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Competing settlement history forbidden'; END IF;
END;
$completion_graph$;

-- Forward historical selector/entry and narrow operational guards follow below.
CREATE OR REPLACE FUNCTION private.funded_coordination_alignment(p_need uuid,p_principal boolean DEFAULT true)
RETURNS public.alignments LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $coordination_selector$
DECLARE a public.alignments%ROWTYPE; g private.financial_agreements%ROWTYPE;
 p private.financial_proposals%ROWTYPE; caller uuid:=auth.uid();
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION USING ERRCODE='25000',MESSAGE='Coordination requires READ COMMITTED'; END IF;
 IF p_need IS NULL THEN RAISE EXCEPTION USING ERRCODE='22004',MESSAGE='Movement need required'; END IF;
 IF caller IS NULL OR NOT EXISTS(SELECT 1 FROM public.members WHERE id=caller) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Authenticated member required'; END IF;
 IF (SELECT count(*) FROM public.alignments WHERE movement_need_id=p_need)<>1 THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Exact funded movement required'; END IF;
 SELECT x.* INTO STRICT a FROM public.alignments x WHERE x.movement_need_id=p_need;
 IF caller NOT IN (a.offering_member_id,a.member_needing_movement_id)
  AND (p_principal OR NOT EXISTS(SELECT 1 FROM public.movement_participants t
   WHERE t.movement_need_id=p_need AND t.member_id=caller AND t.status='confirmed' AND t.role='invited_participant')) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Exact movement principal required'; END IF;
 SELECT x.* INTO g FROM private.financial_agreements x
  JOIN private.funded_movement_activations r ON r.financial_agreement_id=x.id WHERE r.alignment_id=a.id;
 IF g.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact funded activation required'; END IF;
 SELECT x.* INTO STRICT g FROM private.financial_agreements x WHERE x.id=g.id FOR SHARE;
 SELECT x.* INTO STRICT a FROM public.alignments x WHERE x.id=g.alignment_id FOR UPDATE;
 IF a.movement_need_id IS DISTINCT FROM p_need OR a.status NOT IN ('activated','in_progress','completed')
  OR (p_principal AND caller NOT IN (a.offering_member_id,a.member_needing_movement_id)) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Activated exact movement required'; END IF;
 g:=private.movement_funding_agreement(g.id,g.member_needing_movement_id,g.version);
 PERFORM private.assert_funded_activation(g,a);
 SELECT x.* INTO STRICT p FROM private.financial_proposals x WHERE x.financial_agreement_id=g.id;
 IF NOT EXISTS(SELECT 1 FROM public.movement_offers o JOIN public.vehicles v ON v.id=o.vehicle_id
  WHERE o.id=a.movement_offer_id AND o.status='accepted' AND o.vehicle_id=p.vehicle_id
   AND o.movement_need_id=a.movement_need_id AND o.offering_member_id=a.offering_member_id) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact accepted offer vehicle required'; END IF;
 -- An in-progress selector is historical only with the exact committed start graph.
 IF a.status IN ('in_progress','completed') THEN PERFORM private.assert_funded_coordination_entry(a.id); END IF;
 RETURN a;
END;
$coordination_selector$;

CREATE OR REPLACE FUNCTION private.assert_funded_coordination_entry(p_alignment uuid)
RETURNS public.journeys LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $coordination_graph$
DECLARE r private.funded_movement_coordination_entries%ROWTYPE; j public.journeys%ROWTYPE;
 a public.alignments%ROWTYPE; g private.financial_agreements%ROWTYPE;
 request private.funded_movement_start_requests%ROWTYPE; started private.funded_movement_starts%ROWTYPE; mp private.journey_meeting_points%ROWTYPE;
BEGIN
 SELECT x.* INTO r FROM private.funded_movement_coordination_entries x WHERE x.alignment_id=p_alignment;
 SELECT x.* INTO a FROM public.alignments x WHERE x.id=p_alignment;
 SELECT x.* INTO g FROM private.financial_agreements x WHERE x.id=r.financial_agreement_id;
 SELECT x.* INTO j FROM public.journeys x WHERE x.id=r.journey_id;
 IF r.alignment_id IS NULL OR j.id IS NULL OR g.id IS NULL
  OR (SELECT count(*) FROM public.journeys WHERE alignment_id=p_alignment)<>1
  OR g.alignment_id IS DISTINCT FROM a.id OR j.alignment_id IS DISTINCT FROM a.id
  OR j.vehicle_id IS DISTINCT FROM (SELECT vehicle_id FROM public.movement_offers WHERE id=a.movement_offer_id)
  OR j.created_at IS DISTINCT FROM r.created_at OR r.created_at<a.activated_at OR r.created_at>clock_timestamp()
  OR EXISTS(SELECT 1 FROM private.mutual_no_travel_closures c WHERE c.journey_id=j.id)
  OR EXISTS(SELECT 1 FROM private.movement_settlements c WHERE c.journey_id=j.id OR c.alignment_id=a.id)
  OR j.end_requested_by_member_id IS NOT NULL OR j.end_requested_at IS NOT NULL
  OR j.end_confirmed_by_member_id IS NOT NULL OR j.end_confirmed_at IS NOT NULL OR j.end_reason IS NOT NULL OR j.end_method IS NOT NULL THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Complete exact coordination entry required'; END IF;
 SELECT x.* INTO request FROM private.funded_movement_start_requests x WHERE x.alignment_id=a.id;
 SELECT x.* INTO started FROM private.funded_movement_starts x WHERE x.alignment_id=a.id;
 SELECT x.* INTO mp FROM private.journey_meeting_points x WHERE x.journey_id=j.id;
 IF request.alignment_id IS NULL THEN
  IF started.alignment_id IS NOT NULL OR a.status<>'activated' OR j.status<>'not_started'
   OR j.start_requested_at IS NOT NULL OR j.started_at IS NOT NULL THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact financial start request required'; END IF;
 ELSE
  IF request.journey_id IS DISTINCT FROM j.id OR request.requested_at IS DISTINCT FROM j.start_requested_at
   OR request.requested_at<r.created_at OR request.requested_at>clock_timestamp()
   OR mp.journey_id IS NULL OR mp.revision IS DISTINCT FROM request.meeting_point_revision
   OR mp.place_text<>btrim(mp.place_text) OR length(mp.place_text) NOT BETWEEN 1 AND 200 OR mp.place_text !~ '[^[:space:]]' THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact frozen meeting point and start request required'; END IF;
  IF started.alignment_id IS NULL THEN
   IF a.status<>'activated' OR j.status<>'not_started' OR j.started_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact financial start confirmation required'; END IF;
  ELSIF started.journey_id IS DISTINCT FROM j.id OR started.started_at IS DISTINCT FROM j.started_at
   OR started.started_at<request.requested_at OR started.started_at>clock_timestamp()
   OR a.status NOT IN ('in_progress','completed') OR j.status IS DISTINCT FROM a.status THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Complete exact financial start required';
  END IF;
 END IF;
 PERFORM private.assert_funded_activation(g,a);
 PERFORM private.assert_funded_completion(a.id);
 RETURN j;
END;
$coordination_graph$;

CREATE OR REPLACE FUNCTION private.protect_financial_coordination_journey()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $journey_guard$
DECLARE r private.funded_movement_coordination_entries%ROWTYPE; a public.alignments%ROWTYPE;
BEGIN
 IF TG_OP='TRUNCATE' THEN
  IF EXISTS(SELECT 1 FROM public.journeys j WHERE private.is_financial_alignment(j.alignment_id)) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Financial coordination lifecycle unavailable'; END IF; RETURN NULL;
 END IF;
 IF TG_OP<>'INSERT' AND private.is_financial_alignment(OLD.alignment_id) THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Financial coordination lifecycle unavailable'; END IF;
  IF to_jsonb(NEW) IS NOT DISTINCT FROM to_jsonb(OLD) THEN RETURN NEW; END IF;
  IF OLD.status='in_progress' AND OLD.completed_at IS NULL
   AND (to_jsonb(NEW)-ARRAY['status','completion_requested_at','completed_at','updated_at'])
    IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','completion_requested_at','completed_at','updated_at']) THEN
   IF OLD.completion_requested_at IS NULL AND NEW.status='in_progress' AND NEW.completed_at IS NULL
    AND EXISTS(SELECT 1 FROM private.funded_movement_completion_requests x WHERE x.alignment_id=OLD.alignment_id
     AND x.journey_id=OLD.id AND x.requested_at=NEW.completion_requested_at)
    AND NOT EXISTS(SELECT 1 FROM private.funded_movement_completions x WHERE x.alignment_id=OLD.alignment_id) THEN RETURN NEW; END IF;
   IF OLD.completion_requested_at IS NOT NULL AND NEW.status='completed' AND NEW.completion_requested_at=OLD.completion_requested_at
    AND EXISTS(SELECT 1 FROM private.funded_movement_completions x WHERE x.alignment_id=OLD.alignment_id
     AND x.journey_id=OLD.id AND x.completed_at=NEW.completed_at) THEN RETURN NEW; END IF;
  END IF;
  IF (to_jsonb(NEW)-ARRAY['status','start_requested_at','started_at','updated_at'])
   IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','start_requested_at','started_at','updated_at']) THEN
   IF OLD.status='not_started' AND OLD.start_requested_at IS NULL AND OLD.started_at IS NULL
    AND NEW.status='not_started' AND NEW.started_at IS NULL
    AND EXISTS(SELECT 1 FROM private.funded_movement_start_requests x WHERE x.alignment_id=OLD.alignment_id
     AND x.journey_id=OLD.id AND x.requested_at=NEW.start_requested_at)
    AND NOT EXISTS(SELECT 1 FROM private.funded_movement_starts x WHERE x.alignment_id=OLD.alignment_id) THEN RETURN NEW; END IF;
   IF OLD.status='not_started' AND OLD.start_requested_at IS NOT NULL AND OLD.started_at IS NULL
    AND NEW.status='in_progress' AND NEW.start_requested_at=OLD.start_requested_at
    AND EXISTS(SELECT 1 FROM private.funded_movement_starts x WHERE x.alignment_id=OLD.alignment_id
     AND x.journey_id=OLD.id AND x.started_at=NEW.started_at) THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Financial coordination lifecycle unavailable';
 END IF;
 IF TG_OP<>'DELETE' AND private.is_financial_alignment(NEW.alignment_id) THEN
  SELECT x.* INTO r FROM private.funded_movement_coordination_entries x WHERE x.journey_id=NEW.id;
  SELECT x.* INTO a FROM public.alignments x WHERE x.id=NEW.alignment_id;
  IF r.journey_id IS NULL OR r.alignment_id IS DISTINCT FROM NEW.alignment_id OR a.status<>'activated'
   OR NOT EXISTS(SELECT 1 FROM private.funded_movement_activations f WHERE f.alignment_id=a.id AND f.financial_agreement_id=r.financial_agreement_id)
   OR NEW.vehicle_id IS DISTINCT FROM (SELECT vehicle_id FROM public.movement_offers WHERE id=a.movement_offer_id)
   OR NEW.created_at IS DISTINCT FROM r.created_at OR NEW.updated_at IS DISTINCT FROM r.created_at
   OR NEW.status<>'not_started' OR NEW.start_requested_at IS NOT NULL OR NEW.started_at IS NOT NULL
   OR NEW.completion_requested_at IS NOT NULL OR NEW.completed_at IS NOT NULL
   OR NEW.end_requested_by_member_id IS NOT NULL OR NEW.end_requested_at IS NOT NULL
   OR NEW.end_confirmed_by_member_id IS NOT NULL OR NEW.end_confirmed_at IS NOT NULL
   OR NEW.end_reason IS NOT NULL OR NEW.end_method IS NOT NULL THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact funded coordination provenance required'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END;
$journey_guard$;

CREATE OR REPLACE FUNCTION private.protect_financial_coordination_alignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $start_alignment_guard$
BEGIN
 IF OLD.activated_at IS NOT NULL AND EXISTS(SELECT 1 FROM private.funded_movement_activations WHERE alignment_id=OLD.id) THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Financial coordination lifecycle unavailable'; END IF;
  IF (to_jsonb(NEW)-'updated_at') IS NOT DISTINCT FROM (to_jsonb(OLD)-'updated_at') THEN RETURN NEW; END IF;
  IF OLD.status='in_progress' AND NEW.status='completed'
   AND (to_jsonb(NEW)-ARRAY['status','updated_at']) IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','updated_at'])
   AND EXISTS(SELECT 1 FROM private.funded_movement_completions x WHERE x.alignment_id=OLD.id) THEN RETURN NEW; END IF;
  IF OLD.status='activated' AND NEW.status='in_progress'
   AND (to_jsonb(NEW)-ARRAY['status','updated_at']) IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','updated_at'])
   AND EXISTS(SELECT 1 FROM private.funded_movement_starts x WHERE x.alignment_id=OLD.id) THEN RETURN NEW; END IF;
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Financial coordination lifecycle unavailable';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END;
$start_alignment_guard$;

CREATE FUNCTION private.require_funded_completion_actor()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $completion_actor$
DECLARE a public.alignments%ROWTYPE; j public.journeys%ROWTYPE; g uuid;
BEGIN
 SELECT x.* INTO STRICT a FROM public.alignments x WHERE x.id=NEW.alignment_id;
 j:=private.assert_funded_coordination_entry(a.id);
 SELECT financial_agreement_id INTO STRICT g FROM private.funded_movement_activations WHERE alignment_id=a.id;
 IF NEW.journey_id IS DISTINCT FROM j.id OR NEW.financial_agreement_id IS DISTINCT FROM g
  OR a.status<>'in_progress' OR j.status<>'in_progress' OR j.completed_at IS NOT NULL THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact in-progress financial movement required'; END IF;
 IF TG_TABLE_NAME='funded_movement_completion_requests' THEN
  IF auth.uid() IS DISTINCT FROM a.offering_member_id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Exact offerer required'; END IF;
  IF j.completion_requested_at IS NOT NULL OR NEW.requested_at<j.started_at OR NEW.requested_at>clock_timestamp() THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact first completion request required'; END IF;
 ELSE
  IF auth.uid() IS DISTINCT FROM a.member_needing_movement_id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Exact requester required'; END IF;
  IF j.completion_requested_at IS NULL OR NEW.completed_at<j.completion_requested_at OR NEW.completed_at>clock_timestamp() THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact offerer completion request required'; END IF;
 END IF;
 RETURN NEW;
END;
$completion_actor$;
CREATE TRIGGER require_funded_completion_request_actor BEFORE INSERT ON private.funded_movement_completion_requests
 FOR EACH ROW EXECUTE FUNCTION private.require_funded_completion_actor();
CREATE TRIGGER require_funded_completion_actor BEFORE INSERT ON private.funded_movement_completions
 FOR EACH ROW EXECUTE FUNCTION private.require_funded_completion_actor();

-- Ledger-only writes cannot escape the final lifecycle/three-component proof.
CREATE FUNCTION private.validate_funded_completion_graph()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $completion_complete$
DECLARE selected_alignment uuid;
BEGIN
 IF TG_TABLE_NAME='wallet_postings' THEN
  SELECT alignment_id INTO selected_alignment FROM private.wallet_transactions WHERE id=NEW.transaction_id;
 ELSE selected_alignment:=NEW.alignment_id; END IF;
 IF EXISTS(SELECT 1 FROM private.funded_movement_coordination_entries WHERE alignment_id=selected_alignment) THEN
  PERFORM private.assert_funded_coordination_entry(selected_alignment);
 END IF;
 RETURN NULL;
END;
$completion_complete$;
CREATE CONSTRAINT TRIGGER funded_completion_request_complete AFTER INSERT ON private.funded_movement_completion_requests
 DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION private.validate_funded_completion_graph();
CREATE CONSTRAINT TRIGGER funded_completion_complete AFTER INSERT ON private.funded_movement_completions
 DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION private.validate_funded_completion_graph();
CREATE CONSTRAINT TRIGGER funded_completion_transaction_complete AFTER INSERT ON private.wallet_transactions
 DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION private.validate_funded_completion_graph();
CREATE CONSTRAINT TRIGGER funded_completion_posting_complete AFTER INSERT ON private.wallet_postings
 DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION private.validate_funded_completion_graph();

CREATE FUNCTION private.require_funded_settlement_transaction()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $settlement_actor$
DECLARE c private.financial_components%ROWTYPE; g private.financial_agreements%ROWTYPE; r private.funded_movement_completions%ROWTYPE; kind text;
BEGIN
 IF NEW.financial_component_id IS NULL THEN RETURN NEW; END IF;
 SELECT x.* INTO STRICT c FROM private.financial_components x WHERE x.id=NEW.financial_component_id;
 SELECT x.* INTO STRICT g FROM private.financial_agreements x WHERE x.id=c.agreement_id;
 -- Unmaterialized legacy agreements retain their existing foundation behavior.
 IF NOT EXISTS(SELECT 1 FROM private.financial_proposals WHERE financial_agreement_id=g.id) THEN RETURN NEW; END IF;
 IF NEW.transaction_kind='movement_hold' THEN RETURN NEW; END IF;
 IF NEW.transaction_kind NOT IN ('requester_platform_charge','movement_contribution_settlement','offering_platform_charge') THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Unsupported financial component ledger action'; END IF;
 SELECT x.* INTO r FROM private.funded_movement_completions x WHERE x.alignment_id=g.alignment_id;
 kind:=CASE c.component_key WHEN 'requester_platform_share' THEN 'requester_platform_charge'
  WHEN 'movement_contribution' THEN 'movement_contribution_settlement' ELSE 'offering_platform_charge' END;
 IF auth.uid() IS DISTINCT FROM g.member_needing_movement_id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Exact settlement requester required'; END IF;
 IF r.alignment_id IS NULL OR r.financial_agreement_id IS DISTINCT FROM g.id OR c.amount_minor<=0
  OR NEW.alignment_id IS DISTINCT FROM g.alignment_id OR NEW.currency IS DISTINCT FROM g.currency
  OR NEW.transaction_kind IS DISTINCT FROM kind OR NEW.idempotency_key IS DISTINCT FROM kind||':'||c.id::text
  OR NEW.created_at IS DISTINCT FROM r.completed_at OR NEW.provider IS NOT NULL OR NEW.provider_reference IS NOT NULL THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact completion-backed settlement required'; END IF;
 RETURN NEW;
END;
$settlement_actor$;
CREATE TRIGGER require_funded_settlement_transaction BEFORE INSERT ON private.wallet_transactions
 FOR EACH ROW EXECUTE FUNCTION private.require_funded_settlement_transaction();

CREATE FUNCTION public.get_my_funded_movement_completion_status(p_movement_need_id uuid)
RETURNS TABLE(journey_state text,completion_requested_at timestamptz,completed_at timestamptz,
 can_request_completion boolean,can_confirm_completion boolean,settlement_state text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $completion_projection$
DECLARE a public.alignments%ROWTYPE; j public.journeys%ROWTYPE;
BEGIN
 a:=private.funded_coordination_alignment(p_movement_need_id);
 PERFORM x.id FROM public.journeys x WHERE x.alignment_id=a.id FOR SHARE;
 j:=private.assert_funded_coordination_entry(a.id);
 RETURN QUERY SELECT j.status,j.completion_requested_at,j.completed_at,
  auth.uid()=a.offering_member_id AND j.status='in_progress' AND j.completion_requested_at IS NULL,
  auth.uid()=a.member_needing_movement_id AND j.status='in_progress' AND j.completion_requested_at IS NOT NULL,
  CASE WHEN j.status='completed' THEN 'settled'::text WHEN j.completion_requested_at IS NOT NULL THEN 'awaiting_confirmation'::text ELSE 'not_ready'::text END;
END;
$completion_projection$;

CREATE FUNCTION public.request_my_funded_movement_completion(p_movement_need_id uuid)
RETURNS TABLE(journey_state text,completion_requested_at timestamptz,completed_at timestamptz,
 can_request_completion boolean,can_confirm_completion boolean,settlement_state text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $completion_request$
DECLARE a public.alignments%ROWTYPE; j public.journeys%ROWTYPE; g uuid; stamp timestamptz;
BEGIN
 a:=private.funded_coordination_alignment(p_movement_need_id);
 IF auth.uid() IS DISTINCT FROM a.offering_member_id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Exact offerer required'; END IF;
 PERFORM x.id FROM public.journeys x WHERE x.alignment_id=a.id FOR UPDATE;
 j:=private.assert_funded_coordination_entry(a.id);
 IF EXISTS(SELECT 1 FROM private.funded_movement_completion_requests WHERE alignment_id=a.id) THEN
  RETURN QUERY SELECT * FROM public.get_my_funded_movement_completion_status(p_movement_need_id); RETURN;
 END IF;
 IF a.status<>'in_progress' OR j.status<>'in_progress' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Confirmed financial start required'; END IF;
 SELECT financial_agreement_id INTO STRICT g FROM private.funded_movement_activations WHERE alignment_id=a.id;
 stamp:=clock_timestamp();
 BEGIN
  -- One statement completes both sides before any immediate constraint trigger
  -- fires. RETURNING is the dependency between writes; caller modes are untouched.
  WITH evidence AS (
   INSERT INTO private.funded_movement_completion_requests VALUES(a.id,g,j.id,stamp)
   RETURNING journey_id,requested_at
  )
  UPDATE public.journeys x SET completion_requested_at=e.requested_at,updated_at=e.requested_at
   FROM evidence e WHERE x.id=e.journey_id;
  PERFORM private.assert_funded_coordination_entry(a.id);
 EXCEPTION WHEN OTHERS THEN RAISE;
 END;
 RETURN QUERY SELECT * FROM public.get_my_funded_movement_completion_status(p_movement_need_id);
END;
$completion_request$;

CREATE FUNCTION public.confirm_my_funded_movement_completion(p_movement_need_id uuid)
RETURNS TABLE(journey_state text,completion_requested_at timestamptz,completed_at timestamptz,
 can_request_completion boolean,can_confirm_completion boolean,settlement_state text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $completion_confirm$
DECLARE a public.alignments%ROWTYPE; j public.journeys%ROWTYPE; g private.financial_agreements%ROWTYPE;
 account record; owner uuid; stamp timestamptz;
 held_id uuid; withdrawable_id uuid; revenue_id uuid;
 r numeric; contribution numeric; o numeric; held numeric; withdrawable numeric:=0; revenue numeric:=0;
 balance numeric; maximum constant numeric:=9223372036854775807;
BEGIN
 a:=private.funded_coordination_alignment(p_movement_need_id);
 IF auth.uid() IS DISTINCT FROM a.member_needing_movement_id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Exact requester required'; END IF;
 PERFORM x.id FROM public.journeys x WHERE x.alignment_id=a.id FOR UPDATE;
 j:=private.assert_funded_coordination_entry(a.id);
 IF EXISTS(SELECT 1 FROM private.funded_movement_completions WHERE alignment_id=a.id) THEN
  RETURN QUERY SELECT * FROM public.get_my_funded_movement_completion_status(p_movement_need_id); RETURN;
 END IF;
 IF a.status<>'in_progress' OR j.status<>'in_progress' OR j.completion_requested_at IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact offerer completion request required'; END IF;
 SELECT x.* INTO STRICT g FROM private.financial_agreements x JOIN private.funded_movement_activations f ON f.financial_agreement_id=x.id WHERE f.alignment_id=a.id;
 -- All member gates precede all member account locks. Never upgrade SHARE locks.
 PERFORM m.id FROM public.members m WHERE m.id IN (a.offering_member_id,a.member_needing_movement_id) ORDER BY m.id FOR UPDATE;
 PERFORM x.id FROM private.wallet_accounts x WHERE x.member_id IN (a.offering_member_id,a.member_needing_movement_id)
  AND x.currency=g.currency ORDER BY x.id FOR UPDATE;
 FOR owner IN SELECT m.id FROM public.members m WHERE m.id IN (a.offering_member_id,a.member_needing_movement_id) ORDER BY m.id LOOP
  IF (SELECT count(*) FROM private.wallet_accounts WHERE member_id=owner AND currency=g.currency) NOT IN (0,3)
   OR EXISTS(SELECT 1 FROM private.wallet_accounts WHERE member_id=owner AND currency=g.currency AND status<>'active')
   OR (owner=a.member_needing_movement_id AND (SELECT count(*) FROM private.wallet_accounts WHERE member_id=owner AND currency=g.currency)<>3) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Complete active settlement wallets required'; END IF;
 END LOOP;
 SELECT max(amount_minor) FILTER(WHERE component_key='requester_platform_share'),
  max(amount_minor) FILTER(WHERE component_key='movement_contribution'),max(amount_minor) FILTER(WHERE component_key='offering_platform_share')
  INTO r,contribution,o FROM private.financial_components WHERE agreement_id=g.id;
 SELECT id INTO STRICT held_id FROM private.wallet_accounts WHERE member_id=a.member_needing_movement_id AND currency=g.currency AND account_kind='member_held';
 SELECT id INTO withdrawable_id FROM private.wallet_accounts WHERE member_id=a.offering_member_id AND currency=g.currency AND account_kind='member_withdrawable';
 FOR account IN SELECT x.* FROM private.wallet_accounts x WHERE x.member_id IN (a.offering_member_id,a.member_needing_movement_id) AND x.currency=g.currency LOOP
  SELECT coalesce(sum(CASE WHEN direction='credit' THEN amount_minor::numeric ELSE -amount_minor::numeric END),0)
   INTO balance FROM private.wallet_postings WHERE account_id=account.id;
  IF balance<0 OR balance>maximum THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Settlement wallet outside supported range'; END IF;
  IF account.id=held_id THEN held:=balance; END IF;
  IF account.id=withdrawable_id THEN withdrawable:=balance; END IF;
 END LOOP;
 IF held IS NULL OR held<r+contribution OR withdrawable+contribution>maximum OR withdrawable+contribution-o<0 THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Insufficient or overflowing settlement balances'; END IF;
 -- Setup is inside the same rollback subtransaction as all lifecycle/ledger writes.
 BEGIN
  PERFORM public.ensure_ngn_wallet_accounts_for_server(a.offering_member_id);
  SELECT id INTO STRICT withdrawable_id FROM private.wallet_accounts WHERE member_id=a.offering_member_id AND currency=g.currency AND account_kind='member_withdrawable';
  INSERT INTO private.wallet_accounts(member_id,account_kind,currency) VALUES(NULL,'platform_revenue',g.currency)
   ON CONFLICT(account_kind,currency) WHERE member_id IS NULL DO NOTHING;
  SELECT id INTO STRICT revenue_id FROM private.wallet_accounts WHERE member_id IS NULL AND account_kind='platform_revenue' AND currency=g.currency FOR UPDATE;
  IF NOT EXISTS(SELECT 1 FROM private.wallet_accounts WHERE id=revenue_id AND status='active') THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Active platform revenue account required'; END IF;
  SELECT coalesce(sum(CASE WHEN direction='credit' THEN amount_minor::numeric ELSE -amount_minor::numeric END),0)
   INTO revenue FROM private.wallet_postings WHERE account_id=revenue_id;
  IF revenue<0 OR revenue+r+o>maximum THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Platform revenue outside supported range'; END IF;
  -- Every potentially blocking member/account/provisioning/revenue wait precedes this instant.
  stamp:=clock_timestamp();
  -- A single statement constructs the complete graph. Every writable stage
  -- consumes RETURNING from its predecessor. Immediate constraint triggers run
  -- at statement end, after all postings and both lifecycle updates; deferred
  -- callers retain their mode and also receive the explicit full assertion below.
  WITH evidence AS (
   INSERT INTO private.funded_movement_completions AS receipt VALUES(a.id,g.id,j.id,stamp)
   RETURNING receipt.alignment_id,receipt.financial_agreement_id,receipt.journey_id,receipt.completed_at
  ), components AS MATERIALIZED (
   SELECT c.*,e.alignment_id,e.completed_at,
    CASE c.component_key WHEN 'requester_platform_share' THEN 'requester_platform_charge'
     WHEN 'movement_contribution' THEN 'movement_contribution_settlement' ELSE 'offering_platform_charge' END kind,
    CASE c.component_key WHEN 'requester_platform_share' THEN 1 WHEN 'movement_contribution' THEN 2 ELSE 3 END ordinal
   FROM evidence e JOIN private.financial_components c ON c.agreement_id=e.financial_agreement_id
   WHERE c.amount_minor>0
  ), transactions AS (
   INSERT INTO private.wallet_transactions(transaction_kind,currency,alignment_id,financial_component_id,idempotency_key,created_at)
    SELECT c.kind,g.currency,c.alignment_id,c.id,c.kind||':'||c.id::text,c.completed_at
     FROM components c ORDER BY c.ordinal
   RETURNING id,financial_component_id,created_at
  ), postings AS (
   INSERT INTO private.wallet_postings(transaction_id,account_id,direction,amount_minor,created_at)
    SELECT t.id,
     CASE WHEN side.direction='debit' THEN
       CASE WHEN c.component_key='offering_platform_share' THEN withdrawable_id ELSE held_id END
      ELSE CASE WHEN c.component_key='movement_contribution' THEN withdrawable_id ELSE revenue_id END END,
     side.direction,c.amount_minor,t.created_at
    FROM transactions t JOIN components c ON c.id=t.financial_component_id
    CROSS JOIN (VALUES('debit'::text,1),('credit'::text,2)) side(direction,ordinal)
    ORDER BY c.ordinal,side.ordinal
   RETURNING id
  ), completed_journey AS (
   UPDATE public.journeys x SET status='completed',completed_at=e.completed_at,updated_at=e.completed_at
    FROM evidence e WHERE x.id=e.journey_id AND (SELECT count(*) FROM postings)>=0
   RETURNING x.alignment_id,x.completed_at
  )
  UPDATE public.alignments x SET status='completed',updated_at=d.completed_at
   FROM completed_journey d WHERE x.id=d.alignment_id;
  PERFORM private.assert_funded_coordination_entry(a.id);
 EXCEPTION WHEN OTHERS THEN RAISE;
 END;
 RETURN QUERY SELECT * FROM public.get_my_funded_movement_completion_status(p_movement_need_id);
END;
$completion_confirm$;

REVOKE ALL ON FUNCTION private.assert_funded_completion(uuid),private.require_funded_completion_actor(),
 private.validate_funded_completion_graph(),private.require_funded_settlement_transaction() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.get_my_funded_movement_completion_status(uuid),public.request_my_funded_movement_completion(uuid),
 public.confirm_my_funded_movement_completion(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_my_funded_movement_completion_status(uuid),public.request_my_funded_movement_completion(uuid),
 public.confirm_my_funded_movement_completion(uuid) TO authenticated;

-- Completed recovery follows below; legacy settlement semantics are untouched.
CREATE OR REPLACE FUNCTION public.list_my_completed_movement_recoveries(p_limit integer DEFAULT 20)
RETURNS TABLE (movement_need_id uuid, origin_area text, destination_area text,
  completed_at timestamptz, settlement_status text, settlement_is_for_me boolean, settled_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE caller uuid := auth.uid();
BEGIN
  IF caller IS NULL OR NOT EXISTS (SELECT 1 FROM public.members m WHERE m.id=caller) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Authenticated member required';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Recovery limit must be between 1 and 50';
  END IF;
  RETURN QUERY
  WITH financial_candidates AS MATERIALIZED (
   SELECT x.movement_need_id FROM public.alignments x WHERE x.status='completed'
    AND caller IN (x.offering_member_id,x.member_needing_movement_id)
    AND EXISTS(SELECT 1 FROM private.funded_movement_completions r WHERE r.alignment_id=x.id)
  ), recovered AS (
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
  UNION ALL
  SELECT c.movement_need_id,od.discovery_area_label,dd.discovery_area_label,
   r.completed_at,'settled'::text,ctx.offering_id=caller,r.completed_at
  FROM financial_candidates c
  CROSS JOIN LATERAL private.movement_coordination_context(c.movement_need_id) ctx
  JOIN private.funded_movement_completions r ON r.alignment_id=ctx.alignment_id
  JOIN private.movement_need_locations ol ON ol.movement_need_id=c.movement_need_id AND ol.role='origin'
  JOIN private.trusted_location_discovery_areas od ON od.resolved_location_reference_id=ol.location_reference_id
  JOIN private.movement_need_locations dl ON dl.movement_need_id=c.movement_need_id AND dl.role='destination'
  JOIN private.trusted_location_discovery_areas dd ON dd.resolved_location_reference_id=dl.location_reference_id
  WHERE ctx.journey_status='completed'
  ) SELECT * FROM recovered ORDER BY 4 DESC,1 DESC LIMIT p_limit;
END;
$$;
COMMIT;
