'use strict';
const assert=require('node:assert/strict');
const {run}=require('./0086_funded_dispute_harness.cjs');
async function main(){await run(async c=>{
 let checks=0;const check=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;console.log('PASS '+label);};
 const open='open_my_funded_movement_dispute',read='get_my_funded_movement_dispute_status';
 const original=c.target("SELECT pg_get_functiondef('public.open_my_funded_movement_dispute(uuid,text)'::regprocedure);");
 const legacySignatures=['private.assert_funded_no_travel(uuid)','private.assert_funded_coordination_entry(uuid)'];
 const legacyDefinitions=legacySignatures.map(signature=>c.target(`SELECT pg_get_functiondef('${signature}'::regprocedure);`));
 assert.equal((original.match(/clock_timestamp\(\)/g)||[]).length,1);
 const money=()=>c.target(`SELECT jsonb_build_object('accounts',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM private.wallet_accounts x),'transactions',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM private.wallet_transactions x),'postings',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM private.wallet_postings x),'components',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM private.financial_components x),'members',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.members x));`);
 for(const scenario of ['equal_coordination','regressed_coordination','later_clock_regression','history_below_coordination']){
  const f=c.fresh({pendingStart:true});c.target('BEGIN; '+c.action(f,'request_my_movement_end',f.requester)+' COMMIT;');
  // Owner-only clock references in a disposable DB, following 0082's tests.
  // Every predicate, trigger, ACL and lock remains active; no receipt is edited.
  const expression=scenario==='equal_coordination'?`(SELECT created_at FROM private.funded_movement_coordination_entries WHERE alignment_id='${f.alignment}')`:scenario==='regressed_coordination'?`(SELECT created_at-interval '1 second' FROM private.funded_movement_coordination_entries WHERE alignment_id='${f.alignment}')`:"clock_timestamp()+interval '1 day'";
  c.target(original.replace('clock_timestamp()',expression));
  const beforeMoney=money(),opened=c.result(f,open,f.offerer,'movement_concern');check(opened.ok,true,scenario+' opens through normal authenticated RPC');
  check(c.target(`SELECT opened_at${scenario==='equal_coordination'?'=':scenario==='regressed_coordination'?'<':'>'}${scenario==='later_clock_regression'||scenario==='history_below_coordination'?'clock_timestamp()':`(SELECT created_at FROM private.funded_movement_coordination_entries WHERE alignment_id='${f.alignment}')`} FROM private.funded_movement_disputes WHERE alignment_id='${f.alignment}';`),'t',scenario+' controlled observation relationship actually holds');
  c.target(original);
  // Sample a later real database clock, then evaluate equal and regressed test
  // clock observations through instrumented validators. Original 0086 fails
  // this scenario without changing system time or loosening any graph checks.
  if(scenario==='later_clock_regression')check(c.target(`SELECT clock_timestamp()<opened_at FROM private.funded_movement_disputes WHERE alignment_id='${f.alignment}';`),'t','later actual database clock numerically precedes valid observed opening');
  if(scenario==='history_below_coordination'){
   const stamp=c.target(`SELECT (created_at-interval '1 day')::text FROM private.funded_movement_coordination_entries WHERE alignment_id='${f.alignment}';`);
   for(const definition of legacyDefinitions)c.target(definition.replaceAll('clock_timestamp()',"'"+stamp+"'::timestamptz"));
   assert.throws(()=>c.target(`SELECT private.assert_funded_no_travel('${f.alignment}');`),/Exact unstarted funded lifecycle required/);checks++;
   c.target(`SELECT private.assert_funded_dispute('${f.alignment}');`);checks++;
   check(c.result(f,read,f.requester).rows[0].dispute_active,true,'active review bypasses later-clock historical rejection in unchanged 0085 paths');
  }
  for(const offset of ["interval '0 seconds'","interval '1 second'","interval '1 day'"]){
   c.target(`BEGIN; DO $$ DECLARE def text; stamp timestamptz; signature text; BEGIN
    SELECT opened_at-${offset} INTO STRICT stamp FROM private.funded_movement_disputes WHERE alignment_id='${f.alignment}';
    FOREACH signature IN ARRAY ARRAY['private.assert_funded_dispute(uuid)','private.require_funded_dispute_actor()'] LOOP
     def:=pg_get_functiondef(signature::regprocedure);
     EXECUTE replace(def,'clock_timestamp()',quote_literal(stamp)||'::timestamptz');
    END LOOP;
    PERFORM private.assert_funded_dispute('${f.alignment}');
   END $$; COMMIT;`);checks++;
   const before=c.fingerprint();check(c.result(f,read,f.offerer).rows[0].opened_at,opened.rows[0].opened_at,scenario+' history retains exact opening metadata with observation '+offset);
   check(c.result(f,open,f.offerer,'movement_concern').ok,true,scenario+' exact replay still succeeds');check(c.fingerprint(),before,scenario+' replay and read write nothing');
  }
  for(const [key,actor] of [['confirm_my_funded_movement_start',f.requester],['confirm_my_movement_end',f.offerer],['request_my_funded_movement_completion',f.offerer],['confirm_my_funded_movement_completion',f.requester]])check(c.result(f,key,actor).ok,false,scenario+' freeze still blocks '+key);
  for(const kind of ['movement_hold_release','requester_platform_charge','movement_contribution_settlement','offering_platform_charge']){
   assert.throws(()=>c.target(`BEGIN; SELECT set_config('request.jwt.claim.sub','${f.requester}',true); INSERT INTO private.wallet_transactions(transaction_kind,currency,alignment_id,financial_component_id,idempotency_key) SELECT '${kind}','NGN','${f.alignment}',id,'${kind}:'||id FROM private.financial_components WHERE agreement_id='${f.agreement}' AND amount_minor>0 AND component_key='${kind==='offering_platform_charge'?'offering_platform_share':kind==='movement_contribution_settlement'?'movement_contribution':'requester_platform_share'}' LIMIT 1; COMMIT;`),/Funded movement is under review/);checks++;
  }
  check(money(),beforeMoney,scenario+' all money/components/member rows unchanged');
  const before=c.fingerprint();check(c.result(f,open,f.offerer,'unable_to_agree').ok,false,scenario+' changed reason rejected');check(c.result(f,open,f.requester,'movement_concern').ok,false,scenario+' changed actor rejected');check(c.fingerprint(),before,scenario+' conflicting replays write nothing');
  for(const definition of legacyDefinitions)c.target(definition);
 }
 check(c.target("SELECT proargnames[1:2]=ARRAY['p_movement_need_id','p_reason_category'] AND pronargs=2 FROM pg_proc WHERE oid='public.open_my_funded_movement_dispute(uuid,text)'::regprocedure;"),'t','public input contract has no opened_at');
 const f=c.fresh(),before=c.fingerprint();
 assert.throws(()=>c.target('BEGIN; '+c.as(f,f.offerer,`SELECT * FROM public.open_my_funded_movement_dispute(p_movement_need_id=>'${f.need}',p_reason_category=>'movement_concern',opened_at=>clock_timestamp());`)+ ' COMMIT;'),/42883/);checks++;
 for(const role of ['authenticated','service_role'])check(c.target(`SELECT has_column_privilege('${role}','private.funded_movement_disputes','opened_at','INSERT');`),'f',role+' cannot supply opening through direct table writes');
 check(c.fingerprint(),before,'extra timestamp argument/direct authority changes nothing');
 const started=c.fresh({started:true});check(c.result(started,open,started.offerer,'movement_concern').ok,false,'authoritatively started movement still denied');
 const foreign=c.fresh(),beforeForged=c.fingerprint();
 for(const [agreement,journey,actor] of [[foreign.agreement,f.journey,f.offerer],[f.agreement,foreign.journey,f.offerer],[f.agreement,f.journey,f.traveller]]){
  assert.throws(()=>c.target(`BEGIN; SELECT set_config('request.jwt.claim.sub','${f.offerer}',true); INSERT INTO private.funded_movement_disputes VALUES('${f.alignment}','${agreement}','${journey}','${actor}','2000-01-01','movement_concern'); COMMIT;`),/23514/);checks++;
 }
 check(c.fingerprint(),beforeForged,'forged graph/actor with plausible metadata writes nothing');
 console.log('PASS '+checks+' PostgreSQL dispute temporal regression assertions');
 });}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
module.exports={main};
