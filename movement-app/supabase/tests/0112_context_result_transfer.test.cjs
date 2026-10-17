'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const targets = require('../../scripts/assessment-worker/qualification-railway-introspection-target.cjs');
const reviews = require('../../scripts/assessment-worker/qualification-railway-context-review.cjs');
const context = require('../../scripts/assessment-worker/qualification-railway-project-token-context.cjs');
const normalAdapter = require('../../scripts/assessment-worker/qualification-railway-https-adapter.cjs');
const normalIdentity = require('../../scripts/assessment-worker/qualification-railway-target-identity.cjs');
const normalIngress = require('../../scripts/assessment-worker/qualification-railway-target-identity-provider-boundary.cjs');
const { loadTransfer } = require('./fixtures/0112-context-transfer.cjs');
const scope = { environmentKind: 'disposable', lifecycle: 'active', projectId: 'synthetic-project', environmentId: 'synthetic-env', serviceId: 'synthetic-service', serviceInstanceId: null };
const clone = v => JSON.parse(JSON.stringify(v));
const binding = () => targets.bindTarget(scope, scope, { inventoryReviewed: true, projectIds: [], environmentIds: [], serviceIds: [], serviceInstanceIds: [] });
function handoff(target) { const r = reviews.reviewProjectTokenContext(target); return reviews.consumeProjectTokenContextPermitForAdapter(reviews.approveProjectTokenContextReview(r, { ...r.meta, reviewed: true }), target); }
function fixture(options) {
 const h = loadTransfer(options), target = binding(), session = h.identity.startTargetIdentitySession(target);
 assert.equal(h.reads.length, 0); const execution = h.adapter.openExecutionContext(target), hand = handoff(target);
 const permit = h.identity.contextTransfer.preparePermit(session, target, execution, hand);
 return { ...h, target, session, execution, hand, permit };
}
function bound(options) { const f = fixture(options); f.bind = f.adapter.bindContextResultTransfer(f.execution, f.hand, f.permit); return f; }
async function resulted(options) { const f = bound(options); f.result = await f.adapter.executeHandoff(f.execution, f.hand); return f; }
async function transferred(options) { const f = await resulted(options); f.receipt = f.adapter.prepareContextResultTransfer(f.result, f.bind); return f; }
const reject = fn => assert.throws(fn, /unavailable/);
test.beforeEach(t => {
 let calls = 0;
 t.mock.method(require('node:https'), 'request', () => { calls++; throw Error('REAL NETWORK FORBIDDEN'); });
 t.mock.method(global, 'fetch', () => { calls++; throw Error('REAL NETWORK FORBIDDEN'); });
 t.after(() => assert.equal(calls, 0));
});
test('full P B R T chain finalizes only after exact 0111 acceptance, once', async () => {
 const f = await transferred(), record = f.contextRecord(f.execution);
 assert.equal(record.busy, true); assert.equal(record.attested, false);
 const status = f.identity.acceptContextObservation(f.session, f.receipt);
 assert.equal(record.busy, false); assert.equal(record.attested, true);
 assert.equal(status.stage, 'project_services'); assert.equal(status.ids.projectId.providerObservedValue, scope.projectId);
 assert.equal(status.ids.environmentId.providerObservedValue, scope.environmentId); assert.equal(status.ids.serviceId.providerObservedValue, null);
 assert.equal(status.providerObserved, false); reject(() => f.identity.reviewTargetCandidate(f.session));
 reject(() => f.identity.acceptContextObservation(f.session, f.receipt)); reject(() => f.adapter.consumeContextResult(f.result));
 assert.deepEqual(f.reads, ['RAILWAY_TOKEN']); assert.equal(f.calls.length, 1);
 f.adapter.closeExecutionContext(f.execution);
});
test('permit, binding, result and slot replay all fail', async () => {
 const f = await resulted(); reject(() => f.identity.contextTransfer.takePermit(f.permit, f.execution, f.hand));
 const receipt = f.adapter.prepareContextResultTransfer(f.result, f.bind);
 reject(() => f.adapter.prepareContextResultTransfer(f.result, f.bind));
 // Failed replay closes no already-spent inputs and leaves the original T usable.
 f.identity.acceptContextObservation(f.session, receipt);
 const slot = f.records.find(e => e.value.phase === 'done')?.key;
 reject(() => f.identity.contextTransfer.takeSlot(slot, f.session));
});
test('ordinary consumer first wins without changing summary shape', async () => {
 const f = await resulted(), summary = f.adapter.consumeContextResult(f.result);
 assert.equal(summary.projectEnvironmentContextProven, true); assert.ok(!Object.hasOwn(summary, 'body'));
 assert.ok(!Object.hasOwn(summary, 'executionContext')); reject(() => f.adapter.prepareContextResultTransfer(f.result, f.bind));
 assert.equal(f.identity.inspectSession(f.session).stage, 'failed');
});
test('transfer first prevents ordinary consumption; receipt is opaque', async () => {
 const f = await transferred(); reject(() => f.adapter.consumeContextResult(f.result));
 assert.equal(JSON.stringify(f.receipt), '{}'); assert.ok(Object.isFrozen(f.receipt));
 f.identity.acceptContextObservation(f.session, f.receipt);
});
for (const wrong of ['extraArgs', 'copiedBinding', 'otherBinding']) test('failed transfer burns R and cannot be repaired: ' + wrong, async () => {
 const f = await resulted(), other = bound();
 reject(() => wrong === 'extraArgs' ? f.adapter.prepareContextResultTransfer(f.result, f.bind, true) : f.adapter.prepareContextResultTransfer(f.result, wrong === 'copiedBinding' ? clone(f.bind) : other.bind));
 reject(() => f.adapter.prepareContextResultTransfer(f.result, f.bind)); reject(() => f.adapter.consumeContextResult(f.result));
 assert.equal(f.contextRecord(f.execution).closed, true);
});
for (const wrong of ['targetCopy', 'identicalOtherTarget', 'sessionCopy', 'otherSession', 'wrongStage']) test('permit preparation rejects ' + wrong, () => {
 const f = fixture();
 const session = f.identity.startTargetIdentitySession(f.target);
 if (wrong === 'wrongStage') f.sessionRecord(session).stage = 'project_services';
 reject(() => f.identity.contextTransfer.preparePermit(wrong === 'sessionCopy' ? clone(session) : wrong === 'otherSession' ? f.identity.startTargetIdentitySession(binding()) : session,
  wrong === 'targetCopy' ? clone(f.target) : wrong === 'identicalOtherTarget' ? binding() : f.target, f.execution, f.hand));
});
for (const wrong of ['wrongContext', 'contextCopy', 'wrongHandoff', 'handoffCopy', 'extraArgs', 'staleRevision', 'wrongStage']) test('binding consumes permit then rejects ' + wrong, () => {
 const f = fixture();
 if (wrong === 'staleRevision') f.sessionRecord(f.session).revision++;
 if (wrong === 'wrongStage') f.sessionRecord(f.session).stage = 'project_services';
 const execution = wrong === 'contextCopy' ? clone(f.execution) : wrong === 'wrongContext' ? f.adapter.openExecutionContext(f.target) : f.execution;
 const hand = wrong === 'handoffCopy' ? clone(f.hand) : wrong === 'wrongHandoff' ? handoff(f.target) : f.hand;
 reject(() => f.adapter.bindContextResultTransfer(execution, hand, f.permit, ...(wrong === 'extraArgs' ? [true] : [])));
 reject(() => f.adapter.bindContextResultTransfer(f.execution, f.hand, f.permit));
});
for (const field of ['kind', 'operation', 'query', 'endpoint', 'authKind', 'binding', 'executionContext', 'handoff', 'invocation']) test('adapter-owned VM result provenance rejects ' + field, async () => {
 const f = await resulted(), r = f.resultRecord(f.result);
 if (field === 'kind') r.kind = 'schema';
 if (field === 'operation') r.request = { ...r.request, operationName: 'Other' };
 if (field === 'query') r.request = { ...r.request, query: 'query Other { me { id } }' };
 if (field === 'endpoint') r.endpoint = 'https://other';
 if (field === 'authKind') r.authKind = 'account_token';
 if (field === 'binding') r.binding = binding();
 if (field === 'executionContext') r.executionContext = f.adapter.openExecutionContext(f.target);
 if (field === 'handoff') r.handoff = handoff(f.target);
 if (field === 'invocation') r.invocation = { ...r.invocation, kind: 'schema' };
 reject(() => f.adapter.prepareContextResultTransfer(f.result, f.bind));
 reject(() => f.adapter.prepareContextResultTransfer(f.result, f.bind)); assert.equal(f.contextRecord(f.execution).closed, true);
});
for (const field of ['projectId', 'environmentId', 'extra', 'null']) test('existing validator rejects context body ' + field, async () => {
 const body = { data: { projectToken: { projectId: scope.projectId, environmentId: scope.environmentId } } };
 if (field === 'extra') body.errors = []; else if (field === 'null') body.data.projectToken = null; else body.data.projectToken[field] = 'other';
 const f = await resulted({ body }); reject(() => f.adapter.prepareContextResultTransfer(f.result, f.bind));
 assert.equal(f.contextRecord(f.execution).attested, false); assert.equal(f.identity.inspectSession(f.session).ids.projectId.providerObservedValue, null);
});
for (const when of ['beforeDispatch', 'afterResult', 'afterReceipt', 'afterPull']) test('close permanently invalidates transfer: ' + when, async () => {
 const f = bound(); let receipt, pulled;
 if (when !== 'beforeDispatch') { f.result = await f.adapter.executeHandoff(f.execution, f.hand); }
 if (when === 'afterReceipt' || when === 'afterPull') receipt = f.adapter.prepareContextResultTransfer(f.result, f.bind);
 if (when === 'afterPull') pulled = f.ingress.takeObservation(receipt, f.session);
 f.adapter.closeExecutionContext(f.execution);
 if (when === 'beforeDispatch') await assert.rejects(f.adapter.executeHandoff(f.execution, f.hand));
 else if (when === 'afterResult') reject(() => f.adapter.prepareContextResultTransfer(f.result, f.bind));
 else { reject(() => f.identity.acceptContextObservation(f.session, receipt)); if (pulled) reject(() => f.adapter.consumeContextResultTransfer(pulled.completion, f.session)); }
 assert.equal(f.identity.inspectSession(f.session).stage, 'failed'); assert.equal(f.contextRecord(f.execution).attested, false);
});
test('pulling receipt does not finalize and caller cannot use completion before session acceptance', async () => {
 const f = await transferred(), observed = f.ingress.takeObservation(f.receipt, f.session);
 assert.equal(f.contextRecord(f.execution).busy, true); assert.equal(f.contextRecord(f.execution).attested, false);
 reject(() => f.adapter.consumeContextResultTransfer(observed.completion, f.session));
 assert.equal(f.contextRecord(f.execution).closed, true); reject(() => f.adapter.consumeContextResultTransfer(observed.completion, f.session));
});
test('wrong final session burns receipt and original slot', async () => {
 const f = await transferred(), other = f.identity.startTargetIdentitySession(f.target);
 reject(() => f.identity.acceptContextObservation(other, f.receipt));
 reject(() => f.identity.acceptContextObservation(f.session, f.receipt)); assert.equal(f.identity.inspectSession(f.session).stage, 'failed');
});
for (const raw of ['body', 'wrapper', 'flags', 'hashes', 'validator', 'summary', 'copiedResult', 'copiedReceipt']) test('forgery rejected: ' + raw, async () => {
 const f = await transferred(); let value;
 const body = { data: { projectToken: { projectId: scope.projectId, environmentId: scope.environmentId } } };
 if (raw === 'body') value = body; if (raw === 'wrapper') value = { body }; if (raw === 'flags') value = { providerObserved: true };
 if (raw === 'hashes') value = { projectIdSha256: 'a'.repeat(64), environmentIdSha256: 'b'.repeat(64) };
 if (raw === 'validator') value = context.validateContextResponse(f.target, body);
 if (raw === 'summary') { const g = await resulted(); value = g.adapter.consumeContextResult(g.result); }
 if (raw === 'copiedResult') value = clone(f.result); if (raw === 'copiedReceipt') value = clone(f.receipt);
 reject(() => f.ingress.takeObservation(value, f.session));
 f.identity.acceptContextObservation(f.session, f.receipt);
});
test('VM capability rejection in normal and another VM namespace', async () => {
 const f = await transferred(), other = bound();
 reject(() => normalAdapter.prepareContextResultTransfer(f.result, f.bind));
 reject(() => normalIngress.takeObservation(f.receipt, f.session));
 reject(() => normalIdentity.contextTransfer.takePermit(f.permit, f.execution, f.hand));
 reject(() => other.adapter.consumeContextResultTransfer(f.receipt, f.session));
 f.identity.acceptContextObservation(f.session, f.receipt);
});
for (const owner of ['partial', 'replacement']) test('owner module identity fails closed: ' + owner, async () => {
 const f = await resulted(); f.replaceOwner(owner === 'partial' ? {} : { ...f.identity });
 reject(() => f.adapter.prepareContextResultTransfer(f.result, f.bind));
 f.replaceOwner(null); reject(() => f.adapter.prepareContextResultTransfer(f.result, f.bind));
});
test('registered dispatch refuses another context handoff and emits no request', async () => {
 const f = bound(); await assert.rejects(f.adapter.executeHandoff(f.execution, handoff(f.target)));
 assert.equal(f.calls.length, 0); assert.equal(f.identity.inspectSession(f.session).stage, 'failed');
});
for (const kind of ['schema', 'service', 'instance', 'arbitrary']) test('registered context dispatch rejects ' + kind + ' and never adds execution support', async () => {
 const f = bound(); let hand;
 if (kind === 'schema') {
  const plan = require('../../scripts/assessment-worker/qualification-railway-introspection-plan.cjs');
  const pf = require('../../scripts/assessment-worker/qualification-railway-introspection-preflight.cjs');
  const r = pf.reviewNext(plan.start(), f.target), p = pf.approveReview(r, { ...r.meta, reviewed: true });
  hand = pf.consumeSchemaPermitForAdapter(p, f.target);
 } else hand = Object.freeze({ operationName: kind === 'service' ? 'Movement0111ProjectServices' : kind === 'instance' ? 'Movement0111ServiceInstance' : 'Other', request: {} });
 await assert.rejects(f.adapter.executeHandoff(f.execution, hand)); assert.equal(f.calls.length, 0);
 assert.equal(f.identity.inspectSession(f.session).stage, 'failed');
});
for (const transition of ['prepare', 'consume']) test('stale slot revision burns at ' + transition, async () => {
 const f = transition === 'prepare' ? await resulted() : await transferred(); const originalRevision = f.sessionRecord(f.session).revision;
 f.sessionRecord(f.session).revision++;
 reject(() => transition === 'prepare' ? f.adapter.prepareContextResultTransfer(f.result, f.bind) : f.identity.acceptContextObservation(f.session, f.receipt));
 f.sessionRecord(f.session).revision = originalRevision;
 reject(() => transition === 'prepare' ? f.adapter.prepareContextResultTransfer(f.result, f.bind) : f.identity.acceptContextObservation(f.session, f.receipt));
 assert.equal(f.contextRecord(f.execution).closed, true);
});
test('public validator is run again by exact 0111 acceptance before finalizing', async () => {
 const f = await transferred();
 // Fault injection into a private synthetic T, no normal issuer/mutation API.
 const receiptRecord = f.records.find(e => e.key === f.receipt && e.value.phase === 'receipt').value;
 receiptRecord.body = { data: { projectToken: { projectId: 'other', environmentId: scope.environmentId } } };
 reject(() => f.identity.acceptContextObservation(f.session, f.receipt));
 assert.equal(f.contextRecord(f.execution).attested, false); assert.equal(f.contextRecord(f.execution).closed, true);
 assert.equal(f.identity.inspectSession(f.session).ids.projectId.providerObservedValue, null);
});
test('new transfer functions do not read even synthetic env after original context open', async () => {
 const f = await transferred(); const readCount = f.reads.length;
 f.identity.acceptContextObservation(f.session, f.receipt); assert.equal(f.reads.length, readCount);
 const fs = require('node:fs'), path = require('node:path');
 const src = fs.readFileSync(path.resolve(__dirname, '../../scripts/assessment-worker/qualification-railway-https-adapter.cjs'), 'utf8');
 const transferSource = src.slice(src.indexOf('function requireOwner('));
 assert.doesNotMatch(transferSource, /process\.env|fetch\s*\(|https\.request\s*\(|child_process/);
});
test('busy receipt prevents another request; global state unchanged', async () => {
 const f = await transferred(); await assert.rejects(f.adapter.executeHandoff(f.execution, handoff(f.target)));
 assert.equal(f.calls.length, 1); f.identity.acceptContextObservation(f.session, f.receipt);
 for (const state of [f.adapter.status, normalAdapter.status, f.identity.state, normalIdentity.state]) {
  for (const key of ['providerContextObserved', 'projectEnvironmentContextProven', 'serviceContextProven', 'executionSchemaReady']) assert.equal(state[key], false);
  for (const key of ['identity_proven', 'causality_proven', 'restart_origin_proven', 'platformRestart']) assert.equal(state[key], null);
 }
 assert.equal(normalIdentity.contextTransfer.status.targetIdentityResultBridgeReady, true);
 assert.equal(normalIngress.status.providerResultIngressConnected, false);
});
test('ingress preserves generic error and burns a genuine receipt on missing/extra arguments', async () => {
 for (const extra of [false, true]) {
  const f = await transferred(); reject(() => extra ? f.ingress.takeObservation(f.receipt, f.session, true) : f.ingress.takeObservation(f.receipt));
  reject(() => f.identity.acceptContextObservation(f.session, f.receipt)); assert.equal(f.contextRecord(f.execution).closed, true);
 }
});
test('intent permit with counterfeit context cannot acquire adapter ownership', () => {
 const f = fixture(), session = f.identity.startTargetIdentitySession(f.target), copy = clone(f.execution);
 const permit = f.identity.contextTransfer.preparePermit(session, f.target, copy, f.hand);
 reject(() => f.adapter.bindContextResultTransfer(copy, f.hand, permit));
 reject(() => f.adapter.bindContextResultTransfer(f.execution, f.hand, permit));
 assert.equal(f.identity.inspectSession(session).stage, 'failed');
});
test('receipt retains the original validated upstream body; no ID or hash reconstruction', async () => {
 const f = await resulted(), originalBody = f.resultRecord(f.result).body;
 const receipt = f.adapter.prepareContextResultTransfer(f.result, f.bind), observation = f.ingress.takeObservation(receipt, f.session);
 assert.equal(observation.body, originalBody); assert.ok(Object.isFrozen(observation.body));
 f.adapter.closeExecutionContext(f.execution);
});
