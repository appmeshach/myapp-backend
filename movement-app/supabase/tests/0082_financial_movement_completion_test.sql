BEGIN;
CREATE FUNCTION pg_temp.completion_result(p_confirm boolean DEFAULT false,p_member uuid DEFAULT NULL,p_role text DEFAULT 'authenticated')
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE f record; BEGIN SELECT * INTO STRICT f FROM pg_temp.snapshot_fixture;
 RETURN pg_temp.snapshot_select_as(p_role,coalesce(p_member,CASE WHEN p_confirm THEN f.requester ELSE f.offerer END),
  format('SELECT * FROM public.%I(%L::uuid)',CASE WHEN p_confirm THEN 'confirm_my_funded_movement_completion' ELSE 'request_my_funded_movement_completion' END,f.need));
END $$;
CREATE FUNCTION pg_temp.prepare_completion() RETURNS void LANGUAGE plpgsql AS $$
DECLARE f record; g private.financial_agreements%ROWTYPE; required bigint;
BEGIN
 SELECT * INTO STRICT f FROM pg_temp.snapshot_fixture;
 SELECT x.* INTO STRICT g FROM private.financial_agreements x WHERE x.id=(SELECT agreement FROM pg_temp.funding_fixture);
 PERFORM pg_temp.prepare_activation_faces();
 SELECT sum(amount_minor::numeric)::bigint INTO required FROM private.financial_components WHERE agreement_id=g.id AND component_key IN ('requester_platform_share','movement_contribution');
 SET CONSTRAINTS private.wallet_transaction_balanced_after_transaction,private.wallet_transaction_balanced_after_posting DEFERRED;
 PERFORM public.record_wallet_top_up_for_server(f.requester,required+100,'NGN','test-0082','fund-'||gen_random_uuid());
 PERFORM pg_temp.funding_succeed(pg_temp.hold_result());
 PERFORM pg_temp.funding_succeed(pg_temp.activation_result());
 PERFORM pg_temp.funding_succeed(pg_temp.coordination_result());
 PERFORM pg_temp.funding_succeed(pg_temp.coordination_as(f.offerer,format('SELECT * FROM public.set_my_movement_meeting_point(%L,''Station entrance'',NULL)',f.need)));
 PERFORM pg_temp.funding_succeed(pg_temp.start_result());
 PERFORM pg_temp.funding_succeed(pg_temp.start_result(true));
END $$;
CREATE FUNCTION pg_temp.completion_pair(p_debit uuid,p_credit uuid,p_amount bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE t uuid; BEGIN
 SET CONSTRAINTS private.wallet_transaction_balanced_after_transaction,private.wallet_transaction_balanced_after_posting DEFERRED;
 INSERT INTO private.wallet_transactions(transaction_kind,currency,idempotency_key) VALUES('internal_transfer','NGN','test-0082:'||gen_random_uuid()) RETURNING id INTO t;
 INSERT INTO private.wallet_postings(transaction_id,account_id,direction,amount_minor) VALUES(t,p_debit,'debit',p_amount),(t,p_credit,'credit',p_amount);
 PERFORM private.assert_wallet_transaction_balanced(t);
END $$;
CREATE FUNCTION pg_temp.completion_bad_balance(p_kind text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE f record; debit_id uuid; credit_id uuid; BEGIN
 SELECT * INTO STRICT f FROM pg_temp.snapshot_fixture;
 SELECT id INTO STRICT debit_id FROM private.wallet_accounts WHERE currency='NGN' AND account_kind='provider_clearing';
 IF p_kind='held' THEN
  SELECT id INTO STRICT debit_id FROM private.wallet_accounts WHERE member_id=f.requester AND account_kind='member_held' AND currency='NGN';
  SELECT id INTO STRICT credit_id FROM private.wallet_accounts WHERE member_id=f.requester AND account_kind='member_available' AND currency='NGN';
  PERFORM pg_temp.completion_pair(debit_id,credit_id,1);
 ELSIF p_kind='offerer' THEN
  PERFORM public.ensure_ngn_wallet_accounts_for_server(f.offerer);
  SELECT id INTO STRICT credit_id FROM private.wallet_accounts WHERE member_id=f.offerer AND account_kind='member_withdrawable' AND currency='NGN';
  PERFORM pg_temp.completion_pair(debit_id,credit_id,9223372036854775807);
 ELSE
  INSERT INTO private.wallet_accounts(member_id,account_kind,currency) VALUES(NULL,'platform_revenue','NGN') ON CONFLICT(account_kind,currency) WHERE member_id IS NULL DO NOTHING;
  SELECT id INTO STRICT credit_id FROM private.wallet_accounts WHERE member_id IS NULL AND account_kind='platform_revenue' AND currency='NGN';
  IF p_kind='closed_platform' THEN UPDATE private.wallet_accounts SET status='closed' WHERE id=credit_id;
  ELSE PERFORM pg_temp.completion_pair(debit_id,credit_id,9223372036854775807); END IF;
 END IF;
 PERFORM pg_temp.consent_rejected(pg_temp.completion_result(true),'23514');
END $$;
CREATE FUNCTION pg_temp.completion_other_sources(p_superseded_agreement uuid DEFAULT NULL,p_touched_offer uuid DEFAULT NULL) RETURNS text LANGUAGE plpgsql AS $$
DECLARE x record; h text; result text:=''; BEGIN
 FOR x IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r'
  AND n.nspname IN ('public','private','auth','supabase_migrations')
  AND (n.nspname,c.relname) NOT IN (('public','journeys'),('public','alignments'),('private','funded_movement_completion_requests'),
   ('private','funded_movement_completions'),('private','wallet_accounts'),('private','wallet_transactions'),('private','wallet_postings')) ORDER BY 1,2 LOOP
  IF (x.nspname,x.relname)=('private','financial_agreements') AND p_superseded_agreement IS NOT NULL THEN
   EXECUTE 'SELECT md5(coalesce(string_agg(v::text, '''' ORDER BY v::text), '''')) FROM (SELECT CASE WHEN id=$1 THEN to_jsonb(t)||jsonb_build_object(''status'',''current'') ELSE to_jsonb(t) END v FROM private.financial_agreements t) normalized' INTO h USING p_superseded_agreement;
  ELSIF (x.nspname,x.relname)=('public','movement_offers') AND p_touched_offer IS NOT NULL THEN
   EXECUTE 'SELECT md5(coalesce(string_agg(v::text, '''' ORDER BY v::text), '''')) FROM (SELECT CASE WHEN id=$1 THEN to_jsonb(t)||jsonb_build_object(''updated_at'',NULL) ELSE to_jsonb(t) END v FROM public.movement_offers t) normalized' INTO h USING p_touched_offer;
  ELSE
   EXECUTE format('SELECT md5(coalesce(string_agg(to_jsonb(t)::text, '''' ORDER BY to_jsonb(t)::text), '''')) FROM %I.%I t',x.nspname,x.relname) INTO h;
  END IF;
  result:=result||x.nspname||'.'||x.relname||':'||h;
 END LOOP; RETURN md5(result); END $$;
-- COMPLETION_0082_TESTS:
DO $tests$
DECLARE f record; g private.financial_agreements%ROWTYPE; j uuid; r jsonb; retry jsonb; before text; others text;
 actor uuid; role text; key text; state text; requested timestamptz; completed timestamptz;
 held numeric; platform numeric; withdrawable numeric; charge numeric; contribution numeric; offering numeric;
BEGIN
 SELECT * INTO STRICT f FROM pg_temp.snapshot_fixture;
 SELECT x.* INTO STRICT g FROM private.financial_agreements x WHERE x.id=(SELECT agreement FROM pg_temp.funding_fixture);
 r:=pg_temp.completion_result();PERFORM pg_temp.snapshot_check('completion without start denied',r->>'state'='23514');
 PERFORM pg_temp.prepare_completion();
 SELECT id INTO STRICT j FROM public.journeys WHERE alignment_id=g.alignment_id;
 r:=pg_temp.completion_result(true);PERFORM pg_temp.snapshot_check('premature completion denied',r->>'state'='23514');
 FOREACH role IN ARRAY ARRAY['anon','service_role'] LOOP
  r:=pg_temp.completion_result(false,NULL,role);PERFORM pg_temp.snapshot_check(role||' completion request denied',r->>'state'='42501');
  r:=pg_temp.completion_result(true,NULL,role);PERFORM pg_temp.snapshot_check(role||' completion confirmation denied',r->>'state'='42501');
 END LOOP;
 FOREACH actor IN ARRAY ARRAY[f.requester,f.traveller,gen_random_uuid()] LOOP
  r:=pg_temp.completion_result(false,actor);PERFORM pg_temp.snapshot_check('exact offerer completion authority '||actor,r->>'state'='42501'); END LOOP;
 FOREACH actor IN ARRAY ARRAY[f.offerer,f.traveller,gen_random_uuid()] LOOP
  r:=pg_temp.completion_result(true,actor);PERFORM pg_temp.snapshot_check('exact requester completion authority '||actor,r->>'state'='42501'); END LOOP;
 PERFORM pg_temp.probe('completion request rollback','SELECT pg_temp.funding_succeed(pg_temp.completion_result())');
 PERFORM pg_temp.snapshot_check('request rollback leaves no receipt',NOT EXISTS(SELECT 1 FROM private.funded_movement_completion_requests WHERE alignment_id=g.alignment_id));
 PERFORM pg_temp.probe('journey only completion rejected',format('UPDATE public.journeys SET status=''completed'',completed_at=clock_timestamp() WHERE id=%L',j),'23514');
 PERFORM pg_temp.probe('alignment only completion rejected',format('UPDATE public.alignments SET status=''completed'' WHERE id=%L',g.alignment_id),'23514');
 before:=pg_temp.materialization_sources();r:=pg_temp.completion_result();PERFORM pg_temp.funding_succeed(r);
 SELECT completion_requested_at INTO requested FROM public.journeys WHERE id=j;
 PERFORM pg_temp.snapshot_check('completion request one exact receipt',(SELECT count(*) FROM private.funded_movement_completion_requests WHERE alignment_id=g.alignment_id AND financial_agreement_id=g.id AND journey_id=j AND requested_at=requested)=1);
 PERFORM pg_temp.snapshot_check('completion request keeps in progress',r#>>'{rows,0,journey_state}'='in_progress' AND r#>>'{rows,0,settlement_state}'='awaiting_confirmation');
 before:=pg_temp.materialization_sources();retry:=pg_temp.completion_result();PERFORM pg_temp.funding_succeed(retry);
 PERFORM pg_temp.snapshot_check('request historical zero writes',r=retry AND before=pg_temp.materialization_sources());
 PERFORM pg_temp.probe('confirmation rollback','SELECT pg_temp.funding_succeed(pg_temp.completion_result(true))');
 PERFORM pg_temp.snapshot_check('confirmation rollback leaves no settlement',NOT EXISTS(SELECT 1 FROM private.funded_movement_completions WHERE alignment_id=g.alignment_id));
 PERFORM pg_temp.probe('closed requester account fails',format('UPDATE private.wallet_accounts SET status=''closed'' WHERE member_id=%L AND account_kind=''member_withdrawable''; SELECT pg_temp.consent_rejected(pg_temp.completion_result(true),''23514'')',f.requester));
 PERFORM pg_temp.probe('partial offerer wallet fails',format('INSERT INTO private.wallet_accounts(member_id,account_kind,currency) VALUES(%L,''member_available'',''NGN''); SELECT pg_temp.consent_rejected(pg_temp.completion_result(true),''23514'')',f.offerer));
 PERFORM pg_temp.probe('closed offerer wallet fails',format('SELECT public.ensure_ngn_wallet_accounts_for_server(%L); UPDATE private.wallet_accounts SET status=''closed'' WHERE member_id=%L AND account_kind=''member_withdrawable''; SELECT pg_temp.consent_rejected(pg_temp.completion_result(true),''23514'')',f.offerer,f.offerer));
 PERFORM pg_temp.probe('aggregate held insufficiency despite exact historical hold','SELECT pg_temp.completion_bad_balance(''held'')');
 PERFORM pg_temp.probe('offerer intermediate credit bigint overflow before settlement','SELECT pg_temp.completion_bad_balance(''offerer'')');
 IF g.quoted_platform_fee_total_minor>0 THEN PERFORM pg_temp.probe('platform revenue bigint overflow before settlement','SELECT pg_temp.completion_bad_balance(''platform'')'); END IF;
 PERFORM pg_temp.probe('closed platform revenue fails','SELECT pg_temp.completion_bad_balance(''closed_platform'')');
 PERFORM pg_temp.probe('protected component beneficiary cannot be rewritten',format('UPDATE private.financial_components SET beneficiary_member_id=gen_random_uuid() WHERE agreement_id=%L AND component_key=''movement_contribution''',g.id),'23514');
 PERFORM pg_temp.probe('protected hold posting cannot be rewritten',format('UPDATE private.wallet_postings SET amount_minor=amount_minor+1 WHERE transaction_id IN (SELECT id FROM private.wallet_transactions WHERE alignment_id=%L AND transaction_kind=''movement_hold'')',g.alignment_id),'23514');
 PERFORM pg_temp.probe('extra hold posting invalidates exact funding graph',format('INSERT INTO private.wallet_postings(transaction_id,account_id,direction,amount_minor) SELECT t.id,a.id,''credit'',1 FROM private.wallet_transactions t JOIN private.financial_components c ON c.id=t.financial_component_id JOIN private.wallet_accounts a ON a.member_id=%L AND a.account_kind=''member_withdrawable'' AND a.currency=''NGN'' WHERE c.agreement_id=%L AND t.transaction_kind=''movement_hold'' LIMIT 1',f.requester,g.id),'23514');
 PERFORM pg_temp.probe('legacy settlement history cannot be inserted',format('INSERT INTO private.movement_settlements(alignment_id,journey_id,beneficiary_member_id,status) VALUES(%L,%L,%L,''pending_amount'')',g.alignment_id,j,f.offerer),'23514');
 PERFORM pg_temp.probe('ledger only settlement cannot commit',format('SELECT set_config(''request.jwt.claim.sub'',%L,true); INSERT INTO private.wallet_transactions(transaction_kind,currency,alignment_id,financial_component_id,idempotency_key) SELECT ''movement_contribution_settlement'',''NGN'',%L,id,''movement_contribution_settlement:''||id FROM private.financial_components WHERE agreement_id=%L AND component_key=''movement_contribution''',f.requester,g.alignment_id,g.id),'23514');
 PERFORM pg_temp.probe('receipt only completion cannot commit',format('SET CONSTRAINTS private.funded_completion_complete DEFERRED; SELECT set_config(''request.jwt.claim.sub'',%L,true); INSERT INTO private.funded_movement_completions VALUES(%L,%L,%L,clock_timestamp()); SET CONSTRAINTS private.funded_completion_complete IMMEDIATE',f.requester,g.alignment_id,g.id,j),'23514');
 PERFORM pg_temp.probe('completed lifecycle with missing settlement cannot commit',format('SET CONSTRAINTS private.funded_completion_complete,public.funded_start_journey_complete,public.funded_start_alignment_complete DEFERRED; SELECT set_config(''request.jwt.claim.sub'',%L,true); INSERT INTO private.funded_movement_completions VALUES(%L,%L,%L,clock_timestamp()); UPDATE public.journeys SET status=''completed'',completed_at=(SELECT completed_at FROM private.funded_movement_completions WHERE alignment_id=%L) WHERE id=%L; UPDATE public.alignments SET status=''completed'' WHERE id=%L; SET CONSTRAINTS private.funded_completion_complete IMMEDIATE',f.requester,g.alignment_id,g.id,j,g.alignment_id,j,g.alignment_id),'23514');
 SELECT max(amount_minor) FILTER(WHERE component_key='requester_platform_share'),max(amount_minor) FILTER(WHERE component_key='movement_contribution'),max(amount_minor) FILTER(WHERE component_key='offering_platform_share') INTO charge,contribution,offering FROM private.financial_components WHERE agreement_id=g.id;
 SELECT coalesce(sum(CASE WHEN p.direction='credit' THEN p.amount_minor::numeric ELSE -p.amount_minor::numeric END),0) INTO held FROM private.wallet_postings p JOIN private.wallet_accounts a ON a.id=p.account_id WHERE a.member_id=f.requester AND a.account_kind='member_held';
 SELECT coalesce(sum(CASE WHEN p.direction='credit' THEN p.amount_minor::numeric ELSE -p.amount_minor::numeric END),0) INTO platform FROM private.wallet_postings p JOIN private.wallet_accounts a ON a.id=p.account_id WHERE a.account_kind='platform_revenue' AND a.currency='NGN';
 SELECT coalesce(sum(CASE WHEN p.direction='credit' THEN p.amount_minor::numeric ELSE -p.amount_minor::numeric END),0) INTO withdrawable FROM private.wallet_postings p JOIN private.wallet_accounts a ON a.id=p.account_id WHERE a.member_id=f.offerer AND a.account_kind='member_withdrawable';
 others:=pg_temp.completion_other_sources();r:=pg_temp.completion_result(true);PERFORM pg_temp.funding_succeed(r);
 SELECT completed_at INTO STRICT completed FROM public.journeys WHERE id=j;
 PERFORM pg_temp.snapshot_check('completed exactly one authoritative receipt',(SELECT count(*) FROM private.funded_movement_completions WHERE alignment_id=g.alignment_id AND financial_agreement_id=g.id AND journey_id=j AND completed_at=completed)=1 AND completed>=requested);
 PERFORM pg_temp.snapshot_check('atomic completed lifecycle',(SELECT status='completed' FROM public.alignments WHERE id=g.alignment_id) AND r#>>'{rows,0,journey_state}'='completed' AND r#>>'{rows,0,settlement_state}'='settled');
 PERFORM pg_temp.snapshot_check('requester held drained exactly',(SELECT coalesce(sum(CASE WHEN p.direction='credit' THEN p.amount_minor::numeric ELSE -p.amount_minor::numeric END),0) FROM private.wallet_postings p JOIN private.wallet_accounts a ON a.id=p.account_id WHERE a.member_id=f.requester AND a.account_kind='member_held')=held-charge-contribution);
 PERFORM pg_temp.snapshot_check('offerer net exact contribution minus offering share',(SELECT sum(CASE WHEN p.direction='credit' THEN p.amount_minor::numeric ELSE -p.amount_minor::numeric END) FROM private.wallet_postings p JOIN private.wallet_accounts a ON a.id=p.account_id WHERE a.member_id=f.offerer AND a.account_kind='member_withdrawable')=withdrawable+contribution-offering);
 PERFORM pg_temp.snapshot_check('platform revenue exact stored fee',(SELECT coalesce(sum(CASE WHEN p.direction='credit' THEN p.amount_minor::numeric ELSE -p.amount_minor::numeric END),0) FROM private.wallet_postings p JOIN private.wallet_accounts a ON a.id=p.account_id WHERE a.account_kind='platform_revenue' AND a.currency='NGN')=platform+charge+offering);
 PERFORM pg_temp.snapshot_check('no unrelated financial operational side effects',others=pg_temp.completion_other_sources());
 PERFORM private.assert_funded_coordination_entry(g.alignment_id);
 before:=pg_temp.materialization_sources();retry:=pg_temp.completion_result(true);PERFORM pg_temp.funding_succeed(retry);
 PERFORM pg_temp.snapshot_check('settlement replay exact zero writes',r=retry AND before=pg_temp.materialization_sources());
 PERFORM pg_temp.probe('normal topup remains composable after completion',format('SELECT public.record_wallet_top_up_for_server(%L,1,''NGN'',''test-0082'',''after-completion-''||gen_random_uuid())',f.offerer));
 PERFORM pg_temp.probe('settlement amount history cannot be rewritten',format('UPDATE private.wallet_postings SET amount_minor=amount_minor+1 WHERE transaction_id IN (SELECT id FROM private.wallet_transactions WHERE alignment_id=%L AND transaction_kind=''movement_contribution_settlement'')',g.alignment_id),'23514');
 PERFORM pg_temp.probe('extra wrong amount posting fails exact graph',format('INSERT INTO private.wallet_postings(transaction_id,account_id,direction,amount_minor,created_at) SELECT t.id,a.id,''credit'',1,t.created_at FROM private.wallet_transactions t JOIN private.wallet_accounts a ON a.member_id=%L AND a.account_kind=''member_available'' AND a.currency=''NGN'' WHERE t.alignment_id=%L AND t.transaction_kind=''movement_contribution_settlement''',f.requester,g.alignment_id),'23514');
 PERFORM pg_temp.probe('wrong settlement account direction fails exact graph',format('INSERT INTO private.wallet_postings(transaction_id,account_id,direction,amount_minor,created_at) SELECT t.id,a.id,''debit'',c.amount_minor,t.created_at FROM private.wallet_transactions t JOIN private.financial_components c ON c.id=t.financial_component_id JOIN private.wallet_accounts a ON a.member_id=%L AND a.account_kind=''member_withdrawable'' AND a.currency=''NGN'' WHERE t.alignment_id=%L AND t.transaction_kind=''movement_contribution_settlement''',f.requester,g.alignment_id),'23514');
 PERFORM pg_temp.probe('wrong transaction kind fails closed',format('SELECT set_config(''request.jwt.claim.sub'',%L,true); INSERT INTO private.wallet_transactions(transaction_kind,currency,alignment_id,financial_component_id,idempotency_key,created_at) SELECT ''requester_platform_charge'',''NGN'',%L,c.id,''requester_platform_charge:''||c.id,r.completed_at FROM private.financial_components c JOIN private.funded_movement_completions r ON r.financial_agreement_id=c.agreement_id WHERE c.agreement_id=%L AND c.component_key=''movement_contribution''',f.requester,g.alignment_id,g.id),'23514');
 PERFORM pg_temp.probe('unsupported component ledger kind fails closed',format('INSERT INTO private.wallet_transactions(transaction_kind,currency,alignment_id,financial_component_id,idempotency_key) SELECT ''movement_hold_release'',''NGN'',%L,id,''test-0082:''||gen_random_uuid() FROM private.financial_components WHERE agreement_id=%L AND component_key=''movement_contribution''',g.alignment_id,g.id),'23514');
 PERFORM pg_temp.probe('extra competing settlement transaction rejected',format('SELECT set_config(''request.jwt.claim.sub'',%L,true); INSERT INTO private.wallet_transactions(transaction_kind,currency,alignment_id,financial_component_id,idempotency_key,created_at) SELECT t.transaction_kind,t.currency,t.alignment_id,t.financial_component_id,t.idempotency_key,t.created_at FROM private.wallet_transactions t WHERE t.alignment_id=%L AND t.transaction_kind=''movement_contribution_settlement''',f.requester,g.alignment_id),'23505');
 PERFORM pg_temp.probe('settled historical replay permits zero balance account closure',format('UPDATE private.wallet_accounts SET status=''closed'' WHERE member_id=%L AND account_kind=''member_held'' AND currency=''NGN''; SELECT pg_temp.funding_succeed(pg_temp.completion_result(true))',f.requester));
 retry:=pg_temp.completion_result();PERFORM pg_temp.funding_succeed(retry);PERFORM pg_temp.snapshot_check('completion request after settlement zero writes',r->'rows'=retry->'rows' AND before=pg_temp.materialization_sources());
 PERFORM pg_temp.funding_succeed(pg_temp.start_result(true));PERFORM pg_temp.snapshot_check('0081 replay after completion zero writes',before=pg_temp.materialization_sources());
 PERFORM pg_temp.probe('superseded agreement settled replay',format('UPDATE private.financial_agreements SET status=''superseded'' WHERE id=%L; SET CONSTRAINTS ALL IMMEDIATE; SELECT pg_temp.funding_succeed(pg_temp.completion_result(true))',g.id));
 FOREACH state IN ARRAY ARRAY['in_progress','cancelled','failed'] LOOP
  PERFORM pg_temp.probe('terminal journey immutable '||state,format('UPDATE public.journeys SET status=%L WHERE id=%L',state,j),'23514');
  PERFORM pg_temp.probe('terminal alignment immutable '||state,format('UPDATE public.alignments SET status=%L WHERE id=%L',state,g.alignment_id),'23514'); END LOOP;
 FOREACH key IN ARRAY ARRAY['started_at','start_requested_at','completion_requested_at','completed_at','end_requested_at'] LOOP
  PERFORM pg_temp.probe('timestamp immutable '||key,format('UPDATE public.journeys SET %I=clock_timestamp() WHERE id=%L',key,j),'23514'); END LOOP;
 FOREACH key IN ARRAY ARRAY['request_journey_completion','confirm_journey_completion','request_movement_end','confirm_movement_end'] LOOP
  retry:=pg_temp.snapshot_select_as('service_role',f.offerer,format('SELECT * FROM public.%I(%L)',key,j));PERFORM pg_temp.snapshot_check('legacy financial completion unavailable '||key,retry->>'state'='23514'); END LOOP;
 before:=pg_temp.materialization_sources();
 FOREACH actor IN ARRAY ARRAY[f.requester,f.offerer] LOOP
  retry:=pg_temp.coordination_as(actor,'SELECT * FROM public.list_my_active_movement_continuations()');
  PERFORM pg_temp.snapshot_check('completed omitted active recovery '||actor,retry->>'ok'='true' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(retry->'rows') x WHERE x->>'movement_need_id'=f.need::text));
  retry:=pg_temp.coordination_as(actor,'SELECT * FROM public.list_my_completed_movement_recoveries()');
  PERFORM pg_temp.snapshot_check('financial completed recovery exact '||actor,retry->>'ok'='true' AND EXISTS(SELECT 1 FROM jsonb_array_elements(retry->'rows') x WHERE x->>'movement_need_id'=f.need::text AND x->>'settlement_status'='settled'));
 END LOOP;
 PERFORM pg_temp.snapshot_check('recovery zero writes',before=pg_temp.materialization_sources());
 PERFORM pg_temp.snapshot_check('zero components have no settlement transaction',NOT EXISTS(SELECT 1 FROM private.financial_components c JOIN private.wallet_transactions t ON t.financial_component_id=c.id WHERE c.agreement_id=g.id AND c.amount_minor=0 AND t.transaction_kind IN ('requester_platform_charge','movement_contribution_settlement','offering_platform_charge')));
END;
$tests$;
TABLE pg_temp.snapshot_results;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_temp.snapshot_results WHERE NOT passed) THEN RAISE EXCEPTION '0082 behavioral failures'; END IF; END $$;
ROLLBACK;
