'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const normal = require('../../scripts/assessment-worker/qualification-railway-live-authorization.cjs');
const identity = require('../../scripts/assessment-worker/qualification-railway-target-identity.cjs');
const { clone, scope, binding, identityFixture, serviceFixture, observe, serviceBody, serviceAck, acquisitionFixture, acquisitionAck } = require('./fixtures/0114a-foundation.cjs');
const reject = fn => assert.throws(fn, /unavailable/);
test.beforeEach(t => {
 let calls = 0;
 for (const [obj, name] of [[require('node:https'), 'request'], [require('node:http'), 'request'], [global, 'fetch']])
  t.mock.method(obj, name, () => { calls++; throw Error('REAL NETWORK FORBIDDEN'); });
 t.after(() => assert.equal(calls, 0));
});
test('valid accepted service ends at service_review; old APIs, boolean and matching JSON cannot skip it', () => {
 const f = serviceFixture();
 assert.equal(f.api.inspectSession(f.session).stage, 'service_review');
 assert.equal(f.api.inspectSession(f.session).ids.serviceId.providerObservedValue, scope.serviceId);
 reject(() => f.api.reviewNextIdentityRequest(f.session));
 reject(() => f.api.reviewNextIdentityRequest(f.session, { humanReviewed: true }));
 reject(() => f.api.reviewNextIdentityRequest({ ...scope, humanReviewed: true }));
 reject(() => f.api.reviewTargetCandidate(f.session));
 reject(() => f.api.reviewObservedServiceCandidate(clone(f.session)));
});
test('review contains exact sufficient descriptive fields and exposes no capability or raw result', () => {
 const f = serviceFixture(), r = f.api.reviewObservedServiceCandidate(f.session);
 assert.deepEqual(Object.keys(r).sort(), ['candidate', 'liveAuthorized', 'revision']);
 assert.deepEqual(Object.keys(r.candidate).sort(), ['observedServiceId', 'observedServiceName', 'expectedServiceId', 'expectedServiceName',
  'providerObserved', 'evidenceSource', 'projectId', 'environmentId', 'projectNameExpected', 'environmentNameExpected',
  'projectNameObserved', 'environmentNameObserved', 'parentContextEvidenceSource'].sort());
 assert.equal(r.candidate.observedServiceId, scope.serviceId); assert.equal(r.candidate.expectedServiceId, scope.serviceId);
 assert.equal(r.candidate.observedServiceName, 'myapp-backend'); assert.equal(r.candidate.expectedServiceName, 'myapp-backend');
 assert.equal(r.candidate.providerObserved, true); assert.equal(r.revision, 2); assert.equal(r.liveAuthorized, false);
 assert.ok(Object.isFrozen(r.candidate)); reject(() => f.api.reviewObservedServiceCandidate(f.session));
});
test('exact original approval transitions same session once, enables fixed instance variables, then final target review', () => {
 const f = serviceFixture(), r = f.api.reviewObservedServiceCandidate(f.session);
 assert.equal(f.api.approveObservedServiceCandidate(r, f.session, serviceAck(r)).stage, 'service_instance');
 reject(() => f.api.approveObservedServiceCandidate(r, f.session, serviceAck(r)));
 reject(() => f.api.reviewObservedServiceCandidate(f.session)); reject(() => f.api.reviewTargetCandidate(f.session));
 const next = f.api.reviewNextIdentityRequest(f.session);
 assert.equal(next.meta.operationName, 'Movement0111ServiceInstance');
 assert.deepEqual(JSON.parse(next.artifacts.variablesJson), { serviceId: scope.serviceId, environmentId: scope.environmentId });
 observe(f, { data: { serviceInstance: { id: 'synthetic-instance', serviceName: 'myapp-backend', rootDirectory: '/movement-app', region: null } } });
 assert.equal(f.api.inspectSession(f.session).stage, 'candidate');
 assert.equal(f.api.reviewTargetCandidate(f.session).candidate.humanReviewed, false);
});
for (const kind of ['spread', 'serialized', 'candidate', 'serviceFacts', 'acknowledgement', 'matchingJSON']) {
 test('detached service input grants nothing: ' + kind, () => {
  const f = serviceFixture(), r = f.api.reviewObservedServiceCandidate(f.session);
  const input = kind === 'spread' ? { ...r } : kind === 'serialized' ? clone(r) : kind === 'candidate' ? clone(r.candidate) :
   kind === 'serviceFacts' ? clone(identity.validateProjectServices(scope.projectId, serviceBody())) :
   kind === 'acknowledgement' ? serviceAck(r) : { serviceId: scope.serviceId, serviceName: 'myapp-backend', humanReviewed: true };
  reject(() => f.api.approveObservedServiceCandidate(input, f.session, serviceAck(r)));
  reject(() => f.api.reviewObservedServiceCandidate(input));
  assert.equal(f.api.inspectSession(f.session).stage, 'service_review');
  f.api.approveObservedServiceCandidate(r, f.session, serviceAck(r));
 });
}
for (const kind of ['wrongSession', 'copiedSession', 'missingArg', 'extraArg', 'wrongRevision', 'booleanOnly', 'extraAck', 'changedCandidate', 'liveTrue']) {
 test('located genuine service review burns and cannot be reissued: ' + kind, () => {
  const f = serviceFixture(), r = f.api.reviewObservedServiceCandidate(f.session), ack = serviceAck(r);
  const args = [r, f.session, ack];
  if (kind === 'wrongSession') args[1] = f.api.startTargetIdentitySession(f.target);
  if (kind === 'copiedSession') args[1] = clone(f.session);
  if (kind === 'missingArg') args.pop();
  if (kind === 'extraArg') args.push(true);
  if (kind === 'wrongRevision') ack.revision++;
  if (kind === 'booleanOnly') args[2] = { humanReviewed: true };
  if (kind === 'extraAck') ack.humanReviewed = true;
  if (kind === 'changedCandidate') ack.candidate.observedServiceId = 'other';
  if (kind === 'liveTrue') ack.liveAuthorized = true;
  reject(() => f.api.approveObservedServiceCandidate(...args));
  reject(() => f.api.approveObservedServiceCandidate(r, f.session, serviceAck(r)));
  reject(() => f.api.reviewObservedServiceCandidate(f.session));
  assert.equal(f.api.inspectSession(f.session).stage, 'service_review');
  reject(() => f.api.reviewNextIdentityRequest(f.session));
 });
}
for (const field of ['revision', 'binding', 'executionContext', 'contextFacts', 'serviceFacts', 'serviceObservation']) {
 test('private retained state mismatch rejects and burns: ' + field, () => {
  const f = serviceFixture(true), r = f.api.reviewObservedServiceCandidate(f.session), state = f.api.testRecord(f.session), original = state[field];
  state[field] = field === 'revision' ? original + 1 : { ...original };
  reject(() => f.api.approveObservedServiceCandidate(r, f.session, serviceAck(r)));
  state[field] = original;
  reject(() => f.api.approveObservedServiceCandidate(r, f.session, serviceAck(r)));
  reject(() => f.api.reviewNextIdentityRequest(f.session));
 });
}
test('stale unapproved request reviews and permits cannot skip service_review', () => {
 const f = identityFixture(), r = f.api.reviewNextIdentityRequest(f.session), p = f.api.approveIdentityReview(r, { ...r.meta, reviewed: true });
 const stale = f.api.reviewNextIdentityRequest(f.session); observe(f);
 reject(() => f.api.consumeIdentityPermitForFutureAdapter(p, f.session));
 reject(() => f.api.approveIdentityReview(stale, { ...stale.meta, reviewed: true }));
 reject(() => f.api.reviewNextIdentityRequest(f.session));
});
for (const [name, edit] of [
 ['zero services', b => { b.data.project.services.edges = []; }],
 ['multiple exact names', b => { b.data.project.services.edges.push({ node: { id: 'other', name: 'myapp-backend' } }); }],
 ['duplicate IDs', b => { b.data.project.services.edges.push({ node: { id: scope.serviceId, name: 'other' } }); }],
 ['wrong expected ID', b => { b.data.project.services.edges[0].node.id = 'other'; }],
 ['malformed pagination', b => { b.data.project.services.pageInfo = {}; }],
 ...[true, null, 0, 'false'].map(v => ['hasNextPage ' + String(v), b => { b.data.project.services.pageInfo.hasNextPage = v; }])
]) {
 test('invalid service observation terminally fails: ' + name, () => {
  const f = identityFixture(), b = serviceBody(); edit(b); reject(() => observe(f, b));
  assert.equal(f.api.inspectSession(f.session).stage, 'failed');
  reject(() => f.api.reviewObservedServiceCandidate(f.session)); reject(() => f.api.reviewNextIdentityRequest(f.session));
 });
}
test('unrelated valid service allowed under existing selection policy; no new inventory policy invented', () => {
 const f = identityFixture(), b = serviceBody(); b.data.project.services.edges.unshift({ node: { id: 'other', name: 'other' } });
 observe(f, b); assert.equal(f.api.inspectSession(f.session).stage, 'service_review');
});
test('new acquisition namespace fixes order, hashes, three single provider requests and both human gates', () => {
 const m = normal.acquisitionReviewTemplate().manifest;
 assert.equal(m.version, 'movement_railway_identity_acquisition_auth_v1');
 assert.deepEqual(m.orderedOperations.map(v => v.operationName), ['Movement0108ProjectTokenContext', 'Movement0111ProjectServices',
  'HUMAN_SERVICE_REVIEW', 'Movement0111ServiceInstance', 'HUMAN_TARGET_REVIEW']);
 assert.equal(m.maxProviderRequests, 3); assert.equal(m.exactRequestOrderRequired, true);
 assert.deepEqual(m.orderedOperations.filter(v => v.kind === 'provider').map(v => v.maxRequests), [1, 1, 1]);
 for (const op of m.orderedOperations.filter(v => v.kind === 'provider')) assert.match(op.querySha256, /^[a-f0-9]{64}$/);
 assert.equal(m.humanServiceReviewRequired, true); assert.equal(m.finalHumanTargetReviewRequired, true);
 assert.equal(m.retries, 0); assert.equal(m.fallbackAllowed, false); assert.equal(m.redirectPolicy, 'reject');
 assert.equal(m.schemaAuthorized, false); assert.equal(m.transportSupported, false);
 assert.equal(normal.reviewTemplate().manifest.operationKind, 'project_token_context');
 assert.equal(normal.reviewTemplate().manifest.operationName, 'Movement0108ProjectTokenContext');
 assert.ok(!Object.hasOwn(normal.reviewTemplate().manifest, 'orderedOperations'));
});
test('safe acquisition template null IDs/head/branch, unchecked inventory, unauthorized and regenerated exactly', () => {
 const t = normal.acquisitionReviewTemplate(), m = t.manifest;
 for (const key of ['projectId', 'environmentId', 'serviceId', 'serviceInstanceId']) assert.equal(m.expectedTarget[key], null);
 assert.equal(m.reviewedHead, null); assert.equal(m.reviewedBranch, null);
 assert.equal(m.forbiddenRailwayInventory.inventoryReviewed, false);
 assert.equal(t.reviewed, false); assert.equal(t.liveAuthorized, false); assert.equal(t.manualLiveAuthorization, false);
 assert.equal(m.liveAuthorized, false); assert.equal(m.manualLiveAuthorization, false);
 assert.deepEqual(JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../docs/0114a-acquisition-review-template.json'), 'utf8')), t);
});
test('synthetic acquisition review/approval is original, one-use and never executable through old consumers', () => {
 const f = acquisitionFixture(), r = f.api.reviewAcquisitionPackage(f.draft);
 reject(() => f.api.reviewAcquisitionPackage(clone(f.draft))); reject(() => f.api.reviewAcquisitionPackage(f.draft));
 reject(() => f.api.approveAcquisitionPackageReview(clone(r), f.target, acquisitionAck(r)));
 const done = f.api.approveAcquisitionPackageReview(r, f.target, acquisitionAck(r));
 assert.equal(done.localReviewComplete, true); assert.equal(done.liveAuthorized, false); assert.equal(done.outcome, 'PRELIVE_NOT_AUTHORIZED');
 reject(() => f.api.approveAcquisitionPackageReview(r, f.target, acquisitionAck(r)));
 for (const artifact of [f.draft, r, clone(r), done, done.manifest]) {
  reject(() => f.api.consumeLiveTicketForContext(artifact, f.target, done.manifest, 'project_token_context'));
  reject(() => f.api.takeFirstContextExecutionAuthority(artifact));
  reject(() => f.api.authorizeFirstLiveContext(artifact, f.target, { manualLiveAuthorization: true }));
 }
 assert.equal(f.api.takeAcquisitionExecutionAuthority, undefined); assert.equal(f.api.consumeAcquisitionTicket, undefined); assert.equal(f.api.authorizeLiveAcquisition, undefined);
});
for (const mode of ['wrongBinding', 'extraArgs', 'changedOrder', 'liveTrue']) {
 test('acquisition approval burns on invalid input: ' + mode, () => {
  const f = acquisitionFixture(), r = f.api.reviewAcquisitionPackage(f.draft), ack = acquisitionAck(r), args = [r, f.target, ack];
  if (mode === 'wrongBinding') args[1] = binding();
  if (mode === 'extraArgs') args.push(true);
  if (mode === 'changedOrder') ack.manifest.orderedOperations.reverse();
  if (mode === 'liveTrue') ack.liveAuthorized = true;
  reject(() => f.api.approveAcquisitionPackageReview(...args));
  reject(() => f.api.approveAcquisitionPackageReview(r, f.target, acquisitionAck(r)));
 });
}
for (const mode of ['head', 'branch', ...Object.keys(normal.sourceHashes), 'self']) {
 test('acquisition source/code drift rejects and burns approval: ' + mode, () => {
  const f = acquisitionFixture(), r = f.api.reviewAcquisitionPackage(f.draft);
  if (mode === 'head') f.drift.reviewedHead = 'b'.repeat(40);
  else if (mode === 'branch') f.drift.reviewedBranch = 'other';
  else { const file = mode === 'self' ? f.file : path.join(path.dirname(f.file), mode);
   f.drift.files.set(file, fs.readFileSync(file, 'utf8') + '// drift'); }
  reject(() => f.api.approveAcquisitionPackageReview(r, f.target, acquisitionAck(r)));
  f.drift.files.clear(); f.drift.reviewedHead = 'a'.repeat(40); f.drift.reviewedBranch = 'feature/0092-shared-segment-suitability';
  reject(() => f.api.approveAcquisitionPackageReview(r, f.target, acquisitionAck(r)));
 });
}
test('pin count stays twelve, historical 0114A identity pin and later transport pins are distinct, templates share regenerated self hash', () => {
 const cp = require('node:child_process'), base = '99e3c23c1a2222c32ed9894b560c6df91ed5cb11';
 const original = cp.execFileSync('git', ['-c', 'safe.directory=' + path.resolve(__dirname, '../../..'), 'show', base + ':movement-app/docs/0110-live-review-template.json'], { encoding: 'utf8', env: {}, windowsHide: true });
 const pins = JSON.parse(original).manifest.codeIdentity.sourceHashes;
 assert.equal(Object.keys(normal.sourceHashes).length, 12); assert.deepEqual(Object.keys(normal.sourceHashes).sort(), [...Object.keys(pins), 'qualification-railway-acquisition-wrapper.cjs'].sort());
 for (const key of Object.keys(pins)) {
  if (['qualification-railway-target-identity.cjs', 'qualification-railway-https-adapter.cjs', 'qualification-railway-target-identity-provider-boundary.cjs'].includes(key)) assert.notEqual(normal.sourceHashes[key], pins[key]);
  else assert.equal(normal.sourceHashes[key], pins[key]);
 }
 const a = normal.reviewTemplate(), b = normal.acquisitionReviewTemplate();
 assert.equal(a.manifest.codeIdentity.authorizationBoundarySha256, b.manifest.codeIdentity.authorizationBoundarySha256);
 assert.notEqual(a.manifest.codeIdentity.authorizationBoundarySha256, JSON.parse(original).manifest.codeIdentity.authorizationBoundarySha256);
 assert.deepEqual(JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../docs/0110-live-review-template.json'), 'utf8')), a);
});

test('service acknowledgement rejects hidden, symbol and getter fields without reading getters, burning review', () => {
 for (const mode of ['hidden', 'symbol', 'getter', 'nestedGetter']) {
  const f = serviceFixture(), r = f.api.reviewObservedServiceCandidate(f.session), ack = serviceAck(r); let reads = 0;
  if (mode === 'hidden' || mode === 'symbol') Object.defineProperty(ack, mode === 'hidden' ? 'extra' : Symbol('extra'), { value: true });
  else { const obj = mode === 'nestedGetter' ? ack.candidate : ack, key = mode === 'nestedGetter' ? 'observedServiceId' : 'reviewed';
   Object.defineProperty(obj, key, { enumerable: true, get() { reads++; throw Error('MUST NOT READ'); } }); }
  reject(() => f.api.approveObservedServiceCandidate(r, f.session, ack)); assert.equal(reads, 0);
  reject(() => f.api.approveObservedServiceCandidate(r, f.session, serviceAck(r)));
 }
});
test('post-approval service state replacement cannot generate instance review', () => {
 for (const field of ['serviceFacts', 'serviceObservation', 'revision', 'serviceApproval']) {
  const f = serviceFixture(true), r = f.api.reviewObservedServiceCandidate(f.session);
  f.api.approveObservedServiceCandidate(r, f.session, serviceAck(r));
  const state = f.api.testRecord(f.session); state[field] = field === 'revision' ? state[field] + 1 : field === 'serviceApproval' ? null : { ...state[field] };
  reject(() => f.api.reviewNextIdentityRequest(f.session));
 }
});
test('service review requires original accepted observation and exact arity', () => {
 const f = identityFixture();
 reject(() => f.api.reviewObservedServiceCandidate(f.session));
 observe(f); reject(() => f.api.reviewObservedServiceCandidate(f.session, true));
 const r = f.api.reviewObservedServiceCandidate(f.session);
 f.api.approveObservedServiceCandidate(r, f.session, serviceAck(r));
 assert.equal(f.api.testRecord, undefined);
 assert.ok(!Object.hasOwn(identity, 'testRecord'));
});
test('acquisition creation and review recheck source drift and reject copied drafts', () => {
 const f = acquisitionFixture(), file = path.join(path.dirname(f.file), 'qualification-railway-target-identity.cjs');
 f.drift.files.set(file, fs.readFileSync(file, 'utf8') + '// drift');
 reject(() => f.api.createAcquisitionDraft(f.target, { inventoryReviewed: true, ...Object.fromEntries(['projectIds','environmentIds','serviceIds','serviceInstanceIds'].map(k => [k, { reviewed: true, ids: [] }])) },
  { reviewedHead: 'a'.repeat(40), reviewedBranch: 'feature/0092-shared-segment-suitability' }));
 reject(() => f.api.reviewAcquisitionPackage(f.draft));
 f.drift.files.clear(); reject(() => f.api.reviewAcquisitionPackage(clone(f.draft)));
 assert.equal(f.api.reviewAcquisitionPackage(f.draft).outcome, 'PRELIVE_NOT_AUTHORIZED');
});

test('genuine old context ticket cannot be stretched to services or instance permission', () => {
 for (const operation of ['Movement0111ProjectServices', 'Movement0111ServiceInstance', 'target_identity_acquisition']) {
  const f = acquisitionFixture();
  const inv = { inventoryReviewed: true, ...Object.fromEntries(['projectIds','environmentIds','serviceIds','serviceInstanceIds'].map(k => [k, { reviewed: true, ids: [] }])) };
  const draft = f.api.createDraft(f.target, inv, { reviewedHead: 'a'.repeat(40), reviewedBranch: 'feature/0092-shared-segment-suitability' });
  const r = f.api.reviewArtifact(draft), m = r.manifest;
  const reviewed = f.api.reviewPackage(draft, f.target, { reviewed: true, manifestSha256: r.manifestSha256,
   targetReview: clone(m.targetReview), inventoryReview: clone(m.forbiddenRailwayInventory),
   codeReview: { reviewed: true, ...clone(m.codeIdentity) }, contextReview: { reviewed: true, ...clone(r.contextReviewMetadata) },
   hostChecklist: { nodeMajor: 24, ...Object.fromEntries(r.hostAttestationKeys.filter(k => k !== 'nodeMajor').map(k => [k, true])) } });
  const ticket = f.api.authorizeFirstLiveContext(draft, f.target, { ...clone(reviewed.finalAcknowledgementTemplate), manualLiveAuthorization: true });
  reject(() => f.api.consumeLiveTicketForContext(ticket, f.target, m, operation));
  reject(() => f.api.consumeLiveTicketForContext(ticket, f.target, m, 'project_token_context'));
 }
});
