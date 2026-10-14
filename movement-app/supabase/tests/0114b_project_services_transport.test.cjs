'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), cp = require('node:child_process');
const base = path.resolve(__dirname, '../../scripts/assessment-worker');
const adapter = require(path.join(base, 'qualification-railway-https-adapter.cjs'));
const ingress = require(path.join(base, 'qualification-railway-target-identity-provider-boundary.cjs'));
const identity = require(path.join(base, 'qualification-railway-target-identity.cjs'));
const auth = require(path.join(base, 'qualification-railway-live-authorization.cjs'));
const { scope, binding, clone, serviceBody, loadServices, opened, contextResult, attested, identityHand, bound, resulted, prepared } = require('./fixtures/0114b-project-services.cjs');
const reject = fn => assert.throws(fn, /unavailable/);
const rejects = promise => assert.rejects(promise, /unavailable/);
const cleanup = (t, f) => { t.after(() => f.adapter.closeExecutionContext(f.execution)); return f; };
test.beforeEach(t => {
 let attempts = 0;
 for (const [owner, method] of [[require('node:https'), 'request'], [require('node:http'), 'request'], [global, 'fetch']])
  t.mock.method(owner, method, () => { attempts++; throw Error('REAL NETWORK FORBIDDEN'); });
 t.after(() => assert.equal(attempts, 0));
});
test('fresh same S/C fixed services request accepts genuine provenance only into service_review, keeping C open', async t => {
 const f = cleanup(t, await prepared()), call = f.calls[1], record = f.contextRecord(f.execution);
 assert.equal(f.calls.length, 2); assert.equal(call.options.hostname, 'backboard.railway.com'); assert.equal(call.options.path, '/graphql/v2');
 assert.equal(call.options.method, 'POST'); assert.equal(call.options.rejectUnauthorized, true); assert.equal(call.options.agent, false);
 assert.deepEqual(Object.keys(call.options.headers), ['Content-Type', 'Project-Access-Token']);
 assert.equal(call.options.headers['Project-Access-Token'], 'synthetic-private-credential');
 assert.deepEqual(call.request.variables, { id: scope.projectId }); assert.equal(call.request.operationName, 'Movement0111ProjectServices');
 assert.equal(call.request.query, identity.documents.projectServices.source);
 assert.equal(crypto.createHash('sha256').update(call.request.query + '\n').digest('hex'), 'fa6231580d6acec3510c26f4be5972605a3648c4c47f7da73eaa24021b137833');
 assert.deepEqual(Object.keys(f.bundle).sort(), ['invocation', 'result']); assert.equal(JSON.stringify(f.bundle.result), '{}');
 const status = f.identity.acceptIdentityObservation(f.session, f.bundle.invocation, f.bundle.result);
 assert.equal(status.stage, 'service_review'); assert.equal(status.ids.serviceId.providerObservedValue, scope.serviceId);
 assert.equal(status.ids.serviceInstanceId.providerObservedValue, null); assert.equal(status.providerObserved, false);
 assert.equal(record.closed, false); assert.equal(record.attested, true); assert.equal(record.busy, false);
 assert.deepEqual(f.reads, ['RAILWAY_TOKEN']); assert.equal(f.timers.size, 0);
 reject(() => f.identity.reviewNextIdentityRequest(f.session)); reject(() => f.identity.reviewTargetCandidate(f.session));
 const r = f.identity.reviewObservedServiceCandidate(f.session);
 f.identity.approveObservedServiceCandidate(r, f.session, { ...clone(r), reviewed: true });
 assert.equal(f.identity.reviewNextIdentityRequest(f.session).meta.operationName, 'Movement0111ServiceInstance');
 assert.equal(f.adapter.executeServiceInstance, undefined);
});
test('normal exports expose no consumer, provider issuer, request/body injection or surviving initializer', () => {
 assert.deepEqual(Object.keys(ingress), ['status', 'takeObservation']); assert.ok(Object.isFrozen(ingress)); assert.ok(Object.isFrozen(adapter));
 assert.equal(Reflect.get(ingress, '_connectProjectServicesConsumer'), undefined);
 for (const key of ['consumeProjectServicesReceipt','consumeIdentityProviderObservation','consumeProjectServicesResult','issueObservation','executeIdentityRequest','executeServiceInstance']) {
  assert.equal(adapter[key], undefined); assert.equal(ingress[key], undefined);
 }
 const f = loadServices(); assert.deepEqual(f.reads, []); assert.equal(f.calls.length, 0);
 for (const value of [{}, { body: serviceBody() }, { kind: 'project_services', ...scope }]) reject(() => ingress.takeObservation(value));
});
for (const mode of ['copy', 'serialized', 'built', 'wrongSession', 'otherSessionHand', 'wrongContext', 'copiedContext', 'otherTarget', 'staleRevision', 'extraArgs']) {
 test('binding rejects ownership/arity and never dispatches: ' + mode, async t => {
  const f = cleanup(t, await attested()); f.hand = identityHand(f); const args = [f.execution, f.session, f.hand];
  if (mode === 'copy') args[2] = { ...f.hand };
  if (mode === 'serialized') args[2] = clone(f.hand);
  if (mode === 'built') args[2] = { ...scope, request: f.calls[0].request };
  if (mode === 'wrongSession' || mode === 'otherSessionHand') args[1] = f.identity.startTargetIdentitySession(f.target);
  if (mode === 'wrongContext') args[0] = f.adapter.openExecutionContext(f.target);
  if (mode === 'copiedContext') args[0] = clone(f.execution);
  if (mode === 'otherTarget') args[0] = f.adapter.openExecutionContext(binding());
  if (mode === 'staleRevision') f.sessionRecord(f.session).revision++;
  if (mode === 'extraArgs') args.push(true);
  reject(() => f.adapter.bindProjectServicesTransfer(...args)); assert.equal(f.calls.length, 1);
  if (['wrongContext','otherTarget'].includes(mode)) f.adapter.closeExecutionContext(args[0]);
  if (!['copy','serialized','built'].includes(mode)) reject(() => f.identity.takeIdentityHandoffForFutureAdapter(f.hand, f.session, f.execution));
 });
}
for (const extra of ['query','variables','operationName','endpoint','authHeader','token','callback']) {
 test('caller cannot supply ' + extra, async t => {
  const f = cleanup(t, await attested()), hand = identityHand(f);
  reject(() => f.adapter.bindProjectServicesTransfer(f.execution, f.session, hand, { [extra]: 'synthetic' }));
  assert.equal(f.calls.length, 1); assert.equal(f.contextRecord(f.execution).closed, true);
 });
}
test('services require completed accepted context, not ordinary context summaries', async t => {
 const first = cleanup(t, opened()); reject(() => first.identity.reviewNextIdentityRequest(first.session));
 reject(() => first.adapter.bindProjectServicesTransfer(first.execution, first.session, {})); assert.equal(first.calls.length, 0);
 const f = cleanup(t, await contextResult()); f.adapter.consumeContextResult(f.contextResult);
 assert.equal(f.contextRecord(f.execution).identityAttestation, null);
 // VM-only state corruption simulates attempted summary-to-session reconstruction.
 const state = f.sessionRecord(f.session); state.stage = 'project_services'; state.revision++;
 state.contextFacts = Object.freeze({ projectId: scope.projectId, environmentId: scope.environmentId }); state.executionContext = f.execution;
 const hand = identityHand(f); reject(() => f.adapter.bindProjectServicesTransfer(f.execution, f.session, hand));
 assert.equal(f.calls.length, 1);
});
for (const mode of ['operationName','query','variables','hidden','getter']) {
 test('fixed request validation rejects private tampering before dispatch: ' + mode, async t => {
  const f = cleanup(t, await attested()), hand = identityHand(f);
  const entry = f.records.find(r => r.key === hand).value;
  const request = clone(entry.request);
  if (mode === 'operationName') request.operationName = 'Movement0111ServiceInstance';
  if (mode === 'query') request.query += ' ';
  if (mode === 'variables') request.variables.id = 'other';
  if (mode === 'hidden') Object.defineProperty(request.variables, 'extra', { value: true });
  if (mode === 'getter') Object.defineProperty(request.variables, 'id', { enumerable: true, get() { assert.fail('getter read'); } });
  entry.request = request; reject(() => f.adapter.bindProjectServicesTransfer(f.execution, f.session, hand));
  assert.equal(f.calls.length, 1);
 });
}
test('retained request is deeply frozen, project ID is observed, and owner replacement rejects', async t => {
 const f = cleanup(t, await bound()), e = f.transferRecord(f.transfer);
 assert.ok(Object.isFrozen(e.request)); assert.ok(Object.isFrozen(e.request.variables));
 assert.equal(e.request.variables.id, f.contextRecord(f.execution).identityAttestation.facts.projectId);
 assert.equal(e.session, f.session); assert.equal(e.binding, f.target); assert.equal(e.executionContext, f.execution);
 assert.equal(e.kind, 'project_services'); assert.ok(e.invocation);
 assert.throws(() => { e.request.variables.id = 'other'; }, TypeError);
 f.replaceOwner({ ...f.identity }); await rejects(f.adapter.executeProjectServices(f.transfer)); assert.equal(f.calls.length, 1);
});
test('second/concurrent dispatch loses without duplicating HTTPS or invalidating the winning original', async t => {
 const f = cleanup(t, await bound({ hold: true }));
 const pending = f.adapter.executeProjectServices(f.transfer);
 await rejects(f.adapter.executeProjectServices(f.transfer));
 await rejects(f.adapter.executeHandoff(f.execution, f.contextHand));
 assert.equal(f.calls.length, 2); f.calls[1].respond(); const r = await pending;
 const bundle = f.adapter.prepareProjectServicesResult(r, f.transfer);
 assert.equal(f.identity.acceptIdentityObservation(f.session, bundle.invocation, bundle.result).stage, 'service_review');
 await rejects(f.adapter.executeProjectServices(f.transfer)); assert.equal(f.calls.length, 2);
 reject(() => f.identity.reviewNextIdentityRequest(f.session));
});
test('handoff burns on bind and cannot replay; services path cannot consume schema or instance handoffs', async t => {
 const f = cleanup(t, await bound());
 reject(() => f.identity.takeIdentityHandoffForFutureAdapter(f.hand, f.session, f.execution));
 // A duplicate bind terminally cancels this located execution context.
 reject(() => f.adapter.bindProjectServicesTransfer(f.execution, f.session, f.hand));
 await rejects(f.adapter.executeProjectServices(f.transfer)); assert.equal(f.calls.length, 1);
 const g = cleanup(t, await prepared()); g.identity.acceptIdentityObservation(g.session, g.bundle.invocation, g.bundle.result);
 const r = g.identity.reviewObservedServiceCandidate(g.session); g.identity.approveObservedServiceCandidate(r, g.session, { ...clone(r), reviewed: true });
 const instanceHand = identityHand(g);
 reject(() => g.adapter.bindProjectServicesTransfer(g.execution, g.session, instanceHand)); assert.equal(g.calls.length, 2);
});
for (const mode of ['copy','serialized','built','otherSession','otherContext','extraArgs']) {
 test('result preparation rejects and burns located inputs: ' + mode, async t => {
  const f = cleanup(t, await resulted()), args = [f.result, f.transfer];
  if (mode === 'copy') args[0] = { ...f.result };
  if (mode === 'serialized') args[0] = clone(f.result);
  if (mode === 'built') args[0] = { body: serviceBody(), invocation: {} };
  if (mode === 'otherSession' || mode === 'otherContext') { const g = cleanup(t, await resulted()); args[0] = g.result;
   if (mode === 'otherSession') assert.notEqual(g.session, f.session); else assert.notEqual(g.execution, f.execution); }
  if (mode === 'extraArgs') args.push(true);
  reject(() => f.adapter.prepareProjectServicesResult(...args));
  reject(() => f.adapter.prepareProjectServicesResult(f.result, f.transfer));
  assert.equal(f.contextRecord(f.execution).closed, true); assert.equal(f.calls.length, 2);
 });
}
for (const field of ['session','binding','executionContext','invocation','request','endpoint','authKind','kind']) {
 test('adapter result private provenance mismatch rejects: ' + field, async t => {
  const f = cleanup(t, await resulted()), r = f.resultRecord(f.result), original = r[field];
  r[field] = typeof original === 'string' ? 'other' : { ...original };
  reject(() => f.adapter.prepareProjectServicesResult(f.result, f.transfer));
  r[field] = original; reject(() => f.adapter.prepareProjectServicesResult(f.result, f.transfer));
  assert.equal(f.contextRecord(f.execution).closed, true);
 });
}
test('copied receipt and matching JSON cannot unwrap; original receipt/result replay fails', async t => {
 const f = cleanup(t, await prepared());
 for (const v of [{ ...f.bundle.result }, clone(f.bundle.result), { ...scope, body: serviceBody(), providerObserved: true }]) reject(() => f.ingress.takeObservation(v));
 reject(() => f.ingress.takeObservation(f.result)); // Raw R is not an ingress receipt.
 assert.equal(f.identity.acceptIdentityObservation(f.session, f.bundle.invocation, f.bundle.result).stage, 'service_review');
 reject(() => f.ingress.takeObservation(f.bundle.result));
 reject(() => f.adapter.prepareProjectServicesResult(f.result, f.transfer));
 reject(() => f.identity.acceptIdentityObservation(f.session, f.bundle.invocation, f.bundle.result));
});
for (const phase of ['beforeBind','afterBind','duringRequest','afterResponse','beforeAcceptance']) {
 test('close invalidates services state without reuse: ' + phase, async t => {
  const f = cleanup(t, phase === 'beforeBind' ? await attested() : phase === 'afterBind' || phase === 'duringRequest' ? await bound({ hold: phase === 'duringRequest' }) :
   phase === 'afterResponse' ? await resulted() : await prepared());
  if (phase === 'beforeBind') f.hand = identityHand(f);
  const pending = phase === 'duringRequest' ? f.adapter.executeProjectServices(f.transfer) : null;
  if (pending) pending.catch(() => {});
  f.adapter.closeExecutionContext(f.execution);
  if (phase === 'beforeBind') reject(() => f.adapter.bindProjectServicesTransfer(f.execution, f.session, f.hand));
  if (phase === 'afterBind') await rejects(f.adapter.executeProjectServices(f.transfer));
  if (pending) await rejects(pending);
  if (phase === 'afterResponse') reject(() => f.adapter.prepareProjectServicesResult(f.result, f.transfer));
  if (phase === 'beforeAcceptance') {
   reject(() => f.identity.acceptIdentityObservation(f.session, f.bundle.invocation, f.bundle.result));
   reject(() => f.ingress.takeObservation(f.bundle.result));
  }
  assert.equal(f.contextRecord(f.execution).closed, true); assert.equal(f.contextRecord(f.execution).secret, null);
  assert.equal(f.contextRecord(f.execution).servicesReceipts.size, 0); assert.equal(f.timers.size, 0);
 });
}
for (const phase of ['bound','dispatching','responded']) {
 test('cancellation burns transport and results: ' + phase, async t => {
  const f = cleanup(t, phase === 'responded' ? await resulted() : await bound({ hold: phase === 'dispatching' }));
  const pending = phase === 'dispatching' ? f.adapter.executeProjectServices(f.transfer) : null; if (pending) pending.catch(() => {});
  f.adapter.cancelProjectServicesTransfer(f.transfer);
  if (pending) await rejects(pending);
  reject(() => f.adapter.cancelProjectServicesTransfer(f.transfer));
  await rejects(f.adapter.executeProjectServices(f.transfer));
  if (f.result) reject(() => f.adapter.prepareProjectServicesResult(f.result, f.transfer));
  assert.equal(f.contextRecord(f.execution).closed, true); assert.equal(f.contextRecord(f.execution).servicesResults.size, 0);
 });
}
for (const phase of ['execute','prepare','consume','cancel']) {
 test('wrong arity burns genuine services capability: ' + phase, async t => {
  const f = cleanup(t, phase === 'consume' ? await prepared() : phase === 'prepare' ? await resulted() : await bound());
  if (phase === 'execute') { await rejects(f.adapter.executeProjectServices(f.transfer, true)); await rejects(f.adapter.executeProjectServices(f.transfer)); }
  if (phase === 'prepare') { reject(() => f.adapter.prepareProjectServicesResult(f.result, f.transfer, true)); reject(() => f.adapter.prepareProjectServicesResult(f.result, f.transfer)); }
  if (phase === 'consume') { reject(() => f.ingress.takeObservation(f.bundle.result, f.session)); reject(() => f.ingress.takeObservation(f.bundle.result)); }
  if (phase === 'cancel') { reject(() => f.adapter.cancelProjectServicesTransfer(f.transfer, true)); reject(() => f.adapter.cancelProjectServicesTransfer(f.transfer)); }
  assert.equal(f.contextRecord(f.execution).closed, true);
 });
}
test('services and context result namespaces cannot be exchanged', async t => {
 const f = cleanup(t, await resulted()), g = cleanup(t, await contextResult());
 reject(() => g.adapter.prepareContextResultTransfer(f.result, g.contextBinding));
 reject(() => f.adapter.prepareProjectServicesResult(g.contextResult, f.transfer));
 assert.equal(f.contextRecord(f.execution).closed, true);
 const h = cleanup(t, await prepared());
 reject(() => h.adapter.consumeContextResultTransfer(h.bundle.result, h.session));
 // Wrong-namespace context consumer cannot issue service observations or burn the separate receipt.
 assert.equal(h.identity.acceptIdentityObservation(h.session, h.bundle.invocation, h.bundle.result).stage, 'service_review');
});
test('services receipt cannot satisfy another session or an instance invocation', async t => {
 const f = cleanup(t, await prepared()), g = cleanup(t, await prepared());
 g.identity.acceptIdentityObservation(g.session, g.bundle.invocation, g.bundle.result);
 const r = g.identity.reviewObservedServiceCandidate(g.session); g.identity.approveObservedServiceCandidate(r, g.session, { ...clone(r), reviewed: true });
 const hand = identityHand(g), original = g.identity.takeIdentityHandoffForFutureAdapter(hand, g.session, g.execution);
 reject(() => g.identity.acceptIdentityObservation(g.session, original.invocation, f.bundle.result));
 assert.equal(g.identity.inspectSession(g.session).stage, 'failed');
 assert.equal(f.identity.acceptIdentityObservation(f.session, f.bundle.invocation, f.bundle.result).stage, 'service_review');
 const h = cleanup(t, await prepared());
 reject(() => h.identity.acceptIdentityObservation({}, h.bundle.invocation, h.bundle.result));
 assert.equal(h.identity.inspectSession(h.session).stage, 'failed');
});
for (const driver of [{ mode: 'error' }, { status: 302 }, { status: 500 }, { raw: 'not JSON' }, { hold: true }]) {
 test('transport failure is sanitized, terminal and never retries: ' + JSON.stringify(driver), async t => {
  const f = cleanup(t, await bound(driver)), pending = f.adapter.executeProjectServices(f.transfer);
  if (driver.hold) { pending.catch(() => {}); f.fireTimeouts(); }
  await rejects(pending); await rejects(f.adapter.executeProjectServices(f.transfer));
  assert.equal(f.calls.length, 2); assert.equal(f.contextRecord(f.execution).closed, true);
 });
}
for (const [name, edit] of [
 ['zero', b => { b.data.project.services.edges = []; }],
 ['multiple', b => { b.data.project.services.edges.push({ node: { id: 'other', name: 'myapp-backend' } }); }],
 ['duplicate', b => { b.data.project.services.edges.push({ node: { id: scope.serviceId, name: 'other' } }); }],
 ['pagination', b => { b.data.project.services.pageInfo.hasNextPage = true; }],
 ['wrong ID', b => { b.data.project.services.edges[0].node.id = 'other'; }]
]) {
 test('objective invalid result cannot mint ingress receipt: ' + name, async t => {
  const body = serviceBody(); edit(body); const f = cleanup(t, await resulted({ body }));
  reject(() => f.adapter.prepareProjectServicesResult(f.result, f.transfer));
  assert.equal(f.contextRecord(f.execution).closed, true);
  reject(() => f.identity.reviewObservedServiceCandidate(f.session));
 });
}
test('global authority and acquisition permission stay frozen after synthetic successful services', async t => {
 const f = cleanup(t, await prepared()); f.identity.acceptIdentityObservation(f.session, f.bundle.invocation, f.bundle.result);
 for (const state of [adapter.status, f.adapter.status, identity.state, f.identity.state, auth.state]) {
  for (const k of ['providerContextObserved','projectEnvironmentContextProven','serviceContextProven','executionSchemaReady']) assert.equal(state[k], false);
  for (const k of ['identity_proven','causality_proven','restart_origin_proven','platformRestart']) assert.equal(state[k], null);
 }
 assert.equal(identity.state.targetIdentityObserved, false); assert.equal(ingress.status.providerResultIngressConnected, false);
 const m = auth.acquisitionReviewTemplate().manifest;
 assert.equal(m.transportSupported, false); assert.equal(m.liveAuthorized, false); assert.equal(m.manualLiveAuthorization, false);
 reject(() => auth.takeFirstContextExecutionAuthority(f.bundle.result));
});
test('eleven pins bind only adapter/boundary changes and regenerated safe templates, identity/wrapper stay unchanged', () => {
 const old = JSON.parse(cp.execFileSync('git', ['-c','safe.directory=' + path.resolve(__dirname, '../../..'),'show',
  'bdc3f942b1fa819118abf188e5b2658cf3dd4510:movement-app/docs/0110-live-review-template.json'], { encoding:'utf8',env:{},windowsHide:true }));
 const oldPins = old.manifest.codeIdentity.sourceHashes; assert.equal(Object.keys(auth.sourceHashes).length, 11);
 for (const [file, sha] of Object.entries(auth.sourceHashes)) {
  const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(base,file),'utf8').replace(/\r\n/g,'\n')).digest('hex');
  assert.equal(actual, sha);
  if (['qualification-railway-https-adapter.cjs','qualification-railway-target-identity-provider-boundary.cjs'].includes(file)) assert.notEqual(sha, oldPins[file]);
  else assert.equal(sha, oldPins[file]);
 }
 for (const [file, expected] of [['0110-live-review-template.json',auth.reviewTemplate()],['0114a-acquisition-review-template.json',auth.acquisitionReviewTemplate()]]) {
  assert.deepEqual(JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../docs',file),'utf8')), expected);
  assert.equal(expected.manualLiveAuthorization, false);
 }
 assert.notEqual(auth.reviewTemplate().manifest.codeIdentity.authorizationBoundarySha256, old.manifest.codeIdentity.authorizationBoundarySha256);
});
test('module initialization safely connects exactly once under both import orders', () => {
 for (const first of ['qualification-railway-https-adapter.cjs','qualification-railway-target-identity-provider-boundary.cjs']) {
  const code = "const p=" + JSON.stringify(base) + ";require(p+'/" + first + "');const b=require(p+'/qualification-railway-target-identity-provider-boundary.cjs');if(!Object.isFrozen(b)||Reflect.has(b,'_connectProjectServicesConsumer'))throw Error('link leaked');";
  cp.execFileSync(process.execPath,['-e',code],{encoding:'utf8',env:{},windowsHide:true});
 }
});

test('same-module receipt from another accepted session cannot satisfy instance invocation and burns', async t => {
 const f = cleanup(t, await prepared());
 // A second acquisition within the SAME module graph, with its own genuine C/S.
 const target = binding(), session = f.identity.startTargetIdentitySession(target), execution = f.adapter.openExecutionContext(target);
 t.after(() => f.adapter.closeExecutionContext(execution));
 const reviews = require(path.join(base, 'qualification-railway-context-review.cjs'));
 const cr = reviews.reviewProjectTokenContext(target), ch = reviews.consumeProjectTokenContextPermitForAdapter(reviews.approveProjectTokenContextReview(cr, { ...cr.meta, reviewed: true }), target);
 const p = f.identity.contextTransfer.preparePermit(session, target, execution, ch), b = f.adapter.bindContextResultTransfer(execution, ch, p);
 const r = await f.adapter.executeHandoff(execution, ch);
 f.identity.acceptContextObservation(session, f.adapter.prepareContextResultTransfer(r, b));
 const hand = identityHand(f, session), transfer = f.adapter.bindProjectServicesTransfer(execution, session, hand);
 const result = await f.adapter.executeProjectServices(transfer), bundle = f.adapter.prepareProjectServicesResult(result, transfer);
 f.identity.acceptIdentityObservation(session, bundle.invocation, bundle.result);
 const review = f.identity.reviewObservedServiceCandidate(session);
 f.identity.approveObservedServiceCandidate(review, session, { ...clone(review), reviewed: true });
 const instanceHand = identityHand(f, session), invocation = f.identity.takeIdentityHandoffForFutureAdapter(instanceHand, session, execution);
 reject(() => f.identity.acceptIdentityObservation(session, invocation.invocation, f.bundle.result));
 assert.equal(f.identity.inspectSession(session).stage, 'failed');
 reject(() => f.ingress.takeObservation(f.bundle.result));
 reject(() => f.identity.acceptIdentityObservation(f.session, f.bundle.invocation, f.bundle.result));
});

test('genuine schema handoff cannot enter project-services transport', async t => {
 const f = cleanup(t, await attested()), plan = require(path.join(base, 'qualification-railway-introspection-plan.cjs'));
 const preflight = require(path.join(base, 'qualification-railway-introspection-preflight.cjs'));
 const review = preflight.reviewNext(plan.start(), f.target), permit = preflight.approveReview(review, { ...review.meta, reviewed: true });
 const schema = preflight.consumeSchemaPermitForAdapter(permit, f.target);
 reject(() => f.adapter.bindProjectServicesTransfer(f.execution, f.session, schema));
 assert.equal(f.calls.length, 1);
});
