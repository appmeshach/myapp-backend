'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), cp = require('node:child_process');
const base = path.resolve(__dirname, '../../scripts/assessment-worker');
const adapter = require(path.join(base, 'qualification-railway-https-adapter.cjs'));
const ingress = require(path.join(base, 'qualification-railway-target-identity-provider-boundary.cjs'));
const identity = require(path.join(base, 'qualification-railway-target-identity.cjs'));
const auth = require(path.join(base, 'qualification-railway-live-authorization.cjs'));
const { scope, binding, clone, loadServices, opened, contextResult, attested, identityHand, bound, resulted, prepared,
 instanceBody, servicesAccepted, approved, instanceBound, instanceResulted, instancePrepared } = require('./fixtures/0114c-service-instance.cjs');
const reject = fn => assert.throws(fn, /unavailable/), rejects = promise => assert.rejects(promise, /unavailable/);
const cleanup = (t, f) => { t.after(() => f.adapter.closeExecutionContext(f.execution)); return f; };
const acceptInstance = f => f.identity.acceptIdentityObservation(f.session, f.instanceBundle.invocation, f.instanceBundle.result);
test.beforeEach(t => {
 let attempts = 0;
 for (const [owner, method] of [[require('node:https'), 'request'], [require('node:http'), 'request'], [global, 'fetch']])
  t.mock.method(owner, method, () => { attempts++; throw Error('REAL NETWORK FORBIDDEN'); });
 t.after(() => assert.equal(attempts, 0));
});
test('same original approved S/C executes one exact instance query and stops at candidate with C open', async t => {
 const f = cleanup(t, await instancePrepared()), call = f.calls[2], record = f.contextRecord(f.execution);
 assert.equal(f.calls.length, 3); assert.deepEqual(f.calls.map(c => c.request.operationName),
  ['Movement0108ProjectTokenContext','Movement0111ProjectServices','Movement0111ServiceInstance']);
 assert.equal(call.options.hostname, 'backboard.railway.com'); assert.equal(call.options.path, '/graphql/v2');
 assert.equal(call.options.method, 'POST'); assert.equal(call.options.rejectUnauthorized, true); assert.equal(call.options.agent, false);
 assert.deepEqual(Object.keys(call.options.headers), ['Content-Type','Project-Access-Token']);
 assert.equal(call.options.headers['Project-Access-Token'], 'synthetic-private-credential');
 assert.deepEqual(call.request.variables, { serviceId: scope.serviceId, environmentId: scope.environmentId });
 assert.deepEqual(Object.keys(call.request).sort(), ['operationName','query','variables']);
 assert.equal(call.request.query, identity.documents.serviceInstance.source);
 assert.equal(crypto.createHash('sha256').update(call.request.query + '\n').digest('hex'), 'e247e7ec5e98cc71bc399304c37846ede31d7009096da4449f9bc8e88f267493');
 const status = acceptInstance(f); assert.equal(status.stage, 'candidate');
 assert.equal(status.ids.serviceInstanceId.providerObservedValue, 'synthetic-instance');
 assert.equal(record.closed, false); assert.equal(record.attested, true); assert.equal(record.busy, false);
 assert.equal(record.instanceAttempt.phase, 'consumed'); assert.equal(record.servicesAttempt.phase, 'consumed');
 assert.equal(f.sessionRecord(f.session).candidate.humanReviewed, false);
 assert.equal(f.records.some(e => e.value.session === f.session && Object.keys(e.value).sort().join('|') === 'revision|session'), false);
 const review = f.identity.reviewTargetCandidate(f.session); assert.equal(review.candidate.humanReviewed, false);
 assert.equal(f.identity.inspectSession(f.session).stage, 'candidate');
 assert.deepEqual(f.reads, ['RAILWAY_TOKEN']); assert.equal(f.timers.size, 0);
});
test('production surface is narrow with no issuer/consumer/installer/generic executor or live acquisition authority', () => {
 assert.deepEqual(Object.keys(ingress), ['status','takeObservation']); assert.equal(Reflect.has(ingress,'_connectProjectServicesConsumer'), false);
 for (const k of ['bindServiceInstanceTransfer','executeServiceInstance','prepareServiceInstanceResult','cancelServiceInstanceTransfer']) assert.equal(typeof adapter[k], 'function');
 for (const k of ['consumeServiceInstanceReceipt','issueObservation','executeIdentityRequest','authorizeLiveAcquisition','takeAcquisitionExecutionAuthority']) {
  assert.equal(adapter[k], undefined); assert.equal(ingress[k], undefined); assert.equal(auth[k], undefined);
 }
 const f = loadServices(); assert.equal(f.reads.length, 0); assert.equal(f.calls.length, 0);
});
for (const phase of ['context_expected','project_services','service_review']) {
 test('human gate cannot be skipped at ' + phase, async t => {
  const f = cleanup(t, phase === 'context_expected' ? opened() : phase === 'project_services' ? await attested() : await servicesAccepted());
  if (phase !== 'project_services') reject(() => f.identity.reviewNextIdentityRequest(f.session));
  const fake = { ...scope, humanReviewed: true, kind: 'service_instance', request: { query: identity.documents.serviceInstance.source } };
  reject(() => f.adapter.bindServiceInstanceTransfer(f.execution, f.session, fake));
  assert.equal(f.calls.length, phase === 'context_expected' ? 0 : phase === 'project_services' ? 1 : 2);
 });
}
for (const mode of ['copiedReview','serializedReview','fakeAck','otherSession','staleRevision']) {
 test('only exact original existing human service approval enables instance: ' + mode, async t => {
  const f = cleanup(t, await servicesAccepted()), review = f.identity.reviewObservedServiceCandidate(f.session);
  const args = [review, f.session, { ...clone(review), reviewed: true }];
  if (mode === 'copiedReview') args[0] = { ...review };
  if (mode === 'serializedReview') args[0] = clone(review);
  if (mode === 'fakeAck') args[0] = args[2];
  if (mode === 'otherSession') args[1] = f.identity.startTargetIdentitySession(f.target);
  if (mode === 'staleRevision') f.sessionRecord(f.session).revision++;
  reject(() => f.identity.approveObservedServiceCandidate(...args));
  reject(() => f.identity.reviewNextIdentityRequest(f.session));
  reject(() => f.adapter.bindServiceInstanceTransfer(f.execution, f.session, { ...clone(review), humanReviewed: true }));
  assert.equal(f.calls.length, 2);
 });
}
for (const mode of ['copiedHand','serializedHand','builtHand','wrongSession','copiedSession','wrongContext','copiedContext','otherTarget','otherAcquisition','staleRevision','extraArgs']) {
 test('original handoff/session/context ownership rejects: ' + mode, async t => {
  const f = cleanup(t, await approved()), hand = identityHand(f), args = [f.execution, f.session, hand];
  if (mode === 'copiedHand') args[2] = { ...hand };
  if (mode === 'serializedHand') args[2] = clone(hand);
  if (mode === 'builtHand') args[2] = { ...scope, kind: 'service_instance', humanReviewed: true };
  if (mode === 'wrongSession') args[1] = f.identity.startTargetIdentitySession(f.target);
  if (mode === 'copiedSession') args[1] = clone(f.session);
  if (mode === 'wrongContext') args[0] = f.adapter.openExecutionContext(f.target);
  if (mode === 'copiedContext') args[0] = clone(f.execution);
  if (mode === 'otherTarget') args[0] = f.adapter.openExecutionContext(binding());
  if (mode === 'otherAcquisition') { const g = cleanup(t, await approved()); args[0] = g.execution; args[1] = g.session; }
  if (mode === 'staleRevision') f.sessionRecord(f.session).revision++;
  if (mode === 'extraArgs') args.push(true);
  reject(() => f.adapter.bindServiceInstanceTransfer(...args)); assert.equal(f.calls.length, 2);
  if (['wrongContext','otherTarget'].includes(mode)) f.adapter.closeExecutionContext(args[0]);
  if (!['copiedHand','serializedHand','builtHand'].includes(mode)) reject(() => f.identity.takeIdentityHandoffForFutureAdapter(hand, f.session, f.execution));
 });
}
for (const key of ['query','variables','operationName','endpoint','authHeader','token','callback']) {
 test('caller cannot supply ' + key, async t => {
  const f = cleanup(t, await approved()), hand = identityHand(f);
  reject(() => f.adapter.bindServiceInstanceTransfer(f.execution, f.session, hand, { [key]: 'synthetic' }));
  assert.equal(f.calls.length, 2); assert.equal(f.contextRecord(f.execution).closed, true);
 });
}
for (const mode of ['query','operation','serviceId','environmentId','extraRequest','extraVariable','hidden','getter']) {
 test('fixed request rejects private corruption before dispatch: ' + mode, async t => {
  const f = cleanup(t, await approved()), hand = identityHand(f), entry = f.records.find(r => r.key === hand).value;
  const request = clone(entry.request); let reads = 0;
  if (mode === 'query') request.query += ' ';
  if (mode === 'operation') request.operationName = 'Movement0111ProjectServices';
  if (mode === 'serviceId') request.variables.serviceId = 'other';
  if (mode === 'environmentId') request.variables.environmentId = 'other';
  if (mode === 'extraRequest') request.extra = true;
  if (mode === 'extraVariable') request.variables.id = scope.projectId;
  if (mode === 'hidden') Object.defineProperty(request.variables,'extra',{value:true});
  if (mode === 'getter') Object.defineProperty(request.variables,'serviceId',{enumerable:true,get(){reads++;throw Error('MUST NOT READ');}});
  if (mode === 'getter') {
   const transfer = f.adapter.bindServiceInstanceTransfer(f.execution, f.session, hand);
   f.transferRecord(transfer).request = request;
   await rejects(f.adapter.executeServiceInstance(transfer));
  } else { entry.request = request; reject(() => f.adapter.bindServiceInstanceTransfer(f.execution, f.session, hand)); }
  assert.equal(reads,0); assert.equal(f.calls.length,2);
 });
}
for (const mode of ['absent','session','context','binding','phase','owner']) {
 test('consumed original services history is required: ' + mode, async t => {
  const f = cleanup(t, await approved()), hand = identityHand(f), record = f.contextRecord(f.execution);
  if (mode === 'absent') record.servicesAttempt = null;
  if (mode === 'session') record.servicesAttempt.session = {};
  if (mode === 'context') record.servicesAttempt.executionContext = {};
  if (mode === 'binding') record.servicesAttempt.binding = binding();
  if (mode === 'phase') record.servicesAttempt.phase = 'receipt';
  if (mode === 'owner') record.servicesAttempt.owner = { ...f.identity };
  reject(() => f.adapter.bindServiceInstanceTransfer(f.execution, f.session, hand)); assert.equal(f.calls.length,2);
 });
}
test('request retains approved provider service and accepted environment, frozen against mutation', async t => {
 const f = cleanup(t, await instanceBound()), e = f.transferRecord(f.instanceTransfer), state = f.sessionRecord(f.session);
 assert.equal(e.request.variables.serviceId,state.serviceApproval.facts.serviceId);
 assert.equal(e.request.variables.environmentId,state.contextFacts.environmentId);
 assert.equal(e.servicesHistory, f.contextRecord(f.execution).servicesAttempt);
 assert.ok(Object.isFrozen(e.request)); assert.ok(Object.isFrozen(e.request.variables));
 assert.throws(() => { e.request.variables.serviceId = 'other'; },TypeError);
 f.replaceOwner({ ...f.identity }); await rejects(f.adapter.executeServiceInstance(f.instanceTransfer)); assert.equal(f.calls.length,2);
});
test('duplicate/concurrent execute sends one request; original succeeds and services cannot dispatch again', async t => {
 const f = cleanup(t, await instanceBound({hold:true})), pending = f.adapter.executeServiceInstance(f.instanceTransfer);
 await rejects(f.adapter.executeServiceInstance(f.instanceTransfer));
 await rejects(f.adapter.executeProjectServices(f.servicesTransfer));
 assert.equal(f.calls.length,3); f.calls[2].respond(); const result = await pending;
 f.instanceBundle = f.adapter.prepareServiceInstanceResult(result,f.instanceTransfer); assert.equal(acceptInstance(f).stage,'candidate');
 await rejects(f.adapter.executeServiceInstance(f.instanceTransfer)); assert.equal(f.calls.length,3);
});
test('second instance bind is blocked permanently even with VM-only restored owner stage', async t => {
 const f = cleanup(t, await instanceBound()), state = f.sessionRecord(f.session);
 state.stage = 'service_instance'; const hand = identityHand(f);
 reject(() => f.adapter.bindServiceInstanceTransfer(f.execution,f.session,hand));
 await rejects(f.adapter.executeServiceInstance(f.instanceTransfer)); assert.equal(f.calls.length,2);
});
for (const mode of ['copied','serialized','built','copiedTransfer','otherResult','extraArgs','missingArg']) {
 test('result/transfer preparation burns located capabilities: ' + mode, async t => {
  const f = cleanup(t, await instanceResulted()), args=[f.instanceResult,f.instanceTransfer];
  if (mode === 'copied') args[0]={...f.instanceResult};
  if (mode === 'serialized') args[0]=clone(f.instanceResult);
  if (mode === 'built') args[0]={body:instanceBody(),kind:'service_instance'};
  if (mode === 'copiedTransfer') args[1]=clone(f.instanceTransfer);
  if (mode === 'otherResult') { const g=cleanup(t,await instanceResulted()); args[0]=g.instanceResult; }
  if (mode === 'extraArgs') args.push(true);
  if (mode === 'missingArg') args.pop();
  reject(() => f.adapter.prepareServiceInstanceResult(...args));
  reject(() => f.adapter.prepareServiceInstanceResult(f.instanceResult,f.instanceTransfer));
  assert.equal(f.contextRecord(f.execution).closed,true);
 });
}
for (const field of ['session','binding','executionContext','invocation','request','endpoint','authKind','kind']) {
 test('private result provenance rejects ' + field, async t => {
  const f=cleanup(t,await instanceResulted()), record=f.resultRecord(f.instanceResult), old=record[field];
  record[field]=typeof old==='string'?'other':{...old};
  reject(() => f.adapter.prepareServiceInstanceResult(f.instanceResult,f.instanceTransfer));
  record[field]=old; reject(() => f.adapter.prepareServiceInstanceResult(f.instanceResult,f.instanceTransfer));
  assert.equal(f.contextRecord(f.execution).closed,true);
 });
}
test('copied/serialized receipt and matching JSON grant nothing; raw R and replay fail', async t => {
 const f=cleanup(t,await instancePrepared());
 for(const value of [{...f.instanceBundle.result},clone(f.instanceBundle.result),{body:instanceBody(),...scope,humanReviewed:true},f.instanceResult])
  reject(() => f.ingress.takeObservation(value));
 assert.equal(acceptInstance(f).stage,'candidate');
 reject(() => f.ingress.takeObservation(f.instanceBundle.result));
 reject(() => f.adapter.prepareServiceInstanceResult(f.instanceResult,f.instanceTransfer));
 reject(() => acceptInstance(f));
});
for(const phase of ['beforeBind','afterBind','duringRequest','afterResponse','beforeAcceptance']) {
 test('close invalidates instance lifetime at ' + phase,async t=>{
  const f=cleanup(t,phase==='beforeBind'?await approved():phase==='afterBind'||phase==='duringRequest'?await instanceBound({hold:phase==='duringRequest'}):
   phase==='afterResponse'?await instanceResulted():await instancePrepared());
  if(phase==='beforeBind') f.instanceHand=identityHand(f);
  const pending=phase==='duringRequest'?f.adapter.executeServiceInstance(f.instanceTransfer):null;if(pending)pending.catch(()=>{});
  f.adapter.closeExecutionContext(f.execution);
  if(phase==='beforeBind')reject(()=>f.adapter.bindServiceInstanceTransfer(f.execution,f.session,f.instanceHand));
  if(phase==='afterBind')await rejects(f.adapter.executeServiceInstance(f.instanceTransfer));
  if(pending)await rejects(pending);
  if(phase==='afterResponse')reject(()=>f.adapter.prepareServiceInstanceResult(f.instanceResult,f.instanceTransfer));
  if(phase==='beforeAcceptance'){reject(()=>acceptInstance(f));reject(()=>f.ingress.takeObservation(f.instanceBundle.result));}
  const record=f.contextRecord(f.execution);assert.equal(record.closed,true);assert.equal(record.secret,null);
  for(const key of ['instanceBindings','instanceTransfers','instanceResults','instanceReceipts'])assert.equal(record[key].size,0);
  assert.equal(f.timers.size,0);
 });
}
for(const phase of ['bound','dispatching','responded']) {
 test('cancel burns instance attempt at ' + phase,async t=>{
  const f=cleanup(t,phase==='responded'?await instanceResulted():await instanceBound({hold:phase==='dispatching'}));
  const pending=phase==='dispatching'?f.adapter.executeServiceInstance(f.instanceTransfer):null;if(pending)pending.catch(()=>{});
  f.adapter.cancelServiceInstanceTransfer(f.instanceTransfer);if(pending)await rejects(pending);
  reject(()=>f.adapter.cancelServiceInstanceTransfer(f.instanceTransfer));await rejects(f.adapter.executeServiceInstance(f.instanceTransfer));
  if(f.instanceResult)reject(()=>f.adapter.prepareServiceInstanceResult(f.instanceResult,f.instanceTransfer));
  assert.equal(f.contextRecord(f.execution).closed,true);assert.equal(f.timers.size,0);
 });
}
for(const phase of ['execute','prepare','consume','cancel']) {
 test('wrong arity burns original instance capability: '+phase,async t=>{
  const f=cleanup(t,phase==='consume'?await instancePrepared():phase==='prepare'?await instanceResulted():await instanceBound());
  if(phase==='execute'){await rejects(f.adapter.executeServiceInstance(f.instanceTransfer,true));await rejects(f.adapter.executeServiceInstance(f.instanceTransfer));}
  if(phase==='prepare'){reject(()=>f.adapter.prepareServiceInstanceResult(f.instanceResult,f.instanceTransfer,true));reject(()=>f.adapter.prepareServiceInstanceResult(f.instanceResult,f.instanceTransfer));}
  if(phase==='consume'){reject(()=>f.ingress.takeObservation(f.instanceBundle.result,f.session));reject(()=>f.ingress.takeObservation(f.instanceBundle.result));}
  if(phase==='cancel'){reject(()=>f.adapter.cancelServiceInstanceTransfer(f.instanceTransfer,true));reject(()=>f.adapter.cancelServiceInstanceTransfer(f.instanceTransfer));}
  assert.equal(f.contextRecord(f.execution).closed,true);
 });
}
for(const driver of [{mode:'error'},{status:302},{status:500},{raw:'not JSON'},{hold:true}]) {
 test('transport/provider failure has no retry: '+JSON.stringify(driver),async t=>{
  const f=cleanup(t,await instanceBound(driver)),pending=f.adapter.executeServiceInstance(f.instanceTransfer);
  if(driver.hold){pending.catch(()=>{});f.fireTimeouts();}
  await rejects(pending);await rejects(f.adapter.executeServiceInstance(f.instanceTransfer));
  assert.equal(f.calls.length,3);assert.equal(f.contextRecord(f.execution).closed,true);
 });
}
for(const [name,edit] of [
 ['null',b=>{b.data.serviceInstance=null;}],['wrong name',b=>{b.data.serviceInstance.serviceName='other';}],
 ['wrong root',b=>{b.data.serviceInstance.rootDirectory='/other';}],['missing ID',b=>{delete b.data.serviceInstance.id;}],
 ['malformed ID',b=>{b.data.serviceInstance.id='bad/id';}],['extra',b=>{b.data.serviceInstance.token='synthetic';}]
]) {
 test('objective invalid instance cannot mint receipt: '+name,async t=>{
  const body=instanceBody();edit(body);const f=cleanup(t,await instanceResulted({body}));
  reject(()=>f.adapter.prepareServiceInstanceResult(f.instanceResult,f.instanceTransfer));
  assert.equal(f.contextRecord(f.execution).closed,true);reject(()=>f.identity.reviewTargetCandidate(f.session));
 });
}
test('null corroboration remains permitted; final target review stays separate and manual',async t=>{
 const body=instanceBody();body.data.serviceInstance.rootDirectory=null;body.data.serviceInstance.region=null;
 const f=cleanup(t,await instancePrepared({body}));assert.equal(acceptInstance(f).stage,'candidate');
 const review=f.identity.reviewTargetCandidate(f.session);assert.equal(review.candidate.rootDirectoryObserved,null);
 assert.equal(review.candidate.regionObserved,null);assert.equal(review.candidate.humanReviewed,false);
 reject(()=>f.identity.approveTargetCandidate(clone(review),{},{}));assert.equal(f.identity.inspectSession(f.session).stage,'candidate');
});
test('context/services/instance result and transfer namespaces are mutually non-substitutable',async t=>{
 const f=cleanup(t,await instancePrepared());
 reject(()=>f.adapter.consumeContextResultTransfer(f.instanceBundle.result,f.session));
 reject(()=>f.adapter.prepareProjectServicesResult(f.instanceResult,f.instanceTransfer));
 reject(()=>f.adapter.prepareServiceInstanceResult(f.instanceResult,f.servicesTransfer));
 reject(()=>f.adapter.prepareProjectServicesResult(f.servicesResult,f.instanceTransfer));
 assert.equal(acceptInstance(f).stage,'candidate');
 const g=cleanup(t,await instanceResulted()),h=cleanup(t,await contextResult());
 reject(()=>g.adapter.prepareServiceInstanceResult(h.contextResult,g.instanceTransfer));
 const i=cleanup(t,await resulted()),j=cleanup(t,await instanceResulted());
 reject(()=>j.adapter.prepareServiceInstanceResult(i.result,j.instanceTransfer));
 const k=cleanup(t,await instancePrepared());
 // Existing owner cannot accept an instance receipt as a services observation.
 const state=k.sessionRecord(k.session),entry=k.records.find(e=>e.key===k.instanceBundle.invocation).value;
 state.stage='project_services_pending';entry.stage='project_services';
 reject(()=>acceptInstance(k));assert.equal(k.identity.inspectSession(k.session).stage,'failed');
});
test('services/schema handoffs cannot enter instance binder; instance handoff cannot enter services binder',async t=>{
 const f=cleanup(t,await attested()),services=identityHand(f);
 reject(()=>f.adapter.bindServiceInstanceTransfer(f.execution,f.session,services));assert.equal(f.calls.length,1);
 const g=cleanup(t,await approved()),instance=identityHand(g);
 reject(()=>g.adapter.bindProjectServicesTransfer(g.execution,g.session,instance));assert.equal(g.calls.length,2);
 const h=cleanup(t,await approved()),plan=require(path.join(base,'qualification-railway-introspection-plan.cjs')),preflight=require(path.join(base,'qualification-railway-introspection-preflight.cjs'));
 const r=preflight.reviewNext(plan.start(),h.target),p=preflight.approveReview(r,{...r.meta,reviewed:true}),schema=preflight.consumeSchemaPermitForAdapter(p,h.target);
 reject(()=>h.adapter.bindServiceInstanceTransfer(h.execution,h.session,schema));assert.equal(h.calls.length,2);
});
test('frozen 0113 authority cannot be used as an instance capability',async t=>{
 const {loadWrapper}=require('./fixtures/0113-first-context-wrapper.cjs'),w=loadWrapper(),authority=w.authorized().authority;
 await rejects(adapter.executeServiceInstance(authority));assert.equal(w.calls.length,0);assert.equal(w.reads.length,0);
});
test('global authority and acquisition planning stay false/null after candidate',async t=>{
 const f=cleanup(t,await instancePrepared());acceptInstance(f);
 for(const state of [adapter.status,f.adapter.status,identity.state,f.identity.state,auth.state]){
  for(const key of ['providerContextObserved','projectEnvironmentContextProven','serviceContextProven','executionSchemaReady'])assert.equal(state[key],false);
  for(const key of ['identity_proven','causality_proven','restart_origin_proven','platformRestart'])assert.equal(state[key],null);
 }
 assert.equal(identity.state.targetIdentityObserved,false);
 const template=auth.acquisitionReviewTemplate();assert.equal(template.outcome,'PRELIVE_NOT_AUTHORIZED');
 for(const key of ['transportSupported','liveAuthorized','manualLiveAuthorization'])assert.equal(template.manifest[key],false);
});
test('exactly twelve pins change adapter/boundary only; v3 identity and unchanged query/lifetime functions',()=>{
 const git=args=>cp.execFileSync('git',['-c','safe.directory='+path.resolve(__dirname,'../../..'),...args],{encoding:'utf8',env:{},windowsHide:true});
 const baseline='3d978c44e09750ea8f21d2b47fe220ff717d5714',old=JSON.parse(git(['show',baseline+':movement-app/docs/0110-live-review-template.json']));
 assert.equal(Object.keys(auth.sourceHashes).length,12);
 for(const [file,sha] of Object.entries(auth.sourceHashes)){
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(base,file),'utf8').replace(/\r\n/g,'\n')).digest('hex'),sha);
  if(['qualification-railway-target-identity.cjs','qualification-railway-https-adapter.cjs','qualification-railway-target-identity-provider-boundary.cjs'].includes(file))assert.notEqual(sha,old.manifest.codeIdentity.sourceHashes[file]);
  else if(file==='qualification-railway-acquisition-wrapper.cjs')assert.equal(old.manifest.codeIdentity.sourceHashes[file],undefined);
  else assert.equal(sha,old.manifest.codeIdentity.sourceHashes[file]);
 }
 const before=git(['show',baseline+':movement-app/scripts/assessment-worker/qualification-railway-https-adapter.cjs']).replace(/\r\n/g,'\n');
 const after=fs.readFileSync(path.join(base,'qualification-railway-https-adapter.cjs'),'utf8').replace(/\r\n/g,'\n');
 for(const name of ['requireServicesOwner','fixedProjectServicesRequest','assertServicesAttempt','bindProjectServicesTransfer','executeProjectServices','cancelProjectServicesTransfer','consumeProjectServicesReceipt']){
  const pattern=new RegExp('(?:async )?function '+name+'\\([\\s\\S]*?\n}');
  assert.ok(before.match(pattern),name);assert.equal(after.match(pattern)?.[0],before.match(pattern)[0],name);
 }
 for(const [file,t] of [['0110-live-review-template.json',auth.reviewTemplate()],['0114a-acquisition-review-template.json',auth.acquisitionReviewTemplate()]]){
  assert.deepEqual(JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../docs',file),'utf8')),t);
  assert.equal(t.manualLiveAuthorization,false);assert.equal(t.manifest.codeIdentity.reviewedHead,null);assert.equal(t.manifest.codeIdentity.reviewedBranch,null);
 }
 assert.notEqual(auth.reviewTemplate().manifest.codeIdentity.authorizationBoundarySha256,old.manifest.codeIdentity.authorizationBoundarySha256);
});

for (const expected of ['synthetic-instance','synthetic-expected-instance']) {
 test('retained non-null expected instance constraint: '+expected, async t=>{
  const f=cleanup(t,await instanceResulted({expectedInstanceId:expected}));
  if(expected==='synthetic-instance'){
   f.instanceBundle=f.adapter.prepareServiceInstanceResult(f.instanceResult,f.instanceTransfer);
   assert.equal(acceptInstance(f).stage,'candidate');
  } else {
   reject(()=>f.adapter.prepareServiceInstanceResult(f.instanceResult,f.instanceTransfer));
   assert.equal(f.contextRecord(f.execution).closed,true);reject(()=>f.identity.reviewTargetCandidate(f.session));
  }
 });
}

async function secondAcquisitionReceipt(f, phase) {
 const reviews=require(path.join(base,'qualification-railway-context-review.cjs'));
 const g={...f,target:binding()};g.session=f.identity.startTargetIdentitySession(g.target);g.execution=f.adapter.openExecutionContext(g.target);
 const cr=f.identity===g.identity?reviews.reviewProjectTokenContext(g.target):null;
 const ch=reviews.consumeProjectTokenContextPermitForAdapter(reviews.approveProjectTokenContextReview(cr,{...cr.meta,reviewed:true}),g.target);
 const p=f.identity.contextTransfer.preparePermit(g.session,g.target,g.execution,ch),b=f.adapter.bindContextResultTransfer(g.execution,ch,p);
 const r=await f.adapter.executeHandoff(g.execution,ch);g.contextReceipt=f.adapter.prepareContextResultTransfer(r,b);
 if(phase==='context')return g;
 f.identity.acceptContextObservation(g.session,g.contextReceipt);
 const hand=identityHand(g),transfer=f.adapter.bindProjectServicesTransfer(g.execution,g.session,hand);
 const result=await f.adapter.executeProjectServices(transfer);g.servicesBundle=f.adapter.prepareProjectServicesResult(result,transfer);
 return g;
}
for(const mode of ['contextAsInstance','servicesAsInstance','instanceAsContext','instanceAsServices']){
 test('genuine same-module receipt namespace rejects: '+mode,async t=>{
  const f=cleanup(t,await instancePrepared()),g=await secondAcquisitionReceipt(f,mode.includes('Context')||mode.startsWith('context')?'context':'services');
  t.after(()=>f.adapter.closeExecutionContext(g.execution));
  if(mode==='contextAsInstance'){
   reject(()=>f.identity.acceptIdentityObservation(f.session,f.instanceBundle.invocation,g.contextReceipt));
   reject(()=>f.ingress.takeObservation(g.contextReceipt,g.session));
  }
  if(mode==='servicesAsInstance'){
   reject(()=>f.identity.acceptIdentityObservation(f.session,f.instanceBundle.invocation,g.servicesBundle.result));
   reject(()=>f.ingress.takeObservation(g.servicesBundle.result));
  }
  if(mode==='instanceAsContext'){
   reject(()=>f.identity.acceptContextObservation(g.session,f.instanceBundle.result));
   reject(()=>f.ingress.takeObservation(f.instanceBundle.result));
  }
  if(mode==='instanceAsServices'){
   reject(()=>f.identity.acceptIdentityObservation(g.session,g.servicesBundle.invocation,f.instanceBundle.result));
   reject(()=>f.ingress.takeObservation(f.instanceBundle.result));
  }
  const failed=mode.endsWith('Instance')?f.session:g.session;
  assert.equal(f.identity.inspectSession(failed).stage,'failed');
  assert.notEqual(f.identity.inspectSession(failed).stage,'candidate');
 });
}
