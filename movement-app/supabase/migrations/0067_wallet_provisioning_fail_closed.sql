BEGIN;

-- Forward correction only: reject pre-existing invalid wallets before insertion.
CREATE OR REPLACE FUNCTION public.ensure_ngn_wallet_accounts_for_server(
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
  v_kinds integer;
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
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='Member unavailable';
  END IF;

  -- Serialize with other provisioning calls and the 0066 top-up member gate.
  -- Lock existing accounts against concurrent closure before checking their state.
  PERFORM 1 FROM private.wallet_accounts a
  WHERE a.member_id = p_member_id AND a.currency = 'NGN'
  ORDER BY a.id FOR SHARE;

  SELECT count(*)::integer,
    count(*) FILTER (WHERE a.status = 'active')::integer,
    count(DISTINCT a.account_kind) FILTER (WHERE a.account_kind IN
      ('member_available','member_held','member_withdrawable'))::integer
  INTO v_total, v_active, v_kinds
  FROM private.wallet_accounts a
  WHERE a.member_id = p_member_id AND a.currency = 'NGN';

  IF v_total <> 0 AND (v_total <> 3 OR v_active <> 3 OR v_kinds <> 3) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Member wallet unavailable';
  END IF;

  IF v_total = 0 THEN
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
  END IF;

  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE a.status='active')::integer,
    min(a.id::text) FILTER (WHERE a.account_kind='member_available')::uuid,
    min(a.id::text) FILTER (WHERE a.account_kind='member_held')::uuid,
    min(a.id::text) FILTER (WHERE a.account_kind='member_withdrawable')::uuid
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


COMMIT;
