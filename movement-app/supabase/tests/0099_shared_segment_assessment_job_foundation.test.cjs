'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {calculateIsolated}=require('../../scripts/assessment-worker/compute.cjs');
const {executeOne}=require('../../scripts/assessment-worker/worker.cjs');
const {parseResult}=require('../../scripts/assessment-worker/result.cjs');
const {createAssessmentJobBackend}=require('../functions/_shared/shared-segment-assessment-job-runtime.ts');
const {ASSESSMENT_VERSION,parameterFingerprint,emptyResult}=require('../functions/_shared/shared-segment-assessment-contracts.ts');
const {assessSharedSegment}=require('../functions/_shared/shared-segment-assessment-geometry.ts');
const uuid=()=>crypto.randomUUID();
const line={type:'LineString',coordinates:[[0,0],[0.003,0]]};
test('isolated child runs unchanged engine and returns exact canonical result',async()=>{
 const r=await calculateIsolated(line,line);assert.deepEqual(r.result,assessSharedSegment(line,line));assert(r.metrics.wallMs>=r.metrics.computeMs);assert(r.metrics.peakRssBytes>0);
});
for(const [name,file,code] of [['external deadline','stall','compute_timeout'],['abnormal exit','abnormal','compute_terminated'],['malformed IPC','malformed','compute_terminated'],['bounded child heap OOM','oom','compute_terminated']])
 test(name+' never fabricates processing_limit',async()=>{
  await assert.rejects(calculateIsolated(line,line,{childPath:path.join(__dirname,'fixtures',`0099-compute-${file}.cjs`),timeoutMs:file==='stall'?1000:5000,heapMb:16}),e=>e.code===code);
 });
test('abort terminates isolated child outside its blocked event loop',async()=>{
 const controller=new AbortController();const work=calculateIsolated(line,line,{signal:controller.signal,childPath:path.join(__dirname,'fixtures/0099-compute-stall.cjs')});setTimeout(()=>controller.abort(),100);await assert.rejects(work,e=>e.code==='compute_terminated');
});
test('compute child has no trusted IO or credentials and fork environment is empty',()=>{
 const child=fs.readFileSync('scripts/assessment-worker/compute-child.cjs','utf8'),parent=fs.readFileSync('scripts/assessment-worker/compute.cjs','utf8');
 assert.doesNotMatch(child,/SUPABASE|MAPBOX|fetch\(|postgres|\.\/runtime|job_id|lease_token/);assert.match(parent,/env:\{\}/);assert.match(child,/shared-segment-assessment-geometry\.ts/);
});
async function mock({hit=false,state='ready',result=assessSharedSegment(line,line),lost=false,contract=false,computeCode,leaseMs=60000}={}){
 const job=uuid(),token=uuid(),assessmentId=uuid(),fingerprint=await parameterFingerprint();let calls={claim:0,load:0,compute:0,finalize:0,fail:0},category,committed=false;
 const context={need_id:uuid(),requester_id:uuid(),intent_id:uuid(),offerer_id:uuid(),algorithm_version:contract?'wrong':ASSESSMENT_VERSION,parameter_fingerprint:fingerprint};
 const assessment=hit?{lookup_state:'reuse_existing',assessment_id:assessmentId,algorithm_version:ASSESSMENT_VERSION,parameter_fingerprint:fingerprint,canonical_result:result}:
  {lookup_state:'not_found',assessment_id:null,algorithm_version:null,parameter_fingerprint:null,canonical_result:null};
 const backend={claim:async()=>{calls.claim++;return {state:'claimed',job_id:job,lease_token:token,attempt_count:1};},
  load:async()=>{calls.load++;return state==='ready'?{state,job_id:job,lease_expires_at:new Date(Date.now()+leaseMs).toISOString(),snapshot:{context,input_state:'ready',expires_at:new Date(Date.now()+60000).toISOString(),offerer_shape:line,requester_shape:line},assessment}:{state};},
  finalize:async(_j,_t,_ctx,r,_signal,recoveryOnly)=>{calls.finalize++;if(r&&!recoveryOnly){committed=true;if(lost)throw Error('lost COMMIT response');}return hit||committed?{state:'completed',assessment_id:assessmentId,publication_state:recoveryOnly||hit?'reuse_existing':'published'}:{state:'not_found'};},
  fail:async(_j,_t,c)=>{calls.fail++;category=c;return {state:c==='contract_mismatch'?'stale':'pending'};}};
 const got=await executeOne(backend,{compute:async()=>{calls.compute++;if(computeCode)throw Object.assign(Error(),{code:computeCode});return {result,metrics:{wallMs:1}};}});
 return {got,calls,category};
}
test('fresh miss computes once and completes',async()=>{const v=await mock();assert.equal(v.got.state,'completed');assert.equal(v.calls.compute,1);assert.equal(v.calls.finalize,1);assert.equal(v.calls.fail,0);});
test('0097 exact hit completes with zero child compute',async()=>{const v=await mock({hit:true});assert.equal(v.got.state,'completed');assert.equal(v.calls.compute,0);assert.equal(v.calls.finalize,1);});
test('reuse hit needs no cold-compute reserve near lease expiry',async()=>{const v=await mock({hit:true,leaseMs:1000});assert.equal(v.got.state,'completed');assert.equal(v.calls.compute,0);assert.equal(v.calls.finalize,1);});
test('lost finalize response recovers without second compute',async()=>{const v=await mock({lost:true});assert.equal(v.got.state,'completed');assert.equal(v.calls.compute,1);assert.equal(v.calls.finalize,2);assert.equal(v.calls.fail,0);});
for(const state of ['stale','expired','lease_invalid'])test(state+' load performs zero compute/publication',async()=>{const v=await mock({state});assert.equal(v.got.state,state);assert.equal(v.calls.compute,0);assert.equal(v.calls.finalize,0);});
test('version safety mismatch does no compute and is not a retryable miss',async()=>{const v=await mock({contract:true});assert.equal(v.calls.compute,0);assert.equal(v.category,'contract_mismatch');assert.equal(v.got.state,'stale');});
test('processing_limit is successful immutable completion',async()=>{const r=emptyResult();r.assessmentState='assessment_unavailable';r.reasons=['processing_limit'];const v=await mock({result:r});assert.equal(v.got.state,'completed');assert.equal(v.calls.fail,0);});
test('calculation_failed has no publication and retains bounded retry',async()=>{const r=emptyResult();r.assessmentState='assessment_unavailable';r.reasons=['calculation_failed'];const v=await mock({result:r});assert.equal(v.got.state,'pending');assert.equal(v.category,'calculation_failed');assert.equal(v.calls.finalize,1);});
for(const code of ['compute_timeout','compute_terminated'])test(code+' is infrastructure failure, not geographic evidence',async()=>{const v=await mock({computeCode:code});assert.equal(v.got.state,'pending');assert.equal(v.category,code);});
test('invalid evidence is never published',async()=>{const r=emptyResult('evidence_invalid');const v=await mock({result:r});assert.equal(v.category,'invalid_evidence');});
test('strict child parser rejects extra data and authority flags',()=>{const r=assessSharedSegment(line,line);assert.throws(()=>parseResult({...r,privateGeometry:line}));assert.throws(()=>parseResult({...r,authorizesAdmission:true}));assert.throws(()=>parseResult({...r,workUnits:1000001}));});
test('runtime claims with only trusted service credentials and exact empty input',async()=>{
 let seen;const backend=createAssessmentJobBackend('http://localhost:54321','sb_secret_fixture',async(url,init)=>{seen={url,init};return Response.json({state:'idle'});});
 assert.deepEqual(await backend.claim(new AbortController().signal),{state:'idle'});assert.deepEqual(JSON.parse(seen.init.body),{});assert.equal(seen.init.headers.apikey,'sb_secret_fixture');assert.equal(seen.init.headers.Authorization,undefined);assert.match(seen.url,/claim_shared_segment_assessment_job_for_server$/);
});
for(const value of [{state:'idle',geometry:line},{state:'claimed',job_id:'bad'},{state:'unknown'}])test('runtime rejects malformed private claim '+JSON.stringify(Object.keys(value)),async()=>{
 const backend=createAssessmentJobBackend('http://localhost:54321','secret',async()=>Response.json(value));await assert.rejects(backend.claim(new AbortController().signal),/unavailable/);
});
test('runtime rejects client-like identifiers before network work',async()=>{let calls=0;const b=createAssessmentJobBackend('http://localhost:54321','secret',async()=>{calls++;return Response.json({});});await assert.rejects(b.register('bad',uuid(),uuid(),new AbortController().signal));await assert.rejects(b.load(uuid(),'bad',new AbortController().signal));assert.equal(calls,0);});
async function wireFixture(){
 const job=uuid(),token=uuid(),fingerprint=await parameterFingerprint(),expires=new Date(Date.now()+60000).toISOString();
 return {job,token,value:{state:'ready',job_id:job,attempt_count:1,lease_expires_at:expires,
  snapshot:{input_state:'ready',reason:null,input_context_fingerprint:'a'.repeat(64),expires_at:expires,offerer_shape:line,requester_shape:line,
   context:{need_id:uuid(),requester_id:uuid(),intent_id:uuid(),offerer_id:uuid(),algorithm_version:ASSESSMENT_VERSION,parameter_fingerprint:fingerprint,
    offerer_evidence:{id:uuid(),version:1},requester_evidence:{id:uuid(),version:1},expires_at:expires}},
  assessment:{lookup_state:'not_found',assessment_id:null,algorithm_version:null,parameter_fingerprint:null,canonical_result:null}}};
}
test('runtime loads only exact claimed-job wire contract',async()=>{
 const f=await wireFixture();let sent;
 const b=createAssessmentJobBackend('http://localhost:54321','secret',async(_url,init)=>{sent=JSON.parse(init.body);return Response.json(f.value);});
 assert.deepEqual(await b.load(f.job,f.token,new AbortController().signal),f.value);assert.deepEqual(sent,{p_job_id:f.job,p_lease_token:f.token});
});
for(const mode of ['extra','wrongJob','wrongVersion','wrongFingerprint','privateFailure'])test('runtime rejects job load '+mode,async()=>{
 const f=await wireFixture(),v=f.value;
 if(mode==='extra')v.privateExtra=true;if(mode==='wrongJob')v.job_id=uuid();
 if(mode==='wrongVersion')v.snapshot.context.algorithm_version='wrong';if(mode==='wrongFingerprint')v.snapshot.context.parameter_fingerprint='b'.repeat(64);
 if(mode==='privateFailure'){v.state='stale';}
 const b=createAssessmentJobBackend('http://localhost:54321','secret',async()=>Response.json(v));await assert.rejects(b.load(f.job,f.token,new AbortController().signal),/unavailable/);
});
test('runtime recovery sends an explicit read-only recovery flag and known expected result',async()=>{
 const f=await wireFixture(),assessment=uuid(),result=assessSharedSegment(line,line);let sent;
 const b=createAssessmentJobBackend('http://localhost:54321','secret',async(_url,init)=>{sent=JSON.parse(init.body);return Response.json({state:'completed',assessment_id:assessment,publication_state:'reuse_existing'});});
 assert.deepEqual(await b.finalize(f.job,f.token,f.value.snapshot.context,result,new AbortController().signal,true),{state:'completed',assessment_id:assessment,publication_state:'reuse_existing'});
 assert.equal(sent.p_recovery_only,true);assert.deepEqual(sent.p_result,result);
});
test('runtime registration sends selectors only and rejects extra private response data',async()=>{
 const member=uuid(),need=uuid(),availability=uuid();let sent;
 const b=createAssessmentJobBackend('http://localhost:54321','secret',async(_url,init)=>{sent=JSON.parse(init.body);return Response.json({state:'not_ready',geometry:line});});
 await assert.rejects(b.register(member,need,availability,new AbortController().signal));assert.deepEqual(sent,{p_verified_member_id:member,p_movement_need_id:need,p_availability_id:availability});
});
test('aborted runtime request starts no trusted transport',async()=>{let calls=0;const b=createAssessmentJobBackend('http://localhost:54321','secret',async()=>{calls++;return Response.json({state:'idle'});});const c=new AbortController();c.abort();await assert.rejects(b.claim(c.signal));assert.equal(calls,0);});
test('trusted canonical-result safety rejection is permanent without exposing DB text',async()=>{
 const b=createAssessmentJobBackend('http://localhost:54321','secret',async()=>Response.json({code:'23514',message:'Assessment job result mismatch',details:'private geometry'}, {status:400}));
 await assert.rejects(b.finalize(uuid(),uuid(),{},null,new AbortController().signal),e=>e.code==='contract_mismatch'&&!/private|result mismatch/.test(e.message));
});
test('50 broad candidates and offerer surfaces contain no job or worker invocation',()=>{
 for(const file of ['src/app/request-movement.tsx','src/app/offer-movement.tsx','src/services/offeringMovementService.ts']){
  const source=fs.readFileSync(file,'utf8');assert.doesNotMatch(source,/shared.segment.assessment.job|assessment-worker|register_requester_availability_shared_segment/);
 }
 const source=fs.readFileSync('src/app/request-movement.tsx','utf8');const guard=source.slice(source.indexOf('const canExpressInterest'),source.indexOf('async function expressInterest'));assert.doesNotMatch(guard,/job|geographicSupport/);
});
test('forward migration has private-only work, no provider/discovery/product writes',()=>{
 const sql=fs.readFileSync('supabase/migrations/0099_shared_segment_assessment_job_foundation.sql','utf8');
 assert.match(sql,/FOR UPDATE SKIP LOCKED/);assert.match(sql,/attempt_count BETWEEN 0 AND 3/);
 assert.doesNotMatch(sql,/\b(?:INSERT INTO|UPDATE|DELETE FROM)\s+(?:public\.|private\.)(?:movement_interests|movement_offers|movement_needs|offering_movement_availability|financial_\w+)/i);
 assert(!fs.existsSync('supabase/functions/prepare-requester-geographic-support/index.ts'));
});
