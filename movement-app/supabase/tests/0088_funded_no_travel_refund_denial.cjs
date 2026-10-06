'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const {run}=require('./0088_funded_activation_fee_harness.cjs'),{support}=require('./0088_funded_activation_fee_test_support.cjs');
async function main(){let legacy,futureLegacy;await run(async c=>{const h=support(c);let checks=0;const check=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
 check(c.target(`SELECT clock_timestamp()<released_at FROM private.funded_no_travel_closures WHERE alignment_id='${futureLegacy.alignment}';`),'t','later clock actually precedes valid original legacy release');
 c.target(`SELECT private.assert_funded_no_travel('${futureLegacy.alignment}'); SELECT private.assert_funded_coordination_entry('${futureLegacy.alignment}');`);checks++;
 const historicalMoney=h.money();check(c.result(futureLegacy,'confirm_my_movement_end',futureLegacy.requester).ok,true,'future-observed original legacy receipt replay');check(h.money(),historicalMoney,'legacy historical replay changes no money');
 for(const [policy,f] of [['legacy',legacy],['new',c.fresh({pendingStart:true})]]){
  const money=h.money();check(c.target(`SELECT count(*) FROM private.funded_no_travel_holds WHERE alignment_id='${f.alignment}';`),'0','no terminal freeze exists before direct refund tests');
  for(const actor of [f.requester,f.offerer])for(const component of ['requester_platform_share','movement_contribution','offering_platform_share']){
   const state=policy==='new'&&component==='requester_platform_share'&&actor===f.offerer?'42501':'23514';
   assert.throws(()=>c.target(`BEGIN; SET CONSTRAINTS ALL DEFERRED; SELECT set_config('request.jwt.claim.sub','${actor}',true); INSERT INTO private.wallet_transactions(transaction_kind,currency,alignment_id,financial_component_id,idempotency_key,created_at) SELECT 'movement_hold_release','NGN','${f.alignment}',id,'movement_hold_release:'||id,clock_timestamp() FROM private.financial_components WHERE agreement_id='${f.agreement}' AND component_key='${component}'; COMMIT;`),new RegExp(state));checks++;
   check(h.money(),money,policy+' direct '+component+' release rejected without any held terminal gate');
  }
  check(c.result(f,'request_my_movement_end',f.offerer).ok,true,policy+' no-travel request');
  assert.throws(()=>c.target(`BEGIN; SET CONSTRAINTS ALL DEFERRED; SELECT set_config('request.jwt.claim.sub','${f.requester}',true); INSERT INTO private.funded_no_travel_closures SELECT r.alignment_id,r.financial_agreement_id,r.journey_id,r.id,r.first_principal_id,'${f.requester}',r.requested_at,clock_timestamp(),j.start_requested_at FROM private.funded_no_travel_requests r JOIN public.journeys j ON j.id=r.journey_id WHERE r.alignment_id='${f.alignment}'; COMMIT;`),/23514.*No user release/s);checks++;
  check(c.target(`SELECT count(*) FROM private.funded_no_travel_closures WHERE alignment_id='${f.alignment}';`),'0',policy+' no new refund receipt');
  check(h.money(),money,policy+' forged old closure no money');
  const result=c.result(f,'confirm_my_movement_end',f.requester);check(result.ok,true,policy+' normal confirmation');check(result.rows[0].funding_disposition,'held_review_required',policy+' held disposition');check(result.rows[0].released_minor,null,policy+' no claimed refund');check(h.money(),money,policy+' mutual consent cannot refund');
  check(c.target(`SELECT count(*) FROM private.wallet_transactions WHERE alignment_id='${f.alignment}' AND transaction_kind='movement_hold_release';`),'0',policy+' no release transaction');
 }
 fs.writeFileSync('docs/0088-policy-refund-denial-results.json',JSON.stringify({passed:checks,failed:0},null,2)+'\n');console.log('PASS '+checks+' pre-terminal direct refund/old-closure denial assertions');
 },{beforeInstall(c){legacy=c.fresh({pendingStart:true});futureLegacy=c.fresh();const h=require('./0087_funded_completion_test_support.cjs').support(c),restores=[];try{for(const signature of ['private.mutate_funded_no_travel(uuid,text,text)','private.assert_funded_no_travel(uuid)'])restores.push(h.instrument(signature,"clock_timestamp()+interval '1 day'"));assert(c.result(futureLegacy,'request_my_movement_end',futureLegacy.offerer).ok);assert(c.result(futureLegacy,'confirm_my_movement_end',futureLegacy.requester).ok);}finally{for(const restore of restores.reverse())restore();}}});}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});module.exports={main};
