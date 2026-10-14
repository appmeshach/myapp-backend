'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), { EventEmitter } = require('node:events');
const base = path.resolve(__dirname, '../../../scripts/assessment-worker');
const targets = require(path.join(base, 'qualification-railway-introspection-target.cjs'));
const reviews = require(path.join(base, 'qualification-railway-context-review.cjs'));
const keys = ['qualification-railway-https-adapter.cjs', 'qualification-railway-target-identity.cjs', 'qualification-railway-target-identity-provider-boundary.cjs'];
const scope = { environmentKind: 'disposable', lifecycle: 'active', projectId: 'synthetic-project', environmentId: 'synthetic-env', serviceId: 'synthetic-service', serviceInstanceId: null };
const binding = () => targets.bindTarget(scope, scope, { inventoryReviewed: true, projectIds: [], environmentIds: [], serviceIds: [], serviceInstanceIds: [] });
const clone = v => JSON.parse(JSON.stringify(v));
function serviceBody() { return { data: { project: { id: scope.projectId, services: { edges: [{ node: { id: scope.serviceId, name: 'myapp-backend' } }], pageInfo: { hasNextPage: false } } } } }; }
function loadServices(driver = {}) {
 const cache = new Map(), records = [], calls = [], reads = [], timers = new Map(); let ownerOverride = null;
 class CapturedWeakMap extends WeakMap { set(key, value) { records.push({ key, value }); return super.set(key, value); } }
 const env = new Proxy({ RAILWAY_TOKEN: 'synthetic-private-credential' }, { get(target, key) { reads.push(key); return target[key]; } });
 const https = { request(options, callback) {
  const call = { options, request: null, destroyed: false }; calls.push(call);
  const req = new EventEmitter(); req.destroy = () => { call.destroyed = true; }; call.req = req;
  req.end = text => {
   call.request = JSON.parse(text);
   const respond = () => {
    if (call.destroyed) return;
    if (driver.mode === 'error' && call.request.operationName === 'Movement0111ProjectServices') { req.emit('error', Error('synthetic raw transport failure')); return; }
    const res = new EventEmitter(); res.statusCode = call.request.operationName === 'Movement0111ProjectServices' ? driver.status ?? 200 : 200;
    res.headers = { 'content-type': 'application/json' }; res.rawHeaders = ['Content-Type', 'application/json']; res.destroy = () => { call.destroyed = true; };
    callback(res); if (call.destroyed) return;
    const body = call.request.operationName === 'Movement0108ProjectTokenContext'
     ? { data: { projectToken: { projectId: scope.projectId, environmentId: scope.environmentId } } }
     : driver.body ?? serviceBody();
    res.emit('data', Buffer.from(driver.raw && call.request.operationName === 'Movement0111ProjectServices' ? driver.raw : JSON.stringify(body)));
    res.emit('end'); res.emit('close');
   };
   call.respond = respond;
   if (!(driver.hold && call.request.operationName === 'Movement0111ProjectServices')) queueMicrotask(respond);
  }; return req;
 } };
 function load(key) {
  if (cache.has(key)) return cache.get(key).exports;
  const module = { exports: {} }; cache.set(key, module);
  vm.runInNewContext(fs.readFileSync(path.join(base, key), 'utf8'), { module, Buffer, WeakMap: CapturedWeakMap, process: { env },
   setTimeout(fn, ms) { const t = {}; timers.set(t, { fn, ms }); return t; }, clearTimeout(t) { timers.delete(t); },
   require(name) {
    if (name === 'node:https') return https;
    if (name === 'node:util') return { TextDecoder: require('node:util').TextDecoder, debuglog: () => ({ enabled: false }) };
    if (name.startsWith('./')) { const dep = name.slice(2); if (dep === keys[1] && ownerOverride) return ownerOverride;
     return keys.includes(dep) ? load(dep) : require(path.join(base, dep)); }
    return require(name);
   } }, { filename: path.join(base, key) });
  return module.exports;
 }
 const identity = load(keys[1]), adapter = load(keys[0]), ingress = load(keys[2]);
 return { identity, adapter, ingress, calls, reads, timers, records, driver, replaceOwner(value) { ownerOverride = value; },
  contextRecord(handle) { return records.find(r => r.key === handle && Object.hasOwn(r.value, 'secret'))?.value; },
  sessionRecord(handle) { return records.find(r => r.key === handle && Object.hasOwn(r.value, 'candidate'))?.value; },
  resultRecord(handle) { return records.find(r => r.key === handle && Object.hasOwn(r.value, 'body'))?.value; },
  transferRecord(handle) { return records.find(r => r.key === handle && Object.hasOwn(r.value, 'attestation'))?.value; },
  fireTimeouts() { for (const t of [...timers.values()]) t.fn(); }
 };
}
function opened(driver) { const f = loadServices(driver), target = binding(), session = f.identity.startTargetIdentitySession(target), execution = f.adapter.openExecutionContext(target); return { ...f, target, session, execution }; }
async function contextResult(driver) {
 const f = opened(driver), r = reviews.reviewProjectTokenContext(f.target);
 f.contextHand = reviews.consumeProjectTokenContextPermitForAdapter(reviews.approveProjectTokenContextReview(r, { ...r.meta, reviewed: true }), f.target);
 const p = f.identity.contextTransfer.preparePermit(f.session, f.target, f.execution, f.contextHand);
 f.contextBinding = f.adapter.bindContextResultTransfer(f.execution, f.contextHand, p);
 f.contextResult = await f.adapter.executeHandoff(f.execution, f.contextHand); return f;
}
async function attested(driver) {
 const f = await contextResult(driver); f.contextReceipt = f.adapter.prepareContextResultTransfer(f.contextResult, f.contextBinding);
 f.identity.acceptContextObservation(f.session, f.contextReceipt); return f;
}
function identityHand(f, session = f.session) {
 const r = f.identity.reviewNextIdentityRequest(session), p = f.identity.approveIdentityReview(r, { ...r.meta, reviewed: true });
 return f.identity.consumeIdentityPermitForFutureAdapter(p, session);
}
async function bound(driver) { const f = await attested(driver); f.hand = identityHand(f); f.transfer = f.adapter.bindProjectServicesTransfer(f.execution, f.session, f.hand); return f; }
async function resulted(driver) { const f = await bound(driver); f.result = await f.adapter.executeProjectServices(f.transfer); return f; }
async function prepared(driver) { const f = await resulted(driver); f.bundle = f.adapter.prepareProjectServicesResult(f.result, f.transfer); return f; }
module.exports = { scope, binding, clone, serviceBody, loadServices, opened, contextResult, attested, identityHand, bound, resulted, prepared };
