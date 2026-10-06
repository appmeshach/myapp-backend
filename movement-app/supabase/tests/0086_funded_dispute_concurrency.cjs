'use strict';
const assert=require('node:assert/strict');
const {run}=require('./0086_funded_dispute_harness.cjs');
async function main(){await run(async c=>{
 let scenarios=0;
 const open='open_my_funded_movement_dispute';
 const action=(f,key,actor=f.offerer)=>c.action(f,key,actor,key===open?'movement_concern':undefined);
 const execute=(f,key,actor)=>c.target('BEGIN; '+action(f,key,actor)+' COMMIT;');
 const caught=(f,key,actor)=>`DO $$ BEGIN PERFORM set_config('request.jwt.claim.sub','${actor}',true); SET LOCAL ROLE authenticated; BEGIN PERFORM * FROM public.${key}('${f.need}'${key===open?",'movement_concern'":''}); RAISE EXCEPTION 'Unexpected success'; EXCEPTION WHEN check_violation THEN RAISE NOTICE 'EXPECTED_REJECTION'; END; RESET ROLE; END $$;`;
 async function race(f,first,second,{actor1=f.offerer,actor2=f.offerer,rollback=false,reject=false,label}={}){
  const a=new c.Session(),b=new c.Session();await a.begin();await b.begin();
  await a.send(action(f,first,actor1));const waiting=b.send(reject?caught(f,second,actor2):action(f,second,actor2));
  await c.blocked(a,b,label);await a.send(rollback?'ROLLBACK;':'COMMIT;');await waiting;await b.send('COMMIT;');
  if(reject)assert.match(b.err,/EXPECTED_REJECTION/);
  assert.doesNotMatch(a.err+b.err,/ERROR|40P01|deadlock|timeout/i);a.close();b.close();scenarios++;
 }
 for(const disputeFirst of [true,false])for(const rollback of [false,true]){
  const f=c.fresh({pendingStart:true});
  await race(f,disputeFirst?open:'confirm_my_funded_movement_start',disputeFirst?'confirm_my_funded_movement_start':open,{actor1:disputeFirst?f.offerer:f.requester,actor2:disputeFirst?f.requester:f.offerer,rollback,reject:!rollback,label:`start confirmation disputeFirst=${disputeFirst} rollback=${rollback}`});
  assert.equal(c.target(`SELECT count(*) FROM private.funded_movement_disputes WHERE alignment_id='${f.alignment}';`),(disputeFirst!==rollback)?'1':'0');
  assert.equal(c.target(`SELECT count(*) FROM private.funded_movement_starts WHERE alignment_id='${f.alignment}';`),(disputeFirst!==rollback)?'0':'1');
 }
 for(const key of ['request_my_funded_movement_start','request_my_movement_end'])for(const disputeFirst of [true,false]){
  const f=c.fresh();await race(f,disputeFirst?open:key,disputeFirst?key:open,{label:`compatible intent ${key} disputeFirst=${disputeFirst}`});
  assert.equal(c.result(f,'get_my_funded_movement_dispute_status').rows[0].dispute_active,true);
 }
 for(const disputeFirst of [true,false])for(const rollback of [false,true]){
  const f=c.fresh();execute(f,'request_my_movement_end',f.offerer);
  await race(f,disputeFirst?open:'confirm_my_movement_end',disputeFirst?'confirm_my_movement_end':open,{actor1:disputeFirst?f.offerer:f.requester,actor2:disputeFirst?f.requester:f.offerer,rollback,reject:!rollback,label:`no-travel confirmation disputeFirst=${disputeFirst} rollback=${rollback}`});
  assert.equal(c.target(`SELECT count(*) FROM private.funded_movement_disputes WHERE alignment_id='${f.alignment}';`),(disputeFirst!==rollback)?'1':'0');
  assert.equal(c.target(`SELECT count(*) FROM private.funded_no_travel_closures WHERE alignment_id='${f.alignment}';`),(disputeFirst!==rollback)?'0':'1');
 }
 for(const rollback of [false,true]){const f=c.fresh();await race(f,open,open,{rollback,label:'duplicate opening rollback='+rollback});assert.equal(c.target(`SELECT count(*) FROM private.funded_movement_disputes WHERE alignment_id='${f.alignment}';`),'1');}
 {const f=c.fresh();await race(f,open,open,{actor2:f.requester,reject:true,label:'both principals open simultaneously'});assert.equal(c.result(f,'get_my_funded_movement_dispute_status',f.requester).rows[0].opened_by_me,false);}
 for(const key of ['request_my_funded_movement_completion','confirm_my_funded_movement_completion']){
  const f=c.fresh();await race(f,open,key,{actor2:key.startsWith('request')?f.offerer:f.requester,reject:true,label:'pre-start completion blocked '+key});
 }
 // Actual reachable 0083 confirmation on a DIFFERENT movement sharing both
 // principals exercises the member FK/gate order in each direction.
 for(const completionFirst of [true,false]){
  const f=c.fresh({offerer:'00000000-0000-4000-8000-0000000086aa',requester:'00000000-0000-4000-8000-0000000086bb'}),g=c.fresh({offerer:f.offerer,requester:f.requester,started:true});
  execute(g,'request_my_funded_movement_completion',g.offerer);
  const a=new c.Session(),b=new c.Session();await a.begin();await b.begin();
  await a.send(completionFirst?action(g,'confirm_my_funded_movement_completion',g.requester):action(f,open));
  const waiting=b.send(completionFirst?action(f,open):action(g,'confirm_my_funded_movement_completion',g.requester));
  await c.blocked(a,b,'shared principal completion gates completionFirst='+completionFirst);await a.send('COMMIT;');await waiting;await b.send('COMMIT;');
  assert.doesNotMatch(a.err+b.err,/ERROR|40P01|deadlock|timeout/i);a.close();b.close();scenarios++;
  assert.equal(c.target(`SELECT count(*) FROM private.completed_movement_principals WHERE alignment_id='${g.alignment}';`),'2');
  assert.equal(c.result(f,'get_my_funded_movement_dispute_status').rows[0].dispute_active,true);
 }
 // A wallet-account row gate must not hold up a no-money opening.
 {const f=c.fresh(),a=new c.Session(),b=new c.Session();await a.begin();await b.begin();await a.send(`SELECT id FROM private.wallet_accounts WHERE member_id='${f.requester}' ORDER BY id FOR UPDATE;`);await b.send(action(f,open));await b.send('COMMIT;');await a.send('ROLLBACK;');assert.doesNotMatch(a.err+b.err,/ERROR|deadlock|timeout/i);a.close();b.close();scenarios++;}
 assert.equal(c.target('SELECT deadlocks FROM pg_stat_database WHERE datname=current_database();'),'0');
 console.log(JSON.stringify({scenarios,blockingProofs:c.proofs,deadlocks:0,walletAccountGateBypassed:true},null,2));
 });}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
module.exports={main};
