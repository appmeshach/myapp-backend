BEGIN;

-- Preserve the existing deferred triggers and balance enforcement. Separate
-- statements avoid resolving a field absent from the triggering table's row.
CREATE OR REPLACE FUNCTION private.validate_wallet_transaction_deferred()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_TABLE_NAME = 'wallet_transactions' THEN
    PERFORM private.assert_wallet_transaction_balanced(NEW.id);
  ELSIF TG_TABLE_NAME = 'wallet_postings' THEN
    PERFORM private.assert_wallet_transaction_balanced(NEW.transaction_id);
  ELSE
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Unexpected wallet ledger trigger table';
  END IF;
  RETURN NULL;
END;
$$;

-- Records an event already verified by a future trusted payment-verification
-- layer. This function does not establish that external funds were received.
CREATE FUNCTION public.record_wallet_top_up_for_server(
  p_member_id uuid,
  p_amount_minor bigint,
  p_currency text,
  p_provider text,
  p_provider_reference text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_key text;
  v_previous private.wallet_transactions%ROWTYPE;
  v_available uuid;
  v_clearing uuid;
  v_id uuid;
  v_total bigint;
  v_active bigint;
  v_matching bigint;
  v_balance numeric;
BEGIN
  -- Each statement after a waited event lock must see the committed winner.
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION USING ERRCODE='25000', MESSAGE='Wallet top-up requires READ COMMITTED';
  END IF;
  IF p_member_id IS NULL OR p_amount_minor IS NULL OR p_currency IS NULL
     OR p_provider IS NULL OR p_provider_reference IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22004', MESSAGE='Complete wallet top-up input required';
  END IF;
  IF p_amount_minor <= 0 OR p_currency <> 'NGN'
     OR length(p_provider) NOT BETWEEN 1 AND 100
     OR p_provider <> btrim(p_provider)
     OR p_provider !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]*$'
     OR length(p_provider_reference) NOT BETWEEN 1 AND 255
     OR p_provider_reference <> btrim(p_provider_reference)
     OR p_provider_reference !~ '[^[:space:]]'
     OR p_provider_reference ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid wallet top-up input';
  END IF;

  -- JSON array encoding avoids delimiter ambiguity. Store exact case-sensitive
  -- provenance; do not trim or normalize two distinct events into one.
  v_key := 'wallet_top_up:' || encode(sha256(convert_to(
    jsonb_build_array(p_provider, p_provider_reference)::text, 'UTF8'
  )), 'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(v_key, 0));

  SELECT t.* INTO v_previous
  FROM private.wallet_transactions t
  WHERE t.provider = p_provider AND t.provider_reference = p_provider_reference
  FOR SHARE;
  IF FOUND AND (
    v_previous.transaction_kind IS DISTINCT FROM 'wallet_top_up'
    OR v_previous.currency IS DISTINCT FROM p_currency
    OR v_previous.alignment_id IS NOT NULL
    OR v_previous.financial_component_id IS NOT NULL
    OR v_previous.idempotency_key IS DISTINCT FROM v_key
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Wallet top-up replay mismatch';
  END IF;

  -- Serialize member provisioning and this writer's balance checks. 0065 takes
  -- SHARE on this same row, so its concurrent provisioning cannot cross this gate.
  PERFORM 1 FROM public.members m WHERE m.id = p_member_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='Member unavailable';
  END IF;
  PERFORM 1 FROM private.wallet_accounts a
  WHERE a.member_id = p_member_id AND a.currency = 'NGN'
  ORDER BY a.id FOR SHARE;
  SELECT count(*), count(*) FILTER (WHERE a.status='active')
  INTO v_total, v_active
  FROM private.wallet_accounts a
  WHERE a.member_id = p_member_id AND a.currency = 'NGN';
  -- 0065 can fill missing accounts. This stricter posting boundary must refuse
  -- a pre-existing incomplete wallet instead of silently repairing it.
  IF v_total NOT IN (0, 3) OR v_total <> v_active THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Member wallet unavailable';
  END IF;
  SELECT w.available_account_id INTO STRICT v_available
  FROM public.ensure_ngn_wallet_accounts_for_server(p_member_id) w;

  INSERT INTO private.wallet_accounts(member_id, account_kind, currency)
  VALUES (NULL, 'provider_clearing', 'NGN')
  ON CONFLICT (account_kind, currency) WHERE member_id IS NULL DO NOTHING;
  SELECT a.id INTO v_clearing FROM private.wallet_accounts a
  WHERE a.member_id IS NULL AND a.account_kind = 'provider_clearing'
    AND a.currency = 'NGN' AND a.status = 'active'
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Provider clearing unavailable';
  END IF;

  IF v_previous.id IS NOT NULL THEN
    SELECT count(*), count(*) FILTER (WHERE
      p.amount_minor = p_amount_minor AND (
        (p.account_id = v_clearing AND p.direction = 'debit') OR
        (p.account_id = v_available AND p.direction = 'credit')
      ))
    INTO v_total, v_matching
    FROM private.wallet_postings p WHERE p.transaction_id = v_previous.id;
    IF v_total <> 2 OR v_matching <> 2 THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Wallet top-up replay mismatch';
    END IF;
    PERFORM private.assert_wallet_transaction_balanced(v_previous.id);
    RETURN v_previous.id;
  END IF;

  -- Never make the 0065 bigint projection overflow. Numeric accumulation also
  -- rejects an already inconsistent balance without overflow during summation.
  SELECT coalesce(sum(CASE WHEN p.direction='credit'
    THEN p.amount_minor::numeric ELSE -p.amount_minor::numeric END), 0)
  INTO v_balance FROM private.wallet_postings p WHERE p.account_id = v_available;
  IF v_balance < 0 OR v_balance + p_amount_minor > 9223372036854775807::numeric THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Member wallet unavailable';
  END IF;

  INSERT INTO private.wallet_transactions(
    transaction_kind, currency, provider, provider_reference, idempotency_key,
    alignment_id, financial_component_id
  ) VALUES ('wallet_top_up', 'NGN', p_provider, p_provider_reference, v_key, NULL, NULL)
  RETURNING id INTO v_id;
  INSERT INTO private.wallet_postings(transaction_id, account_id, direction, amount_minor)
  VALUES (v_id, v_clearing, 'debit', p_amount_minor),
         (v_id, v_available, 'credit', p_amount_minor);
  PERFORM private.assert_wallet_transaction_balanced(v_id);
  RETURN v_id;
EXCEPTION
  WHEN unique_violation THEN
    -- Includes collisions with transactions written outside this narrow RPC.
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Wallet top-up identity conflict';
END;
$$;

REVOKE ALL ON FUNCTION public.record_wallet_top_up_for_server(uuid,bigint,text,text,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_wallet_top_up_for_server(uuid,bigint,text,text,text)
  TO service_role;

COMMIT;
