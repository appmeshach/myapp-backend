'use strict';
const assert=require('node:assert/strict');
const {run}=require('./0085_funded_no_travel_harness.cjs');
async function main(){await run(async c=>{
 let checks=0;const check=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks++;};
 const ok=r=>{check(r.ok,true,JSON.stringify(r));return r;};
 const denied=(f,key,actor,reason)=>{const before=c.fingerprint(),r=c.result(f,key,actor,reason);check(r.ok,false,'denied '+key);check(r.message,'Movement end unavailable','generic error');check(c.fingerprint(),before,'failure writes nothing');};
 const request='request_my_movement_end',confirm='confirm_my_movement_end',decline='decline_my_movement_end';
 for(const zero of [false,true])for(const pendingStart of [false,true]){
  const f=c.fresh({zero,pendingStart});
  for(const actor of [f.traveller,'00000000-0000-4000-8000-000000000085'])for(const key of [request,confirm,decline])denied(f,key,actor);
  denied(f,confirm,f.requester);denied(f,decline,f.requester);
  ok(c.result(f,request));let before=c.fingerprint();ok(c.result(f,request));check(c.fingerprint(),before,'pending retry writes nothing');
  denied(f,request,f.requester);denied(f,confirm,f.offerer);denied(f,request,f.offerer,'changed');
  const balances=()=>JSON.parse(c.target(`SELECT coalesce(jsonb_object_agg(x.id::text,coalesce(b.balance,0)), '{}'::jsonb) FROM private.wallet_accounts x LEFT JOIN LATERAL(SELECT sum(CASE direction WHEN 'credit' THEN amount_minor::numeric ELSE -amount_minor::numeric END) balance FROM private.wallet_postings WHERE account_id=x.id)b ON true;`));
  const old=balances();const closed=ok(c.result(f,confirm,f.requester));
  const total=Number(c.target(`SELECT sum(amount_minor) FROM private.financial_components WHERE agreement_id='${f.agreement}' AND component_key IN('requester_platform_share','movement_contribution');`));
  check(Object.keys(closed.rows[0]).sort(),['journey_state','end_status','requested_by_me','action_required_from_me','requested_at','completed_at','funding_disposition','released_minor','currency'].sort(),'exact safe projection keys');
  check(closed.rows[0].funding_disposition,'released_to_me','requester authorized financial projection');check(closed.rows[0].released_minor,total,'backend exact release amount');
  check(closed.rows[0].currency,'NGN','backend currency');check(ok(c.result(f,'get_my_movement_end_status_by_need',f.offerer)).rows[0].funding_disposition,'released_to_requester','offerer never claims own release');
  const accounts=JSON.parse(c.target(`SELECT jsonb_agg(jsonb_build_object('id',id,'kind',account_kind,'member',member_id)) FROM private.wallet_accounts;`)),now=balances();
  for(const a of accounts){const delta=a.member===f.requester?(a.kind==='member_held'?-total:a.kind==='member_available'?total:0):0;check(Number(now[a.id])-Number(old[a.id]),delta,'exact account delta '+a.kind);}
  check(c.target(`SELECT status||':'||(started_at IS NULL)::text||':'||(completed_at IS NULL)::text FROM public.journeys WHERE id='${f.journey}';`),'cancelled:true:true','no invented travel timestamps');
  check(c.target(`SELECT status FROM public.alignments WHERE id='${f.alignment}';`),'cancelled','alignment terminal');
  c.target(`SELECT private.assert_funded_no_travel('${f.alignment}');`);checks++;
  const positive=c.target(`SELECT count(*) FROM private.financial_components WHERE agreement_id='${f.agreement}' AND component_key IN('requester_platform_share','movement_contribution') AND amount_minor>0;`);
  check(c.target(`SELECT count(*) FROM private.wallet_transactions WHERE alignment_id='${f.alignment}' AND transaction_kind='movement_hold_release';`),positive,'exact positive releases only');
  check(c.target(`SELECT count(*) FROM private.wallet_transactions w JOIN private.financial_components x ON x.id=w.financial_component_id WHERE x.agreement_id='${f.agreement}' AND x.amount_minor=0 AND w.transaction_kind='movement_hold_release';`),'0','zero components have no release transaction');
  check(c.target(`SELECT (SELECT count(*) FROM private.funded_movement_completions WHERE alignment_id='${f.alignment}')+(SELECT count(*) FROM private.completed_movement_principals WHERE alignment_id='${f.alignment}')+(SELECT count(*) FROM private.completed_movement_ratings WHERE alignment_id='${f.alignment}')+(SELECT count(*) FROM private.wallet_transactions WHERE alignment_id='${f.alignment}' AND transaction_kind IN('requester_platform_charge','offering_platform_charge','movement_contribution_settlement'));`),'0','no completion settlement reputation');
  check(c.target(`SELECT count(*) FROM public.members WHERE id IN('${f.offerer}','${f.requester}') AND (rating IS NOT NULL OR completed_movements<>0);`),'0','member reputation unchanged');
  before=c.fingerprint();ok(c.result(f,confirm,f.requester));ok(c.result(f,request));check(c.fingerprint(),before,'terminal exact replays write nothing');
  for(const [key,actor,reason] of [[confirm,f.offerer],[request,f.requester],[request,f.offerer,'changed'],[decline,f.requester]])denied(f,key,actor,reason);
  for(const key of ['request_my_funded_movement_start','confirm_my_funded_movement_start','request_my_funded_movement_completion','confirm_my_funded_movement_completion']){
   const actor=key.startsWith('request')?f.offerer:f.requester;check(c.result(f,key,actor).ok,false,'terminal blocks '+key);
  }
  console.log(`PASS funded no-travel zero=${zero} pendingStart=${pendingStart}`);
 }
 const f=c.fresh();ok(c.result(f,request,f.requester));const beforeWallet=c.target('SELECT count(*) FROM private.wallet_transactions;');ok(c.result(f,decline,f.offerer));check(c.target('SELECT count(*) FROM private.wallet_transactions;'),beforeWallet,'decline no money');
 check(c.target(`SELECT count(*) FROM private.funded_no_travel_closures WHERE alignment_id='${f.alignment}';`),'0','decline no terminal receipt');ok(c.result(f,request,f.offerer));ok(c.result(f,confirm,f.requester));
 const started=c.fresh({started:true});denied(started,request,started.offerer);denied(started,confirm,started.requester);
 for(const stage of ['agreement','hold','activation']){const missing=c.fresh({stage});denied(missing,request,missing.offerer);denied(missing,confirm,missing.requester);}
 const partial=c.fresh({stage:'agreement'});
 c.target(`BEGIN; SET CONSTRAINTS ALL DEFERRED; DO $$ DECLARE component private.financial_components%ROWTYPE; t uuid; debit_id uuid; credit_id uuid; BEGIN
  SELECT * INTO STRICT component FROM private.financial_components WHERE agreement_id='${partial.agreement}' AND component_key='movement_contribution';
  SELECT id INTO STRICT debit_id FROM private.wallet_accounts WHERE member_id='${partial.requester}' AND account_kind='member_available';
  SELECT id INTO STRICT credit_id FROM private.wallet_accounts WHERE member_id='${partial.requester}' AND account_kind='member_held';
  INSERT INTO private.wallet_transactions(transaction_kind,currency,alignment_id,financial_component_id,idempotency_key) VALUES('movement_hold','NGN','${partial.alignment}',component.id,'movement_hold:'||component.id::text) RETURNING id INTO t;
  INSERT INTO private.wallet_postings(transaction_id,account_id,direction,amount_minor) VALUES(t,debit_id,'debit',component.amount_minor),(t,credit_id,'credit',component.amount_minor);
 END $$; COMMIT;`);
 denied(partial,request,partial.offerer);
 const partialBefore=c.fingerprint();const partialRetry=JSON.parse(c.target(`BEGIN; SELECT ${partial.schema}.hold_result(); COMMIT;`));check(partialRetry.ok,false,'0078 partial hold cannot be silently repaired');check(c.fingerprint(),partialBefore,'partial history unchanged');
 const reciprocal=c.fresh();ok(c.result(reciprocal,request,reciprocal.requester));ok(c.result(reciprocal,confirm,reciprocal.offerer));
 check(c.target(`SELECT first_principal_id='${reciprocal.requester}' AND second_principal_id='${reciprocal.offerer}' FROM private.funded_no_travel_closures WHERE alignment_id='${reciprocal.alignment}';`),'t','either principal can initiate');
 for(const mode of ['insufficient_held','overflow_available','closed_wallet']){
  const bad=c.fresh();ok(c.result(bad,request));
  c.target(`BEGIN; DO $$ DECLARE debit_id uuid; credit_id uuid; BEGIN
   SELECT id INTO debit_id FROM private.wallet_accounts WHERE member_id='${bad.requester}' AND account_kind='member_held';
   SELECT id INTO credit_id FROM private.wallet_accounts WHERE member_id='${bad.requester}' AND account_kind='member_available';
   ${mode==='insufficient_held'?`PERFORM ${bad.schema}.completion_pair(debit_id,credit_id,1);`:mode==='overflow_available'?`SELECT id INTO debit_id FROM private.wallet_accounts WHERE account_kind='provider_clearing' AND currency='NGN'; PERFORM ${bad.schema}.completion_pair(debit_id,credit_id,9223372036854775707);`:`UPDATE private.wallet_accounts SET status='closed' WHERE member_id='${bad.requester}' AND account_kind='member_withdrawable';`}
  END $$; COMMIT;`);
  denied(bad,confirm,bad.requester);
 }
 for(const mode of ['IMMEDIATE','DEFERRED']){
  const exact=c.fresh();c.target('BEGIN; SET CONSTRAINTS ALL '+mode+'; '+c.action(exact,request,exact.offerer)+c.action(exact,confirm,exact.requester)+' COMMIT;');
  check(c.target(`SELECT count(*) FROM private.funded_no_travel_closures WHERE alignment_id='${exact.alignment}';`),'1','caller constraint mode '+mode);
 }
 const historical=c.fresh();ok(c.result(historical,request));ok(c.result(historical,confirm,historical.requester));
 c.target(`BEGIN; DO $$ DECLARE available uuid; clearing uuid; amount bigint; BEGIN
  SELECT id INTO STRICT available FROM private.wallet_accounts WHERE member_id='${historical.requester}' AND account_kind='member_available';
  SELECT id INTO STRICT clearing FROM private.wallet_accounts WHERE account_kind='provider_clearing' AND currency='NGN';
  SELECT sum(CASE direction WHEN 'credit' THEN amount_minor ELSE -amount_minor END)::bigint INTO amount FROM private.wallet_postings WHERE account_id=available;
  PERFORM ${historical.schema}.completion_pair(available,clearing,amount);
  UPDATE private.wallet_accounts SET status='closed' WHERE member_id='${historical.requester}';
 END $$; COMMIT;`);
 const historicalBefore=c.fingerprint();ok(c.result(historical,confirm,historical.requester));check(c.fingerprint(),historicalBefore,'replay uses historical ledger even after balances change and accounts close');
 // Zero-only provenance is unreachable under the retained 0071 positive-seat
 // policy. Prove the boundary rather than disabling economics to invent a graph.
 assert.throws(()=>c.target("SELECT * FROM private.calculate_financial_proposal_economics(0,1,'shared_platform_fee_v1','equal_split_requester_remainder_v1');"),/23514/);checks++;
 console.log('PASS current 0071 policy rejects zero-only fabricated funded economics');
 // Actual ACLs, RLS and append-only enforcement, not source regex alone.
 for(const table of ['funded_no_travel_requests','funded_no_travel_declines','funded_no_travel_closures']){
  check(c.target(`SELECT relrowsecurity FROM pg_class WHERE oid='private.${table}'::regclass;`),'t','RLS '+table);
  for(const role of ['anon','authenticated','service_role'])check(c.target(`SELECT has_table_privilege('${role}','private.${table}','SELECT,INSERT,UPDATE,DELETE,TRUNCATE');`),'f','no direct '+role);
  for(const sql of [`UPDATE private.${table} SET ${table==='funded_no_travel_declines'?'declined_at=declined_at':table==='funded_no_travel_closures'?'released_at=released_at':'requested_at=requested_at'}`,`DELETE FROM private.${table}`,`TRUNCATE private.${table} CASCADE`]){assert.throws(()=>c.target(sql),/23514/);checks++;}
 }
 for(const name of ['assert_funded_no_travel(uuid)','funded_no_travel_alignment(uuid)','mutate_funded_no_travel(uuid,text,text)','validate_funded_no_travel_graph()','require_funded_no_travel_actor()']){
  check(c.target(`SELECT prosecdef AND proconfig=ARRAY['search_path=""'] FROM pg_proc WHERE oid='private.${name}'::regprocedure;`),'t','private definer empty path '+name);
  for(const role of ['anon','authenticated','service_role'])check(c.target(`SELECT has_function_privilege('${role}','private.${name}','EXECUTE');`),'f','private helper inaccessible '+role);
 }
 for(const name of ['get_my_movement_end_status_by_need(uuid)','request_my_movement_end(uuid,text)','confirm_my_movement_end(uuid)','decline_my_movement_end(uuid)']){
  for(const role of ['anon','authenticated','service_role'])check(c.target(`SELECT has_function_privilege('${role}','public.${name}','EXECUTE');`),role==='authenticated'?'t':'f','narrow public RPC '+name+' '+role);
 }
 console.log('PASS '+checks+' PostgreSQL behavioral assertions');
 });}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
module.exports={main};
