'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const normal = require('../../scripts/assessment-worker/qualification-railway-target-identity.cjs');
const ingress = require('../../scripts/assessment-worker/qualification-railway-target-identity-provider-boundary.cjs');
const targets = require('../../scripts/assessment-worker/qualification-railway-introspection-target.cjs');
const context = require('../../scripts/assessment-worker/qualification-railway-project-token-context.cjs');
const { loadIdentity } = require('./fixtures/0111-target-identity.cjs');
const clone = v => JSON.parse(JSON.stringify(v));
const scope = { environmentKind: 'disposable', lifecycle: 'active', projectId: 'synthetic-project', environmentId: 'synthetic-env', serviceId: 'synthetic-service', serviceInstanceId: null };
const categories = ['projectIds', 'environmentIds', 'serviceIds', 'serviceInstanceIds'];
function binding(value = scope) { return targets.bindTarget(value, value, { inventoryReviewed: true, ...Object.fromEntries(categories.map(k => [k, []])) }); }
const contextBody = () => ({ data: { projectToken: { projectId: scope.projectId, environmentId: scope.environmentId } } });
const serviceBody = () => ({ data: { project: { id: scope.projectId, services: {
 edges: [{ node: { id: scope.serviceId, name: 'myapp-backend' } }], pageInfo: { hasNextPage: false } } } } });
const instanceBody = () => ({ data: { serviceInstance: { id: 'synthetic-instance', serviceName: 'myapp-backend', rootDirectory: '/movement-app', region: 'synthetic-region' } } });
const inventory = () => ({ inventoryReviewed: true, basis: 'operator safety policy', provenance: 'independently reviewed operator metadata',
 ...Object.fromEntries(categories.map(k => [k, { reviewed: true, completenessAcknowledged: true, completenessIsOperatorAssertion: true, ids: [], labels: [] }])) });
function fixture() { const h = loadIdentity(), target = binding(), session = h.api.startTargetIdentitySession(target), execution = Object.freeze({}); return { ...h, target, session, execution }; }
function contextRecord(f) { return { kind: 'project_token_context', session: f.session, binding: f.target, executionContext: f.execution,
 endpoint: 'https://backboard.railway.com/graphql/v2', authKind: 'project_token', request: context.buildRequest(), body: contextBody() }; }
function attest(f = fixture()) { f.api.acceptContextObservation(f.session, f.issue(contextRecord(f))); return f; }
function invocation(f) {
 const review = f.api.reviewNextIdentityRequest(f.session), permit = f.api.approveIdentityReview(review, { ...review.meta, reviewed: true });
 const handoff = f.api.consumeIdentityPermitForFutureAdapter(permit, f.session);
 return { review, permit, handoff, receipt: f.api.takeIdentityHandoffForFutureAdapter(handoff, f.session, f.execution) };
}
function resultRecord(f, receipt, body) { return { ...receipt, endpoint: 'https://backboard.railway.com/graphql/v2', authKind: 'project_token', body }; }
function discover(f = attest()) { const { receipt } = invocation(f); f.api.acceptIdentityObservation(f.session, receipt.invocation, f.issue(resultRecord(f, receipt, serviceBody())));
 const review = f.api.reviewObservedServiceCandidate(f.session);
 f.api.approveObservedServiceCandidate(review, f.session, { ...clone(review), reviewed: true }); return f; }
function candidate(f = discover()) { const { receipt } = invocation(f); f.api.acceptIdentityObservation(f.session, receipt.invocation, f.issue(resultRecord(f, receipt, instanceBody()))); return f; }
function approveCandidate(f = candidate(), value = inventory()) {
 const review = f.api.reviewTargetCandidate(f.session), inv = f.api.reviewForbiddenInventory(f.target, value);
 const ack = { reviewed: true, candidate: clone(review.candidate), candidateSha256: review.candidateSha256, inventorySha256: inv.inventorySha256,
  noForbiddenCollision: true, intendedDisposableNonProduction: true };
 return { f, review, inv, ack };
}
const reject = fn => assert.throws(fn, /identity unavailable|observation unavailable|target preflight unavailable/);
test.beforeEach(t => {
 let calls = 0;
 t.mock.method(require('node:https'), 'request', () => { calls++; throw Error('REAL NETWORK FORBIDDEN'); });
 t.mock.method(global, 'fetch', () => { calls++; throw Error('REAL NETWORK FORBIDDEN'); });
 t.after(() => assert.equal(calls, 0));
});
for (const [key, name, sha, file] of [
 ['projectServices', 'Movement0111ProjectServices', 'fa6231580d6acec3510c26f4be5972605a3648c4c47f7da73eaa24021b137833', 'project-services.graphql'],
 ['serviceInstance', 'Movement0111ServiceInstance', 'e247e7ec5e98cc71bc399304c37846ede31d7009096da4449f9bc8e88f267493', 'service-instance.graphql']]) {
 test('fixed exact query source/name/SHA: ' + name, () => {
  const d = normal.documents[key], disk = fs.readFileSync(path.resolve(__dirname, '../../docs/0111-target-identity', file), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(d.source + '\n', disk); assert.equal(d.operationName, name); assert.equal(d.canonicalSha256, sha);
  assert.equal(crypto.createHash('sha256').update(d.source + '\n').digest('hex'), sha); assert.ok(Object.isFrozen(d));
  assert.doesNotMatch(d.source, /mutation|\bme\b|workspace|logs|latestDeployment|restartPolicy|secrets|commands/);
 });
}
test('original target only; expected IDs and labels never populate provider observations', () => {
 const f = fixture(), status = f.api.inspectSession(f.session);
 for (const [key, value] of Object.entries(status.ids)) { assert.equal(value.operatorExpectedValue, scope[key]); assert.equal(value.providerObservedValue, null); }
 assert.equal(status.expectations.labelsAuthoritative, false); assert.equal(status.providerObserved, false);
 assert.equal(status.projectNameObserved, null); assert.equal(status.environmentNameObserved, null);
 reject(() => normal.startTargetIdentitySession(clone(f.target))); reject(() => normal.startTargetIdentitySession(scope));
 reject(() => normal.startTargetIdentitySession(f.target, { observed: scope }));
 reject(() => f.api.inspectSession(clone(f.session)));
});
test('normal unresolved template has no actual IDs, observations, human review or live permission', () => {
 const t = normal.reviewTemplate(); assert.equal(t.notice, 'TARGET IDENTITY NOT OBSERVED'); assert.equal(t.outcome, 'TARGET_IDENTITY_UNRESOLVED');
 for (const value of Object.values(t.ids)) assert.equal(value, null);
 assert.equal(t.observed, null); assert.equal(t.providerObserved, false); assert.equal(t.humanReviewed, false); assert.equal(t.manualLiveAuthorization, false);
 assert.deepEqual(JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../docs/0111-target-identity-review-template.json'), 'utf8')), t);
});
test('normal closed ingress accepts no caller-built, serialized, validator or synthetic VM result', () => {
 assert.equal(ingress.status.providerResultIngressConnected, false); assert.deepEqual(Object.keys(ingress), ['status', 'takeObservation']);
 for (const handle of [{}, contextBody(), validateServices(serviceBody()), fixture().issue({})]) reject(() => ingress.takeObservation(handle));
 const target = binding(), session = normal.startTargetIdentitySession(target);
 reject(() => normal.acceptContextObservation(session, contextBody())); assert.equal(normal.inspectSession(session).stage, 'failed');
});
test('context transfer namespace remains consumer-gated and local readiness grants no observation', () => {
 assert.deepEqual(Object.keys(normal.contextTransfer), ['preparePermit', 'takePermit', 'assertSlot', 'takeSlot', 'takeAcceptance', 'cancelSlot', 'status']);
 assert.equal(normal.contextTransfer.status.targetIdentityResultBridgeReady, true);
 assert.equal(normal.contextTransfer.status.providerResultIngressConnected, false);
 const target = binding(), session = normal.startTargetIdentitySession(target);
 reject(() => normal.contextTransfer.preparePermit(clone(session), target, {}, {}));
 reject(() => normal.contextTransfer.takePermit({}, {}, {})); reject(() => normal.contextTransfer.takeSlot({}, session));
 reject(() => normal.contextTransfer.takeAcceptance({}, session)); reject(() => ingress.takeObservation(contextBody(), session));
 assert.equal(normal.inspectSession(session).ids.projectId.providerObservedValue, null);
});
test('service discovery and candidate impossible before context; instance impossible before services', () => {
 const f = fixture(); reject(() => f.api.reviewNextIdentityRequest(f.session)); reject(() => f.api.reviewTargetCandidate(f.session));
 attest(f); const r = f.api.reviewNextIdentityRequest(f.session);
 assert.equal(r.meta.operationName, 'Movement0111ProjectServices'); reject(() => f.api.reviewTargetCandidate(f.session));
});
for (const bad of ['rawBody', 'copied', 'differentSession', 'differentTarget', 'wrongKind', 'wrongProject', 'wrongEnvironment', 'wrongEndpoint', 'wrongAuth', 'wrongQuery', 'missingExecution']) {
 test('context observation rejects/burns incorrect private chain: ' + bad, () => {
  const f = fixture(), r = contextRecord(f); let handle;
  if (bad === 'differentSession') r.session = fixture().session;
  if (bad === 'differentTarget') r.binding = binding();
  if (bad === 'wrongKind') r.kind = 'project_services';
  if (bad === 'wrongProject') r.body.data.projectToken.projectId = 'other';
  if (bad === 'wrongEnvironment') r.body.data.projectToken.environmentId = 'other';
  if (bad === 'wrongEndpoint') r.endpoint = 'https://other';
  if (bad === 'wrongAuth') r.authKind = 'account_token';
  if (bad === 'wrongQuery') r.request = { ...r.request, operationName: 'Other' };
  if (bad === 'missingExecution') r.executionContext = null;
  handle = f.issue(r); if (bad === 'rawBody') handle = r.body; if (bad === 'copied') handle = clone(handle);
  reject(() => f.api.acceptContextObservation(f.session, handle)); assert.equal(f.api.inspectSession(f.session).stage, 'failed');
  reject(() => f.api.acceptContextObservation(f.session, f.issue(contextRecord(f))));
 });
}
test('private context result one-use, exact evidence sources, globally false', () => {
 const f = fixture(), result = f.issue(contextRecord(f)); f.api.acceptContextObservation(f.session, result);
 const s = f.api.inspectSession(f.session); assert.equal(s.ids.projectId.providerObservedValue, scope.projectId);
 assert.equal(s.ids.environmentId.providerObservedValue, scope.environmentId); assert.equal(s.ids.serviceId.providerObservedValue, null);
 assert.equal(s.ids.projectId.providerEvidenceSource, 'provider_project_token_context'); reject(() => f.api.acceptContextObservation(f.session, result));
});
test('variables come only from private observed chain, with no source/operation/variable override', () => {
 const f = attest(), first = invocation(f);
 assert.deepEqual(clone(first.receipt.request.variables), { id: scope.projectId });
 for (const extra of ['query Other { me { id } }', { operationName: 'Other' }, { variables: { id: 'arbitrary' } }]) reject(() => f.api.reviewNextIdentityRequest(f.session, extra));
 f.api.acceptIdentityObservation(f.session, first.receipt.invocation, f.issue(resultRecord(f, first.receipt, serviceBody())));
 const serviceReview = f.api.reviewObservedServiceCandidate(f.session);
 f.api.approveObservedServiceCandidate(serviceReview, f.session, { ...clone(serviceReview), reviewed: true });
 const second = invocation(f); assert.deepEqual(clone(second.receipt.request.variables), { serviceId: scope.serviceId, environmentId: scope.environmentId });
 assert.equal(second.receipt.request.operationName, 'Movement0111ServiceInstance');
});
test('review/permit/handoff/invocation are original one-use capabilities; detached records fail', () => {
 const f = attest(), r = f.api.reviewNextIdentityRequest(f.session);
 reject(() => f.api.approveIdentityReview(clone(r), { ...r.meta, reviewed: true }));
 const p = f.api.approveIdentityReview(r, { ...r.meta, reviewed: true }); reject(() => f.api.approveIdentityReview(r, { ...r.meta, reviewed: true }));
 reject(() => f.api.consumeIdentityPermitForFutureAdapter(clone(p), f.session));
 const h = f.api.consumeIdentityPermitForFutureAdapter(p, f.session); reject(() => f.api.consumeIdentityPermitForFutureAdapter(p, f.session));
 reject(() => f.api.takeIdentityHandoffForFutureAdapter(clone(h), f.session, f.execution));
 const receipt = f.api.takeIdentityHandoffForFutureAdapter(h, f.session, f.execution); reject(() => f.api.takeIdentityHandoffForFutureAdapter(h, f.session, f.execution));
 const result = f.issue(resultRecord(f, receipt, serviceBody())); reject(() => f.api.acceptIdentityObservation(f.session, clone(receipt.invocation), result));
 f.api.acceptIdentityObservation(f.session, receipt.invocation, result); reject(() => f.api.acceptIdentityObservation(f.session, receipt.invocation, result));
});
test('reviewed true requires exact metadata; invalid acknowledgements burn original review', () => {
 for (const ackFor of [r => ({ reviewed: true }), r => ({ ...r.meta, reviewed: false }), r => ({ ...r.meta, reviewed: true, token: 'synthetic' }), r => ({ ...r.meta, reviewed: true, operationName: 'Other' })]) {
  const f = attest(), r = f.api.reviewNextIdentityRequest(f.session); reject(() => f.api.approveIdentityReview(r, ackFor(r)));
  reject(() => f.api.approveIdentityReview(r, { ...r.meta, reviewed: true }));
 }
});
test('wrong session burns permit; wrong execution context burns handoff and fails session', () => {
 const f = attest(), r = f.api.reviewNextIdentityRequest(f.session), p = f.api.approveIdentityReview(r, { ...r.meta, reviewed: true });
 reject(() => f.api.consumeIdentityPermitForFutureAdapter(p, attest().session)); reject(() => f.api.consumeIdentityPermitForFutureAdapter(p, f.session));
 const next = f.api.reviewNextIdentityRequest(f.session), permit = f.api.approveIdentityReview(next, { ...next.meta, reviewed: true });
 const hand = f.api.consumeIdentityPermitForFutureAdapter(permit, f.session);
 reject(() => f.api.takeIdentityHandoffForFutureAdapter(hand, f.session, {})); reject(() => f.api.takeIdentityHandoffForFutureAdapter(hand, f.session, f.execution));
 assert.equal(f.api.inspectSession(f.session).stage, 'failed');
});
test('stale stage reviews and permits cannot be used after original stage advances', () => {
 const f = attest(), staleReview = f.api.reviewNextIdentityRequest(f.session), r = f.api.reviewNextIdentityRequest(f.session);
 const stalePermit = f.api.approveIdentityReview(r, { ...r.meta, reviewed: true }); discover(f);
 reject(() => f.api.approveIdentityReview(staleReview, { ...staleReview.meta, reviewed: true }));
 reject(() => f.api.consumeIdentityPermitForFutureAdapter(stalePermit, f.session));
});
for (const [name, edit] of [
 ['errors', b => { b.errors = []; }], ['extra field', b => { b.data.project.secret = 'synthetic'; }],
 ['wrong project', b => { b.data.project.id = 'other'; }], ['null project', b => { b.data.project = null; }],
 ['zero matches', b => { b.data.project.services.edges = []; }], ['case match', b => { b.data.project.services.edges[0].node.name = 'MYAPP-BACKEND'; }],
 ['fuzzy match', b => { b.data.project.services.edges[0].node.name = 'myapp-backend-copy'; }],
 ['duplicate name', b => { b.data.project.services.edges.push({ node: { id: 'other', name: 'myapp-backend' } }); }],
 ['duplicate ID', b => { b.data.project.services.edges.push({ node: { id: scope.serviceId, name: 'other' } }); }],
 ['malformed ID', b => { b.data.project.services.edges[0].node.id = 'bad/id'; }],
 ['missing ID', b => { delete b.data.project.services.edges[0].node.id; }],
 ['too many', b => { b.data.project.services.edges = Array.from({ length: 257 }, (_, i) => ({ node: { id: 'id-' + i, name: 'name-' + i } })); }],
 ['malformed edges', b => { b.data.project.services.edges = {}; }], ['null node', b => { b.data.project.services.edges[0].node = null; }]]) {
 test('project-services exact validation rejects ' + name, () => { const b = serviceBody(); edit(b); reject(() => validateServices(b)); });
}
test('exact service selection does not choose first unrelated item; bounded valid array accepted', () => {
 const b = serviceBody(); b.data.project.services.edges.unshift({ node: { id: 'other', name: 'other' } });
 assert.equal(validateServices(b).serviceId, scope.serviceId);
 assert.equal(validateServices(b).serviceContextProven, false);
});
test('fixed service query observes hasNextPage with updated canonical SHA and no paging inputs', () => {
 const doc = normal.documents.projectServices;
 assert.match(doc.source, /pageInfo \{\n        hasNextPage\n      \}/);
 assert.notEqual(doc.canonicalSha256, '6c50e06f184942cf0350d73b44d21fe8180e8bd5d0a8b35c96564f8ae28d9d3d');
 assert.doesNotMatch(doc.source, /\bfirst\b|\bafter\b|\bcursor\b|\bendCursor\b/);
 const f = attest(), r = f.api.reviewNextIdentityRequest(f.session);
 assert.deepEqual(JSON.parse(r.artifacts.variablesJson), { id: scope.projectId });
 for (const extra of [{ first: 256 }, { after: 'caller-cursor' }, { cursor: 'caller-cursor' }, { pagingCallback: () => assert.fail('paging callback') }]) {
  reject(() => f.api.reviewNextIdentityRequest(f.session, extra));
 }
});
for (const [name, edit] of [
 ['missing pageInfo', b => { delete b.data.project.services.pageInfo; }],
 ['null pageInfo', b => { b.data.project.services.pageInfo = null; }],
 ['array pageInfo', b => { b.data.project.services.pageInfo = []; }],
 ['extra pageInfo field', b => { b.data.project.services.pageInfo.endCursor = 'synthetic'; }],
 ['missing hasNextPage', b => { delete b.data.project.services.pageInfo.hasNextPage; }],
 ['extra services field', b => { b.data.project.services.totalCount = 1; }],
 ['true with exact target present', b => { b.data.project.services.pageInfo.hasNextPage = true; }],
 ...[null, undefined, 0, 1, 'false', 'true', [], {}].map(value => ['non-boolean ' + String(value), b => { b.data.project.services.pageInfo.hasNextPage = value; }])]) {
 test('pagination validation fails closed: ' + name, () => {
  const b = serviceBody(); edit(b); reject(() => validateServices(b));
 });
}
test('complete single-page false + unique exact target accepted; truncated empty page also rejected', () => {
 assert.equal(validateServices(serviceBody()).serviceId, scope.serviceId);
 const b = serviceBody(); b.data.project.services.edges = []; b.data.project.services.pageInfo.hasNextPage = true;
 reject(() => validateServices(b));
});
test('truncated private observation fails session before storing service; cannot replay repaired body or generate another request', () => {
 const f = attest(), { receipt } = invocation(f), b = serviceBody(); b.data.project.services.pageInfo.hasNextPage = true;
 const result = f.issue(resultRecord(f, receipt, b));
 reject(() => f.api.acceptIdentityObservation(f.session, receipt.invocation, result));
 assert.equal(f.api.inspectSession(f.session).stage, 'failed');
 assert.equal(f.api.inspectSession(f.session).ids.serviceId.providerObservedValue, null);
 assert.equal(f.api.inspectSession(f.session).ids.serviceInstanceId.providerObservedValue, null);
 b.data.project.services.pageInfo.hasNextPage = false;
 reject(() => f.api.acceptIdentityObservation(f.session, receipt.invocation, result));
 reject(() => f.api.acceptIdentityObservation(f.session, receipt.invocation, f.issue(resultRecord(f, receipt, b))));
 reject(() => f.api.reviewNextIdentityRequest(f.session)); reject(() => f.api.reviewTargetCandidate(f.session));
 assert.equal(f.consumed.filter(handle => handle === result).length, 1);
});
for (const [name, edit] of [
 ['errors', b => { b.errors = []; }], ['null', b => { b.data.serviceInstance = null; }],
 ['missing ID', b => { delete b.data.serviceInstance.id; }], ['malformed ID', b => { b.data.serviceInstance.id = 'bad/id'; }],
 ['wrong name', b => { b.data.serviceInstance.serviceName = 'other'; }], ['case name', b => { b.data.serviceInstance.serviceName = 'MYAPP-BACKEND'; }],
 ['root mismatch', b => { b.data.serviceInstance.rootDirectory = '/other'; }], ['region malformed', b => { b.data.serviceInstance.region = {}; }],
 ['extra deployment', b => { b.data.serviceInstance.latestDeployment = {}; }]]) {
 test('service-instance exact validation rejects ' + name, () => { const b = instanceBody(); edit(b); reject(() => validateInstance(b)); });
}
test('null root/region allowed as unresolved corroboration; response ID alone supplies instance ID', () => {
 const b = instanceBody(); b.data.serviceInstance.rootDirectory = null; b.data.serviceInstance.region = null;
 const result = validateInstance(b); assert.equal(result.serviceInstanceId, 'synthetic-instance');
 assert.equal(result.rootDirectory, null); assert.equal(result.region, null); assert.equal(result.validationOnly, true);
});
for (const stage of ['services', 'instance']) for (const wrong of ['serviceId', 'environmentId', 'execution', 'session', 'binding', 'invocation', 'endpoint', 'kind']) {
 test('private response invocation binding rejects ' + wrong + ' at ' + stage, () => {
  const f = stage === 'services' ? attest() : discover(), { receipt } = invocation(f), r = resultRecord(f, receipt, stage === 'services' ? serviceBody() : instanceBody());
  if (wrong === 'serviceId') r.request = { ...r.request, variables: stage === 'services' ? { id: 'other' } : { ...r.request.variables, serviceId: 'other' } };
  if (wrong === 'environmentId') r.request = { ...r.request, variables: { ...r.request.variables, environmentId: 'other' } };
  if (wrong === 'execution') r.executionContext = {};
  if (wrong === 'session') r.session = fixture().session;
  if (wrong === 'binding') r.binding = binding();
  if (wrong === 'invocation') r.invocation = {};
  if (wrong === 'endpoint') r.endpoint = 'other';
  if (wrong === 'kind') r.kind = 'schema';
  const result = f.issue(r); reject(() => f.api.acceptIdentityObservation(f.session, receipt.invocation, result));
  reject(() => f.api.acceptIdentityObservation(f.session, receipt.invocation, f.issue(resultRecord(f, receipt, stage === 'services' ? serviceBody() : instanceBody()))));
  assert.equal(f.api.inspectSession(f.session).stage, 'failed');
 });
}
test('provider service/instance must also match retained operator target constraints', () => {
 const f = attest(), { receipt } = invocation(f), b = serviceBody(); b.data.project.services.edges[0].node.id = 'other';
 reject(() => f.api.acceptIdentityObservation(f.session, receipt.invocation, f.issue(resultRecord(f, receipt, b))));
 const g = fixture(); g.target = binding({ ...scope, serviceInstanceId: 'expected-instance' }); g.session = g.api.startTargetIdentitySession(g.target);
 discover(attest(g)); const next = invocation(g); reject(() => g.api.acceptIdentityObservation(g.session, next.receipt.invocation, g.issue(resultRecord(g, next.receipt, instanceBody()))));
});
test('future ingress must burn results from closed credential lifetimes; no revival', () => {
 for (const stage of ['context', 'services', 'instance']) {
  const f = stage === 'context' ? fixture() : stage === 'services' ? attest() : discover();
  const receipt = stage === 'context' ? null : invocation(f).receipt;
  const result = f.issue(stage === 'context' ? contextRecord(f) : resultRecord(f, receipt, stage === 'services' ? serviceBody() : instanceBody()));
  f.closeExecution(f.execution);
  reject(() => stage === 'context' ? f.api.acceptContextObservation(f.session, result) : f.api.acceptIdentityObservation(f.session, receipt.invocation, result));
  assert.equal(f.api.inspectSession(f.session).stage, 'failed');
  reject(() => stage === 'context' ? f.api.acceptContextObservation(f.session, result) : f.api.acceptIdentityObservation(f.session, receipt.invocation, result));
 }
});
test('hidden credential fields/getters cannot enter exact provider or inventory records', () => {
 const f = fixture(), b = serviceBody(); let reads = 0;
 Object.defineProperty(b.data.project, 'secret', { value: 'synthetic', enumerable: false });
 reject(() => validateServices(b));
 const v = inventory(); Object.defineProperty(v.projectIds, 'reviewed', { enumerable: true, get() { reads++; throw Error('must not read'); } });
 reject(() => f.api.reviewForbiddenInventory(f.target, v)); assert.equal(reads, 0);
 reject(() => f.api.startTargetIdentitySession(f.target, () => assert.fail('env reader')));
});
for (const category of categories) {
 test('inventory requires completeness/review and valid category ' + category, () => {
  const f = fixture();
  for (const edit of [v => { delete v[category]; }, v => { v[category].reviewed = false; }, v => { v[category].completenessAcknowledged = false; },
   v => { v[category].completenessIsOperatorAssertion = false; }, v => { v[category].ids = null; }, v => { v[category].ids = ['same', 'same']; },
   v => { v[category].ids = ['bad/id']; }, v => { v[category].labels = [{ id: 'unknown', label: 'unknown' }]; }]) {
   const v = inventory(); edit(v); reject(() => f.api.reviewForbiddenInventory(f.target, v));
  }
 });
 test('inventory detects exact own-category collision ' + category, () => {
  const f = fixture(), t = binding({ ...scope, serviceInstanceId: 'synthetic-instance' }), v = inventory();
  v[category].ids = [category === 'serviceInstanceIds' ? 'synthetic-instance' : scope[category.slice(0, -1)]];
  reject(() => f.api.reviewForbiddenInventory(t, v));
 });
}
test('inventory basis/provenance mandatory; exact namespaces/case and separate Supabase metadata retained', () => {
 const f = fixture(); for (const key of ['inventoryReviewed', 'basis', 'provenance']) { const v = inventory(); delete v[key]; reject(() => f.api.reviewForbiddenInventory(f.target, v)); }
 const v = inventory(); v.projectIds.ids = [scope.environmentId, scope.projectId.toUpperCase()]; v.environmentIds.ids = [scope.projectId];
 v.projectIds.labels = [{ id: scope.environmentId, label: 'reviewed other project' }];
 const r = f.api.reviewForbiddenInventory(f.target, v); assert.deepEqual(clone(r.inventory.projectIds.ids), v.projectIds.ids);
 assert.equal(r.crossSystemForbidden.railwayNamespace, false); assert.equal(r.crossSystemForbidden.production, 'xdfmoggrsucisfybqctb');
 assert.equal(r.crossSystemForbidden.inactive, 'udlsysezmzutydnifhsq'); assert.equal(r.crossSystemForbidden.consumedHistoricalDisposable, 'uzkhnslyrhgucijcuoes');
 assert.equal(r.crossSystemForbidden.newQualificationAuthorized, false);
});
test('full synthetic candidate holds provider-only observed values and exact evidence, with no global proof', () => {
 const f = candidate(), r = f.api.reviewTargetCandidate(f.session), c = r.candidate;
 assert.equal(c.projectId, scope.projectId); assert.equal(c.environmentId, scope.environmentId); assert.equal(c.serviceId, scope.serviceId);
 assert.equal(c.serviceInstanceId, 'synthetic-instance'); assert.equal(c.serviceNameObserved, 'myapp-backend');
 assert.equal(c.rootDirectoryObserved, '/movement-app'); assert.equal(c.regionObserved, 'synthetic-region');
 assert.equal(c.providerObserved, true); assert.equal(c.humanReviewed, false); assert.equal(c.serviceContextProven, false);
 assert.equal(c.evidence.projectEnvironment, 'provider_project_token_context'); assert.equal(c.evidence.service, 'provider_project_services');
 assert.equal(c.evidence.serviceInstance, 'provider_service_instance_metadata'); assert.equal(c.projectNameObserved, null);
 assert.ok(Object.isFrozen(c)); reject(() => normal.approveTargetCandidate(r, {}, {}));
});
test('candidate review requires exact observations/labels/evidence and disposable collision acknowledgements', () => {
 for (const edit of [a => { a.reviewed = false; }, a => { a.noForbiddenCollision = false; }, a => { a.intendedDisposableNonProduction = false; },
  a => { a.candidate.projectId = 'other'; }, a => { a.candidate.rootDirectoryObserved = '/other'; }, a => { a.candidate.evidence.service = 'operator_label'; },
  a => { a.candidateSha256 = 'other'; }, a => { a.inventorySha256 = 'other'; }, a => { a.liveAuthorized = true; }]) {
  const { f, review, inv, ack } = approveCandidate(); edit(ack); reject(() => f.api.approveTargetCandidate(review, inv, ack));
  reject(() => f.api.approveTargetCandidate(review, inv, { ...ack, reviewed: true }));
 }
});
test('candidate and inventory copied or rebound handles fail; discovered instance collision rechecked', () => {
 const { f, review, inv, ack } = approveCandidate();
 reject(() => f.api.approveTargetCandidate(clone(review), inv, ack));
 reject(() => f.api.approveTargetCandidate(review, clone(inv), ack));
 const next = f.api.reviewTargetCandidate(f.session), v = inventory(); v.serviceInstanceIds.ids = ['synthetic-instance'];
 const collision = f.api.reviewForbiddenInventory(f.target, v);
 reject(() => f.api.approveTargetCandidate(next, collision, { ...ack, inventorySha256: collision.inventorySha256 }));
 const other = f.api.reviewForbiddenInventory(binding(), inventory()), last = f.api.reviewTargetCandidate(f.session);
 reject(() => f.api.approveTargetCandidate(last, other, { ...ack, inventorySha256: other.inventorySha256 }));
});
test('reviewed candidate yields fresh original target and 0110 inventory wrapper once, never live permission', () => {
 const { f, review, inv, ack } = approveCandidate(), handoff = f.api.approveTargetCandidate(review, inv, ack);
 reject(() => f.api.approveTargetCandidate(review, inv, ack)); reject(() => f.api.takeReviewedTargetFor0110(clone(handoff), f.target));
 const result = f.api.takeReviewedTargetFor0110(handoff, f.target); reject(() => f.api.takeReviewedTargetFor0110(handoff, f.target));
 const actual = targets.describeTarget(result.privateTarget); assert.notEqual(result.privateTarget, f.target);
 assert.equal(actual.serviceInstanceId, 'synthetic-instance'); assert.equal(result.reviewedCandidate.humanReviewed, true);
 assert.equal(result.liveAuthorized, false); for (const k of categories) { assert.equal(result.inventoryFor0110[k].reviewed, true); assert.deepEqual(clone(result.inventoryFor0110[k].ids), []); }
 assert.equal(result.inventoryProvenance.projectIds.completenessAcknowledged, true);
});
test('wrong original target burns candidate handoff', () => {
 const { f, review, inv, ack } = approveCandidate(), handoff = f.api.approveTargetCandidate(review, inv, ack);
 reject(() => f.api.takeReviewedTargetFor0110(handoff, binding())); reject(() => f.api.takeReviewedTargetFor0110(handoff, f.target));
});
test('authority stays unresolved after synthetic complete chain; source has no env/network/CLI/credential reader', () => {
 const f = candidate();
 for (const api of [normal, f.api]) {
  assert.equal(api.state.outcome, 'TARGET_IDENTITY_UNRESOLVED'); assert.equal(api.state.targetIdentityAcquisitionReady, true);
  assert.equal(api.state.targetIdentityObserved, false); assert.equal(api.state.providerResultIngressConnected, false);
  for (const k of ['providerContextObserved', 'projectEnvironmentContextProven', 'serviceContextProven', 'executionSchemaReady']) assert.equal(api.state[k], false);
  for (const k of ['identity_proven', 'causality_proven', 'restart_origin_proven', 'platformRestart']) assert.equal(api.state[k], null);
 }
 for (const name of ['qualification-railway-target-identity.cjs', 'qualification-railway-target-identity-provider-boundary.cjs']) {
  const text = fs.readFileSync(path.resolve(__dirname, '../../scripts/assessment-worker', name), 'utf8');
  assert.doesNotMatch(text, /process\.env|fetch\s*\(|https\.request\s*\(|child_process|openExecutionContext\s*\(|executeHandoff\s*\(/);
 }
});

function validateServices(body){const f=fixture();return f.api.validateProjectServices(f.session,body);}
function validateInstance(body){const f=fixture();return f.api.validateServiceInstance(f.session,body);}
