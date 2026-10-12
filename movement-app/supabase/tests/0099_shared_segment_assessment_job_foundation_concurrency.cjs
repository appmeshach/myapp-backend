'use strict';
const assert=require('node:assert/strict');
const h=require('./0099_shared_segment_assessment_job_foundation_harness.cjs');
const {delay}=require('./0093_requester_route_generation_claim_boundary_harness.cjs');
const {assessSharedSegment}=require('../functions/_shared/shared-segment-assessment-geometry.ts');
async function main(){let count=0;await h.run(async c=>{
 const f=h.fixture(c),a=c.session(),b=c.session();await a.begin();await b.begin();
 const first=JSON.parse(await a.send(h.register(f))),waiting=b.send(h.register(f));await c.blocked(a,b);await a.send('COMMIT;');
 const second=JSON.parse(await waiting);await b.send('COMMIT;');assert.deepEqual(second,first);assert.equal(c.target('SELECT count(*) FROM private.shared_segment_assessment_jobs;'),'1');count++;console.log('PASS actual blocking concurrent identical registration converges');
 await a.begin();await b.begin();const winner=JSON.parse(await a.send(h.claim())),loser=JSON.parse(await b.send(h.claim()));
 assert.equal(winner.state,'claimed');assert.equal(loser.state,'idle');await a.send('COMMIT;');await b.send('COMMIT;');count++;console.log('PASS simultaneous claim with held row lock has one lease winner');
 c.target(`UPDATE private.shared_segment_assessment_jobs SET lease_expires_at=clock_timestamp()+interval '2 seconds' WHERE id='${winner.job_id}';`);
 while(c.target(`SELECT lease_expires_at<=clock_timestamp() FROM private.shared_segment_assessment_jobs WHERE id='${winner.job_id}';`)!=='t')await delay(100);
 const reclaimed=h.get(c,h.claim());assert.equal(reclaimed.job_id,winner.job_id);assert.equal(reclaimed.attempt_count,2);assert.notEqual(reclaimed.lease_token,winner.lease_token);count++;console.log('PASS actual expired lease reclaimed with new fence and incremented attempt');
 assert.deepEqual(h.get(c,h.load(winner)),{state:'lease_invalid'});assert.deepEqual(h.get(c,h.finalize(winner,{})),{state:'lease_invalid'});count++;console.log('PASS old token cannot load or finalize after reclaim');
 const s=h.get(c,h.load(reclaimed)),r=assessSharedSegment(s.snapshot.offerer_shape,s.snapshot.requester_shape);
 await a.begin();await b.begin();const done=JSON.parse(await a.send(h.finalize(reclaimed,s.snapshot.context,r))),pending=b.send(h.finalize(reclaimed,s.snapshot.context,r));
 await c.blocked(a,b);await a.send('COMMIT;');assert.deepEqual(JSON.parse(await pending),{...done,publication_state:'reuse_existing'});await b.send('COMMIT;');count++;console.log('PASS concurrent finalization converges under actual dependency lock wait');
 assert.deepEqual(h.get(c,h.finalize(reclaimed,s.snapshot.context)),{...done,publication_state:'reuse_existing'});count++;console.log('PASS lost committed final response recovers exact 0097 identity');
 const before=c.target('SELECT count(*) FROM private.shared_segment_assessment_jobs;');assert.equal(h.get(c,h.register(f)).state,'assessment_reuse');assert.equal(c.target('SELECT count(*) FROM private.shared_segment_assessment_jobs;'),before);count++;console.log('PASS exact current hit creates no job');
 for(const mode of ['availability','lease']){
  const x=h.fixture(c);h.get(c,h.register(x));const j=h.get(c,h.claim()),v=h.get(c,h.load(j)),result=assessSharedSegment(v.snapshot.offerer_shape,v.snapshot.requester_shape);
  const lock=c.session(),pub=c.session();await lock.begin();await pub.begin();
  await lock.send(`SELECT id FROM public.movement_needs WHERE id='${x.need}' FOR UPDATE;`);
  if(mode==='lease')c.target(`UPDATE private.shared_segment_assessment_jobs SET lease_expires_at=clock_timestamp()+interval '2 seconds' WHERE id='${j.job_id}';`);
  const request=pub.send(h.finalize(j,v.snapshot.context,result));await c.blocked(lock,pub);
  if(mode==='availability')await lock.send(`UPDATE private.offering_movement_availability SET status='withdrawn' WHERE id='${x.availability}';`);
  else while(c.target(`SELECT lease_expires_at<=clock_timestamp() FROM private.shared_segment_assessment_jobs WHERE id='${j.job_id}';`)!=='t')await delay(100);
  await lock.send('COMMIT;');const out=JSON.parse(await request);await pub.send('COMMIT;');assert.equal(out.state,mode==='lease'?'lease_invalid':'stale');
  assert.equal(c.target(`SELECT count(*) FROM private.shared_segment_geographic_assessments WHERE movement_need_id='${x.need}';`),'0');count++;console.log('PASS finalization lock wait fences '+mode+' change and publishes no evidence');
  if(mode==='lease'){const drained=h.get(c,h.claim());assert.equal(drained.job_id,j.job_id);h.get(c,h.fail(drained,'invalid_evidence'));}
 }
 const slow=h.fixture(c);h.get(c,h.register(slow));const slowJob=h.get(c,h.claim()),slowCtx=h.get(c,h.load(slowJob));
 const slowResult=assessSharedSegment(slowCtx.snapshot.offerer_shape,slowCtx.snapshot.requester_shape);
 // Disposable test-only delay proves expiry AFTER insertion rolls back evidence.
 c.target(`CREATE FUNCTION ${slow.schema}.delay_publish() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.movement_need_id='${slow.need}'::uuid THEN PERFORM pg_sleep(5); END IF; RETURN NEW; END; $$;
  CREATE TRIGGER delay_fence0099 AFTER INSERT ON private.shared_segment_geographic_assessments FOR EACH ROW EXECUTE FUNCTION ${slow.schema}.delay_publish();
  UPDATE private.shared_segment_assessment_jobs SET lease_expires_at=clock_timestamp()+interval '3 seconds' WHERE id='${slowJob.job_id}';`);
 assert.throws(()=>c.target(h.finalize(slowJob,slowCtx.snapshot.context,slowResult)),/23514/);
 c.target('DROP TRIGGER delay_fence0099 ON private.shared_segment_geographic_assessments;');
 assert.equal(c.target(`SELECT count(*) FROM private.shared_segment_geographic_assessments WHERE movement_need_id='${slow.need}';`),'0');
 assert.equal(c.target(`SELECT status FROM private.shared_segment_assessment_jobs WHERE id='${slowJob.job_id}';`),'running');
 count++;console.log('PASS actual lease expiry during delayed publication rolls back evidence and completion');
 assert.equal(c.target(`SELECT deadlocks FROM pg_stat_database WHERE datname='${c.db}';`),'0');
 });console.log(`0099 genuine concurrency: ${count}/${count}; zero deadlocks`);}
module.exports={main};if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
