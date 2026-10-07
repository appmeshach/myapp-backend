'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const {run}=require('./0089_trusted_movement_priority_harness.cjs'),{support}=require('./0089_trusted_movement_priority_test_support.cjs');
async function main(){await run(async c=>{const h=support(c);let scenarios=0,readAssertions=0;
 for(const rollback of [false,true]){
  const a=h.offering(1),n=h.requester(),id=h.interest(n,a),f=c.fresh({started:true,requester:n.member_id});h.requested(f);
  const before=h.memberScore(n.member_id),writer=new c.Session();await writer.begin();await writer.send(c.action(f,h.confirm,f.requester)+' SET CONSTRAINTS ALL IMMEDIATE;');assert.equal(writer.err,'');
  assert.equal(h.memberScore(n.member_id),before);readAssertions++;
  assert.deepEqual(h.list(a).rows.map(x=>x.interest_id),[id]);readAssertions++;
  await writer.send(rollback?'ROLLBACK;':'COMMIT;');writer.close();assert.equal(writer.err,'');
  assert.equal(h.memberScore(n.member_id),rollback?before:27.5);readAssertions++;
  assert.deepEqual(h.list(a).rows.map(x=>x.interest_id),[id]);readAssertions++;scenarios++;
 }
 for(const rollback of [false,true]){
  const a=h.offering(1),n=h.requester(),id=h.interest(n,a),f=h.completed(n.member_id),before=h.memberScore(n.member_id),writer=new c.Session();await writer.begin();await writer.send(c.as(f,f.offerer,`SELECT * FROM public.rate_my_completed_movement_person('${f.need}',1,5);`));assert.equal(writer.err,'');
  assert.equal(h.memberScore(n.member_id),before);readAssertions++;assert.deepEqual(h.list(a).rows.map(x=>x.interest_id),[id]);readAssertions++;
  await writer.send(rollback?'ROLLBACK;':'COMMIT;');writer.close();assert.equal(writer.err,'');assert.equal(h.memberScore(n.member_id),rollback?before:30.416666666666668);readAssertions++;scenarios++;
 }
 const a=h.offering(4),n=h.requester(),m=h.requester(),id=h.interest(n,a),second=h.interest(m,a),reader=new c.Session();await reader.begin();await reader.send(`SELECT set_config('request.jwt.claim.sub','${a.member_id}',true); SET LOCAL ROLE authenticated; SELECT count(*) FROM public.list_requester_movement_interests_for_offerer('${a.availability_id}'); RESET ROLE;`);assert.equal(reader.err,'');
 for(const [table,key,value] of [['public.movement_needs','id',n.movement_need_id],['private.offering_movement_availability','id',a.availability_id],['private.requester_movement_interests','id',id]]){const writer=new c.Session();await writer.begin();await writer.send(`SELECT * FROM ${table} WHERE ${key}='${value}' FOR UPDATE;`);assert.equal(writer.err,'');assert.equal(c.target(`SELECT cardinality(pg_blocking_pids(${writer.pid}));`),'0');readAssertions++;await writer.send('ROLLBACK;');writer.close();scenarios++;}
 await reader.send('ROLLBACK;');reader.close();
 // Hold an existing need lock, allowing the candidate cursor snapshot to start
 // before a genuine completion commits. The result must retain the pre-commit
 // ordering; the next statement must observe the complete committed receipt.
 const b=h.offering(1),r=h.requester(),t=h.requester(),ri=h.interest(r,b),ti=h.interest(t,b,10);
 const f=c.fresh({started:true,requester:r.member_id});h.requested(f);const blocker=new c.Session(),ranker=new c.Session();await blocker.begin();await blocker.send(`SELECT id FROM public.movement_needs WHERE id='${r.movement_need_id}' FOR UPDATE;`);await ranker.begin();
 const pending=ranker.send(`SELECT set_config('request.jwt.claim.sub','${b.member_id}',true); SET LOCAL ROLE authenticated; SELECT 'ORDER='||jsonb_agg(interest_id)::text FROM public.list_requester_movement_interests_for_offerer('${b.availability_id}'); RESET ROLE;`);
 await c.blocked(blocker,ranker,'existing need validation wait while completion commits');
 const completion=new c.Session();await completion.begin();await completion.send(c.action(f,h.confirm,f.requester)+' COMMIT;');assert.equal(completion.err,'');completion.close();await blocker.send('ROLLBACK;');blocker.close();await pending;assert.equal(ranker.err,'');assert.deepEqual(JSON.parse(ranker.out.split('\n').find(line=>line.startsWith('ORDER=')).slice(6)),[ti,ri]);assert.deepEqual(h.list(b).rows.map(x=>x.interest_id),[ri,ti]);await ranker.send('ROLLBACK;');ranker.close();scenarios++;readAssertions+=2;
 const deadlocks=Number(c.target(`SELECT deadlocks FROM pg_stat_database WHERE datname='${c.database}';`));assert.equal(deadlocks,0,'Actual disposable database deadlock counter');
 fs.writeFileSync('docs/0089-concurrency-results.json',JSON.stringify({scenarios,readAssertions,blockingProofs:c.proofs,lockReleaseProofs:3,deadlocks},null,2)+'\n');console.log('PASS '+scenarios+' concurrency scenarios / '+readAssertions+' read assertions / '+c.proofs.length+' blocking proofs / 3 lock-release proofs / 0 deadlocks');
 });}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});module.exports={main};
