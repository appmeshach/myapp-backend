BEGIN;

-- Metadata only: historical receipts could only be requester-confirmed under
-- the audited pre-0087 actor gate. ADD COLUMN fills that truthful default
-- without updating protected receipts or disabling any trigger.
ALTER TABLE private.funded_movement_completions ADD COLUMN completion_method text NOT NULL DEFAULT 'requester_confirmed'
 CHECK(completion_method IN ('requester_confirmed','response_timeout'));
ALTER TABLE private.funded_movement_completion_requests ADD CONSTRAINT funded_completion_request_graph
 UNIQUE(alignment_id,financial_agreement_id,journey_id,requested_at);
CREATE TABLE private.funded_completion_response_windows (
 alignment_id uuid PRIMARY KEY,
 financial_agreement_id uuid NOT NULL UNIQUE,
 journey_id uuid NOT NULL UNIQUE,
 requested_at timestamptz NOT NULL CHECK(isfinite(requested_at)),
 response_deadline_at timestamptz NOT NULL CHECK(isfinite(response_deadline_at)),
 FOREIGN KEY(alignment_id,financial_agreement_id,journey_id,requested_at)
  REFERENCES private.funded_movement_completion_requests(alignment_id,financial_agreement_id,journey_id,requested_at),
 UNIQUE(alignment_id,financial_agreement_id,journey_id),
 CHECK(response_deadline_at=requested_at+interval '12 hours')
);
-- Existing request events retain their observed metadata and receive the same
-- deterministic response policy. No old request/completion/ledger is rewritten.
INSERT INTO private.funded_completion_response_windows
 SELECT alignment_id,financial_agreement_id,journey_id,requested_at,requested_at+interval '12 hours'
 FROM private.funded_movement_completion_requests;
CREATE TABLE private.funded_completion_disputes (
 alignment_id uuid PRIMARY KEY,
 financial_agreement_id uuid NOT NULL UNIQUE,
 journey_id uuid NOT NULL UNIQUE,
 requester_member_id uuid NOT NULL REFERENCES public.members(id),
 opened_at timestamptz NOT NULL CHECK(isfinite(opened_at)),
 reason_category text NOT NULL CHECK(reason_category IN ('completion_concern','movement_concern')),
 FOREIGN KEY(alignment_id,financial_agreement_id,journey_id)
  REFERENCES private.funded_completion_response_windows(alignment_id,financial_agreement_id,journey_id)
);
ALTER TABLE private.funded_completion_response_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.funded_completion_disputes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.funded_completion_response_windows,private.funded_completion_disputes FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER protect_completion_response_windows BEFORE UPDATE OR DELETE OR TRUNCATE ON private.funded_completion_response_windows
 FOR EACH STATEMENT EXECUTE FUNCTION private.protect_wallet_ledger_row();
CREATE TRIGGER protect_completion_disputes BEFORE UPDATE OR DELETE OR TRUNCATE ON private.funded_completion_disputes
 FOR EACH STATEMENT EXECUTE FUNCTION private.protect_wallet_ledger_row();

CREATE OR REPLACE FUNCTION private.assert_funded_completion(p_alignment uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE a public.alignments%ROWTYPE; j public.journeys%ROWTYPE; g private.financial_agreements%ROWTYPE;
 request private.funded_movement_completion_requests%ROWTYPE; receipt private.funded_movement_completions%ROWTYPE;
 c private.financial_components%ROWTYPE; t private.wallet_transactions%ROWTYPE;
 response_window private.funded_completion_response_windows%ROWTYPE; review private.funded_completion_disputes%ROWTYPE;
 kind text; debit_id uuid; credit_id uuid; n bigint; matches bigint;
BEGIN
 SELECT x.* INTO STRICT a FROM public.alignments x WHERE x.id=p_alignment;
 SELECT x.* INTO STRICT j FROM public.journeys x JOIN private.funded_movement_coordination_entries e ON e.journey_id=x.id WHERE e.alignment_id=a.id;
 SELECT x.* INTO STRICT g FROM private.financial_agreements x JOIN private.funded_movement_activations e ON e.financial_agreement_id=x.id WHERE e.alignment_id=a.id;
 SELECT x.* INTO request FROM private.funded_movement_completion_requests x WHERE x.alignment_id=a.id;
 SELECT x.* INTO receipt FROM private.funded_movement_completions x WHERE x.alignment_id=a.id;
 SELECT x.* INTO response_window FROM private.funded_completion_response_windows x WHERE x.alignment_id=a.id;
 SELECT x.* INTO review FROM private.funded_completion_disputes x WHERE x.alignment_id=a.id;
 IF request.alignment_id IS NULL AND (response_window.alignment_id IS NOT NULL OR review.alignment_id IS NOT NULL) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Response evidence requires exact completion request'; END IF;
 IF request.alignment_id IS NOT NULL THEN
  IF response_window.alignment_id IS NULL OR response_window.financial_agreement_id IS DISTINCT FROM request.financial_agreement_id
   OR response_window.journey_id IS DISTINCT FROM request.journey_id OR response_window.requested_at IS DISTINCT FROM request.requested_at
   OR NOT isfinite(response_window.response_deadline_at) OR response_window.response_deadline_at IS DISTINCT FROM response_window.requested_at+interval '12 hours' THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact immutable response response_window required'; END IF;
 END IF;
 IF review.alignment_id IS NOT NULL THEN
  IF review.financial_agreement_id IS DISTINCT FROM g.id OR review.journey_id IS DISTINCT FROM j.id
   OR review.requester_member_id IS DISTINCT FROM a.member_needing_movement_id OR NOT isfinite(review.opened_at)
   OR review.opened_at>=response_window.response_deadline_at OR receipt.alignment_id IS NOT NULL
   OR a.status<>'in_progress' OR j.status<>'in_progress' THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact unsettled requester review required'; END IF;
 END IF;
 IF request.alignment_id IS NULL THEN
  IF receipt.alignment_id IS NOT NULL OR j.completion_requested_at IS NOT NULL OR j.completed_at IS NOT NULL
   OR a.status='completed' OR j.status='completed' THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact completion request required'; END IF;
 ELSE
  IF request.financial_agreement_id IS DISTINCT FROM g.id OR request.journey_id IS DISTINCT FROM j.id
   OR request.requested_at IS DISTINCT FROM j.completion_requested_at OR j.started_at IS NULL
   OR NOT isfinite(request.requested_at) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact historical completion request required'; END IF;
  IF receipt.alignment_id IS NULL THEN
   IF a.status<>'in_progress' OR j.status<>'in_progress' OR j.completed_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Unsettled completion must remain in progress'; END IF;
  ELSIF receipt.financial_agreement_id IS DISTINCT FROM g.id OR receipt.journey_id IS DISTINCT FROM j.id
   OR receipt.completed_at IS DISTINCT FROM j.completed_at OR NOT isfinite(receipt.completed_at)
   OR receipt.completion_method NOT IN ('requester_confirmed','response_timeout')
   -- Recorded timeout admission used this exact server observation against its
   -- immutable deadline. Never resample a clock to validate historical truth.
   OR (receipt.completion_method='response_timeout' AND receipt.completed_at<response_window.response_deadline_at) OR a.status<>'completed' OR j.status<>'completed' THEN
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
$function$;

CREATE OR REPLACE FUNCTION private.assert_funded_coordination_entry(p_alignment uuid)
 RETURNS journeys
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE r private.funded_movement_coordination_entries%ROWTYPE; j public.journeys%ROWTYPE;
 a public.alignments%ROWTYPE; g private.financial_agreements%ROWTYPE;
 request private.funded_movement_start_requests%ROWTYPE; started private.funded_movement_starts%ROWTYPE; mp private.journey_meeting_points%ROWTYPE;
BEGIN
 IF EXISTS(SELECT 1 FROM private.funded_no_travel_closures WHERE alignment_id=p_alignment) THEN
  PERFORM private.assert_funded_no_travel(p_alignment);
  SELECT x.* INTO STRICT j FROM public.journeys x JOIN private.funded_no_travel_closures d ON d.journey_id=x.id WHERE d.alignment_id=p_alignment; RETURN j;
 END IF;
 SELECT x.* INTO r FROM private.funded_movement_coordination_entries x WHERE x.alignment_id=p_alignment;
 SELECT x.* INTO a FROM public.alignments x WHERE x.id=p_alignment;
 SELECT x.* INTO g FROM private.financial_agreements x WHERE x.id=r.financial_agreement_id;
 SELECT x.* INTO j FROM public.journeys x WHERE x.id=r.journey_id;
 IF r.alignment_id IS NULL OR j.id IS NULL OR g.id IS NULL
  OR (SELECT count(*) FROM public.journeys WHERE alignment_id=p_alignment)<>1
  OR g.alignment_id IS DISTINCT FROM a.id OR j.alignment_id IS DISTINCT FROM a.id
  OR j.vehicle_id IS DISTINCT FROM (SELECT vehicle_id FROM public.movement_offers WHERE id=a.movement_offer_id)
  OR j.created_at IS DISTINCT FROM r.created_at OR NOT isfinite(r.created_at)
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
   OR NOT isfinite(request.requested_at)
   OR mp.journey_id IS NULL OR mp.revision IS DISTINCT FROM request.meeting_point_revision
   OR mp.place_text<>btrim(mp.place_text) OR length(mp.place_text) NOT BETWEEN 1 AND 200 OR mp.place_text !~ '[^[:space:]]' THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact frozen meeting point and start request required'; END IF;
  IF started.alignment_id IS NULL THEN
   IF a.status<>'activated' OR j.status<>'not_started' OR j.started_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact financial start confirmation required'; END IF;
  ELSIF started.journey_id IS DISTINCT FROM j.id OR started.started_at IS DISTINCT FROM j.started_at
   OR NOT isfinite(started.started_at)
   OR a.status NOT IN ('in_progress','completed') OR j.status IS DISTINCT FROM a.status THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Complete exact financial start required';
  END IF;
 END IF;
 PERFORM private.assert_funded_activation(g,a);
 PERFORM private.assert_funded_completion(a.id);
 RETURN j;
END;
$function$;

-- Ratings remain explicit human actions. Receipt-bound completion eligibility
-- and reviewer/target identity establish causality, not independent clocks.
CREATE OR REPLACE FUNCTION private.validate_completed_movement_rating()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE a public.alignments%ROWTYPE; need uuid; completed timestamptz;
BEGIN
 SELECT x.movement_need_id INTO STRICT need FROM public.alignments x WHERE x.id=NEW.alignment_id;
 a:=private.completed_movement_rating_alignment(need);
 SELECT r.completed_at INTO STRICT completed FROM private.funded_movement_completions r WHERE r.alignment_id=a.id;
 IF NEW.reviewer_member_id IS DISTINCT FROM auth.uid()
  OR NEW.reviewed_member_id IS DISTINCT FROM (CASE WHEN auth.uid()=a.offering_member_id THEN a.member_needing_movement_id ELSE a.offering_member_id END)
  OR NOT isfinite(NEW.submitted_at) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact historical rating required'; END IF;
 RETURN NEW;
END;
$function$;

-- 0001's unconditional numeric chronology CHECK also affects trusted funded
-- completion. Retain its exact legacy rule in a trigger; a funded exception
-- requires an exact receipt-bound finite stamp, then existing full financial
-- graph/ledger constraint validators still enforce the complete lifecycle.
ALTER TABLE public.journeys DROP CONSTRAINT journeys_check;
CREATE FUNCTION private.require_journey_completion_metadata()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $journey_time$
BEGIN
 IF NEW.completed_at IS NOT NULL AND NEW.started_at IS NOT NULL AND NEW.completed_at<NEW.started_at
  AND NOT EXISTS(SELECT 1 FROM private.funded_movement_completions r
   WHERE r.alignment_id=NEW.alignment_id AND r.journey_id=NEW.id AND r.completed_at=NEW.completed_at
    AND isfinite(r.completed_at)) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Journey completion requires exact temporal provenance'; END IF;
 RETURN NEW;
END;
$journey_time$;
CREATE TRIGGER require_journey_completion_metadata BEFORE INSERT OR UPDATE ON public.journeys
 FOR EACH ROW EXECUTE FUNCTION private.require_journey_completion_metadata();

CREATE FUNCTION private.bind_completion_response_window()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $window$
BEGIN
 INSERT INTO private.funded_completion_response_windows VALUES(NEW.alignment_id,NEW.financial_agreement_id,NEW.journey_id,NEW.requested_at,NEW.requested_at+interval '12 hours');
 RETURN NULL;
END;
$window$;
CREATE TRIGGER bind_completion_response_window AFTER INSERT ON private.funded_movement_completion_requests
 FOR EACH ROW EXECUTE FUNCTION private.bind_completion_response_window();

CREATE OR REPLACE FUNCTION private.require_funded_completion_actor()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $actor$
DECLARE a public.alignments%ROWTYPE; j public.journeys%ROWTYPE; g uuid; deadline timestamptz;
BEGIN
 SELECT x.* INTO STRICT a FROM public.alignments x WHERE x.id=NEW.alignment_id;
 a:=private.funded_coordination_alignment(a.movement_need_id);
 PERFORM x.id FROM public.journeys x WHERE x.alignment_id=a.id FOR UPDATE;
 PERFORM m.id FROM public.members m WHERE m.id IN(a.offering_member_id,a.member_needing_movement_id) ORDER BY m.id FOR UPDATE;
 j:=private.assert_funded_coordination_entry(a.id);
 SELECT financial_agreement_id INTO STRICT g FROM private.funded_movement_activations WHERE alignment_id=a.id;
 IF NEW.journey_id IS DISTINCT FROM j.id OR NEW.financial_agreement_id IS DISTINCT FROM g
  OR a.status<>'in_progress' OR j.status<>'in_progress' OR j.completed_at IS NOT NULL THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact in-progress financial movement required'; END IF;
 IF TG_TABLE_NAME='funded_movement_completion_requests' THEN
  IF auth.uid() IS DISTINCT FROM a.offering_member_id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Exact offerer required'; END IF;
  IF j.completion_requested_at IS NOT NULL OR NOT isfinite(NEW.requested_at) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact first completion request required'; END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM private.funded_completion_disputes WHERE alignment_id=a.id) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Completion is under review'; END IF;
  IF j.completion_requested_at IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact offerer completion request required'; END IF;
  IF NEW.completion_method='requester_confirmed' THEN
   IF auth.uid() IS DISTINCT FROM a.member_needing_movement_id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Exact requester required'; END IF;
  ELSIF NEW.completion_method='response_timeout' THEN
   IF auth.uid() NOT IN(a.offering_member_id,a.member_needing_movement_id) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Exact timeout principal required'; END IF;
  ELSE RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact completion method required'; END IF;
  SELECT w.response_deadline_at INTO STRICT deadline FROM private.funded_completion_response_windows w
   WHERE w.alignment_id=a.id AND w.financial_agreement_id=g AND w.journey_id=j.id
    AND w.requested_at=j.completion_requested_at;
  -- Live policy admission ONLY, after canonical construction and money waits.
  -- One server observation chooses the basis and supplies all RETURNING metadata.
  NEW.completed_at:=clock_timestamp();
  IF NEW.completed_at>=deadline THEN
   NEW.completion_method:='response_timeout';
  ELSIF NEW.completion_method='response_timeout' THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Response window remains open';
  END IF;
 END IF;
 RETURN NEW;
END;
$actor$;

CREATE FUNCTION private.require_completion_dispute_actor()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $review$
DECLARE a public.alignments%ROWTYPE; j public.journeys%ROWTYPE; w private.funded_completion_response_windows%ROWTYPE;
BEGIN
 SELECT x.* INTO STRICT a FROM public.alignments x WHERE x.id=NEW.alignment_id;
 a:=private.funded_coordination_alignment(a.movement_need_id);
 PERFORM x.id FROM public.journeys x WHERE x.alignment_id=a.id FOR UPDATE;
 PERFORM m.id FROM public.members m WHERE m.id IN(a.offering_member_id,a.member_needing_movement_id) ORDER BY m.id FOR UPDATE;
 j:=private.assert_funded_coordination_entry(a.id);
 SELECT * INTO STRICT w FROM private.funded_completion_response_windows WHERE alignment_id=a.id;
 IF auth.uid() IS DISTINCT FROM a.member_needing_movement_id OR NEW.requester_member_id IS DISTINCT FROM auth.uid()
  OR NEW.financial_agreement_id IS DISTINCT FROM w.financial_agreement_id OR NEW.journey_id IS DISTINCT FROM w.journey_id
  OR j.status<>'in_progress' OR a.status<>'in_progress' OR j.completion_requested_at IS NULL
  OR EXISTS(SELECT 1 FROM private.funded_movement_completions WHERE alignment_id=a.id) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact requester completion review required'; END IF;
 -- Single server observation admits the live response-window decision.
 NEW.opened_at:=clock_timestamp();
 IF NEW.opened_at>=w.response_deadline_at THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Response window expired'; END IF;
 RETURN NEW;
END;
$review$;
CREATE TRIGGER require_completion_dispute_actor BEFORE INSERT ON private.funded_completion_disputes
 FOR EACH ROW EXECUTE FUNCTION private.require_completion_dispute_actor();
CREATE CONSTRAINT TRIGGER completion_dispute_complete AFTER INSERT ON private.funded_completion_disputes
 DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION private.validate_funded_completion_graph();

CREATE FUNCTION private.reject_completion_review_progress()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $freeze$
DECLARE selected uuid; g private.financial_agreements%ROWTYPE;
BEGIN
 selected:=NEW.alignment_id;
 IF TG_TABLE_NAME='wallet_transactions' THEN
  IF NEW.transaction_kind NOT IN('movement_hold_release','requester_platform_charge','movement_contribution_settlement','offering_platform_charge') THEN RETURN NEW; END IF;
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
 IF EXISTS(SELECT 1 FROM private.funded_completion_disputes WHERE alignment_id=selected) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Completion is under review'; END IF;
 RETURN NEW;
END;
$freeze$;
CREATE TRIGGER completion_review_blocks_completion BEFORE INSERT ON private.funded_movement_completions
 FOR EACH ROW EXECUTE FUNCTION private.reject_completion_review_progress();
CREATE TRIGGER completion_review_blocks_disposition BEFORE INSERT ON private.wallet_transactions
 FOR EACH ROW EXECUTE FUNCTION private.reject_completion_review_progress();

CREATE OR REPLACE FUNCTION private.require_funded_settlement_transaction()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE c private.financial_components%ROWTYPE; g private.financial_agreements%ROWTYPE; r private.funded_movement_completions%ROWTYPE; kind text;
BEGIN
 IF NEW.financial_component_id IS NULL THEN RETURN NEW; END IF;
 SELECT x.* INTO STRICT c FROM private.financial_components x WHERE x.id=NEW.financial_component_id;
 SELECT x.* INTO STRICT g FROM private.financial_agreements x WHERE x.id=c.agreement_id;
 -- Unmaterialized legacy agreements retain their existing foundation behavior.
 IF NOT EXISTS(SELECT 1 FROM private.financial_proposals WHERE financial_agreement_id=g.id) THEN RETURN NEW; END IF;
 IF NEW.transaction_kind='movement_hold' THEN RETURN NEW; END IF;
 IF NEW.transaction_kind='movement_hold_release' THEN
  IF c.component_key NOT IN('requester_platform_share','movement_contribution') OR c.amount_minor<=0
   OR NEW.alignment_id IS DISTINCT FROM g.alignment_id OR NEW.currency IS DISTINCT FROM g.currency
   OR NEW.idempotency_key IS DISTINCT FROM 'movement_hold_release:'||c.id::text
   OR NEW.provider IS NOT NULL OR NEW.provider_reference IS NOT NULL
   OR NOT EXISTS(SELECT 1 FROM private.funded_no_travel_closures d WHERE d.alignment_id=g.alignment_id
    AND d.financial_agreement_id=g.id AND d.second_principal_id=auth.uid() AND d.released_at=NEW.created_at) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact disposition-backed release required'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.transaction_kind NOT IN ('requester_platform_charge','movement_contribution_settlement','offering_platform_charge') THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Unsupported financial component ledger action'; END IF;
 SELECT x.* INTO r FROM private.funded_movement_completions x WHERE x.alignment_id=g.alignment_id;
 kind:=CASE c.component_key WHEN 'requester_platform_share' THEN 'requester_platform_charge'
  WHEN 'movement_contribution' THEN 'movement_contribution_settlement' ELSE 'offering_platform_charge' END;
 IF auth.uid() IS NULL OR NOT (auth.uid()=g.member_needing_movement_id OR
  (r.completion_method='response_timeout' AND auth.uid()=g.offering_member_id)) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Exact settlement requester required'; END IF;
 IF EXISTS(SELECT 1 FROM private.funded_completion_disputes WHERE alignment_id=g.alignment_id) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Completion is under review'; END IF;
 IF r.alignment_id IS NULL OR r.financial_agreement_id IS DISTINCT FROM g.id OR c.amount_minor<=0
  OR NEW.alignment_id IS DISTINCT FROM g.alignment_id OR NEW.currency IS DISTINCT FROM g.currency
  OR NEW.transaction_kind IS DISTINCT FROM kind OR NEW.idempotency_key IS DISTINCT FROM kind||':'||c.id::text
  OR NEW.created_at IS DISTINCT FROM r.completed_at OR NEW.provider IS NOT NULL OR NEW.provider_reference IS NOT NULL THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact completion-backed settlement required'; END IF;
 RETURN NEW;
END;
$function$;

CREATE FUNCTION private.finalize_funded_completion(p_movement_need_id uuid,p_method text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE a public.alignments%ROWTYPE; j public.journeys%ROWTYPE; g private.financial_agreements%ROWTYPE;
 account record; owner uuid; stamp timestamptz;
 held_id uuid; withdrawable_id uuid; revenue_id uuid;
 r numeric; contribution numeric; o numeric; held numeric; withdrawable numeric:=0; revenue numeric:=0;
 balance numeric; maximum constant numeric:=9223372036854775807;
BEGIN
 a:=private.funded_coordination_alignment(p_movement_need_id);
 IF p_method NOT IN ('requester_confirmed','response_timeout') OR p_method IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact completion method required'; END IF;
 IF (p_method='requester_confirmed' AND auth.uid() IS DISTINCT FROM a.member_needing_movement_id)
  OR (p_method='response_timeout' AND auth.uid() NOT IN(a.member_needing_movement_id,a.offering_member_id)) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Exact completion principal required'; END IF;
 PERFORM x.id FROM public.journeys x WHERE x.alignment_id=a.id FOR UPDATE;
 j:=private.assert_funded_coordination_entry(a.id);
 IF EXISTS(SELECT 1 FROM private.funded_movement_completions WHERE alignment_id=a.id) THEN
  RETURN;
 END IF;
 IF a.status<>'in_progress' OR j.status<>'in_progress' OR j.completion_requested_at IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact offerer completion request required'; END IF;
 IF EXISTS(SELECT 1 FROM private.funded_completion_disputes WHERE alignment_id=a.id) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Completion is under review'; END IF;
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
  -- The receipt actor trigger takes the sole admission sample and chooses the
  -- effective method after these waits; callers never supply temporal authority.
  stamp:=NULL;
  -- A single statement constructs the complete graph. Every writable stage
  -- consumes RETURNING from its predecessor. Immediate constraint triggers run
  -- at statement end, after all postings and both lifecycle updates; deferred
  -- callers retain their mode and also receive the explicit full assertion below.
  WITH evidence AS (
   INSERT INTO private.funded_movement_completions AS receipt VALUES(a.id,g.id,j.id,stamp,p_method)
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
 RETURN;
END;
$function$;

-- Return shape changes are explicit. Recreate only these three audited RPCs;
-- re-establish their exact authenticated-only EXECUTE grants below.
DROP FUNCTION public.get_my_funded_movement_completion_status(uuid);
DROP FUNCTION public.request_my_funded_movement_completion(uuid);
DROP FUNCTION public.confirm_my_funded_movement_completion(uuid);
CREATE FUNCTION public.get_my_funded_movement_completion_status(p_movement_need_id uuid)
 RETURNS TABLE(journey_state text,completion_requested_at timestamptz,completed_at timestamptz,
 can_request_completion boolean,can_confirm_completion boolean,settlement_state text,
 response_deadline_at timestamptz,completion_method text,can_dispute_completion boolean,dispute_active boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $status$
DECLARE a public.alignments%ROWTYPE; j public.journeys%ROWTYPE; w private.funded_completion_response_windows%ROWTYPE; r private.funded_movement_completions%ROWTYPE; review boolean;
BEGIN
 a:=private.funded_coordination_alignment(p_movement_need_id);
 PERFORM x.id FROM public.journeys x WHERE x.alignment_id=a.id FOR UPDATE;
 j:=private.assert_funded_coordination_entry(a.id);
 SELECT * INTO w FROM private.funded_completion_response_windows WHERE alignment_id=a.id;
 review:=EXISTS(SELECT 1 FROM private.funded_completion_disputes WHERE alignment_id=a.id);
 -- The sole live policy is window expiry. Historical validators never sample it.
 IF j.status='in_progress' AND w.alignment_id IS NOT NULL AND NOT review AND clock_timestamp()>=w.response_deadline_at THEN
  PERFORM private.finalize_funded_completion(p_movement_need_id,'response_timeout');
  j:=private.assert_funded_coordination_entry(a.id);
 END IF;
 SELECT * INTO r FROM private.funded_movement_completions WHERE alignment_id=a.id;
 RETURN QUERY SELECT j.status,j.completion_requested_at,j.completed_at,
  auth.uid()=a.offering_member_id AND j.status='in_progress' AND j.completion_requested_at IS NULL,
  auth.uid()=a.member_needing_movement_id AND j.status='in_progress' AND j.completion_requested_at IS NOT NULL AND NOT review,
  CASE WHEN j.status='completed' THEN 'settled'::text WHEN review THEN 'under_review'::text WHEN w.alignment_id IS NOT NULL THEN 'awaiting_confirmation'::text ELSE 'not_ready'::text END,
  w.response_deadline_at,r.completion_method,
  auth.uid()=a.member_needing_movement_id AND j.status='in_progress' AND w.alignment_id IS NOT NULL AND NOT review,
  review;
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION USING ERRCODE=SQLSTATE,MESSAGE='Movement completion unavailable';
END;
$status$;

CREATE FUNCTION public.request_my_funded_movement_completion(p_movement_need_id uuid)
 RETURNS TABLE(journey_state text,completion_requested_at timestamptz,completed_at timestamptz,
 can_request_completion boolean,can_confirm_completion boolean,settlement_state text,
 response_deadline_at timestamptz,completion_method text,can_dispute_completion boolean,dispute_active boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 -- Observe the request only after both principal construction gates.
 PERFORM m.id FROM public.members m WHERE m.id IN(a.offering_member_id,a.member_needing_movement_id) ORDER BY m.id FOR UPDATE;
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
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION USING ERRCODE=SQLSTATE,MESSAGE='Movement completion unavailable';
END;
$function$;

CREATE FUNCTION public.confirm_my_funded_movement_completion(p_movement_need_id uuid)
 RETURNS TABLE(journey_state text,completion_requested_at timestamptz,completed_at timestamptz,
 can_request_completion boolean,can_confirm_completion boolean,settlement_state text,
 response_deadline_at timestamptz,completion_method text,can_dispute_completion boolean,dispute_active boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $confirm$
BEGIN
 PERFORM private.finalize_funded_completion(p_movement_need_id,'requester_confirmed');
 RETURN QUERY SELECT * FROM public.get_my_funded_movement_completion_status(p_movement_need_id);
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION USING ERRCODE=SQLSTATE,MESSAGE='Movement completion unavailable';
END;
$confirm$;
CREATE FUNCTION public.dispute_my_funded_movement_completion(p_movement_need_id uuid,p_reason_category text)
 RETURNS TABLE(journey_state text,completion_requested_at timestamptz,completed_at timestamptz,
 can_request_completion boolean,can_confirm_completion boolean,settlement_state text,
 response_deadline_at timestamptz,completion_method text,can_dispute_completion boolean,dispute_active boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $dispute$
DECLARE a public.alignments%ROWTYPE; w private.funded_completion_response_windows%ROWTYPE; review private.funded_completion_disputes%ROWTYPE;
BEGIN
 IF p_reason_category IS NULL OR p_reason_category NOT IN('completion_concern','movement_concern') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Bounded review category required'; END IF;
 a:=private.funded_coordination_alignment(p_movement_need_id);
 IF auth.uid() IS DISTINCT FROM a.member_needing_movement_id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Exact requester required'; END IF;
 PERFORM x.id FROM public.journeys x WHERE x.alignment_id=a.id FOR UPDATE;
 PERFORM m.id FROM public.members m WHERE m.id IN(a.offering_member_id,a.member_needing_movement_id) ORDER BY m.id FOR UPDATE;
 SELECT * INTO STRICT w FROM private.funded_completion_response_windows WHERE alignment_id=a.id;
 SELECT * INTO review FROM private.funded_completion_disputes WHERE alignment_id=a.id;
 IF review.alignment_id IS NOT NULL THEN
  IF review.reason_category IS DISTINCT FROM p_reason_category THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Conflicting completion review'; END IF;
 ELSE
  INSERT INTO private.funded_completion_disputes VALUES(a.id,w.financial_agreement_id,w.journey_id,auth.uid(),NULL,p_reason_category);
 END IF;
 RETURN QUERY SELECT * FROM public.get_my_funded_movement_completion_status(p_movement_need_id);
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION USING ERRCODE=SQLSTATE,MESSAGE='Movement completion unavailable';
END;
$dispute$;

REVOKE ALL ON FUNCTION private.require_journey_completion_metadata(),private.bind_completion_response_window(),private.require_completion_dispute_actor(),private.reject_completion_review_progress(),private.finalize_funded_completion(uuid,text)
 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.get_my_funded_movement_completion_status(uuid),public.request_my_funded_movement_completion(uuid),public.confirm_my_funded_movement_completion(uuid),public.dispute_my_funded_movement_completion(uuid,text)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_my_funded_movement_completion_status(uuid),public.request_my_funded_movement_completion(uuid),public.confirm_my_funded_movement_completion(uuid),public.dispute_my_funded_movement_completion(uuid,text) TO authenticated;
-- Validate migrated historical chains without reinterpreting wall-clock ordering.
DO $validate$ DECLARE item record; BEGIN
 FOR item IN SELECT alignment_id FROM private.funded_movement_completion_requests LOOP
  PERFORM private.assert_funded_coordination_entry(item.alignment_id);
 END LOOP;
END; $validate$;
COMMIT;
