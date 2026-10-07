'use strict';
const assert=require('node:assert/strict');
const {run}=require('./0090_trusted_requester_priority_harness.cjs'),{support}=require('./0090_trusted_requester_priority_test_support.cjs');
async function main(){await run(async c=>{const h=support(c);let scenarios=0,releaseProofs=0;
 const action=(n,limit=20)=>`SELECT set_config('request.jwt.claim.sub','${n.member_id}',true); SET LOCAL ROLE authenticated; SELECT jsonb_agg(movement_offer_id) FROM public.discover_masked_offers_for_my_need('${n.movement_need_id}',${limit}); RESET ROLE;`;
 const lock=async(session,sql)=>{await session.begin();await session.send(sql);assert.equal(session.err,'');};
 // Two candidates: wait on B only after A has been validated and released.
 const n=h.requester(),a=h.offering(2),b=h.offering(2),one=h.offer(n,a),two=h.offer(n,b),blocker=new c.Session(),reader=new c.Session();
 await lock(blocker,`SELECT id FROM private.offering_movement_intents WHERE id='${b.intent_id}' FOR UPDATE;`);await reader.begin();const pending=reader.send(action(n));await c.blocked(blocker,reader,'candidate B existing intent wait');
 const independent=new c.Session();await lock(independent,`SELECT id FROM private.offering_movement_availability WHERE id='${a.availability_id}' FOR UPDATE; SELECT id FROM public.movement_offers WHERE id='${one}' FOR UPDATE;`);assert.equal(c.target(`SELECT cardinality(pg_blocking_pids(${independent.pid}));`),'0');releaseProofs++;await independent.send('ROLLBACK;');independent.close();
 await blocker.send('ROLLBACK;');blocker.close();await pending;assert.equal(reader.err,'');await reader.send('ROLLBACK;');reader.close();scenarios++;
 // A canonical writer on A can acquire need -> offer -> intent while B waits.
 // It would form a lock cycle if discovery retained A's intent/offer locks.
 const canonicalReader=new c.Session(),writer=new c.Session();await canonicalReader.begin();await canonicalReader.send(action(n));assert.equal(canonicalReader.err,'');
 await lock(writer,`SELECT private.assert_movement_offer_availability_binding('${one}');`);assert.equal(c.target(`SELECT cardinality(pg_blocking_pids(${writer.pid}));`),'0');releaseProofs++;await writer.send('ROLLBACK;');writer.close();await canonicalReader.send('ROLLBACK;');canonicalReader.close();scenarios++;
 for(const [mutation,rollback] of [['withdrawn',false],['withdrawn',true],['full',false],['access',false],['offer',false]]){
  const need=h.requester(),first=h.offering(2),second=h.offering(2),early=h.offer(need,first,{wait:60}),valid=h.offer(need,second),hold=new c.Session(),ranker=new c.Session();
  await lock(hold,(mutation==='offer'?`SELECT id FROM public.movement_needs WHERE id='${need.movement_need_id}' FOR UPDATE; SELECT id FROM public.movement_offers WHERE id='${early}' FOR UPDATE; `:'')+`SELECT id FROM private.offering_movement_intents WHERE id='${first.intent_id}' FOR UPDATE;`);await ranker.begin();const waiting=ranker.send(action(need,1));await c.blocked(hold,ranker,'eligibility changes during wait '+mutation+' rollback='+rollback);
  const sql={withdrawn:`UPDATE private.offering_movement_availability SET status='withdrawn' WHERE id='${first.availability_id}';`,full:`UPDATE private.offering_movement_availability SET status='full',remaining_places=0 WHERE id='${first.availability_id}';`,access:`UPDATE public.member_vehicle_access SET active=false WHERE vehicle_id='${first.vehicle_id}';`,offer:`UPDATE public.movement_offers SET status='withdrawn' WHERE id='${early}';`}[mutation];
  await hold.send(sql+(rollback?' ROLLBACK;':' COMMIT;'));assert.equal(hold.err,'');hold.close();await waiting;assert.equal(ranker.err,'');const lines=ranker.out.split('\n').filter(l=>l.startsWith('['));assert.deepEqual(JSON.parse(lines.at(-1)),[rollback?early:valid]);await ranker.send('ROLLBACK;');ranker.close();scenarios++;
 }
 for(const [table,key,value] of [['public.movement_needs','id',n.movement_need_id],['public.movement_offers','id',one],['private.offering_movement_intents','id',a.intent_id],['private.offering_movement_availability','id',a.availability_id]]){const r=new c.Session(),w=new c.Session();await r.begin();await r.send(action(n));assert.equal(r.err,'');await lock(w,`SELECT * FROM ${table} WHERE ${key}='${value}' FOR UPDATE;`);assert.equal(c.target(`SELECT cardinality(pg_blocking_pids(${w.pid}));`),'0');releaseProofs++;await w.send('ROLLBACK;');w.close();await r.send('ROLLBACK;');r.close();scenarios++;}
 const deadlocks=Number(c.target(`SELECT deadlocks FROM pg_stat_database WHERE datname='${c.database}';`));assert.equal(deadlocks,0);console.log(JSON.stringify({scenarios,blockingProofs:c.proofs,lockReleaseProofs:releaseProofs,deadlocks}));
 });}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});module.exports={main};
