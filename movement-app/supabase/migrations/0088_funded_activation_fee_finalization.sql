BEGIN;

-- Seal the old timing policy using exact existing activation provenance. No
-- historical fee, event, timestamp or transaction is invented or rewritten.
LOCK TABLE private.funded_movement_activations IN SHARE ROW EXCLUSIVE MODE;
DO $audit$ DECLARE x record; BEGIN
 FOR x IN SELECT g AS agreement,a AS alignment FROM private.funded_movement_activations f
  JOIN private.financial_agreements g ON g.id=f.financial_agreement_id JOIN public.alignments a ON a.id=f.alignment_id LOOP
  PERFORM private.assert_funded_activation(x.agreement,x.alignment);
 END LOOP;
END; $audit$;
ALTER TABLE private.funded_movement_activations ADD CONSTRAINT funded_activation_exact_stamp UNIQUE(financial_agreement_id,alignment_id,activated_at);
CREATE TABLE private.funded_activation_fee_legacy (
 financial_agreement_id uuid PRIMARY KEY, alignment_id uuid NOT NULL UNIQUE, activated_at timestamptz NOT NULL CHECK(isfinite(activated_at)),
 FOREIGN KEY(financial_agreement_id,alignment_id,activated_at) REFERENCES private.funded_movement_activations(financial_agreement_id,alignment_id,activated_at)
);
INSERT INTO private.funded_activation_fee_legacy SELECT financial_agreement_id,alignment_id,activated_at FROM private.funded_movement_activations;
CREATE TABLE private.funded_activation_fee_finalizations (
 financial_agreement_id uuid PRIMARY KEY, alignment_id uuid NOT NULL UNIQUE,
 financial_component_id uuid NOT NULL UNIQUE REFERENCES private.financial_components(id),
 requester_member_id uuid NOT NULL REFERENCES public.members(id), amount_minor bigint NOT NULL CHECK(amount_minor>=0),
 currency text NOT NULL CHECK(currency='NGN'), finalized_at timestamptz NOT NULL CHECK(isfinite(finalized_at)),
 FOREIGN KEY(financial_agreement_id,alignment_id,finalized_at) REFERENCES private.funded_movement_activations(financial_agreement_id,alignment_id,activated_at)
);
ALTER TABLE private.funded_activation_fee_legacy ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.funded_activation_fee_finalizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.funded_activation_fee_legacy,private.funded_activation_fee_finalizations FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER protect_activation_fee_legacy BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON private.funded_activation_fee_legacy
 FOR EACH STATEMENT EXECUTE FUNCTION private.protect_wallet_ledger_row();
CREATE TRIGGER protect_activation_fee_finalizations BEFORE UPDATE OR DELETE OR TRUNCATE ON private.funded_activation_fee_finalizations
 FOR EACH STATEMENT EXECUTE FUNCTION private.protect_wallet_ledger_row();

CREATE TABLE private.funded_no_travel_holds (
 alignment_id uuid PRIMARY KEY REFERENCES public.alignments(id),
 financial_agreement_id uuid NOT NULL UNIQUE REFERENCES private.financial_agreements(id),
 journey_id uuid NOT NULL UNIQUE REFERENCES public.journeys(id),
 request_id uuid NOT NULL UNIQUE REFERENCES private.funded_no_travel_requests(id),
 first_principal_id uuid NOT NULL REFERENCES public.members(id),
 second_principal_id uuid NOT NULL REFERENCES public.members(id),
 requested_at timestamptz NOT NULL CHECK(isfinite(requested_at)),
 observed_at timestamptz NOT NULL CHECK(isfinite(observed_at)),
 pending_start_requested_at timestamptz,
 CHECK(first_principal_id<>second_principal_id),
 CHECK(pending_start_requested_at IS NULL OR isfinite(pending_start_requested_at))
);
ALTER TABLE private.funded_no_travel_holds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.funded_no_travel_holds FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER no_travel_hold_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON private.funded_no_travel_holds
 FOR EACH STATEMENT EXECUTE FUNCTION private.protect_wallet_ledger_row();

CREATE FUNCTION private.activation_fee_is_finalized(p_agreement uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $policy$
 SELECT EXISTS(SELECT 1 FROM private.funded_activation_fee_finalizations WHERE financial_agreement_id=p_agreement);
$policy$;

CREATE FUNCTION private.assert_activation_fee_finalization(p_agreement uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fee$
DECLARE f private.funded_activation_fee_finalizations%ROWTYPE; g private.financial_agreements%ROWTYPE;
 a private.funded_movement_activations%ROWTYPE; c private.financial_components%ROWTYPE;
 t private.wallet_transactions%ROWTYPE; debit_id uuid; credit_id uuid; n bigint; matches bigint;
BEGIN
 SELECT * INTO STRICT g FROM private.financial_agreements WHERE id=p_agreement;
 SELECT * INTO STRICT a FROM private.funded_movement_activations WHERE financial_agreement_id=g.id;
 SELECT * INTO f FROM private.funded_activation_fee_finalizations WHERE financial_agreement_id=g.id;
 IF EXISTS(SELECT 1 FROM private.funded_activation_fee_legacy WHERE financial_agreement_id=g.id AND alignment_id=a.alignment_id AND activated_at=a.activated_at) THEN
  IF f.financial_agreement_id IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Conflicting activation fee policy'; END IF;
  RETURN;
 END IF;
 SELECT * INTO STRICT c FROM private.financial_components WHERE agreement_id=g.id AND component_key='requester_platform_share';
 IF f.financial_agreement_id IS NULL OR f.alignment_id IS DISTINCT FROM g.alignment_id OR a.alignment_id IS DISTINCT FROM g.alignment_id
  OR f.financial_component_id IS DISTINCT FROM c.id OR f.requester_member_id IS DISTINCT FROM g.member_needing_movement_id
  OR f.amount_minor IS DISTINCT FROM c.amount_minor OR f.currency IS DISTINCT FROM g.currency
  OR f.finalized_at IS DISTINCT FROM a.activated_at OR NOT isfinite(f.finalized_at) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact activation fee finalization required'; END IF;
 SELECT * INTO t FROM private.wallet_transactions WHERE idempotency_key='requester_platform_charge:'||c.id::text;
 SELECT count(*) INTO n FROM private.wallet_transactions WHERE financial_component_id=c.id AND transaction_kind='requester_platform_charge';
 IF EXISTS(SELECT 1 FROM private.wallet_transactions WHERE financial_component_id=c.id AND transaction_kind IN('movement_hold_release','movement_contribution_settlement','offering_platform_charge')) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Activation platform share is non-refundable'; END IF;
 IF c.amount_minor=0 THEN
  IF t.id IS NOT NULL OR n<>0 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Zero activation fee has no transaction'; END IF;
  RETURN;
 END IF;
 SELECT id INTO debit_id FROM private.wallet_accounts WHERE member_id=g.member_needing_movement_id AND currency=g.currency AND account_kind='member_held';
 SELECT id INTO credit_id FROM private.wallet_accounts WHERE member_id IS NULL AND currency=g.currency AND account_kind='platform_revenue';
 IF n<>1 OR t.id IS NULL OR t.transaction_kind IS DISTINCT FROM 'requester_platform_charge'
  OR t.financial_component_id IS DISTINCT FROM c.id OR t.alignment_id IS DISTINCT FROM g.alignment_id OR t.currency IS DISTINCT FROM g.currency
  OR t.created_at IS DISTINCT FROM f.finalized_at OR t.provider IS NOT NULL OR t.provider_reference IS NOT NULL
  OR debit_id IS NULL OR credit_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact activation charge transaction required'; END IF;
 SELECT count(*),count(*) FILTER(WHERE amount_minor=c.amount_minor AND created_at=f.finalized_at AND isfinite(created_at)
  AND ((account_id=debit_id AND direction='debit') OR (account_id=credit_id AND direction='credit')))
  INTO n,matches FROM private.wallet_postings WHERE transaction_id=t.id;
 IF n<>2 OR matches<>2 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact activation charge postings required'; END IF;
 PERFORM private.assert_wallet_transaction_balanced(t.id);
END;
$fee$;

CREATE FUNCTION private.require_activation_fee_actor()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $actor$
DECLARE g private.financial_agreements%ROWTYPE; a public.alignments%ROWTYPE; c private.financial_components%ROWTYPE; f private.funded_movement_activations%ROWTYPE; funding record;
 account record; balance numeric; held numeric; revenue numeric; revenue_id uuid;
BEGIN
 SELECT * INTO STRICT g FROM private.financial_agreements WHERE id=NEW.financial_agreement_id;
 g:=private.funded_activation_agreement(g.id,g.version,true);
 SELECT * INTO STRICT a FROM public.alignments WHERE id=g.alignment_id;
 PERFORM private.assert_alignment_face_ready(a.id);
 SELECT * INTO STRICT c FROM private.financial_components WHERE agreement_id=g.id AND component_key='requester_platform_share';
 SELECT * INTO STRICT f FROM private.funded_movement_activations WHERE financial_agreement_id=g.id;
 SELECT * INTO funding FROM private.movement_funding_evidence(g);
 IF g.status<>'current' OR a.status<>'awaiting_activation_payment' OR a.activated_at IS NOT NULL
  OR NEW.alignment_id IS DISTINCT FROM a.id OR NEW.financial_component_id IS DISTINCT FROM c.id
  OR NEW.requester_member_id IS DISTINCT FROM auth.uid() OR NEW.requester_member_id IS DISTINCT FROM g.member_needing_movement_id
  OR NEW.amount_minor IS DISTINCT FROM c.amount_minor OR NEW.currency IS DISTINCT FROM g.currency
  OR NEW.finalized_at IS DISTINCT FROM f.activated_at OR NOT isfinite(NEW.finalized_at)
  OR funding.fully_held_at IS NULL OR funding.held_minor<>funding.required_minor
  OR EXISTS(SELECT 1 FROM private.funded_activation_fee_legacy WHERE financial_agreement_id=g.id)
  OR EXISTS(SELECT 1 FROM private.required_face_members(a.id) r WHERE NOT private.has_current_alignment_face_check(a.id,r.member_id,NEW.finalized_at)) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact requester activation construction required'; END IF;
 -- Trusted direct constructors must obey the same member/account gates and
 -- active-wallet, aggregate-balance and overflow admission as the public RPC.
 PERFORM x.id FROM private.wallet_accounts x WHERE x.member_id=g.member_needing_movement_id AND x.currency=g.currency ORDER BY x.id FOR UPDATE;
 IF (SELECT count(*) FROM private.wallet_accounts WHERE member_id=g.member_needing_movement_id AND currency=g.currency)<>3
  OR EXISTS(SELECT 1 FROM private.wallet_accounts WHERE member_id=g.member_needing_movement_id AND currency=g.currency AND status<>'active') THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Complete active activation wallet required'; END IF;
 FOR account IN SELECT * FROM private.wallet_accounts WHERE member_id=g.member_needing_movement_id AND currency=g.currency LOOP
  SELECT coalesce(sum(CASE WHEN direction='credit' THEN amount_minor::numeric ELSE -amount_minor::numeric END),0) INTO balance FROM private.wallet_postings WHERE account_id=account.id;
  IF balance<0 OR balance>9223372036854775807::numeric THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Activation wallet outside supported range'; END IF;
  IF account.account_kind='member_held' THEN held:=balance; END IF;
 END LOOP;
 IF held IS NULL OR held<funding.required_minor THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact activation obligations must remain held'; END IF;
 IF c.amount_minor>0 THEN
  SELECT id INTO STRICT revenue_id FROM private.wallet_accounts WHERE member_id IS NULL AND currency=g.currency AND account_kind='platform_revenue' FOR UPDATE;
  IF NOT EXISTS(SELECT 1 FROM private.wallet_accounts WHERE id=revenue_id AND status='active') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Active revenue account required'; END IF;
  SELECT coalesce(sum(CASE WHEN direction='credit' THEN amount_minor::numeric ELSE -amount_minor::numeric END),0) INTO revenue FROM private.wallet_postings WHERE account_id=revenue_id;
  IF revenue<0 OR revenue+c.amount_minor>9223372036854775807::numeric THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Activation revenue outside supported range'; END IF;
 END IF;
 RETURN NEW;
END;
$actor$;
CREATE TRIGGER require_activation_fee_actor BEFORE INSERT ON private.funded_activation_fee_finalizations
 FOR EACH ROW EXECUTE FUNCTION private.require_activation_fee_actor();

CREATE OR REPLACE FUNCTION private.assert_funded_activation(g private.financial_agreements, a alignments)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE receipt private.funded_movement_activations%ROWTYPE; evidence record; p private.financial_proposals%ROWTYPE;
BEGIN
 SELECT x.* INTO receipt FROM private.funded_movement_activations x WHERE x.financial_agreement_id=g.id;
 SELECT * INTO evidence FROM private.movement_funding_evidence(g);
 IF receipt.financial_agreement_id IS NULL OR receipt.alignment_id IS DISTINCT FROM a.id
  OR g.alignment_id IS DISTINCT FROM a.id OR receipt.activated_at IS DISTINCT FROM a.activated_at
  OR a.status NOT IN ('activated','in_progress','completed','cancelled')
  OR evidence.fully_held_at IS NULL OR evidence.held_minor<>evidence.required_minor
  OR NOT isfinite(receipt.activated_at) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact historical funded activation required'; END IF;
 SELECT x.* INTO STRICT p FROM private.financial_proposals x WHERE x.financial_agreement_id=g.id;
 -- Receipt certifies current prepared/verified media and member flags at the
 -- original gate. Historical checks do not demand that media remain current now.
 IF EXISTS (
  (SELECT g.offering_member_id AS member_id UNION SELECT t.member_id FROM private.movement_context_snapshot_travellers t WHERE t.snapshot_id=p.movement_context_snapshot_id)
  EXCEPT SELECT x.member_id FROM private.funded_movement_activation_faces x WHERE x.financial_agreement_id=g.id
 ) OR EXISTS (
  SELECT x.member_id FROM private.funded_movement_activation_faces x WHERE x.financial_agreement_id=g.id
  EXCEPT (SELECT g.offering_member_id UNION SELECT t.member_id FROM private.movement_context_snapshot_travellers t WHERE t.snapshot_id=p.movement_context_snapshot_id)
 ) OR EXISTS (
  SELECT 1 FROM private.funded_movement_activation_faces x
  LEFT JOIN private.alignment_face_verifications f ON f.id=x.face_verification_id
  WHERE x.financial_agreement_id=g.id AND (f.id IS NULL OR f.alignment_id IS DISTINCT FROM a.id
   OR f.member_id IS DISTINCT FROM x.member_id OR f.status<>'succeeded'
   OR f.liveness_passed IS DISTINCT FROM true OR f.face_match_passed IS DISTINCT FROM true
   OR f.completed_at IS NULL
   OR f.completed_at>=f.expires_at OR f.expires_at<=receipt.activated_at
   OR NOT isfinite(f.started_at) OR NOT isfinite(f.completed_at) OR NOT isfinite(f.expires_at)
   OR f.attempt_ordinal IS NULL OR f.attempt_ordinal<=0)
 ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact historical activation face evidence required'; END IF;
 PERFORM private.assert_activation_fee_finalization(g.id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.activate_my_funded_movement(p_financial_agreement_id uuid, p_expected_agreement_version integer)
 RETURNS TABLE(financial_agreement_id uuid, agreement_version integer, alignment_id uuid, alignment_status text, activated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE g private.financial_agreements%ROWTYPE; a public.alignments%ROWTYPE; evidence record; stamp timestamptz; component private.financial_components%ROWTYPE;
 held_id uuid; revenue_id uuid; account record; balance numeric; held numeric; revenue numeric;
BEGIN
 g:=private.funded_activation_agreement(p_financial_agreement_id,p_expected_agreement_version,true);
 SELECT x.* INTO STRICT a FROM public.alignments x WHERE x.id=g.alignment_id;
 IF EXISTS(SELECT 1 FROM private.funded_movement_activations x WHERE x.financial_agreement_id=g.id) THEN
  PERFORM private.assert_funded_activation(g,a);
  RETURN QUERY SELECT g.id,g.version,a.id,a.status,a.activated_at; RETURN;
 END IF;
 IF g.status<>'current' OR a.status<>'awaiting_activation_payment' OR a.activated_at IS NOT NULL THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Current pre-activation agreement required'; END IF;
 -- Existing gate owns alignment -> need -> every required member in UUID order.
 PERFORM private.assert_alignment_face_ready(a.id);
 SELECT * INTO evidence FROM private.movement_funding_evidence(g);
 IF evidence.fully_held_at IS NULL OR evidence.held_minor<>evidence.required_minor THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Completed exact requester funding required'; END IF;
 -- Capture time AFTER every wait, and check the same authoritative face predicate
 -- at precisely the timestamp to be recorded (not a statement-start timestamp).
 SELECT * INTO STRICT component FROM private.financial_components WHERE agreement_id=g.id AND component_key='requester_platform_share';
 -- Face readiness already owns the sorted required-member gates. All account
 -- locks follow those gates, and no SHARE lock is upgraded.
 PERFORM x.id FROM private.wallet_accounts x WHERE x.member_id=g.member_needing_movement_id AND x.currency=g.currency ORDER BY x.id FOR UPDATE;
 IF (SELECT count(*) FROM private.wallet_accounts WHERE member_id=g.member_needing_movement_id AND currency=g.currency)<>3
  OR EXISTS(SELECT 1 FROM private.wallet_accounts WHERE member_id=g.member_needing_movement_id AND currency=g.currency AND status<>'active') THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Complete active activation wallet required'; END IF;
 FOR account IN SELECT * FROM private.wallet_accounts WHERE member_id=g.member_needing_movement_id AND currency=g.currency LOOP
  SELECT coalesce(sum(CASE WHEN direction='credit' THEN amount_minor::numeric ELSE -amount_minor::numeric END),0) INTO balance FROM private.wallet_postings WHERE account_id=account.id;
  IF balance<0 OR balance>9223372036854775807::numeric THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Activation wallet outside supported range'; END IF;
  IF account.account_kind='member_held' THEN held_id:=account.id;held:=balance; END IF;
 END LOOP;
 IF held<evidence.required_minor THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact activation obligations must remain held'; END IF;
 IF component.amount_minor>0 THEN
  INSERT INTO private.wallet_accounts(member_id,account_kind,currency) VALUES(NULL,'platform_revenue',g.currency)
   ON CONFLICT(account_kind,currency) WHERE member_id IS NULL DO NOTHING;
  SELECT id INTO STRICT revenue_id FROM private.wallet_accounts WHERE member_id IS NULL AND currency=g.currency AND account_kind='platform_revenue' FOR UPDATE;
  IF NOT EXISTS(SELECT 1 FROM private.wallet_accounts WHERE id=revenue_id AND status='active') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Active revenue account required'; END IF;
  SELECT coalesce(sum(CASE WHEN direction='credit' THEN amount_minor::numeric ELSE -amount_minor::numeric END),0) INTO revenue FROM private.wallet_postings WHERE account_id=revenue_id;
  IF revenue<0 OR revenue+component.amount_minor>9223372036854775807::numeric THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Activation revenue outside supported range'; END IF;
 END IF;
 -- The authoritative activation/fee observation follows every construction,
 -- account/provisioning/revenue wait. It is paired metadata, not chronology.
 stamp:=clock_timestamp();
 IF EXISTS(SELECT 1 FROM private.required_face_members(a.id) r
  WHERE NOT private.has_current_alignment_face_check(a.id,r.member_id,stamp)) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Fresh face verification required'; END IF;
 WITH activated AS (
  INSERT INTO private.funded_movement_activations VALUES(g.id,a.id,stamp) RETURNING *
 ), faces AS (
  INSERT INTO private.funded_movement_activation_faces AS face(financial_agreement_id,member_id,face_verification_id)
  SELECT e.financial_agreement_id,r.member_id,(SELECT f.id FROM private.alignment_face_verifications f WHERE f.alignment_id=a.id AND f.member_id=r.member_id ORDER BY f.attempt_ordinal DESC LIMIT 1)
   FROM activated e CROSS JOIN LATERAL private.required_face_members(e.alignment_id) r RETURNING face.financial_agreement_id
 ), fee AS (
  INSERT INTO private.funded_activation_fee_finalizations
  SELECT e.financial_agreement_id,e.alignment_id,component.id,g.member_needing_movement_id,component.amount_minor,g.currency,e.activated_at
   FROM activated e WHERE (SELECT count(*) FROM faces)>=0 RETURNING *
 ), charge AS (
  INSERT INTO private.wallet_transactions(transaction_kind,currency,alignment_id,financial_component_id,idempotency_key,created_at)
  SELECT 'requester_platform_charge',f.currency,f.alignment_id,f.financial_component_id,'requester_platform_charge:'||f.financial_component_id::text,f.finalized_at FROM fee f WHERE f.amount_minor>0
  RETURNING id,created_at
 ), postings AS (
  INSERT INTO private.wallet_postings(transaction_id,account_id,direction,amount_minor,created_at)
  SELECT t.id,CASE side.direction WHEN 'debit' THEN held_id ELSE revenue_id END,side.direction,component.amount_minor,t.created_at
   FROM charge t CROSS JOIN (VALUES('debit'::text),('credit'::text)) side(direction) RETURNING id
 ) UPDATE public.alignments x SET status='activated',activated_at=f.finalized_at,updated_at=f.finalized_at
   FROM fee f WHERE x.id=f.alignment_id AND (SELECT count(*) FROM postings)>=0 RETURNING x.* INTO a;
 PERFORM private.assert_funded_activation(g,a);
 RETURN QUERY SELECT g.id,g.version,a.id,a.status,a.activated_at;
END;
$function$;

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
 PERFORM private.assert_activation_fee_finalization(g.id);
 FOR c IN SELECT x.* FROM private.financial_components x WHERE x.agreement_id=g.id ORDER BY x.id LOOP
  IF c.component_key='requester_platform_share' AND private.activation_fee_is_finalized(g.id) THEN CONTINUE; END IF;
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

CREATE OR REPLACE FUNCTION private.assert_funded_no_travel(p_alignment uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE a public.alignments%ROWTYPE; j public.journeys%ROWTYPE; g private.financial_agreements%ROWTYPE;
 e private.funded_movement_coordination_entries%ROWTYPE; r private.funded_no_travel_requests%ROWTYPE;
 d private.funded_no_travel_closures%ROWTYPE; c private.financial_components%ROWTYPE;
 t private.wallet_transactions%ROWTYPE; sr private.funded_movement_start_requests%ROWTYPE;
 mp private.journey_meeting_points%ROWTYPE; available_id uuid; held_id uuid; n bigint; matches bigint;
BEGIN
 SELECT x.* INTO STRICT a FROM public.alignments x WHERE x.id=p_alignment;
 SELECT x.* INTO STRICT e FROM private.funded_movement_coordination_entries x WHERE x.alignment_id=a.id;
 SELECT x.* INTO STRICT j FROM public.journeys x WHERE x.id=e.journey_id;
 SELECT x.* INTO STRICT g FROM private.financial_agreements x WHERE x.id=e.financial_agreement_id;
 g:=private.movement_funding_agreement(g.id,g.member_needing_movement_id,g.version);
 PERFORM private.assert_funded_activation(g,a);
 -- Reuse 0083's complete absence/partial-settlement proof, including component
 -- keys whose transaction alignment was forged or belongs to another graph.
 PERFORM private.assert_funded_completion(a.id);
 SELECT x.* INTO d FROM private.funded_no_travel_closures x WHERE x.alignment_id=a.id;
 IF d.alignment_id IS NOT NULL AND private.activation_fee_is_finalized(g.id) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Activated contribution remains held for review'; END IF;
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
    AND (transaction_kind IN ('offering_platform_charge','movement_contribution_settlement')
     OR (transaction_kind='requester_platform_charge' AND NOT private.activation_fee_is_finalized(g.id)))) THEN
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
  IF d.alignment_id IS NULL OR c.amount_minor=0 OR c.component_key='offering_platform_share' OR (c.component_key='requester_platform_share' AND private.activation_fee_is_finalized(g.id)) THEN
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
$function$;

CREATE OR REPLACE FUNCTION private.assert_undisposed_funded_graph(p_alignment uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE a public.alignments%ROWTYPE; j public.journeys%ROWTYPE; g private.financial_agreements%ROWTYPE;
 e private.funded_movement_coordination_entries%ROWTYPE; r private.funded_no_travel_requests%ROWTYPE;
 d private.funded_no_travel_closures%ROWTYPE; c private.financial_components%ROWTYPE;
 t private.wallet_transactions%ROWTYPE; sr private.funded_movement_start_requests%ROWTYPE;
 mp private.journey_meeting_points%ROWTYPE; available_id uuid; held_id uuid; n bigint; matches bigint;
BEGIN
 SELECT x.* INTO STRICT a FROM public.alignments x WHERE x.id=p_alignment;
 IF EXISTS(SELECT 1 FROM private.funded_no_travel_holds WHERE alignment_id=a.id) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='No-travel funds remain held for review'; END IF;
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
 IF d.alignment_id IS NOT NULL AND private.activation_fee_is_finalized(g.id) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Activated contribution remains held for review'; END IF;
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
    AND (transaction_kind IN ('offering_platform_charge','movement_contribution_settlement')
     OR (transaction_kind='requester_platform_charge' AND NOT private.activation_fee_is_finalized(g.id)))) THEN
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
  IF d.alignment_id IS NULL OR c.amount_minor=0 OR c.component_key='offering_platform_share' OR (c.component_key='requester_platform_share' AND private.activation_fee_is_finalized(g.id)) THEN
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
$function$;

CREATE OR REPLACE FUNCTION private.mutate_funded_no_travel(p_need uuid, p_action text, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE a public.alignments%ROWTYPE; r private.funded_no_travel_requests%ROWTYPE;
 d private.funded_no_travel_closures%ROWTYPE; h private.funded_no_travel_holds%ROWTYPE; j public.journeys%ROWTYPE; g private.financial_agreements%ROWTYPE;
BEGIN
 IF p_action NOT IN('request','confirm','decline') OR p_action IS NULL
  OR (p_reason IS NOT NULL AND (length(btrim(p_reason)) NOT BETWEEN 1 AND 500)) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Movement end unavailable'; END IF;
 a:=private.funded_no_travel_alignment(p_need);
 -- Consent receipt FKs also acquire member KEY SHARE locks. Take BOTH principal
 -- UPDATE gates in 0083 UUID order before any receipt insert, even for request
 -- and decline, so later confirmation never upgrades an implicit FK lock.
 PERFORM m.id FROM public.members m WHERE m.id IN(a.offering_member_id,a.member_needing_movement_id) ORDER BY m.id FOR UPDATE;
 SELECT * INTO h FROM private.funded_no_travel_holds WHERE alignment_id=a.id;
 IF h.alignment_id IS NOT NULL THEN
  PERFORM private.assert_held_no_travel(a.id);
  SELECT * INTO STRICT r FROM private.funded_no_travel_requests WHERE id=h.request_id;
  IF (p_action='request' AND auth.uid()=h.first_principal_id AND p_reason IS NOT DISTINCT FROM r.reason)
   OR (p_action='confirm' AND auth.uid()=h.second_principal_id) THEN RETURN; END IF;
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Conflicting held no-travel action';
 END IF;
 SELECT * INTO d FROM private.funded_no_travel_closures WHERE alignment_id=a.id;
 IF d.alignment_id IS NOT NULL THEN
  SELECT * INTO STRICT r FROM private.funded_no_travel_requests WHERE id=d.request_id;
  IF (p_action='request' AND auth.uid()=d.first_principal_id AND p_reason IS NOT DISTINCT FROM r.reason)
   OR (p_action='confirm' AND auth.uid()=d.second_principal_id) THEN RETURN; END IF;
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Conflicting terminal action';
 END IF;
 SELECT q.* INTO r FROM private.funded_no_travel_requests q WHERE q.alignment_id=a.id
  AND NOT EXISTS(SELECT 1 FROM private.funded_no_travel_declines z WHERE z.request_id=q.id);
 IF p_action='request' THEN
  IF r.id IS NOT NULL THEN
   IF r.first_principal_id=auth.uid() AND r.reason IS NOT DISTINCT FROM p_reason THEN RETURN; END IF;
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Explicit confirmation required'; END IF;
  SELECT x.* INTO STRICT j FROM public.journeys x WHERE x.alignment_id=a.id;
  INSERT INTO private.funded_no_travel_requests(alignment_id,financial_agreement_id,journey_id,first_principal_id,requested_at,reason)
   SELECT a.id,e.financial_agreement_id,j.id,auth.uid(),clock_timestamp(),p_reason FROM private.funded_movement_coordination_entries e WHERE e.alignment_id=a.id;
  PERFORM private.assert_funded_no_travel(a.id); RETURN;
 END IF;
 IF r.id IS NULL OR r.first_principal_id=auth.uid() THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Other principal request required'; END IF;
 IF p_action='decline' THEN
  INSERT INTO private.funded_no_travel_declines VALUES(r.id,auth.uid(),clock_timestamp());
  PERFORM private.assert_funded_no_travel(a.id); RETURN;
 END IF;
 SELECT * INTO STRICT j FROM public.journeys WHERE id=r.journey_id;
 SELECT * INTO STRICT g FROM private.financial_agreements WHERE id=r.financial_agreement_id;
 -- Neither new nor legacy activated users can create a new refund receipt.
 -- Preserve existing legacy release history above; otherwise record no travel
 -- without changing the original held amounts or fee timing.
 INSERT INTO private.funded_no_travel_holds
  VALUES(a.id,g.id,j.id,r.id,r.first_principal_id,auth.uid(),r.requested_at,clock_timestamp(),j.start_requested_at);
 PERFORM private.assert_held_no_travel(a.id);
END;
$function$;

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
 IF c.component_key='requester_platform_share' AND private.activation_fee_is_finalized(g.id) THEN
  IF auth.uid() IS DISTINCT FROM g.member_needing_movement_id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Exact activation requester required'; END IF;
  PERFORM id FROM private.financial_agreements WHERE id=g.id FOR SHARE;
  PERFORM id FROM public.alignments WHERE id=g.alignment_id FOR UPDATE;
  IF NEW.transaction_kind IS DISTINCT FROM 'requester_platform_charge' OR c.amount_minor<=0
   OR NEW.alignment_id IS DISTINCT FROM g.alignment_id OR NEW.currency IS DISTINCT FROM g.currency
   OR NEW.idempotency_key IS DISTINCT FROM 'requester_platform_charge:'||c.id::text
   OR NEW.provider IS NOT NULL OR NEW.provider_reference IS NOT NULL
   OR NOT EXISTS(SELECT 1 FROM private.funded_activation_fee_finalizations f JOIN private.funded_movement_activations a ON a.financial_agreement_id=f.financial_agreement_id
    JOIN public.alignments lifecycle ON lifecycle.id=a.alignment_id WHERE f.financial_agreement_id=g.id
     AND f.financial_component_id=c.id AND f.finalized_at=NEW.created_at AND a.activated_at=f.finalized_at
     AND lifecycle.status='awaiting_activation_payment' AND lifecycle.activated_at IS NULL) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact activation-backed requester charge required'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.transaction_kind='movement_hold_release' THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='No user release after funded activation';
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

CREATE OR REPLACE FUNCTION private.finalize_funded_completion(p_movement_need_id uuid, p_method text)
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
 IF private.activation_fee_is_finalized(g.id) THEN r:=0; END IF;
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
   WHERE c.amount_minor>0 AND (c.component_key<>'requester_platform_share' OR NOT private.activation_fee_is_finalized(g.id))
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

CREATE OR REPLACE FUNCTION public.get_my_movement_end_status_by_need(p_movement_need_id uuid)
 RETURNS TABLE(journey_state text, end_status text, requested_by_me boolean, action_required_from_me boolean, requested_at timestamp with time zone, completed_at timestamp with time zone, funding_disposition text, released_minor bigint, currency text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE a public.alignments%ROWTYPE; j public.journeys%ROWTYPE; r private.funded_no_travel_requests%ROWTYPE;
 d private.funded_no_travel_closures%ROWTYPE; selected uuid; amount bigint;
BEGIN
 IF EXISTS(SELECT 1 FROM public.alignments x WHERE x.movement_need_id=p_movement_need_id AND private.is_financial_alignment(x.id)) THEN
  a:=private.funded_no_travel_alignment(p_movement_need_id);
  SELECT * INTO STRICT j FROM public.journeys WHERE alignment_id=a.id;
  IF EXISTS(SELECT 1 FROM private.funded_no_travel_holds WHERE alignment_id=a.id) THEN
   PERFORM private.assert_held_no_travel(a.id);
   RETURN QUERY SELECT 'not_started'::text,'no_travel_held'::text,false,false,h.requested_at,NULL::timestamptz,
    'held_review_required'::text,NULL::bigint,'NGN'::text FROM private.funded_no_travel_holds h WHERE h.alignment_id=a.id;
   RETURN;
  END IF;
  SELECT * INTO d FROM private.funded_no_travel_closures WHERE alignment_id=a.id;
  IF d.alignment_id IS NOT NULL THEN
   SELECT sum(amount_minor::numeric)::bigint INTO amount FROM private.financial_components WHERE agreement_id=d.financial_agreement_id
    AND (component_key='movement_contribution' OR (component_key='requester_platform_share' AND NOT private.activation_fee_is_finalized(d.financial_agreement_id)));
   RETURN QUERY SELECT 'cancelled'::text,'mutual_no_travel'::text,false,false,d.requested_at,NULL::timestamptz,
    CASE WHEN auth.uid()=a.member_needing_movement_id THEN 'released_to_me'::text ELSE 'released_to_requester'::text END,amount,'NGN'::text;
  ELSE
   SELECT q.* INTO r FROM private.funded_no_travel_requests q WHERE q.alignment_id=a.id
    AND NOT EXISTS(SELECT 1 FROM private.funded_no_travel_declines z WHERE z.request_id=q.id);
   RETURN QUERY SELECT j.status,CASE WHEN r.id IS NULL THEN 'no_pending_end_request'::text
    WHEN r.first_principal_id=auth.uid() THEN 'awaiting_other_member'::text ELSE 'action_required_from_me'::text END,
    coalesce(r.first_principal_id=auth.uid(),false),coalesce(r.first_principal_id<>auth.uid(),false),r.requested_at,NULL::timestamptz,
    'held'::text,NULL::bigint,'NGN'::text;
  END IF; RETURN;
 END IF;
 selected:=private.movement_end_context(p_movement_need_id);
 RETURN QUERY SELECT s.journey_status,s.end_status,s.requested_by_me,s.action_required_from_me,s.requested_at,s.completed_at,
  'legacy'::text,NULL::bigint,NULL::text FROM public.get_my_movement_end_status(selected) s;
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Movement end unavailable';
END;
$function$;

CREATE FUNCTION private.validate_activation_fee_graph()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $graph$
DECLARE selected uuid; g private.financial_agreements%ROWTYPE; a public.alignments%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='wallet_postings' THEN SELECT alignment_id INTO selected FROM private.wallet_transactions WHERE id=NEW.transaction_id;
 ELSE selected:=NEW.alignment_id; END IF;
 SELECT x.* INTO g FROM private.financial_agreements x JOIN private.funded_movement_activations f ON f.financial_agreement_id=x.id WHERE f.alignment_id=selected;
 IF g.id IS NOT NULL THEN SELECT * INTO STRICT a FROM public.alignments WHERE id=selected; PERFORM private.assert_funded_activation(g,a); END IF;
 RETURN NULL;
END;
$graph$;
CREATE CONSTRAINT TRIGGER activation_fee_complete AFTER INSERT ON private.funded_activation_fee_finalizations DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION private.validate_activation_fee_graph();
CREATE CONSTRAINT TRIGGER activation_requires_fee AFTER INSERT ON private.funded_movement_activations DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION private.validate_activation_fee_graph();
CREATE CONSTRAINT TRIGGER activation_charge_complete AFTER INSERT ON private.wallet_transactions DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION private.validate_activation_fee_graph();
CREATE CONSTRAINT TRIGGER activation_posting_complete AFTER INSERT ON private.wallet_postings DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION private.validate_activation_fee_graph();
REVOKE ALL ON FUNCTION private.activation_fee_is_finalized(uuid),private.assert_activation_fee_finalization(uuid),private.require_activation_fee_actor(),private.validate_activation_fee_graph() FROM PUBLIC,anon,authenticated,service_role;

-- A non-start decision and a refund are distinct immutable facts. The original
-- lifecycle stays not_started; this receipt freezes progress without alleging
-- fault, inventing cancellation/refund history, or moving any wallet amount.
CREATE FUNCTION private.assert_held_no_travel(p_alignment uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $held_truth$
DECLARE h private.funded_no_travel_holds%ROWTYPE; r private.funded_no_travel_requests%ROWTYPE;
 a public.alignments%ROWTYPE; e private.funded_movement_coordination_entries%ROWTYPE; j public.journeys%ROWTYPE;
BEGIN
 SELECT * INTO h FROM private.funded_no_travel_holds WHERE alignment_id=p_alignment;
 IF h.alignment_id IS NULL THEN RETURN; END IF;
 SELECT * INTO STRICT a FROM public.alignments WHERE id=p_alignment;
 SELECT * INTO STRICT e FROM private.funded_movement_coordination_entries WHERE alignment_id=p_alignment;
 SELECT * INTO STRICT j FROM public.journeys WHERE id=e.journey_id;
 SELECT * INTO STRICT r FROM private.funded_no_travel_requests WHERE id=h.request_id;
 PERFORM private.assert_funded_no_travel(p_alignment);
 IF h.financial_agreement_id IS DISTINCT FROM e.financial_agreement_id OR h.journey_id IS DISTINCT FROM e.journey_id
  OR NOT EXISTS(SELECT 1 FROM private.funded_movement_activations WHERE financial_agreement_id=h.financial_agreement_id AND alignment_id=a.id)
  OR r.alignment_id IS DISTINCT FROM a.id OR r.financial_agreement_id IS DISTINCT FROM h.financial_agreement_id
  OR r.journey_id IS DISTINCT FROM h.journey_id OR h.first_principal_id IS DISTINCT FROM r.first_principal_id
  OR h.second_principal_id NOT IN(a.offering_member_id,a.member_needing_movement_id)
  OR h.first_principal_id=h.second_principal_id OR h.requested_at IS DISTINCT FROM r.requested_at
  OR NOT isfinite(h.observed_at) OR h.pending_start_requested_at IS DISTINCT FROM j.start_requested_at
  OR EXISTS(SELECT 1 FROM private.funded_no_travel_declines WHERE request_id=h.request_id)
  OR EXISTS(SELECT 1 FROM private.funded_movement_disputes WHERE alignment_id=a.id)
  OR EXISTS(SELECT 1 FROM private.funded_no_travel_closures WHERE alignment_id=a.id) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact held no-travel provenance required'; END IF;
END;
$held_truth$;

CREATE FUNCTION private.require_held_no_travel_actor()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $held_actor$
DECLARE a public.alignments%ROWTYPE; r private.funded_no_travel_requests%ROWTYPE; e private.funded_movement_coordination_entries%ROWTYPE; j public.journeys%ROWTYPE;
BEGIN
 SELECT * INTO STRICT a FROM public.alignments WHERE id=NEW.alignment_id;
 a:=private.funded_no_travel_alignment(a.movement_need_id);
 PERFORM m.id FROM public.members m WHERE m.id IN(a.offering_member_id,a.member_needing_movement_id) ORDER BY m.id FOR UPDATE;
 SELECT * INTO STRICT r FROM private.funded_no_travel_requests WHERE id=NEW.request_id;
 SELECT * INTO STRICT e FROM private.funded_movement_coordination_entries WHERE alignment_id=a.id;
 SELECT * INTO STRICT j FROM public.journeys WHERE id=e.journey_id;
 IF NOT EXISTS(SELECT 1 FROM private.funded_movement_activations WHERE financial_agreement_id=NEW.financial_agreement_id AND alignment_id=a.id)
  OR NEW.financial_agreement_id IS DISTINCT FROM e.financial_agreement_id OR NEW.journey_id IS DISTINCT FROM j.id
  OR r.alignment_id IS DISTINCT FROM a.id OR r.financial_agreement_id IS DISTINCT FROM e.financial_agreement_id
  OR r.journey_id IS DISTINCT FROM j.id OR NEW.first_principal_id IS DISTINCT FROM r.first_principal_id
  OR NEW.second_principal_id IS DISTINCT FROM auth.uid() OR r.first_principal_id=auth.uid()
  OR auth.uid() NOT IN(a.offering_member_id,a.member_needing_movement_id)
  OR NEW.requested_at IS DISTINCT FROM r.requested_at OR NOT isfinite(NEW.observed_at)
  OR NEW.pending_start_requested_at IS DISTINCT FROM j.start_requested_at
  OR EXISTS(SELECT 1 FROM private.funded_no_travel_declines WHERE request_id=r.id)
  OR EXISTS(SELECT 1 FROM private.funded_movement_disputes WHERE alignment_id=a.id) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact distinct no-travel consent required'; END IF;
 RETURN NEW;
END;
$held_actor$;
CREATE TRIGGER require_held_no_travel_actor BEFORE INSERT ON private.funded_no_travel_holds
 FOR EACH ROW EXECUTE FUNCTION private.require_held_no_travel_actor();

CREATE FUNCTION private.reject_held_no_travel_progress()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $held_gate$
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
 IF EXISTS(SELECT 1 FROM private.funded_no_travel_holds WHERE alignment_id=selected) THEN
  PERFORM private.assert_held_no_travel(selected);
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='No travel recorded; contribution held for review'; END IF;
 RETURN NEW;
END;
$held_gate$;
CREATE TRIGGER held_no_travel_blocks_start_request BEFORE INSERT ON private.funded_movement_start_requests FOR EACH ROW EXECUTE FUNCTION private.reject_held_no_travel_progress();
CREATE TRIGGER held_no_travel_blocks_start BEFORE INSERT ON private.funded_movement_starts FOR EACH ROW EXECUTE FUNCTION private.reject_held_no_travel_progress();
CREATE TRIGGER held_no_travel_blocks_completion_request BEFORE INSERT ON private.funded_movement_completion_requests FOR EACH ROW EXECUTE FUNCTION private.reject_held_no_travel_progress();
CREATE TRIGGER held_no_travel_blocks_completion BEFORE INSERT ON private.funded_movement_completions FOR EACH ROW EXECUTE FUNCTION private.reject_held_no_travel_progress();
CREATE TRIGGER held_no_travel_blocks_disposition BEFORE INSERT ON private.wallet_transactions FOR EACH ROW EXECUTE FUNCTION private.reject_held_no_travel_progress();

CREATE FUNCTION private.validate_held_no_travel_graph()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $held_graph$
BEGIN
 IF TG_TABLE_NAME='alignments' THEN PERFORM private.assert_held_no_travel(NEW.id);
 ELSE PERFORM private.assert_held_no_travel(NEW.alignment_id); END IF;
 RETURN NULL;
END;
$held_graph$;
CREATE CONSTRAINT TRIGGER held_no_travel_complete AFTER INSERT ON private.funded_no_travel_holds DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION private.validate_held_no_travel_graph();
CREATE CONSTRAINT TRIGGER held_no_travel_journey_frozen AFTER UPDATE ON public.journeys DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION private.validate_held_no_travel_graph();
CREATE CONSTRAINT TRIGGER held_no_travel_alignment_frozen AFTER UPDATE ON public.alignments DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION private.validate_held_no_travel_graph();
REVOKE ALL ON FUNCTION private.assert_held_no_travel(uuid),private.require_held_no_travel_actor(),private.reject_held_no_travel_progress(),private.validate_held_no_travel_graph() FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.require_funded_no_travel_actor()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE a public.alignments%ROWTYPE; r private.funded_no_travel_requests%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='funded_no_travel_declines' THEN
  SELECT * INTO STRICT r FROM private.funded_no_travel_requests WHERE id=NEW.request_id;
  SELECT * INTO STRICT a FROM public.alignments WHERE id=r.alignment_id;
 ELSE SELECT * INTO STRICT a FROM public.alignments WHERE id=NEW.alignment_id; END IF;
 IF auth.uid() IS NULL OR auth.uid() NOT IN(a.offering_member_id,a.member_needing_movement_id)
  OR a.status<>'activated' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact principal pre-start action required'; END IF;
 IF EXISTS(SELECT 1 FROM private.funded_no_travel_holds WHERE alignment_id=a.id)
  OR TG_TABLE_NAME='funded_no_travel_closures' THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='No user release or new intent after held no-travel'; END IF;
 PERFORM private.assert_funded_no_travel(a.id);
 IF TG_TABLE_NAME='funded_no_travel_requests' THEN
  IF NEW.first_principal_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact requesting principal required'; END IF;
 ELSE
  IF TG_TABLE_NAME='funded_no_travel_closures' THEN SELECT * INTO STRICT r FROM private.funded_no_travel_requests WHERE id=NEW.request_id; END IF;
  IF NEW.second_principal_id IS DISTINCT FROM auth.uid() OR r.first_principal_id=auth.uid()
   OR r.alignment_id IS DISTINCT FROM a.id OR EXISTS(SELECT 1 FROM private.funded_no_travel_declines WHERE request_id=r.id) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact distinct confirming principal required'; END IF;
 END IF;
 RETURN NEW;
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
 PERFORM private.assert_held_no_travel(a.id);
 RETURN j;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_movement_start_status(p_movement_need_id uuid)
 RETURNS TABLE(meeting_point_text text, meeting_point_revision bigint, journey_state text, start_requested_at timestamp with time zone, started_at timestamp with time zone, can_edit_meeting_point boolean, can_request_start boolean, can_confirm_start boolean, start_authority text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT mp.place_text,mp.revision,c.journey_status,c.requested_at,c.began_at,
  (auth.uid() IN (c.offering_id,c.requester_id) AND c.journey_status='not_started' AND NOT EXISTS(SELECT 1 FROM private.funded_no_travel_holds h WHERE h.alignment_id=c.alignment_id) AND c.requested_at IS NULL),
  (auth.uid()=c.offering_id AND c.journey_status='not_started' AND NOT EXISTS(SELECT 1 FROM private.funded_no_travel_holds h WHERE h.alignment_id=c.alignment_id) AND c.requested_at IS NULL AND mp.journey_id IS NOT NULL),
  (auth.uid()=c.requester_id AND c.journey_status='not_started' AND NOT EXISTS(SELECT 1 FROM private.funded_no_travel_holds h WHERE h.alignment_id=c.alignment_id) AND c.requested_at IS NOT NULL AND mp.journey_id IS NOT NULL),
  CASE WHEN private.is_financial_alignment(c.alignment_id) THEN 'funded'::text ELSE 'legacy'::text END
 FROM private.movement_coordination_context(p_movement_need_id) c
 LEFT JOIN private.journey_meeting_points mp ON mp.journey_id=c.journey_id;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_funded_movement_dispute_status(p_movement_need_id uuid)
 RETURNS TABLE(dispute_active boolean, can_open boolean, opened_by_me boolean, opened_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  d.alignment_id IS NULL AND a.status='activated' AND j.status='not_started' AND NOT EXISTS(SELECT 1 FROM private.funded_no_travel_holds h WHERE h.alignment_id=a.id),
  coalesce(d.opened_by_member_id=auth.uid(),false),d.opened_at;
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Movement review unavailable';
END;
$function$;

-- Audit full existing coordination history with the corrected finite-provenance
-- validators. The old 0085 validator must not resample a later wall clock during
-- migration admission. Any forged/partial graph still aborts the whole migration.
DO $historical_audit$ DECLARE x record; BEGIN
 FOR x IN SELECT g AS agreement,a AS alignment FROM private.funded_movement_activations f
  JOIN private.financial_agreements g ON g.id=f.financial_agreement_id JOIN public.alignments a ON a.id=f.alignment_id LOOP
  PERFORM private.assert_funded_activation(x.agreement,x.alignment);
  IF EXISTS(SELECT 1 FROM private.funded_movement_coordination_entries WHERE alignment_id=(x.alignment).id) THEN
   PERFORM private.assert_funded_coordination_entry((x.alignment).id);
  END IF;
 END LOOP;
END; $historical_audit$;
COMMIT;
