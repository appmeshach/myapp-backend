'use strict';
const assert=require('node:assert/strict');
const {run}=require('./0086_funded_dispute_harness.cjs');
async function main(){await run(async c=>{
 let checks=0;const check=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
 const read='get_my_funded_movement_dispute_status',open='open_my_funded_movement_dispute';
 const denied=(f,key,actor,reason)=>{const before=c.fingerprint(),r=c.result(f,key,actor,reason);check(r.ok,false,key);if(key===open||key===read)check(r.message,'Movement review unavailable','generic');check(c.fingerprint(),before,'denial writes nothing');};
 const money=()=>c.target(`SELECT jsonb_build_object('accounts',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM private.wallet_accounts x),'transactions',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM private.wallet_transactions x),'postings',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM private.wallet_postings x),'components',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM private.financial_components x),'members',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.members x));`);
 for(const initiator of ['offerer','requester'])for(const pendingStart of [false,true])for(const zero of [false,true]){
  const f=c.fresh({pendingStart,zero}),actor=f[initiator],other=initiator==='offerer'?f.requester:f.offerer;
  for(const bad of [f.traveller,'00000000-0000-4000-8000-000000000086']){denied(f,read,bad);denied(f,open,bad,'movement_concern');}
  for(const reason of ['unknown',' movement_concern ','','x'.repeat(501)])denied(f,open,actor,reason);
  check(c.result(f,read,actor).rows[0],{dispute_active:false,can_open:true,opened_by_me:false,opened_at:null},'eligible safe projection');
  c.target('BEGIN; '+c.action(f,'request_my_movement_end',other)+' COMMIT;');
  const before=money(),oldJourney=c.target(`SELECT to_jsonb(j) FROM public.journeys j WHERE id='${f.journey}';`),oldAlignment=c.target(`SELECT to_jsonb(a) FROM public.alignments a WHERE id='${f.alignment}';`);
  const opened=c.result(f,open,actor,'movement_concern');check(opened.ok,true,'principal opening');
  check(Object.keys(opened.rows[0]).sort(),['can_open','dispute_active','opened_at','opened_by_me'],'only safe fields');
  check(opened.rows[0].dispute_active,true,'active');check(opened.rows[0].can_open,false,'cannot reopen');check(opened.rows[0].opened_by_me,true,'actor safe bool');check(Number.isFinite(Date.parse(opened.rows[0].opened_at)),true,'backend instant');
  check(money(),before,'all accounts transactions postings components member reputation byte unchanged');
  check(c.target(`SELECT to_jsonb(j) FROM public.journeys j WHERE id='${f.journey}';`),oldJourney,'journey unchanged');check(c.target(`SELECT to_jsonb(a) FROM public.alignments a WHERE id='${f.alignment}';`),oldAlignment,'alignment unchanged');
  check(c.target(`SELECT financial_agreement_id='${f.agreement}' AND journey_id='${f.journey}' AND opened_by_member_id='${actor}' AND isfinite(opened_at) FROM private.funded_movement_disputes WHERE alignment_id='${f.alignment}';`),'t','exact receipt and finite server metadata');
  const fingerprint=c.fingerprint();check(c.result(f,open,actor,'movement_concern').ok,true,'exact replay');check(c.fingerprint(),fingerprint,'replay writes nothing');
  denied(f,open,actor,'unable_to_agree');denied(f,open,other,'movement_concern');check(c.result(f,read,other).rows[0].opened_by_me,false,'other principal sees active review');
  // A pending request is not travel; creating it after review is also harmless.
  check(c.result(f,'request_my_funded_movement_start',f.offerer).ok,true,'pending start allowed');
  for(const [key,who] of [['confirm_my_funded_movement_start',f.requester],['confirm_my_movement_end',actor],['request_my_funded_movement_completion',f.offerer],['confirm_my_funded_movement_completion',f.requester]])denied(f,key,who);
  check(c.target(`SELECT (SELECT count(*) FROM private.funded_movement_starts WHERE alignment_id='${f.alignment}')+(SELECT count(*) FROM private.funded_no_travel_closures WHERE alignment_id='${f.alignment}')+(SELECT count(*) FROM private.funded_movement_completions WHERE alignment_id='${f.alignment}')+(SELECT count(*) FROM private.completed_movement_principals WHERE alignment_id='${f.alignment}')+(SELECT count(*) FROM private.completed_movement_ratings WHERE alignment_id='${f.alignment}')+(SELECT count(*) FROM private.wallet_transactions WHERE alignment_id='${f.alignment}' AND transaction_kind<>'movement_hold');`),'0','no travel release settlement reputation');
  check(money(),before,'freeze actions move no money');
  // Trusted direct construction cannot cross the evidence gate either.
  for(const sql of [
   `INSERT INTO private.funded_movement_starts SELECT alignment_id,journey_id,clock_timestamp() FROM private.funded_movement_start_requests WHERE alignment_id='${f.alignment}'`,
   `INSERT INTO private.funded_movement_completion_requests VALUES('${f.alignment}','${f.agreement}','${f.journey}',clock_timestamp())`,
   `INSERT INTO private.wallet_transactions(transaction_kind,currency,alignment_id,financial_component_id,idempotency_key) SELECT 'movement_hold_release','NGN','${f.alignment}',id,'movement_hold_release:'||id FROM private.financial_components WHERE agreement_id='${f.agreement}' AND amount_minor>0 LIMIT 1`
  ]){assert.throws(()=>c.target('BEGIN; '+c.as(f,f.requester,'RESET ROLE; '+sql+';')+' COMMIT;'),/23514/);checks++;}
 }
 for(const stage of ['agreement','hold','activation']){const f=c.fresh({stage});denied(f,read,f.offerer);denied(f,open,f.offerer,'movement_concern');}
 const started=c.fresh({started:true});denied(started,open,started.offerer,'movement_concern');denied(started,open,started.requester,'unable_to_agree');check(c.result(started,read).rows[0].can_open,false,'already started read ineligible');
 c.target('BEGIN; '+c.action(started,'request_my_funded_movement_completion')+c.action(started,'confirm_my_funded_movement_completion',started.requester)+' COMMIT;');denied(started,open,started.offerer,'movement_concern');check(c.result(started,read).rows[0].can_open,false,'completed ineligible');
 const closed=c.fresh();c.target('BEGIN; '+c.action(closed,'request_my_movement_end')+c.action(closed,'confirm_my_movement_end',closed.requester)+' COMMIT;');denied(closed,open,closed.offerer,'movement_concern');check(c.result(closed,read).rows[0].can_open,false,'released ineligible');
 for(const mode of ['IMMEDIATE','DEFERRED']){const f=c.fresh();c.target('BEGIN; SET CONSTRAINTS ALL '+mode+'; '+c.action(f,open,f.offerer,'unable_to_agree')+' COMMIT;');check(c.result(f,read).rows[0].dispute_active,true,'constraint mode '+mode);}
 const f=c.fresh();
 // Construction rejects contradictory graph bindings under the real guards.
 const foreign=c.fresh();
 for(const [agreement,journey,who,stamp,reason] of [
  [foreign.agreement,f.journey,f.offerer,'clock_timestamp()','movement_concern'],
  [f.agreement,foreign.journey,f.offerer,'clock_timestamp()','movement_concern'],
  [f.agreement,f.journey,f.traveller,'clock_timestamp()','movement_concern'],
  [f.agreement,f.journey,f.offerer,"'infinity'::timestamptz",'movement_concern'],
  [f.agreement,f.journey,f.offerer,"'-infinity'::timestamptz",'movement_concern'],
  [f.agreement,f.journey,f.offerer,'clock_timestamp()','refund']
 ]){const before=c.fingerprint();assert.throws(()=>c.target(`BEGIN; SELECT set_config('request.jwt.claim.sub','${f.offerer}',true); INSERT INTO private.funded_movement_disputes VALUES('${f.alignment}','${agreement}','${journey}','${who}',${stamp},'${reason}'); COMMIT;`),/23514/);checks++;check(c.fingerprint(),before,'forged opening writes nothing');}
 const partial=c.fresh({stage:'agreement'});
 c.target(`BEGIN; SET CONSTRAINTS ALL DEFERRED; DO $$ DECLARE component private.financial_components%ROWTYPE; t uuid; debit_id uuid; credit_id uuid; BEGIN
  SELECT * INTO STRICT component FROM private.financial_components WHERE agreement_id='${partial.agreement}' AND component_key='movement_contribution';
  SELECT id INTO STRICT debit_id FROM private.wallet_accounts WHERE member_id='${partial.requester}' AND account_kind='member_available';
  SELECT id INTO STRICT credit_id FROM private.wallet_accounts WHERE member_id='${partial.requester}' AND account_kind='member_held';
  INSERT INTO private.wallet_transactions(transaction_kind,currency,alignment_id,financial_component_id,idempotency_key) VALUES('movement_hold','NGN','${partial.alignment}',component.id,'movement_hold:'||component.id::text) RETURNING id INTO t;
  INSERT INTO private.wallet_postings(transaction_id,account_id,direction,amount_minor) VALUES(t,debit_id,'debit',component.amount_minor),(t,credit_id,'credit',component.amount_minor);
 END $$; COMMIT;`);
 denied(partial,open,partial.offerer,'movement_concern');
 const partialBefore=c.fingerprint();check(JSON.parse(c.target(`BEGIN; SELECT ${partial.schema}.hold_result(); COMMIT;`)).ok,false,'partial funding not silently repaired');check(c.fingerprint(),partialBefore,'partial history preserved');
 for(const sql of [`UPDATE private.funded_movement_disputes SET reason_category=reason_category`,`DELETE FROM private.funded_movement_disputes`,`TRUNCATE private.funded_movement_disputes CASCADE`]){assert.throws(()=>c.target(sql),/23514/);checks++;}
 check(c.target("SELECT relrowsecurity FROM pg_class WHERE oid='private.funded_movement_disputes'::regclass;"),'t','RLS');
 for(const role of ['anon','authenticated','service_role'])check(c.target(`SELECT has_table_privilege('${role}','private.funded_movement_disputes','SELECT,INSERT,UPDATE,DELETE,TRUNCATE');`),'f','no direct grants');
 check(c.target("SELECT NOT EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) x WHERE c.oid='private.funded_movement_disputes'::regclass AND x.grantee=0);"),'t','PUBLIC table ACL');
 for(const name of ['assert_undisposed_funded_graph(uuid)','funded_dispute_alignment(uuid)','assert_funded_dispute(uuid)','require_funded_dispute_actor()','reject_disputed_funded_progress()','validate_funded_dispute_graph()']){
  check(c.target(`SELECT prosecdef AND proconfig=ARRAY['search_path=""'] FROM pg_proc WHERE oid='private.${name}'::regprocedure;`),'t','definer empty path');
  for(const role of ['anon','authenticated','service_role'])check(c.target(`SELECT has_function_privilege('${role}','private.${name}','EXECUTE');`),'f','private ACL');
 }
 for(const name of [read+'(uuid)',open+'(uuid,text)'])for(const role of ['anon','authenticated','service_role'])check(c.target(`SELECT has_function_privilege('${role}','public.${name}','EXECUTE');`),role==='authenticated'?'t':'f','public auth only');
 for(const actor of [null,'00000000-0000-4000-8000-000000000000']){const before=c.fingerprint();const r=JSON.parse(c.target(`BEGIN; SELECT ${f.schema}.snapshot_select_as('authenticated',${actor===null?'NULL':"'"+actor+"'"},'SELECT * FROM public.${open}(''${f.need}'',''movement_concern'')'); COMMIT;`));check(r.ok,false,'missing identity');check(c.fingerprint(),before,'no unauthorized writes');}
 console.log('PASS '+checks+' PostgreSQL dispute behavioral assertions');
 });}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
module.exports={main};
