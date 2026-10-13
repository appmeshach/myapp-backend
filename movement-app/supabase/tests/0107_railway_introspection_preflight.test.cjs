'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const plan = require('../../scripts/assessment-worker/qualification-railway-introspection-plan.cjs');
const builder = require('../../scripts/assessment-worker/qualification-railway-introspection-request.cjs');
const targets = require('../../scripts/assessment-worker/qualification-railway-introspection-target.cjs');
const preflight = require('../../scripts/assessment-worker/qualification-railway-introspection-preflight.cjs');
const scope = () => ({ environmentKind: 'disposable', lifecycle: 'active', projectId: 'synthetic-project', environmentId: 'synthetic-env', serviceId: 'synthetic-service', serviceInstanceId: null });
const policy = () => ({ inventoryReviewed: true, projectIds: [], environmentIds: [], serviceIds: [], serviceInstanceIds: [] });
const binding = () => targets.bindTarget(scope(), scope(), policy());
const rootResponse = { data: { __schema: { queryType: { name: 'ActualRoot' } } } };
function staged() { const s = plan.start(); plan.accept(s, rootResponse); return s; }
const modules = ['request', 'target', 'preflight'];
const source = suffix => fs.readFileSync(`scripts/assessment-worker/qualification-railway-introspection-${suffix}.cjs`, 'utf8');
test.beforeEach(t => t.mock.method(global, 'fetch', async () => { throw Error('No network'); }));
test('builder exposes fixed construction and hash verification only', () => assert.deepEqual(Object.keys(builder), ['verifyDocuments', 'buildRequest']));
test('root request is exact immutable payload', () => {
 const request = builder.buildRequest(plan.start());
 assert.deepEqual(request, { query: plan.documents.root.source, operationName: 'Movement0106QueryRoot', variables: {} });
 assert(Object.isFrozen(request)); assert(Object.isFrozen(request.variables));
});
test('type request can only use the exact name from private next(session)', () => {
 const s = staged(), request = builder.buildRequest(s);
 assert.deepEqual(request, { query: plan.documents.type.source, operationName: 'Movement0106ReferencedType', variables: { name: 'ActualRoot' } });
 assert.equal(request.variables.name, plan.next(s).variables.name);
});
for (const [label, extra] of [['GraphQL', 'query Arbitrary { id }'], ['operationName', { operationName: 'Arbitrary' }], ['type name', { name: 'Other' }], ['extra variables', { variables: { name: 'Other', extra: 'x' } }]]) test(`caller ${label} rejected`, () => {
 assert.throws(() => builder.buildRequest(plan.start(), extra));
 assert.throws(() => builder.buildRequest({ session: plan.start(), ...Object(extra) }));
});
for (const fake of [{}, { document: plan.documents.root, variables: {} }, JSON.parse(JSON.stringify(plan.start()))]) test('fake/serialized session cannot build a request '+JSON.stringify(fake), () => assert.throws(() => builder.buildRequest(fake)));
test('canonical hashes verified before every root/type payload', () => {
 assert.equal(builder.verifyDocuments().root, 'c2d77d8ecb5af73166ce944034246eb70160ad7d5f7610c7c5e2c425fcb0f9aa');
 assert.equal(builder.verifyDocuments().type, '767e872ef31749fc65294af899f50da35cd0b50cb866b31809a7736e7fbdefa7');
 assert.throws(() => builder.verifyDocuments({ root: '0'.repeat(64) }));
});
for (const key of ['root', 'type']) test(`changed ${key} source fails closed even before the other request`, () => {
 const docs = structuredClone(plan.documents); docs[key].source += ' ';
 const module = { exports: {} };
 vm.runInNewContext(source('request'), { module, require: name => name === 'node:crypto' ? require(name) : { documents: docs, next: () => ({ document: docs.root, variables: {} }) } });
 assert.throws(() => module.exports.buildRequest({}), /Introspection request preflight unavailable/);
});
test('changed operation name fails closed', () => {
 const docs = structuredClone(plan.documents); docs.root.operationName = 'Other'; const module = { exports: {} };
 vm.runInNewContext(source('request'), { module, require: name => name === 'node:crypto' ? require(name) : { documents: docs } });
 assert.throws(() => module.exports.verifyDocuments());
});
for (const kind of ['production', 'staging', 'inactive', 'decommissioned']) test('unapproved target kind rejected '+kind, () => assert.throws(() => targets.bindTarget({ ...scope(), environmentKind: kind }, { ...scope(), environmentKind: kind }, policy())));
for (const lifecycle of ['inactive', 'decommissioned']) test('target lifecycle rejected '+lifecycle, () => assert.throws(() => targets.bindTarget({ ...scope(), lifecycle }, { ...scope(), lifecycle }, policy())));
for (const key of ['projectIds', 'environmentIds', 'serviceIds', 'serviceInstanceIds']) test('denylist match rejected '+key, () => {
 const target = { ...scope(), serviceInstanceId: 'synthetic-instance' }, deny = policy(); deny[key] = [target[key.slice(0, -1)]];
 assert.throws(() => targets.bindTarget(target, target, deny));
});
test('missing, duplicate or unreviewed denylist rejected', () => {
 for (const p of [undefined, { ...policy(), inventoryReviewed: false }, { ...policy(), environmentIds: ['x', 'x'] }]) assert.throws(() => targets.bindTarget(scope(), scope(), p));
});
for (const key of ['projectId', 'environmentId', 'serviceId', 'serviceInstanceId']) test('selected scope mismatch rejected '+key, () => assert.throws(() => targets.bindTarget(scope(), { ...scope(), [key]: 'Other' }, policy())));
test('target identifiers are detached immutable operator constraints only', () => {
 const approved = scope(), selected = scope(), b = targets.bindTarget(approved, selected, policy()); approved.projectId = 'changed'; selected.serviceId = 'changed';
 const out = targets.describeTarget(b); assert.equal(out.projectId, 'synthetic-project'); assert.equal(out.constraintCategory, 'operator_plan_constraints');
 assert.equal(out.independentlyAuthoritative, false); assert.equal(out.identity_proven, null); assert(Object.isFrozen(out));
 assert.throws(() => targets.describeTarget(JSON.parse(JSON.stringify(out))));
});
test('credentials cannot enter target or denylist metadata', () => {
 const secret = 'sb_secret_synthetic_do_not_emit';
 assert.throws(() => targets.bindTarget({ ...scope(), token: secret }, scope(), policy()));
 assert.throws(() => targets.bindTarget({ ...scope(), projectId: secret }, { ...scope(), projectId: secret }, policy()));
 assert.throws(() => targets.bindTarget(scope(), scope(), { ...policy(), projectIds: [secret] }));
 assert(!JSON.stringify(preflight.contract).includes(secret));
});
test('auth/endpoint unresolved; no guessed variable allowlist or transport', () => {
 assert.equal(preflight.contract.outcome, 'TRANSPORT_NOT_READY'); assert.equal(preflight.contract.endpoint, null); assert.equal(preflight.contract.authenticationSyntax, null);
 assert.deepEqual(preflight.contract.authVariableNameAllowlist, []);
 assert.deepEqual(Object.keys(preflight), ['contract', 'reviewNext', 'approveReview', 'consumeApprovedRequest', 'acceptResponseBody']);
});
for (const suffix of modules) test('local '+suffix+' has no environment/network/process execution', () => {
 assert(!/process\.env|\bfetch\s*\(|node:https|node:http|node:child_process|\b(?:spawn|spawnSync|exec|execFile|execSync)\s*\(/.test(source(suffix)));
 const module = { exports: {} }; let reads = 0;
 const localRequire = require('node:module').createRequire(require('node:path').resolve(`scripts/assessment-worker/qualification-railway-introspection-${suffix}.cjs`));
 vm.runInNewContext(source(suffix), { module, process: { env: new Proxy({}, { get() { reads++; throw Error('Environment read forbidden'); } }) }, require: localRequire });
 // Exercise functions against real private sessions/bindings as well as module initialization.
 if (suffix === 'request') module.exports.buildRequest(plan.start());
 if (suffix === 'target') module.exports.bindTarget(scope(), scope(), policy());
 if (suffix === 'preflight') module.exports.reviewNext(plan.start(), binding());
 assert.equal(reads, 0);
});
for (const word of ['mutation', 'subscription', 'logs', 'variables', 'deploy', 'redeploy', 'restart', 'deploymentInstanceExecutions']) test('fixed provider documents exclude '+word, () => {
 for (const s of [plan.start(), staged()]) assert(!new RegExp('\\b'+word+'\\b', 'i').test(builder.buildRequest(s).query));
});
test('manual review artifacts are local canonical data; no execution happens', () => {
 const review = preflight.reviewNext(staged(), binding());
 assert.equal(review.artifacts.graphql, plan.documents.type.source+'\n'); assert.equal(review.artifacts.variablesJson, '{"name":"ActualRoot"}\n');
 assert.equal(review.meta.discoveryPath, '__schema.queryType.name'); assert.equal(review.meta.manualReviewRequired, true);
 assert.equal(review.meta.executionSchemaReady, false); assert(!JSON.stringify(review).includes('token'));
 assert.throws(() => preflight.consumeApprovedRequest(review));
});
test('explicit exact review acknowledgement is required and one-shot', () => {
 const review = preflight.reviewNext(plan.start(), binding());
 for (const ack of [undefined, true, { reviewed: true }, { ...review.meta, reviewed: false }, { ...review.meta, reviewed: true, token: 'synthetic' }]) assert.throws(() => preflight.approveReview(review, ack));
 const permit = preflight.approveReview(review, { ...review.meta, reviewed: true });
 assert.throws(() => preflight.approveReview(review, { ...review.meta, reviewed: true }));
 assert.throws(() => preflight.consumeApprovedRequest(JSON.parse(JSON.stringify(permit))));
 const invocation = preflight.consumeApprovedRequest(permit); assert.equal(invocation.request.operationName, 'Movement0106QueryRoot');
 assert.equal(invocation.target.identity_proven, null); assert.throws(() => preflight.consumeApprovedRequest(permit));
});
test('serialized review and altered staged path cannot mint approval', () => {
 const review = preflight.reviewNext(staged(), binding());
 assert.throws(() => preflight.approveReview(JSON.parse(JSON.stringify(review)), { ...review.meta, reviewed: true }));
 assert.throws(() => preflight.approveReview(review, { ...review.meta, discoveryPath: 'Other', reviewed: true }));
});
test('advancing discovery invalidates a prior permit; next type needs a new review', () => {
 const s = plan.start(), b = binding(), review = preflight.reviewNext(s, b), permit = preflight.approveReview(review, { ...review.meta, reviewed: true });
 preflight.acceptResponseBody(s, rootResponse); assert.throws(() => preflight.consumeApprovedRequest(permit));
 const next = preflight.reviewNext(s, b); assert.equal(next.meta.stagedTypeName, 'ActualRoot'); assert.equal(next.meta.manualReviewRequired, true);
 assert.throws(() => preflight.consumeApprovedRequest(next));
});
for (const response of [{ data: {}, errors: [] }, { data: {}, headers: {} }, { data: {}, cookies: [] }, { data: {}, token: 'synthetic-do-not-echo' }]) test('response capture rejects non-body/error envelope '+Object.keys(response).join(','), () => {
 assert.throws(() => preflight.acceptResponseBody(plan.start(), response), { message: 'Introspection review preflight unavailable' });
});
test('normalized response projection stays minimized and never promotes authority', () => {
 const s = staged(), scalar = { kind: 'SCALAR', name: 'ID', ofType: null }, field = name => ({ name, args: [], type: scalar });
 const out = preflight.acceptResponseBody(s, { data: { __type: { kind: 'OBJECT', name: 'ActualRoot', fields: [field('deploymentInstanceExecutions'), field('unrelatedRootName')], inputFields: null, enumValues: null } } });
 assert(!JSON.stringify(out).includes('unrelatedRootName')); assert.equal(out.executionSchemaReady, false);
 for (const key of ['identity_proven', 'causality_proven', 'restart_origin_proven', 'platformRestart']) assert.equal(preflight.contract[key], null);
 assert.deepEqual(preflight.contract.restartAttribution, { measurement: null, limitation: 'restart_origin_unattributable' });
});
