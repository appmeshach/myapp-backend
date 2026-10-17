'use strict';
const assert=require('node:assert/strict');
const {run,matchingFixture,context}=require('./0095_requester_deadline_matching_context_repair_harness.cjs');
const {delay}=require('./0093_requester_route_generation_claim_boundary_harness.cjs');
async function main(){let checks=0;await run(async c=>{
 for(const [label,table,id] of [['need','public.movement_needs','need'],['intent','private.offering_movement_intents','intent'],['route','private.offering_route_evidence','route']]){
  const f=matchingFixture(c),a=c.session(),b=c.session();
  c.target(`UPDATE public.movement_needs SET earliest_departure_at=clock_timestamp()+interval '8 seconds',latest_departure_at=NULL WHERE id='${f.need}';`);
  await a.begin();await b.begin();await a.send(`SELECT id FROM ${table} WHERE id='${f[id]}' FOR UPDATE;`);
  const waiting=b.send(context(f)).then(()=>({ok:true}),e=>({ok:false,error:e.message}));
  await c.blocked(a,b);
  assert.equal(c.target(`SELECT earliest_departure_at>clock_timestamp() FROM public.movement_needs WHERE id='${f.need}';`),'t');checks++;console.log('PASS '+label+' actual blocking starts before deadline');
  while(c.target(`SELECT earliest_departure_at<=clock_timestamp() FROM public.movement_needs WHERE id='${f.need}';`)!=='t')await delay(100);
  await a.send('COMMIT;');const result=await waiting;assert(!result.ok);assert.match(result.error,/23514/);assert.match(result.error,/Movement need is not available for matching/);
  checks++;console.log('PASS '+label+' wait crossing deadline rejects with established error');
 }
 const f=matchingFixture(c),a=c.session(),b=c.session();await a.begin();await b.begin();
 await a.send(`SELECT id FROM private.offering_movement_intents WHERE id='${f.intent}' FOR UPDATE;`);
 const waiting=b.send(context(f));await c.blocked(a,b);await a.send('COMMIT;');assert.equal(JSON.parse(await waiting).movement_need_id,f.need);await b.send('COMMIT;');
 checks++;console.log('PASS live requester survives real intent wait');
});console.log(`0095 genuine concurrency: ${checks}/${checks} passed`);}
module.exports={main};if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
