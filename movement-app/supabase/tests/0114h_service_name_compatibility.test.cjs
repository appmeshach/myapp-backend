'use strict';
// Isolated synthetic owners only. Real modules never receive an executable input.
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),path=require('node:path');
const {loadAcquisition,clone,inventory,serviceAck,targetAck}=require('./fixtures/0114d-acquisition-wrapper.cjs');
const reject=fn=>assert.throws(fn,/unavailable/),hash=s=>crypto.createHash('sha256').update(s.replace(/\r\n/g,'\n')).digest('hex');
const flush=async()=>{for(let i=0;i<150;i++)await Promise.resolve();};
test.beforeEach(t=>{let calls=0;for(const[o,k]of[[require('node:https'),'request'],[require('node:http'),'request'],[global,'fetch']])t.mock.method(o,k,()=>{calls++;throw Error('REAL NETWORK FORBIDDEN');});t.after(()=>assert.equal(calls,0));});
function draft(f){const target=f.binding(),inputs=f.input(target),code={reviewedHead:f.drift.head,reviewedBranch:f.drift.branch};return{target,inputs,code};}
function create(f,x){return f.auth.createExecutableAcquisitionDraft(x.target,inventory(),x.code,x.inputs.descriptor);}
function rewrite(f,x,edit){edit(x.inputs.package);const text=JSON.stringify(x.inputs.package)+'\n';f.drift.files.set(x.inputs.packagePath,text);x.inputs.descriptor.sha256=hash(text);}
async function success(f){const a=f.authorized(),h=f.wrapper.beginAuthorizedAcquisition(a.ticket),p=await f.pending(h,'service_review');
 assert.equal(p.review.candidate.expectedServiceName,f.driver.serviceName);assert.equal(p.review.candidate.observedServiceName,f.driver.serviceName);
 assert.equal(p.review.candidate.manifestSha256,a.review.manifestSha256);
 assert.equal(f.calls.length,2);f.wrapper.submitServiceReview(h,p.review,serviceAck(p));const q=await f.pending(h,'candidate');
 assert.equal(q.review.candidate.expectedServiceId,'synthetic-service');assert.equal(q.review.candidate.observedServiceId,'synthetic-service');
 assert.equal(q.review.candidate.serviceNameExpected,f.driver.serviceName);assert.equal(q.review.candidate.manifestSha256,a.review.manifestSha256);
 const r=f.wrapper.submitTargetReview(h,q.review,targetAck(q));assert.equal(r.providerRequests,3);assert.equal(f.sessions.length,1);assert.equal(f.opens.length,1);
 assert.equal(f.contextRecord(f.opens[0]).closed,true);assert.equal(f.timers.size,0);reject(()=>f.wrapper.beginAuthorizedAcquisition(a.ticket));return r;}
for(const name of ['movement-qualification','another-reviewed-service','myapp-backend'])test('explicit reviewed exact name succeeds: '+name,async()=>{
 const f=loadAcquisition({serviceName:name}),r=await success(f);assert.equal(r.reviewedTarget.serviceNameObserved,name);
 assert(f.trace.indexOf('startTargetIdentitySession')<f.trace.indexOf('openExecutionContext'));
});
test('separate sessions retain distinct names without global leakage',async()=>{
 const a=loadAcquisition({serviceName:'movement-qualification'}),b=loadAcquisition({serviceName:'second-reviewed-name'});await Promise.all([success(a),success(b)]);
 assert.equal(a.identity.inspectSession(a.sessions[0]).expectations.serviceName,'movement-qualification');assert.equal(b.identity.inspectSession(b.sessions[0]).expectations.serviceName,'second-reviewed-name');
});
const serviceBody=(name,id='synthetic-service',project='synthetic-project')=>({data:{project:{id:project,services:{edges:[{node:{id,name}}],pageInfo:{hasNextPage:false}}}}});
const badServices={
 wrongID:()=>serviceBody('movement-qualification','wrong-id'),wrongName:()=>serviceBody('other'),case:()=>serviceBody('MOVEMENT-QUALIFICATION'),
 leadingSpace:()=>serviceBody(' movement-qualification'),trailingSpace:()=>serviceBody('movement-qualification '),fuzzy:()=>serviceBody('movement-qualification-copy'),
 alias:()=>serviceBody('qualification'),wildcard:()=>serviceBody('*'),historicalFallback:()=>serviceBody('myapp-backend'),wrongProject:()=>serviceBody('movement-qualification','synthetic-service','wrong-project'),
 duplicateID:()=>{const b=serviceBody('movement-qualification');b.data.project.services.edges.push({node:{id:'synthetic-service',name:'unrelated'}});return b;},
 duplicateName:()=>{const b=serviceBody('movement-qualification');b.data.project.services.edges.push({node:{id:'different',name:'movement-qualification'}});return b;},
 incomplete:()=>{const b=serviceBody('movement-qualification');b.data.project.services.pageInfo.hasNextPage=true;return b;},
 extraShape:()=>{const b=serviceBody('movement-qualification');b.data.project.extra=true;return b;}
};
for(const[k,body]of Object.entries(badServices))test('machine rejects before human prompt: '+k,async()=>{
 const f=loadAcquisition({serviceName:'movement-qualification',bodies:{Movement0111ProjectServices:body()}}),a=f.authorized(),h=f.wrapper.beginAuthorizedAcquisition(a.ticket);await flush();
 reject(()=>f.wrapper.takePendingHumanReview(h));assert.equal(f.calls.length,2);assert.equal(f.contextRecord(f.opens[0]).closed,true);assert(!f.trace.includes('approveObservedServiceCandidate'));
});
test('unrelated first service and historical service do not displace exact reviewed candidate',async()=>{
 const b=serviceBody('movement-qualification');b.data.project.services.edges.unshift({node:{id:'old-id',name:'myapp-backend'}});
 await success(loadAcquisition({serviceName:'movement-qualification',bodies:{Movement0111ProjectServices:b}}));
});
for(const name of ['other','MOVEMENT-QUALIFICATION','movement-qualification ','myapp-backend'])test('instance uses same reviewed exact name: '+name,async()=>{
 const f=loadAcquisition({serviceName:'movement-qualification',bodies:{Movement0111ServiceInstance:{data:{serviceInstance:{id:'synthetic-instance',serviceName:name,rootDirectory:'/movement-app',region:null}}}}});
 const a=f.authorized(),h=f.wrapper.beginAuthorizedAcquisition(a.ticket),p=await f.pending(h,'service_review');f.wrapper.submitServiceReview(h,p.review,serviceAck(p));await flush();
 reject(()=>f.wrapper.takePendingHumanReview(h));assert.equal(f.calls.length,3);assert.equal(f.contextRecord(f.opens[0]).closed,true);
});
for(const mode of ['name','ID','project','environment','duplicateName','unreviewed','incomplete','oldVersion','evidenceDigest','evidenceRecord','host','inputReviewer'])test('reviewed input schema/context rejects '+mode,()=>{
 const f=loadAcquisition({serviceName:'movement-qualification'}),x=draft(f);rewrite(f,x,c=>{
  if(mode==='name')c.expectedTarget.serviceName='other';if(mode==='ID')c.expectedTarget.serviceId='other';if(mode==='project')c.expectedTarget.projectId='other';if(mode==='environment')c.expectedTarget.environmentId='other';
  if(mode==='duplicateName')c.expectedTarget.expectations={serviceName:c.expectedTarget.serviceName};if(mode==='unreviewed')c.targetInputSources.serviceName.independentlyReviewed=false;
  if(mode==='incomplete')c.inputReviewComplete=false;if(mode==='oldVersion')c.version='movement_railway_identity_acquisition_auth_v2';
  if(mode==='evidenceDigest')c.evidenceBinding.sha256='0'.repeat(64);if(mode==='evidenceRecord')c.evidenceBinding.record='expectedContext';
  if(mode==='host')c.hostReview.checklist.noTokenInArgv=false;if(mode==='inputReviewer')c.independentReview.reviewed=false;
 });reject(()=>create(f,x));assert.equal(f.reads.length,0);assert.equal(f.opens.length,0);
});
for(const mode of ['getter','symbol','hidden','extra','path','hash'])test('caller descriptor rejects '+mode+' without authority',()=>{
 const f=loadAcquisition(),x=draft(f),v=x.inputs.descriptor;let gets=0;
 if(mode==='getter')Object.defineProperty(v,'path',{enumerable:true,get(){gets++;return 'bad';}});if(mode==='symbol')v[Symbol('hidden')]=true;
 if(mode==='hidden')Object.defineProperty(v,'hidden',{value:true});if(mode==='extra')v.extra=true;if(mode==='path')v.path='0102-remote-fixtures.capsule';if(mode==='hash')v.sha256='0'.repeat(64);
 reject(()=>create(f,x));assert.equal(gets,0);assert.equal(f.reads.length,0);
});
test('snapshot is deeply frozen and independent of caller mutation',()=>{
 const f=loadAcquisition(),x=draft(f),d=create(f,x);x.inputs.descriptor.path='untrusted';x.inputs.package.expectedTarget.serviceName='untrusted';x.inputs.package.independentReview.reviewed=false;
 const r=f.auth.reviewExecutableAcquisitionPackage(d);assert.equal(r.manifest.expectedTarget.serviceName,'myapp-backend');
 for(const o of [r.manifest,r.manifest.expectedTarget,r.manifest.expectedTarget.inputReview,r.manifest.expectedTarget.inputReview.evidenceBinding])assert(Object.isFrozen(o));
 assert.throws(()=>{r.manifest.expectedTarget.serviceName='changed';});assert(!Object.hasOwn(r.manifest.expectedTarget.expectations,'serviceName'));
 assert.equal(r.manifest.version,'movement_railway_identity_acquisition_auth_v3');
});
for(const phase of ['review','approval','authorize','redemption'])for(const artifact of ['input','evidence'])test('stale '+artifact+' rejected at '+phase,()=>{
 const f=loadAcquisition(),x=draft(f),d=create(f,x);let r,a;
 if(phase!=='review')r=f.auth.reviewExecutableAcquisitionPackage(d);
 const ack=()=>({reviewed:true,manifest:clone(r.manifest),manifestSha256:r.manifestSha256,contextReview:{...clone(r.contextReviewMetadata),reviewed:true},hostChecklist:x.inputs.package.hostReview.checklist});
 if(['authorize','redemption'].includes(phase))a=f.auth.approveExecutableAcquisitionPackageReview(r,x.target,ack());
 let ticket;if(phase==='redemption')ticket=f.auth.authorizeAcquisition(d,x.target,{...clone(a.finalAcknowledgementTemplate),manualLiveAuthorization:true});
 const p=artifact==='input'?x.inputs.packagePath:x.inputs.evidencePath;f.drift.files.set(p,f.drift.files.get(p)+' ');
 reject(()=>phase==='review'?f.auth.reviewExecutableAcquisitionPackage(d):phase==='approval'?f.auth.approveExecutableAcquisitionPackageReview(r,x.target,ack()):phase==='authorize'?f.auth.authorizeAcquisition(d,x.target,{...clone(a.finalAcknowledgementTemplate),manualLiveAuthorization:true}):f.wrapper.beginAuthorizedAcquisition(ticket));
 assert.equal(f.reads.length,0);assert.equal(f.opens.length,0);
});
test('canonical CRLF text identity is accepted without raw-byte convention',()=>{
 const f=loadAcquisition(),x=draft(f);for(const p of [x.inputs.packagePath,x.inputs.evidencePath])f.drift.files.set(p,f.drift.files.get(p).replace(/\n/g,'\r\n'));
 assert(f.auth.reviewExecutableAcquisitionPackage(create(f,x)));
});
test('old executable version cannot be substituted into v3 final acknowledgement',()=>{
 const f=loadAcquisition(),a=f.reviewed();reject(()=>f.auth.authorizeAcquisition(a.draft,a.target,{...clone(a.approved.finalAcknowledgementTemplate),version:'movement_railway_identity_acquisition_auth_v2',manualLiveAuthorization:true}));assert.equal(f.opens.length,0);
});
for(const mode of ['copy','plain','serialized','wrongBinding','wrongArity','replay'])test('private permit rejects '+mode+' and burns on located misuse',()=>{
 const driver={fail:'startTargetIdentitySession'},f=loadAcquisition(driver),a=f.authorized();reject(()=>f.wrapper.beginAuthorizedAcquisition(a.ticket));
 const entry=f.records.find(r=>r.key===a.draft).value,permit=f.records.filter(r=>r.value===entry).at(-1).key;driver.fail=null;
 if(mode==='replay'){f.identity.startTargetIdentitySession(a.target,permit);reject(()=>f.identity.startTargetIdentitySession(a.target,permit));}
 else if(mode==='wrongBinding'){reject(()=>f.identity.startTargetIdentitySession(f.binding(),permit));reject(()=>f.identity.startTargetIdentitySession(a.target,permit));}
 else if(mode==='wrongArity'){reject(()=>f.identity.startTargetIdentitySession(a.target,permit,'extra'));reject(()=>f.identity.startTargetIdentitySession(a.target,permit));}
 else reject(()=>f.identity.startTargetIdentitySession(a.target,mode==='plain'?{serviceName:'myapp-backend'}:clone(permit)));
 assert.equal(f.opens.length,0);assert.equal(f.reads.length,0);
});
test('context-only session cannot issue services or instance requests even with synthetic accepted context',()=>{
 const f=loadAcquisition(),s=f.identity.startTargetIdentitySession(f.binding()),r=f.records.find(e=>e.key===s).value;
 r.contextFacts={projectId:'synthetic-project',environmentId:'synthetic-env'};r.executionContext=Object.freeze({});
 for(const stage of ['project_services','service_instance']){r.stage=stage;reject(()=>f.identity.reviewNextIdentityRequest(s));}
 assert.equal(f.identity.inspectSession(s).expectations.serviceName,null);assert.equal(f.opens.length,0);assert.equal(f.reads.length,0);
});
test('normal exports have no permit connector/getter/mint and remain context-only without a permit',()=>{
 const identity=require('../../scripts/assessment-worker/qualification-railway-target-identity.cjs'),auth=require('../../scripts/assessment-worker/qualification-railway-live-authorization.cjs');
 for(const api of [identity,auth]){assert(Object.isFrozen(api));assert(!Reflect.ownKeys(api).some(k=>/_connect|consumeAcquisitionTarget|mint/i.test(String(k))));}
 const f=loadAcquisition();reject(()=>identity.startTargetIdentitySession(f.binding(),{}));assert.equal(f.reads.length,0);
});
test('duplicate JSON name keys are rejected instead of choosing precedence',()=>{
 const f=loadAcquisition(),x=draft(f);const text=f.drift.files.get(x.inputs.packagePath).replace('"serviceName":"myapp-backend"','"serviceName":"other","serviceName":"myapp-backend"');
 f.drift.files.set(x.inputs.packagePath,text);x.inputs.descriptor.sha256=hash(text);reject(()=>create(f,x));assert.equal(f.reads.length,0);
});
test('post-load identity replacement cannot receive or redeem permit',()=>{
 const driver={},f=loadAcquisition(driver),a=f.authorized();driver.ownerReplacement=true;reject(()=>f.wrapper.beginAuthorizedAcquisition(a.ticket));assert.equal(f.opens.length,0);assert.equal(f.reads.length,0);
});
test('non-null wrong instance constraint still fails after both exact service checks',async()=>{
 const f=loadAcquisition({serviceName:'movement-qualification',expectedInstanceId:'different-instance'}),a=f.authorized(),h=f.wrapper.beginAuthorizedAcquisition(a.ticket),p=await f.pending(h,'service_review');
 f.wrapper.submitServiceReview(h,p.review,serviceAck(p));await flush();reject(()=>f.wrapper.takePendingHumanReview(h));assert.equal(f.calls.length,3);assert.equal(f.contextRecord(f.opens[0]).closed,true);
});
for(const first of ['qualification-railway-live-authorization.cjs','qualification-railway-target-identity.cjs'])test('private initialization completes under import order '+first,()=>{
 const base=path.resolve(__dirname,'../../scripts/assessment-worker'),script=`const assert=require('node:assert/strict');require(${JSON.stringify(path.join(base,first))});for(const f of ['qualification-railway-live-authorization.cjs','qualification-railway-target-identity.cjs']){const m=require(${JSON.stringify(base)}+'/'+f);assert(Object.isFrozen(m));assert(!Reflect.ownKeys(m).some(k=>String(k).startsWith('_connect')));}`;
 require('node:child_process').execFileSync(process.execPath,['-e',script],{env:{},windowsHide:true});
});
