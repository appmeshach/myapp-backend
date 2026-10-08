'use strict';
const assert=require('node:assert/strict');
const {run}=require('./0091_pre_departure_roster_freeze_harness.cjs'),{support}=require('./0090_trusted_requester_priority_test_support.cjs');
async function main(){await run(async c=>{
 const h=support(c);let scenarios=0,continuationProofs=0;
 const info=f=>JSON.parse(c.target(`SELECT to_jsonb(x) FROM ${f.schema}.snapshot_fixture x;`));
 const wrap=(actor,sql)=>`SELECT ${c.inboxSchema}.inbox_as('authenticated','${actor}','${sql.replaceAll("'","''")}');`;
 const start=f=>wrap(f.offerer,`SELECT * FROM public.request_my_funded_movement_start('${f.need}')`);
 const rows=s=>s.out.split('\n').filter(x=>x.startsWith('{')).map(x=>JSON.parse(x));
 const parent=f=>info(f).availability;
 const freezeCount=f=>c.target(`SELECT count(*) FROM private.offering_movement_roster_freezes WHERE availability_id='${parent(f)}';`);
 async function race(first,second,label,rollback){
  const a=new c.Session(),b=new c.Session();await a.begin();await b.begin();await a.send(first);assert.equal(a.err,'');assert.equal(rows(a).at(-1).ok,true,label+' first action');
  const waiting=b.send(second);await c.blocked(a,b,label);await a.send(rollback?'ROLLBACK;':'COMMIT;');await waiting;assert.equal(a.err+b.err,'');const result=rows(b).at(-1);await b.send('COMMIT;');assert.equal(b.err,'');a.close();b.close();scenarios++;console.log('PASS '+label);return result;
 }
 for(const operation of ['interest','offer','accept'])for(const startFirst of [true,false])for(const rollback of [false,true]){
  const f=c.fresh({solo:true}),p=info(f),n=h.requester();
  const availability={availability_id:p.availability,intent_id:p.intent,route_id:p.route,vehicle_id:p.vehicle,member_id:f.offerer};
  // Establish complete trusted evidence before the race, without reserving seats.
  let offer,interest,e;
  if(operation==='accept'){
   offer=h.offer(n,availability);e=c.target(`SELECT route_match_evidence_id FROM private.movement_offer_route_match_bindings WHERE movement_offer_id='${offer}';`);
  }else{
   interest=h.interest(n,availability);e=c.target(`SELECT route_match_evidence_id FROM private.requester_movement_interests WHERE id='${interest}';`);
   if(operation==='interest')assert.equal(h.call(n.member_id,`SELECT * FROM public.withdraw_requester_movement_interest('${interest}')`).ok,true);
  }
  const admission=wrap(operation==='offer'?f.offerer:n.member_id,{
   interest:`SELECT * FROM public.create_requester_movement_interest(gen_random_uuid(),'${n.movement_need_id}','${p.availability}','${e}')`,
   offer:`SELECT * FROM public.create_movement_offer('${n.movement_need_id}','${e}','${p.availability}',1)`,
   accept:`SELECT * FROM public.accept_movement_offer('${offer}')`
  }[operation]);
  const result=await race(startFirst?start(f):admission,startFirst?admission:start(f),`${operation} startFirst=${startFirst} rollback=${rollback}`,rollback);
  assert.equal(result.ok,!startFirst||rollback,JSON.stringify(result));if(!result.ok)assert.equal(result.state,'23514');
  assert.equal(freezeCount(f),startFirst&&rollback?'0':'1');
  const membership=c.target(`SELECT count(*) FROM public.alignments WHERE movement_need_id='${n.movement_need_id}';`);
  const accepted=operation==='accept'&&(startFirst?rollback:!rollback);assert.equal(membership,accepted?'1':'0');
  assert.equal(c.target(`SELECT remaining_places FROM private.offering_movement_availability WHERE id='${p.availability}';`),accepted?'1':'2');
  if(accepted){const graph=c.target(`SELECT id FROM public.alignments WHERE movement_need_id='${n.movement_need_id}';`);assert.equal(c.target(`SELECT status FROM public.alignments WHERE id='${graph}';`),'awaiting_activation_payment');continuationProofs++;}
 }
 for(const rollback of [false,true]){
  const f=c.fresh({solo:true});const result=await race(start(f),start(f),'duplicate alignment start rollback='+rollback,rollback);assert.equal(result.ok,true);assert.equal(freezeCount(f),'1');assert.equal(c.target(`SELECT count(*) FROM private.funded_movement_start_requests WHERE alignment_id='${f.alignment}';`),'1');
 }
 for(const aFirst of [true,false])for(const rollback of [false,true]){
  const a=c.fresh({solo:true}),b=c.fresh({solo:true,parent:a}),first=aFirst?a:b,second=aFirst?b:a;
  const result=await race(start(first),start(second),`shared parent A/B start aFirst=${aFirst} rollback=${rollback}`,rollback);assert.equal(result.ok,true);assert.equal(freezeCount(a),'1');
  assert.equal(c.target(`SELECT initiating_alignment_id FROM private.offering_movement_roster_freezes WHERE availability_id='${parent(a)}';`),rollback?second.alignment:first.alignment);
  if(rollback)assert.equal(c.result(first,'request_my_funded_movement_start').ok,true);assert.equal(freezeCount(a),'1');
 }
 // Already-accepted B continues without live parent locks. Neither order may
 // block on A's parent freeze. Both transactions remain open during the proof.
 for(const freezeFirst of [true,false])for(const rollback of [false,true]){
  const a=c.fresh({solo:true}),b=c.fresh({solo:true,parent:a,stage:'agreement'}),freeze=new c.Session(),continuation=new c.Session();await freeze.begin();await continuation.begin();
  const funding=wrap(b.requester,`SELECT * FROM public.hold_my_movement_funds('${b.agreement}',1)`);
  if(freezeFirst){await freeze.send(start(a));await continuation.send(funding);}else{await continuation.send(funding);await freeze.send(start(a));}
  assert.equal(freeze.err+continuation.err,'');assert.equal(rows(freeze).at(-1).ok,true);assert.equal(rows(continuation).at(-1).ok,true);
  assert.equal(c.target(`SELECT cardinality(pg_blocking_pids(${continuation.pid}))+cardinality(pg_blocking_pids(${freeze.pid}));`),'0');continuationProofs++;
  await freeze.send(rollback?'ROLLBACK;':'COMMIT;');await continuation.send('COMMIT;');freeze.close();continuation.close();scenarios++;console.log(`PASS B funding continues freezeFirst=${freezeFirst} rollback=${rollback}`);
 }
 const deadlocks=Number(c.target(`SELECT deadlocks FROM pg_stat_database WHERE datname='${c.database}';`));assert.equal(deadlocks,0);
 console.log(JSON.stringify({scenarios,actualBlockingProofs:c.proofs.length,blocking:c.proofs,continuationProofs,deadlocks}));
 });}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});module.exports={main};
