'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const plan = require('../../scripts/assessment-worker/qualification-railway-introspection-plan.cjs');
const ref = (name, kind = 'SCALAR') => ({ kind, name, ofType: null });
const wrap = (kind, ofType) => ({ kind, name: null, ofType });
const arg = (name, type = ref('ID')) => ({ name, type, defaultValue: null });
const field = (name, type = ref('ID'), args = []) => ({ name, type, args });
const object = (name, fields) => ({ kind: 'OBJECT', name, fields, inputFields: null, enumValues: null });
const response = type => ({ data: { __type: type } });
const root = () => object('Query', [field('deploymentInstanceExecutions', wrap('LIST', ref('DeploymentInstanceExecution', 'OBJECT')), [arg('input', wrap('NON_NULL', ref('ExecutionInput', 'INPUT_OBJECT')))])]);
function session() { const s = plan.start(); plan.accept(s, { data: { __schema: { queryType: { name: 'Query' } } } }); return s; }
test.beforeEach(t => t.mock.method(global, 'fetch', async () => { throw Error('No network'); }));
test('fixed documents and names are deeply immutable', () => {
 assert.deepEqual(Object.keys(plan.documents), ['root', 'type']);
 assert.equal(plan.documents.root.operationName, 'Movement0106QueryRoot');
 assert.equal(plan.documents.type.operationName, 'Movement0106ReferencedType');
 assert.throws(() => { plan.documents.type.source = 'query Other { id }'; });
 assert.throws(() => plan.documents.type.establishes.push('authority'));
});
for (const forbidden of ['mutation', 'subscription', 'deploy', 'redeploy', 'restart', 'logs', 'variables', 'value', 'token', 'password']) test(`documents exclude ${forbidden}`, () => {
 for (const doc of Object.values(plan.documents)) {
  assert.match(doc.source, /^query Movement0106/);
  assert(!new RegExp(`\\b${forbidden}\\b`, 'i').test(doc.source));
 }
});
test('no transport or execution query module exposed', () => {
 assert.deepEqual(Object.keys(plan), ['documents', 'start', 'next', 'accept', 'evidence', 'finish', 'executionSchemaReady', 'runtimeProvenance']);
 assert(!fs.existsSync('scripts/assessment-worker/qualification-execution-query.cjs'));
 const source = fs.readFileSync('scripts/assessment-worker/qualification-railway-introspection-plan.cjs', 'utf8');
 assert(!/require\(|fetch\(|spawn\(|process\.env|https?:/.test(source));
});
test('arbitrary source and serialized sessions rejected', () => {
 for (const input of ['query X { id }', {}, JSON.parse(JSON.stringify(plan.start()))]) assert.throws(() => plan.next(input));
});
test('root name determines exact second-query variables', () => {
 const s = plan.start(); assert.deepEqual(plan.next(s).variables, {});
 plan.accept(s, { data: { __schema: { queryType: { name: 'ActualRoot' } } } });
 assert.deepEqual(plan.next(s).variables, { name: 'ActualRoot' });
 assert.equal(plan.next(s).discoveredAt, '__schema.queryType.name');
});
for (const [label, modify] of [
 ['GraphQL errors', r => { r.errors = [{ message: 'sensitive' }]; }],
 ['unexpected envelope', r => { r.extensions = {}; }],
 ['missing __type', r => { r.data = {}; }],
 ['null __type', r => { r.data.__type = null; }],
 ['duplicate field', r => { r.data.__type.fields.push(r.data.__type.fields[0]); }],
 ['duplicate argument', r => { r.data.__type.fields[0].args.push(r.data.__type.fields[0].args[0]); }],
 ['unknown kind', r => { r.data.__type.kind = 'UNKNOWN'; }],
 ['wrong staged name', r => { r.data.__type.name = 'Other'; }],
 ['wrong staged kind', r => { r.data.__type.kind = 'SCALAR'; r.data.__type.fields = null; }],
 ['NON_NULL nested NON_NULL', r => { r.data.__type.fields[0].type = wrap('NON_NULL', wrap('NON_NULL', ref('ID'))); }],
 ['LIST missing child', r => { r.data.__type.fields[0].type = wrap('LIST', null); }],
 ['named wrapper', r => { r.data.__type.fields[0].type.name = 'Invented'; }],
 ['leaf with child', r => { r.data.__type.fields[0].args[0].type = { kind: 'SCALAR', name: 'ID', ofType: ref('String') }; }],
 ['object input argument', r => { r.data.__type.fields[0].args[0].type = ref('Wrong', 'OBJECT'); }],
 ['description as evidence', r => { r.data.__type.description = 'Complete pagination and scope'; }],
 ['guessed parent fallback', r => { r.data.__type.fields[0].name = 'someOtherField'; }],
]) test(`${label} rejected with sanitized error`, () => {
 assert.throws(() => plan.accept(session(), modifyResponse(modify)), { message: 'Invalid local introspection evidence' });
});
function modifyResponse(modify) { const r = response(root()); modify(r); return r; }
test('malformed root response rejected', () => {
 for (const r of [null, [], { data: {} }, { data: { __schema: { queryType: null } } }]) assert.throws(() => plan.accept(plan.start(), r));
});
test('LIST/NON_NULL structure and default-dependent requiredness preserved', () => {
 const s = session(), type = root();
 type.fields[0].type = wrap('NON_NULL', wrap('LIST', wrap('NON_NULL', ref('DeploymentInstanceExecution', 'OBJECT'))));
 type.fields[0].args.push({ ...arg('first', wrap('NON_NULL', ref('Int'))), defaultValue: '25' });
 const evidence = plan.accept(s, response(type));
 assert.deepEqual(evidence.types.Query.fields[0].type, type.fields[0].type);
 assert.equal(evidence.types.Query.fields[0].args[0].required, true);
 assert.equal(evidence.types.Query.fields[0].args[1].required, false);
 assert.equal(plan.executionSchemaReady(s), false);
});
test('incomplete staged discovery cannot finish', () => {
 const s = session(); plan.accept(s, response(root()));
 assert.throws(() => plan.finish(s)); assert.equal(plan.evidence(s).stagedDiscoveryComplete, false);
});
test('complete structural closure still cannot invent scope/completeness semantics', () => {
 const s = session(); plan.accept(s, response(root()));
 const types = {
  ExecutionInput: { kind: 'INPUT_OBJECT', name: 'ExecutionInput', fields: null, inputFields: ['environmentId', 'serviceId', 'deploymentId'].map(n => arg(n, wrap('NON_NULL', ref('ID')))), enumValues: null },
  DeploymentInstanceExecution: object('DeploymentInstanceExecution', [field('id', wrap('NON_NULL', ref('ID'))), field('status', ref('ExecutionStatus', 'ENUM'))]),
  ID: { kind: 'SCALAR', name: 'ID', fields: null, inputFields: null, enumValues: null },
  ExecutionStatus: { kind: 'ENUM', name: 'ExecutionStatus', fields: null, inputFields: null, enumValues: [{ name: 'RUNNING' }, { name: 'STOPPED' }] },
 };
 while (plan.next(s)) plan.accept(s, response(types[plan.next(s).variables.name]));
 const out = plan.finish(s); assert.equal(out.stagedDiscoveryComplete, true); assert.equal(out.executionSchemaReady, false);
 assert(out.blockers.includes('scope_semantics_unproven')); assert.equal(plan.next(s), null);
 assert.throws(() => plan.accept(s, response(types.ID)));
 assert.throws(() => { out.executionSchemaReady = true; });
 assert.throws(() => plan.executionSchemaReady(JSON.parse(JSON.stringify(out))));
});
test('contradictory named references rejected', () => {
 const s = session(), type = root(); type.fields[0].args.push(arg('other', ref('ExecutionInput', 'ENUM')));
 assert.throws(() => plan.accept(s, response(type)));
});
test('edges alone do not establish connection semantics', () => {
 const s = session(), type = root(); type.fields[0].type = ref('Connection', 'OBJECT'); plan.accept(s, response(type));
 assert.equal(plan.evidence(s).executionSchemaReady, false);
});
for (const claim of [{ env: { ARBITRARY_RUNTIME_ID: 'x' } }, { runtimeId: 'x' }, { pid: 123 }, { controlPlaneHash: 'a'.repeat(64) }, { identity_proven: true }, JSON.parse(JSON.stringify(plan.runtimeProvenance))]) test(`runtime artifact ${JSON.stringify(claim)} cannot become authority`, () => {
 assert.throws(() => plan.executionSchemaReady(claim));
 assert.deepEqual(plan.runtimeProvenance.candidates, []);
 for (const key of ['identity_proven', 'causality_proven', 'restart_origin_proven', 'platformRestart']) assert.equal(plan.runtimeProvenance[key], null);
 assert.deepEqual(plan.runtimeProvenance.restartAttribution, { measurement: null, limitation: 'restart_origin_unattributable' });
});
test('runtime inventory cannot be promoted or replaced', () => {
 assert.throws(() => { plan.runtimeProvenance.identity_proven = true; });
 assert.throws(() => plan.runtimeProvenance.candidates.push({ name: 'ARBITRARY' }));
});
test('normal worker does not import 0106', () => {
 assert(!/introspection-plan|0106/.test(fs.readFileSync('scripts/assessment-worker/run.cjs', 'utf8')));
});
test('review artifacts exactly match immutable documents', () => {
 assert.equal(fs.readFileSync('docs/0106-introspection/query-root.graphql', 'utf8').replace(/\r\n/g, '\n'), plan.documents.root.source + '\n');
 assert.equal(fs.readFileSync('docs/0106-introspection/referenced-type.graphql', 'utf8').replace(/\r\n/g, '\n'), plan.documents.type.source + '\n');
});
test('stdin harness accepts only response transcripts and sanitizes errors', () => {
 const { spawnSync } = require('node:child_process');
 const file = 'scripts/assessment-worker/qualification-railway-introspection-validate.cjs';
 for (const input of ['query Arbitrary { id }', '{"credentials":"do-not-echo"}', '[{"data":{},"errors":[{"message":"do-not-echo"}]}]']) {
  const result = spawnSync(process.execPath, [file], { input, encoding: 'utf8' });
  assert.equal(result.status, 1); assert.equal(result.stdout, ''); assert.equal(result.stderr, 'Invalid local introspection evidence\n');
 }
 const partial = spawnSync(process.execPath, [file], { input: JSON.stringify([{ data: { __schema: { queryType: { name: 'Query' } } } }]), encoding: 'utf8' });
 assert.equal(partial.status, 0); assert.equal(JSON.parse(partial.stdout).executionSchemaReady, false);
 assert.equal(JSON.parse(partial.stdout).stagedDiscoveryComplete, false);
 const flags = spawnSync(process.execPath, [file, '--token'], { input: '[]', encoding: 'utf8' });
 assert.equal(flags.status, 1);
});
test('wrapper-depth exhaustion rejected instead of truncated', () => {
 const r = root(); let type = ref('ID'); for (let i = 0; i < 9; i++) type = wrap('LIST', type);
 r.fields[0].type = type; assert.throws(() => plan.accept(session(), response(r)));
});
test('duplicate input fields and enum members rejected', () => {
 const s = session(); plan.accept(s, response(root()));
 const input = { kind: 'INPUT_OBJECT', name: 'ExecutionInput', fields: null, inputFields: [arg('id'), arg('id')], enumValues: null };
 assert.throws(() => plan.accept(s, response(input)));
 const e = session(), r = root(); r.fields[0].args = [arg('status', ref('Status', 'ENUM'))]; plan.accept(e, response(r));
 assert.throws(() => plan.accept(e, response({ kind: 'ENUM', name: 'Status', fields: null, inputFields: null, enumValues: [{ name: 'RUNNING' }, { name: 'RUNNING' }] })));
});
test('literal defaults are never serialized', () => {
 const s = session(), r = root(); r.fields[0].args[0].defaultValue = '"synthetic-private-default"';
 const out = plan.accept(s, response(r)); assert(!JSON.stringify(out).includes('synthetic-private-default'));
 assert.equal(out.types.Query.fields[0].args[0].hasDefault, true);
});
test('dictionary metaproperty names cannot corrupt staged discovery', () => {
 for (const name of ['__proto__', 'constructor', 'prototype']) assert.throws(() => plan.accept(plan.start(), { data: { __schema: { queryType: { name } } } }));
});
test('prose, variables and malformed constants cannot become defaults', () => {
 for (const value of ['complete pagination proven', '$operator', '[1', '{id: 1 id: 2}', '01', '"unterminated']) {
  const r = root(); r.fields[0].args[0].defaultValue = value; assert.throws(() => plan.accept(session(), response(r)));
 }
});
test('nested GraphQL constant defaults preserve only presence', () => {
 const r = root(); r.fields[0].args[0].defaultValue = '{environmentId: "synthetic", options: [RUNNING, null, true, -1.25e2]}';
 assert.equal(plan.accept(session(), response(r)).types.Query.fields[0].args[0].hasDefault, true);
});
test('nonnull null default and empty type definitions rejected', () => {
 const s = session(), r = root(); r.fields[0].args[0].defaultValue = 'null'; assert.throws(() => plan.accept(s, response(r)));
 assert.throws(() => plan.accept(session(), response(object('Query', []))));
 const i = session(); plan.accept(i, response(root()));
 assert.throws(() => plan.accept(i, response({ kind: 'INPUT_OBJECT', name: 'ExecutionInput', fields: null, inputFields: [], enumValues: null })));
});
function minimizedFixture() {
 const s = session(), query = root();
 query.fields.push(field('unrelatedRootOperation', ref('UnrelatedRootType', 'OBJECT'), [arg('unrelatedRootArgument', ref('UnrelatedRootInput', 'INPUT_OBJECT'))]));
 const transcript = [{ data: { __schema: { queryType: { name: 'Query' } } } }, response(query)];
 plan.accept(s, response(query));
 const types = {
  ExecutionInput: { kind: 'INPUT_OBJECT', name: 'ExecutionInput', fields: null,
   inputFields: [arg('environmentId'), arg('serviceId'), arg('deploymentId'), arg('customInputConstraint')], enumValues: null },
  DeploymentInstanceExecution: object('DeploymentInstanceExecution', [field('id'), field('status', ref('ExecutionStatus', 'ENUM')),
   field('unrelatedOutputOperation', ref('UnrelatedOutputType', 'OBJECT'), [arg('unrelatedOutputArgument', ref('UnrelatedOutputInput', 'INPUT_OBJECT'))])]),
  ID: { kind: 'SCALAR', name: 'ID', fields: null, inputFields: null, enumValues: null },
  ExecutionStatus: { kind: 'ENUM', name: 'ExecutionStatus', fields: null, inputFields: null, enumValues: [{ name: 'RUNNING' }, { name: 'STOPPED' }] },
 };
 while (plan.next(s)) {
  const r = response(types[plan.next(s).variables.name]); transcript.push(r); plan.accept(s, r);
 }
 return { s, transcript };
}
const unrelated = ['unrelatedRootOperation', 'UnrelatedRootType', 'unrelatedRootArgument', 'UnrelatedRootInput',
 'unrelatedOutputOperation', 'UnrelatedOutputType', 'unrelatedOutputArgument', 'UnrelatedOutputInput'];
test('shareable evidence deliberately excludes unrelated root/output signatures', () => {
 const { s } = minimizedFixture();
 for (const out of [plan.evidence(s), plan.finish(s)]) {
  assert.deepEqual(out.types.Query.fields.map(f => f.name), ['deploymentInstanceExecutions']);
  assert.deepEqual(out.types.DeploymentInstanceExecution.fields.map(f => f.name), ['id', 'status']);
  for (const name of unrelated) assert(!JSON.stringify(out).includes(name));
  assert.equal(out.executionSchemaReady, false); assert.equal(out.stagedDiscoveryComplete, true);
 }
});
test('complete input fields and enum members survive minimized storage; scalars are kind/name only', () => {
 const out = plan.finish(minimizedFixture().s);
 assert.deepEqual(out.types.ExecutionInput.inputFields.map(f => f.name), ['environmentId', 'serviceId', 'deploymentId', 'customInputConstraint']);
 assert(out.types.ExecutionInput.inputFields.every(f => f.type.name === 'ID' && f.required === false && f.hasDefault === false));
 assert.deepEqual(out.types.ExecutionStatus.enumValues, [{ name: 'RUNNING' }, { name: 'STOPPED' }]);
 assert.deepEqual(out.types.ID, { kind: 'SCALAR', name: 'ID' });
});
test('stdin stdout exposes the same minimized facts without unrelated signatures', () => {
 const { spawnSync } = require('node:child_process'), { s, transcript } = minimizedFixture();
 const result = spawnSync(process.execPath, ['scripts/assessment-worker/qualification-railway-introspection-validate.cjs'], { input: JSON.stringify(transcript), encoding: 'utf8' });
 assert.equal(result.status, 0); assert.equal(result.stderr, '');
 assert.deepEqual(JSON.parse(result.stdout), plan.finish(s));
 for (const name of unrelated) assert(!result.stdout.includes(name));
});
test('full raw unrelated signatures remain strictly validated before minimization', () => {
 for (const alter of [
  q => q.fields.push(q.fields[1]),
  q => q.fields[1].args.push(q.fields[1].args[0]),
  q => { q.fields[1].type = wrap('NON_NULL', wrap('NON_NULL', ref('ID'))); },
  q => { q.fields[1].type.kind = 'UNKNOWN'; },
 ]) {
  const q = root(); q.fields.push(field('unrelatedRawField', ref('Other', 'OBJECT'), [arg('unrelatedArg')])); alter(q);
  assert.throws(() => plan.accept(session(), response(q)));
 }
});
test('LF/CRLF review content matches canonical serialization with no content relaxation', () => {
 for (const doc of Object.values(plan.documents)) {
  const canonical = doc.source + '\n';
  assert.equal(canonical.replace(/\n/g, '\r\n').replace(/\r\n/g, '\n'), canonical);
  for (const altered of [canonical + '\n', canonical.replace('query ', 'query Different'), canonical.slice(0, -1)])
   assert.notEqual(altered.replace(/\r\n/g, '\n'), canonical);
 }
});
test('canonical UTF-8 LF hashes remain the reviewed values', () => {
 const crypto = require('node:crypto');
 const hash = doc => crypto.createHash('sha256').update(doc.source + '\n', 'utf8').digest('hex');
 assert.equal(hash(plan.documents.root), 'c2d77d8ecb5af73166ce944034246eb70160ad7d5f7610c7c5e2c425fcb0f9aa');
 assert.equal(hash(plan.documents.type), '767e872ef31749fc65294af899f50da35cd0b50cb866b31809a7736e7fbdefa7');
});
test('reviewed connection/edge/pageInfo discovery fields survive minimization', () => {
 const s = session(), q = root(); q.fields[0].args = []; q.fields[0].type = ref('Connection', 'OBJECT');
 plan.accept(s, response(q));
 const types = {
  Connection: object('Connection', [field('edges', wrap('LIST', ref('Edge', 'OBJECT'))), field('pageInfo', ref('PageInfo', 'OBJECT')), field('unrelatedConnectionField')]),
  Edge: object('Edge', [field('node', ref('Execution', 'OBJECT')), field('cursor', ref('String')), field('unrelatedEdgeField')]),
  PageInfo: object('PageInfo', [field('hasNextPage', ref('Boolean')), field('endCursor', ref('String')), field('unrelatedPageInfoField')]),
  Execution: object('Execution', [field('id')]),
  String: { kind: 'SCALAR', name: 'String', fields: null, inputFields: null, enumValues: null },
  Boolean: { kind: 'SCALAR', name: 'Boolean', fields: null, inputFields: null, enumValues: null },
  ID: { kind: 'SCALAR', name: 'ID', fields: null, inputFields: null, enumValues: null },
 };
 while (plan.next(s)) plan.accept(s, response(types[plan.next(s).variables.name]));
 const out = plan.finish(s);
 for (const [type, names] of Object.entries({ Connection: ['edges', 'pageInfo'], Edge: ['node', 'cursor'], PageInfo: ['hasNextPage', 'endCursor'] }))
  assert.deepEqual(out.types[type].fields.map(f => f.name), names);
 assert(!JSON.stringify(out).includes('unrelated')); assert.equal(out.executionSchemaReady, false);
});
