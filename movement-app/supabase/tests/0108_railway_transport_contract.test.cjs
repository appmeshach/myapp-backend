'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), crypto = require('node:crypto');
const transport = require('../../scripts/assessment-worker/qualification-railway-transport-contract.cjs');
const context = require('../../scripts/assessment-worker/qualification-railway-project-token-context.cjs');
const targets = require('../../scripts/assessment-worker/qualification-railway-introspection-target.cjs');
const preflight = require('../../scripts/assessment-worker/qualification-railway-introspection-preflight.cjs');
const plan = require('../../scripts/assessment-worker/qualification-railway-introspection-plan.cjs');
const builder = require('../../scripts/assessment-worker/qualification-railway-introspection-request.cjs');
const c = transport.contract;
const scope = () => ({ environmentKind: 'disposable', lifecycle: 'active', projectId: 'synthetic-project', environmentId: 'synthetic-env', serviceId: 'synthetic-service', serviceInstanceId: null });
const binding = () => targets.bindTarget(scope(), scope(), { inventoryReviewed: true, projectIds: [], environmentIds: [], serviceIds: [], serviceInstanceIds: [] });
const body = () => ({ data: { projectToken: { projectId: 'synthetic-project', environmentId: 'synthetic-env' } } });
test.beforeEach(t => t.mock.method(global, 'fetch', async () => { throw Error('No network'); }));
for (const [key, value] of Object.entries({ endpoint: 'https://backboard.railway.com/graphql/v2', method: 'POST', contentType: 'application/json', preferredAuthKind: 'project_token', directAuthHeaderName: 'Project-Access-Token', operatorEnvironmentVariableName: 'RAILWAY_TOKEN' }))
 test('frozen transport contract fixes '+key, () => { assert.equal(c[key], value); assert.throws(() => { c[key] = 'Other'; }); });
test('exact conceptual headers/body keys; no generic header bag', () => {
 assert.deepEqual(c.allowedHeaderNames, ['Content-Type', 'Project-Access-Token']); assert.deepEqual(c.requestBodyKeys, ['query', 'operationName', 'variables']);
 assert.throws(() => c.allowedHeaderNames.push('Authorization'));
 assert.deepEqual(Object.keys(transport), ['contract', 'assertTokenSource']);
});
test('only project-token environment NAME selection accepted, no value read', () => {
 assert.deepEqual(transport.assertTokenSource({ authKind: 'project_token', environmentVariableNames: ['RAILWAY_TOKEN'] }), { authKind: 'project_token', environmentVariableName: 'RAILWAY_TOKEN', headerName: 'Project-Access-Token' });
});
for (const names of [['RAILWAY_API_TOKEN'], ['RAILWAY_TOKEN', 'RAILWAY_API_TOKEN'], [], ['OTHER'], ['RAILWAY_TOKEN', 'RAILWAY_TOKEN']])
 test('alternate/simultaneous source rejected '+JSON.stringify(names), () => assert.throws(() => transport.assertTokenSource({ authKind: 'project_token', environmentVariableNames: names })));
for (const kind of ['account_token', 'workspace_token', 'oauth_token', 'bearer', 'cli_login']) test('broader auth path rejected '+kind, () => assert.throws(() => transport.assertTokenSource({ authKind: kind, environmentVariableNames: ['RAILWAY_TOKEN'] })));
test('auth/header/value shortcuts rejected without value inspection or echo', () => {
 for (const key of ['token', 'Authorization', 'headers', 'interactiveCliSession', 'tokenFile']) {
  let reads = 0; const selection = { authKind: 'project_token', environmentVariableNames: ['RAILWAY_TOKEN'] };
  Object.defineProperty(selection, key, { enumerable: true, get() { reads++; throw Error('Secret inspected'); } });
  assert.throws(() => transport.assertTokenSource(selection), { message: 'Railway token source contract unavailable' }); assert.equal(reads, 0);
 }
 assert.equal(c.broaderTokensSupported, false); assert.equal(c.interactiveCliAuthenticationSupported, false);
});
test('context operation and exact no-variable request are fixed and immutable', () => {
 assert.equal(context.document.source, 'query Movement0108ProjectTokenContext {\n  projectToken {\n    projectId\n    environmentId\n  }\n}');
 assert.deepEqual(context.buildRequest(), { query: context.document.source, operationName: 'Movement0108ProjectTokenContext', variables: {} });
 assert.throws(() => { context.document.source = 'query Other { id }'; }); assert.throws(() => { context.buildRequest().variables.name = 'Other'; });
});
for (const supplied of ['query Other { id }', { operationName: 'Other' }, { variables: { name: 'Other' } }, { token: 'synthetic' }])
 test('no caller source/operation/variables/credentials '+JSON.stringify(supplied), () => assert.throws(() => context.buildRequest(supplied)));
test('canonical context hash and CRLF-safe review artifact exact', () => {
 assert.equal(context.canonicalSha256, 'd3190e45cbf0ec1242ef090a9a5a437c4043a5e7542b075921744349b8039e28');
 assert.equal(crypto.createHash('sha256').update(context.document.source+'\n', 'utf8').digest('hex'), context.canonicalSha256);
 assert.equal(fs.readFileSync('docs/0108-introspection/project-token-context.graphql', 'utf8').replace(/\r\n/g, '\n'), context.document.source+'\n');
});
test('changed context source/hash fails closed', () => {
 for (const altered of [source('project-token-context').replace('    projectId\n', '    projectIdExtra\n'), source('project-token-context').replace(context.canonicalSha256, '0'.repeat(64))]) {
  const module = { exports: {} }; vm.runInNewContext(altered, { module, require: localRequire('project-token-context') });
  assert.throws(() => module.exports.buildRequest(), /Railway project token context unavailable/);
 }
});
for (const word of ['mutation', 'subscription', 'logs', 'variables', 'value', 'deployment', 'deploy', 'restart', 'redeploy', 'account', 'serviceInstance'])
 test('context document is query-only and excludes '+word, () => { assert.match(context.document.source, /^query Movement0108ProjectTokenContext/); assert(!new RegExp('\\b'+word+'\\b', 'i').test(context.document.source)); });
test('exact response normalized against original private binding; output frozen', () => {
 const input = body(), out = context.validateContextResponse(binding(), input);
 assert.deepEqual(out, { projectId: 'synthetic-project', environmentId: 'synthetic-env' });
 input.data.projectToken.projectId = 'changed'; assert.equal(out.projectId, 'synthetic-project'); assert(Object.isFrozen(out));
});
for (const [label, alter] of [
 ['errors', b => { b.errors = []; }], ['headers', b => { b.headers = {}; }], ['cookies', b => { b.cookies = []; }],
 ['missing projectToken', b => { b.data = {}; }], ['null projectToken', b => { b.data.projectToken = null; }],
 ['missing projectId', b => { delete b.data.projectToken.projectId; }], ['missing environmentId', b => { delete b.data.projectToken.environmentId; }],
 ['wrong project', b => { b.data.projectToken.projectId = 'Other'; }], ['wrong environment', b => { b.data.projectToken.environmentId = 'Other'; }],
 ['malformed ID', b => { b.data.projectToken.projectId = 17; }], ['ID prose', b => { b.data.projectToken.projectId = 'approved project context'; }],
 ['token field', b => { b.data.projectToken.token = 'synthetic-private-token'; }], ['description', b => { b.data.projectToken.description = 'Provider attested'; }],
 ['identity assertion', b => { b.projectEnvironmentContextProven = true; }], ['service field', b => { b.data.projectToken.serviceId = 'synthetic-service'; }],
]) test('strict context response rejects '+label, () => { const b = body(); alter(b); assert.throws(() => context.validateContextResponse(binding(), b), { message: 'Railway project token context unavailable' }); });
test('serialized/fake binding or result cannot become provider evidence', () => {
 for (const target of [{}, JSON.parse(JSON.stringify(targets.describeTarget(binding()))), { privatePermit: {}, body: body(), authenticated: true }]) assert.throws(() => context.validateContextResponse(target, body()));
 assert.deepEqual(Object.keys(context), ['document', 'canonicalSha256', 'buildRequest', 'validateContextResponse']);
 assert.equal(c.authenticatedResultMintingImplemented, false); assert.equal(c.futureResultBinding.serializedInputAccepted, false); assert.equal(c.futureResultBinding.publicConstructor, false);
});
test('synthetic equality never marks observed/project/service context proven', () => {
 context.validateContextResponse(binding(), body());
 assert.equal(c.transportContractReady, true); assert.equal(c.providerContextAttestationReady, true);
 for (const key of ['providerContextObserved', 'projectEnvironmentContextProven', 'serviceContextProven', 'executionSchemaReady', 'liveExecutorImplemented']) assert.equal(c[key], false);
 for (const key of ['identity_proven', 'causality_proven', 'restart_origin_proven', 'platformRestart']) assert.equal(c[key], null);
 assert.deepEqual(c.restartAttribution, { measurement: null, limitation: 'restart_origin_unattributable' });
 assert.equal(c.serviceBindingRequiredForSchemaIntrospection, false);
});
test('future result design requires every private invocation binding; no mint capability', () => {
 assert.deepEqual(c.futureResultBinding.requiredBindings, ['original_consumed_permit', 'original_target_object', 'immutable_request', 'fixed_endpoint', 'project_token_auth_kind', 'successful_same_auth_context_attestation', 'body_from_exact_invocation']);
 assert.equal(c.futureResultBinding.promotionFromCallerBody, false);
 assert(!('executeFixedReadonlyRailwayRequest' in transport)); assert(!('createAuthenticatedResult' in context));
});
function source(suffix) { return fs.readFileSync(`scripts/assessment-worker/qualification-railway-${suffix}.cjs`, 'utf8').replace(/\r\n/g, '\n'); }
function localRequire(suffix) { return require('node:module').createRequire(require('node:path').resolve(`scripts/assessment-worker/qualification-railway-${suffix}.cjs`)); }
for (const suffix of ['transport-contract', 'project-token-context']) test('local '+suffix+' reads no environment/credentials and has no executor', () => {
 assert(!/process\.env|\bfetch\s*\(|node:https|node:http|node:child_process|\b(?:spawn|exec|request)\s*\(/.test(source(suffix)));
 let reads = 0; const module = { exports: {} };
 vm.runInNewContext(source(suffix), { module, require: localRequire(suffix), process: { env: new Proxy({}, { get() { reads++; throw Error('Environment read'); } }) } });
 if (suffix === 'transport-contract') module.exports.assertTokenSource({ authKind: 'project_token', environmentVariableNames: ['RAILWAY_TOKEN'] });
 else { module.exports.buildRequest(); module.exports.validateContextResponse(binding(), body()); }
 assert.equal(reads, 0);
});
test('0107 historical state and private one-use review remain unchanged', () => {
 assert.equal(preflight.contract.outcome, 'TRANSPORT_NOT_READY'); assert.deepEqual(preflight.contract.authVariableNameAllowlist, []);
 const s = plan.start(), target = binding(), review = preflight.reviewNext(s, target), permit = preflight.approveReview(review, { ...review.meta, reviewed: true });
 const invocation = preflight.consumeApprovedRequest(permit); assert.equal(invocation.target.independentlyAuthoritative, false);
 assert.throws(() => preflight.consumeApprovedRequest(permit)); assert(Object.isFrozen(builder.buildRequest(s)));
 assert.equal(c.transportContractReady, true); assert.equal(c.liveExecutorImplemented, false);
});
