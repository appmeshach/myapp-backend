'use strict';
const assert=require('node:assert/strict');
const {run,fixture,context,publish,replacement}=require('./0096_trusted_shared_segment_geographic_assessment_harness.cjs');
const {assessSharedSegment}=require('../functions/_shared/shared-segment-assessment-geometry.ts');
const {delay}=require('./0093_requester_route_generation_claim_boundary_harness.cjs');
async function main() {
 let count=0;
 await run(async c=>{
  for(const inconsistent of [false,true]) {
   const f=fixture(c),s=JSON.parse(c.target(context(f))),r=assessSharedSegment(s.offerer_shape,s.requester_shape);
   const a=c.session(),b=c.session();await a.begin();await b.begin();
   const first=JSON.parse(await a.send(publish(f,s,r)));
   const next=b.send(publish(f,s,inconsistent?{...r,workUnits:r.workUnits+1}:r)).then(v=>({ok:true,value:JSON.parse(v)}),e=>({ok:false,error:e.message}));
   await c.blocked(a,b);count++;console.log('PASS actual concurrent publication parent wait');
   await a.send('COMMIT;');const second=await next;
   if(inconsistent){assert(!second.ok);assert.match(second.error,/nondeterminism/);}
   else {assert(second.ok);assert.equal(second.value.publication_state,'reuse_existing');assert.equal(second.value.assessment_id,first.assessment_id);await b.send('COMMIT;');}
   count++;console.log('PASS '+(inconsistent?'inconsistent result fails closed':'one insert and deterministic conflict reread'));
  }
  for(const side of ['requester','offerer']) {
   const f=fixture(c),s=JSON.parse(c.target(context(f))),r=assessSharedSegment(s.offerer_shape,s.requester_shape);
   const a=c.session(),b=c.session();await a.begin();await b.begin();
   const table=side==='requester'?'public.movement_needs':'private.offering_movement_intents',id=f[side==='requester'?'need':'intent'];
   await a.send(`SELECT id FROM ${table} WHERE id='${id}' FOR UPDATE;`);
   const next=b.send(publish(f,s,r)).then(()=>({ok:true}),e=>({ok:false,error:e.message}));
   await c.blocked(a,b);
   await a.send(replacement(f,side)+' COMMIT;');
   const result=await next;assert(!result.ok);assert.match(result.error,/inputs changed/);
   assert.equal(c.target(`SELECT count(*) FROM private.shared_segment_geographic_assessments WHERE movement_need_id='${f.need}';`),'0');
   count++;console.log('PASS '+side+' route changed during compute/wait rejects stale publication');
  }
  for(const [label,lockTable,lockId,expiry] of [
   ['requester deadline','private.offering_movement_intents','intent','requester'],
   ['offerer predeparture','private.offering_route_evidence','offererRoute','offerer'],
   ['requester evidence expiry','private.offering_route_evidence','offererRoute','evidence'],
   ['offerer evidence expiry','private.requester_route_evidence','requesterRoute','offererEvidence'],
  ]) {
   const f=fixture(c,expiry==='offerer'?{horizon:'30 seconds'}:expiry==='evidence'?{requesterExpiry:'30 seconds'}:expiry==='offererEvidence'?{offererExpiry:'30 seconds'}:{});
   if(expiry==='requester')c.target(`UPDATE public.movement_needs SET earliest_departure_at=clock_timestamp()+interval '30 seconds',latest_departure_at=NULL WHERE id='${f.need}';`);
   const s=JSON.parse(c.target(context(f))),r=assessSharedSegment(s.offerer_shape,s.requester_shape);assert.equal(s.input_state,'ready');
   const a=c.session(),b=c.session();await a.begin();await b.begin();await a.send(`SELECT id FROM ${lockTable} WHERE id='${f[lockId]}' FOR UPDATE;`);
   const next=b.send(publish(f,s,r)).then(()=>({ok:true}),e=>({ok:false,error:e.message}));await c.blocked(a,b);
   assert.equal(c.target(`SELECT ${JSON.stringify(s.expires_at).replaceAll('"',"'")}::timestamptz>clock_timestamp();`),'t');
   while(c.target(`SELECT '${s.expires_at}'::timestamptz<=clock_timestamp();`)!=='t')await delay(100);
   await a.send('COMMIT;');const result=await next;assert(!result.ok);assert.match(result.error,/inputs changed/);
   count++;console.log('PASS '+label+' naturally expires during real lock wait');
  }
  // Inspect held locks directly: waiting for offerer evidence must already own
  // both parent locks. A third updater is blocked by the assessment worker.
  const f=fixture(c),a=c.session(),b=c.session(),d=c.session();await a.begin();await b.begin();await d.begin();
  await a.send(`SELECT id FROM private.offering_route_evidence WHERE id='${f.offererRoute}' FOR UPDATE;`);
  const pending=b.send(context(f));await c.blocked(a,b);
  const parent=d.send(`SELECT id FROM private.offering_movement_intents WHERE id='${f.intent}' FOR UPDATE;`);
  await c.blocked(b,d);await a.send('COMMIT;');assert.equal(JSON.parse(await pending).input_state,'ready');await b.send('COMMIT;');await parent;await d.send('COMMIT;');
  count++;console.log('PASS parent before evidence hierarchy, lock release, no deadlock');
  // Public workers serialize at the parent, as tested above. Independently prove
  // the canonical table's UNIQUE wait/fresh-read primitive with two insert-only
  // administrator fixture sessions. Their FK KEY SHARE locks are compatible.
  const x=fixture(c),s=JSON.parse(c.target(context(x))),r=assessSharedSegment(s.offerer_shape,s.requester_shape);
  const committed=JSON.parse(c.target(publish(x,s,r)));
  const y=fixture(c),v=JSON.parse(c.target(context(y))),result=assessSharedSegment(v.offerer_shape,v.requester_shape);
  const u=c.session(),w=c.session();await u.begin();await w.begin();
  const insert=`INSERT INTO private.shared_segment_geographic_assessments(offerer_route_evidence_id,requester_route_evidence_id,offerer_route_version,requester_route_version,offering_movement_intent_id,movement_need_id,offering_member_id,requesting_member_id,algorithm_version,parameter_fingerprint,input_context_fingerprint,canonical_context,canonical_result,expires_at)
   SELECT '${y.offererRoute}','${y.requesterRoute}',1,1,'${y.intent}','${y.need}','${y.offerer}','${y.requester}',algorithm_version,parameter_fingerprint,'${v.input_context_fingerprint}',${require('./0093_requester_route_generation_claim_boundary_harness.cjs').quote(JSON.stringify(v.context))}::jsonb,canonical_result,'${v.expires_at}' FROM private.shared_segment_geographic_assessments WHERE id='${committed.assessment_id}'`;
  await u.send(insert+';');
  // Result work counts are deterministic for this identical fixture geometry.
  assert.deepEqual(result,r);
  const waiting=w.send(insert+' ON CONFLICT DO NOTHING RETURNING id;');await c.blocked(u,w);await u.send('COMMIT;');assert.equal(await waiting,'');
  const visible=JSON.parse(await w.send(`SELECT canonical_result FROM private.shared_segment_geographic_assessments WHERE movement_need_id='${y.need}';`));assert.deepEqual(visible,result);await w.send('COMMIT;');
  assert.equal(JSON.parse(c.target(publish(y,v,result))).publication_state,'reuse_existing');
  count++;console.log('PASS canonical table UNIQUE wait, fresh read and service conflict recovery');
 });console.log(`0096 genuine PostgreSQL concurrency: ${count}/${count} passed; zero deadlocks`);
}
module.exports={main};if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
