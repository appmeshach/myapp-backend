BEGIN;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
CREATE TEMP TABLE wallet_audit_results(name text PRIMARY KEY, passed boolean NOT NULL) ON COMMIT DROP;
CREATE FUNCTION pg_temp.check_wallet(n text, ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL %', n; END IF;
  INSERT INTO wallet_audit_results VALUES(n,true);
  RAISE NOTICE 'PASS %', n;
END $$;

-- Role switching is outside the exception block so a SET ROLE failure cannot
-- masquerade as an expected application denial. Successful reads/writes persist
-- only within the outer rollback transaction; failed calls use subtransactions.
CREATE FUNCTION pg_temp.wallet_query(r text, m uuid, command text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE result jsonb; old_role text := current_setting('role');
BEGIN
  PERFORM set_config('request.jwt.claim.sub',coalesce(m::text,''),true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',m,'role',r)::text,true);
  PERFORM set_config('role',r,true);
  BEGIN
    EXECUTE 'SELECT to_jsonb(q) FROM ('||command||') q' INTO result;
    result := jsonb_build_object('state','00000','row',result);
  EXCEPTION WHEN OTHERS THEN result := jsonb_build_object('state',SQLSTATE,'message',SQLERRM);
  END;
  PERFORM set_config('role',old_role,true);
  RETURN result;
END $$;
CREATE FUNCTION pg_temp.wallet_probe(n text, command text, expected text, r text DEFAULT 'postgres')
RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual text; old_role text := current_setting('role');
BEGIN
  PERFORM set_config('role',r,true);
  BEGIN
    EXECUTE command;
    RAISE EXCEPTION USING ERRCODE='ZT067',MESSAGE='rollback successful probe';
  EXCEPTION WHEN OTHERS THEN actual := SQLSTATE;
  END;
  PERFORM set_config('role',old_role,true);
  IF actual='ZT067' THEN actual:='00000'; END IF;
  PERFORM pg_temp.check_wallet(n||' [SQLSTATE '||expected||']',actual=expected);
END $$;
CREATE TEMP TABLE wallet_audit_members(label integer PRIMARY KEY, id uuid) ON COMMIT DROP;
INSERT INTO wallet_audit_members SELECT i,gen_random_uuid() FROM generate_series(1,7) i;
INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
SELECT id,'authenticated','authenticated',id::text||'@wallet-foundation-audit.invalid','{}','{}',now(),now()
FROM wallet_audit_members;

-- 0067 first; do not resume the older-foundation audit unless this passes.
DO $$
DECLARE m uuid; p1 uuid; p2 uuid; closed_member uuid; r jsonb; again jsonb; before_rows jsonb;
  role_name text; fn oid := 'public.ensure_ngn_wallet_accounts_for_server(uuid)'::regprocedure;
BEGIN
  SELECT id INTO m FROM wallet_audit_members WHERE label=1;
  SELECT id INTO p1 FROM wallet_audit_members WHERE label=2;
  SELECT id INTO p2 FROM wallet_audit_members WHERE label=3;
  SELECT id INTO closed_member FROM wallet_audit_members WHERE label=4;
  r:=pg_temp.wallet_query('service_role',NULL,format('SELECT * FROM public.ensure_ngn_wallet_accounts_for_server(%L)',m));
  PERFORM pg_temp.check_wallet('0067 service_role provisions zero-account member',r->>'state'='00000');
  PERFORM pg_temp.check_wallet('0067 exactly three active NGN kinds',(
    SELECT count(*)=3 AND count(DISTINCT account_kind)=3 AND bool_and(status='active' AND currency='NGN') FROM private.wallet_accounts WHERE member_id=m));
  SELECT jsonb_agg(to_jsonb(a) ORDER BY id) INTO before_rows FROM private.wallet_accounts a WHERE member_id=m;
  again:=pg_temp.wallet_query('service_role',NULL,format('SELECT * FROM public.ensure_ngn_wallet_accounts_for_server(%L)',m));
  PERFORM pg_temp.check_wallet('0067 replay returns identical IDs and contract',again=r);
  PERFORM pg_temp.check_wallet('0067 replay inserts nothing',before_rows=(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM private.wallet_accounts a WHERE member_id=m));
  INSERT INTO private.wallet_accounts(member_id,account_kind,currency)
  VALUES(p1,'member_available','NGN'),(p2,'member_available','NGN'),(p2,'member_held','NGN');
  FOREACH m IN ARRAY ARRAY[p1,p2] LOOP
    SELECT jsonb_agg(to_jsonb(a) ORDER BY id) INTO before_rows FROM private.wallet_accounts a WHERE member_id=m;
    r:=pg_temp.wallet_query('service_role',NULL,format('SELECT * FROM public.ensure_ngn_wallet_accounts_for_server(%L)',m));
    PERFORM pg_temp.check_wallet('0067 partial '||jsonb_array_length(before_rows)||' rejected',r->>'state'='23514');
    PERFORM pg_temp.check_wallet('0067 partial '||jsonb_array_length(before_rows)||' not repaired',before_rows=(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM private.wallet_accounts a WHERE member_id=m));
  END LOOP;
  PERFORM * FROM public.ensure_ngn_wallet_accounts_for_server(closed_member);
  UPDATE private.wallet_accounts SET status='closed' WHERE member_id=closed_member AND account_kind='member_held';
  SELECT jsonb_agg(to_jsonb(a) ORDER BY id) INTO before_rows FROM private.wallet_accounts a WHERE member_id=closed_member;
  r:=pg_temp.wallet_query('service_role',NULL,format('SELECT * FROM public.ensure_ngn_wallet_accounts_for_server(%L)',closed_member));
  PERFORM pg_temp.check_wallet('0067 closed wallet rejected',r->>'state'='23514');
  PERFORM pg_temp.check_wallet('0067 closed wallet unchanged',before_rows=(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM private.wallet_accounts a WHERE member_id=closed_member));
  PERFORM pg_temp.wallet_probe('0067 nonexistent member','SELECT * FROM public.ensure_ngn_wallet_accounts_for_server(gen_random_uuid())','23503','service_role');
  PERFORM pg_temp.wallet_probe('0067 null member','SELECT * FROM public.ensure_ngn_wallet_accounts_for_server(NULL)','22004','service_role');
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    PERFORM pg_temp.wallet_probe('0067 '||role_name||' cannot provision',format('SELECT * FROM public.ensure_ngn_wallet_accounts_for_server(%L)',closed_member),'42501',role_name);
  END LOOP;
  PERFORM pg_temp.check_wallet('0067 PUBLIC cannot execute',NOT EXISTS(
    SELECT 1 FROM pg_proc p,LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=fn AND a.grantee=0 AND a.privilege_type='EXECUTE'));
  SELECT id INTO m FROM wallet_audit_members WHERE label=1;
  r:=pg_temp.wallet_query('authenticated',m,'SELECT * FROM public.get_my_wallet_balance()');
  PERFORM pg_temp.check_wallet('0067 unchanged provisioned zero balance response',r=jsonb_build_object('state','00000','row',jsonb_build_object('currency','NGN','wallet_ready',true,'available_minor',0,'held_minor',0,'withdrawable_minor',0)));
END $$;

-- A test-only double-entry fixture helper. It does not replace any production
-- function and invokes all ordinary checks and deferred triggers.
CREATE FUNCTION pg_temp.wallet_pair(debit uuid, credit uuid, amount bigint) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE t uuid;
BEGIN
  INSERT INTO private.wallet_transactions(transaction_kind,currency,idempotency_key)
  VALUES('internal_transfer','NGN','audit-'||gen_random_uuid()::text) RETURNING id INTO t;
  INSERT INTO private.wallet_postings(transaction_id,account_id,direction,amount_minor)
  VALUES(t,debit,'debit',amount),(t,credit,'credit',amount);
  RETURN t;
END $$;

DO $$
DECLARE m uuid; other_m uuid; available uuid; held uuid; withdrawable uuid; other_a uuid; usd uuid;
  tx uuid; t text; role_name text; operation text; column_name text; kind text; r jsonb; n bigint;
BEGIN
  SELECT id INTO m FROM wallet_audit_members WHERE label=1;
  SELECT id INTO other_m FROM wallet_audit_members WHERE label=5;
  PERFORM * FROM public.ensure_ngn_wallet_accounts_for_server(other_m);
  SELECT id INTO available FROM private.wallet_accounts WHERE member_id=m AND account_kind='member_available';
  SELECT id INTO held FROM private.wallet_accounts WHERE member_id=m AND account_kind='member_held';
  SELECT id INTO withdrawable FROM private.wallet_accounts WHERE member_id=m AND account_kind='member_withdrawable';
  SELECT id INTO other_a FROM private.wallet_accounts WHERE member_id=other_m AND account_kind='member_available';
  INSERT INTO private.wallet_accounts(member_id,account_kind,currency) VALUES(m,'member_available','USD') RETURNING id INTO usd;
  tx:=pg_temp.wallet_pair(other_a,available,100);
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  PERFORM pg_temp.check_wallet('0064 valid two-posting transaction flushes deferred constraints',true);
  FOREACH t IN ARRAY ARRAY['wallet_accounts','wallet_transactions','wallet_postings'] LOOP
    PERFORM pg_temp.check_wallet('0064 PUBLIC no table privilege '||t,NOT EXISTS(
      SELECT 1 FROM pg_class c,LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
      WHERE c.oid=('private.'||t)::regclass AND a.grantee=0));
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      PERFORM pg_temp.wallet_probe('0064 '||role_name||' cannot SELECT '||t,'SELECT * FROM private.'||t,'42501',role_name);
      PERFORM pg_temp.check_wallet('0064 '||role_name||' has no direct privileges '||t,NOT has_table_privilege(role_name,'private.'||t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'));
    END LOOP;
    PERFORM pg_temp.wallet_probe('0064 service SELECT '||t,'SELECT * FROM private.'||t,'00000','service_role');
    PERFORM pg_temp.wallet_probe('0064 service INSERT '||t,'INSERT INTO private.'||t||' DEFAULT VALUES','42501','service_role');
    PERFORM pg_temp.wallet_probe('0064 service UPDATE '||t,'UPDATE private.'||t||' SET id=id','42501','service_role');
    PERFORM pg_temp.wallet_probe('0064 service DELETE '||t,'DELETE FROM private.'||t,'42501','service_role');
    PERFORM pg_temp.wallet_probe('0064 service TRUNCATE '||t,'TRUNCATE private.'||t,'42501','service_role');
  END LOOP;
  PERFORM pg_temp.wallet_probe('0064 no postings deferred rejection',
    'INSERT INTO private.wallet_transactions(transaction_kind,currency,idempotency_key) VALUES(''internal_transfer'',''NGN'',''audit-empty''); SET CONSTRAINTS ALL IMMEDIATE','23514');
  PERFORM pg_temp.wallet_probe('0064 unbalanced deferred rejection',format(
    'INSERT INTO private.wallet_postings(transaction_id,account_id,direction,amount_minor) VALUES(%L,%L,''credit'',1); SET CONSTRAINTS ALL IMMEDIATE',tx,held),'23514');
  PERFORM pg_temp.wallet_probe('0064 currency mismatch',format('INSERT INTO private.wallet_postings(transaction_id,account_id,direction,amount_minor) VALUES(%L,%L,''credit'',1)',tx,usd),'23514');
  PERFORM pg_temp.wallet_probe('0064 closed account posting',format('UPDATE private.wallet_accounts SET status=''closed'' WHERE id=%L; INSERT INTO private.wallet_postings(transaction_id,account_id,direction,amount_minor) VALUES(%L,%L,''credit'',1)',held,tx,held),'23514');
  FOREACH column_name IN ARRAY ARRAY['id','member_id','account_kind','currency','created_at'] LOOP
    operation:=CASE column_name WHEN 'id' THEN 'gen_random_uuid()' WHEN 'member_id' THEN quote_literal(other_m)
      WHEN 'account_kind' THEN quote_literal('member_held') WHEN 'currency' THEN quote_literal('EUR') ELSE 'created_at + interval ''1 second''' END;
    PERFORM pg_temp.wallet_probe('0064 account identity '||column_name,format('UPDATE private.wallet_accounts SET %I=%s WHERE id=%L',column_name,operation,available),'23514');
  END LOOP;
  PERFORM pg_temp.wallet_probe('0064 cannot reopen',format('UPDATE private.wallet_accounts SET status=''closed'' WHERE id=%L; UPDATE private.wallet_accounts SET status=''active'' WHERE id=%L',held,held),'23514');
  FOREACH t IN ARRAY ARRAY['wallet_transactions','wallet_postings'] LOOP
    FOREACH operation IN ARRAY ARRAY['UPDATE private.'||t||' SET id=id','DELETE FROM private.'||t,'TRUNCATE private.'||t||' CASCADE'] LOOP
      PERFORM pg_temp.wallet_probe('0064 immutable '||operation,operation,'23514');
    END LOOP;
  END LOOP;
  PERFORM pg_temp.wallet_probe('0064 duplicate idempotency',format('INSERT INTO private.wallet_transactions(transaction_kind,currency,idempotency_key) SELECT transaction_kind,currency,idempotency_key FROM private.wallet_transactions WHERE id=%L',tx),'23505');
  PERFORM pg_temp.wallet_probe('0064 duplicate provider reference',
    'INSERT INTO private.wallet_transactions(transaction_kind,currency,idempotency_key,provider,provider_reference) VALUES(''wallet_top_up'',''NGN'',''audit-p1'',''audit'',''event''),(''wallet_top_up'',''NGN'',''audit-p2'',''audit'',''event'')','23505');
  FOREACH kind IN ARRAY ARRAY['movement_hold','movement_hold_release','requester_platform_charge','offering_platform_charge','movement_contribution_settlement','refund'] LOOP
    PERFORM pg_temp.wallet_probe('0064 alignment required '||kind,format('INSERT INTO private.wallet_transactions(transaction_kind,currency,idempotency_key,financial_component_id) VALUES(%L,''NGN'',''audit-alignment'',gen_random_uuid())',kind),'23514');
  END LOOP;
  FOREACH kind IN ARRAY ARRAY['requester_platform_charge','offering_platform_charge','movement_contribution_settlement'] LOOP
    PERFORM pg_temp.wallet_probe('0064 component required '||kind,format('INSERT INTO private.wallet_transactions(transaction_kind,currency,idempotency_key,alignment_id) VALUES(%L,''NGN'',''audit-component'',gen_random_uuid())',kind),'23514');
  END LOOP;
  PERFORM pg_temp.wallet_probe('0064 LIMITATION nonzero account can be closed',format('UPDATE private.wallet_accounts SET status=''closed'' WHERE id=%L; SET CONSTRAINTS ALL IMMEDIATE',available),'00000');
  PERFORM pg_temp.wallet_probe('0064 LIMITATION second posting to same account rejected',format('INSERT INTO private.wallet_postings(transaction_id,account_id,direction,amount_minor) VALUES(%L,%L,''debit'',1)',tx,available),'23505');
END $$;

DO $$
DECLARE m uuid; second uuid; empty_member uuid; boundary_member uuid; available uuid; held uuid; withdrawable uuid;
  second_a uuid; boundary_a uuid; boundary_h uuid; boundary_w uuid; r jsonb; before_n bigint; tx uuid; partial_member uuid;
BEGIN
  SELECT id INTO m FROM wallet_audit_members WHERE label=1;
  SELECT id INTO second FROM wallet_audit_members WHERE label=5;
  SELECT id INTO empty_member FROM wallet_audit_members WHERE label=6;
  SELECT id INTO boundary_member FROM wallet_audit_members WHERE label=7;
  SELECT id INTO available FROM private.wallet_accounts WHERE member_id=m AND account_kind='member_available' AND currency='NGN';
  SELECT id INTO held FROM private.wallet_accounts WHERE member_id=m AND account_kind='member_held';
  SELECT id INTO withdrawable FROM private.wallet_accounts WHERE member_id=m AND account_kind='member_withdrawable';
  SELECT id INTO second_a FROM private.wallet_accounts WHERE member_id=second AND account_kind='member_available';
  SELECT count(*) INTO before_n FROM private.wallet_accounts;
  r:=pg_temp.wallet_query('authenticated',empty_member,'SELECT * FROM public.get_my_wallet_balance()');
  PERFORM pg_temp.check_wallet('0065 real unprovisioned member zero not-ready response',r=jsonb_build_object('state','00000','row',jsonb_build_object('currency','NGN','wallet_ready',false,'available_minor',0,'held_minor',0,'withdrawable_minor',0)));
  PERFORM pg_temp.check_wallet('0065 read creates no accounts',before_n=(SELECT count(*) FROM private.wallet_accounts));
  r:=pg_temp.wallet_query('authenticated',NULL,'SELECT * FROM public.get_my_wallet_balance()');
  PERFORM pg_temp.check_wallet('0065 missing auth identity rejected',r->>'state'='42501');
  r:=pg_temp.wallet_query('anon',NULL,'SELECT * FROM public.get_my_wallet_balance()');
  PERFORM pg_temp.check_wallet('0065 anon balance rejected',r->>'state'='42501');
  r:=pg_temp.wallet_query('authenticated',gen_random_uuid(),'SELECT * FROM public.get_my_wallet_balance()');
  PERFORM pg_temp.check_wallet('0065 nonexistent auth member rejected',r->>'state'='42501');
  FOR partial_member IN SELECT id FROM wallet_audit_members WHERE label IN (2,3,4) LOOP
    r:=pg_temp.wallet_query('authenticated',partial_member,'SELECT * FROM public.get_my_wallet_balance()');
    PERFORM pg_temp.check_wallet('0065 partial or closed balance rejected fixture '||(SELECT label FROM wallet_audit_members WHERE id=partial_member),r->>'state'='23514');
  END LOOP;
  -- The previous fixture gave member 1 +100 and member 5 -100. Confirm the
  -- negative projection fails, then balance that fixture for isolation checks.
  r:=pg_temp.wallet_query('authenticated',second,'SELECT * FROM public.get_my_wallet_balance()');
  PERFORM pg_temp.check_wallet('0065 negative balance rejected',r->>'state'='23514');
  PERFORM pg_temp.wallet_pair(available,second_a,100);
  -- Use the existing trusted top-up to fund a real positive member fixture.
  PERFORM public.record_wallet_top_up_for_server(m,1000,'NGN','audit',gen_random_uuid()::text);
  PERFORM pg_temp.wallet_pair(available,held,300);
  PERFORM pg_temp.wallet_pair(held,withdrawable,120);
  PERFORM pg_temp.wallet_pair(withdrawable,available,20);
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  r:=pg_temp.wallet_query('authenticated',m,'SELECT * FROM public.get_my_wallet_balance()');
  PERFORM pg_temp.check_wallet('0065 actual credit/debit projection available 720 held 180 withdrawable 100',
    r=jsonb_build_object('state','00000','row',jsonb_build_object('currency','NGN','wallet_ready',true,'available_minor',720,'held_minor',180,'withdrawable_minor',100)));
  PERFORM pg_temp.check_wallet('0065 response has only five public fields and no internal IDs',
    (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(r->'row') k)=ARRAY['available_minor','currency','held_minor','wallet_ready','withdrawable_minor']);
  r:=pg_temp.wallet_query('authenticated',second,'SELECT * FROM public.get_my_wallet_balance()');
  PERFORM pg_temp.check_wallet('0065 second member sees own zero balances only',r=jsonb_build_object('state','00000','row',jsonb_build_object('currency','NGN','wallet_ready',true,'available_minor',0,'held_minor',0,'withdrawable_minor',0)));
  PERFORM * FROM public.ensure_ngn_wallet_accounts_for_server(boundary_member);
  SELECT id INTO boundary_a FROM private.wallet_accounts WHERE member_id=boundary_member AND account_kind='member_available';
  SELECT id INTO boundary_h FROM private.wallet_accounts WHERE member_id=boundary_member AND account_kind='member_held';
  SELECT id INTO boundary_w FROM private.wallet_accounts WHERE member_id=boundary_member AND account_kind='member_withdrawable';
  PERFORM pg_temp.wallet_pair(second_a,boundary_a,9223372036854775807);
  r:=pg_temp.wallet_query('authenticated',boundary_member,'SELECT * FROM public.get_my_wallet_balance()');
  PERFORM pg_temp.check_wallet('0065 bigint maximum projects exactly',r->>'state'='00000' AND (r->'row'->>'available_minor')::numeric=9223372036854775807::numeric);
  PERFORM pg_temp.wallet_pair(second_a,boundary_a,1);
  r:=pg_temp.wallet_query('authenticated',boundary_member,'SELECT * FROM public.get_my_wallet_balance()');
  PERFORM pg_temp.check_wallet('0065 above bigint maximum rejected safely',r->>'state'='23514');
  -- Per-posting bigint is bounded; aggregate debit and credit totals may exceed
  -- bigint while remaining equal. Four distinct accounts avoid the unique key.
  INSERT INTO private.wallet_transactions(transaction_kind,currency,idempotency_key)
  VALUES('internal_transfer','NGN','audit-large-'||gen_random_uuid()::text) RETURNING id INTO tx;
  INSERT INTO private.wallet_postings(transaction_id,account_id,direction,amount_minor) VALUES
    (tx,available,'debit',9223372036854775807),(tx,held,'debit',9223372036854775807),
    (tx,boundary_h,'credit',9223372036854775807),(tx,boundary_w,'credit',9223372036854775807);
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  PERFORM pg_temp.check_wallet('0064 numeric aggregate beyond bigint remains balanced',(
    SELECT sum(amount_minor) FILTER(WHERE direction='credit')=18446744073709551614::numeric FROM private.wallet_postings WHERE transaction_id=tx));
END $$;
SELECT split_part(name,' ',1) AS foundation,count(*) AS passed,0 AS failed FROM wallet_audit_results GROUP BY 1 ORDER BY 1;
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;
