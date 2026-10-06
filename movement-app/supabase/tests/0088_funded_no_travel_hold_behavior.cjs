'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const {run}=require('./0088_funded_activation_fee_harness.cjs'),{support}=require('./0088_funded_activation_fee_test_support.cjs');
async function main(){await run(async c=>{const h=support(c);let checks=0;const check=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;console.log('PASS '+label);};
 for(const zero of [false,true])for(const pendingStart of [false,true])for(const initiator of ['offerer','requester']){
  const f=c.fresh({zero,pendingStart}),first=f[initiator],second=initiator==='offerer'?f.requester:f.offerer,money=h.money(),economics=h.economics(f);
  check(c.result(f,'request_my_movement_end',first).ok,true,'explicit non-travel intent');
  check(c.result(f,'confirm_my_movement_end',first).ok,false,'requester/offerer cannot self-confirm or self-refund');
  const waiting=c.result(f,'get_my_movement_end_status_by_need',second);check(waiting.rows[0].funding_disposition,'held','pending intent still held');
  const before=h.state();c.target('BEGIN; '+c.action(f,'confirm_my_movement_end',second)+' ROLLBACK;');check(h.state(),before,'rollback leaves no partial receipt');check(c.target(`SELECT count(*) FROM private.funded_no_travel_holds WHERE alignment_id='${f.alignment}';`),'0','rollback no held receipt');
  const done=c.result(f,'confirm_my_movement_end',second);check(done.ok,true,'distinct consent records no travel');
  for(const actor of [first,second]){const s=c.result(f,'get_my_movement_end_status_by_need',actor).rows[0];check(s.end_status,'no_travel_held','truthful lifecycle disposition');check(s.journey_state,'not_started','no invented cancelled/released lifecycle');check(s.funding_disposition,'held_review_required','truthful financial disposition');check(s.released_minor,null,'no claimed refund');check(s.requested_by_me,false,'no pending terminal action');check(s.action_required_from_me,false,'no refund approval control');}
  check(h.money(),money,'exact wallet/transaction/posting equality');check(h.economics(f),economics,'C remains held R earned O unpaid');h.assertFee(f);checks++;
  check(c.target(`SELECT count(*) FROM private.funded_no_travel_closures WHERE alignment_id='${f.alignment}';`),'0','old refund receipt absent');
  const stable=h.state();check(c.result(f,'confirm_my_movement_end',second).ok,true,'terminal replay');check(c.result(f,'request_my_movement_end',first).ok,true,'intent replay');check(h.state(),stable,'replays write nothing');
  check(c.result(f,'decline_my_movement_end',second).ok,false,'held disposition cannot be reversed');
  for(const key of ['request_my_funded_movement_start','confirm_my_funded_movement_start','request_my_funded_movement_completion','confirm_my_funded_movement_completion'])check(c.result(f,key,key.startsWith('request')?f.offerer:f.requester).ok,key==='request_my_funded_movement_start'&&pendingStart,'frozen progress / immutable request replay '+key);
  const start=c.result(f,'get_my_movement_start_status',f.requester);check(start.ok,true,'frozen start read');for(const key of ['can_edit_meeting_point','can_request_start','can_confirm_start'])check(start.rows[0][key],false,'no start capability '+key);
  check(c.result(f,'get_my_funded_movement_dispute_status',f.requester).rows[0].can_open,false,'no false report required for recorded non-travel');
  check(c.target(`SELECT count(*) FROM private.funded_movement_disputes WHERE alignment_id='${f.alignment}';`),'0','no allegation against offerer invented');
  for(const sql of [
   `INSERT INTO private.wallet_transactions(transaction_kind,currency,alignment_id,financial_component_id,idempotency_key) SELECT 'movement_hold_release','NGN','${f.alignment}',id,'movement_hold_release:'||id FROM private.financial_components WHERE agreement_id='${f.agreement}' AND component_key='movement_contribution'`,
   `UPDATE public.journeys SET status='cancelled' WHERE id='${f.journey}'`,
   `UPDATE public.alignments SET status='cancelled' WHERE id='${f.alignment}'`,
   `INSERT INTO private.funded_no_travel_closures SELECT alignment_id,financial_agreement_id,journey_id,request_id,first_principal_id,second_principal_id,requested_at,observed_at,pending_start_requested_at FROM private.funded_no_travel_holds WHERE alignment_id='${f.alignment}'`
  ]){assert.throws(()=>c.target(`BEGIN; SET CONSTRAINTS ALL DEFERRED; SELECT set_config('request.jwt.claim.sub','${second}',true); ${sql}; COMMIT;`),/23514/);checks++;check(h.money(),money,'trusted attempted refund/lifecycle forgery no money');}
  c.target(`SELECT private.assert_held_no_travel('${f.alignment}');`);checks++;
 }
 for(const role of ['anon','authenticated','service_role']){check(c.target(`SELECT has_table_privilege('${role}','private.funded_no_travel_holds','SELECT,INSERT,UPDATE,DELETE,TRUNCATE');`),'f','receipt denied '+role);for(const name of ['assert_held_no_travel(uuid)','require_held_no_travel_actor()','reject_held_no_travel_progress()','validate_held_no_travel_graph()'])check(c.target(`SELECT has_function_privilege('${role}','private.${name}','EXECUTE');`),'f','private helper denied '+role);for(const query of ["SELECT * FROM private.funded_no_travel_holds","SELECT private.assert_held_no_travel(gen_random_uuid())"]){assert.throws(()=>c.target(`BEGIN; SET LOCAL ROLE ${role}; ${query}; COMMIT;`),/42501/);checks++;}}
 check(c.target("SELECT relrowsecurity FROM pg_class WHERE oid='private.funded_no_travel_holds'::regclass;"),'t','RLS');
 for(const sql of ['UPDATE private.funded_no_travel_holds SET observed_at=observed_at','DELETE FROM private.funded_no_travel_holds','TRUNCATE private.funded_no_travel_holds CASCADE']){assert.throws(()=>c.target(sql),/23514/);checks++;}
 // Reject forged identity before any valid held receipt exists.
 for(const field of ['alignment','agreement','journey','request','first','second','requested','pending']){
  const f=c.fresh({pendingStart:true}),other=c.fresh();assert(c.result(f,'request_my_movement_end',f.offerer).ok);const before=h.state();
  const value={alignment:field==='alignment'?other.alignment:f.alignment,agreement:field==='agreement'?other.agreement:f.agreement,journey:field==='journey'?other.journey:f.journey};
  const sql=`INSERT INTO private.funded_no_travel_holds SELECT '${value.alignment}','${value.agreement}','${value.journey}',${field==='request'?"gen_random_uuid()":'r.id'},${field==='first'?"'"+f.requester+"'":'r.first_principal_id'},'${field==='second'?f.offerer:f.requester}',${field==='requested'?"r.requested_at+interval '1 second'":'r.requested_at'},clock_timestamp(),${field==='pending'?'NULL':'j.start_requested_at'} FROM private.funded_no_travel_requests r JOIN public.journeys j ON j.id=r.journey_id WHERE r.alignment_id='${f.alignment}';`;
  assert.throws(()=>c.target(`BEGIN; SET CONSTRAINTS ALL DEFERRED; SELECT set_config('request.jwt.claim.sub','${f.requester}',true); ${sql} COMMIT;`),new RegExp(field==='alignment'?'42501':field==='request'?'P0002':'23514'));checks++;check(h.state(),before,'forged '+field+' atomic rejection');check(c.target(`SELECT count(*) FROM private.funded_no_travel_holds WHERE alignment_id='${f.alignment}';`),'0','forged '+field+' no receipt');
 }
 const f=c.fresh({pendingStart:true});assert(c.result(f,'request_my_movement_end',f.offerer).ok);
 c.target(`BEGIN; SELECT set_config('request.jwt.claim.sub','${f.requester}',true); INSERT INTO private.funded_no_travel_holds SELECT r.alignment_id,r.financial_agreement_id,r.journey_id,r.id,r.first_principal_id,'${f.requester}',r.requested_at,'2000-01-01'::timestamptz,j.start_requested_at FROM private.funded_no_travel_requests r JOIN public.journeys j ON j.id=r.journey_id WHERE r.alignment_id='${f.alignment}'; COMMIT; SELECT private.assert_held_no_travel('${f.alignment}');`);checks++;
 check(c.result(f,'confirm_my_movement_end',f.requester).ok,true,'regressed metadata remains historically valid');
 for(const observation of ['equal','regressed','later_regression']){
  const f=c.fresh();assert(c.result(f,'request_my_movement_end',f.requester).ok);const money=h.money();
  const requested=`(SELECT requested_at FROM private.funded_no_travel_requests WHERE alignment_id='${f.alignment}')`;
  const restore=h.instrument('private.mutate_funded_no_travel(uuid,text,text)',observation==='equal'?requested:observation==='regressed'?requested+"-interval '1 second'":"clock_timestamp()+interval '1 day'");
  try{check(c.result(f,'confirm_my_movement_end',f.offerer).ok,true,'controlled server observation '+observation);}finally{restore();}
  check(c.target(`SELECT ${observation==='later_regression'?'clock_timestamp()<observed_at':observation==='equal'?'observed_at=requested_at':'observed_at<requested_at'} FROM private.funded_no_travel_holds WHERE alignment_id='${f.alignment}';`),'t','actual observation relationship '+observation);
  const receipt=c.target(`SELECT to_jsonb(x) FROM private.funded_no_travel_holds x WHERE alignment_id='${f.alignment}';`);
  c.target(`SELECT private.assert_held_no_travel('${f.alignment}');`);checks++;check(c.result(f,'confirm_my_movement_end',f.offerer).ok,true,'historical replay '+observation);check(c.result(f,'get_my_movement_end_status_by_need',f.requester).rows[0].funding_disposition,'held_review_required','historical read '+observation);check(h.money(),money,'temporal admission/read/replay no money');check(c.target(`SELECT to_jsonb(x) FROM private.funded_no_travel_holds x WHERE alignment_id='${f.alignment}';`),receipt,'historical receipt immutable');
 }
 check(c.target("SELECT pronargs FROM pg_proc WHERE oid='public.confirm_my_movement_end(uuid)'::regprocedure;"),'1','client has no observed_at argument');
 fs.writeFileSync('docs/0088-policy-held-behavior-results.json',JSON.stringify({passed:checks,failed:0},null,2)+'\n');console.log('PASS '+checks+' held no-travel behavior assertions');
 });}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});module.exports={main};
