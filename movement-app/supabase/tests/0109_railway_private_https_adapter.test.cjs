'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), https = require('node:https');
const adapter = require('../../scripts/assessment-worker/qualification-railway-https-adapter.cjs');
const review = require('../../scripts/assessment-worker/qualification-railway-context-review.cjs');
const preflight = require('../../scripts/assessment-worker/qualification-railway-introspection-preflight.cjs');
const targets = require('../../scripts/assessment-worker/qualification-railway-introspection-target.cjs');
const plan = require('../../scripts/assessment-worker/qualification-railway-introspection-plan.cjs');
const context = require('../../scripts/assessment-worker/qualification-railway-project-token-context.cjs');
const { loadAdapter, rootBody } = require('./fixtures/0109-railway-https.cjs');
const scope = () => ({ environmentKind: 'disposable', lifecycle: 'active', projectId: 'synthetic-project', environmentId: 'synthetic-env', serviceId: 'synthetic-service', serviceInstanceId: null });
const binding = () => targets.bindTarget(scope(), scope(), { inventoryReviewed: true, projectIds: [], environmentIds: [], serviceIds: [], serviceInstanceIds: [] });
function schemaPermit(s, b) { const r = preflight.reviewNext(s, b); return preflight.approveReview(r, { ...r.meta, reviewed: true }); }
function schemaHandoff(s, b) { return preflight.consumeSchemaPermitForAdapter(schemaPermit(s, b), b); }
function contextPermit(b) { const r = review.reviewProjectTokenContext(b); return review.approveProjectTokenContextReview(r, { ...r.meta, reviewed: true }); }
function contextHandoff(b) { return review.consumeProjectTokenContextPermitForAdapter(contextPermit(b), b); }
async function attest(h, b, execution) { return h.api.consumeContextResult(await h.api.executeHandoff(execution, contextHandoff(b))); }
const normal = value => JSON.parse(JSON.stringify(value));
test.beforeEach(t => {
 let network = 0;
 t.mock.method(https, 'request', () => { network++; throw Error('REAL NETWORK FORBIDDEN'); });
 t.mock.method(global, 'fetch', async () => { network++; throw Error('REAL NETWORK FORBIDDEN'); });
 t.after(() => assert.equal(network, 0, 'No normal-module network attempt'));
});
test('exact production exports have no token/env/transport injection surface', () => {
 assert.deepEqual(Object.keys(adapter), ['status', 'safety', 'openExecutionContext', 'closeExecutionContext', 'executeHandoff', 'consumeContextResult', 'consumeSchemaResult', 'bindContextResultTransfer', 'prepareContextResultTransfer', 'consumeContextResultTransfer']);
 const h = loadAdapter(), b = binding();
 for (const extra of ['synthetic-token', { envReader: () => 'synthetic' }, { httpsModule: {} }, { endpoint: 'Other' }]) assert.throws(() => h.api.openExecutionContext(b, extra));
 assert.equal(h.reads.length, 0);
});
test('module import does not read any env property', () => {
 const h = loadAdapter({ env: new Proxy({}, { get() { throw Error('No value reads'); } }) }); assert.deepEqual(h.reads, []); assert.equal(h.calls.length, 0);
});
test('only original target opens a synthetic execution context', () => {
 const h = loadAdapter(), b = binding();
 for (const fake of [{}, normal(targets.describeTarget(b)), normal(b)]) assert.throws(() => h.api.openExecutionContext(fake));
 assert.deepEqual(h.reads, []); const x = h.api.openExecutionContext(b); assert.equal(JSON.stringify(x), '{}'); assert(Object.isFrozen(x)); assert.deepEqual(h.reads, ['RAILWAY_TOKEN']); h.api.closeExecutionContext(x);
});
test('API token presence rejects without reading either token value', () => {
 let reads = 0; const env = {};
 Object.defineProperty(env, 'RAILWAY_API_TOKEN', { enumerable: true, get() { reads++; throw Error('Forbidden value'); } });
 Object.defineProperty(env, 'RAILWAY_TOKEN', { enumerable: true, get() { reads++; throw Error('Forbidden value'); } });
 const h = loadAdapter({ env }); assert.throws(() => h.api.openExecutionContext(binding()), /Railway private HTTPS evidence unavailable/); assert.equal(reads, 0); assert.deepEqual(h.reads, []);
});
for (const env of [{}, { RAILWAY_TOKEN: '' }, { RAILWAY_TOKEN: undefined }]) test('missing/empty source fails generically '+JSON.stringify(env), () => {
 const h = loadAdapter({ env }); assert.throws(() => h.api.openExecutionContext(binding()), { message: 'Railway private HTTPS evidence unavailable' }); assert.equal(h.calls.length, 0);
});
test('schema handoff preserves original target/session/request and consumes once', () => {
 const b = binding(), s = plan.start(), permit = schemaPermit(s, b), hand = preflight.consumeSchemaPermitForAdapter(permit, b);
 assert.equal(JSON.stringify(hand), '{}'); assert(Object.isFrozen(hand)); assert.throws(() => preflight.consumeSchemaPermitForAdapter(permit, b));
 const record = preflight.takeSchemaHandoffForAdapter(hand, b);
 assert.equal(record.binding, b); assert.equal(record.session, s); assert.equal(record.permit, permit); assert(Object.isFrozen(record.request)); assert(Object.isFrozen(record.request.variables));
 assert.throws(() => preflight.takeSchemaHandoffForAdapter(hand, b));
});
for (const kind of ['different-private', 'serialized']) test('wrong '+kind+' target burns schema permit', () => {
 const b = binding(), p = schemaPermit(plan.start(), b), wrong = kind === 'serialized' ? normal(targets.describeTarget(b)) : binding();
 assert.throws(() => preflight.consumeSchemaPermitForAdapter(p, wrong)); assert.throws(() => preflight.consumeSchemaPermitForAdapter(p, b));
});
test('wrong target burns already minted schema handoff', () => {
 const b = binding(), hand = schemaHandoff(plan.start(), b); assert.throws(() => preflight.takeSchemaHandoffForAdapter(hand, binding())); assert.throws(() => preflight.takeSchemaHandoffForAdapter(hand, b));
});
test('stale stage burns schema permit and handoff', () => {
 const b = binding(), s = plan.start(), p = schemaPermit(s, b); plan.accept(s, rootBody());
 assert.throws(() => preflight.consumeSchemaPermitForAdapter(p, b)); assert.throws(() => preflight.consumeSchemaPermitForAdapter(p, b));
 const t = plan.start(), hand = schemaHandoff(t, b); plan.accept(t, rootBody());
 assert.throws(() => preflight.takeSchemaHandoffForAdapter(hand, b)); assert.throws(() => preflight.takeSchemaHandoffForAdapter(hand, b));
});
test('serialized/caller-built schema handoff cannot be taken', () => {
 const b = binding(), hand = schemaHandoff(plan.start(), b);
 for (const fake of [normal(hand), { kind: 'schema', binding: b, request: context.buildRequest() }]) assert.throws(() => preflight.takeSchemaHandoffForAdapter(fake, b));
 assert(preflight.takeSchemaHandoffForAdapter(hand, b));
});
test('context review is fixed no-variable canonical artifact with safe meta', () => {
 const r = review.reviewProjectTokenContext(binding()); assert.equal(r.artifacts.graphql, context.document.source+'\n'); assert.equal(r.artifacts.variablesJson, '{}\n');
 assert.equal(r.meta.querySha256, context.canonicalSha256); assert.equal(r.meta.endpoint, 'https://backboard.railway.com/graphql/v2'); assert.equal(r.meta.authKind, 'project_token');
 assert.equal(r.meta.manualReviewRequired, true); assert.equal(r.meta.providerContextObserved, false); assert.equal(r.meta.executionSchemaReady, false);
 assert(!JSON.stringify(r).includes('synthetic-private-credential'));
});
test('context review acknowledgement is exact and review/permit one-use', () => {
 const b = binding(), r = review.reviewProjectTokenContext(b);
 for (const ack of [{ reviewed: true }, { ...r.meta, reviewed: false }, { ...r.meta, reviewed: true, token: 'synthetic' }, { ...r.meta, endpoint: 'Other', reviewed: true }]) assert.throws(() => review.approveProjectTokenContextReview(r, ack));
 assert.throws(() => review.approveProjectTokenContextReview(normal(r), { ...r.meta, reviewed: true }));
 const p = review.approveProjectTokenContextReview(r, { ...r.meta, reviewed: true }); assert.throws(() => review.approveProjectTokenContextReview(r, { ...r.meta, reviewed: true }));
 assert.throws(() => review.consumeProjectTokenContextPermitForAdapter(normal(p), b));
 const hand = review.consumeProjectTokenContextPermitForAdapter(p, b); assert.throws(() => review.consumeProjectTokenContextPermitForAdapter(p, b));
 assert.equal(review.takeAdapterHandoff(hand, b).permit, p); assert.throws(() => review.takeAdapterHandoff(hand, b));
});
for (const kind of ['different-private', 'serialized']) test('wrong '+kind+' context target burns permit', () => {
 const b = binding(), p = contextPermit(b), wrong = kind === 'serialized' ? normal(targets.describeTarget(b)) : binding();
 assert.throws(() => review.consumeProjectTokenContextPermitForAdapter(p, wrong)); assert.throws(() => review.consumeProjectTokenContextPermitForAdapter(p, b));
});
test('context review accepts no source/operation/variables or fake target', () => {
 const b = binding(); for (const extra of ['query Other { id }', { operationName: 'Other' }, { variables: { name: 'Other' } }]) assert.throws(() => review.reviewProjectTokenContext(b, extra));
 assert.throws(() => review.reviewProjectTokenContext(normal(targets.describeTarget(b))));
});
test('HTTPS uses exact host/path/method/headers and fixed reviewed JSON body', async () => {
 const h = loadAdapter(), b = binding(), x = h.api.openExecutionContext(b), result = await h.api.executeHandoff(x, contextHandoff(b));
 const call = h.calls[0]; assert.equal(call.options.protocol, 'https:'); assert.equal(call.options.hostname, 'backboard.railway.com'); assert.equal(call.options.port, 443); assert.equal(call.options.path, '/graphql/v2'); assert.equal(call.options.method, 'POST');
 assert.equal(call.options.agent, false); assert.equal(call.options.rejectUnauthorized, true); assert.equal(call.options.maxHeaderSize, 16384);
 assert.deepEqual(Object.keys(call.options.headers), ['Content-Type', 'Project-Access-Token']); assert.equal(call.options.headers['Content-Type'], 'application/json');
 assert.equal(call.options.headers['Project-Access-Token'], 'synthetic-private-credential'); assert.deepEqual(normal(call.body), context.buildRequest());
 assert.equal(JSON.stringify(result), '{}'); assert(Object.isFrozen(result)); h.api.consumeContextResult(result); assert.equal(h.timers.size, 0); h.api.closeExecutionContext(x);
});
for (const status of [301, 302, 307, 308, 201, 204, 400, 401, 500]) test('status '+status+' rejects/destroys without retry', async () => {
 const h = loadAdapter({ driver: { status, raw: 'synthetic-private-credential' } }), b = binding(), x = h.api.openExecutionContext(b), hand = contextHandoff(b);
 await assert.rejects(h.api.executeHandoff(x, hand), { message: 'Railway private HTTPS evidence unavailable' }); assert.equal(h.calls.length, 1); assert(h.destroyed()>0); assert.equal(h.timers.size, 0);
 await assert.rejects(h.api.executeHandoff(x, contextHandoff(b))); assert.equal(h.calls.length, 1);
});
for (const contentType of ['text/html', 'application/json; charset=latin1', 'application/json; other=x', ['application/json']]) test('incompatible JSON content type '+JSON.stringify(contentType)+' rejected', async () => {
 const h = loadAdapter({ driver: { contentType } }), b = binding(), x = h.api.openExecutionContext(b); await assert.rejects(h.api.executeHandoff(x, contextHandoff(b))); assert.equal(h.calls.length, 1); assert(h.destroyed()>0);
});
for (const contentType of ['application/json', 'application/json; charset=utf-8', 'application/graphql-response+json; charset=UTF-8']) test('fixed JSON media rule accepts '+contentType, async () => {
 const h = loadAdapter({ driver: { contentType } }), b = binding(), x = h.api.openExecutionContext(b); const out = await attest(h,b,x); assert.equal(out.projectEnvironmentContextProven, true); h.api.closeExecutionContext(x);
});
for (const driver of [
 { rawHeaders: ['Content-Type','application/json','Content-Type','application/json'] },
 { headers: { 'content-encoding': 'gzip' } }, { headers: { 'content-length': '1048577' } },
 { headers: { 'content-length': '1' } }, { headers: { 'content-length': 'invalid' } },
 { raw: '{malformed synthetic-private-credential' }, { raw: 'null' }, { raw: '[]' },
 { chunks: [Buffer.from([0xff])] }, { chunks: [Buffer.alloc(1048577)] },
 { chunks: ['not-a-buffer'] }, { rawHeaders: 'invalid' },
 { mode: 'connection' }, { mode: 'throw' }, { mode: 'aborted' }, { mode: 'close' }, { mode: 'responseError' },
]) test('protocol/size/JSON/connection error sanitized '+Object.keys(driver).join(',')+' '+(driver.mode??''), async () => {
 const h = loadAdapter({ driver }), b = binding(), x = h.api.openExecutionContext(b);
 await assert.rejects(h.api.executeHandoff(x, contextHandoff(b)), { message: 'Railway private HTTPS evidence unavailable' }); assert.equal(h.calls.length, 1); assert.equal(h.timers.size, 0);
});
test('absolute 10-second timeout destroys and makes no retry', async () => {
 const h = loadAdapter({ driver: { mode: 'timeout' } }), b = binding(), x = h.api.openExecutionContext(b), pending = h.api.executeHandoff(x, contextHandoff(b));
 assert.equal([...h.timers.values()][0].delay, 10000); h.fireTimeouts(); await assert.rejects(pending, { message: 'Railway private HTTPS evidence unavailable' }); assert(h.destroyed()>0); assert.equal(h.calls.length, 1);
});
test('schema-before-attestation consumes handoff and sends no request', async () => {
 const h = loadAdapter(), b = binding(), x = h.api.openExecutionContext(b), hand = schemaHandoff(plan.start(), b);
 await assert.rejects(h.api.executeHandoff(x, hand)); assert.equal(h.calls.length, 0); assert.throws(() => review.takeAdapterHandoff(hand, b));
});
for (const field of ['projectId', 'environmentId']) test('wrong context '+field+' consumes result/closes execution context', async () => {
 const body = { data: { projectToken: { projectId: 'synthetic-project', environmentId: 'synthetic-env', [field]: 'Other' } } };
 const h = loadAdapter({ driver: { body } }), b = binding(), x = h.api.openExecutionContext(b), result = await h.api.executeHandoff(x, contextHandoff(b));
 assert.throws(() => h.api.consumeContextResult(result)); assert.throws(() => h.api.consumeContextResult(result)); await assert.rejects(h.api.executeHandoff(x, contextHandoff(b))); assert.equal(h.calls.length, 1);
});
test('attestation consumes once; outputs hashes only and never global authority', async () => {
 const h = loadAdapter(), b = binding(), x = h.api.openExecutionContext(b), result = await h.api.executeHandoff(x, contextHandoff(b));
 assert.throws(() => h.api.consumeContextResult(normal(result))); assert.throws(() => h.api.consumeContextResult({ body: {}, authenticated: true }));
 const out = h.api.consumeContextResult(result); assert.equal(out.providerContextObserved, true); assert.equal(out.projectEnvironmentContextProven, true); assert.equal(out.serviceContextProven, false);
 assert(!JSON.stringify(out).includes('synthetic-project')); assert(!JSON.stringify(out).includes('synthetic-env')); assert(!JSON.stringify(out).includes('synthetic-private-credential'));
 assert.throws(() => h.api.consumeContextResult(result)); assert.equal(adapter.status.providerContextObserved, false); assert.equal(adapter.status.projectEnvironmentContextProven, false);
 for (const key of ['identity_proven','causality_proven','restart_origin_proven','platformRestart']) assert.equal(out[key], null);
 h.api.closeExecutionContext(x);
});
test('same credential lifetime reads once even when synthetic env changes', async () => {
 const env = { RAILWAY_TOKEN: 'synthetic-first-credential' }, h = loadAdapter({ env }), b = binding(), x = h.api.openExecutionContext(b);
 await attest(h,b,x); env.RAILWAY_TOKEN = 'synthetic-second-credential';
 const s = plan.start(), result = await h.api.executeHandoff(x, schemaHandoff(s,b)); h.api.consumeSchemaResult(result);
 assert.deepEqual(h.reads, ['RAILWAY_TOKEN']); assert(h.calls.every(call => call.options.headers['Project-Access-Token']==='synthetic-first-credential')); h.api.closeExecutionContext(x);
});
test('another execution context remains unattested; no transfer on close/reopen', async () => {
 const h = loadAdapter(), b = binding(), first = h.api.openExecutionContext(b), second = h.api.openExecutionContext(b); await attest(h,b,first);
 await assert.rejects(h.api.executeHandoff(second, schemaHandoff(plan.start(),b))); assert.equal(h.calls.length, 1);
 h.api.closeExecutionContext(first); const third = h.api.openExecutionContext(b); await assert.rejects(h.api.executeHandoff(third, schemaHandoff(plan.start(),b))); assert.equal(h.calls.length,1);
});
test('different valid original target cannot execute a handoff with identical IDs', async () => {
 const h = loadAdapter(), b = binding(), wrong = binding(), x = h.api.openExecutionContext(wrong), hand = contextHandoff(b);
 await assert.rejects(h.api.executeHandoff(x, hand)); assert.equal(h.calls.length,0); assert.throws(() => review.takeAdapterHandoff(hand,b));
});
test('result/context from separate module instance rejected by production and other VM', async () => {
 const h = loadAdapter(), other = loadAdapter(), b = binding(), x = h.api.openExecutionContext(b), result = await h.api.executeHandoff(x,contextHandoff(b));
 assert.throws(() => adapter.consumeContextResult(result)); assert.throws(() => other.api.consumeContextResult(result)); assert.throws(() => adapter.closeExecutionContext(x));
 assert.equal(h.api.consumeContextResult(result).projectEnvironmentContextProven,true); h.api.closeExecutionContext(x);
});
test('result consumers accept no caller body/session/target replacement', async () => {
 const h = loadAdapter(), b = binding(), x = h.api.openExecutionContext(b), contextResult = await h.api.executeHandoff(x,contextHandoff(b));
 assert.throws(() => h.api.consumeContextResult(contextResult, { data: {} })); h.api.consumeContextResult(contextResult);
 const original = plan.start(), other = plan.start(), schemaResult = await h.api.executeHandoff(x,schemaHandoff(original,b));
 assert.throws(() => h.api.consumeSchemaResult(schemaResult, other)); const out = h.api.consumeSchemaResult(schemaResult);
 assert.equal(out.root,'Query'); assert.equal(plan.evidence(original).root,'Query'); assert.equal(plan.evidence(other).root,null); assert.throws(() => h.api.consumeSchemaResult(schemaResult)); h.api.closeExecutionContext(x);
});
test('schema results follow original staged session and remain minimized/unready', async () => {
 const h = loadAdapter(), b = binding(), x = h.api.openExecutionContext(b), s = plan.start(); await attest(h,b,x);
 while (plan.next(s)) {
  const result = await h.api.executeHandoff(x,schemaHandoff(s,b)); const out = h.api.consumeSchemaResult(result);
  assert.equal(out.executionSchemaReady,false); assert(!JSON.stringify(out).includes('unrelatedRootField'));
 }
 assert.equal(plan.finish(s).stagedDiscoveryComplete,true); assert.equal(h.calls.length,4); h.api.closeExecutionContext(x);
});
test('stage changed while result pending burns result and closes context', async () => {
 const h = loadAdapter(), b = binding(), x = h.api.openExecutionContext(b), s = plan.start(); await attest(h,b,x);
 const result = await h.api.executeHandoff(x,schemaHandoff(s,b)); plan.accept(s,rootBody());
 assert.throws(() => h.api.consumeSchemaResult(result)); assert.throws(() => h.api.consumeSchemaResult(result)); await assert.rejects(h.api.executeHandoff(x,contextHandoff(b)));
});
test('wrong result consumer burns result and invalidates context', async () => {
 const h = loadAdapter(), b = binding(), x = h.api.openExecutionContext(b), result = await h.api.executeHandoff(x,contextHandoff(b));
 assert.throws(() => h.api.consumeSchemaResult(result)); assert.throws(() => h.api.consumeContextResult(result)); await assert.rejects(h.api.executeHandoff(x,contextHandoff(b)));
});
test('close invalidates unconsumed results and forbids new requests', async () => {
 const h = loadAdapter(), b = binding(), x = h.api.openExecutionContext(b), result = await h.api.executeHandoff(x,contextHandoff(b));
 h.api.closeExecutionContext(x); assert.throws(() => h.api.consumeContextResult(result)); await assert.rejects(h.api.executeHandoff(x,contextHandoff(b))); assert.equal(h.calls.length,1);
 h.api.closeExecutionContext(x); // Idempotent for the original closed handle.
});
test('close during active request aborts/destroys and releases deadline', async () => {
 const h = loadAdapter({ driver: { mode:'timeout' } }), b = binding(), x = h.api.openExecutionContext(b), pending = h.api.executeHandoff(x,contextHandoff(b));
 h.api.closeExecutionContext(x); await assert.rejects(pending); assert(h.destroyed()>0); assert.equal(h.timers.size,0);
});
test('no parallel/unconsumed-result requests or public transport options', async () => {
 const h = loadAdapter(), b = binding(), x = h.api.openExecutionContext(b), result = await h.api.executeHandoff(x,contextHandoff(b));
 await assert.rejects(h.api.executeHandoff(x,contextHandoff(b))); assert.equal(h.calls.length,1); h.api.consumeContextResult(result);
 await assert.rejects(h.api.executeHandoff(x,schemaHandoff(plan.start(),b), { transport:()=>{}, timeout:1, headers:{} })); assert.equal(h.calls.length,1); h.api.closeExecutionContext(x);
});
test('global current state and 0107/0108 historical state stay false/null', () => {
 assert.equal(adapter.status.adapterImplemented,true); assert.equal(adapter.status.executionSchemaReady,false); assert.equal(adapter.status.serviceContextProven,false);
 for (const key of ['identity_proven','causality_proven','restart_origin_proven','platformRestart']) assert.equal(adapter.status[key],null);
 assert.deepEqual(adapter.status.restartAttribution,{measurement:null,limitation:'restart_origin_unattributable'});
 assert.equal(preflight.contract.outcome,'TRANSPORT_NOT_READY'); assert.equal(require('../../scripts/assessment-worker/qualification-railway-transport-contract.cjs').contract.providerContextObserved,false);
});
test('provider GraphQL errors consume context result and never attest', async () => {
 const h = loadAdapter({ driver: { body: { data: { projectToken: { projectId: 'synthetic-project', environmentId: 'synthetic-env' } }, errors: [{ message: 'synthetic-private-credential' }] } } });
 const b = binding(), x = h.api.openExecutionContext(b), result = await h.api.executeHandoff(x,contextHandoff(b));
 assert.throws(() => h.api.consumeContextResult(result), { message:'Railway private HTTPS evidence unavailable' }); assert.throws(() => h.api.consumeContextResult(result));
 await assert.rejects(h.api.executeHandoff(x,schemaHandoff(plan.start(),b))); assert.equal(h.calls.length,1);
});
test('invalid schema body consumes result without advancing the original session', async () => {
 const driver = {}, h = loadAdapter({ driver }), b = binding(), x = h.api.openExecutionContext(b), s = plan.start(); await attest(h,b,x);
 driver.body = { data: {}, errors: [{ message:'synthetic-private-credential' }] };
 const result = await h.api.executeHandoff(x,schemaHandoff(s,b)); assert.throws(() => h.api.consumeSchemaResult(result)); assert.equal(plan.evidence(s).root,null); assert.throws(() => h.api.consumeSchemaResult(result));
});
test('same context cannot repeat context attestation after successful consumption', async () => {
 const h = loadAdapter(), b = binding(), x = h.api.openExecutionContext(b); await attest(h,b,x);
 await assert.rejects(h.api.executeHandoff(x,contextHandoff(b))); assert.equal(h.calls.length,1);
});
test('serialized and caller-assembled handoff cannot execute or mint a result', async () => {
 for (const make of [hand => normal(hand), () => ({ kind:'context', request:context.buildRequest(), body:rootBody() })]) {
  const h = loadAdapter(), b = binding(), x = h.api.openExecutionContext(b), hand = contextHandoff(b);
  await assert.rejects(h.api.executeHandoff(x,make(hand))); assert.equal(h.calls.length,0);
 }
});
test('a forged extra-argument consumer call never exposes private body or token', async () => {
 const h = loadAdapter(), b = binding(), x = h.api.openExecutionContext(b), result = await h.api.executeHandoff(x,contextHandoff(b));
 assert.throws(() => h.api.consumeContextResult(result, { target:binding(), token:'synthetic-replacement' }), { message:'Railway private HTTPS evidence unavailable' });
 assert(!JSON.stringify(h.api.consumeContextResult(result)).includes('synthetic-private-credential')); h.api.closeExecutionContext(x);
});
test('NODE_DEBUG presence rejects before any credential value read', () => {
 let reads = 0; const env = {};
 Object.defineProperty(env,'NODE_DEBUG',{ enumerable:true, get(){ reads++; throw Error('Do not read diagnostic value'); } });
 Object.defineProperty(env,'RAILWAY_TOKEN',{ enumerable:true, get(){ reads++; throw Error('Do not read credential value'); } });
 const h = loadAdapter({ env }); assert.throws(() => h.api.openExecutionContext(binding()), { message:'Railway private HTTPS evidence unavailable' }); assert.equal(reads,0); assert.deepEqual(h.reads,[]);
});
test('already-enabled native logger state rejects even without an env key', () => {
 const h = loadAdapter({ driver:{ debugEnabled:true } }); assert.throws(() => h.api.openExecutionContext(binding())); assert.deepEqual(h.reads,[]); assert.equal(h.calls.length,0);
});
test('diagnostics enabled after context opening fail before header construction', async () => {
 const driver = {}, h = loadAdapter({ driver }), b = binding(), x = h.api.openExecutionContext(b);
 driver.debugEnabled = true; await assert.rejects(h.api.executeHandoff(x,contextHandoff(b))); assert.equal(h.calls.length,0); assert.equal(h.timers.size,0);
});
test('adding NODE_DEBUG during a lifetime prevents a new native request without value reads', async () => {
 const env = {RAILWAY_TOKEN:'synthetic-private-credential'}, h = loadAdapter({ env }), b = binding(), x = h.api.openExecutionContext(b); await attest(h,b,x);
 Object.defineProperty(env,'NODE_DEBUG',{ enumerable:true, get(){ throw Error('Forbidden value read'); } });
 await assert.rejects(h.api.executeHandoff(x,schemaHandoff(plan.start(),b))); assert.equal(h.calls.length,1); assert.deepEqual(h.reads,['RAILWAY_TOKEN']);
});
