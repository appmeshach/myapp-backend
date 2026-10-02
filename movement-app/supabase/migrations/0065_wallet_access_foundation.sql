BEGIN;

-- Movement Balance access foundation.
--
-- This migration adds only:
--   1. service-only idempotent provisioning of the three NGN member accounts; and
--   2. an authenticated, read-only projection of the caller's own safe balances.
--
-- It deliberately does not add a generic wallet writer. The 0064 ledger defines
-- append-only accounting storage but does not yet define the lifecycle-specific
-- authorization rules needed to move real money safely. Top-up, hold/release,
-- settlement, refund and withdrawal writers remain separate reviewed milestones.

CREATE FUNCTION public.ensure_ngn_wallet_accounts_for_server(
  p_member_id uuid
)
RETURNS TABLE (
  wallet_member_id uuid,
  wallet_currency text,
  available_account_id uuid,
  held_account_id uuid,
  withdrawable_account_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_total integer;
  v_active integer;
  v_available uuid;
  v_held uuid;
  v_withdrawable uuid;
BEGIN
  IF p_member_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22004', MESSAGE='Member id required';
  END IF;

  PERFORM 1
  FROM public.members m
  WHERE m.id = p_member_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='Member unavailable';
  END IF;

  INSERT INTO private.wallet_accounts(member_id, account_kind, currency)
  SELECT p_member_id, k.account_kind, 'NGN'
  FROM (VALUES
    ('member_available'::text),
    ('member_held'::text),
    ('member_withdrawable'::text)
  ) AS k(account_kind)
  ON CONFLICT (member_id, account_kind, currency)
    WHERE member_id IS NOT NULL
  DO NOTHING;

  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE a.status='active')::integer,
    max(a.id) FILTER (WHERE a.account_kind='member_available'),
    max(a.id) FILTER (WHERE a.account_kind='member_held'),
    max(a.id) FILTER (WHERE a.account_kind='member_withdrawable')
  INTO v_total, v_active, v_available, v_held, v_withdrawable
  FROM private.wallet_accounts a
  WHERE a.member_id = p_member_id
    AND a.currency = 'NGN'
    AND a.account_kind IN ('member_available','member_held','member_withdrawable');

  IF v_total IS DISTINCT FROM 3
     OR v_active IS DISTINCT FROM 3
     OR v_available IS NULL
     OR v_held IS NULL
     OR v_withdrawable IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Member wallet unavailable';
  END IF;

  RETURN QUERY
  SELECT p_member_id, 'NGN'::text, v_available, v_held, v_withdrawable;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_ngn_wallet_accounts_for_server(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ensure_ngn_wallet_accounts_for_server(uuid)
  TO service_role;

CREATE FUNCTION public.get_my_wallet_balance()
RETURNS TABLE (
  currency text,
  wallet_ready boolean,
  available_minor bigint,
  held_minor bigint,
  withdrawable_minor bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_total integer;
  v_active integer;
  v_available numeric;
  v_held numeric;
  v_withdrawable numeric;
  v_bigint_max constant numeric := 9223372036854775807;
BEGIN
  IF v_caller IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.members m WHERE m.id=v_caller) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Authenticated member required';
  END IF;

  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE a.status='active')::integer
  INTO v_total, v_active
  FROM private.wallet_accounts a
  WHERE a.member_id = v_caller
    AND a.currency = 'NGN'
    AND a.account_kind IN ('member_available','member_held','member_withdrawable');

  IF v_total = 0 THEN
    RETURN QUERY SELECT 'NGN'::text, false, 0::bigint, 0::bigint, 0::bigint;
    RETURN;
  END IF;

  IF v_total IS DISTINCT FROM 3 OR v_active IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Member wallet unavailable';
  END IF;

  -- Member wallet accounts are liability-style accounts: credits increase the
  -- member-visible balance and debits decrease it. Provider clearing uses a
  -- different accounting side and is never projected by this member RPC.
  SELECT
    COALESCE(sum(CASE WHEN p.direction='credit' THEN p.amount_minor::numeric ELSE -p.amount_minor::numeric END)
      FILTER (WHERE a.account_kind='member_available'), 0),
    COALESCE(sum(CASE WHEN p.direction='credit' THEN p.amount_minor::numeric ELSE -p.amount_minor::numeric END)
      FILTER (WHERE a.account_kind='member_held'), 0),
    COALESCE(sum(CASE WHEN p.direction='credit' THEN p.amount_minor::numeric ELSE -p.amount_minor::numeric END)
      FILTER (WHERE a.account_kind='member_withdrawable'), 0)
  INTO v_available, v_held, v_withdrawable
  FROM private.wallet_accounts a
  LEFT JOIN private.wallet_postings p ON p.account_id=a.id
  WHERE a.member_id=v_caller
    AND a.currency='NGN'
    AND a.status='active'
    AND a.account_kind IN ('member_available','member_held','member_withdrawable');

  IF v_available < 0 OR v_held < 0 OR v_withdrawable < 0
     OR v_available > v_bigint_max
     OR v_held > v_bigint_max
     OR v_withdrawable > v_bigint_max THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Member wallet unavailable';
  END IF;

  RETURN QUERY
  SELECT 'NGN'::text, true,
    v_available::bigint,
    v_held::bigint,
    v_withdrawable::bigint;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_wallet_balance()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_wallet_balance()
  TO authenticated;

COMMIT;
