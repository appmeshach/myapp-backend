'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {getOrProduceSharedSegmentAssessment}=require('../functions/_shared/shared-segment-assessment-orchestration.ts');
const {createSharedSegmentAssessmentBackend}=require('../functions/_shared/shared-segment-assessment-runtime.ts');
const {emptyResult}=require('../functions/_shared/shared-segment-assessment-contracts.ts');
const {pair,straight}=require('./0096_trusted_shared_segment_geographic_assessment.test.cjs');
const algorithmVersion='shared_segment_geographic_assessment_v1';
const fingerprint=require('node:crypto').createHash('sha256').update(JSON.stringify(require('../functions/_shared/shared-segment-assessment-contracts.ts').PARAMETERS)).digest('hex');
const miss=lookup_state=>({lookup_state,assessment_id:null,algorithm_version:null,parameter_fingerprint:null,canonical_result:null});
const hit=canonical_result=>({lookup_state:'reuse_existing',assessment_id:pair.needId,algorithm_version:algorithmVersion,parameter_fingerprint:fingerprint,canonical_result});
const hitResult=()=>{const r=emptyResult();r.assessmentState='assessment_unavailable';r.reasons=['processing_limit'];return r;};
test('reuse hit performs zero context, geometry, publication, or provider work',async()=>{
 let context=0,geometry=0,publish=0,provider=0;const result=hitResult();
 const backend={lookup:async()=>hit(result),context:async()=>{context++;throw Error('unexpected');},publish:async()=>{publish++;throw Error('unexpected');},provider:()=>provider++};
 const got=await getOrProduceSharedSegmentAssessment(backend,pair,undefined,()=>{geometry++;throw Error('unexpected');});
 assert.equal(got.lookupState,'reuse_existing');assert.equal(got.result,result);assert.equal(got.publication.publication_state,'reuse_existing');assert.deepEqual({context,geometry,publish,provider},{context:0,geometry:0,publish:0,provider:0});
});
for(const [label,identity] of [['parameter fingerprint',{parameter_fingerprint:'b'.repeat(64)}],['algorithm version',{algorithm_version:'shared_segment_geographic_assessment_v2'}]])
test('reuse hit fails closed on local '+label+' mismatch without geometry or publication',async()=>{
 let geometry=0,publish=0,context=0;const lookup={...hit(hitResult()),...identity};
 const backend={lookup:async()=>lookup,context:async()=>{context++;throw Error('unexpected');},publish:async()=>{publish++;throw Error('unexpected');}};
 await assert.rejects(getOrProduceSharedSegmentAssessment(backend,pair,undefined,()=>{geometry++;return emptyResult();}),/Assessment unavailable/);
 assert.deepEqual({context,geometry,publish},{context:0,geometry:0,publish:0});
});
test('legitimate miss computes one pair and publishes once',async()=>{
 let geometry=0,publish=0;const expires_at=new Date(Date.now()+60000).toISOString();
 const backend={lookup:async()=>miss('not_found'),context:async()=>({input_state:'ready',reason:null,context:{need_id:pair.needId,requester_id:pair.requesterId,intent_id:pair.intentId,offerer_id:pair.offererId,expires_at,algorithm_version:algorithmVersion,parameter_fingerprint:fingerprint},input_context_fingerprint:'a'.repeat(64),expires_at,offerer_shape:straight(300),requester_shape:straight(300)}),publish:async()=>{publish++;return {assessment_id:pair.needId,publication_state:'published'};}};
 const got=await getOrProduceSharedSegmentAssessment(backend,pair,undefined,(a,b)=>{geometry++;return require('../functions/_shared/shared-segment-assessment-geometry.ts').assessSharedSegment(a,b);});
 assert.equal(got.lookupState,'not_found');assert.equal(got.result.geographicResult,'geometric_corridor_support');assert.deepEqual({geometry,publish},{geometry:1,publish:1});
});
test('not-ready lookup is not an inconclusive result and does no work',async()=>{
 let touched=0;const backend={lookup:async()=>miss('not_ready'),context:async()=>{touched++;},publish:async()=>{touched++;}};
 const got=await getOrProduceSharedSegmentAssessment(backend,pair,undefined,()=>{touched++;return emptyResult();});assert.deepEqual(got,{lookupState:'not_ready',result:null,publication:null});assert.equal(touched,0);
});
for(const state of ['evidence_unavailable','evidence_stale','evidence_invalid'])
test('miss followed by '+state+' current context resolves not-ready',async()=>{
 let geometry=0,publish=0;const backend={lookup:async()=>miss('not_found'),context:async()=>({input_state:state,reason:null,context:null,input_context_fingerprint:null,expires_at:null,offerer_shape:null,requester_shape:null}),publish:async()=>{publish++;}};
 const got=await getOrProduceSharedSegmentAssessment(backend,pair,undefined,()=>{geometry++;return emptyResult();});
 assert.deepEqual(got,{lookupState:'not_ready',result:null,publication:null});assert.deepEqual({geometry,publish},{geometry:0,publish:0});
});
for(const [field,value] of [['parameter_fingerprint','b'.repeat(64)],['algorithm_version','shared_segment_geographic_assessment_v2']])
test('cache miss retains producer '+field+' identity verification',async()=>{
 let geometry=0,publish=0;const expires_at=new Date(Date.now()+60000).toISOString();
 const backend={lookup:async()=>miss('not_found'),context:async()=>({input_state:'ready',reason:null,context:{algorithm_version:algorithmVersion,parameter_fingerprint:fingerprint,[field]:value},input_context_fingerprint:'a'.repeat(64),expires_at,offerer_shape:straight(300),requester_shape:straight(300)}),publish:async()=>{publish++;}};
 await assert.rejects(getOrProduceSharedSegmentAssessment(backend,pair,undefined,()=>{geometry++;return emptyResult();}),/Assessment unavailable/);assert.deepEqual({geometry,publish},{geometry:0,publish:0});
});
test('transient calculation failure remains unpersisted after a lookup miss',async()=>{
 let published=0;const expires_at=new Date(Date.now()+60000).toISOString(),bad=new Proxy({},{ownKeys(){throw Error('transient');}});
 const backend={lookup:async()=>miss('not_found'),context:async()=>({input_state:'ready',reason:null,context:{algorithm_version:algorithmVersion,parameter_fingerprint:fingerprint},input_context_fingerprint:'a'.repeat(64),expires_at,offerer_shape:bad,requester_shape:straight(300)}),publish:async()=>{published++;}};
 const got=await getOrProduceSharedSegmentAssessment(backend,pair);assert.deepEqual(got.result.reasons,['calculation_failed']);assert.equal(got.publication,null);assert.equal(published,0);
});
test('abort and malformed pair stop before lookup',async()=>{let calls=0;const backend={lookup:async()=>{calls++;}};const abort=new AbortController();abort.abort();await assert.rejects(getOrProduceSharedSegmentAssessment(backend,pair,abort.signal),/Abort/);await assert.rejects(getOrProduceSharedSegmentAssessment(backend,{...pair,needId:'bad'}),/Assessment unavailable/);assert.equal(calls,0);});
test('runtime performs lookup first and validates canonical hit result',async()=>{
 const calls=[],result=hitResult();const backend=createSharedSegmentAssessmentBackend('http://localhost:54321','sb_secret_test',async(url)=>{calls.push(url);return new Response(JSON.stringify(hit(result)));});
 const got=await getOrProduceSharedSegmentAssessment(backend,pair);assert.deepEqual(got.result,result);assert.equal(calls.length,1);assert.match(calls[0],/get_current_shared_segment/);
 const invalid=createSharedSegmentAssessmentBackend('http://localhost:54321','sb_secret_test',async()=>new Response(JSON.stringify(hit({}))));await assert.rejects(invalid.lookup(pair,new AbortController().signal),/Assessment unavailable/);
});
test('broad discovery source has zero shared-segment assessment fanout',()=>{
 const files=['supabase/migrations/0041_trusted_masked_movement_discovery.sql','supabase/migrations/0044_offering_movement_availability_foundation.sql','src/services/movementService.ts','src/services/offeringMovementService.ts'];
 for(const file of files){const source=fs.readFileSync(path.resolve(file),'utf8');assert.doesNotMatch(source,/getOrProduceSharedSegmentAssessment|produceSharedSegmentAssessment|get_current_shared_segment_geographic_assessment|shared-segment-assessment-geometry/);}
});
for(const [label,mutate] of [
 ['extra key',v=>({...v,extra:true})],
 ['missing identity',v=>{delete v.parameter_fingerprint;return v;}],
 ['invalid assessment UUID',v=>({...v,assessment_id:'bad'})],
 ['wrong algorithm version',v=>({...v,algorithm_version:'shared_segment_geographic_assessment_v2'})],
 ['null algorithm version',v=>({...v,algorithm_version:null})],
 ['malformed fingerprint',v=>({...v,parameter_fingerprint:'bad'})],
 ['uppercase fingerprint',v=>({...v,parameter_fingerprint:'A'.repeat(64)})],
 ['well-formed fingerprint mismatch',v=>({...v,parameter_fingerprint:'b'.repeat(64)})],
 ['wrong canonical algorithm',v=>({...v,canonical_result:{...v.canonical_result,algorithmVersion:'shared_segment_geographic_assessment_v2'}})],
 ['invalid canonical result',v=>({...v,canonical_result:{}})],
 ['unknown lookup state',v=>({...v,lookup_state:'unknown'})],
])test('runtime cache-hit '+label+' fails closed without fallback work',async()=>{
 let rpc=0,geometry=0;const response=mutate(hit(hitResult()));
 const backend=createSharedSegmentAssessmentBackend('http://localhost:54321','sb_secret_test',async()=>{
  rpc++;assert.equal(rpc,1,'No context or publication RPC after failure');return new Response(JSON.stringify(response));
 });
 await assert.rejects(getOrProduceSharedSegmentAssessment(backend,pair,undefined,()=>{geometry++;return emptyResult();}),/Assessment unavailable/);
 assert.deepEqual({rpc,geometry},{rpc:1,geometry:0});
});
for(const state of ['not_found','not_ready'])test('runtime '+state+' requires exact keys and null identity/result',async()=>{
 const signal=new AbortController().signal;
 const backend=response=>createSharedSegmentAssessmentBackend('http://localhost:54321','sb_secret_test',async()=>new Response(JSON.stringify(response)));
 assert.deepEqual(await backend(miss(state)).lookup(pair,signal),miss(state));
 for(const field of ['assessment_id','algorithm_version','parameter_fingerprint','canonical_result']) {
  await assert.rejects(backend({...miss(state),[field]:hit(hitResult())[field]}).lookup(pair,signal),/Assessment unavailable/);
  const missing=miss(state);delete missing[field];await assert.rejects(backend(missing).lookup(pair,signal),/Assessment unavailable/);
 }
 await assert.rejects(backend({...miss(state),extra:true}).lookup(pair,signal),/Assessment unavailable/);
});
test('0097 migration is lookup-only and preserves product state boundaries',()=>{const sql=fs.readFileSync('supabase/migrations/0097_shared_segment_assessment_reuse_boundary.sql','utf8');assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE)\b/i);assert.doesNotMatch(sql,/mapbox|priority|roster|financial|movement_offers|movement_interests|pg_advisory|claim|lease|queue/i);assert.match(sql,/assessment\.canonical_context = ctx/);});
