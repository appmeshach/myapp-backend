'use strict';
const assert=require('node:assert/strict');
const {run}=require('./0085_funded_no_travel_harness.cjs');
async function main(){await run(async c=>{
 let scenarios=0;const request='request_my_movement_end',confirm='confirm_my_movement_end';
 const execute=(f,key,actor)=>c.target('BEGIN; '+c.action(f,key,actor)+' COMMIT;');
 const caught=(f,key,actor)=>`DO $$ BEGIN PERFORM set_config('request.jwt.claim.sub','${actor}',true); SET LOCAL ROLE authenticated; BEGIN PERFORM * FROM public.${key}('${f.need}'); RAISE EXCEPTION 'Unexpected success'; EXCEPTION WHEN check_violation THEN RAISE NOTICE 'EXPECTED_REJECTION'; END; RESET ROLE; END $$;`;
 const safe=(...ss)=>{assert.doesNotMatch(ss.map(s=>s.err).join('\n'),/ERROR|40P01|deadlock|timeout/i);ss.forEach(s=>s.close());};
 const facts=(f,state)=>{
  assert.equal(c.target(`SELECT status FROM public.journeys WHERE id='${f.journey}';`),state);
  assert.equal(c.target(`SELECT count(*) FROM private.funded_no_travel_closures WHERE alignment_id='${f.alignment}';`),state==='cancelled'?'1':'0');
  assert.equal(c.target(`SELECT count(*) FROM private.funded_movement_starts WHERE alignment_id='${f.alignment}';`),state==='in_progress'?'1':'0');
  assert.equal(c.target(`SELECT count(*) FROM private.wallet_transactions WHERE alignment_id='${f.alignment}' AND transaction_kind='movement_hold_release';`),state==='cancelled'?'2':'0');
  c.target(`SELECT private.assert_funded_coordination_entry('${f.alignment}');`);
 };
 for(const closeWins of [true,false])for(const rollback of [false,true]){
  const f=c.fresh({pendingStart:true});execute(f,request,f.offerer);
  const a=new c.Session(),b=new c.Session();await a.begin();await b.begin();
  const first=closeWins?confirm:'confirm_my_funded_movement_start';
  const second=closeWins?'confirm_my_funded_movement_start':confirm;
  await a.send(c.action(f,first,f.requester));
  const waiting=b.send(rollback?c.action(f,second,f.requester):caught(f,second,f.requester));
  await c.blocked(a,b,'final close vs start; closeWins='+closeWins+' rollback='+rollback);
  await a.send(rollback?'ROLLBACK;':'COMMIT;');await waiting;await b.send('COMMIT;');
  if(!rollback)assert.match(b.err,/EXPECTED_REJECTION/);
  facts(f,(closeWins!==rollback)?'cancelled':'in_progress');safe(a,b);scenarios++;
 }
 for(const rollback of [false,true]){
  const f=c.fresh();execute(f,request,f.offerer);const a=new c.Session(),b=new c.Session();await a.begin();await b.begin();
  await a.send(c.action(f,confirm,f.requester));const waiting=b.send(c.action(f,confirm,f.requester));await c.blocked(a,b,'duplicate final close rollback='+rollback);
  await a.send(rollback?'ROLLBACK;':'COMMIT;');await waiting;await b.send('COMMIT;');facts(f,'cancelled');safe(a,b);scenarios++;
 }
 for(const startFirst of [true,false]){
  const f=c.fresh(),a=new c.Session(),b=new c.Session();await a.begin();await b.begin();
  await a.send(c.action(f,startFirst?'request_my_funded_movement_start':request,f.offerer));
  const waiting=b.send(c.action(f,startFirst?request:'request_my_funded_movement_start',f.offerer));await c.blocked(a,b,'first no-travel request vs start request '+startFirst);
  await a.send('COMMIT;');await waiting;await b.send('COMMIT;');safe(a,b);execute(f,confirm,f.requester);facts(f,'cancelled');scenarios++;
 }
 {const f=c.fresh(),a=new c.Session(),b=new c.Session();await a.begin();await b.begin();await a.send(c.action(f,request,f.offerer));
  const waiting=b.send(caught(f,request,f.requester));await c.blocked(a,b,'reciprocal first requests');await a.send('COMMIT;');await waiting;await b.send('COMMIT;');
  assert.match(b.err,/EXPECTED_REJECTION/);safe(a,b);execute(f,confirm,f.requester);facts(f,'cancelled');scenarios++;}
 {const f=c.fresh();execute(f,request,f.offerer);const a=new c.Session(),b=new c.Session();await a.begin();await b.begin();
  await a.send(`SELECT * FROM public.record_wallet_top_up_for_server('${f.requester}',1,'NGN','test-0085','gate-${f.need}');`);
  const waiting=b.send(c.action(f,confirm,f.requester));await c.blocked(a,b,'release vs existing top-up member gate');await a.send('COMMIT;');await waiting;await b.send('COMMIT;');facts(f,'cancelled');safe(a,b);scenarios++;}
 {const f=c.fresh({offerer:'00000000-0000-4000-8000-0000000085aa',requester:'00000000-0000-4000-8000-0000000085bb'});
  const g=c.fresh({offerer:f.offerer,requester:f.requester,started:true});execute(f,request,f.offerer);execute(g,'request_my_funded_movement_completion',g.offerer);
  const a=new c.Session(),b=new c.Session();await a.begin();await b.begin();
  await a.send(c.action(g,'confirm_my_funded_movement_completion',g.requester));
  const waiting=b.send(c.action(f,confirm,f.requester));await c.blocked(a,b,'no-travel consent FKs vs 0083 sorted principal gates');
  await a.send('COMMIT;');await waiting;await b.send('COMMIT;');facts(f,'cancelled');safe(a,b);
  assert.equal(c.target(`SELECT count(*) FROM private.completed_movement_principals WHERE alignment_id='${g.alignment}';`),'2');
  assert.equal(c.target(`SELECT count(*) FROM private.completed_movement_principals WHERE alignment_id='${f.alignment}';`),'0');scenarios++;
 }
 for(const key of ['request_my_funded_movement_completion','confirm_my_funded_movement_completion']){
  const f=c.fresh(),actor=key.startsWith('request')?f.offerer:f.requester;
  assert.equal(c.result(f,key,actor).ok,false,'completion requires authoritative start before any no-travel action');
  execute(f,request,f.offerer);const a=new c.Session(),b=new c.Session();await a.begin();await b.begin();
  await a.send(c.action(f,confirm,f.requester));const waiting=b.send(caught(f,key,actor));
  await c.blocked(a,b,'no-travel final confirmation vs '+key);await a.send('COMMIT;');await waiting;await b.send('COMMIT;');
  assert.match(b.err,/EXPECTED_REJECTION/);facts(f,'cancelled');safe(a,b);scenarios++;
 }
 assert.equal(c.target('SELECT deadlocks FROM pg_stat_database WHERE datname=current_database();'),'0');
 console.log(JSON.stringify({scenarios,blockingProofs:c.proofs,deadlocks:0},null,2));
 });}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
module.exports={main};
