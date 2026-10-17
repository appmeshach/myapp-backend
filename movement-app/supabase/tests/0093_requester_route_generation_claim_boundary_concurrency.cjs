'use strict';
const assert = require('node:assert/strict');
const {run,quote,delay} = require('./0093_requester_route_generation_claim_boundary_harness.cjs');
async function main(){let checks=0;await run(async c=>{
  const pass=name=>{checks++;console.log('PASS '+name);};
  const acquire=(f,p={})=>JSON.parse(c.target(c.claim(f,p)));
  const write=(f,token,p={})=>JSON.parse(c.target(c.publish(f,token,p)));
  const first=c.fresh(),replacement=c.fresh(),stale=c.fresh();
  const replacementClaim=acquire(replacement),staleClaim=acquire(stale);
  const old=write(replacement,replacementClaim.generation_claim_token);
  const staleEvidence=write(stale,staleClaim.generation_claim_token,{expiry:"clock_timestamp()+interval '0.3 seconds'"});
  const a=c.session(),b=c.session();await a.begin();await b.begin();
  const winner=JSON.parse(await a.send(c.claim(first)));
  let waiting=b.send(c.claim(first));await c.blocked(a,b);
  await a.send('COMMIT;');const loser=JSON.parse(await waiting);await b.send('COMMIT;');
  assert.equal(winner.generation_state,'claimed');assert.equal(loser.generation_state,'in_progress');assert.equal(loser.generation_claim_token,null);
  assert.equal(c.target(`SELECT count(*) FROM private.requester_route_generation_claims WHERE movement_need_id=${quote(first.need)};`),'1');
  pass('first-slot race grants exactly one generation permission after real PostgreSQL blocking');
  for(const overrides of [{namespace:'wrong'},{product:'wrong'},{version:'wrong'},{schema:'wrong'},{format:'wrong'},{origin:replacement.origin},{destination:first.origin}]){
    assert.throws(()=>write(first,winner.generation_claim_token,overrides),/23514/);
  }
  pass('publication fences every provider/schema/format and endpoint identity');
  await a.begin();await b.begin();await a.send(c.claim(first));waiting=b.send(c.claim(first));await c.blocked(a,b);await a.send('COMMIT;');
  assert.equal(JSON.parse(await waiting).generation_state,'in_progress');await b.send('COMMIT;');pass('active-claim race never exposes token');
  // Genuine elapsed evidence, with a still-active lease, cannot be reused.
  await delay(350);assert.equal(acquire(stale).generation_state,'in_progress');pass('elapsed current evidence is not reusable');
  // Wait for actual authoritative lease deadlines; never alter production clocks
  // or disable claim protection to simulate expiry.
  console.log('Waiting for fixed 30-second leases to expire on the server');
  while(c.target(`SELECT lease_expires_at<=clock_timestamp() FROM private.requester_route_generation_claims WHERE movement_need_id=${quote(first.need)};`)!=='t')await delay(250);
  const originalGenerated=c.target(`SELECT generated_at FROM private.requester_route_evidence WHERE id=${quote(old.route_evidence_id)};`);
  assert.deepEqual(write(replacement,replacementClaim.generation_claim_token,{generated:quote(originalGenerated)}),old);
  pass('exact completed publication replay survives lease expiry without another version');
  assert.throws(()=>write(first,winner.generation_claim_token),/Requester claim expired/);pass('expired token cannot publish before takeover');
  await a.begin();await b.begin();const takeover=JSON.parse(await a.send(c.claim(first)));waiting=b.send(c.claim(first));await c.blocked(a,b);await a.send('COMMIT;');
  assert.equal(JSON.parse(await waiting).generation_state,'in_progress');await b.send('COMMIT;');
  assert.notEqual(takeover.generation_claim_token,winner.generation_claim_token);assert.throws(()=>write(first,winner.generation_claim_token),/unavailable or mismatched/);
  pass('expired takeover race issues one new token and fences the old worker');
  const generated=c.target('SELECT clock_timestamp();'),duplicate=c.session();
  await a.begin();await duplicate.begin();const published=JSON.parse(await a.send(c.publish(first,takeover.generation_claim_token,{generated:quote(generated)})));
  const rejectedDuplicate=duplicate.send(c.publish(first,takeover.generation_claim_token,{generated:quote(generated),distance:1001})).then(()=>false,e=>/payload mismatch/.test(e.message));
  await c.blocked(a,duplicate);await a.send('COMMIT;');assert(await rejectedDuplicate);
  assert.equal(c.target(`SELECT count(*) FROM private.requester_route_evidence WHERE movement_need_id=${quote(first.need)};`),'1');
  assert.equal(c.target(`SELECT completed_route_evidence_id FROM private.requester_route_generation_claims WHERE movement_need_id=${quote(first.need)};`),published.route_evidence_id);
  pass('concurrent publication commits evidence and completion once; changed replay rejects');
  // A failed replacement must preserve both the old evidence and claim state.
  c.target(`UPDATE private.requester_route_evidence SET status='superseded' WHERE id=${quote(old.route_evidence_id)};`);
  const repl=acquire(replacement);assert.equal(repl.generation_state,'claimed');
  assert.throws(()=>write(replacement,repl.generation_claim_token,{distance:-1,reference:'replacement'}),/23514/);
  assert.equal(c.target(`SELECT count(*) FROM private.requester_route_evidence WHERE movement_need_id=${quote(replacement.need)};`),'1');
  const newEvidence=write(replacement,repl.generation_claim_token,{reference:'replacement'});assert.equal(newEvidence.route_evidence_version,2);
  assert.equal(c.target(`SELECT status FROM private.requester_route_evidence WHERE id=${quote(old.route_evidence_id)};`),'superseded');pass('failed replacement preserves history; successful replacement allocates version two');
  const staleReplacement=acquire(stale);assert.equal(staleReplacement.generation_state,'claimed');
  assert.throws(()=>write(stale,staleReplacement.generation_claim_token,{distance:-1,reference:'fresh'}),/23514/);
  assert.equal(c.target(`SELECT status FROM private.requester_route_evidence WHERE id=${quote(staleEvidence.route_evidence_id)};`),'current');
  const freshEvidence=write(stale,staleReplacement.generation_claim_token,{reference:'fresh'});assert.equal(freshEvidence.route_evidence_version,2);
  assert.equal(c.target(`SELECT status FROM private.requester_route_evidence WHERE id=${quote(staleEvidence.route_evidence_id)};`),'superseded');pass('old current evidence superseded only by successful atomic publication');
  // A valid row may be introduced by another trusted authority while work is
  // outstanding. Publication reuses it rather than attesting discarded payload.
  const appeared=c.fresh(),appearedClaim=acquire(appeared);
  const appearedId=c.target(`INSERT INTO private.requester_route_evidence(movement_need_id,requesting_member_id,origin_location_reference_id,destination_location_reference_id,version,evidence_schema_version,provider_namespace,provider_product,provider_version,provider_route_reference,route_shape_format,route_shape,route_distance_meters,route_duration_seconds,generated_at)
    VALUES(${quote(appeared.need)},${quote(appeared.member)},${quote(appeared.origin)},${quote(appeared.destination)},1,'requester_route_evidence_v1','test-requester','directions','profile-undecided-v1','appeared','geojson_linestring_v1','{"type":"LineString","coordinates":[[3.4,6.4],[3.5,6.5]]}',1000,300,clock_timestamp()) RETURNING id;`);
  assert.equal(acquire(appeared).generation_state,'reuse_existing');
  const reused=write(appeared,appearedClaim.generation_claim_token);assert.equal(reused.publication_state,'reuse_existing');assert.equal(reused.route_evidence_id,appearedId);
  assert.deepEqual(write(appeared,appearedClaim.generation_claim_token),reused);pass('evidence appearing during work wins acquisition and publication; reuse completion replays');
  // Call the reuse helper directly, with no caller-owned context locks. Its
  // evidence lock must not prevent the need owner from locking that evidence.
  await a.begin();await b.begin();await a.send(`SELECT id FROM public.movement_needs WHERE id=${quote(appeared.need)} FOR UPDATE;`);
  waiting=b.send(`SELECT private.reusable_requester_route_evidence(${quote(appeared.need)},'test-requester','directions','profile-undecided-v1','requester_route_evidence_v1','geojson_linestring_v1');`);await c.blocked(a,b);
  await a.send(`SELECT id FROM private.requester_route_evidence WHERE id=${quote(appearedId)} FOR UPDATE;`);
  await a.send('COMMIT;');assert.equal(await waiting,appearedId);await b.send('COMMIT;');pass('standalone reuse helper locks context before evidence without deadlock');
  // Prove assertion waits on the parent before taking the evidence lock. With
  // the old evidence-first assertion, the next evidence lock would deadlock.
  await a.begin();await b.begin();await a.send(`SELECT id FROM public.movement_needs WHERE id=${quote(appeared.need)} FOR UPDATE;`);
  waiting=b.send(`SELECT private.assert_requester_route_evidence(${quote(appearedId)});`);await c.blocked(a,b);
  await a.send(`SELECT id FROM private.requester_route_evidence WHERE id=${quote(appearedId)} FOR UPDATE;`);
  await a.send('COMMIT;');await waiting;await b.send('COMMIT;');pass('assertion genuinely locks need before evidence without deadlock');
  // Validation must reread lifecycle after waiting, not accept a stale snapshot.
  const rejecting=c.session();await a.begin();await rejecting.begin();
  await a.send(`SELECT id FROM public.movement_needs WHERE id=${quote(appeared.need)} FOR UPDATE;`);
  const rejected=rejecting.send(`SELECT private.assert_requester_route_evidence(${quote(appearedId)});`).then(()=>false,e=>/not current and unexpired/.test(e.message));
  await c.blocked(a,rejecting);await a.send(`UPDATE private.requester_route_evidence SET status='superseded' WHERE id=${quote(appearedId)}; COMMIT;`);
  assert(await rejected);pass('assertion waiting on need rechecks evidence and rejects supersession');
  const expiring=c.fresh({expiry:"clock_timestamp()+interval '15 seconds'"}),expiringClaim=acquire(expiring),publisher=c.session();
  await a.begin();await publisher.begin();await a.send(`SELECT id FROM public.movement_needs WHERE id=${quote(expiring.need)} FOR UPDATE;`);
  const expiredWrite=publisher.send(c.publish(expiring,expiringClaim.generation_claim_token)).then(()=>false,e=>/endpoints unavailable or stale/.test(e.message));
  await c.blocked(a,publisher);
  while(c.target(`SELECT expires_at<=clock_timestamp() FROM private.movement_location_references WHERE id=${quote(expiring.origin)};`)!=='t')await delay(250);
  await a.send('COMMIT;');assert(await expiredWrite);
  assert.equal(c.target(`SELECT count(*) FROM private.requester_route_evidence WHERE movement_need_id=${quote(expiring.need)};`),'0');pass('endpoint expiry while publication waits fails closed without evidence');
  // Corrupted privileged fixture: no application role can perform these writes.
  const corrupt=c.fresh(),corruptClaim=acquire(corrupt),corruptEvidence=write(corrupt,corruptClaim.generation_claim_token);
  c.target(`ALTER TABLE private.requester_route_evidence DISABLE TRIGGER USER; UPDATE private.requester_route_evidence SET route_shape='{"type":"Point","coordinates":[3.4,6.4]}' WHERE id=${quote(corruptEvidence.route_evidence_id)}; ALTER TABLE private.requester_route_evidence ENABLE TRIGGER USER;`);
  assert.throws(()=>acquire(corrupt),/23514/);pass('malformed current evidence fails closed without replacement');
  assert(!/40P01|deadlock detected/.test(a.err+b.err));
});console.log(`0093 concurrency/recovery: ${checks}/${checks} passed`);}
module.exports={main};
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
