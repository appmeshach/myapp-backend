'use strict';
const assert=require('node:assert/strict');
const {run}=require('./0094_requester_route_generation_context_harness.cjs');
const {quote,delay}=require('./0093_requester_route_generation_claim_boundary_harness.cjs');
async function main(){let checks=0;await run(async c=>{
  const pass=name=>{checks++;console.log('PASS '+name);};
  // Shared parent locks must precede claim locks, including standalone calls.
  const f=c.fresh(),claim=c.acquire(f),a=c.session(),b=c.session();
  await a.begin();await b.begin();
  await a.send(`SELECT id FROM public.movement_needs WHERE id=${quote(f.need)} FOR UPDATE;`);
  let waiting=b.send(c.context(f,claim.generation_claim_token));await c.blocked(a,b);
  await a.send(`SELECT movement_need_id FROM private.requester_route_generation_claims WHERE movement_need_id=${quote(f.need)} FOR UPDATE; COMMIT;`);
  assert.equal(JSON.parse(await waiting).movement_need_id,f.need);await b.send('COMMIT;');pass('standalone context waits on need before claim; no deadlock');
  // A completion committed during that wait must be observed by READ COMMITTED.
  const completed=c.fresh(),completedClaim=c.acquire(completed),reader=c.session();
  await a.begin();await reader.begin();
  await a.send(`SELECT id FROM public.movement_needs WHERE id=${quote(completed.need)} FOR UPDATE;`);
  waiting=reader.send(c.context(completed,completedClaim.generation_claim_token)).then(()=>false,e=>/23514/.test(e.message));await c.blocked(a,reader);
  await a.send(c.publish(completed,completedClaim.generation_claim_token,{namespace:'mapbox-directions-v5',product:'mapbox-directions',version:'v5-driving-geojson-full-v1'}));await a.send('COMMIT;');assert(await waiting);pass('completed claim after real wait rejects stale context');
  const expiring=c.fresh({expiry:"clock_timestamp()+interval '15 seconds'"}),expiringClaim=c.acquire(expiring),expiryReader=c.session();
  await a.begin();await expiryReader.begin();await a.send(`SELECT id FROM public.movement_needs WHERE id=${quote(expiring.need)} FOR UPDATE;`);
  waiting=expiryReader.send(c.context(expiring,expiringClaim.generation_claim_token)).then(()=>false,e=>/23514/.test(e.message));await c.blocked(a,expiryReader);
  assert.equal(c.target(`SELECT expires_at>clock_timestamp() FROM private.movement_location_references WHERE id=${quote(expiring.origin)};`),'t','endpoint must still be live at blocking barrier');
  while(c.target(`SELECT expires_at<=clock_timestamp() FROM private.movement_location_references WHERE id=${quote(expiring.origin)};`)!=='t')await delay(100);
  await a.send('COMMIT;');assert(await waiting);pass('endpoint expiry during lock wait is rechecked');
  const deadline=c.fresh();c.target(`UPDATE public.movement_needs SET earliest_departure_at=clock_timestamp()+interval '15 seconds' WHERE id=${quote(deadline.need)};`);
  const deadlineClaim=c.acquire(deadline),deadlineReader=c.session();await a.begin();await deadlineReader.begin();await a.send(`SELECT id FROM public.movement_needs WHERE id=${quote(deadline.need)} FOR UPDATE;`);
  waiting=deadlineReader.send(c.context(deadline,deadlineClaim.generation_claim_token)).then(()=>false,e=>/23514/.test(e.message));await c.blocked(a,deadlineReader);
  assert.equal(c.target(`SELECT earliest_departure_at>clock_timestamp() FROM public.movement_needs WHERE id=${quote(deadline.need)};`),'t','departure must still be live at blocking barrier');
  while(c.target(`SELECT earliest_departure_at<=clock_timestamp() FROM public.movement_needs WHERE id=${quote(deadline.need)};`)!=='t')await delay(100);
  await a.send('COMMIT;');assert(await waiting);pass('departure deadline during wait is rechecked');
  const expired=c.fresh(),expiredClaim=c.acquire(expired);
  const lease=c.fresh(),leaseClaim=c.acquire(lease),leaseReader=c.session();await a.begin();await leaseReader.begin();await a.send(`SELECT id FROM public.movement_needs WHERE id=${quote(lease.need)} FOR UPDATE;`);
  waiting=leaseReader.send(c.context(lease,leaseClaim.generation_claim_token)).then(()=>false,e=>/23514/.test(e.message));await c.blocked(a,leaseReader);
  console.log('Waiting for actual fixed 30-second lease expiry');
  while(c.target(`SELECT lease_expires_at<=clock_timestamp() FROM private.requester_route_generation_claims WHERE movement_need_id=${quote(lease.need)};`)!=='t')await delay(250);
  // This owner can take over while the stale worker remains blocked on need.
  const takeover=JSON.parse(await a.send(c.claim(lease,{namespace:'mapbox-directions-v5',product:'mapbox-directions',version:'v5-driving-geojson-full-v1'})));await a.send('COMMIT;');assert(await waiting);assert.notEqual(takeover.generation_claim_token,leaseClaim.generation_claim_token);pass('takeover during need wait fences stale token');
  assert.throws(()=>c.target(c.context(lease,leaseClaim.generation_claim_token)),/23514/);pass('old token cannot read replacement context');
  assert.equal(JSON.parse(c.target(c.context(lease,takeover.generation_claim_token))).movement_need_id,lease.need);pass('replacement token reads fresh context');
  console.log('Checking actual uncompleted lease expiry');
  while(c.target(`SELECT lease_expires_at<=clock_timestamp() FROM private.requester_route_generation_claims WHERE movement_need_id=${quote(expired.need)};`)!=='t')await delay(250);
  assert.throws(()=>c.target(c.context(expired,expiredClaim.generation_claim_token)),/23514/);pass('expired incomplete claim cannot read context even without takeover');
  const isolated=c.session();await isolated.begin();await isolated.send('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;');assert(await isolated.send(c.context(lease,takeover.generation_claim_token)).then(()=>false,e=>/25000/.test(e.message)));pass('repeatable read rejects before snapshot-dependent validation');
  assert(!/40P01|deadlock detected/.test(a.err+b.err));
});console.log(`0094 concurrency: ${checks}/${checks} passed`);}
module.exports={main};if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
