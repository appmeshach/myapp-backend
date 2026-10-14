'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const file = path.resolve(__dirname, '../../scripts/assessment-worker/qualification-railway-live-authorization.cjs');
const source = fs.readFileSync(file, 'utf8');
const normal = require(file);
const targets = require('../../scripts/assessment-worker/qualification-railway-introspection-target.cjs');
const reviews = require('../../scripts/assessment-worker/qualification-railway-context-review.cjs');
const categories = ['projectIds', 'environmentIds', 'serviceIds', 'serviceInstanceIds'];
const SYNTHETIC_HEAD = 'a'.repeat(40);
const reviewedCode = () => ({ reviewedHead: SYNTHETIC_HEAD, reviewedBranch: 'feature/0092-shared-segment-suitability' });
const clone = v => JSON.parse(JSON.stringify(v));
const scope = { environmentKind: 'disposable', lifecycle: 'active', projectId: 'synthetic-project', environmentId: 'synthetic-environment', serviceId: 'synthetic-service', serviceInstanceId: null };
const empty = () => ({ inventoryReviewed: true, ...Object.fromEntries(categories.map(k => [k, { reviewed: true, ids: [] }])) });
function binding(value = scope) {
 return targets.bindTarget(value, { ...value }, { inventoryReviewed: true, ...Object.fromEntries(categories.map(k => [k, []])) });
}
function isolated() {
 const drift = { head: SYNTHETIC_HEAD, branch: 'feature/0092-shared-segment-suitability', files: new Map(), calls: [] };
 const fakeFs = { existsSync: fs.existsSync, readFileSync: (name, encoding) => drift.files.has(name) ? drift.files.get(name) : fs.readFileSync(name, encoding) };
 const fakeCp = { execFileSync(command, args, options) {
  assert.equal(command, 'git'); assert.deepEqual(Object.keys(options.env), []);
  assert.equal(options.shell, false); assert.equal(options.windowsHide, true);
  assert.equal(args[0], '-c'); assert.ok(args[1].startsWith('safe.directory='));
  drift.calls.push(args.slice(2).join(' '));
  if (args.slice(2).join(' ') === 'rev-parse HEAD') return drift.head + '\n';
  if (args.slice(2).join(' ') === 'branch --show-current') return drift.branch + '\n';
  assert.fail('Unexpected subprocess');
 } };
 const sandbox = { module: { exports: {} }, Buffer, __dirname: path.dirname(file), __filename: file,
  require(name) {
   if (name === 'node:fs') return fakeFs;
   if (name === 'node:child_process') return fakeCp;
   if (name.startsWith('./')) return require(path.resolve(path.dirname(file), name));
   assert.ok(['node:path', 'node:crypto'].includes(name)); return require(name);
  } };
 require('./fixtures/0114d-authorization-loader.cjs').loadAuthorizationSandbox(source, sandbox, file);
 return { api: sandbox.module.exports, drift };
}
function fixture() {
 const { api, drift } = isolated(), target = binding(), draft = api.createDraft(target, empty(), reviewedCode());
 const artifact = api.reviewArtifact(draft), m = artifact.manifest;
 const ack = { reviewed: true, manifestSha256: artifact.manifestSha256, targetReview: clone(m.targetReview),
  inventoryReview: clone(m.forbiddenRailwayInventory), codeReview: { reviewed: true, ...clone(m.codeIdentity) },
  contextReview: { reviewed: true, ...clone(artifact.contextReviewMetadata) },
  hostChecklist: { nodeMajor: 24, ...Object.fromEntries(artifact.hostAttestationKeys.filter(k => k !== 'nodeMajor').map(k => [k, true])) } };
 return { api, drift, target, draft, artifact, ack };
}
function authorized() {
 const f = fixture(), reviewed = f.api.reviewPackage(f.draft, f.target, f.ack);
 const finalAck = { ...reviewed.finalAcknowledgementTemplate, manualLiveAuthorization: true };
 return { ...f, finalAck, ticket: f.api.authorizeFirstLiveContext(f.draft, f.target, finalAck) };
}
const reject = fn => assert.throws(fn, /preflight unavailable|target preflight unavailable/);
test.beforeEach(t => {
 let attempts = 0;
 t.mock.method(require('node:https'), 'request', () => { attempts++; throw Error('REAL NETWORK FORBIDDEN'); });
 t.mock.method(global, 'fetch', () => { attempts++; throw Error('REAL NETWORK FORBIDDEN'); });
 t.after(() => assert.equal(attempts, 0));
});
test('normal module verifies explicit local review metadata; template keeps live HEAD unresolved', () => {
 // Local test metadata only: do not manufacture a reviewed actual-target draft
 // or ticket. This check must also work after the correction is committed.
 const repository = path.resolve(path.dirname(file), '../../..');
 const current = require('node:child_process').execFileSync('git', ['-c', 'safe.directory=' + repository, 'rev-parse', 'HEAD'],
  { cwd: path.resolve(path.dirname(file), '../..'), encoding: 'utf8', env: {}, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
 assert.match(current, /^[a-f0-9]{40}$/);
 assert.equal(normal.verifyCodeIdentity({ reviewedHead: current, reviewedBranch: reviewedCode().reviewedBranch }).reviewedHead, current);
 const t = normal.reviewTemplate(); assert.equal(t.notice, 'LIVE REQUEST NOT AUTHORIZED');
 assert.equal(t.outcome, 'PRELIVE_NOT_AUTHORIZED'); assert.equal(t.manualLiveAuthorization, false);
 assert.equal(t.actualRailwayIdsUnresolved, true);
 assert.equal(t.manifest.baselineParentHead, '7c2346ce73d12e571b5ff8506fd8d02be48f44b7');
 assert.equal(t.manifest.reviewedHead, null); assert.equal(t.manifest.reviewedBranch, null);
 assert.equal(t.manifest.codeIdentity.reviewedHead, null); assert.ok(!Object.hasOwn(t.manifest, 'currentHead'));
 assert.ok(!Object.hasOwn(normal, 'expectedHead'));
 for (const id of Object.values(t.target)) assert.equal(id, null);
 for (const k of categories) { assert.equal(t.forbiddenRailwayInventory[k].reviewed, false); assert.equal(t.forbiddenRailwayInventory[k].ids, null); }
 const disk = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../docs/0110-live-review-template.json'), 'utf8'));
 assert.deepEqual(disk, t);
});
test('immutable manifest fixes operation, endpoint, query, transport limits, source identities and authority', () => {
 const { artifact } = fixture(), m = artifact.manifest;
 assert.equal(m.version, 'movement_railway_live_auth_v1');
 assert.equal(m.operationKind, 'project_token_context'); assert.equal(m.operationName, 'Movement0108ProjectTokenContext');
 assert.equal(m.querySha256, 'd3190e45cbf0ec1242ef090a9a5a437c4043a5e7542b075921744349b8039e28');
 assert.equal(m.endpoint, 'https://backboard.railway.com/graphql/v2'); assert.equal(m.method, 'POST');
 assert.equal(m.authKind, 'project_token'); assert.equal(m.authHeaderName, 'Project-Access-Token');
 assert.equal(m.authSourceName, 'RAILWAY_TOKEN'); assert.equal(m.forbiddenAuthSourceName, 'RAILWAY_API_TOKEN');
 assert.equal(m.redirectPolicy, 'reject'); assert.equal(m.retries, 0); assert.equal(m.timeoutMs, 10000);
 assert.equal(m.maxBodyBytes, 1048576); assert.equal(m.maxHeaderBytes, 16384); assert.equal(m.acceptedStatus, 200);
 assert.equal(m.reviewedHead, SYNTHETIC_HEAD); assert.equal(m.baselineParentHead, normal.baselineParentHead);
 assert.equal(Object.keys(m.codeIdentity.sourceHashes).length, 12);
 assert.match(m.codeIdentity.authorizationBoundarySha256, /^[a-f0-9]{64}$/);
 assert.ok(Object.isFrozen(m)); assert.ok(Object.isFrozen(m.targetReview.requiredForFirstContext));
 assert.throws(() => { m.retries = 1; }, TypeError);
 assert.equal(m.manualLiveAuthorizationRequired, true);
 assert.ok(!Object.hasOwn(m, 'headers')); assert.ok(!Object.hasOwn(m, 'response'));
});
test('post-commit current HEAD may differ from implementation parent when explicitly reviewed', () => {
 const f = authorized();
 assert.notEqual(SYNTHETIC_HEAD, normal.baselineParentHead);
 assert.equal(f.artifact.manifest.reviewedHead, SYNTHETIC_HEAD);
 assert.equal(f.ack.codeReview.reviewedHead, SYNTHETIC_HEAD);
 assert.equal(f.finalAck.reviewedHead, SYNTHETIC_HEAD);
 assert.equal(f.finalAck.reviewedBranch, reviewedCode().reviewedBranch);
 const authority = f.api.consumeLiveTicketForContext(f.ticket, f.target, f.artifact.manifest, 'project_token_context');
 assert.equal(f.api.takeContextExecutionAuthority(authority, f.target).operationKind, 'project_token_context');
});
test('reviewed code metadata is mandatory, exact, lowercase SHA and exact branch', () => {
 const { api } = isolated(), target = binding();
 reject(() => api.verifyCodeIdentity()); reject(() => api.createDraft(target, empty()));
 for (const head of [null, '', 'a'.repeat(39), 'a'.repeat(41), 'A'.repeat(40), 'g'.repeat(40), 123, 'a'.repeat(40) + '\n']) {
  reject(() => api.createDraft(target, empty(), { ...reviewedCode(), reviewedHead: head }));
 }
 for (const input of [{ ...reviewedCode(), reviewedBranch: 'other' }, { reviewedHead: SYNTHETIC_HEAD },
  { ...reviewedCode(), credential: 'synthetic' }, null, () => assert.fail('env reader')]) {
  reject(() => api.createDraft(target, empty(), input));
 }
});
test('observed HEAD and branch must equal explicit review metadata at draft creation', () => {
 const { api, drift } = isolated(), target = binding();
 reject(() => api.createDraft(target, empty(), { ...reviewedCode(), reviewedHead: normal.baselineParentHead }));
 drift.head = 'b'.repeat(40); reject(() => api.createDraft(target, empty(), reviewedCode()));
 drift.head = SYNTHETIC_HEAD; drift.branch = 'other'; reject(() => api.createDraft(target, empty(), reviewedCode()));
});
test('supplied review metadata is copied immutably and cannot be changed after draft creation', () => {
 const { api } = isolated(), target = binding(), input = reviewedCode(), draft = api.createDraft(target, empty(), input);
 input.reviewedHead = 'b'.repeat(40); input.reviewedBranch = 'other';
 assert.equal(api.reviewArtifact(draft).manifest.reviewedHead, SYNTHETIC_HEAD);
 assert.equal(api.reviewArtifact(draft).manifest.codeIdentity.reviewedBranch, reviewedCode().reviewedBranch);
});
test('human code review must acknowledge the exact supplied HEAD and branch', () => {
 for (const key of ['reviewedHead', 'reviewedBranch']) {
  const f = fixture(); f.ack.codeReview[key] = key === 'reviewedHead' ? normal.baselineParentHead : 'other';
  reject(() => f.api.reviewPackage(f.draft, f.target, f.ack));
 }
});
for (const transition of ['review', 'issuance']) {
 test('HEAD and branch drift rejected before ' + transition, () => {
  for (const key of ['head', 'branch']) {
   const f = fixture(); let ack;
   if (transition === 'issuance') ack = { ...f.api.reviewPackage(f.draft, f.target, f.ack).finalAcknowledgementTemplate, manualLiveAuthorization: true };
   f.drift[key] = key === 'head' ? 'b'.repeat(40) : 'other';
   reject(() => transition === 'review' ? f.api.reviewPackage(f.draft, f.target, f.ack) : f.api.authorizeFirstLiveContext(f.draft, f.target, ack));
  }
 });
}
test('branch drift before extraction burns authority and restoration cannot revive it', () => {
 const f = authorized(), authority = f.api.consumeLiveTicketForContext(f.ticket, f.target, f.artifact.manifest, 'project_token_context');
 f.drift.branch = 'other'; reject(() => f.api.takeContextExecutionAuthority(authority, f.target));
 f.drift.branch = reviewedCode().reviewedBranch; reject(() => f.api.takeContextExecutionAuthority(authority, f.target));
});
test('target facts preserve required project/environment separately from nullable instance and service constraints', () => {
 const m = fixture().artifact.manifest;
 assert.deepEqual(clone(m.targetReview.requiredForFirstContext), { projectId: scope.projectId, environmentId: scope.environmentId });
 assert.deepEqual(clone(m.targetReview.qualificationConstraints), { serviceId: scope.serviceId, serviceInstanceId: null });
 assert.equal(m.targetReview.independentlyAuthoritative, false);
});
test('only original private target accepted; unresolved IDs and required fields fail', () => {
 const { api, target } = fixture();
 reject(() => api.createDraft(clone(target), empty(), reviewedCode()));
 reject(() => api.createDraft({ ...scope }, empty(), reviewedCode()));
 for (const k of ['projectId', 'environmentId', 'serviceId']) {
  reject(() => binding({ ...scope, [k]: null }));
  const missing = { ...scope }; delete missing[k]; reject(() => binding(missing));
 }
 reject(() => api.createDraft(api.reviewTemplate().target, empty(), reviewedCode()));
});
for (const category of categories) {
 test('inventory category ' + category + ' requires explicit review and rejects missing/duplicate/malformed entries', () => {
  const { api, target } = fixture();
  for (const edit of [v => { delete v[category]; }, v => { v[category].reviewed = false; },
   v => { v[category].ids = null; }, v => { v[category].ids = ['duplicate', 'duplicate']; },
   v => { v[category].ids = ['bad/identifier']; }, v => { v[category].ids = ['sb_secret_synthetic']; }]) {
   const v = empty(); edit(v); reject(() => api.createDraft(target, v, reviewedCode()));
  }
 });
 test('inventory collision rejected in own category ' + category, () => {
  const { api } = isolated(), value = { ...scope, serviceInstanceId: 'synthetic-instance' }, target = binding(value), v = empty();
  v[category].ids = [value[category.slice(0, -1)]]; reject(() => api.createDraft(target, v, reviewedCode()));
 });
}
test('explicitly reviewed empty inventory accepted; unknown inventory rejected', () => {
 const { api, target } = fixture(); assert.ok(api.createDraft(target, empty(), reviewedCode()));
 const v = empty(); v.inventoryReviewed = false; reject(() => api.createDraft(target, v, reviewedCode()));
});
test('category namespaces and case are preserved; Supabase refs are separate informational prohibitions', () => {
 const { api, target } = fixture(), v = empty();
 v.projectIds.ids = [scope.environmentId, scope.projectId.toUpperCase()];
 v.environmentIds.ids = [scope.projectId];
 const m = api.reviewArtifact(api.createDraft(target, v, reviewedCode())).manifest;
 assert.deepEqual(clone(m.forbiddenRailwayInventory.projectIds.ids), v.projectIds.ids);
 assert.equal(m.crossSystemForbidden.provider, 'Supabase'); assert.equal(m.crossSystemForbidden.identifierKind, 'project_ref');
 assert.equal(m.crossSystemForbidden.production, 'xdfmoggrsucisfybqctb');
 assert.equal(m.crossSystemForbidden.inactive, 'udlsysezmzutydnifhsq');
 assert.equal(m.crossSystemForbidden.consumedHistoricalDisposable, 'uzkhnslyrhgucijcuoes');
 assert.equal(m.crossSystemForbidden.railwayNamespace, false); assert.equal(m.crossSystemForbidden.newQualificationAuthorized, false);
});
for (const key of fixture().artifact.hostAttestationKeys) {
 test('host requires exact affirmative acknowledgement: ' + key, () => {
  for (const mode of ['missing', 'false']) {
   const f = fixture(); if (mode === 'missing') delete f.ack.hostChecklist[key]; else f.ack.hostChecklist[key] = key === 'nodeMajor' ? 23 : false;
   reject(() => f.api.reviewPackage(f.draft, f.target, f.ack));
  }
 });
}
test('no credential field, env reader, token value or extra review key accepted', () => {
 for (const extra of ['credential', 'token', 'envReader', 'headers']) {
  const f = fixture(); let reads = 0;
  Object.defineProperty(f.ack.hostChecklist, extra, { enumerable: true, get() { reads++; throw Error('must not read'); } });
  reject(() => f.api.reviewPackage(f.draft, f.target, f.ack)); assert.equal(reads, 0);
 }
 const f = fixture(); f.ack.token = 'synthetic-only'; reject(() => f.api.reviewPackage(f.draft, f.target, f.ack));
 reject(() => f.api.createDraft(f.target, empty(), () => assert.fail('env reader')));
});
test('hidden/symbol credential fields and getters cannot enter exact review records', () => {
 for (const location of ['hostChecklist', 'targetReview', 'codeReview', 'inventoryReview', 'contextReview']) {
  for (const kind of ['hidden', 'symbol', 'getter']) {
   const f = fixture(), record = f.ack[location]; let reads = 0;
   if (kind === 'getter') {
    const key = Object.keys(record)[0];
    Object.defineProperty(record, key, { enumerable: true, get() { reads++; throw Error('must not read'); } });
   } else Object.defineProperty(record, kind === 'symbol' ? Symbol('credential') : 'credential', { value: 'synthetic', enumerable: kind === 'symbol' });
   reject(() => f.api.reviewPackage(f.draft, f.target, f.ack)); assert.equal(reads, 0);
  }
 }
});
for (const key of ['targetReview', 'inventoryReview', 'codeReview', 'contextReview', 'manifestSha256']) {
 test('review rejects changed exact metadata: ' + key, () => {
  const f = fixture(); if (key === 'manifestSha256') f.ack[key] = '0'.repeat(64); else f.ack[key].extra = true;
  reject(() => f.api.reviewPackage(f.draft, f.target, f.ack));
 });
}
test('reviewed alone is not final authorization; original target and exact final acknowledgement required', () => {
 const f = fixture(); reject(() => f.api.authorizeFirstLiveContext(f.draft, f.target, { reviewed: true }));
 reject(() => f.api.reviewPackage(f.draft, binding(), f.ack));
 const r = f.api.reviewPackage(f.draft, f.target, f.ack);
 assert.equal(r.localReviewComplete, true); assert.equal(r.outcome, 'PRELIVE_NOT_AUTHORIZED');
 reject(() => f.api.authorizeFirstLiveContext(f.draft, f.target, r.finalAcknowledgementTemplate));
 reject(() => f.api.authorizeFirstLiveContext(f.draft, binding(), { ...r.finalAcknowledgementTemplate, manualLiveAuthorization: true }));
 reject(() => f.api.authorizeFirstLiveContext(f.draft, f.target, { ...r.finalAcknowledgementTemplate, manualLiveAuthorization: true, reviewed: true }));
 for (const key of Object.keys(r.finalAcknowledgementTemplate).filter(k => k !== 'manualLiveAuthorization')) {
  reject(() => f.api.authorizeFirstLiveContext(f.draft, f.target, { ...r.finalAcknowledgementTemplate, manualLiveAuthorization: true, [key]: 'changed' }));
 }
});
test('ticket is opaque, cannot be forged/serialized/transferred to normal namespace, and issued once', () => {
 const f = authorized(); assert.equal(JSON.stringify(f.ticket), '{}'); assert.ok(Object.isFrozen(f.ticket));
 reject(() => f.api.authorizeFirstLiveContext(f.draft, f.target, f.finalAck));
 for (const ticket of [{}, clone(f.ticket)]) reject(() => f.api.consumeLiveTicketForContext(ticket, f.target, f.artifact.manifest, 'project_token_context'));
 reject(() => normal.consumeLiveTicketForContext(f.ticket, f.target, f.artifact.manifest, 'project_token_context'));
 assert.ok(f.api.consumeLiveTicketForContext(f.ticket, f.target, f.artifact.manifest, 'project_token_context'));
});
for (const mistake of ['differentTarget', 'copiedManifest', 'schemaOperation', 'callerSchemaHandoff', 'extraHandoff']) {
 test('invalid handoff burns original ticket: ' + mistake, () => {
  const f = authorized(), args = [f.ticket, f.target, f.artifact.manifest, 'project_token_context'];
  if (mistake === 'differentTarget') args[1] = binding();
  if (mistake === 'copiedManifest') args[2] = clone(f.artifact.manifest);
  if (mistake === 'schemaOperation') args[3] = 'schema';
  if (mistake === 'callerSchemaHandoff') args[3] = Object.freeze({ kind: 'schema' });
  if (mistake === 'extraHandoff') args.push(Object.freeze({ kind: 'schema' }));
  reject(() => f.api.consumeLiveTicketForContext(...args));
  reject(() => f.api.consumeLiveTicketForContext(f.ticket, f.target, f.artifact.manifest, 'project_token_context'));
 });
}
for (const driftKind of ['head', 'branch', 'adapterSource', 'ownSource']) {
 test('code/version drift burns ticket: ' + driftKind, () => {
  const f = authorized();
  if (driftKind === 'head') f.drift.head = '0'.repeat(40);
  if (driftKind === 'branch') f.drift.branch = 'different-branch';
  if (driftKind === 'adapterSource') {
   const adapterFile = path.join(path.dirname(file), 'qualification-railway-https-adapter.cjs');
   f.drift.files.set(adapterFile, fs.readFileSync(adapterFile, 'utf8') + '// changed\n');
  }
  if (driftKind === 'ownSource') f.drift.files.set(file, source + '// changed\n');
  reject(() => f.api.consumeLiveTicketForContext(f.ticket, f.target, f.artifact.manifest, 'project_token_context'));
  f.drift.head = SYNTHETIC_HEAD; f.drift.branch = 'feature/0092-shared-segment-suitability'; f.drift.files.clear();
  reject(() => f.api.consumeLiveTicketForContext(f.ticket, f.target, f.artifact.manifest, 'project_token_context'));
 });
}
test('source canonicalization permits CRLF/LF only; altered EOF fails', () => {
 const { api, drift } = isolated(), adapterFile = path.join(path.dirname(file), 'qualification-railway-https-adapter.cjs');
 const text = fs.readFileSync(adapterFile, 'utf8'); drift.files.set(adapterFile, text.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'));
 assert.ok(api.verifyCodeIdentity(reviewedCode())); drift.files.set(adapterFile, text.trimEnd()); reject(() => api.verifyCodeIdentity(reviewedCode()));
});
test('ticket consumed before opaque execution authority; original owned context handoff available once without execution', () => {
 const f = authorized(), authority = f.api.consumeLiveTicketForContext(f.ticket, f.target, f.artifact.manifest, 'project_token_context');
 reject(() => f.api.consumeLiveTicketForContext(f.ticket, f.target, f.artifact.manifest, 'project_token_context'));
 reject(() => f.api.takeContextExecutionAuthority(clone(authority), f.target));
 const result = f.api.takeContextExecutionAuthority(authority, f.target);
 reject(() => f.api.takeContextExecutionAuthority(authority, f.target));
 assert.equal(result.privateTarget, f.target); assert.equal(result.operationKind, 'project_token_context');
 const original = reviews.takeAdapterHandoff(result.contextHandoff, f.target);
 assert.equal(original.kind, 'context'); assert.equal(original.binding, f.target);
 assert.equal(original.request.operationName, 'Movement0108ProjectTokenContext');
 assert.throws(() => reviews.takeAdapterHandoff(result.contextHandoff, f.target));
});
test('wrong execution-authority target burns; version rechecked before exposing handoff', () => {
 for (const mode of ['target', 'version']) {
  const f = authorized(), authority = f.api.consumeLiveTicketForContext(f.ticket, f.target, f.artifact.manifest, 'project_token_context');
  if (mode === 'version') f.drift.head = '0'.repeat(40);
  reject(() => f.api.takeContextExecutionAuthority(authority, mode === 'target' ? binding() : f.target));
  f.drift.head = SYNTHETIC_HEAD; reject(() => f.api.takeContextExecutionAuthority(authority, f.target));
 }
});
test('genuine local schema handoff cannot substitute for the privately owned context handoff', () => {
 const f = authorized();
 const plan = require('../../scripts/assessment-worker/qualification-railway-introspection-plan.cjs');
 const preflight = require('../../scripts/assessment-worker/qualification-railway-introspection-preflight.cjs');
 const review = preflight.reviewNext(plan.start(), f.target);
 const permit = preflight.approveReview(review, { ...review.meta, reviewed: true });
 const schema = preflight.consumeSchemaPermitForAdapter(permit, f.target);
 reject(() => f.api.consumeLiveTicketForContext(f.ticket, f.target, f.artifact.manifest, schema));
 reject(() => f.api.consumeLiveTicketForContext(f.ticket, f.target, f.artifact.manifest, 'project_token_context'));
 assert.equal(preflight.takeSchemaHandoffForAdapter(schema, f.target).kind, 'schema');
});
test('all source identities fail closed before review and final authorization', () => {
 for (const name of Object.keys(normal.sourceHashes)) {
  const f = fixture(), sourceFile = path.join(path.dirname(file), name);
  f.drift.files.set(sourceFile, fs.readFileSync(sourceFile, 'utf8') + '// change\n');
  reject(() => f.api.reviewPackage(f.draft, f.target, f.ack));
 }
 const f = fixture(), r = f.api.reviewPackage(f.draft, f.target, f.ack); f.drift.head = '0'.repeat(40);
 reject(() => f.api.authorizeFirstLiveContext(f.draft, f.target, { ...r.finalAcknowledgementTemplate, manualLiveAuthorization: true }));
});
test('global status unchanged by isolated synthetic ticket lifecycle; no real credential/network/CLI code path', () => {
 const f = authorized(); f.api.consumeLiveTicketForContext(f.ticket, f.target, f.artifact.manifest, 'project_token_context');
 for (const api of [normal, f.api]) {
  assert.equal(api.state.outcome, 'PRELIVE_NOT_AUTHORIZED');
  for (const key of ['providerContextObserved', 'projectEnvironmentContextProven', 'serviceContextProven', 'executionSchemaReady']) assert.equal(api.state[key], false);
  for (const key of ['identity_proven', 'causality_proven', 'restart_origin_proven', 'platformRestart']) assert.equal(api.state[key], null);
  assert.equal(api.state.restartAttribution.measurement, null); assert.equal(api.state.restartAttribution.limitation, 'restart_origin_unattributable');
 }
 assert.doesNotMatch(source, /process\.env|fetch\s*\(|https\.request\s*\(|adapter\.openExecutionContext\s*\(|adapter\.executeHandoff\s*\(/);
 assert.deepEqual([...new Set(f.drift.calls)].sort(), ['branch --show-current', 'rev-parse HEAD']);
});
