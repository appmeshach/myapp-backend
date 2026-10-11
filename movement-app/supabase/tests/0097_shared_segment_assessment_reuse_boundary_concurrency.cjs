'use strict';
const assert=require('node:assert/strict');
const {run,lookup}=require('./0097_shared_segment_assessment_reuse_boundary_harness.cjs');
const base=require('./0096_trusted_shared_segment_geographic_assessment_harness.cjs');
const {assessSharedSegment}=require('../functions/_shared/shared-segment-assessment-geometry.ts');
async function main(){let count=0;await run(async c=>{
 const f=base.fixture(c),a=c.session(),b=c.session();
 const [amiss,bmiss]=await Promise.all([a.send(lookup(f)),b.send(lookup(f))]);
 assert.equal(JSON.parse(amiss).lookup_state,'not_found');assert.equal(JSON.parse(bmiss).lookup_state,'not_found');
 const snapshot=JSON.parse(c.target(base.context(f)));let calculations=0;
 const first=assessSharedSegment(snapshot.offerer_shape,snapshot.requester_shape);calculations++;
 const second=assessSharedSegment(snapshot.offerer_shape,snapshot.requester_shape);calculations++;
 const [apublished,bpublished]=await Promise.all([a.send(base.publish(f,snapshot,first)),b.send(base.publish(f,snapshot,second))]).then(values=>values.map(JSON.parse));
 assert.equal(calculations,2);assert.equal(new Set([apublished.assessment_id,bpublished.assessment_id]).size,1);
 assert.deepEqual(new Set([apublished.publication_state,bpublished.publication_state]),new Set(['published','reuse_existing']));
 assert.equal(JSON.parse(c.target(lookup(f))).assessment_id,apublished.assessment_id);count++;console.log('PASS simultaneous misses, duplicate calculations, one insert and canonical reuse');
 const changed=base.fixture(c),old=JSON.parse(c.target(base.context(changed)));assert.equal(JSON.parse(c.target(lookup(changed))).lookup_state,'not_found');
 c.target(`BEGIN; ${base.replacement(changed,'requester')} COMMIT;`);
 assert.throws(()=>c.target(base.publish(changed,old,assessSharedSegment(old.offerer_shape,old.requester_shape))),/inputs changed/);count++;console.log('PASS route change after lookup is revalidated at publication');
 // Leave enough setup time for slower Docker hosts, then wait for the actual
 // recorded dependency expiry rather than assuming a fixed setup duration.
 const expired=base.fixture(c,{horizon:'2 minutes'}),prior=JSON.parse(c.target(base.context(expired)));assert.equal(JSON.parse(c.target(lookup(expired))).lookup_state,'not_found');
 c.target(`SELECT pg_sleep(GREATEST(0,extract(epoch FROM ('${prior.expires_at}'::timestamptz-clock_timestamp())))+0.1);`);
 assert.throws(()=>c.target(base.publish(expired,prior,assessSharedSegment(prior.offerer_shape,prior.requester_shape))),/inputs changed/);count++;console.log('PASS dependency expiry after lookup is revalidated at publication');
 });console.log(`0097 genuine PostgreSQL concurrency: ${count}/${count} passed; zero deadlocks`);}
module.exports={main};if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
