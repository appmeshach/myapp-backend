'use strict';
// Actual trusted SQL boundaries in schema-only, fingerprinted disposable clones.
// The provider is an in-memory mock; there is no outbound provider transport.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),http=require('node:http');
const h=require('./0099_shared_segment_assessment_job_foundation_harness.cjs');
const a=require('./0096_trusted_shared_segment_geographic_assessment_harness.cjs');
const {quote}=require('./0093_requester_route_generation_claim_boundary_harness.cjs');
const {createRequesterGeographicSupportHandler}=require('../functions/_shared/requester-geographic-support-orchestration.ts');
const {createRequesterGeographicBackend}=require('../functions/_shared/requester-geographic-support-runtime.ts');
const {createRequesterRouteBackend}=require('../functions/_shared/requester-route-runtime.ts');
const {createRequesterRouteGenerationHandler}=require('../functions/_shared/requester-route-orchestration.ts');
const {REQUESTER_ROUTE_CONTRACT:contract}=require('../functions/_shared/requester-route-contracts.ts');
const {emptyResult}=require('../functions/_shared/shared-segment-assessment-contracts.ts');
const {assessSharedSegment}=require('../functions/_shared/shared-segment-assessment-geometry.ts');
const allowed=new Set(['get_requester_availability_matching_context_for_server','register_requester_availability_assessment_job_for_server',
 'claim_requester_route_generation_for_server','get_claimed_requester_route_generation_context_for_server',
 'record_claimed_requester_route_evidence_for_server','consume_route_provider_quota_for_server']);
const literal=v=>v===null?'NULL':typeof v==='number'?String(v):typeof v==='object'?quote(JSON.stringify(v))+'::jsonb':quote(v);
function fixtureBackend(c,f){
 let member=f.requester,providerCalls=0,registrations=0,lostPublication=false,loseNext=false;
 // Pool one autocommit SQL connection instead of spawning docker/psql per RPC.
 // This keeps process startup outside the production handler's fixed I/O budgets.
 let session=c.session();
 const fetcher=async(url,options={})=>{
  options.signal?.throwIfAborted();const u=new URL(url);
  if(u.pathname==='/auth/v1/user')return Response.json({id:member,role:'authenticated'});
  if(u.pathname==='/rest/v1/members')return Response.json([{id:member}]);
  const name=u.pathname.split('/').at(-1),args=JSON.parse(options.body);
  if(name==='get_my_current_movement_need')return Response.json([{movement_need_id:f.need}]);
  assert(allowed.has(name),'Unexpected RPC '+name);
  if(name==='register_requester_availability_assessment_job_for_server')registrations++;
  const call=`public.${name}(${Object.entries(args).map(([k,v])=>`${k}=>${literal(v)}`).join(',')})`;
  try {
   const sql=name==='register_requester_availability_assessment_job_for_server'?`SELECT ${call};`:`SELECT coalesce(json_agg(x),'[]'::json) FROM ${call} x;`;
   const result=JSON.parse(await session.send("SET ROLE service_role; SET statement_timeout='4s'; "+sql));
   if(loseNext&&name==='record_claimed_requester_route_evidence_for_server'){loseNext=false;lostPublication=true;throw Error('lost response after COMMIT');}
   return Response.json(result);
  }catch(error){if(session.closed)session=c.session();if(lostPublication&&String(error.message).includes('lost response'))throw error;return Response.json({message:'Unavailable'},{status:400});}
 };
 const provider={isAvailable:()=>true,route:async({origin,destination})=>{providerCalls++;
  assert.equal(await session.send("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction';"),'0','No transaction spans mocked provider work');
  return {...contract,providerRouteReference:'mock:'+crypto.randomUUID(),
  routeShape:{type:'LineString',coordinates:[[origin.longitude,origin.latitude],[destination.longitude,destination.latitude]]},snappedWaypoints:[origin,destination],
  routeDistanceMeters:1000,routeDurationSeconds:300,generatedAt:new Date().toISOString(),expiresAt:null};}};
 const backend=createRequesterGeographicBackend('http://localhost:54321','service-test-key',fetcher);
 const prepare=createRequesterRouteGenerationHandler(createRequesterRouteBackend('http://localhost:54321','service-test-key',fetcher),provider);
 const handler=createRequesterGeographicSupportHandler(backend,prepare);
 const request=(availability=f.availability,need=f.need,extra={})=>new Request('http://localhost/prepare',{method:'POST',headers:{Authorization:'Bearer mock-user-jwt','Content-Type':'application/json'},body:JSON.stringify({movementNeedId:need,availabilityId:availability,...extra})});
 return {handler,request,backend,setMember:v=>{member=v;},loseNext:()=>{loseNext=true;},counts:()=>({providerCalls,registrations,lostPublication})};
}
async function main(){let count=0;await h.run(async c=>{
 const check=(label,fn)=>{fn();count++;console.log('PASS '+label);};
 const f=h.fixture(c,{requesterReady:false}),b=fixtureBackend(c,f);
 b.loseNext();let response=await b.handler(b.request());let body=await response.json();
 if(body.geographicSupport!=='pending')console.log('Fixture control result: '+JSON.stringify({...b.counts(),body}));
 check('actual 0046 selected auth then 0094 claim/quota/mock provider/publication with lost COMMIT response recovery',()=>{assert.equal(response.status,200);assert.deepEqual(body,{geographicSupport:'pending'});assert.equal(b.counts().providerCalls,1);assert(b.counts().lostPublication);});
 const jobs=()=>c.target(`SELECT count(*) FROM private.shared_segment_assessment_jobs WHERE movement_need_id='${f.need}';`);
 const first=c.target(`SELECT id FROM private.shared_segment_assessment_jobs WHERE movement_need_id='${f.need}';`);
 response=await b.handler(b.request());body=await response.json();
 check('same selected pair reuses requester route and one canonical pending job',()=>{assert.deepEqual(body,{geographicSupport:'pending'});assert.equal(jobs(),'1');assert.equal(b.counts().providerCalls,1);assert.equal(c.target(`SELECT id FROM private.shared_segment_assessment_jobs WHERE movement_need_id='${f.need}';`),first);});
 const job=h.get(c,h.claim());
 check('one actual claimed job reports public pending without a job ID',()=>assert.equal(job.job_id,first));
 body=await (await b.handler(b.request())).json();check('running canonical job is pending without provider work',()=>{assert.deepEqual(body,{geographicSupport:'pending'});assert.equal(b.counts().providerCalls,1);});
 const loaded=h.get(c,h.load(job));const limit={...emptyResult(),assessmentState:'assessment_unavailable',reasons:['processing_limit']};
 h.get(c,h.finalize(job,loaded.snapshot.context,limit));const attempts=c.target(`SELECT attempt_count FROM private.shared_segment_assessment_jobs WHERE id='${first}';`);
 body=await (await b.handler(b.request())).json();
 check('persisted processing_limit returns unavailable with zero new jobs or provider calls',()=>{assert.deepEqual(body,{geographicSupport:'unavailable'});assert.equal(jobs(),'1');assert.equal(b.counts().providerCalls,1);assert.equal(c.target(`SELECT attempt_count FROM private.shared_segment_assessment_jobs WHERE id='${first}';`),attempts);});
 const second=h.fixture(c);body=await (await b.handler(b.request(second.availability))).json();
 check('second selected candidate for same need reuses requester route and creates only its canonical job',()=>{assert.deepEqual(body,{geographicSupport:'pending'});assert.equal(b.counts().providerCalls,1);assert.equal(jobs(),'2');});
 const stale=h.get(c,h.claim());h.get(c,h.fail(stale,'contract_mismatch'));
 body=await (await b.handler(b.request(second.availability))).json();
 check('terminal stale job remains unavailable and participant retry cannot reset its attempt',()=>{assert.deepEqual(body,{geographicSupport:'unavailable'});assert.equal(c.target(`SELECT status||':'||attempt_count FROM private.shared_segment_assessment_jobs WHERE id='${stale.job_id}';`),'stale:1');assert.equal(jobs(),'2');assert.equal(b.counts().providerCalls,1);});
 const ready=h.fixture(c),rb=fixtureBackend(c,ready),snapshot=h.get(c,a.context(ready));
 const current=assessSharedSegment(snapshot.offerer_shape,snapshot.requester_shape);assert.equal(current.assessmentState,'complete');h.get(c,a.publish(ready,snapshot,current));
 body=await (await rb.handler(rb.request())).json();check('exact current completed assessment creates zero jobs and uses zero providers',()=>{assert.deepEqual(body,{geographicSupport:current.geographicResult});assert.equal(c.target(`SELECT count(*) FROM private.shared_segment_assessment_jobs WHERE movement_need_id='${ready.need}';`),'0');assert.equal(rb.counts().providerCalls,0);});
 const invalid=h.fixture(c,{requesterReady:false}),ib=fixtureBackend(c,invalid);ib.setMember(f.requester);
 body=await (await ib.handler(ib.request())).json();check('wrong authenticated requester denied before real provider/job work',()=>{assert.deepEqual(body,{geographicSupport:'unavailable'});assert.equal(ib.counts().providerCalls,0);assert.equal(ib.counts().registrations,0);});
 ib.setMember(invalid.requester);body=await (await ib.handler(ib.request(crypto.randomUUID()))).json();
 check('spoofed selected availability denied before provider work',()=>{assert.deepEqual(body,{geographicSupport:'unavailable'});assert.equal(ib.counts().providerCalls,0);});
 body=await (await ib.handler(ib.request(invalid.availability,crypto.randomUUID()))).json();
 check('wrong movement need denied before provider work',()=>{assert.deepEqual(body,{geographicSupport:'unavailable'});assert.equal(ib.counts().providerCalls,0);});
 c.target(`UPDATE public.movement_needs SET earliest_departure_at=clock_timestamp()+interval '3 seconds',latest_departure_at=NULL WHERE id='${invalid.need}';`);
 await new Promise(resolve=>setTimeout(resolve,3200));
 body=await (await ib.handler(ib.request())).json();
 check('expired current need rejected before requester generation or job registration',()=>{assert.deepEqual(body,{geographicSupport:'unavailable'});assert.equal(ib.counts().providerCalls,0);assert.equal(ib.counts().registrations,0);});
 const changed=h.fixture(c,{requesterReady:false}),cb=fixtureBackend(c,changed);
 const withdrawing=createRequesterGeographicSupportHandler(cb.backend,async()=>{c.target(`UPDATE private.offering_movement_availability SET status='withdrawn' WHERE id='${changed.availability}';`);return Response.json({state:'reuse_existing'});});
 body=await (await withdrawing(cb.request())).json();check('availability withdrawn between preparation and registration creates no job',()=>{assert.deepEqual(body,{geographicSupport:'unavailable'});assert.equal(cb.counts().registrations,0);});
 // Real local HTTP transport around the shipped request handler; SQL remains real.
 const server=http.createServer(async(req,res)=>{try{let raw='';for await(const part of req)raw+=part;const r=await rb.handler(new Request('http://localhost'+req.url,{method:req.method,headers:req.headers,body:raw}));res.writeHead(r.status,Object.fromEntries(r.headers));res.end(await r.text());}catch{res.writeHead(500);res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const url=`http://127.0.0.1:${server.address().port}/prepare`;const post=(value,auth=true)=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer mock-user-jwt'}:{})},body:JSON.stringify(value)});
  let r=await post({movementNeedId:ready.need,availabilityId:ready.availability});body=await r.json();check('real HTTP returns exact coarse completed body and no-store headers',()=>{assert.equal(r.status,200);assert.deepEqual(body,{geographicSupport:current.geographicResult});assert.equal(r.headers.get('Cache-Control'),'private, no-store');});
  r=await post({movementNeedId:ready.need,availabilityId:ready.availability,jobId:first});check('real HTTP rejects a private selector',()=>assert.equal(r.status,400));
  r=await post({movementNeedId:ready.need,availabilityId:ready.availability},false);check('real HTTP rejects missing authentication',()=>assert.equal(r.status,401));
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 });console.log(`0100 SQL-backed endpoint / HTTP behavior: ${count}/${count} passed`);}
module.exports={main,fixtureBackend};if(require.main===module)main().catch(error=>{console.error(error.stack);process.exitCode=1;});
