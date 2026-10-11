'use strict';
const assert=require('node:assert/strict');
const h=require('./0098_current_route_match_reuse_boundary_harness.cjs');
const {delay}=require('./0093_requester_route_generation_claim_boundary_harness.cjs');
async function main(){let count=0;await h.run(async c=>{
 const f=h.fixture(c),a=c.session(),b=c.session();
 const misses=await Promise.all([a.send(h.lookup(f)),b.send(h.lookup(f))]);for(const miss of misses)assert.equal(JSON.parse(miss).state,'not_found');
 const first=h.payload(c,f),second=h.payload(c,f);assert.notEqual(first.payload.calculatedAt,second.payload.calculatedAt);
 // Hold the actual first publication transaction open to prove serialization.
 await a.begin();await b.begin();const won=JSON.parse(await a.send(h.publish(f,first)));
 const waiting=b.send(h.publish(f,second));await c.blocked(a,b);await a.send('COMMIT;');const reused=JSON.parse(await waiting);await b.send('COMMIT;');
 assert.deepEqual(reused,won);assert.equal(c.target(`SELECT count(*) FROM private.trusted_route_match_evidence WHERE movement_need_id='${f.need}';`),'1');count++;console.log('PASS genuine simultaneous misses, two calculations/timestamps, blocked second publication, one canonical row');
 for(const mode of ['route','availability','deadline','evidence-expiry']){
  const x=h.fixture(c),s=h.payload(c,x),lock=c.session(),reader=c.session();
  if(mode==='evidence-expiry'){
   c.target(h.publish(x,s));
   // Administrator-only shortened expiry fixture in the disposable clone.
   // The wait below crosses the actual persisted database wall-clock expiry.
   c.target(`BEGIN; ALTER TABLE private.trusted_route_match_evidence DISABLE TRIGGER USER;
    UPDATE private.trusted_route_match_evidence SET expires_at=clock_timestamp()+interval '20 seconds' WHERE movement_need_id='${x.need}';
    ALTER TABLE private.trusted_route_match_evidence ENABLE TRIGGER USER; COMMIT;`);
  }
  await lock.begin();await reader.begin();await lock.send(`SELECT id FROM private.offering_movement_intents WHERE id='${x.intent}' FOR UPDATE;`);
  if(mode==='deadline')await lock.send(`UPDATE public.movement_needs SET earliest_departure_at=clock_timestamp()+interval '2 seconds',latest_departure_at=NULL WHERE id='${x.need}';`);
  const pending=reader.send(mode==='evidence-expiry'?h.lookup(x):h.publish(x,s)).then(v=>({ok:true,value:JSON.parse(v)}),e=>({ok:false,error:e.message}));
  await c.blocked(lock,reader);
  if(mode==='route')await lock.send(`UPDATE private.offering_route_evidence SET status='superseded' WHERE id='${x.route}';`);
  if(mode==='availability')await lock.send(`UPDATE private.offering_movement_availability SET status='withdrawn' WHERE id='${x.availability}';`);
  if(mode==='evidence-expiry'){
   assert.equal(c.target(`SELECT expires_at>clock_timestamp() FROM private.trusted_route_match_evidence WHERE movement_need_id='${x.need}';`),'t');
   while(c.target(`SELECT expires_at<=clock_timestamp() FROM private.trusted_route_match_evidence WHERE movement_need_id='${x.need}';`)!=='t')await delay(100);
  }
  if(mode==='deadline')await delay(2200);
  await lock.send('COMMIT;');const result=await pending;
  if(mode==='evidence-expiry'){assert(result.ok);assert.equal(result.value.state,'not_found');await reader.send('COMMIT;');}
  else{assert(!result.ok);assert.match(result.error,/23514/);assert(!/40P01/.test(result.error));}
  count++;console.log('PASS actual lock wait revalidates '+mode+' change');
 }
 const appeared=h.fixture(c),s=h.payload(c,appeared);assert.equal(JSON.parse(c.target(h.lookup(appeared))).state,'not_found');
 c.target(h.publish(appeared,s));const another={...s,payload:{...s.payload,calculatedAt:new Date().toISOString()}};
 assert.deepEqual(JSON.parse(c.target(h.publish(appeared,another))),JSON.parse(c.target(h.lookup(appeared))));count++;console.log('PASS current row appearing between miss and publication converges');
 const deadlocks=Number(c.target(`SELECT deadlocks FROM pg_stat_database WHERE datname='${c.db}';`));assert.equal(deadlocks,0);
 });console.log(`0098 genuine PostgreSQL concurrency: ${count}/${count} passed; zero deadlocks`);}
module.exports={main};if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
