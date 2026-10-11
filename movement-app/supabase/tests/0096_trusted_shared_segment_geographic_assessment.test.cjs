'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),cp=require('node:child_process');
const geometry=require('../functions/_shared/shared-segment-assessment-geometry.ts');
const {ASSESSMENT_VERSION,PARAMETERS:P,PARAMETER_CANONICAL,emptyResult,parameterFingerprint}=require('../functions/_shared/shared-segment-assessment-contracts.ts');
const {produceSharedSegmentAssessment}=require('../functions/_shared/shared-segment-assessment-orchestration.ts');
const {createSharedSegmentAssessmentBackend}=require('../functions/_shared/shared-segment-assessment-runtime.ts');
const metre=180/(Math.PI*P.earthRadiusMeters);
const line=(...xy)=>({type:'LineString',coordinates:xy.map(([x,y=0])=>[x*metre,y*metre])});
const assess=(a,b)=>geometry.assessSharedSegment(a,b);
const straight=n=>line([0,0],[n,0]);
const semantic=r=>{assert.equal(r.authorizesAdmission,false);assert.equal(r.confirmsUsableSharedSegment,false);assert.equal(r.roadTopologyVerified,false);assert.equal(r.alternativeCorridors,'unassessed');};
for(const [label,a,b,verdict] of [
 ['Ologolo to VI / Agungi Ikate synthetic middle',straight(1000),line([200,0],[500,0]),'geometric_corridor_support'],
 ['exact shared path',straight(300),straight(300),'geometric_corridor_support'],
 ['shared prefix',straight(300),line([0,0],[150,0],[150,200]),'geometric_corridor_support'],
 ['shared suffix',straight(300),line([150,-200],[150,0],[300,0]),'geometric_corridor_support'],
 ['parallel 2m geometry',straight(300),line([0,2],[300,2]),'geometric_corridor_support'],
 ['frontage-like geometry',straight(300),line([0,4],[300,4]),'geometric_corridor_support'],
 ['outside envelope',straight(300),line([0,5.01],[300,5.01]),'inconclusive'],
 ['stacked identical 2D limitation',straight(300),straight(300),'geometric_corridor_support'],
 ['ordinary alternative transport unassessed',straight(300),line([0,100],[300,100]),'inconclusive'],
 ['opposite direction',straight(300),line([300,0],[0,0]),'inconclusive'],
 ['point crossing',straight(300),line([150,-150],[150,150]),'inconclusive'],
 ['2m support',straight(2.21),straight(2.21),'overlap_observed'],
 ['99m',straight(99),straight(99),'overlap_observed'],
 ['exactly 100m',straight(100),straight(100),'geometric_corridor_support'],
 ['100.001m',straight(100.001),straight(100.001),'geometric_corridor_support'],
 ['both-route threshold',straight(300),straight(99),'overlap_observed'],
 ['repeated A B A B',straight(300),line([0,0],[300,0],[0,0],[300,0]),'overlap_observed'],
 ['offerer repeats',line([0,0],[300,0],[0,0],[300,0]),straight(300),'overlap_observed'],
 ['loop',line([0,0],[200,0],[200,200],[0,200],[0,0],[200,0]),straight(200),'overlap_observed'],
 ['figure eight repeated diagonal',line([0,0],[200,200],[0,200],[200,0],[0,0],[200,200]),line([0,0],[200,200]),'overlap_observed'],
 ['sharp turn',line([0,0],[200,0],[200,200]),line([0,0],[200,0],[200,200]),'geometric_corridor_support'],
 ['duplicate vertices',line([0,0],[0,0],[300,0],[300,0]),straight(300),'geometric_corridor_support'],
 ['noise inside envelope',straight(300),line([0,1],[100,-1],[200,1],[300,0]),'geometric_corridor_support'],
 ['self intersection without repeat',line([0,0],[200,200],[0,200],[200,0]),line([0,0],[200,200]),'geometric_corridor_support'],
])test('production geometry: '+label,()=>{const r=assess(a,b);assert.equal(r.geographicResult,verdict,JSON.stringify(r));semantic(r);if(label.includes('repeated') || label==='offerer repeats' || label==='loop' || label.includes('figure eight'))assert.deepEqual(r.reasons,['ambiguous_traversal']);});
test('multiple legitimate separated intervals preserved; long unsupported gap not bridged',()=>{
 const a=straight(600),b=line([0,0],[150,0],[150,100],[400,100],[400,0],[600,0]);
 const r=assess(a,b);assert.equal(r.geographicResult,'geometric_corridor_support');assert.equal(r.ambiguityCount,0);assert(r.supportIntervals.some(m=>m.offererEnd<=155));assert(r.supportIntervals.some(m=>m.offererStart>=395));
 const short=assess(straight(300),line([0,0],[60,0],[60,100],[200,100],[200,0],[260,0]));assert.equal(short.geographicResult,'overlap_observed');assert.deepEqual(short.reasons,['below_positive_support_standard']);
});
test('determinism, different sampling, no duplicate inflation, bounded fractions and interval unions',()=>{
 const a=straight(500),b=line([0,0],[37.23,0],[101.11,0],[300.91,0],[500,0]);
 const r=assess(a,b);assert.equal(r.geographicResult,'geometric_corridor_support');assert(Math.abs(r.offererSupported-500)<0.00001);assert(Math.abs(r.requesterSupported-500)<0.00001);
 for(let i=0;i<10;i++)assert.deepEqual(assess(a,b),r);
 for(const k of ['offerer','requester']){assert(r[k+'Fraction']>=0 && r[k+'Fraction']<=1);assert(r[k+'Supported']<=r[k+'Total']);}
 assert.equal(assess(a,a).offererSupported,r.offererSupported);
});
test('submetre cumulative positions do not promote 99.999m',()=>{assert.equal(assess(straight(99.999),straight(99.999)).geographicResult,'overlap_observed');});
test('validation rejects malformed, out of range, all duplicate and antipodal routes',()=>{
 for(const s of [null,{},line([0,0]),{type:'LineString',coordinates:[[181,0],[0,0]]},straight(0),{type:'LineString',coordinates:[[0,0],[180,0]]}])assert.equal(assess(s,straight(100)).inputState,'evidence_invalid');
});
test('original coordinate envelope exact / one over',()=>{
 const coords=Array.from({length:2000},(_,i)=>[i/10,0]);assert.equal(assess(line(...coords),line(...coords)).assessmentState,'complete');
 const r=assess(line(...coords,[201,0]),straight(300));assert.equal(r.assessmentState,'assessment_unavailable');assert.deepEqual(r.reasons,['processing_limit']);assert.equal(r.geographicResult,null);
});
test('resampled envelope and bounded spatial work; no silent downsampling',()=>{
 const r=assess(straight(100000),straight(100000));assert.equal(r.assessmentState,'assessment_unavailable');assert.deepEqual(r.reasons,['processing_limit']);
 const a=straight(99995),b=line([0,1000],[99995,1000]);const boundary=assess(a,b);assert.equal(boundary.offererPointCount,20000);assert.equal(boundary.assessmentState,'complete');assert(boundary.workUnits<=1000000);
 assert.equal(assess(straight(99995.001),b).assessmentState,'assessment_unavailable');
 const repeated=line(...Array.from({length:2000},(_,i)=>[i%2?20:0,0]));const dense=assess(straight(100),repeated);assert.equal(dense.assessmentState,'assessment_unavailable');assert.equal(dense.geographicResult,null);assert.equal(dense.workUnits,1000000);
});
test('canonical parameters and migration fingerprint agree exactly',async()=>{
 const sql=fs.readFileSync('supabase/migrations/0096_trusted_shared_segment_geographic_assessment.sql','utf8');
 const canonical=sql.match(/SELECT '(\{"samplingSpacingMeters"[^]*?\})'::text/)[1];assert.equal(canonical,JSON.stringify(P));
 assert.equal(await parameterFingerprint(),require('node:crypto').createHash('sha256').update(canonical).digest('hex'));
});
test('0001 through 0095 historical migrations unchanged',()=>{
 const prefix=cp.execFileSync('git',['rev-parse','--show-prefix'],{encoding:'utf8'}).trim();
 const files=fs.readdirSync('supabase/migrations').filter(f=>/^00(?:[0-8]\d|9[0-5])_.*\.sql$/.test(f));assert.equal(files.length,95);
 for(const file of files)assert.equal(fs.readFileSync('supabase/migrations/'+file,'utf8').replace(/\r\n/g,'\n'),cp.execFileSync('git',['show','HEAD:'+prefix+'supabase/migrations/'+file],{encoding:'utf8'}).replace(/\r\n/g,'\n'));
});
const pair={needId:'00000000-0000-4000-8000-000000000001',requesterId:'00000000-0000-4000-8000-000000000002',intentId:'00000000-0000-4000-8000-000000000003',offererId:'00000000-0000-4000-8000-000000000004'};
const contractFingerprint=require('node:crypto').createHash('sha256').update(PARAMETER_CANONICAL).digest('hex');
const snapshot=()=>({input_state:'ready',reason:null,context:{need_id:pair.needId,requester_id:pair.requesterId,intent_id:pair.intentId,offerer_id:pair.offererId,expires_at:new Date(Date.now()+60000).toISOString(),algorithm_version:ASSESSMENT_VERSION,parameter_fingerprint:contractFingerprint},input_context_fingerprint:'a'.repeat(64),expires_at:new Date(Date.now()+60000).toISOString(),offerer_shape:straight(300),requester_shape:straight(300)});
test('internal orchestration computes only between RPCs and publishes exact snapshot',async()=>{
 const s=snapshot();s.expires_at=s.context.expires_at;const events=[];
 const b={context:async()=>{events.push('context');return s;},publish:async(p,c,r)=>{events.push('publish');assert.deepEqual(p,pair);assert.equal(c,s.context);assert.equal(r.geographicResult,'geometric_corridor_support');return {assessment_id:pair.needId,publication_state:'published'};}};
 const r=await produceSharedSegmentAssessment(b,pair);assert.equal(r.publication.publication_state,'published');assert.deepEqual(events,['context','publish']);
});
for(const [field,value] of [['algorithm_version','mismatched-v2'],['parameter_fingerprint','b'.repeat(64)]])test('orchestration rejects DB '+field+' mismatch before geometry or publication',async()=>{
 let touched=false,published=false;const s=snapshot();s.context[field]=value;
 s.offerer_shape=new Proxy({}, {ownKeys(){touched=true;return [];}});
 const b={context:async()=>s,publish:async()=>{published=true;throw Error('unexpected');}};
 await assert.rejects(produceSharedSegmentAssessment(b,pair),/^Error: Assessment unavailable$/);
 assert.equal(touched,false);assert.equal(published,false);
});
test('transient calculation failure is not published and exact pair can retry successfully',async()=>{
 let attempts=0,published=0;const bad=new Proxy({}, {ownKeys(){throw Error('transient');}});
 const b={context:async()=>({...snapshot(),offerer_shape:attempts++===0?bad:straight(300)}),publish:async()=>{published++;return {assessment_id:pair.needId,publication_state:'published'};}};
 const failed=await produceSharedSegmentAssessment(b,pair);assert.deepEqual(failed.result.reasons,['calculation_failed']);assert.equal(failed.publication,null);assert.equal(published,0);
 const healthy=await produceSharedSegmentAssessment(b,pair);assert.equal(healthy.result.geographicResult,'geometric_corridor_support');assert.equal(healthy.publication.publication_state,'published');assert.equal(published,1);
});
test('deterministic processing limit remains publishable',async()=>{
 let published=0;const b={context:async()=>({...snapshot(),offerer_shape:straight(100000),requester_shape:straight(100000)}),publish:async(_p,_c,r)=>{published++;assert.deepEqual(r.reasons,['processing_limit']);return {assessment_id:pair.needId,publication_state:'published'};}};
 const value=await produceSharedSegmentAssessment(b,pair);assert.deepEqual(value.result.reasons,['processing_limit']);assert.equal(value.publication.publication_state,'published');assert.equal(published,1);
});
test('roster freeze is excluded from geographic snapshot semantics',()=>{
 const sql=fs.readFileSync('supabase/migrations/0096_trusted_shared_segment_geographic_assessment.sql','utf8');
 const body=sql.match(/CREATE FUNCTION public\.get_shared_segment_geographic_assessment_context_for_server\([^]*?\$\$;\s*REVOKE/)[0];
 assert.doesNotMatch(body,/offering_movement_roster_freezes/);assert.match(body,/n\.status<>'discoverable'/);assert.match(body,/i\.status<>'current'/);
});
for(const state of ['evidence_unavailable','evidence_stale','evidence_invalid'])test('orchestration '+state+' does not compute or publish',async()=>{
 const b={context:async()=>({...snapshot(),input_state:state}),publish:async()=>{throw Error('unexpected');}};
 const r=await produceSharedSegmentAssessment(b,pair);assert.equal(r.result.assessmentState,'not_run');assert.equal(r.publication,null);
});
test('orchestration propagates stale publication rejection and cancellation',async()=>{
 await assert.rejects(produceSharedSegmentAssessment({context:async()=>snapshot(),publish:async()=>{throw Error('changed');}},pair),/changed/);
 const c=new AbortController();c.abort();await assert.rejects(produceSharedSegmentAssessment({},pair,c.signal));
});
test('runtime uses only service RPCs with bounded responses and generic errors',async()=>{
 const s=snapshot();s.expires_at=s.context.expires_at;const calls=[];
 const b=createSharedSegmentAssessmentBackend('http://localhost:54321','sb_secret_test',async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify(url.includes('get_shared')?s:{assessment_id:pair.needId,publication_state:'reuse_existing'}));});
 await produceSharedSegmentAssessment(b,pair);assert.equal(calls.length,2);assert(calls.every(c=>c.url.includes('/rest/v1/rpc/')));assert.equal(calls[0].options.headers.Authorization,undefined);assert.equal(calls[0].options.redirect,'error');
 const fail=createSharedSegmentAssessmentBackend('http://localhost:54321','secret',async()=>new Response('private error',{status:403}));await assert.rejects(fail.context(pair,new AbortController().signal),/^Error: Assessment unavailable$/);
});
test('runtime rejects invalid URL, missing secret, oversized response, wrong pair and invalid publication',async()=>{
 const signal=new AbortController().signal;
 for(const [url,secret,body] of [['https://user:pass@example.com','x',{}],['https://example.com','',{}],['http://remote.example','x',{}],['https://example.com','x','x'.repeat(4*1024*1024+1)],['https://example.com','x',{...snapshot(),context:{}}]]){
  const b=createSharedSegmentAssessmentBackend(url,secret,async()=>new Response(typeof body==='string'?body:JSON.stringify(body)));await assert.rejects(b.context(pair,signal));
 }
 const b=createSharedSegmentAssessmentBackend('https://example.com','x',async()=>new Response('{"assessment_id":"bad","publication_state":"published"}'));await assert.rejects(b.publish(pair,{},emptyResult(),signal));
});
module.exports={line,straight,assess,pair};
