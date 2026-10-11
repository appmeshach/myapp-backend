'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {createRouteBackend}=require('../functions/_shared/route-runtime.ts');
const {createRouteMatchHandler}=require('../functions/_shared/route-match-orchestration.ts');
const {routeMatchContextIdentity}=require('../functions/_shared/route-contracts.ts');
const {calculateTrustedRouteMatchGeometry}=require('../functions/_shared/route-match-geometry.ts');
const id=n=>`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`;
const member=id(1),need=id(2),availability=id(3);
const context={movementNeedId:need,requestingMemberId:member,requesterOriginLocationReferenceId:id(4),requesterDestinationLocationReferenceId:id(5),
 offeringMovementIntentId:id(6),offeringMemberId:id(7),offeringIntentVersion:1,routeEvidenceId:id(8),routeEvidenceVersion:1,
 requesterOrigin:{latitude:6.4,longitude:3.4},requesterDestination:{latitude:6.5,longitude:3.5},routeShape:{type:'LineString',coordinates:[[3.4,6.4],[3.5,6.5]]}};
const identity=routeMatchContextIdentity(context,availability);
const evidence={routeMatchEvidenceId:id(9),routeMatchEvidenceVersion:1,routeMatchEvidenceStatus:'current',routeMatchEvidenceExpiresAt:null};
function stored(payload){return {state:'reuse_existing',identity,evidence,payload};}
function publication(){const g=calculateTrustedRouteMatchGeometry(context);return {movementNeedId:need,offeringMovementIntentId:context.offeringMovementIntentId,expectedRouteEvidenceId:context.routeEvidenceId,expectedRouteEvidenceVersion:1,
 requesterOriginDistanceToRouteMeters:g.requesterOrigin.distanceToRouteMeters,requesterDestinationDistanceToRouteMeters:g.requesterDestination.distanceToRouteMeters,
 calculatedRouteShapeLengthMeters:g.calculatedRouteShapeLengthMeters,requesterOriginPositionAlongRouteMeters:g.requesterOrigin.positionAlongRouteMeters,
 requesterDestinationPositionAlongRouteMeters:g.requesterDestination.positionAlongRouteMeters,requesterOriginClosestRoute:g.requesterOrigin.closestRoutePoint,
 requesterDestinationClosestRoute:g.requesterDestination.closestRoutePoint,calculatedAt:new Date().toISOString(),expiresAt:null};}
const request=(selector={availabilityId:availability})=>new Request('https://edge.invalid/calculate-route-match',{method:'POST',headers:{Authorization:'Bearer jwt','Content-Type':'application/json'},body:JSON.stringify({movementNeedId:need,...selector})});
function fixture(){let row=null,calculations=0,writes=0,reads=0;const backend={authenticate:async()=>member,memberExists:async()=>true,getRequesterAvailabilityMatchingContext:async()=>context,
 getAuthorizedTrustedMatchingContext:async()=>context,
 getCurrentRequesterAvailabilityRouteMatch:async()=>{reads++;return row||{state:'not_found',identity};},
 publishRequesterAvailabilityRouteMatch:async(_m,_n,_a,_identity,payload)=>{writes++;row=stored(payload);return row;},
 recordTrustedRouteMatchEvidence:async()=>{writes++;return evidence;}};
 return {backend,handler:createRouteMatchHandler(backend,x=>{calculations++;return calculateTrustedRouteMatchGeometry(x);}),counts:()=>({calculations,writes,reads}),set:v=>row=v,get:()=>row};}
test('0098 first publication then repeat reuses exact six-field response with no geometry or write',async()=>{
 const f=fixture(),a=await f.handler(request()),body=await a.json();assert.equal(a.status,200);const b=await f.handler(request());assert.deepEqual(await b.json(),body);
 assert.deepEqual(f.counts(),{calculations:1,writes:1,reads:2});assert.equal(Object.keys(body).length,6);assert(Object.isFrozen(f.get().payload));assert(Object.isFrozen(f.get().payload.requesterOriginClosestRoute));
});
test('0098 lost publication response uses one exact lookup and one frozen calculation',async()=>{
 const f=fixture(),real=f.backend.publishRequesterAvailabilityRouteMatch;f.backend.publishRequesterAvailabilityRouteMatch=async(...args)=>{await real(...args);throw Error('lost');};
 assert.equal((await f.handler(request())).status,200);assert.deepEqual(f.counts(),{calculations:1,writes:1,reads:2});
});
for(const mismatch of ['calculatedAt','requesterOriginDistanceToRouteMeters','expectedRouteEvidenceVersion'])test('0098 uncertain response rejects different '+mismatch,async()=>{
 const f=fixture(),real=f.backend.publishRequesterAvailabilityRouteMatch;f.backend.publishRequesterAvailabilityRouteMatch=async(...args)=>{await real(...args);const v=f.get();f.set({...v,payload:{...v.payload,[mismatch]:mismatch==='calculatedAt'?new Date(Date.parse(v.payload.calculatedAt)-1).toISOString():v.payload[mismatch]+1}});throw Error('lost');};
 assert.equal((await f.handler(request())).status,503);assert.deepEqual(f.counts(),{calculations:1,writes:1,reads:2});
});
test('0098 current row appearing during publication retains its timestamp',async()=>{
 const f=fixture();f.backend.publishRequesterAvailabilityRouteMatch=async(_m,_n,_a,_i,p)=>stored({...p,calculatedAt:new Date(Date.parse(p.calculatedAt)-1).toISOString()});
 assert.equal((await f.handler(request())).status,200);assert.equal(f.counts().calculations,1);assert.equal(f.counts().reads,1);
});
test('0098 changed context between authorization and lookup fails without compute',async()=>{
 const f=fixture();f.backend.getCurrentRequesterAvailabilityRouteMatch=async()=>({state:'not_found',identity:{...identity,routeEvidenceVersion:2}});
 assert.equal((await f.handler(request())).status,503);assert.equal(f.counts().calculations,0);
});
test('0098 failed lookup is not treated as a cache miss',async()=>{
 const f=fixture();f.backend.getCurrentRequesterAvailabilityRouteMatch=async()=>null;assert.equal((await f.handler(request())).status,503);assert.equal(f.counts().calculations,0);
});
test('0098 legacy selector does not call requester-only reuse or publication',async()=>{
 const f=fixture();f.backend.getCurrentRequesterAvailabilityRouteMatch=()=>{throw Error('wrong branch');};f.backend.publishRequesterAvailabilityRouteMatch=()=>{throw Error('wrong branch');};
 assert.equal((await f.handler(request({offeringMovementIntentId:context.offeringMovementIntentId}))).status,200);assert.deepEqual(f.counts(),{calculations:1,writes:1,reads:0});
});
test('0098 runtime uses service credentials and exact selected-pair RPC arguments',async()=>{
 const calls=[],v=stored(publication()),db=createRouteBackend('https://project.invalid','sb_secret_server',async(url,init)=>{calls.push({url,init});return Response.json(v);});
 assert.deepEqual(await db.getCurrentRequesterAvailabilityRouteMatch(member,need,availability,new AbortController().signal),v);
 await db.publishRequesterAvailabilityRouteMatch(member,need,availability,identity,v.payload,new AbortController().signal);
 assert(calls[0].url.endsWith('/get_current_requester_availability_route_match_for_server'));assert(calls[1].url.endsWith('/publish_requester_availability_route_match_for_server'));
 assert.equal(calls[0].init.headers.apikey,'sb_secret_server');assert.deepEqual(JSON.parse(calls[0].init.body),{p_verified_member_id:member,p_movement_need_id:need,p_availability_id:availability});
 assert.deepEqual(JSON.parse(calls[1].init.body).p_payload,v.payload);
 await db.getCurrentRequesterAvailabilityRouteMatch(member,need,availability,new AbortController().signal,v.payload);
 assert.deepEqual(JSON.parse(calls[2].init.body).p_expected_payload,v.payload);
});
test('0098 recovery retains PostgreSQL microseconds rather than equating different timestamps',async()=>{
 const v=stored(publication());v.payload.calculatedAt=v.payload.calculatedAt.replace('Z','123Z');
 const db=createRouteBackend('https://project.invalid','sb_secret_server',async()=>Response.json(v));
 const result=await db.getCurrentRequesterAvailabilityRouteMatch(member,need,availability,new AbortController().signal);
 assert.equal(result.payload.calculatedAt,v.payload.calculatedAt);
 assert.notEqual(result.payload.calculatedAt,new Date(v.payload.calculatedAt).toISOString());
});
test('0098 malformed selected identities are rejected before network work',async()=>{
 let calls=0;const db=createRouteBackend('https://project.invalid','sb_secret_server',async()=>{calls++;throw Error('unexpected');});
 await assert.rejects(db.getCurrentRequesterAvailabilityRouteMatch('bad',need,availability,new AbortController().signal));
 await assert.rejects(db.publishRequesterAvailabilityRouteMatch(member,'bad',availability,identity,publication(),new AbortController().signal));assert.equal(calls,0);
});
const malformed={
 extra:v=>({...v,geometry:{}}),wrongMember:v=>({...v,identity:{...v.identity,requestingMemberId:id(11)}}),wrongAvailability:v=>({...v,identity:{...v.identity,availabilityId:id(11)}}),
 wrongRoute:v=>({...v,payload:{...v.payload,expectedRouteEvidenceVersion:2}}),historical:v=>({...v,evidence:{...v.evidence,routeMatchEvidenceStatus:'superseded'}}),
 expired:v=>({...v,evidence:{...v.evidence,routeMatchEvidenceExpiresAt:'2020-01-01T00:00:00.000Z'}}),unsafeMetric:v=>({...v,payload:{...v.payload,requesterOriginDistanceToRouteMeters:1e30}}),
 extraCoordinates:v=>({...v,payload:{...v.payload,requesterOriginClosestRoute:{...v.payload.requesterOriginClosestRoute,provider:'private'}}}),
 future:v=>({...v,payload:{...v.payload,calculatedAt:'2099-01-01T00:00:00.000Z'}}),missingTimestamp:v=>({...v,payload:{...v.payload,calculatedAt:null}}),
 extraIdentity:v=>({...v,identity:{...v.identity,privateContext:{}}}),empty:v=>[],
};
for(const [name,change] of Object.entries(malformed))test('0098 runtime rejects '+name,async()=>{
 const db=createRouteBackend('https://project.invalid','sb_secret_server',async()=>Response.json(change(stored(publication()))));
 assert.equal(await db.getCurrentRequesterAvailabilityRouteMatch(member,need,availability,new AbortController().signal),null);
});
test('0098 migration retains authoritative boundaries and no product effects',()=>{
 const sql=fs.readFileSync('supabase/migrations/0098_current_route_match_reuse_boundary.sql','utf8');
 assert.match(sql,/get_requester_availability_matching_context_for_server/);assert.match(sql,/assert_trusted_route_match_evidence/);assert.match(sql,/record_trusted_route_match_evidence_for_server/);
 assert.doesNotMatch(sql,/CREATE TABLE|CREATE POLICY|CREATE OR REPLACE|financial_|create_requester_movement_interest|shared_segment|pg_advisory/i);
});
