BEGIN;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;

CREATE TEMP TABLE wallet0068_results(
  name text PRIMARY KEY,
  passed boolean NOT NULL
) ON COMMIT DROP;

CREATE FUNCTION pg_temp.wallet0068_check(p_name text, p_passed boolean)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO wallet0068_results(name, passed)
  VALUES (p_name, coalesce(p_passed, false));
END;
$$;

CREATE FUNCTION pg_temp.wallet0068_probe(
  p_name text,
  p_sql text,
  p_expected_state text
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_state text := '00000';
BEGIN
  BEGIN
    EXECUTE p_sql;
    RAISE EXCEPTION USING ERRCODE='Z8068', MESSAGE='probe rollback';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    IF v_state = 'Z8068' THEN
      v_state := '00000';
    END IF;
  END;

  PERFORM pg_temp.wallet0068_check(
    p_name,
    v_state = p_expected_state
  );
END;
$$;

DO $$
DECLARE
  v_member_a uuid := gen_random_uuid();
  v_member_b uuid := gen_random_uuid();
  v_available_a uuid;
  v_held_a uuid;
  v_withdrawable_a uuid;
  v_available_b uuid;
  v_tx uuid;
BEGIN
  INSERT INTO auth.users(
    id,aud,role,email,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
  )
  VALUES
    (v_member_a,'authenticated','authenticated',
      v_member_a::text || '@wallet0068.invalid',now(),'{}','{}',now(),now()),
    (v_member_b,'authenticated','authenticated',
      v_member_b::text || '@wallet0068.invalid',now(),'{}','{}',now(),now());

  SELECT available_account_id, held_account_id, withdrawable_account_id
  INTO STRICT v_available_a, v_held_a, v_withdrawable_a
  FROM public.ensure_ngn_wallet_accounts_for_server(v_member_a);

  SELECT available_account_id
  INTO STRICT v_available_b
  FROM public.ensure_ngn_wallet_accounts_for_server(v_member_b);

  UPDATE private.wallet_accounts
  SET status='closed'
  WHERE id=v_held_a;

  PERFORM pg_temp.wallet0068_check(
    'zero balance account can close',
    (SELECT status='closed' FROM private.wallet_accounts WHERE id=v_held_a)
  );

  PERFORM pg_temp.wallet0068_probe(
    'closed account cannot reopen',
    format(
      'UPDATE private.wallet_accounts SET status=''active'' WHERE id=%L',
      v_held_a
    ),
    '23514'
  );

  INSERT INTO private.wallet_transactions(
    transaction_kind,currency,idempotency_key
  )
  VALUES ('internal_transfer','NGN','0068-positive-' || gen_random_uuid()::text)
  RETURNING id INTO v_tx;

  INSERT INTO private.wallet_postings(
    transaction_id,account_id,direction,amount_minor
  )
  VALUES
    (v_tx,v_available_b,'debit',100),
    (v_tx,v_available_a,'credit',100);

  SET CONSTRAINTS ALL IMMEDIATE;

  PERFORM pg_temp.wallet0068_probe(
    'positive balance cannot close',
    format(
      'UPDATE private.wallet_accounts SET status=''closed'' WHERE id=%L',
      v_available_a
    ),
    '23514'
  );

  PERFORM pg_temp.wallet0068_check(
    'positive closure failure leaves account active',
    (SELECT status='active' FROM private.wallet_accounts WHERE id=v_available_a)
  );

  PERFORM pg_temp.wallet0068_probe(
    'negative balance cannot close',
    format(
      'UPDATE private.wallet_accounts SET status=''closed'' WHERE id=%L',
      v_available_b
    ),
    '23514'
  );

  PERFORM pg_temp.wallet0068_check(
    'negative closure failure leaves account active',
    (SELECT status='active' FROM private.wallet_accounts WHERE id=v_available_b)
  );

  PERFORM pg_temp.wallet0068_probe(
    'account identity remains immutable',
    format(
      'UPDATE private.wallet_accounts SET currency=''USD'' WHERE id=%L',
      v_available_a
    ),
    '23514'
  );

  PERFORM pg_temp.wallet0068_probe(
    'closed account rejects posting',
    format(
      $sql$
      SET CONSTRAINTS ALL DEFERRED;
      WITH new_tx AS (
        INSERT INTO private.wallet_transactions(
          transaction_kind,currency,idempotency_key
        )
        VALUES ('internal_transfer','NGN','0068-closed-post-' || gen_random_uuid()::text)
        RETURNING id
      )
      INSERT INTO private.wallet_postings(
        transaction_id,account_id,direction,amount_minor
      )
      SELECT id,%L,'credit',1
      FROM new_tx
      $sql$,
      v_held_a
    ),
    '23514'
  );

  PERFORM pg_temp.wallet0068_check(
    'same-account posting uniqueness remains present',
    EXISTS (
      SELECT 1
      FROM pg_constraint c
      JOIN pg_class t ON t.oid=c.conrelid
      JOIN pg_namespace n ON n.oid=t.relnamespace
      WHERE n.nspname='private'
        AND t.relname='wallet_postings'
        AND c.contype='u'
        AND pg_get_constraintdef(c.oid) LIKE '%transaction_id, account_id%'
    )
  );

  PERFORM pg_temp.wallet0068_check(
    'credit minus debit semantics confirmed',
    (
      SELECT coalesce(sum(
        CASE
          WHEN p.direction='credit' THEN p.amount_minor::numeric
          ELSE -p.amount_minor::numeric
        END
      ),0)=100
      FROM private.wallet_postings p
      WHERE p.account_id=v_available_a
    )
  );

  PERFORM pg_temp.wallet0068_check(
    'opposite account has negative balance',
    (
      SELECT coalesce(sum(
        CASE
          WHEN p.direction='credit' THEN p.amount_minor::numeric
          ELSE -p.amount_minor::numeric
        END
      ),0)=-100
      FROM private.wallet_postings p
      WHERE p.account_id=v_available_b
    )
  );
END;
$$;

SET CONSTRAINTS ALL IMMEDIATE;

TABLE wallet0068_results;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM wallet0068_results WHERE NOT passed) THEN
    RAISE EXCEPTION '0068 wallet ledger hardening checks failed';
  END IF;
END;
$$;

ROLLBACK;
