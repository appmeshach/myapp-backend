'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const {run}=require('./0088_funded_activation_fee_harness.cjs'),{support}=require('./0088_funded_activation_fee_test_support.cjs');
async function main(){await run(async c=>{
 const h=support(c);let scenarios=0,prerequisiteRejections=0;
 const hold=f=>c.as(f,f.requester,`SELECT * FROM public.hold_my_movement_funds('${f.agreement}',1);`);
 const topup=f=>`SELECT public.record_wallet_top_up_for_server('${f.requester}',1,'NGN','test-0088','concurrent:'||gen_random_uuid());`;
 async function race(f,first,second,rollback,label){const a=new c.Session(),b=new c.Session();await a.begin();await b.begin();await a.send(first);const pending=b.send(second);await c.blocked(a,b,label);await a.send(rollback?'ROLLBACK;':'COMMIT;');await pending;await b.send('COMMIT;');assert.doesNotMatch(a.err+b.err,/ERROR|40P01|deadlock|timed out/i);a.close();b.close();scenarios++;console.log('PASS '+label);}
 const fee=f=>{h.assertFee(f);assert.equal(h.economics(f).held,h.amounts(f).movement_contribution);assert.equal(c.target(`SELECT count(*) FROM private.wallet_transactions WHERE alignment_id='${f.alignment}' AND transaction_kind IN('movement_hold_release','movement_contribution_settlement','offering_platform_charge');`),'0');};
 for(const rollback of [false,true]){const f=c.fresh({stage:'hold'});await race(f,h.activationAction(f),h.activationAction(f),rollback,'duplicate activation rollback='+rollback);fee(f);}
 for(const firstActivation of [false,true])for(const rollback of [false,true]){
  const f=c.fresh({stage:'hold'});await race(f,firstActivation?h.activationAction(f):hold(f),firstActivation?hold(f):h.activationAction(f),rollback,`activation vs exact funding replay activationFirst=${firstActivation} rollback=${rollback}`);
  if(firstActivation&&rollback)assert(h.activate(f).ok);fee(f);
 }
 for(const firstActivation of [false,true])for(const rollback of [false,true]){
  const f=c.fresh({stage:'hold'});await race(f,firstActivation?h.activationAction(f):topup(f),firstActivation?topup(f):h.activationAction(f),rollback,`activation vs topup activationFirst=${firstActivation} rollback=${rollback}`);
  if(firstActivation&&rollback)assert(h.activate(f).ok);fee(f);
 }
 for(const rollback of [false,true]){
  const f=c.fresh({stage:'hold'});await race(f,`SELECT id FROM private.wallet_accounts WHERE member_id='${f.requester}' ORDER BY id FOR UPDATE;`,h.activationAction(f),rollback,'activation wallet-account wait rollback='+rollback);fee(f);
 }
 for(const firstF of [false,true])for(const rollback of [false,true]){
  const f=c.fresh({stage:'hold',offerer:require('node:crypto').randomUUID(),requester:require('node:crypto').randomUUID()}),g=c.fresh({stage:'hold',offerer:f.offerer,requester:f.requester});
  // A second genuine fixture replaces shared principals' profile media. Issue
  // fresh ordinal-based checks against the same current media for BOTH graphs;
  // never disable or edit the original identity predicates/evidence.
  c.target(`DO $$ DECLARE selected_alignment uuid; selected_member record; media uuid; attempt uuid; BEGIN
   FOREACH selected_alignment IN ARRAY ARRAY['${f.alignment}'::uuid,'${g.alignment}'::uuid] LOOP
    FOR selected_member IN SELECT r.member_id FROM private.required_face_members(selected_alignment) r LOOP
     SELECT m.id INTO STRICT media FROM public.member_media m WHERE m.member_id=selected_member.member_id AND m.is_current AND m.media_type='photo';
     attempt:=public.start_alignment_face_verification_for_server(selected_alignment,selected_member.member_id,'test-0088',gen_random_uuid()::text);
     PERFORM public.complete_alignment_face_verification_for_server(attempt,media,true,true);
    END LOOP;
   END LOOP;
  END $$;`);
  const first=firstF?f:g,second=firstF?g:f;await race(f,h.activationAction(first),h.activationAction(second),rollback,`shared principal activations firstF=${firstF} rollback=${rollback}`);if(rollback)assert(h.activate(first).ok);h.assertFee(f);h.assertFee(g);assert.equal(h.economics(f).held,h.amounts(f).movement_contribution+h.amounts(g).movement_contribution);
 }
 for(const rollback of [false,true]){
  const f=c.fresh({stage:'hold'}),g=c.fresh({stage:'hold'});await race(f,h.activationAction(f),h.activationAction(g),rollback,'shared platform revenue gate rollback='+rollback);if(rollback)assert(h.activate(f).ok);fee(f);fee(g);
 }
 for(const key of ['request_my_movement_end','open_my_funded_movement_dispute'])for(const rollback of [false,true]){
  const f=c.fresh({stage:'hold'}),a=new c.Session(),b=new c.Session();await a.begin();await b.begin();
  await a.send(h.activationAction(f)+c.as(f,f.requester,`SELECT * FROM public.open_my_funded_movement_coordination('${f.need}');`));
  const query=`SELECT * FROM public.${key}('${f.need}'${key.includes('dispute')?",'movement_concern'":''})`;
  await b.send(`SELECT ${f.schema}.snapshot_select_as('authenticated','${f.offerer}','${query.replaceAll("'","''")}');`);assert.match(b.out,/"ok": false/);prerequisiteRejections++;
  await a.send(rollback?'ROLLBACK;':'COMMIT;');await b.send('COMMIT;');assert.doesNotMatch(a.err+b.err,/ERROR|40P01|deadlock|timed out/i);a.close();b.close();
  if(rollback){assert(h.activate(f).ok);assert(h.call(f,`SELECT * FROM public.open_my_funded_movement_coordination('${f.need}')`).ok);}
  assert(c.result(f,key,f.offerer,key.includes('dispute')?'movement_concern':undefined).ok);fee(f);scenarios++;console.log('PASS activation vs invisible prerequisite '+key+' rollback='+rollback);
 }
 async function heldRace(f,first,second,{firstActor,secondActor,rollback=false,reject=false,label}){
  const a=new c.Session(),b=new c.Session();await a.begin();await b.begin();
  await a.send(c.action(f,first,firstActor,first.includes('dispute')?'movement_concern':undefined));
  const query=`SELECT * FROM public.${second}('${f.need}'${second.includes('dispute')?",'movement_concern'":''})`;
  const waiting=b.send(`SELECT ${f.schema}.snapshot_select_as('authenticated','${secondActor}','${query.replaceAll("'","''")}');`);
  await c.blocked(a,b,label);await a.send(rollback?'ROLLBACK;':'COMMIT;');await waiting;await b.send('COMMIT;');
  assert.match(b.out,reject?/"ok": false/:/"ok": true/);assert.doesNotMatch(a.err+b.err,/ERROR|40P01|deadlock|timeout/i);a.close();b.close();scenarios++;
 }
 for(const other of ['confirm_my_funded_movement_start','open_my_funded_movement_dispute'])for(const heldFirst of [false,true])for(const rollback of [false,true]){
  const f=c.fresh({pendingStart:true});assert(c.result(f,'request_my_movement_end',f.offerer).ok);const money=h.money();
  await heldRace(f,heldFirst?'confirm_my_movement_end':other,heldFirst?other:'confirm_my_movement_end',{firstActor:heldFirst?f.requester:other.includes('dispute')?f.offerer:f.requester,secondActor:heldFirst?other.includes('dispute')?f.offerer:f.requester:f.requester,rollback,reject:!rollback,label:`held no-travel vs ${other} heldFirst=${heldFirst} rollback=${rollback}`});
  const held=heldFirst!==rollback;assert.equal(c.target(`SELECT count(*) FROM private.funded_no_travel_holds WHERE alignment_id='${f.alignment}';`),held?'1':'0');
  assert.equal(c.target(`SELECT count(*) FROM private.${other.includes('dispute')?'funded_movement_disputes':'funded_movement_starts'} WHERE alignment_id='${f.alignment}';`),held?'0':'1');
  assert.equal(c.target(`SELECT count(*) FROM private.wallet_transactions WHERE alignment_id='${f.alignment}' AND transaction_kind='movement_hold_release';`),'0');assert.equal(h.money(),money);h.assertFee(f);
 }
 for(const rollback of [false,true]){
  const f=c.fresh();assert(c.result(f,'request_my_movement_end',f.offerer).ok);const money=h.money();
  await heldRace(f,'confirm_my_movement_end','confirm_my_movement_end',{firstActor:f.requester,secondActor:f.requester,rollback,label:'duplicate held consent rollback='+rollback});
  assert.equal(c.target(`SELECT count(*) FROM private.funded_no_travel_holds WHERE alignment_id='${f.alignment}';`),'1');assert.equal(h.money(),money);
 }
 for(const rollback of [false,true]){
  const f=c.fresh();assert(c.result(f,'request_my_movement_end',f.offerer).ok);const money=h.money(),a=new c.Session(),b=new c.Session();await a.begin();await b.begin();
  await a.send(`SELECT id FROM private.wallet_accounts WHERE member_id='${f.requester}' ORDER BY id FOR UPDATE;`);
  await b.send(c.action(f,'confirm_my_movement_end',f.requester));await b.send('COMMIT;');await a.send(rollback?'ROLLBACK;':'COMMIT;');assert.doesNotMatch(a.err+b.err,/ERROR|deadlock|timeout/i);a.close();b.close();assert.equal(h.money(),money);scenarios++;
 }
 for(const heldFirst of [false,true])for(const rollback of [false,true]){
  const f=c.fresh({offerer:require('node:crypto').randomUUID(),requester:require('node:crypto').randomUUID()}),g=c.fresh({offerer:f.offerer,requester:f.requester,started:true});assert(c.result(f,'request_my_movement_end',f.offerer).ok);h.requested(g);const before=h.economics(g),a=new c.Session(),b=new c.Session();await a.begin();await b.begin();
  const heldAction=c.action(f,'confirm_my_movement_end',f.requester),settleAction=c.action(g,h.confirm,g.requester);
  await a.send(heldFirst?heldAction:settleAction);const waiting=b.send(heldFirst?settleAction:heldAction);await c.blocked(a,b,'held consent vs shared-principal settlement heldFirst='+heldFirst+' rollback='+rollback);await a.send(rollback?'ROLLBACK;':'COMMIT;');await waiting;await b.send('COMMIT;');assert.doesNotMatch(a.err+b.err,/ERROR|deadlock|timeout/i);a.close();b.close();
  if(rollback)assert(c.result(heldFirst?f:g,heldFirst?'confirm_my_movement_end':h.confirm,f.requester).ok);
  h.assertFee(f);h.assertSettlement(g,before);assert.equal(h.economics(f).held,h.amounts(f).movement_contribution);assert.equal(c.target(`SELECT count(*) FROM private.wallet_transactions WHERE alignment_id='${f.alignment}' AND transaction_kind='movement_hold_release';`),'0');scenarios++;
 }
 assert.equal(c.target('SELECT deadlocks FROM pg_stat_database WHERE datname=current_database();'),'0');
 const result={scenarios,blockingProofs:c.proofs,prerequisiteRejections,heldConsentWalletGateBypasses:2,deadlocks:0};fs.writeFileSync('docs/0088-policy-concurrency-results.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
 });}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});module.exports={main};
