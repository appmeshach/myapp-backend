import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequesterRouteGenerationHandler,validateRequesterProviderResult} from '../functions/_shared/requester-route-orchestration.ts';
import {REQUESTER_ROUTE_CONTRACT as contract} from '../functions/_shared/requester-route-contracts.ts';
import {createMapboxDirectionsProvider} from '../functions/_shared/mapbox-directions-provider.ts';
const ids=Array.from({length:6},(_,i)=>`${i+1}`.repeat(8)+'-'+`${i+1}`.repeat(4)+'-4'+`${i+1}`.repeat(3)+'-8'+`${i+1}`.repeat(3)+'-'+`${i+1}`.repeat(12));
const [member,need,token,originId,destinationId,evidenceId]=ids;
const request=(body={movementNeedId:need},options={})=>new Request('https://edge.invalid/prepare'+(options.query??''),{method:options.method??'POST',headers:{'Content-Type':'application/json',...(options.auth===false?{}:{Authorization:'Bearer user-jwt'}),...options.headers},body:JSON.stringify(body)});
const providerResult=()=>({...contract,providerRouteReference:'response:0',routeShape:{type:'LineString',coordinates:[[3.4,6.4],[3.5,6.5]]},snappedWaypoints:[{longitude:3.4,latitude:6.4},{longitude:3.5,latitude:6.5}],routeDistanceMeters:1000,routeDurationSeconds:300,generatedAt:new Date().toISOString(),expiresAt:null});
function fixture(overrides={},providerOverrides={},budgets={}) {
  const calls=[];const now=Date.now();
  const ctx={movementNeedId:need,memberId:member,originId,destinationId,origin:{longitude:3.4,latitude:6.4},destination:{longitude:3.5,latitude:6.5},claimedAt:new Date(now-100).toISOString(),leaseExpiresAt:new Date(now+29900).toISOString(),serverObservedAt:new Date(now).toISOString(),earliestGeneratedAt:new Date(now-100).toISOString(),movementNeedDeadline:new Date(now+60000).toISOString(),evidenceExpiresAt:new Date(now+60000).toISOString()};
  const backend={authenticate:async()=>member,memberExists:async()=>true,isCurrentNeed:async()=>true,
    claim:async()=>({state:'claimed',token,originId,destinationId,leaseExpiresAt:ctx.leaseExpiresAt}),context:async()=>structuredClone(ctx),consumeRouteProviderQuota:async()=>({admitted:true,retryAfterSeconds:0}),
    publish:async()=>({state:'published',evidenceId,evidenceVersion:1}),...overrides};
  for(const key of Object.keys(backend)){const method=backend[key];backend[key]=async(...args)=>{calls.push([key,...args]);return method(...args);};}
  const provider={isAvailable:()=>true,route:async()=>providerResult(),...providerOverrides};const route=provider.route;
  provider.route=async(...args)=>{calls.push(['provider',...args]);return route(...args);};
  return {calls,ctx,backend,provider,handler:createRequesterRouteGenerationHandler(backend,provider,budgets)};
}
for(const state of ['reuse_existing','in_progress'])test(state+' consumes no quota and performs no provider/context/publication work',async()=>{
  const f=fixture({claim:async()=>state==='reuse_existing'?{state,evidenceId,evidenceVersion:1}:{state,retryAfterSeconds:12}});
  const r=await f.handler(request());assert.equal(r.status,state==='reuse_existing'?200:409);
  assert.deepEqual(await r.json(),state==='reuse_existing'?{state}:{state,retryAfterSeconds:12});
  assert(!f.calls.some(([key])=>['provider','context','consumeRouteProviderQuota','publish'].includes(key)));
});
test('claim winner uses trusted context once per need, one provider attempt, dependency expiry and frozen payload',async()=>{
  const f=fixture();const r=await f.handler(request());assert.equal(r.status,200);assert.deepEqual(await r.json(),{state:'generated'});
  assert.deepEqual(f.calls.map(c=>c[0]),['authenticate','memberExists','isCurrentNeed','claim','context','consumeRouteProviderQuota','provider','context','publish']);
  const p=f.calls.find(c=>c[0]==='publish')[1];assert.equal(p.expiresAt,f.ctx.evidenceExpiresAt);assert.equal(p.generatedAt,f.ctx.serverObservedAt);
  assert(Object.isFrozen(p)&&Object.isFrozen(p.routeShape)&&Object.isFrozen(p.routeShape.coordinates[0]));
  assert.equal(p.originId,originId);assert.equal(p.token,token);assert.match(r.headers.get('cache-control'),/private, no-store/);
});
for(const [name,body] of [['missing',{}],['malformed',{movementNeedId:'wrong'}],['coordinates',{movementNeedId:need,latitude:6}],['member',{movementNeedId:need,memberId:member}],['provider',{movementNeedId:need,providerNamespace:'x'}],['version',{movementNeedId:need,providerVersion:'x'}],['profile',{movementNeedId:need,profile:'walking'}],['token',{movementNeedId:need,claimToken:token}],['expiry',{movementNeedId:need,expiresAt:'x'}],['ranking',{movementNeedId:need,score:1}]])test('rejects client '+name+' input before claim/quota/provider',async()=>{
  const f=fixture();assert.equal((await f.handler(request(body))).status,400);assert(!f.calls.some(c=>['claim','provider','consumeRouteProviderQuota'].includes(c[0])));
});
for(const [name,options,status] of [['auth',{auth:false},401],['query',{query:'?need=x'},400],['body size',{headers:{'Content-Length':'3000'}},413],['media type',{headers:{'Content-Type':'text/plain'}},415]])test('rejects '+name,async()=>{const f=fixture();assert.equal((await f.handler(request(undefined,options))).status,status);assert(!f.calls.some(c=>c[0]==='provider'));});
test('actual oversized body rejects without declared length',async()=>{const f=fixture();assert.equal((await f.handler(request({movementNeedId:need,extra:'x'.repeat(3000)}))).status,413);});
for(const [name,overrides,status] of [['invalid auth',{authenticate:async()=>null},401],['missing membership',{memberExists:async()=>false},403],['wrong need or owner',{isCurrentNeed:async()=>false},404],['failed claim',{claim:async()=>{throw new Error('private DB error');}},503],['expired endpoint',{context:async()=>{throw new Error('stale endpoint coordinates secret');}},503]])test(name+' performs zero paid work',async()=>{const f=fixture(overrides);const r=await f.handler(request());assert.equal(r.status,status);assert(!f.calls.some(c=>['provider','consumeRouteProviderQuota'].includes(c[0])));assert(!JSON.stringify(await r.json()).includes('secret'));});
test('quota denial prevents provider work and uses shared bounded retry',async()=>{const f=fixture({consumeRouteProviderQuota:async()=>({admitted:false,retryAfterSeconds:37})});const r=await f.handler(request());assert.equal(r.status,429);assert.deepEqual(await r.json(),{state:'route_rate_limited',retryAfterSeconds:37});assert(!f.calls.some(c=>c[0]==='provider'));});
test('insufficient authoritative lease prevents quota and provider',async()=>{const f=fixture();f.ctx.leaseExpiresAt=new Date(Date.parse(f.ctx.serverObservedAt)+9000).toISOString();const r=await f.handler(request());assert.equal(r.status,503);assert(!f.calls.some(c=>['provider','consumeRouteProviderQuota'].includes(c[0])));});
test('provider timeout and late uncooperative response cannot publish',async()=>{
  const f=fixture({}, {route:async()=>{await new Promise(r=>setTimeout(r,60));return providerResult();}},{overallMs:150,bootstrapMs:100,providerMs:10,recoveryMs:20,minimumPublicationMs:10});
  const r=await f.handler(request());assert.equal(r.status,503);await new Promise(r=>setTimeout(r,70));assert.equal(f.calls.filter(c=>c[0]==='provider').length,1);assert(!f.calls.some(c=>c[0]==='publish'));
});
test('endpoint expiry after provider response publishes nothing',async()=>{let contexts=0;const f=fixture({context:async()=>{if(++contexts===2)throw new Error('endpoint expired');return structuredClone(f.ctx);}});assert.equal((await f.handler(request())).status,503);assert.equal(f.calls.filter(c=>c[0]==='provider').length,1);assert(!f.calls.some(c=>c[0]==='publish'));});
test('lost publication response replays identical frozen object and never reacquires claim/provider/quota',async()=>{
  let writes=0;const payloads=[];const f=fixture({publish:async p=>{payloads.push(p);if(++writes===1)throw new Error('response lost after commit');return {state:'published',evidenceId,evidenceVersion:1};}});
  assert.deepEqual(await (await f.handler(request())).json(),{state:'generated'});assert.equal(payloads[0],payloads[1]);
  for(const key of ['claim','provider','consumeRouteProviderQuota'])assert.equal(f.calls.filter(c=>c[0]===key).length,1);
});
for(const reason of ['lease expired','stale token','changed replay','unknown write'])test(reason+' during publication/replay never repeats provider',async()=>{const f=fixture({publish:async()=>{throw new Error(reason+' PRIVATE coordinates token');}});const r=await f.handler(request());assert.equal(r.status,503);assert.deepEqual(await r.json(),{state:'route_generation_unavailable'});assert.equal(f.calls.filter(c=>c[0]==='publish').length,2);assert.equal(f.calls.filter(c=>c[0]==='provider').length,1);assert.equal(f.calls.filter(c=>c[0]==='claim').length,1);});
test('publication can reuse evidence introduced during provider work',async()=>{const f=fixture({publish:async()=>({state:'reuse_existing',evidenceId,evidenceVersion:2})});assert.deepEqual(await (await f.handler(request())).json(),{state:'reuse_existing'});});
test('repeated invocation uses fresh evidence without a second provider request',async()=>{let claims=0;const f=fixture({claim:async()=>++claims===1?{state:'claimed',token,originId,destinationId,leaseExpiresAt:f.ctx.leaseExpiresAt}:{state:'reuse_existing',evidenceId,evidenceVersion:1}});await f.handler(request());await f.handler(request());assert.equal(f.calls.filter(c=>c[0]==='provider').length,1);assert.equal(f.calls.filter(c=>c[0]==='consumeRouteProviderQuota').length,1);});
for(const [name,patch] of [['provider',{providerVersion:'other'}],['reference',{providerRouteReference:''}],['distance',{routeDistanceMeters:0}],['duration',{routeDurationSeconds:Infinity}],['few points',{routeShape:{type:'LineString',coordinates:[[3.4,6.4]]}}],['zero length',{routeShape:{type:'LineString',coordinates:[[3.4,6.4],[3.4,6.4]]}}],['point cap',{routeShape:{type:'LineString',coordinates:Array.from({length:2001},()=>[3.4,6.4])}}],['waypoint count',{snappedWaypoints:[]}],['waypoint finite',{snappedWaypoints:[{latitude:NaN,longitude:3.4},{latitude:6.5,longitude:3.5}]}],['waypoint mismatch',{snappedWaypoints:[{latitude:0,longitude:0},{latitude:6.5,longitude:3.5}]}],['nonfinite',{routeShape:{type:'LineString',coordinates:[[NaN,6.4],[3.5,6.5]]}}],['range',{routeShape:{type:'LineString',coordinates:[[181,6.4],[3.5,6.5]]}}]])test('requester rejects '+name+' provider evidence before publication',async()=>{const f=fixture({}, {route:async()=>({...providerResult(),...patch})});const r=await f.handler(request());assert.equal(r.status,name==='point cap'?422:502);assert(!f.calls.some(c=>c[0]==='publish'));});
test('2m provider-waypoint equivalence is numerical; trusted endpoint displacement is unrestricted',async()=>{
  const r=providerResult();r.snappedWaypoints[0].latitude+=0.000009;assert.doesNotThrow(()=>validateRequesterProviderResult(r));
  r.snappedWaypoints[0].latitude+=0.0001;assert.throws(()=>validateRequesterProviderResult(r));
  const f=fixture();f.ctx.origin={latitude:0,longitude:0};assert.equal((await f.handler(request())).status,200);
});
test('requester opt-in Mapbox adapter retains waypoints without changing driving request',async()=>{
  let requests=0;const provider=createMapboxDirectionsProvider('mock-token',{includeSnappedWaypoints:true,maxGeometryPoints:2000,fetchImpl:async url=>{
    requests++;assert.match(String(url),/\/mapbox\/driving\//);assert.equal(new URL(url).searchParams.get('alternatives'),'false');
    return new Response(JSON.stringify({code:'Ok',uuid:'response',routes:[{geometry:providerResult().routeShape,distance:1000,duration:300}],waypoints:[{location:[3.4,6.4]},{location:[3.5,6.5]}]}),{headers:{'Content-Type':'application/json'}});
  }});
  const f=fixture();f.handler=createRequesterRouteGenerationHandler(f.backend,provider);assert.equal((await f.handler(request())).status,200);assert.equal(requests,1);
});

for(const failure of ['redirect','content type','body limit','JSON','no route','multiple routes','reference'])test('requester mock provider transport rejects '+failure+' without publishing',async()=>{
  let count=0;
  const body={code:'Ok',uuid:'response',routes:[{geometry:providerResult().routeShape,distance:1000,duration:300}],waypoints:[{location:[3.4,6.4]},{location:[3.5,6.5]}]};
  if(failure==='no route'){body.code='NoRoute';body.routes=[];}
  if(failure==='multiple routes')body.routes.push(body.routes[0]);
  if(failure==='reference')body.uuid='';
  const provider=createMapboxDirectionsProvider('mock-token',{includeSnappedWaypoints:true,maxGeometryPoints:2000,fetchImpl:async()=>{
    count++;
    const response=new Response(failure==='JSON'?'{':JSON.stringify(body),{headers:{'Content-Type':failure==='content type'?'text/plain':'application/json',...(failure==='body limit'?{'Content-Length':'999999'}:{})}});
    if(failure==='redirect')Object.defineProperty(response,'redirected',{value:true});
    return response;
  }});
  const f=fixture();const handler=createRequesterRouteGenerationHandler(f.backend,provider);const r=await handler(request());
  assert.equal(r.status,503);assert.deepEqual(await r.json(),{state:'route_generation_unavailable'});assert.equal(count,1);assert(!f.calls.some(c=>c[0]==='publish'));
});
