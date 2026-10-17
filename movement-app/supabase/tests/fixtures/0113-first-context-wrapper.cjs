'use strict';
// TEST ONLY: private owners share one isolated graph, never normal capabilities.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { EventEmitter } = require('node:events');
const base = path.resolve(__dirname, '../../../scripts/assessment-worker');
const names = { auth: 'qualification-railway-live-authorization.cjs', wrapper: 'qualification-railway-first-context-wrapper.cjs',
 adapter: 'qualification-railway-https-adapter.cjs', identity: 'qualification-railway-target-identity.cjs',
 targets: 'qualification-railway-introspection-target.cjs', reviews: 'qualification-railway-context-review.cjs' };
const clone = v => JSON.parse(JSON.stringify(v));
function loadWrapper(options = {}) {
 const cache = new Map(), records = [], trace = [], reads = [], calls = [], gitCalls = [], timers = new Map();
 const drift = { head: 'a'.repeat(40), branch: 'feature/0092-shared-segment-suitability', files: new Map() };
 const handles = {}, counts = {};
 class CapturedWeakMap extends WeakMap { set(key, value) { records.push({ key, value }); return super.set(key, value); } }
 const env = new Proxy({ RAILWAY_TOKEN: 'synthetic-0113-private-token' }, { get(target, key) { reads.push(key); trace.push('tokenRead'); return target[key]; } });
 const https = { request(config, callback) {
  trace.push('https'); const req = new EventEmitter(); req.destroy = () => {};
  req.end = text => {
   calls.push({ config, request: JSON.parse(text) });
   queueMicrotask(() => {
    if (options.httpsFailure) { req.emit('error', Error('synthetic raw error')); return; }
    const res = new EventEmitter(); res.destroy = () => {}; res.statusCode = 200;
    res.headers = { 'content-type': 'application/json' }; res.rawHeaders = ['Content-Type', 'application/json']; callback(res);
    const body = options.body ?? { data: { projectToken: { projectId: 'synthetic-project', environmentId: 'synthetic-env' } } };
    res.emit('data', Buffer.from(JSON.stringify(body))); res.emit('end'); res.emit('close');
   });
  }; return req;
 } };
 const fakeFs = { existsSync: fs.existsSync, readFileSync(name, encoding) { return drift.files.has(name) ? drift.files.get(name) : fs.readFileSync(name, encoding); } };
 const fakeCp = { execFileSync(command, args, settings) {
  if (command !== 'git' || settings.shell !== false || Object.keys(settings.env).length) throw Error('Unexpected subprocess');
  const operation = args.slice(2).join(' '); gitCalls.push(operation);
  if (operation === 'rev-parse HEAD') return drift.head + '\n';
  if (operation === 'branch --show-current') return drift.branch + '\n';
  throw Error('Unexpected subprocess');
 } };
 function instrument(label, fn) {
  return (...args) => {
   trace.push(label); counts[label] = (counts[label] ?? 0) + 1;
   if (label === 'close' && options.closeBeforeFailure) throw Error('synthetic close failed before invalidation');
   if (label === 'accept' && options.acceptNoAdvance) return { stage: 'project_services' };
   if (options.fail === label && label !== 'authority' && label !== 'close') throw Error('synthetic sensitive failure');
   const result = fn(...args);
   if (label === 'authority') {
    trace.push('authorityConsumed');
    if (options.fail === label) throw Error('synthetic authority failure');
    return options.wrongOperation ? { ...result, operationKind: 'schema' } : result;
   }
   if (label === 'close' && options.fail === 'close') throw Error('synthetic cleanup failure');
   if (['open', 'session', 'permit', 'bind', 'transfer'].includes(label)) handles[label] = result;
   if (label === 'inspect') {
    const status = clone(result); options.editStatus?.(status); return status;
   }
   return result;
  };
 }
 function facade(key) {
  const api = load(key);
  if (key === names.auth) return { ...api, takeFirstContextExecutionAuthority: instrument('authority', api.takeFirstContextExecutionAuthority) };
  if (key === names.adapter) return { ...api, openExecutionContext: instrument('open', api.openExecutionContext),
   bindContextResultTransfer: instrument('bind', api.bindContextResultTransfer), executeHandoff: instrument('execute', api.executeHandoff),
   prepareContextResultTransfer: instrument('transfer', api.prepareContextResultTransfer), closeExecutionContext: instrument('close', api.closeExecutionContext) };
  if (key === names.identity) return { ...api, startTargetIdentitySession: instrument('session', api.startTargetIdentitySession),
   contextTransfer: { ...api.contextTransfer, preparePermit: instrument('permit', api.contextTransfer.preparePermit) },
   acceptContextObservation: instrument('accept', api.acceptContextObservation), inspectSession: instrument('inspect', api.inspectSession),
   reviewTargetCandidate: options.candidate ? () => { trace.push('candidate'); return {}; } : instrument('candidate', api.reviewTargetCandidate) };
  throw Error('Unexpected wrapper import');
 }
 function load(key) {
  if (cache.has(key)) return cache.get(key).exports;
  const module = { exports: {} }; cache.set(key, module);
  const sandbox = { module, Buffer, WeakMap: CapturedWeakMap, __dirname: base, __filename: path.join(base, key), process: { env },
   setTimeout(fn, ms) { const handle = {}; timers.set(handle, { fn, ms }); return handle; }, clearTimeout(handle) { timers.delete(handle); },
   require(name) {
    if (name === 'node:fs') return fakeFs;
    if (name === 'node:child_process') return fakeCp;
    if (name === 'node:https') return https;
    if (name === 'node:util') return { TextDecoder: require('node:util').TextDecoder, debuglog: () => ({ enabled: false }) };
    if (name === './qualification-railway-acquisition-owner-host.cjs') return Object.freeze({outcome:'PRELIVE_NOT_AUTHORIZED',executableOwnerAvailable:false});
    if (name.startsWith('./')) return key === names.wrapper ? facade(name.slice(2)) : load(name.slice(2));
    if (!['node:path', 'node:crypto', 'node:perf_hooks'].includes(name)) throw Error('Unexpected builtin: ' + name);
    return require(name);
   } };
  vm.runInNewContext(fs.readFileSync(path.join(base, key), 'utf8'), sandbox, { filename: path.join(base, key) }); return module.exports;
 }
 const auth = load(names.auth), adapter = load(names.adapter), identity = load(names.identity), targets = load(names.targets), wrapper = load(names.wrapper);
 function prepared() {
  const scope = { environmentKind: 'disposable', lifecycle: 'active', projectId: 'synthetic-project', environmentId: 'synthetic-env', serviceId: 'synthetic-service', serviceInstanceId: null };
  const categories = ['projectIds', 'environmentIds', 'serviceIds', 'serviceInstanceIds'];
  const target = targets.bindTarget(scope, scope, { inventoryReviewed: true, ...Object.fromEntries(categories.map(k => [k, []])) });
  const inventory = { inventoryReviewed: true, ...Object.fromEntries(categories.map(k => [k, { reviewed: true, ids: [] }])) };
  const draft = auth.createDraft(target, inventory, { reviewedHead: drift.head, reviewedBranch: drift.branch });
  const artifact = auth.reviewArtifact(draft), m = artifact.manifest;
  const ack = { reviewed: true, manifestSha256: artifact.manifestSha256, targetReview: clone(m.targetReview), inventoryReview: clone(m.forbiddenRailwayInventory),
   codeReview: { reviewed: true, ...clone(m.codeIdentity) }, contextReview: { reviewed: true, ...clone(artifact.contextReviewMetadata) },
   hostChecklist: { nodeMajor: 24, ...Object.fromEntries(artifact.hostAttestationKeys.filter(k => k !== 'nodeMajor').map(k => [k, true])) } };
  return { target, draft, artifact, ack };
 }
 function authorized() {
  const { target, draft, artifact, ack } = prepared();
  const reviewed = auth.reviewPackage(draft, target, ack);
  const ticket = auth.authorizeFirstLiveContext(draft, target, { ...reviewed.finalAcknowledgementTemplate, manualLiveAuthorization: true });
  return { target, ticket, draft, artifact, ack, authority: auth.consumeLiveTicketForContext(ticket, target, artifact.manifest, 'project_token_context') };
 }
 return { auth, adapter, identity, targets, wrapper, prepared, authorized, drift, trace, reads, calls, gitCalls, timers, records, handles, counts,
  contextRecord: () => records.find(e => e.key === handles.open && Object.hasOwn(e.value, 'secret'))?.value,
  sessionRecord: () => records.find(e => e.key === handles.session && Object.hasOwn(e.value, 'candidate'))?.value,
  authorityRecord: authority => records.find(e => e.key === authority && Object.hasOwn(e.value, 'record'))?.value };
}
module.exports = { loadWrapper };
