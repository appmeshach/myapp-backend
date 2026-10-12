'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createRequesterGeographicSupportHandler}=require('../functions/_shared/requester-geographic-support-orchestration.ts');
const {createRequesterRouteGenerationHandler}=require('../functions/_shared/requester-route-orchestration.ts');
const {ASSESSMENT_VERSION,parameterFingerprint,emptyResult}=require('../functions/_shared/shared-segment-assessment-contracts.ts');
const {REQUESTER_ROUTE_CONTRACT:contract}=require('../functions/_shared/requester-route-contracts.ts');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const member=id(1),need=id(2),availability=id(3);
const request=(body={movementNeedId:need,availabilityId:availability},options={})=>new Request('https://edge.invalid/prepare'+(options.query||''),{
 method:options.method||'POST',headers:{'Content-Type':'application/json',...(options.auth===false?{}:{Authorization:'Bearer user-jwt'}),...options.headers},
 ...(options.method==='GET'||options.method==='OPTIONS'?{}:{body:JSON.stringify(body)}),signal:options.signal});
async function hit(geographicResult='inconclusive',reason){return {state:'assessment_reuse',assessment:{lookup_state:'reuse_existing',assessment_id:id(8),algorithm_version:ASSESSMENT_VERSION,parameter_fingerprint:await parameterFingerprint(),
 canonical_result:{...emptyResult(),assessmentState:reason?'assessment_unavailable':'complete',geographicResult:reason?null:geographicResult,reasons:reason?[reason]:[]}}};}
function fixture(overrides={},prepare=async()=>Response.json({state:'reuse_existing'})){
 const calls=[];const backend={authenticate:async()=>member,memberExists:async()=>true,authorize:async()=>true,
 register:async()=>({state:'job_registered',job_id:id(7),status:'pending',attempt_count:0}),...overrides};
 for(const k of Object.keys(backend)){const fn=backend[k];backend[k]=async(...args)=>{calls.push([k,...args]);return fn(...args);};}
 const handler=createRequesterGeographicSupportHandler(backend,async r=>{calls.push(['prepare',await r.clone().json()]);return prepare(r);});
 return {calls,backend,handler};
}
test('selected authorization precedes unchanged 0094 operation and selected revalidation precedes registration',async()=>{
 const f=fixture();assert.deepEqual(await (await f.handler(request())).json(),{geographicSupport:'pending'});
 assert.deepEqual(f.calls.map(c=>c[0]),['authenticate','memberExists','authorize','prepare','authorize','register']);
 assert.deepEqual(f.calls.find(c=>c[0]==='prepare')[1],{movementNeedId:need});
 assert.deepEqual(f.calls.find(c=>c[0]==='register').slice(1,4),[member,need,availability]);
});
for(const state of ['generated','reuse_existing'])test(`0094 ${state} continues to canonical registration`,async()=>{
 const f=fixture({},async()=>Response.json({state}));assert.equal((await (await f.handler(request())).json()).geographicSupport,'pending');
 assert.equal(f.calls.filter(c=>c[0]==='register').length,1);
});
test('0094 in_progress is pending with bounded hint and zero registration',async()=>{
 const f=fixture({},async()=>Response.json({state:'in_progress',retryAfterSeconds:12},{status:409}));
 assert.deepEqual(await (await f.handler(request())).json(),{geographicSupport:'pending',retryAfterSeconds:12});assert(!f.calls.some(c=>c[0]==='register'));
});
for(const state of ['provider_response_invalid','route_generation_unavailable','unsupported_evidence','route_rate_limited'])test(`${state} stays unavailable, never inconclusive`,async()=>{
 const f=fixture({},async()=>Response.json({state},{status:503}));assert.deepEqual(await (await f.handler(request())).json(),{geographicSupport:'unavailable'});assert(!f.calls.some(c=>c[0]==='register'));
});
for(const state of ['geometric_corridor_support','overlap_observed','inconclusive'])test(`exact assessment ${state} exposes one coarse field`,async()=>{
 const f=fixture({register:async()=>hit(state)}),r=await f.handler(request());assert.equal(r.status,200);assert.deepEqual(await r.json(),{geographicSupport:state});
});
for(const reason of ['processing_limit','calculation_failed'])test(`${reason} is unavailable, never inconclusive`,async()=>{
 const f=fixture({register:async()=>hit(null,reason)});assert.deepEqual(await (await f.handler(request())).json(),{geographicSupport:'unavailable'});
});
for(const status of ['pending','running','failed','stale','expired'])test(`canonical job ${status} maps without private identifiers`,async()=>{
 const f=fixture({register:async()=>({state:'job_registered',job_id:id(7),status,attempt_count:3})});
 assert.deepEqual(await (await f.handler(request())).json(),{geographicSupport:['pending','running'].includes(status)?'pending':'unavailable'});
});
test('completed job racing registration retrieves exact current assessment once',async()=>{
 let calls=0;const f=fixture({register:async()=>++calls===1?{state:'job_registered',job_id:id(7),status:'completed',attempt_count:1}:hit()});
 assert.deepEqual(await (await f.handler(request())).json(),{geographicSupport:'inconclusive'});assert.equal(calls,2);
});
test('completed job without current assessment remains unavailable with bounded retrieval',async()=>{
 let calls=0;const f=fixture({register:async()=>{calls++;return {state:'job_registered',job_id:id(7),status:'completed',attempt_count:1};}});
 assert.deepEqual(await (await f.handler(request())).json(),{geographicSupport:'unavailable'});assert.equal(calls,2);
});
test('not_ready creates no public pending identity',async()=>{
 const f=fixture({register:async()=>({state:'not_ready'})});assert.deepEqual(await (await f.handler(request())).json(),{geographicSupport:'unavailable'});
});
for(const stage of ['before','after','in_progress'])test(`selection invalidation ${stage} prevents registration/provider stages`,async()=>{
 let count=0;const f=fixture({authorize:async()=>stage!=='before'&&++count===1},async()=>Response.json(stage==='in_progress'?{state:'in_progress',retryAfterSeconds:1}:{state:'generated'},{status:stage==='in_progress'?409:200}));
 assert.deepEqual(await (await f.handler(request())).json(),{geographicSupport:'unavailable'});
 assert(!f.calls.some(c=>c[0]==='register'));if(stage==='before')assert(!f.calls.some(c=>c[0]==='prepare'));
});
for(const key of ['offererId','intentId','evidenceId','assessmentId','jobId','geometry','coordinates','providerOptions','forceRefresh','algorithmVersion','fingerprint'])test(`HTTP rejects private selector ${key} before selected/provider work`,async()=>{
 const f=fixture();assert.equal((await f.handler(request({movementNeedId:need,availabilityId:availability,[key]:'private'}))).status,400);assert(!f.calls.some(c=>['authorize','prepare','register'].includes(c[0])));
});
for(const [name,body,options,status] of [['unauthenticated',{}, {auth:false},401],['missing selector',{movementNeedId:need},{},400],['malformed UUID',{movementNeedId:'bad',availabilityId:availability},{},400],['array',[],{},400],['query',undefined,{query:'?force=true'},400],['method',undefined,{method:'GET'},400],['content type',undefined,{headers:{'Content-Type':'text/plain'}},415]])test(`HTTP ${name} fails closed`,async()=>{
 const f=fixture(),r=await f.handler(request(body,options));assert.equal(r.status,status);assert.deepEqual(await r.json(),{geographicSupport:'unavailable'});assert(!f.calls.some(c=>['prepare','register'].includes(c[0])));
});
test('invalid JWT and absent membership perform zero selected/provider/job work',async()=>{
 for(const overrides of [{authenticate:async()=>null},{memberExists:async()=>false}]){const f=fixture(overrides);await f.handler(request());assert(!f.calls.some(c=>['authorize','prepare','register'].includes(c[0])));}
});
test('contract mismatch and private backend failure return generic unavailable only',async()=>{
 const f=fixture({register:async()=>{throw Error('private fingerprints geometry provider reference');}}),r=await f.handler(request());assert.equal(r.status,503);assert.deepEqual(await r.json(),{geographicSupport:'unavailable'});
});
test('pending hint is never accepted from malformed generation responses',async()=>{
 for(const retryAfterSeconds of [0,31,1.5,'1']){const f=fixture({},async()=>Response.json({state:'in_progress',retryAfterSeconds},{status:409}));assert.deepEqual(await (await f.handler(request())).json(),{geographicSupport:'unavailable'});}
});
test('request abort after route completion prevents registration',async()=>{
 const controller=new AbortController(),f=fixture({},async()=>{controller.abort();return Response.json({state:'generated'});});
 assert.deepEqual(await (await f.handler(request(undefined,{signal:controller.signal}))).json(),{geographicSupport:'unavailable'});assert(!f.calls.some(c=>c[0]==='register'));
});
test('first candidate admits one mocked 0094 provider; repeat and second candidate reuse the same requester route',async()=>{
 let ready=false,providers=0,claims=0,quota=0,jobs=0;const now=Date.now(),lease=new Date(now+30000).toISOString();
 const routeBackend={authenticate:async()=>member,memberExists:async()=>true,isCurrentNeed:async()=>true,
 claim:async()=>{claims++;return ready?{state:'reuse_existing',evidenceId:id(9),evidenceVersion:1}:{state:'claimed',token:id(4),originId:id(5),destinationId:id(6),leaseExpiresAt:lease};},
 context:async()=>({movementNeedId:need,memberId:member,originId:id(5),destinationId:id(6),origin:{longitude:3.4,latitude:6.4},destination:{longitude:3.5,latitude:6.5},leaseExpiresAt:lease,serverObservedAt:new Date().toISOString(),evidenceExpiresAt:new Date(now+60000).toISOString()}),
 consumeRouteProviderQuota:async()=>{quota++;return {admitted:true,retryAfterSeconds:0};},publish:async()=>{ready=true;return {state:'published',evidenceId:id(9),evidenceVersion:1};}};
 const provider={isAvailable:()=>true,route:async()=>{providers++;return {...contract,providerRouteReference:'mock:0',routeShape:{type:'LineString',coordinates:[[3.4,6.4],[3.5,6.5]]},snappedWaypoints:[{longitude:3.4,latitude:6.4},{longitude:3.5,latitude:6.5}],routeDistanceMeters:1000,routeDurationSeconds:300,generatedAt:new Date().toISOString(),expiresAt:null};}};
 const f=fixture({register:async()=>{jobs++;return {state:'job_registered',job_id:id(7),status:'pending',attempt_count:0};}},createRequesterRouteGenerationHandler(routeBackend,provider));
 await f.handler(request());assert.equal(providers,1);await f.handler(request());assert.equal(providers,1);await f.handler(request({movementNeedId:need,availabilityId:id(10)}));
 assert.equal(providers,1);assert.equal(quota,1);assert.equal(claims,3);assert.equal(jobs,3);
});
test('public Edge dependency graph has no geometry engine or local producer execution',()=>{
 const visited=new Set();function walk(file){file=path.resolve(file);if(visited.has(file))return;visited.add(file);const source=fs.readFileSync(file,'utf8');
 assert.doesNotMatch(source,/shared-segment-assessment-geometry|calculateIsolated|getOrProduceSharedSegmentAssessment|assessment-worker/);
 for(const match of source.matchAll(/import\s+(?!type\b)[^;]*?from\s+['"](\.[^'"]+)['"]/g))walk(path.resolve(path.dirname(file),match[1]));}
 walk('supabase/functions/prepare-requester-geographic-support/index.ts');
 const entry=fs.readFileSync('supabase/functions/prepare-requester-geographic-support/index.ts','utf8');assert.doesNotMatch(entry,/\.claim\(|\.finalize\(|\.load\(/);
 assert.match(fs.readFileSync('supabase/config.toml','utf8'),/\[functions.prepare-requester-geographic-support\]\s+enabled = true\s+verify_jwt = true/);
});
