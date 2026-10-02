BEGIN;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

CREATE TEMP TABLE top_up_results(name text PRIMARY KEY, passed boolean NOT NULL) ON COMMIT DROP;
CREATE FUNCTION pg_temp.top_up_check(p_name text, p_passed boolean)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO pg_temp.top_up_results VALUES (p_name, coalesce(p_passed, false));
END;
$$;
-- Like the existing 0059/0060 harness, roll each probe back in a subtransaction.
CREATE FUNCTION pg_temp.top_up_probe(p_name text, p_sql text, p_state text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual text := '00000';
BEGIN
  BEGIN
    EXECUTE p_sql;
    RAISE EXCEPTION USING ERRCODE='ZT066', MESSAGE='successful probe rollback';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS actual=RETURNED_SQLSTATE;
    IF actual='ZT066' THEN actual:='00000'; END IF;
  END;
  PERFORM pg_temp.top_up_check(p_name, actual=p_state);
END;
$$;

CREATE TEMP TABLE top_up_fixture(member_id uuid, other_id uuid, event text, transaction_id uuid) ON COMMIT DROP;
DO $$
DECLARE m uuid := gen_random_uuid(); other uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  SELECT id,'authenticated','authenticated',id::text||'@wallet-test.invalid',now(),'{}','{}',now(),now()
  FROM (VALUES (m),(other)) ids(id);
  -- The normal auth trigger provisions members; do not bypass it.
  INSERT INTO top_up_fixture VALUES (m,other,'test-'||gen_random_uuid()::text,NULL);
END;
$$;

DO $$
DECLARE f record; tx uuid; replay uuid; balance record; fn oid;
  command text; role_name text; amount bigint; bad text;
BEGIN
  SELECT * INTO STRICT f FROM top_up_fixture;
  fn := 'public.record_wallet_top_up_for_server(uuid,bigint,text,text,text)'::regprocedure;
  PERFORM pg_temp.top_up_check('PUBLIC has no EXECUTE', NOT EXISTS (
    SELECT 1 FROM pg_proc p, LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
    WHERE p.oid=fn AND acl.grantee=0 AND acl.privilege_type='EXECUTE'));
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    PERFORM pg_temp.top_up_check(role_name||' has no EXECUTE', NOT has_function_privilege(role_name,fn,'EXECUTE'));
    PERFORM pg_temp.top_up_probe(role_name||' execution denied',format(
      'SET LOCAL ROLE %I; SELECT public.record_wallet_top_up_for_server(%L,100,''NGN'',''test-source'',%L)',role_name,f.member_id,f.event),'42501');
  END LOOP;
  PERFORM pg_temp.top_up_check('service_role has EXECUTE',has_function_privilege('service_role',fn,'EXECUTE'));
  PERFORM pg_temp.top_up_check('service_role has no table writes', NOT EXISTS (
    SELECT 1 FROM unnest(ARRAY['wallet_accounts','wallet_transactions','wallet_postings']) t(name)
    WHERE has_table_privilege('service_role','private.'||t.name,'INSERT,UPDATE,DELETE,TRUNCATE')));

  SET LOCAL ROLE service_role;
  tx := public.record_wallet_top_up_for_server(f.member_id,12345,'NGN','test-source',f.event);
  replay := public.record_wallet_top_up_for_server(f.member_id,12345,'NGN','test-source',f.event);
  RESET ROLE;
  UPDATE top_up_fixture SET transaction_id=tx;
  PERFORM pg_temp.top_up_check('exact replay returns same transaction',tx=replay);
  PERFORM pg_temp.top_up_check('three active member accounts provisioned',(
    SELECT count(*)=3 AND bool_and(status='active') FROM private.wallet_accounts WHERE member_id=f.member_id AND currency='NGN'));
  PERFORM pg_temp.top_up_check('one active NGN clearing',(
    SELECT count(*)=1 AND bool_and(status='active') FROM private.wallet_accounts
    WHERE member_id IS NULL AND account_kind='provider_clearing' AND currency='NGN'));
  PERFORM pg_temp.top_up_check('one exact unattached top-up transaction',(
    SELECT count(*)=1 AND bool_and(transaction_kind='wallet_top_up' AND currency='NGN'
      AND alignment_id IS NULL AND financial_component_id IS NULL)
    FROM private.wallet_transactions WHERE provider='test-source' AND provider_reference=f.event));
  PERFORM pg_temp.top_up_check('exactly two correctly bound postings',(
    SELECT count(*)=2 AND count(*) FILTER (WHERE p.amount_minor=12345 AND (
      (a.member_id IS NULL AND a.account_kind='provider_clearing' AND p.direction='debit') OR
      (a.member_id=f.member_id AND a.account_kind='member_available' AND p.direction='credit')))=2
    FROM private.wallet_postings p JOIN private.wallet_accounts a ON a.id=p.account_id WHERE p.transaction_id=tx));
  PERFORM set_config('request.jwt.claim.sub',f.member_id::text,true);
  SET LOCAL ROLE authenticated;
  SELECT * INTO STRICT balance FROM public.get_my_wallet_balance();
  RESET ROLE;
  PERFORM pg_temp.top_up_check('own balance credited once; held and withdrawable zero',
    balance.wallet_ready AND balance.currency='NGN' AND balance.available_minor=12345
    AND balance.held_minor=0 AND balance.withdrawable_minor=0);

  command := format('SET LOCAL ROLE service_role; SELECT public.record_wallet_top_up_for_server(%L,%%s,''NGN'',''test-source'',%L)',f.member_id,f.event);
  PERFORM pg_temp.top_up_probe('amount mismatch',format(command,12346),'23514');
  PERFORM pg_temp.top_up_probe('member mismatch',format('SET LOCAL ROLE service_role; SELECT public.record_wallet_top_up_for_server(%L,12345,''NGN'',''test-source'',%L)',f.other_id,f.event),'23514');
  PERFORM pg_temp.top_up_probe('currency mismatch',format('SET LOCAL ROLE service_role; SELECT public.record_wallet_top_up_for_server(%L,12345,''USD'',''test-source'',%L)',f.member_id,f.event),'22023');
  FOREACH amount IN ARRAY ARRAY[0::bigint,-1::bigint] LOOP
    PERFORM pg_temp.top_up_probe('invalid amount '||amount,format(command,amount),'22023');
  END LOOP;
  PERFORM pg_temp.top_up_probe('missing member',format('SET LOCAL ROLE service_role; SELECT public.record_wallet_top_up_for_server(%L,1,''NGN'',''test-source'',''missing-member'')',gen_random_uuid()),'23503');
  FOREACH bad IN ARRAY ARRAY['',' ',' bad','bad!'] LOOP
    PERFORM pg_temp.top_up_probe('invalid provider '||quote_literal(bad),format('SET LOCAL ROLE service_role; SELECT public.record_wallet_top_up_for_server(%L,1,''NGN'',%L,''new'')',f.member_id,bad),'22023');
  END LOOP;
  FOREACH bad IN ARRAY ARRAY['',' ',' bad',E'bad\nreference',repeat('x',256)] LOOP
    PERFORM pg_temp.top_up_probe('invalid reference '||quote_literal(left(bad,20)),format('SET LOCAL ROLE service_role; SELECT public.record_wallet_top_up_for_server(%L,1,''NGN'',''test-source'',%L)',f.member_id,bad),'22023');
  END LOOP;
  PERFORM pg_temp.top_up_probe('missing provenance',format('SET LOCAL ROLE service_role; SELECT public.record_wallet_top_up_for_server(%L,1,''NGN'',NULL,NULL)',f.member_id),'22004');
  PERFORM pg_temp.top_up_probe('available bigint overflow',format('SET LOCAL ROLE service_role; SELECT public.record_wallet_top_up_for_server(%L,9223372036854775807,''NGN'',''test-source'',''overflow'')',f.member_id),'23514');
  PERFORM pg_temp.top_up_probe('closed wallet fails',format('UPDATE private.wallet_accounts SET status=''closed'' WHERE member_id=%L AND account_kind=''member_held''; SET LOCAL ROLE service_role; SELECT public.record_wallet_top_up_for_server(%L,1,''NGN'',''test-source'',''closed'')',f.member_id,f.member_id),'23514');
  PERFORM pg_temp.top_up_probe('closed clearing fails',format('UPDATE private.wallet_accounts SET status=''closed'' WHERE member_id IS NULL AND account_kind=''provider_clearing'' AND currency=''NGN''; SET LOCAL ROLE service_role; SELECT public.record_wallet_top_up_for_server(%L,1,''NGN'',''test-source'',''closed-clearing'')',f.member_id),'23514');
  PERFORM pg_temp.top_up_probe('partial wallet fails without repair',format('INSERT INTO private.wallet_accounts(member_id,account_kind,currency) VALUES (%L,''member_available'',''NGN''); SET LOCAL ROLE service_role; SELECT public.record_wallet_top_up_for_server(%L,1,''NGN'',''test-source'',''partial'')',f.other_id,f.other_id),'23514');
  PERFORM pg_temp.top_up_probe('balanced extra posting pair is not an exact replay',format(
    'INSERT INTO private.wallet_postings(transaction_id,account_id,direction,amount_minor) SELECT %L,id,CASE WHEN account_kind=''member_held'' THEN ''debit'' ELSE ''credit'' END,1 FROM private.wallet_accounts WHERE member_id=%L AND account_kind IN (''member_held'',''member_withdrawable''); SET LOCAL ROLE service_role; SELECT public.record_wallet_top_up_for_server(%L,12345,''NGN'',''test-source'',%L)',tx,f.member_id,f.member_id,f.event),'23514');
  PERFORM pg_temp.top_up_probe('wrong transaction kind is not a top-up replay',format(
    'INSERT INTO private.wallet_transactions(transaction_kind,currency,provider,provider_reference,idempotency_key) VALUES (''internal_transfer'',''NGN'',''test-source'',''wrong-shape'',''test-wrong-shape''); SET LOCAL ROLE service_role; SELECT public.record_wallet_top_up_for_server(%L,1,''NGN'',''test-source'',''wrong-shape'')',f.member_id),'23514');
  PERFORM pg_temp.top_up_probe('transaction remains immutable',format('UPDATE private.wallet_transactions SET provider=''changed'' WHERE id=%L',tx),'23514');
  PERFORM pg_temp.top_up_probe('postings remain immutable',format('DELETE FROM private.wallet_postings WHERE transaction_id=%L',tx),'23514');
  PERFORM private.assert_wallet_transaction_balanced(tx);
  PERFORM pg_temp.top_up_probe('transaction deferred trigger rejects empty transaction',
    'INSERT INTO private.wallet_transactions(transaction_kind,currency,idempotency_key) VALUES (''wallet_top_up'',''NGN'',''test-empty''); SET CONSTRAINTS ALL IMMEDIATE','23514');
  PERFORM pg_temp.top_up_probe('posting deferred trigger rejects imbalance',format(
    'SET CONSTRAINTS ALL IMMEDIATE; INSERT INTO private.wallet_postings(transaction_id,account_id,direction,amount_minor) SELECT %L,id,''credit'',1 FROM private.wallet_accounts WHERE member_id=%L AND account_kind=''member_held''',tx,f.member_id),'23514');
  PERFORM pg_temp.top_up_check('both ledger constraint triggers remain initially deferred',(
    SELECT count(*)=2 AND bool_and(tgdeferrable AND tginitdeferred) FROM pg_trigger
    WHERE tgfoid='private.validate_wallet_transaction_deferred()'::regprocedure));
  PERFORM pg_temp.top_up_check('dispatcher remains inaccessible to application roles',
    NOT has_function_privilege('anon','private.validate_wallet_transaction_deferred()','EXECUTE')
    AND NOT has_function_privilege('authenticated','private.validate_wallet_transaction_deferred()','EXECUTE')
    AND NOT has_function_privilege('service_role','private.validate_wallet_transaction_deferred()','EXECUTE'));
END;
$$;

-- Flush real constraint triggers before rollback, rather than allowing rollback
-- to hide a deferred imbalance.
CREATE TEMP TABLE top_up_unexpected_trigger_table(id uuid, transaction_id uuid);
CREATE TRIGGER top_up_unexpected_trigger BEFORE INSERT ON top_up_unexpected_trigger_table
FOR EACH ROW EXECUTE FUNCTION private.validate_wallet_transaction_deferred();
SELECT pg_temp.top_up_probe('unexpected trigger table fails closed',
  'INSERT INTO top_up_unexpected_trigger_table VALUES (gen_random_uuid(),gen_random_uuid())','23514');
SET CONSTRAINTS ALL IMMEDIATE;
SELECT pg_temp.top_up_check('deferred ledger constraints pass',true);
TABLE top_up_results;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM top_up_results WHERE NOT passed) THEN
    RAISE EXCEPTION '0066 wallet top-up behavioral checks failed';
  END IF;
END $$;
ROLLBACK;
