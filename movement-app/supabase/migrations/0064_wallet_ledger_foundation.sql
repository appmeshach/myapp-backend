BEGIN;

-- Provider-neutral Movement Balance accounting foundation.
--
-- This migration does NOT create a bank, mobile-money service, payment provider,
-- virtual account, funding endpoint, withdrawal endpoint, or client writer.
-- It only establishes an append-only double-entry ledger that future trusted
-- server-side payment infrastructure may use after separate provider/compliance
-- review.
--
-- Financial agreements (0020+) continue to define who owes what. This ledger is
-- intended to record where money came from, where it is held, and where it went.
-- No cutover from the existing activation-payment foundation occurs here.

CREATE TABLE private.wallet_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NULL REFERENCES public.members(id),
  account_kind text NOT NULL CHECK (account_kind IN (
    'member_available',
    'member_held',
    'member_withdrawable',
    'platform_revenue',
    'provider_clearing'
  )),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (
    (account_kind IN ('member_available','member_held','member_withdrawable') AND member_id IS NOT NULL)
    OR
    (account_kind IN ('platform_revenue','provider_clearing') AND member_id IS NULL)
  )
);

CREATE UNIQUE INDEX wallet_accounts_one_member_kind_currency
  ON private.wallet_accounts(member_id, account_kind, currency)
  WHERE member_id IS NOT NULL;

CREATE UNIQUE INDEX wallet_accounts_one_system_kind_currency
  ON private.wallet_accounts(account_kind, currency)
  WHERE member_id IS NULL;

CREATE TABLE private.wallet_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_kind text NOT NULL CHECK (transaction_kind IN (
    'wallet_top_up',
    'movement_hold',
    'movement_hold_release',
    'requester_platform_charge',
    'offering_platform_charge',
    'movement_contribution_settlement',
    'withdrawal',
    'refund',
    'provider_fee',
    'internal_transfer'
  )),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  alignment_id uuid NULL REFERENCES public.alignments(id),
  financial_component_id uuid NULL REFERENCES private.financial_components(id),
  provider text NULL CHECK (
    provider IS NULL OR (
      length(provider) BETWEEN 1 AND 100
      AND provider = btrim(provider)
      AND provider ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]*$'
    )
  ),
  provider_reference text NULL CHECK (
    provider_reference IS NULL OR (
      length(provider_reference) BETWEEN 1 AND 255
      AND provider_reference = btrim(provider_reference)
    )
  ),
  idempotency_key text NOT NULL UNIQUE CHECK (
    length(idempotency_key) BETWEEN 1 AND 200
    AND idempotency_key = btrim(idempotency_key)
    AND idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]*$'
  ),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (
    transaction_kind NOT IN (
      'requester_platform_charge',
      'offering_platform_charge',
      'movement_contribution_settlement'
    )
    OR financial_component_id IS NOT NULL
  ),
  CHECK (
    transaction_kind NOT IN (
      'movement_hold',
      'movement_hold_release',
      'requester_platform_charge',
      'offering_platform_charge',
      'movement_contribution_settlement',
      'refund'
    )
    OR alignment_id IS NOT NULL
  )
);

CREATE UNIQUE INDEX wallet_transactions_provider_reference_unique
  ON private.wallet_transactions(provider, provider_reference)
  WHERE provider IS NOT NULL AND provider_reference IS NOT NULL;

CREATE TABLE private.wallet_postings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES private.wallet_transactions(id),
  account_id uuid NOT NULL REFERENCES private.wallet_accounts(id),
  direction text NOT NULL CHECK (direction IN ('debit','credit')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (transaction_id, account_id)
);

ALTER TABLE private.wallet_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.wallet_postings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE private.wallet_accounts FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE private.wallet_transactions FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE private.wallet_postings FROM PUBLIC, anon, authenticated, service_role;

-- Foundation is read-only even to service_role. Future trusted write RPCs must be
-- reviewed separately so provider callbacks or clients cannot directly mint,
-- move, or erase balances.
GRANT SELECT ON TABLE private.wallet_accounts TO service_role;
GRANT SELECT ON TABLE private.wallet_transactions TO service_role;
GRANT SELECT ON TABLE private.wallet_postings TO service_role;

CREATE FUNCTION private.protect_wallet_account()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Wallet account history cannot be removed';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'active' THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Wallet account must start active';
    END IF;
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Wallet account identity is immutable';
  END IF;

  IF OLD.status IS DISTINCT FROM 'active' OR NEW.status IS DISTINCT FROM 'closed' THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Wallet account lifecycle cannot reopen or change terminal state';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.protect_wallet_account() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER protect_wallet_account
BEFORE INSERT OR UPDATE
ON private.wallet_accounts
FOR EACH ROW EXECUTE FUNCTION private.protect_wallet_account();

CREATE TRIGGER prevent_wallet_account_removal
BEFORE DELETE OR TRUNCATE
ON private.wallet_accounts
FOR EACH STATEMENT EXECUTE FUNCTION private.protect_wallet_account();

CREATE FUNCTION private.protect_wallet_ledger_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Wallet ledger history is append-only';
END;
$$;

REVOKE ALL ON FUNCTION private.protect_wallet_ledger_row() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER protect_wallet_transactions
BEFORE UPDATE OR DELETE OR TRUNCATE
ON private.wallet_transactions
FOR EACH STATEMENT EXECUTE FUNCTION private.protect_wallet_ledger_row();

CREATE TRIGGER protect_wallet_postings
BEFORE UPDATE OR DELETE OR TRUNCATE
ON private.wallet_postings
FOR EACH STATEMENT EXECUTE FUNCTION private.protect_wallet_ledger_row();

CREATE FUNCTION private.validate_wallet_posting_account()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_transaction_currency text;
  v_account_currency text;
  v_account_status text;
BEGIN
  SELECT t.currency
  INTO STRICT v_transaction_currency
  FROM private.wallet_transactions t
  WHERE t.id = NEW.transaction_id
  FOR SHARE;

  SELECT a.currency, a.status
  INTO STRICT v_account_currency, v_account_status
  FROM private.wallet_accounts a
  WHERE a.id = NEW.account_id
  FOR SHARE;

  IF v_account_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Wallet posting requires an active account';
  END IF;

  IF v_account_currency IS DISTINCT FROM v_transaction_currency THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Wallet posting currency must match transaction currency';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.validate_wallet_posting_account() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER validate_wallet_posting_account
BEFORE INSERT
ON private.wallet_postings
FOR EACH ROW EXECUTE FUNCTION private.validate_wallet_posting_account();

CREATE FUNCTION private.assert_wallet_transaction_balanced(
  p_transaction_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_debits numeric;
  v_credits numeric;
  v_posting_count bigint;
BEGIN
  IF p_transaction_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22004', MESSAGE='Wallet transaction id required';
  END IF;

  PERFORM 1
  FROM private.wallet_transactions t
  WHERE t.id = p_transaction_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Wallet transaction unavailable';
  END IF;

  SELECT
    count(*),
    COALESCE(sum(p.amount_minor) FILTER (WHERE p.direction='debit'), 0),
    COALESCE(sum(p.amount_minor) FILTER (WHERE p.direction='credit'), 0)
  INTO v_posting_count, v_debits, v_credits
  FROM private.wallet_postings p
  WHERE p.transaction_id = p_transaction_id;

  IF v_posting_count < 2 OR v_debits <= 0 OR v_credits <= 0 OR v_debits IS DISTINCT FROM v_credits THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Wallet transaction must contain balanced debit and credit postings';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.assert_wallet_transaction_balanced(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.validate_wallet_transaction_deferred()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM private.assert_wallet_transaction_balanced(
    CASE WHEN TG_TABLE_NAME='wallet_transactions' THEN NEW.id ELSE NEW.transaction_id END
  );
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.validate_wallet_transaction_deferred() FROM PUBLIC, anon, authenticated, service_role;

CREATE CONSTRAINT TRIGGER wallet_transaction_balanced_after_transaction
AFTER INSERT ON private.wallet_transactions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION private.validate_wallet_transaction_deferred();

CREATE CONSTRAINT TRIGGER wallet_transaction_balanced_after_posting
AFTER INSERT ON private.wallet_postings
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION private.validate_wallet_transaction_deferred();

COMMIT;
