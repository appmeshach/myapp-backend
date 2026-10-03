BEGIN;

-- Components are the sole monetary authority. No activation or settlement.
CREATE UNIQUE INDEX wallet_transactions_one_initial_component_hold
  ON private.wallet_transactions(financial_component_id)
  WHERE transaction_kind='movement_hold' AND financial_component_id IS NOT NULL;

-- A completion receipt distinguishes never-held from partial history, including
-- agreements whose two requester obligations are zero and need no ledger rows.
CREATE TABLE private.movement_funding_holds (
  financial_agreement_id uuid PRIMARY KEY REFERENCES private.financial_agreements(id),
  fully_held_at timestamptz NOT NULL CHECK (isfinite(fully_held_at))
);
ALTER TABLE private.movement_funding_holds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.movement_funding_holds FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER protect_movement_funding_holds
BEFORE UPDATE OR DELETE OR TRUNCATE ON private.movement_funding_holds
FOR EACH STATEMENT EXECUTE FUNCTION private.protect_wallet_ledger_row();

CREATE FUNCTION private.movement_funding_agreement(p_id uuid,p_caller uuid,p_version integer DEFAULT NULL)
RETURNS private.financial_agreements LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $agreement$
DECLARE g private.financial_agreements%ROWTYPE; p private.financial_proposals%ROWTYPE;
BEGIN
  IF p_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='22004',MESSAGE='Exact agreement required'; END IF;
  IF p_caller IS NULL OR NOT EXISTS(SELECT 1 FROM public.members m WHERE m.id=p_caller) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Authenticated member required'; END IF;
  SELECT x.* INTO g FROM private.financial_agreements x WHERE x.id=p_id;
  IF NOT FOUND OR g.member_needing_movement_id IS DISTINCT FROM p_caller THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Own requester agreement required'; END IF;
  IF p_version IS NOT NULL AND (p_version<1 OR p_version IS DISTINCT FROM g.version) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact agreement version required'; END IF;
  IF (SELECT count(*) FROM private.financial_proposals x WHERE x.financial_agreement_id=g.id)<>1 THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Authoritative materialized agreement required'; END IF;
  SELECT x.* INTO STRICT p FROM private.financial_proposals x WHERE x.financial_agreement_id=g.id;
  -- Immutable proposal reads, never proposal UPDATE. 0077 takes alignment SHARE
  -- -> offer SHARE -> agreement SHARE. Compatible with its replay and with
  -- 0020's agreement UPDATE -> alignment SHARE deferred validation.
  PERFORM private.assert_financial_proposal_materialization(p);
  SELECT x.* INTO STRICT g FROM private.financial_agreements x WHERE x.id=p_id FOR SHARE;
  IF g.currency<>'NGN' OR g.offering_accepted_at IS NULL OR g.requester_accepted_at IS NULL
    OR g.member_needing_movement_id IS DISTINCT FROM p_caller
    OR (p_version IS NOT NULL AND g.version IS DISTINCT FROM p_version) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Accepted exact requester agreement required'; END IF;
  RETURN g;
END;
$agreement$;

CREATE FUNCTION private.movement_funding_evidence(g private.financial_agreements)
RETURNS TABLE(required_minor bigint,held_minor bigint,fully_held_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $evidence$
DECLARE c private.financial_components%ROWTYPE; t private.wallet_transactions%ROWTYPE;
  receipt private.movement_funding_holds%ROWTYPE; total numeric; available_id uuid; held_id uuid;
  latest timestamptz; positive_count integer:=0; posting_count bigint; matching_count bigint;
BEGIN
  SELECT sum(x.amount_minor::numeric) INTO total FROM private.financial_components x
    WHERE x.agreement_id=g.id AND x.component_key IN ('requester_platform_share','movement_contribution');
  IF total IS NULL OR total<0 OR total>9223372036854775807::numeric THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Requester obligation outside supported range'; END IF;
  SELECT x.* INTO receipt FROM private.movement_funding_holds x WHERE x.financial_agreement_id=g.id;
  IF receipt.financial_agreement_id IS NULL THEN
    IF EXISTS(SELECT 1 FROM private.wallet_transactions x JOIN private.financial_components fc ON fc.id=x.financial_component_id
      WHERE fc.agreement_id=g.id AND fc.component_key IN ('requester_platform_share','movement_contribution') AND x.transaction_kind='movement_hold')
      OR EXISTS(SELECT 1 FROM private.wallet_transactions x JOIN private.financial_components fc
        ON x.idempotency_key='movement_hold:'||fc.id::text WHERE fc.agreement_id=g.id
        AND fc.component_key IN ('requester_platform_share','movement_contribution')) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Partial funding history cannot be repaired'; END IF;
    RETURN QUERY SELECT total::bigint,0::bigint,NULL::timestamptz; RETURN;
  END IF;
  -- Historical account identities remain valid even if a later zero-balance
  -- closure occurred. Aggregate balances are deliberately not replay evidence.
  SELECT x.id INTO available_id FROM private.wallet_accounts x WHERE x.member_id=g.member_needing_movement_id
    AND x.currency=g.currency AND x.account_kind='member_available';
  SELECT x.id INTO held_id FROM private.wallet_accounts x WHERE x.member_id=g.member_needing_movement_id
    AND x.currency=g.currency AND x.account_kind='member_held';
  IF available_id IS NULL OR held_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Historical funding accounts unavailable'; END IF;
  FOR c IN SELECT x.* FROM private.financial_components x WHERE x.agreement_id=g.id
    AND x.component_key IN ('requester_platform_share','movement_contribution') ORDER BY x.id LOOP
    SELECT x.* INTO t FROM private.wallet_transactions x WHERE x.idempotency_key='movement_hold:'||c.id::text;
    IF c.amount_minor=0 THEN
      IF t.id IS NOT NULL OR EXISTS(SELECT 1 FROM private.wallet_transactions x
        WHERE x.financial_component_id=c.id AND x.transaction_kind='movement_hold') THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Zero obligation must have no hold transaction'; END IF;
      CONTINUE;
    END IF;
    positive_count:=positive_count+1;
    IF t.id IS NULL OR t.transaction_kind<>'movement_hold' OR t.financial_component_id IS DISTINCT FROM c.id
      OR t.alignment_id IS DISTINCT FROM g.alignment_id OR t.currency<>g.currency
      OR t.provider IS NOT NULL OR t.provider_reference IS NOT NULL
      OR NOT isfinite(t.created_at) OR t.created_at<g.requester_accepted_at OR t.created_at>clock_timestamp() THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact historical component hold required'; END IF;
    SELECT count(*),count(*) FILTER(WHERE x.amount_minor=c.amount_minor AND
      ((x.account_id=available_id AND x.direction='debit') OR (x.account_id=held_id AND x.direction='credit')))
      INTO posting_count,matching_count FROM private.wallet_postings x WHERE x.transaction_id=t.id;
    IF posting_count<>2 OR matching_count<>2 THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact historical hold postings required'; END IF;
    PERFORM private.assert_wallet_transaction_balanced(t.id);
    latest:=greatest(latest,t.created_at);
  END LOOP;
  IF receipt.fully_held_at<g.requester_accepted_at OR receipt.fully_held_at>clock_timestamp()
    OR (positive_count>0 AND receipt.fully_held_at IS DISTINCT FROM latest) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact persisted funding timestamp required'; END IF;
  RETURN QUERY SELECT total::bigint,total::bigint,receipt.fully_held_at;
END;
$evidence$;

CREATE FUNCTION public.hold_my_movement_funds(p_financial_agreement_id uuid,p_expected_agreement_version integer)
RETURNS TABLE(financial_agreement_id uuid,agreement_version integer,alignment_id uuid,funding_status text,
 required_minor bigint,held_minor bigint,currency text,fully_held_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $hold$
DECLARE caller uuid:=auth.uid(); g private.financial_agreements%ROWTYPE; evidence record; c private.financial_components%ROWTYPE;
 available_id uuid; held_id uuid; transaction_id uuid; funding_at timestamptz; stamp timestamptz;
 available_balance numeric; held_balance numeric; withdrawable_balance numeric; total bigint; active_count bigint;
BEGIN
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION USING ERRCODE='25000',MESSAGE='Movement hold requires READ COMMITTED'; END IF;
  IF p_expected_agreement_version IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22004',MESSAGE='Exact agreement version required'; END IF;
  g:=private.movement_funding_agreement(p_financial_agreement_id,caller,p_expected_agreement_version);
  -- Wallet gate AFTER shared financial locks. Existing provisioning/top-up also
  -- take member UPDATE before account locks. Hold never takes need/proposal UPDATE.
  PERFORM m.id FROM public.members m WHERE m.id=caller FOR UPDATE;
  SELECT * INTO evidence FROM private.movement_funding_evidence(g);
  IF evidence.fully_held_at IS NOT NULL THEN
    RETURN QUERY SELECT g.id,g.version,g.alignment_id,'held'::text,evidence.required_minor,evidence.held_minor,g.currency,evidence.fully_held_at; RETURN;
  END IF;
  IF g.status<>'current' OR NOT EXISTS(SELECT 1 FROM public.alignments a WHERE a.id=g.alignment_id
    AND a.status='awaiting_activation_payment' AND a.activated_at IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='First funding requires current pre-activation agreement'; END IF;
  PERFORM x.id FROM private.wallet_accounts x WHERE x.member_id=caller AND x.currency=g.currency ORDER BY x.id FOR UPDATE;
  SELECT count(*),count(*) FILTER(WHERE x.status='active'),
    min(x.id::text) FILTER(WHERE x.account_kind='member_available')::uuid,
    min(x.id::text) FILTER(WHERE x.account_kind='member_held')::uuid
    INTO total,active_count,available_id,held_id FROM private.wallet_accounts x WHERE x.member_id=caller AND x.currency=g.currency;
  IF total<>3 OR active_count<>3 OR available_id IS NULL OR held_id IS NULL
    OR NOT EXISTS(SELECT 1 FROM private.wallet_accounts x WHERE x.member_id=caller AND x.currency=g.currency AND x.account_kind='member_withdrawable') THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Complete active requester wallet required'; END IF;
  SELECT coalesce(sum(CASE WHEN wp.direction='credit' THEN wp.amount_minor::numeric ELSE -wp.amount_minor::numeric END)
      FILTER(WHERE wa.account_kind='member_available'),0),
    coalesce(sum(CASE WHEN wp.direction='credit' THEN wp.amount_minor::numeric ELSE -wp.amount_minor::numeric END)
      FILTER(WHERE wa.account_kind='member_held'),0),
    coalesce(sum(CASE WHEN wp.direction='credit' THEN wp.amount_minor::numeric ELSE -wp.amount_minor::numeric END)
      FILTER(WHERE wa.account_kind='member_withdrawable'),0)
    INTO available_balance,held_balance,withdrawable_balance FROM private.wallet_accounts wa
    LEFT JOIN private.wallet_postings wp ON wp.account_id=wa.id WHERE wa.member_id=caller AND wa.currency=g.currency;
  IF available_balance<0 OR held_balance<0 OR withdrawable_balance<0
    OR available_balance>9223372036854775807::numeric OR withdrawable_balance>9223372036854775807::numeric
    OR held_balance+evidence.required_minor>9223372036854775807::numeric THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Requester wallet outside supported range'; END IF;
  IF available_balance<evidence.required_minor THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Insufficient available movement balance'; END IF;
  -- Defer only ledger construction checks, then explicitly drain them. No writes
  -- occur before all authorization, wallet, amount and insufficiency checks.
  SET CONSTRAINTS private.wallet_transaction_balanced_after_transaction,private.wallet_transaction_balanced_after_posting DEFERRED;
  FOR c IN SELECT x.* FROM private.financial_components x WHERE x.agreement_id=g.id
    AND x.component_key IN ('requester_platform_share','movement_contribution') AND x.amount_minor>0 ORDER BY x.id LOOP
    INSERT INTO private.wallet_transactions(transaction_kind,currency,alignment_id,financial_component_id,idempotency_key)
    VALUES('movement_hold',g.currency,g.alignment_id,c.id,'movement_hold:'||c.id::text) RETURNING id,created_at INTO transaction_id,stamp;
    INSERT INTO private.wallet_postings(transaction_id,account_id,direction,amount_minor)
    VALUES(transaction_id,available_id,'debit',c.amount_minor),(transaction_id,held_id,'credit',c.amount_minor);
    funding_at:=greatest(funding_at,stamp);
    PERFORM private.assert_wallet_transaction_balanced(transaction_id);
  END LOOP;
  -- Zero-only obligations use this immutable receipt's recorded completion time.
  INSERT INTO private.movement_funding_holds VALUES(g.id,coalesce(funding_at,clock_timestamp()));
  SELECT * INTO evidence FROM private.movement_funding_evidence(g);
  SET CONSTRAINTS private.wallet_transaction_balanced_after_transaction,private.wallet_transaction_balanced_after_posting IMMEDIATE;
  SET CONSTRAINTS private.wallet_transaction_balanced_after_transaction,private.wallet_transaction_balanced_after_posting DEFERRED;
  RETURN QUERY SELECT g.id,g.version,g.alignment_id,'held'::text,evidence.required_minor,evidence.held_minor,g.currency,evidence.fully_held_at;
END;
$hold$;

CREATE FUNCTION public.get_my_movement_funding_status(p_financial_agreement_id uuid)
RETURNS TABLE(financial_agreement_id uuid,agreement_version integer,alignment_id uuid,funding_status text,
 required_minor bigint,held_minor bigint,currency text,fully_held_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $status$
DECLARE g private.financial_agreements%ROWTYPE; evidence record;
BEGIN
  g:=private.movement_funding_agreement(p_financial_agreement_id,auth.uid());
  PERFORM m.id FROM public.members m WHERE m.id=g.member_needing_movement_id FOR SHARE;
  SELECT * INTO evidence FROM private.movement_funding_evidence(g);
  RETURN QUERY SELECT g.id,g.version,g.alignment_id,CASE WHEN evidence.fully_held_at IS NULL THEN 'not_held' ELSE 'held' END,
    evidence.required_minor,evidence.held_minor,g.currency,evidence.fully_held_at;
END;
$status$;
REVOKE ALL ON FUNCTION private.movement_funding_agreement(uuid,uuid,integer),
 private.movement_funding_evidence(private.financial_agreements) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.hold_my_movement_funds(uuid,integer),public.get_my_movement_funding_status(uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.hold_my_movement_funds(uuid,integer),public.get_my_movement_funding_status(uuid) TO authenticated;
COMMIT;
