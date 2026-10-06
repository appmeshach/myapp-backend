BEGIN;

-- Internal release only. Immutable 0078 obligations remain the money authority.
CREATE TABLE private.funded_no_travel_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 alignment_id uuid NOT NULL REFERENCES private.funded_movement_activations(alignment_id),
 financial_agreement_id uuid NOT NULL REFERENCES private.movement_funding_holds(financial_agreement_id),
 journey_id uuid NOT NULL REFERENCES public.journeys(id),
 first_principal_id uuid NOT NULL REFERENCES public.members(id),
 requested_at timestamptz NOT NULL CHECK(isfinite(requested_at)),
 reason text CHECK(reason IS NULL OR (reason=btrim(reason) AND length(reason) BETWEEN 1 AND 500))
);
CREATE INDEX funded_no_travel_requests_alignment ON private.funded_no_travel_requests(alignment_id);
CREATE TABLE private.funded_no_travel_declines (
 request_id uuid PRIMARY KEY REFERENCES private.funded_no_travel_requests(id),
 second_principal_id uuid NOT NULL REFERENCES public.members(id),
 declined_at timestamptz NOT NULL CHECK(isfinite(declined_at))
);
CREATE TABLE private.funded_no_travel_closures (
 alignment_id uuid PRIMARY KEY REFERENCES private.funded_movement_activations(alignment_id),
 financial_agreement_id uuid NOT NULL UNIQUE REFERENCES private.movement_funding_holds(financial_agreement_id),
 journey_id uuid NOT NULL UNIQUE REFERENCES public.journeys(id),
 request_id uuid NOT NULL UNIQUE REFERENCES private.funded_no_travel_requests(id),
 first_principal_id uuid NOT NULL REFERENCES public.members(id),
 second_principal_id uuid NOT NULL REFERENCES public.members(id),
 requested_at timestamptz NOT NULL CHECK(isfinite(requested_at)),
 released_at timestamptz NOT NULL CHECK(isfinite(released_at) AND released_at>=requested_at),
 pending_start_requested_at timestamptz,
 CHECK(first_principal_id<>second_principal_id)
);
ALTER TABLE private.funded_no_travel_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.funded_no_travel_declines ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.funded_no_travel_closures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.funded_no_travel_requests,private.funded_no_travel_declines,private.funded_no_travel_closures FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER protect_funded_no_travel_requests BEFORE UPDATE OR DELETE OR TRUNCATE ON private.funded_no_travel_requests
 FOR EACH STATEMENT EXECUTE FUNCTION private.protect_wallet_ledger_row();
CREATE TRIGGER protect_funded_no_travel_declines BEFORE UPDATE OR DELETE OR TRUNCATE ON private.funded_no_travel_declines
 FOR EACH STATEMENT EXECUTE FUNCTION private.protect_wallet_ledger_row();
CREATE TRIGGER protect_funded_no_travel_closures BEFORE UPDATE OR DELETE OR TRUNCATE ON private.funded_no_travel_closures
 FOR EACH STATEMENT EXECUTE FUNCTION private.protect_wallet_ledger_row();
CREATE UNIQUE INDEX wallet_transactions_one_component_release ON private.wallet_transactions(financial_component_id)
 WHERE transaction_kind='movement_hold_release';

-- Validates pending and terminal evidence without trusting balances or caller money.
CREATE FUNCTION private.assert_funded_no_travel(p_alignment uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $no_travel_graph$
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
 IF j.alignment_id IS DISTINCT FROM a.id OR g.alignment_id IS DISTINCT FROM a.id
  OR (SELECT count(*) FROM public.journeys WHERE alignment_id=a.id)<>1
  OR j.vehicle_id IS DISTINCT FROM (SELECT vehicle_id FROM public.movement_offers WHERE id=a.movement_offer_id)
  OR j.created_at IS DISTINCT FROM e.created_at OR e.created_at<a.activated_at OR e.created_at>clock_timestamp()
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
   OR sr.requested_at<e.created_at OR sr.requested_at>clock_timestamp()
   OR mp.journey_id IS NULL OR mp.revision IS DISTINCT FROM sr.meeting_point_revision
   OR mp.place_text<>btrim(mp.place_text) OR length(mp.place_text) NOT BETWEEN 1 AND 200 OR mp.place_text !~ '[^[:space:]]' THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact frozen pending start required'; END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM private.funded_no_travel_requests q WHERE q.alignment_id=a.id AND
  (q.financial_agreement_id IS DISTINCT FROM g.id OR q.journey_id IS DISTINCT FROM j.id
   OR q.first_principal_id NOT IN (a.offering_member_id,a.member_needing_movement_id)
   OR q.requested_at<e.created_at OR q.requested_at>clock_timestamp()))
  OR EXISTS(SELECT 1 FROM private.funded_no_travel_declines z JOIN private.funded_no_travel_requests q ON q.id=z.request_id
   WHERE q.alignment_id=a.id AND (z.second_principal_id=q.first_principal_id
    OR z.second_principal_id NOT IN(a.offering_member_id,a.member_needing_movement_id)
    OR z.declined_at<q.requested_at OR z.declined_at>clock_timestamp()))
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
   OR d.requested_at IS DISTINCT FROM r.requested_at OR d.released_at>clock_timestamp()
   OR d.pending_start_requested_at IS DISTINCT FROM j.start_requested_at
   OR (sr.alignment_id IS NOT NULL AND sr.requested_at>d.released_at)
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

CREATE FUNCTION private.funded_no_travel_alignment(p_need uuid)
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
 PERFORM private.assert_funded_no_travel(a.id);
 RETURN a;
END;
$$;

CREATE FUNCTION private.mutate_funded_no_travel(p_need uuid,p_action text,p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $no_travel_mutation$
DECLARE a public.alignments%ROWTYPE; r private.funded_no_travel_requests%ROWTYPE;
 d private.funded_no_travel_closures%ROWTYPE; j public.journeys%ROWTYPE; g private.financial_agreements%ROWTYPE;
 account private.wallet_accounts%ROWTYPE; stamp timestamptz; available_id uuid; held_id uuid;
 required numeric; available numeric; held numeric; balance numeric;
BEGIN
 IF p_action NOT IN('request','confirm','decline') OR p_action IS NULL
  OR (p_reason IS NOT NULL AND (length(btrim(p_reason)) NOT BETWEEN 1 AND 500)) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Movement end unavailable'; END IF;
 a:=private.funded_no_travel_alignment(p_need);
 -- Consent receipt FKs also acquire member KEY SHARE locks. Take BOTH principal
 -- UPDATE gates in 0083 UUID order before any receipt insert, even for request
 -- and decline, so later confirmation never upgrades an implicit FK lock.
 PERFORM m.id FROM public.members m WHERE m.id IN(a.offering_member_id,a.member_needing_movement_id) ORDER BY m.id FOR UPDATE;
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
 PERFORM x.id FROM private.wallet_accounts x WHERE x.member_id=g.member_needing_movement_id AND x.currency=g.currency ORDER BY x.id FOR UPDATE;
 -- Revalidate after wallet gate waits. No silent partial-history repair.
 PERFORM private.assert_funded_no_travel(a.id);
 IF (SELECT count(*) FROM private.wallet_accounts WHERE member_id=g.member_needing_movement_id AND currency=g.currency)<>3
  OR EXISTS(SELECT 1 FROM private.wallet_accounts WHERE member_id=g.member_needing_movement_id AND currency=g.currency AND status<>'active') THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Complete active requester wallet required'; END IF;
 SELECT sum(amount_minor::numeric) INTO required FROM private.financial_components WHERE agreement_id=g.id AND component_key IN('requester_platform_share','movement_contribution');
 FOR account IN SELECT * FROM private.wallet_accounts WHERE member_id=g.member_needing_movement_id AND currency=g.currency LOOP
  SELECT coalesce(sum(CASE WHEN direction='credit' THEN amount_minor::numeric ELSE -amount_minor::numeric END),0)
   INTO balance FROM private.wallet_postings WHERE account_id=account.id;
  IF balance<0 OR balance>9223372036854775807::numeric THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Wallet outside supported range'; END IF;
  IF account.account_kind='member_available' THEN available_id:=account.id;available:=balance; END IF;
  IF account.account_kind='member_held' THEN held_id:=account.id;held:=balance; END IF;
 END LOOP;
 IF held<required OR available+required>9223372036854775807::numeric THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Insufficient or overflowing release balance'; END IF;
 stamp:=clock_timestamp();
 -- One statement constructs the full graph for either immediate/deferred caller
 -- constraint mode. RETURNING dependencies expose receipts to row guards.
 WITH evidence AS (
  INSERT INTO private.funded_no_travel_closures VALUES(a.id,g.id,j.id,r.id,r.first_principal_id,auth.uid(),r.requested_at,stamp,j.start_requested_at)
  RETURNING *
 ), components AS MATERIALIZED (
  SELECT c.*,e.released_at FROM private.financial_components c JOIN evidence e ON e.financial_agreement_id=c.agreement_id
   WHERE c.component_key IN('requester_platform_share','movement_contribution') AND c.amount_minor>0
 ), transactions AS (
  INSERT INTO private.wallet_transactions(transaction_kind,currency,alignment_id,financial_component_id,idempotency_key,created_at)
   SELECT 'movement_hold_release',g.currency,a.id,c.id,'movement_hold_release:'||c.id::text,c.released_at FROM components c ORDER BY c.id
  RETURNING id,financial_component_id,created_at
 ), postings AS (
  INSERT INTO private.wallet_postings(transaction_id,account_id,direction,amount_minor,created_at)
   SELECT t.id,CASE side.direction WHEN 'debit' THEN held_id ELSE available_id END,side.direction,c.amount_minor,t.created_at
   FROM transactions t JOIN components c ON c.id=t.financial_component_id CROSS JOIN (VALUES('debit'::text),('credit'::text)) side(direction)
  RETURNING id
 ), cancelled_journey AS (
  UPDATE public.journeys x SET status='cancelled',updated_at=e.released_at FROM evidence e
   WHERE x.id=e.journey_id AND (SELECT count(*) FROM postings)>=0 RETURNING x.alignment_id,x.updated_at
 ) UPDATE public.alignments x SET status='cancelled',updated_at=y.updated_at FROM cancelled_journey y WHERE x.id=y.alignment_id;
 PERFORM private.assert_funded_no_travel(a.id);
END;
$no_travel_mutation$;

CREATE FUNCTION private.validate_funded_no_travel_graph()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE selected uuid;
BEGIN
 IF TG_TABLE_NAME='funded_no_travel_declines' THEN SELECT alignment_id INTO STRICT selected FROM private.funded_no_travel_requests WHERE id=NEW.request_id;
 ELSIF TG_TABLE_NAME='wallet_transactions' THEN
  IF NEW.transaction_kind<>'movement_hold_release' THEN RETURN NULL; END IF; selected:=NEW.alignment_id;
 ELSE selected:=NEW.alignment_id; END IF;
 PERFORM private.assert_funded_no_travel(selected); RETURN NULL;
END;
$$;
CREATE FUNCTION private.require_funded_no_travel_actor()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.alignments%ROWTYPE; r private.funded_no_travel_requests%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='funded_no_travel_declines' THEN
  SELECT * INTO STRICT r FROM private.funded_no_travel_requests WHERE id=NEW.request_id;
  SELECT * INTO STRICT a FROM public.alignments WHERE id=r.alignment_id;
 ELSE SELECT * INTO STRICT a FROM public.alignments WHERE id=NEW.alignment_id; END IF;
 IF auth.uid() IS NULL OR auth.uid() NOT IN(a.offering_member_id,a.member_needing_movement_id)
  OR a.status<>'activated' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact principal pre-start action required'; END IF;
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
$$;
CREATE TRIGGER require_funded_no_travel_request_actor BEFORE INSERT ON private.funded_no_travel_requests
 FOR EACH ROW EXECUTE FUNCTION private.require_funded_no_travel_actor();
CREATE TRIGGER require_funded_no_travel_decline_actor BEFORE INSERT ON private.funded_no_travel_declines
 FOR EACH ROW EXECUTE FUNCTION private.require_funded_no_travel_actor();
CREATE TRIGGER require_funded_no_travel_closure_actor BEFORE INSERT ON private.funded_no_travel_closures
 FOR EACH ROW EXECUTE FUNCTION private.require_funded_no_travel_actor();
CREATE CONSTRAINT TRIGGER funded_no_travel_request_complete AFTER INSERT ON private.funded_no_travel_requests
 DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION private.validate_funded_no_travel_graph();
CREATE CONSTRAINT TRIGGER funded_no_travel_decline_complete AFTER INSERT ON private.funded_no_travel_declines
 DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION private.validate_funded_no_travel_graph();
CREATE CONSTRAINT TRIGGER funded_no_travel_closure_complete AFTER INSERT ON private.funded_no_travel_closures
 DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION private.validate_funded_no_travel_graph();
CREATE CONSTRAINT TRIGGER funded_no_travel_release_complete AFTER INSERT ON private.wallet_transactions
 DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION private.validate_funded_no_travel_graph();

-- Forward replacements and public routing follow. No historical migration edits.

CREATE OR REPLACE FUNCTION private.assert_funded_coordination_entry(p_alignment uuid)
RETURNS public.journeys LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $coordination_graph$
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
  IF EXISTS(SELECT 1 FROM private.funded_no_travel_closures WHERE alignment_id=OLD.alignment_id) THEN
   IF OLD.status='not_started' AND OLD.started_at IS NULL AND NEW.status='cancelled'
    AND (to_jsonb(NEW)-ARRAY['status','updated_at']) IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','updated_at'])
    AND EXISTS(SELECT 1 FROM private.funded_no_travel_closures d WHERE d.alignment_id=OLD.alignment_id AND d.journey_id=OLD.id AND d.released_at=NEW.updated_at) THEN RETURN NEW; END IF;
   IF to_jsonb(NEW) IS NOT DISTINCT FROM to_jsonb(OLD) THEN RETURN NEW; END IF;
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Funded no-travel is terminal';
  END IF;
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
  IF EXISTS(SELECT 1 FROM private.funded_no_travel_closures WHERE alignment_id=OLD.id) THEN
   IF OLD.status='activated' AND NEW.status='cancelled'
    AND (to_jsonb(NEW)-ARRAY['status','updated_at']) IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','updated_at'])
    AND EXISTS(SELECT 1 FROM private.funded_no_travel_closures d WHERE d.alignment_id=OLD.id) THEN RETURN NEW; END IF;
   IF to_jsonb(NEW) IS NOT DISTINCT FROM to_jsonb(OLD) THEN RETURN NEW; END IF;
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Funded no-travel is terminal';
  END IF;
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

-- Narrow forward extension of 0083's component gate. Settlement validation below
-- is retained verbatim; release requires the new exact two-principal receipt.
CREATE OR REPLACE FUNCTION private.require_funded_settlement_transaction()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $settlement_actor$
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
 IF auth.uid() IS DISTINCT FROM g.member_needing_movement_id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Exact settlement requester required'; END IF;
 IF r.alignment_id IS NULL OR r.financial_agreement_id IS DISTINCT FROM g.id OR c.amount_minor<=0
  OR NEW.alignment_id IS DISTINCT FROM g.alignment_id OR NEW.currency IS DISTINCT FROM g.currency
  OR NEW.transaction_kind IS DISTINCT FROM kind OR NEW.idempotency_key IS DISTINCT FROM kind||':'||c.id::text
  OR NEW.created_at IS DISTINCT FROM r.completed_at OR NEW.provider IS NOT NULL OR NEW.provider_reference IS NOT NULL THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact completion-backed settlement required'; END IF;
 RETURN NEW;
END;
$settlement_actor$;

-- Same public argument contract; additive safe outcome fields. Legacy routing
-- still uses 0057/0019 and never invents financial evidence for historical rows.
DROP FUNCTION public.get_my_movement_end_status_by_need(uuid);
DROP FUNCTION public.request_my_movement_end(uuid,text);
DROP FUNCTION public.confirm_my_movement_end(uuid);
DROP FUNCTION public.decline_my_movement_end(uuid);
CREATE FUNCTION public.get_my_movement_end_status_by_need(p_movement_need_id uuid)
RETURNS TABLE(journey_state text,end_status text,requested_by_me boolean,action_required_from_me boolean,
 requested_at timestamptz,completed_at timestamptz,funding_disposition text,released_minor bigint,currency text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.alignments%ROWTYPE; j public.journeys%ROWTYPE; r private.funded_no_travel_requests%ROWTYPE;
 d private.funded_no_travel_closures%ROWTYPE; selected uuid; amount bigint;
BEGIN
 IF EXISTS(SELECT 1 FROM public.alignments x WHERE x.movement_need_id=p_movement_need_id AND private.is_financial_alignment(x.id)) THEN
  a:=private.funded_no_travel_alignment(p_movement_need_id);
  SELECT * INTO STRICT j FROM public.journeys WHERE alignment_id=a.id;
  SELECT * INTO d FROM private.funded_no_travel_closures WHERE alignment_id=a.id;
  IF d.alignment_id IS NOT NULL THEN
   SELECT sum(amount_minor::numeric)::bigint INTO amount FROM private.financial_components WHERE agreement_id=d.financial_agreement_id
    AND component_key IN('requester_platform_share','movement_contribution');
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
$$;

CREATE FUNCTION public.request_my_movement_end(p_movement_need_id uuid,p_reason text DEFAULT NULL)
RETURNS TABLE(journey_state text,end_status text,requested_by_me boolean,action_required_from_me boolean,
 requested_at timestamptz,completed_at timestamptz,funding_disposition text,released_minor bigint,currency text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE selected uuid;
BEGIN
 IF EXISTS(SELECT 1 FROM public.alignments x WHERE x.movement_need_id=p_movement_need_id AND private.is_financial_alignment(x.id)) THEN
  PERFORM private.mutate_funded_no_travel(p_movement_need_id,'request',NULLIF(btrim(p_reason),''));
 ELSE
  selected:=private.movement_end_context(p_movement_need_id);
  IF EXISTS(SELECT 1 FROM public.get_my_movement_end_status(selected) s WHERE s.action_required_from_me) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Explicit confirmation required'; END IF;
  PERFORM * FROM public.request_movement_end(selected,p_reason);
 END IF;
 RETURN QUERY SELECT * FROM public.get_my_movement_end_status_by_need(p_movement_need_id);
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Movement end unavailable';
END;
$$;
CREATE FUNCTION public.confirm_my_movement_end(p_movement_need_id uuid)
RETURNS TABLE(journey_state text,end_status text,requested_by_me boolean,action_required_from_me boolean,
 requested_at timestamptz,completed_at timestamptz,funding_disposition text,released_minor bigint,currency text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE selected uuid;
BEGIN
 IF EXISTS(SELECT 1 FROM public.alignments x WHERE x.movement_need_id=p_movement_need_id AND private.is_financial_alignment(x.id)) THEN
  PERFORM private.mutate_funded_no_travel(p_movement_need_id,'confirm');
 ELSE
  selected:=private.movement_end_context(p_movement_need_id); PERFORM * FROM public.confirm_movement_end(selected);
 END IF;
 RETURN QUERY SELECT * FROM public.get_my_movement_end_status_by_need(p_movement_need_id);
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Movement end unavailable';
END;
$$;
CREATE FUNCTION public.decline_my_movement_end(p_movement_need_id uuid)
RETURNS TABLE(journey_state text,end_status text,requested_by_me boolean,action_required_from_me boolean,
 requested_at timestamptz,completed_at timestamptz,funding_disposition text,released_minor bigint,currency text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE selected uuid;
BEGIN
 IF EXISTS(SELECT 1 FROM public.alignments x WHERE x.movement_need_id=p_movement_need_id AND private.is_financial_alignment(x.id)) THEN
  PERFORM private.mutate_funded_no_travel(p_movement_need_id,'decline');
 ELSE
  selected:=private.movement_end_context(p_movement_need_id); PERFORM * FROM public.decline_movement_end(selected);
 END IF;
 RETURN QUERY SELECT * FROM public.get_my_movement_end_status_by_need(p_movement_need_id);
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Movement end unavailable';
END;
$$;
REVOKE ALL ON FUNCTION private.assert_funded_no_travel(uuid),private.funded_no_travel_alignment(uuid),
 private.mutate_funded_no_travel(uuid,text,text),private.validate_funded_no_travel_graph(),private.require_funded_no_travel_actor() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.get_my_movement_end_status_by_need(uuid),public.request_my_movement_end(uuid,text),
 public.confirm_my_movement_end(uuid),public.decline_my_movement_end(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_my_movement_end_status_by_need(uuid),public.request_my_movement_end(uuid,text),
 public.confirm_my_movement_end(uuid),public.decline_my_movement_end(uuid) TO authenticated;
COMMIT;
