'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const {loadAcquisition,clone,inventory,serviceAck,targetAck}=require('./fixtures/0114d-acquisition-wrapper.cjs');
const base=path.resolve(__dirname,'../../scripts/assessment-worker'),normal=require(path.join(base,'qualification-railway-live-authorization.cjs')),wrapper=require(path.join(base,'qualification-railway-acquisition-wrapper.cjs'));
const reject=fn=>assert.throws(fn,/unavailable/);
const flush=async()=>{for(let i=0;i<80;i++)await Promise.resolve();};
function closed(f){assert.equal(f.opens.length,1);assert.equal(f.contextRecord(f.opens[0]).closed,true);assert.equal(f.contextRecord(f.opens[0]).secret,null);assert.equal(f.timers.size,0);}
async function service(f){const a=f.authorized(),h=f.wrapper.beginAuthorizedAcquisition(a.ticket),p=await f.pending(h,'service_review');return{a,h,p};}
async function target(f){const x=await service(f);f.wrapper.submitServiceReview(x.h,x.p.review,serviceAck(x.p));x.p=await f.pending(x.h,'candidate');return x;}
test.beforeEach(t=>{let calls=0;for(const[o,k]of[[require('node:https'),'request'],[require('node:http'),'request'],[global,'fetch']])t.mock.method(o,k,()=>{calls++;throw Error('REAL NETWORK FORBIDDEN');});t.after(()=>assert.equal(calls,0));});
test('exact success uses one S/C, three provider operations, two manual gates and closes before descriptive return',async()=>{
 const f=loadAcquisition(),x=await service(f);
 assert.equal(f.calls.length,2);assert.equal(f.identity.inspectSession(f.sessions[0]).stage,'service_review');
 assert.equal(f.contextRecord(f.opens[0]).closed,false);assert.equal(f.trace.includes('approveObservedServiceCandidate'),false);
 assert.equal(f.timers.size,1);assert.equal([...f.timers.values()][0].ms,300000);
 f.wrapper.submitServiceReview(x.h,x.p.review,serviceAck(x.p));const p=await f.pending(x.h,'candidate');
 assert.equal(f.calls.length,3);assert.equal(f.trace.includes('approveTargetCandidate'),false);
 const result=f.wrapper.submitTargetReview(x.h,p.review,targetAck(p));closed(f);
 assert.deepEqual(f.calls.map(c=>c.request.operationName),['Movement0108ProjectTokenContext','Movement0111ProjectServices','Movement0111ServiceInstance']);
 assert.equal(f.sessions.length,1);assert.equal(f.opens.length,1);assert.deepEqual(f.reads,['RAILWAY_TOKEN']);
 assert.equal(result.stage,'reviewed');assert.equal(result.reviewedTarget.humanReviewed,true);assert.ok(Object.isFrozen(result));assert.ok(Object.isFrozen(result.reviewedTarget));
 assert.deepEqual(Object.keys(result).sort(),['outcome','stage','reviewedTarget','providerRequests','manualLiveAuthorizationConsumed','liveAuthorized'].sort());
 assert.equal(result.liveAuthorized,false);assert.equal(result.providerRequests,3);
 reject(()=>f.wrapper.cancelAcquisition(x.h));reject(()=>f.wrapper.beginAuthorizedAcquisition(x.a.ticket));reject(()=>f.wrapper.submitTargetReview(x.h,p.review,targetAck(p)));
});
test('public API exposes no injection, raw-result issuer or generic resume',()=>{
 assert.deepEqual(Object.keys(wrapper),['beginAuthorizedAcquisition','takePendingHumanReview','submitServiceReview','submitTargetReview','cancelAcquisition']);
 assert.equal(wrapper.resume,undefined);assert.ok(Object.isFrozen(wrapper));
 const f=loadAcquisition();assert.equal(f.reads.length,0);assert.equal(f.calls.length,0);
});
for(const kind of ['planningDraft','planningReview','reviewedPackage','copiedTicket','serializedTicket','legacyAuthorityShape','JSON']){
 test('non-execution capability cannot begin: '+kind,()=>{
  const f=loadAcquisition(),a=f.authorized();let input;
  if(kind==='planningDraft'||kind==='planningReview'){
   const target=f.binding(),legacy={inventoryReviewed:true,...Object.fromEntries(['projectIds','environmentIds','serviceIds','serviceInstanceIds'].map(k=>[k,{reviewed:true,ids:[]}]))};
   const d=f.auth.createAcquisitionDraft(target,legacy,{reviewedHead:f.drift.head,reviewedBranch:f.drift.branch});input=kind==='planningDraft'?d:f.auth.reviewAcquisitionPackage(d);
  }else input=kind==='reviewedPackage'?a.approved:kind==='legacyAuthorityShape'?{operationKind:'target_identity_acquisition'}:kind==='JSON'?{stage:'service_review',reviewed:true}:clone(a.ticket);
  reject(()=>f.wrapper.beginAuthorizedAcquisition(input));assert.equal(f.opens.length,0);assert.equal(f.calls.length,0);
 });
}
for(const field of ['S','C','credential','timeout','HTTPS','target','callback']){
 test('extra begin argument burns original ticket before fresh resources: '+field,()=>{
  const f=loadAcquisition(),a=f.authorized();reject(()=>f.wrapper.beginAuthorizedAcquisition(a.ticket,{[field]:true}));
  reject(()=>f.wrapper.beginAuthorizedAcquisition(a.ticket));assert.equal(f.opens.length,0);assert.equal(f.sessions.length,0);assert.equal(f.reads.length,0);
 });
}
for(const mode of ['copiedReview','serializedReview','wrongTarget','inventory','operations','requests','humanService','humanTarget','extraAck','manualShortcut']){
 test('package review rejects mismatch and burns original: '+mode,()=>{
  const f=loadAcquisition(),target=f.binding(),d=f.auth.createExecutableAcquisitionDraft(target,inventory(),{reviewedHead:f.drift.head,reviewedBranch:f.drift.branch},f.input(target).descriptor);
  const r=f.auth.reviewExecutableAcquisitionPackage(d),ack={reviewed:true,manifest:clone(r.manifest),manifestSha256:r.manifestSha256,
   contextReview:{reviewed:true,...clone(r.contextReviewMetadata)},hostChecklist:{nodeMajor:24,...Object.fromEntries(r.hostAttestationKeys.filter(k=>k!=='nodeMajor').map(k=>[k,true]))}};
  const args=[r,target,ack];
  if(mode==='copiedReview'||mode==='serializedReview')args[0]=clone(r);
  if(mode==='wrongTarget')args[1]=f.binding();if(mode==='inventory')ack.manifest.forbiddenRailwayInventory.serviceIds.ids.push('other');
  if(mode==='operations')ack.manifest.orderedOperations.reverse();if(mode==='requests')ack.manifest.maxProviderRequests=4;
  if(mode==='humanService')ack.manifest.humanServiceReviewRequired=false;if(mode==='humanTarget')ack.manifest.finalHumanTargetReviewRequired=false;
  if(mode==='extraAck')ack.extra=true;if(mode==='manualShortcut')ack.manualLiveAuthorization=true;
  reject(()=>f.auth.approveExecutableAcquisitionPackageReview(...args));
  if(!mode.includes('Review'))reject(()=>f.auth.approveExecutableAcquisitionPackageReview(r,target,ack));
  assert.equal(f.opens.length,0);
 });
}
test('manual=false cannot authorize; exact final acknowledgement creates one ticket and no direct execution',()=>{
 const f=loadAcquisition(),a=f.reviewed();
 reject(()=>f.auth.authorizeAcquisition(a.draft,a.target,a.approved.finalAcknowledgementTemplate));
 reject(()=>f.auth.authorizeAcquisition(a.draft,f.binding(),{...a.approved.finalAcknowledgementTemplate,manualLiveAuthorization:true}));
 const ticket=f.auth.authorizeAcquisition(a.draft,a.target,{...a.approved.finalAcknowledgementTemplate,manualLiveAuthorization:true});
 reject(()=>f.auth.authorizeAcquisition(a.draft,a.target,{...a.approved.finalAcknowledgementTemplate,manualLiveAuthorization:true}));
 assert.ok(Object.isFrozen(ticket));assert.deepEqual(Object.keys(ticket),[]);assert.equal(JSON.stringify(ticket),'{}');
 assert.equal(f.auth.consumeAcquisitionTicket,undefined);assert.equal(f.auth.takeAcquisitionExecutionAuthority,undefined);
 reject(()=>f.wrapper.beginAuthorizedAcquisition(clone(ticket)));
 assert.equal(f.opens.length,0);const h=f.wrapper.beginAuthorizedAcquisition(ticket);
 reject(()=>f.wrapper.beginAuthorizedAcquisition(ticket));f.wrapper.cancelAcquisition(h);closed(f);
});
for(const phase of ['review','authorize','redemption','redemptionAfterCopy'])for(const drift of ['head','branch',...Object.keys(normal.sourceHashes),'self']){
 test('code drift fails closed at '+phase+': '+drift,()=>{
  const f=loadAcquisition();let a,target,draft,ticket;
  if(phase==='review'){target=f.binding();draft=f.auth.createExecutableAcquisitionDraft(target,inventory(),{reviewedHead:f.drift.head,reviewedBranch:f.drift.branch},f.input(target).descriptor);}
  else {a=f.reviewed();if(phase==='redemption'||phase==='redemptionAfterCopy')ticket=f.auth.authorizeAcquisition(a.draft,a.target,{...a.approved.finalAcknowledgementTemplate,manualLiveAuthorization:true});if(phase==='redemptionAfterCopy')reject(()=>f.wrapper.beginAuthorizedAcquisition(clone(ticket)));}
  if(drift==='head')f.drift.head='b'.repeat(40);else if(drift==='branch')f.drift.branch='other';else{
   const file=path.join(base,drift==='self'?'qualification-railway-live-authorization.cjs':drift);f.drift.files.set(file,fs.readFileSync(file,'utf8')+'// drift');}
  reject(()=>phase==='review'?f.auth.reviewExecutableAcquisitionPackage(draft):phase==='authorize'?f.auth.authorizeAcquisition(a.draft,a.target,{...a.approved.finalAcknowledgementTemplate,manualLiveAuthorization:true}):f.wrapper.beginAuthorizedAcquisition(ticket));
  if(phase==='ticket'||phase==='authority'){f.drift.files.clear();f.drift.head='a'.repeat(40);f.drift.branch='feature/0092-shared-segment-suitability';reject(()=>phase==='ticket'?f.wrapper.beginAuthorizedAcquisition(ticket):f.wrapper.beginAuthorizedAcquisition(authority));}
  assert.equal(f.opens.length,0);assert.equal(f.reads.length,0);
 });
}
for(const stage of ['service_review','candidate'])for(const mode of ['copied','serialized','wrongReview','extraArgs','badAck','rejected','wrongGate']){
 test('invalid human submit terminates and burns: '+stage+' '+mode,async()=>{
  const f=loadAcquisition(),x=stage==='service_review'?await service(f):await target(f),submit=stage==='service_review'?'submitServiceReview':'submitTargetReview';
  const ack=stage==='service_review'?serviceAck(x.p):targetAck(x.p),args=[x.h,x.p.review,ack];
  if(mode==='copied'||mode==='serialized')args[1]=clone(x.p.review);
  if(mode==='wrongReview')args[1]={reviewed:true};if(mode==='extraArgs')args.push(true);
  if(mode==='badAck')ack.extra=true;if(mode==='rejected')ack.reviewed=false;
  reject(()=>f.wrapper[mode==='wrongGate'?(stage==='service_review'?'submitTargetReview':'submitServiceReview'):submit](...args));
  closed(f);reject(()=>f.wrapper[submit](x.h,x.p.review,ack));assert.equal(f.calls.length,stage==='service_review'?2:3);
 });
}
for(const stage of ['service_review','candidate'])for(const kind of ['timer','deadlineOnly']){
 test('finite human timeout terminates, closes and burns original owner review: '+stage+' '+kind,async()=>{
  const f=loadAcquisition(),x=stage==='service_review'?await service(f):await target(f),s=f.sessions[0];
  if(kind==='timer')f.advance(300000);else{f.elapse(300000);reject(()=>stage==='service_review'?f.wrapper.submitServiceReview(x.h,x.p.review,serviceAck(x.p)):f.wrapper.submitTargetReview(x.h,x.p.review,targetAck(x.p)));}
  closed(f);reject(()=>f.wrapper.takePendingHumanReview(x.h));
  reject(()=>stage==='service_review'?f.identity.approveObservedServiceCandidate(x.p.review,s,serviceAck(x.p)):
   f.identity.approveTargetCandidate(x.p.review,{},targetAck(x.p)));
  assert.equal(f.calls.length,stage==='service_review'?2:3);
 });
}
for(const stage of ['service_review','candidate']){
 test('wrong-acquisition original review terminates both located owners: '+stage,async()=>{
  const f=loadAcquisition(),x=stage==='service_review'?await service(f):await target(f),y=stage==='service_review'?await service(f):await target(f);
  reject(()=>stage==='service_review'?f.wrapper.submitServiceReview(x.h,y.p.review,serviceAck(y.p)):f.wrapper.submitTargetReview(x.h,y.p.review,targetAck(y.p)));
  for(const c of f.opens)assert.equal(f.contextRecord(c).closed,true);
  reject(()=>f.wrapper.takePendingHumanReview(x.h));reject(()=>f.wrapper.takePendingHumanReview(y.h));assert.equal(f.timers.size,0);
 });
}
for(const operation of ['Movement0108ProjectTokenContext','Movement0111ProjectServices','Movement0111ServiceInstance'])for(const mode of ['error','redirect','cancel']){
 test('provider terminal '+mode+' at '+operation+' closes with no retry',async()=>{
  const driver=mode==='error'?{errorOperation:operation}:mode==='redirect'?{redirectOperation:operation}:{holdOperation:operation},f=loadAcquisition(driver),a=f.authorized(),h=f.wrapper.beginAuthorizedAcquisition(a.ticket);
  if(operation==='Movement0111ServiceInstance'){const p=await f.pending(h,'service_review');f.wrapper.submitServiceReview(h,p.review,serviceAck(p));}
  await flush();if(mode==='cancel')f.wrapper.cancelAcquisition(h);
  closed(f);assert.equal(f.calls.length,operation==='Movement0108ProjectTokenContext'?1:operation==='Movement0111ProjectServices'?2:3);
  reject(()=>f.wrapper.cancelAcquisition(h));reject(()=>f.wrapper.beginAuthorizedAcquisition(a.ticket));
 });
}
for(const stage of ['service_review','candidate']){
 test('cancel human wait burns handle, prompt and timer: '+stage,async()=>{
  const f=loadAcquisition(),x=stage==='service_review'?await service(f):await target(f);
  reject(()=>f.wrapper.cancelAcquisition(clone(x.h)));assert.equal(f.contextRecord(f.opens[0]).closed,false);
  f.wrapper.cancelAcquisition(x.h);closed(f);reject(()=>f.wrapper.cancelAcquisition(x.h));
  reject(()=>f.wrapper.submitServiceReview(x.h,x.p.review,serviceAck(x.p)));
 });
}
for(const method of ['startTargetIdentitySession','openExecutionContext','acceptContextObservation','reviewObservedServiceCandidate','inspectSession','reviewTargetCandidate','redeemAcquisitionTicketForWrapper']){
 test('internal setup/phase exception is terminal: '+method,async()=>{
  const f=loadAcquisition({fail:method}),a=f.authorized();let h;
  if(['startTargetIdentitySession','openExecutionContext','redeemAcquisitionTicketForWrapper'].includes(method))reject(()=>f.wrapper.beginAuthorizedAcquisition(a.ticket));
  else{h=f.wrapper.beginAuthorizedAcquisition(a.ticket);if(method==='reviewTargetCandidate'){const p=await f.pending(h,'service_review');f.wrapper.submitServiceReview(h,p.review,serviceAck(p));}await flush();}
  if(f.opens.length)closed(f);else assert.equal(f.calls.length,0);
  reject(()=>f.wrapper.beginAuthorizedAcquisition(a.ticket));
 });
}
test('copies/serialized running state cannot resume; duplicate prompt retrieval is terminal',async()=>{
 const f=loadAcquisition(),x=await service(f);
 for(const v of [clone(x.h),{stage:'service_review'},x.p.review])reject(()=>f.wrapper.takePendingHumanReview(v));
 assert.equal(f.contextRecord(f.opens[0]).closed,false);
 reject(()=>f.wrapper.takePendingHumanReview(x.h));closed(f);
});
test('old context authority and provider/adapter capabilities cannot begin acquisition',async()=>{
 const {loadWrapper}=require('./fixtures/0113-first-context-wrapper.cjs'),old=loadWrapper(),a=old.authorized();
 reject(()=>wrapper.beginAuthorizedAcquisition(a.authority));assert.equal(old.calls.length,0);assert.equal(old.reads.length,0);
 const {instancePrepared}=require('./fixtures/0114c-service-instance.cjs'),f=await instancePrepared();
 for(const v of [f.instanceTransfer,f.instanceResult,f.instanceBundle.result])reject(()=>wrapper.beginAuthorizedAcquisition(v));
 f.adapter.closeExecutionContext(f.execution);
});
test('global state stays false/null after exact synthetic completion and safe templates remain unauthorized',async()=>{
 const f=loadAcquisition(),x=await target(f);f.wrapper.submitTargetReview(x.h,x.p.review,targetAck(x.p));closed(f);
 for(const state of [f.auth.state,f.identity.state,f.adapter.status,normal.state]){
  for(const k of ['providerContextObserved','projectEnvironmentContextProven','serviceContextProven','executionSchemaReady'])assert.equal(state[k],false);
  for(const k of ['identity_proven','causality_proven','restart_origin_proven','platformRestart'])assert.equal(state[k],null);
 }
 assert.equal(f.identity.state.targetIdentityObserved,false);
 const v1=normal.acquisitionReviewTemplate(),v2=v1.executableAuthorization;
 assert.equal(v1.manifest.transportSupported,false);assert.equal(v2.manifest.transportSupported,true);
 for(const t of [v1,v2]){assert.equal(t.outcome,'PRELIVE_NOT_AUTHORIZED');assert.equal(t.liveAuthorized,false);assert.equal(t.manualLiveAuthorization,false);
  assert.equal(t.manifest.reviewedHead,null);assert.equal(t.manifest.reviewedBranch,null);assert.equal(t.manifest.forbiddenRailwayInventory.inventoryReviewed,false);
  for(const k of ['projectId','environmentId','serviceId','serviceInstanceId'])assert.equal(t.manifest.expectedTarget[k],null);}
 for(const [file,t]of[['0110-live-review-template.json',normal.reviewTemplate()],['0114a-acquisition-review-template.json',v1]])
  assert.deepEqual(JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../docs',file),'utf8')),t);
});
test('twelve pins; approved v3 runtime changes and self/template hashes bind final bytes',()=>{
 const old=JSON.parse(cp.execFileSync('git',['-c','safe.directory='+path.resolve(__dirname,'../../..'),'show','7f1582bb3eaf244394e91da24909473fc38569fc:movement-app/docs/0110-live-review-template.json'],{encoding:'utf8',env:{},windowsHide:true}));
 assert.equal(Object.keys(normal.sourceHashes).length,12);
 for(const[file,sha]of Object.entries(normal.sourceHashes)){
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(base,file),'utf8').replace(/\r\n/g,'\n')).digest('hex'),sha);
  if(file==='qualification-railway-acquisition-wrapper.cjs')assert.equal(old.manifest.codeIdentity.sourceHashes[file],undefined);
  else if(['qualification-railway-target-identity.cjs','qualification-railway-https-adapter.cjs'].includes(file))assert.notEqual(old.manifest.codeIdentity.sourceHashes[file],sha);
  else assert.equal(old.manifest.codeIdentity.sourceHashes[file],sha);
 }
 assert.notEqual(normal.reviewTemplate().manifest.codeIdentity.authorizationBoundarySha256,old.manifest.codeIdentity.authorizationBoundarySha256);
});

test('close error after invalidation prevents successful result issuance',async()=>{
 const f=loadAcquisition({closeAfterFailure:true}),x=await target(f);
 reject(()=>f.wrapper.submitTargetReview(x.h,x.p.review,targetAck(x.p)));closed(f);
 reject(()=>f.wrapper.takePendingHumanReview(x.h));assert.equal(f.trace.filter(k=>k==='closeExecutionContext').length,1);
});
test('wrong ticket arity burns without creating an execution authority',()=>{
 const f=loadAcquisition(),a=f.reviewed(),ticket=f.auth.authorizeAcquisition(a.draft,a.target,{...a.approved.finalAcknowledgementTemplate,manualLiveAuthorization:true});
 reject(()=>f.wrapper.beginAuthorizedAcquisition(ticket,true));reject(()=>f.wrapper.beginAuthorizedAcquisition(ticket));assert.equal(f.opens.length,0);
});
test('malformed original context body cannot be replaced by an ordinary summary',async()=>{
 const f=loadAcquisition({bodies:{Movement0108ProjectTokenContext:{providerContextObserved:true,projectEnvironmentContextProven:true}}});
 const h=f.wrapper.beginAuthorizedAcquisition(f.authorized().ticket);await flush();closed(f);
 assert.equal(f.calls.length,1);reject(()=>f.wrapper.takePendingHumanReview(h));
});

test('final observed instance forbidden collision closes without reviewed result',async()=>{
 const f=loadAcquisition({forbiddenInstance:'synthetic-instance'}),x=await target(f);
 reject(()=>f.wrapper.submitTargetReview(x.h,x.p.review,targetAck(x.p)));closed(f);reject(()=>f.wrapper.takePendingHumanReview(x.h));
});
test('one ticket cannot fork while first acquisition is active',()=>{
 const f=loadAcquisition({holdOperation:'Movement0108ProjectTokenContext'}),a=f.authorized(),h=f.wrapper.beginAuthorizedAcquisition(a.ticket);
 reject(()=>f.wrapper.beginAuthorizedAcquisition(a.ticket));reject(()=>wrapper.beginAuthorizedAcquisition(a.ticket));
 assert.equal(f.sessions.length,1);assert.equal(f.opens.length,1);assert.equal(f.calls.length,1);f.wrapper.cancelAcquisition(h);closed(f);
});

for(const order of ['authorization-first','wrapper-first']){
 test('normal CommonJS import seals private connector: '+order,()=>{
  const first=order==='authorization-first'?'qualification-railway-live-authorization.cjs':'qualification-railway-acquisition-wrapper.cjs';
  const script=`const assert=require('node:assert/strict'),p=require('node:path');
   require(p.resolve('scripts/assessment-worker',${JSON.stringify(first)}));
   const a=require(p.resolve('scripts/assessment-worker/qualification-railway-live-authorization.cjs'));
   const w=require(p.resolve('scripts/assessment-worker/qualification-railway-acquisition-wrapper.cjs'));
   assert.ok(Object.isFrozen(a));assert.ok(Object.isFrozen(w));
   assert.equal(Object.getPrototypeOf(a),null);assert.equal(Object.getPrototypeOf(w),null);
   for(const k of ['consumeAcquisitionTicket','takeAcquisitionExecutionAuthority','redeemAcquisitionTicketForWrapper','_connectAcquisitionRedemption'])assert.equal(a[k],undefined);
   assert.equal(w._connectAcquisitionRedemption,undefined);
   assert.equal(Reflect.set(w,'_connectAcquisitionRedemption',()=>{}),false);
   assert.equal(Reflect.set(w,'beginAuthorizedAcquisition',()=>{}),false);
   assert.equal(Reflect.ownKeys(w).length,5);`;
  cp.execFileSync(process.execPath,['-e',script],{encoding:'utf8',env:{},windowsHide:true});
 });
}
test('normal authorization exports retain only reviewed public APIs',()=>{
 assert.deepEqual(Object.keys(normal),[
  'state','baselineParentHead','sourceHashes','verifyCodeIdentity',
  'createExecutableAcquisitionDraft','reviewExecutableAcquisitionPackage','approveExecutableAcquisitionPackageReview',
  'authorizeAcquisition','executableAcquisitionReviewTemplate','createAcquisitionDraft','reviewAcquisitionPackage',
  'approveAcquisitionPackageReview','acquisitionReviewTemplate','createDraft','reviewArtifact','reviewPackage',
  'authorizeFirstLiveContext','consumeLiveTicketForContext','takeContextExecutionAuthority','takeFirstContextExecutionAuthority','reviewTemplate']);
 assert.ok(Object.isFrozen(normal));assert.equal(normal.consumeAcquisitionTicket,undefined);
 assert.equal(normal.takeAcquisitionExecutionAuthority,undefined);
});
test('post-initialization arbitrary wrapper replacement burns ticket without exposing execution material',()=>{
 const f=loadAcquisition(),a=f.authorized();let called=0;
 const fake={_connectAcquisitionRedemption(){called++;},beginAuthorizedAcquisition(){called++;}};
 f.replaceWrapper(fake);reject(()=>f.wrapper.beginAuthorizedAcquisition(a.ticket));
 f.replaceWrapper(null);reject(()=>f.wrapper.beginAuthorizedAcquisition(a.ticket));
 assert.equal(called,0);assert.equal(f.opens.length,0);assert.equal(f.sessions.length,0);assert.equal(f.reads.length,0);
});
test('ticket copies and serialization grant no capability and leave original usable only by its wrapper',()=>{
 const f=loadAcquisition({holdOperation:'Movement0108ProjectTokenContext'}),a=f.authorized();
 for(const v of [{...a.ticket},clone(a.ticket),()=>{}])reject(()=>f.wrapper.beginAuthorizedAcquisition(v));
 reject(()=>wrapper.beginAuthorizedAcquisition(a.ticket));assert.equal(f.opens.length,0);
 const h=f.wrapper.beginAuthorizedAcquisition(a.ticket);
 assert.deepEqual(Object.keys(h),[]);assert.ok(Object.isFrozen(h));assert.equal(f.opens.length,1);
 f.wrapper.cancelAcquisition(h);closed(f);
});
test('context, services and instance adapter capabilities remain separate from acquisition tickets',async()=>{
 const {instancePrepared}=require('./fixtures/0114c-service-instance.cjs'),f=await instancePrepared();
 for(const v of [f.target,f.session,f.execution,f.contextHand,f.contextBinding,f.contextResult,f.contextReceipt,
  f.servicesTransfer,f.servicesResult,f.servicesBundle.result,f.servicesBundle.invocation,
  f.instanceHand,f.instanceTransfer,f.instanceResult,f.instanceBundle.result,f.instanceBundle.invocation])
  reject(()=>wrapper.beginAuthorizedAcquisition(v));
 f.adapter.closeExecutionContext(f.execution);
});

test('public acquisition artifacts never contain private execution capability identities',async()=>{
 const f=loadAcquisition(),a=f.authorized();
 const retained=f.records.find(r=>r.key===a.draft&&Object.hasOwn(r.value,'ticketIssued')).value;
 const h=f.wrapper.beginAuthorizedAcquisition(a.ticket),run=f.run(h);
 const forbidden=[retained.binding,retained.contextHandoff,retained.inventoryReview,run.session,run.executionContext];
 const scan=v=>{assert.equal(forbidden.includes(v),false);if(v&&typeof v==='object')for(const child of Object.values(v))scan(child);};
 for(const v of [a.draft,a.review,a.approved,a.ticket,h])scan(v);
 const s=await f.pending(h,'service_review');scan(s);
 scan(f.wrapper.submitServiceReview(h,s.review,serviceAck(s)));
 const p=await f.pending(h,'candidate');scan(p);
 const result=f.wrapper.submitTargetReview(h,p.review,targetAck(p));scan(result);closed(f);
});
