'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { loadWrapper } = require('./fixtures/0113-first-context-wrapper.cjs');
const base = path.resolve(__dirname, '../../scripts/assessment-worker');
const normal = require(path.join(base, 'qualification-railway-first-context-wrapper.cjs'));
const normalAuth = require(path.join(base, 'qualification-railway-live-authorization.cjs'));
const normalAdapter = require(path.join(base, 'qualification-railway-https-adapter.cjs'));
const normalIdentity = require(path.join(base, 'qualification-railway-target-identity.cjs'));
const clone = v => JSON.parse(JSON.stringify(v));
const completion = { outcome: 'TARGET_IDENTITY_UNRESOLVED', stage: 'project_services', contextObservationAccepted: true,
 serviceObserved: false, targetIdentityObserved: false, manualLiveAuthorizationConsumed: true };
const reject = promise => assert.rejects(promise, error => error.message === 'Railway first-context wrapper unavailable' && !Object.hasOwn(error, 'cause'));
function globalState(state) {
 for (const k of ['providerContextObserved', 'projectEnvironmentContextProven', 'serviceContextProven', 'executionSchemaReady']) assert.equal(state[k], false);
 for (const k of ['identity_proven', 'causality_proven', 'restart_origin_proven', 'platformRestart']) assert.equal(state[k], null);
}
test.beforeEach(t => {
 let attempts = 0;
 for (const [owner, method] of [[require('node:https'), 'request'], [global, 'fetch'], [require('node:child_process'), 'execFileSync'],
  [require('node:child_process'), 'spawn'], [require('node:child_process'), 'exec']]) {
  t.mock.method(owner, method, () => { attempts++; throw Error('NORMAL SIDE EFFECT FORBIDDEN'); });
 }
 t.after(() => assert.equal(attempts, 0));
});
test('genuine ticket authority uses exact P B R T chain, closes before descriptive completion', async () => {
 const f = loadWrapper(), a = f.authorized(); assert.equal(f.reads.length, 0); assert.equal(f.calls.length, 0);
 const result = await f.wrapper.runFirstContext(a.authority);
 assert.deepEqual(clone(result), completion); assert.ok(Object.isFrozen(result));
 assert.deepEqual(Object.keys(result).sort(), Object.keys(completion).sort());
 assert.deepEqual(f.trace, ['authority', 'authorityConsumed', 'open', 'tokenRead', 'session', 'permit', 'bind', 'execute', 'https', 'transfer', 'accept', 'inspect', 'candidate', 'close']);
 assert.deepEqual(f.reads, ['RAILWAY_TOKEN']); assert.equal(f.calls.length, 1);
 assert.equal(f.calls[0].request.operationName, 'Movement0108ProjectTokenContext'); assert.deepEqual(f.calls[0].request.variables, {});
 const context = f.contextRecord(), session = f.sessionRecord();
 assert.equal(context.closed, true); assert.equal(context.secret, null); assert.equal(context.attested, false);
 assert.equal(session.stage, 'project_services'); assert.equal(session.candidate, null); assert.equal(session.serviceFacts, null); assert.equal(session.instanceFacts, null);
 assert.equal(session.executionContext, f.handles.open); assert.equal(context.binding, a.target); assert.equal(session.binding, a.target);
 const permitEntry = f.records.find(e => e.key === f.handles.permit).value;
 const bindingEntry = f.records.find(e => e.key === f.handles.bind).value;
 const resultEntry = f.records.find(e => e.value.kind === 'context' && e.value.invocation);
 const receiptEntry = f.records.find(e => e.key === f.handles.transfer).value;
 for (const entry of [permitEntry, bindingEntry, receiptEntry]) {
  assert.equal(entry.session, f.handles.session); assert.equal(entry.executionContext, f.handles.open); assert.equal(entry.binding, a.target);
  assert.equal(entry.handoff, f.authorityRecord(a.authority).record.handoff);
 }
 assert.equal(resultEntry.value.transferBinding, f.handles.bind); assert.equal(receiptEntry.body, resultEntry.value.body);
 assert.throws(() => f.adapter.consumeContextResult(resultEntry.key));
 assert.throws(() => f.identity.contextTransfer.takePermit(f.handles.permit, f.handles.open, permitEntry.handoff));
 assert.equal(f.timers.size, 0); assert.equal(context.transfers.size, 0); assert.equal(context.transferBindings.size, 0);
 for (const api of [f.auth, f.identity, normalAuth, normalIdentity]) globalState(api.state);
 globalState(normalAdapter.status); assert.equal(normalIdentity.state.targetIdentityObserved, false);
 assert.equal(f.identity.state.providerResultIngressConnected, false);
 await reject(f.wrapper.runFirstContext(a.authority)); await reject(f.wrapper.runFirstContext(result));
});
test('wrapper exports only runFirstContext and has no transport, environment, subprocess or retained resource store', () => {
 assert.deepEqual(Object.keys(normal), ['runFirstContext']); assert.ok(Object.isFrozen(normal));
 const src = fs.readFileSync(path.join(base, 'qualification-railway-first-context-wrapper.cjs'), 'utf8');
 assert.doesNotMatch(src, /process\.env|https\.request|fetch\s*\(|child_process|new (?:WeakMap|Map)|reviewNextIdentityRequest|consumeSchemaResult/);
 assert.equal((src.match(/\bawait\b/g) || []).length, 1);
 assert.deepEqual([...src.matchAll(/require\('([^']+)'\)/g)].map(m => m[1]), ['./qualification-railway-live-authorization.cjs', './qualification-railway-https-adapter.cjs', './qualification-railway-target-identity.cjs']);
});
for (const kind of ['copy', 'serialized', 'forged', 'ticket', 'rawBody', 'hashes', 'target', 'handoff', 'session', 'completion']) test('cannot execute caller input: ' + kind, async () => {
 const f = loadWrapper(), a = f.authorized(); let value;
 if (kind === 'copy') value = { ...a.authority }; if (kind === 'serialized') value = clone(a.authority);
 if (kind === 'forged') value = {}; if (kind === 'ticket') value = a.ticket;
 if (kind === 'rawBody') value = { data: { projectToken: { projectId: 'synthetic-project', environmentId: 'synthetic-env' } } };
 if (kind === 'hashes') value = { projectIdSha256: 'a'.repeat(64) }; if (kind === 'target') value = clone(a.target);
 if (kind === 'handoff') value = clone(f.authorityRecord(a.authority).record.handoff);
 if (kind === 'session') value = clone(f.identity.startTargetIdentitySession(a.target)); if (kind === 'completion') value = completion;
 await reject(f.wrapper.runFirstContext(value)); assert.equal(f.reads.length, 0); assert.equal(f.calls.length, 0); assert.equal(f.counts.open, undefined);
 await f.wrapper.runFirstContext(a.authority); // Fake input never consumes a genuine authority.
});
test('missing argument fails without open or credential access', async () => {
 const f = loadWrapper(); await reject(f.wrapper.runFirstContext()); assert.equal(f.reads.length, 0); assert.equal(f.calls.length, 0);
});
for (const extra of ['target', 'session', 'handoff', 'headers', 'token', 'envReader', 'endpoint', 'request', 'transport']) test('genuine authority with extra ' + extra + ' is burned before open', async () => {
 const f = loadWrapper(), a = f.authorized();
 const value = extra === 'envReader' || extra === 'transport' ? () => assert.fail('callback') : { [extra]: 'synthetic' };
 await reject(f.wrapper.runFirstContext(a.authority, value)); await reject(f.wrapper.runFirstContext(a.authority));
 assert.equal(f.reads.length, 0); assert.equal(f.calls.length, 0); assert.equal(f.counts.open, undefined);
});
test('same-pool consumers exclude each other, including direct wrong-arity burn', async () => {
 for (const direction of ['oldFirst', 'newFirst', 'extra']) {
  const f = loadWrapper(), a = f.authorized();
  if (direction === 'oldFirst') { f.auth.takeContextExecutionAuthority(a.authority, a.target); assert.throws(() => f.auth.takeFirstContextExecutionAuthority(a.authority)); }
  if (direction === 'newFirst') { const taken = f.auth.takeFirstContextExecutionAuthority(a.authority); assert.equal(taken.privateTarget, a.target); assert.throws(() => f.auth.takeContextExecutionAuthority(a.authority, a.target)); }
  if (direction === 'extra') { assert.throws(() => f.auth.takeFirstContextExecutionAuthority(a.authority, a.target)); assert.throws(() => f.auth.takeFirstContextExecutionAuthority(a.authority)); }
  await reject(f.wrapper.runFirstContext(a.authority)); assert.equal(f.reads.length, 0);
 }
});
test('namespace isolation in VM-A, VM-B and normal modules; no normal valid execution', async () => {
 const a = loadWrapper(), b = loadWrapper(), reviewed = a.authorized();
 await reject(b.wrapper.runFirstContext(reviewed.authority)); await reject(normal.runFirstContext(reviewed.authority));
 assert.throws(() => normalAuth.takeFirstContextExecutionAuthority(reviewed.authority));
 await reject(a.wrapper.runFirstContext(Object.freeze({}))); // A normal-created lookalike has no private ownership.
 assert.equal(a.reads.length, 0); assert.equal(b.reads.length, 0); await a.wrapper.runFirstContext(reviewed.authority);
});
for (const stage of ['authority', 'open', 'session', 'permit', 'bind', 'execute', 'transfer', 'accept', 'inspect', 'close']) test('failure at ' + stage + ' closes once if open, never retries or revives authority', async () => {
 const f = loadWrapper({ fail: stage }), a = f.authorized(); await reject(f.wrapper.runFirstContext(a.authority));
 const opened = !['authority', 'open'].includes(stage);
 assert.equal(f.counts.close ?? 0, opened ? 1 : 0); assert.ok(f.calls.length <= 1); assert.ok((f.counts.open ?? 0) <= 1);
 if (opened) assert.equal(f.contextRecord().closed, true);
 const before = f.calls.length, openCount = f.counts.open; await reject(f.wrapper.runFirstContext(a.authority));
 assert.equal(f.calls.length, before); assert.equal(f.counts.open, openCount);
});
test('wrong operation fails after burn but before token/open', async () => {
 const f = loadWrapper({ wrongOperation: true }), a = f.authorized(); await reject(f.wrapper.runFirstContext(a.authority));
 assert.equal(f.reads.length, 0); assert.equal(f.calls.length, 0); await reject(f.wrapper.runFirstContext(a.authority));
});
for (const problem of ['https', 'mismatch', 'malformed']) test('real isolated adapter ' + problem + ' invalidates then public close remains safe', async () => {
 const options = problem === 'https' ? { httpsFailure: true } : { body: problem === 'malformed' ? { data: null } : { data: { projectToken: { projectId: 'other', environmentId: 'synthetic-env' } } } };
 const f = loadWrapper(options), a = f.authorized(); await reject(f.wrapper.runFirstContext(a.authority));
 assert.equal(f.calls.length, 1); assert.equal(f.counts.close, 1); assert.equal(f.contextRecord().closed, true); assert.equal(f.contextRecord().secret, null);
 await reject(f.wrapper.runFirstContext(a.authority)); assert.equal(f.calls.length, 1);
});
const finalProblems = {
 stage: s => { s.stage = 'candidate'; }, outcome: s => { s.outcome = 'TARGET_IDENTITY_CANDIDATE'; },
 project: s => { s.ids.projectId.providerObservedValue = null; }, environment: s => { s.ids.environmentId.providerObservedValue = null; },
 service: s => { s.ids.serviceId.providerObservedValue = 'unexpected'; }, instance: s => { s.ids.serviceInstanceId.providerObservedValue = 'unexpected'; },
 provider: s => { s.providerObserved = true; }
};
for (const [name, editStatus] of Object.entries(finalProblems)) test('independent inspection rejects unexpected ' + name, async () => {
 const f = loadWrapper({ editStatus }), a = f.authorized(); await reject(f.wrapper.runFirstContext(a.authority));
 assert.equal(f.counts.accept, 1); assert.equal(f.counts.inspect, 1); assert.equal(f.counts.close, 1); assert.equal(f.contextRecord().closed, true);
 await reject(f.wrapper.runFirstContext(a.authority));
});
for (const key of ['providerContextObserved', 'projectEnvironmentContextProven', 'serviceContextProven', 'executionSchemaReady', 'identity_proven', 'causality_proven', 'restart_origin_proven', 'platformRestart']) test('unexpected global authority rejected: ' + key, async () => {
 const f = loadWrapper({ editStatus: s => { s.globalAuthority[key] = true; } }), a = f.authorized(); await reject(f.wrapper.runFirstContext(a.authority));
 assert.equal(f.counts.close, 1); assert.equal(f.contextRecord().closed, true);
});
test('candidate unexpectedly reviewable fails and closes', async () => {
 const f = loadWrapper({ candidate: true }), a = f.authorized(); await reject(f.wrapper.runFirstContext(a.authority)); assert.equal(f.counts.close, 1);
});
test('acceptance return alone cannot fake independent session progression', async () => {
 const f = loadWrapper({ acceptNoAdvance: true }), a = f.authorized(); await reject(f.wrapper.runFirstContext(a.authority));
 assert.equal(f.counts.inspect, 1); assert.equal(f.counts.close, 1); assert.equal(f.contextRecord().closed, true);
 assert.equal(f.sessionRecord().stage, 'failed');
});
for (const kind of ['head', 'branch', 'wrapper', 'own']) test('extraction rechecks and burns on drift: ' + kind, async () => {
 const f = loadWrapper(), a = f.authorized();
 if (kind === 'head') f.drift.head = 'b'.repeat(40); else if (kind === 'branch') f.drift.branch = 'other';
 else { const p = path.join(base, kind === 'own' ? 'qualification-railway-live-authorization.cjs' : 'qualification-railway-first-context-wrapper.cjs'); f.drift.files.set(p, fs.readFileSync(p, 'utf8') + '\n'); }
 await reject(f.wrapper.runFirstContext(a.authority)); f.drift.head = 'a'.repeat(40); f.drift.branch = 'feature/0092-shared-segment-suitability'; f.drift.files.clear();
 await reject(f.wrapper.runFirstContext(a.authority)); assert.equal(f.reads.length, 0); assert.equal(f.calls.length, 0);
});
test('wrapper drift blocks review and authorization before any authority or token access', () => {
 for (const stage of ['review', 'authorization']) {
  const f = loadWrapper(), a = f.prepared(), p = path.join(base, 'qualification-railway-first-context-wrapper.cjs');
  const reviewed = stage === 'authorization' ? f.auth.reviewPackage(a.draft, a.target, a.ack) : null;
  f.drift.files.set(p, fs.readFileSync(p, 'utf8') + '// drift\n');
  if (stage === 'review') assert.throws(() => f.auth.reviewPackage(a.draft, a.target, a.ack));
  else assert.throws(() => f.auth.authorizeFirstLiveContext(a.draft, a.target, { ...reviewed.finalAcknowledgementTemplate, manualLiveAuthorization: true }));
  assert.equal(f.reads.length, 0); assert.equal(f.calls.length, 0);
 }
});
test('close failing before invalidation cannot produce success or a second close attempt', async () => {
 const f = loadWrapper({ closeBeforeFailure: true }), a = f.authorized(); await reject(f.wrapper.runFirstContext(a.authority));
 assert.equal(f.counts.close, 1); assert.equal(f.calls.length, 1); assert.equal(f.contextRecord().closed, false);
 await reject(f.wrapper.runFirstContext(a.authority)); assert.equal(f.counts.close, 1); assert.equal(f.calls.length, 1);
 // Fixture disposes its captured synthetic resource; production exposes none.
 f.adapter.closeExecutionContext(f.handles.open);
});
test('concurrent calls with the same authority dispatch once', async () => {
 const f = loadWrapper(), a = f.authorized();
 const first = f.wrapper.runFirstContext(a.authority), second = f.wrapper.runFirstContext(a.authority);
 await reject(second); assert.deepEqual(clone(await first), completion); assert.equal(f.calls.length, 1); assert.equal(f.counts.close, 1);
});
test('thirteen pins verify final bytes and unresolved template exactly regenerates', () => {
 const pins = normalAuth.sourceHashes; assert.equal(Object.keys(pins).length, 13);
 const canonicalHash = p => crypto.createHash('sha256').update(fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n'), 'utf8').digest('hex');
 for (const [name, expected] of Object.entries(pins)) assert.equal(canonicalHash(path.join(base, name)), expected);
 const template = normalAuth.reviewTemplate(), stored = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../docs/0110-live-review-template.json'), 'utf8'));
 assert.deepEqual(template, stored); assert.equal(template.manifest.codeIdentity.authorizationBoundarySha256, canonicalHash(path.join(base, 'qualification-railway-live-authorization.cjs')));
 assert.equal(template.manifest.codeIdentity.reviewedHead, null); assert.equal(template.manifest.codeIdentity.reviewedBranch, null); assert.equal(template.manualLiveAuthorization, false);
 for (const id of Object.values(template.target)) assert.equal(id, null);
});
