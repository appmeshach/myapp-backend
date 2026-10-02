BEGIN;

-- Harden wallet account closure: an account may close only when its
-- authoritative ledger balance is exactly zero.
CREATE OR REPLACE FUNCTION private.protect_wallet_account()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_balance numeric;
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

  SELECT COALESCE(
    sum(
      CASE
        WHEN p.direction = 'credit' THEN p.amount_minor::numeric
        ELSE -p.amount_minor::numeric
      END
    ),
    0
  )
  INTO v_balance
  FROM private.wallet_postings p
  WHERE p.account_id = OLD.id;

  IF v_balance IS DISTINCT FROM 0::numeric THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Wallet account with nonzero balance cannot be closed';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.protect_wallet_account()
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
