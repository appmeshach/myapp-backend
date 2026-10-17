'use strict';
// Local preflight only: no credential reader, network/CLI adapter call or schema
// authorization. Live tickets are exercised only in isolated synthetic tests.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), cp = require('node:child_process');
const { performance } = require('node:perf_hooks');
const targets = require('./qualification-railway-introspection-target.cjs');
const context = require('./qualification-railway-project-token-context.cjs');
const reviews = require('./qualification-railway-context-review.cjs');
const identity = require('./qualification-railway-target-identity.cjs');
const adapter = require('./qualification-railway-https-adapter.cjs');
// Historical implementation parent only; never current/reviewed HEAD authority.
const BASELINE_PARENT_HEAD = '7c2346ce73d12e571b5ff8506fd8d02be48f44b7';
const BRANCH = 'feature/0092-shared-segment-suitability';
const ROOT = path.resolve(__dirname, '../..');
const REPOSITORY = fs.existsSync(path.join(ROOT, '.git')) ? ROOT : path.resolve(ROOT, '..');
const DATE_NOW = Date.now.bind(Date), MONO_NOW = performance.now.bind(performance);
const MAX_LIFECYCLE_ENTRIES = 64, MAX_LIFECYCLE_BYTES = 16384;
const POLICY_PATH = 'docs/0114i-qualification-lifecycle-policy-design.md';
const APPROVED_LIFECYCLE_POLICY_SHA256 = '29a51ba9633c9b734e833b38b754e3d5000f9c76661a277f19093f22d5be12e5';
const freeze = v => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
const fail = () => { throw Error('Railway first-live preflight unavailable'); };
const hash = v => crypto.createHash('sha256').update(v, 'utf8').digest('hex');
function canonical(v) {
 if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
 if (v && typeof v === 'object') {
  dataKeys(v);
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
 }
 return JSON.stringify(v);
}
function dataKeys(v) {
 for (const key of Reflect.ownKeys(v)) {
  const descriptor = Object.getOwnPropertyDescriptor(v, key);
  if (typeof key !== 'string' || !descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail();
 }
}
function exact(v, keys) {
 if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).sort().join('|') !== keys.slice().sort().join('|')) fail();
 dataKeys(v); // Reject hidden/symbol fields and getters without reading them.
}
const SOURCE_HASHES = freeze({
 'qualification-railway-acquisition-owner-host.cjs': '17b3a74ac9a421c783876f5255fc02d5bffe2299efb2a53495f07f263a663bea',
 'qualification-railway-acquisition-wrapper.cjs': '1130c5df6c2ec6142f983beead413db9693e329345afbacc2049f685e62b21b2',
 'qualification-railway-first-context-wrapper.cjs': '7c3a376d1f7a1b733f3be90a3b7d43fb4aa2fd5256c5638a13e6301a3d78cf94',
 'qualification-railway-https-adapter.cjs': 'aebb9446b82d9785dc60dd298f1302927909ad5839a3641fcb7ebc59107d971e',
 'qualification-railway-target-identity.cjs': '01304d6d9bc4562fb4a0d7213591c43688770bc7fa440de1887e7bc93a587271',
 'qualification-railway-target-identity-provider-boundary.cjs': 'cf22b4ce9d68b36fa6c325f289661528fcfb6ec8e75d6acad9af5429be53e1df',
 'qualification-railway-context-review.cjs': '23fb65eef738136b68b3d8ce19a69e51482f9bc075c6a26940e2300108c6dd0f',
 'qualification-railway-introspection-preflight.cjs': '88fe296bd5bfaa639844436c031dbdc674f29c25fbab3530081317143b3c9d74',
 'qualification-railway-project-token-context.cjs': 'cd862abc5b85b8663fbc1075263c0b5d3c6d05793a31e875db67457f4adb3085',
 'qualification-railway-transport-contract.cjs': '33101241797b778067e2c44389c22c6b236e0f741e7565feae4cf8607e8b26de',
 'qualification-railway-introspection-target.cjs': '2c236cc1a077fea457938b4317afd7488de010f725ec0a5463fb52d0ab12d199',
 'qualification-railway-introspection-request.cjs': '62342054302e6f487708b85372b5f2cac7c1449e69ce3c25b0d142c1d4324ae3',
 'qualification-railway-introspection-plan.cjs': 'dacaf8a4aaecff254760da0c687ccc78b3569b7e5449d1a919ba4170d18fc0e3',
});
function sourceHash(file) {
 const text = fs.readFileSync(file, 'utf8'); if (Buffer.byteLength(text, 'utf8') > 1024 * 1024) fail();
 return hash(text.replace(/\r\n/g, '\n')); // No trim, BOM stripping or EOF edits.
}
const OWN_SOURCE_AT_LOAD = sourceHash(__filename);
const state = freeze({ outcome: 'PRELIVE_NOT_AUTHORIZED', ...adapter.status, manualLiveAuthorizationRequired: true });
const crossSystemForbidden = freeze({ provider: 'Supabase', identifierKind: 'project_ref',
 production: 'xdfmoggrsucisfybqctb', inactive: 'udlsysezmzutydnifhsq', consumedHistoricalDisposable: 'uzkhnslyrhgucijcuoes',
 railwayNamespace: false, newQualificationAuthorized: false });
const labels = freeze({ category: 'historical_operator_labels_only', projectName: 'thorough-blessing', serviceName: 'myapp-backend',
 branch: BRANCH, rootDirectory: '/movement-app', nodeSetting: 'RAILPACK_NODE_VERSION=24', historicalRegion: 'europe-west4-drams3a' });
function verifySources() {
 for (const [file, expected] of Object.entries(SOURCE_HASHES)) if (sourceHash(path.join(__dirname, file)) !== expected) fail();
 if (sourceHash(__filename) !== OWN_SOURCE_AT_LOAD) fail();
 context.buildRequest();
 return freeze({ baselineParentHead: BASELINE_PARENT_HEAD, sourceHashes: SOURCE_HASHES, authorizationBoundarySha256: OWN_SOURCE_AT_LOAD,
  canonicalSourceRule: 'UTF-8; CRLF to LF only; preserve all other bytes and EOF' });
}
function verifyCodeIdentity(...args) {
 if (args.length !== 1) fail();
 const reviewedCode = args[0]; exact(reviewedCode, ['reviewedHead', 'reviewedBranch']);
 if (typeof reviewedCode.reviewedHead !== 'string' || reviewedCode.reviewedHead.length !== 40 ||
  !/^[a-f0-9]{40}$/.test(reviewedCode.reviewedHead) || reviewedCode.reviewedBranch !== BRANCH) fail();
 const reviewedHead = reviewedCode.reviewedHead, reviewedBranch = reviewedCode.reviewedBranch;
 let sources;
 try {
  // Qualification/preflight Git only, never the 0109 adapter. Empty child env
  // prevents inheritance/copying of any credential environment values.
  /** @type {import('node:child_process').ExecFileSyncOptionsWithStringEncoding} */
  const options = { cwd: ROOT, encoding: 'utf8', env: {}, shell: false, windowsHide: true, timeout: 5000, maxBuffer: 4096, stdio: ['ignore', 'pipe', 'pipe'] };
  if (!fs.existsSync(path.join(REPOSITORY, '.git'))) fail();
  const trust = ['-c', 'safe.directory=' + REPOSITORY]; // Exact local repo, no config write.
  if (cp.execFileSync('git', [...trust, 'rev-parse', 'HEAD'], options).trim() !== reviewedHead ||
   cp.execFileSync('git', [...trust, 'branch', '--show-current'], options).trim() !== reviewedBranch) fail();
  sources = verifySources();
 } catch { fail(); }
 return freeze({ ...sources, reviewedHead, reviewedBranch });
}
const CATEGORIES = ['projectIds', 'environmentIds', 'serviceIds', 'serviceInstanceIds'];
const HOST_KEYS = ['normalReviewedAdapter', 'noNodeDebugEnvironment', 'nativeHttpHttpsDebugDisabled', 'noRailwayApiTokenPresence',
 'tokenProvisionedPrivatelyOutsideCodex', 'noTokenInArgv', 'noTokenInCommandHistory', 'noTokenInOutput', 'noTokenInArtifacts',
 'noTokenSharedInChat', 'noProxyOverride', 'certificateVerificationEnabled', 'firstRequestContextOnly', 'stopOnError',
 'noRetryOrFallback', 'noSchemaBeforeSameContextAttestation'];
const drafts = new WeakMap(), tickets = new WeakMap(), authorities = new WeakMap();
// Process-local B1 admission state. These tables and every operation over them are
// deliberately private; a process restart requires a fresh reviewed assertion.
const admissionByAssertionKey = new Map(), attemptReferenceIndex = new Map();
let utcHighWater = null, clockFault = false, executableEnabled = false,
 hostRevoked = false, hostAssociation = null, wrapperSetup = null, adapterAssociate = null,
 closedMarkerSweepTimer = null, closedMarkerSweepDeadline = null, closedMarkerSweepGeneration = Object.freeze({});
function cancelClosedMarkerSweep() {
 if (closedMarkerSweepTimer) clearTimeout(closedMarkerSweepTimer);
 closedMarkerSweepTimer = null; closedMarkerSweepDeadline = null; closedMarkerSweepGeneration = Object.freeze({});
}
function clocks() {
 const u = DATE_NOW(), m = MONO_NOW();
 if (!Number.isSafeInteger(u) || !Number.isFinite(m) || m < 0 || (utcHighWater !== null && u < utcHighWater)) {
  clockFault = true; cancelClosedMarkerSweep();
  for (const e of admissionByAssertionKey.values()) closeLifecycle(e, 'clock_fault', false);
  fail();
 }
 utcHighWater = u; return { u, m };
}
function armClosedMarkerSweep(u) {
 if (clockFault || hostRevoked) { cancelClosedMarkerSweep(); return; }
 let nearest = null;
 for (const e of admissionByAssertionKey.values()) if (e.state === 'closed' && (nearest === null || e.expiresAtMs < nearest)) nearest = e.expiresAtMs;
 if (nearest === null) { cancelClosedMarkerSweep(); return; }
 if (closedMarkerSweepTimer && closedMarkerSweepDeadline === nearest) return;
 cancelClosedMarkerSweep();
 const generation = Object.freeze({}); closedMarkerSweepGeneration = generation; closedMarkerSweepDeadline = nearest;
 closedMarkerSweepTimer = setTimeout(() => {
  if (closedMarkerSweepGeneration !== generation) return;
  closedMarkerSweepTimer = null; closedMarkerSweepDeadline = null;
  let sample; try { sample = clocks(); } catch { return; }
  sweepExpired(sample.u);
 }, Math.min(Math.max(nearest - u, 0), 0x7fffffff));
}
function refreshClosedMarkerSweep() {
 if (clockFault || hostRevoked) { cancelClosedMarkerSweep(); return; }
 let sample; try { sample = clocks(); } catch { return; }
 sweepExpired(sample.u);
}
function closeLifecycle(e, reason, refreshOwner = true) {
 if (!e || e.state === 'closed') return false;
 e.state = 'closed'; e.closeReason = reason;
 if (e.expiryTimer) { clearTimeout(e.expiryTimer); e.expiryTimer = null; }
 for (const pool of [e.drafts,e.reviews,e.tickets,e.permits]) { for (const h of pool) pool.delete ? pool.delete(h) : null; pool.clear(); }
 const stop = e.stopRun; e.stopRun = null;
 try { if (stop) stop(); } finally { e.carrier = null; e.originalDraftEntry = null; if (refreshOwner) refreshClosedMarkerSweep(); }
 return true;
}
function sweepExpired(u) {
 for (const [key,e] of admissionByAssertionKey) if (u >= e.expiresAtMs) {
  closeLifecycle(e,'expired',false); admissionByAssertionKey.delete(key); attemptReferenceIndex.delete(e.attemptReference);
 }
 armClosedMarkerSweep(u);
}
function lifecycleFence(e, mode = 'claimed') {
 const {u,m}=clocks();
 if (!executableEnabled || hostRevoked || clockFault || !e ||
  (mode === 'claimed' ? e.state !== 'claimed' : e.state !== 'closed' || e.closeReason !== 'success') ||
  u >= e.expiresAtMs || m >= e.monoDeadline) fail();
 return true;
}
function scheduleLifecycle(e) {
 const {u,m}=clocks(), wait=Math.min(e.expiresAtMs-u,e.monoDeadline-m);
 if (!(wait>0)) { closeLifecycle(e,'expired'); return; }
 e.expiryTimer=setTimeout(()=>{e.expiryTimer=null;try{lifecycleFence(e);}catch{closeLifecycle(e,'expired');return;}scheduleLifecycle(e);},Math.min(wait,0x7fffffff));
}
function createCarrier(e) {
 const carrier=Object.freeze(Object.assign(Object.create(null),{
  check(){ lifecycleFence(e); },
  close(reason){ closeLifecycle(e,typeof reason==='string'?reason:'closed'); },
  attachRun(stop){ if(e.state!=='claimed'||e.stopRun||typeof stop!=='function')fail();e.stopRun=stop;lifecycleFence(e); },
  complete(){ lifecycleFence(e);closeLifecycle(e,'success'); },
  release(){ lifecycleFence(e,'completed'); }
 }));
 e.carrier=carrier; return carrier;
}
function requireExecutableHost() { if (!executableEnabled || hostRevoked || !hostAssociation) fail(); }
function identifier(v) {
 if (typeof v !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v) || /sb_secret_|^eyJ|privatekey|railway.*token/i.test(v)) fail(); return v;
}
function inventory(value, target) {
 exact(value, ['inventoryReviewed', ...CATEGORIES]); if (value.inventoryReviewed !== true) fail();
 const out = { inventoryReviewed: true };
 for (const category of CATEGORIES) {
  const entry = value[category]; exact(entry, ['reviewed', 'ids']);
  if (entry.reviewed !== true || !Array.isArray(entry.ids) || entry.ids.length > 256 || new Set(entry.ids).size !== entry.ids.length) fail();
  entry.ids.forEach(identifier);
  const actual = target[category.slice(0, -1)]; if (actual !== null && entry.ids.includes(actual)) fail();
  out[category] = { reviewed: true, ids: entry.ids.slice() };
 }
 return freeze(out);
}
function operationFacts(codeIdentity) {
 return freeze({ version: 'movement_railway_live_auth_v1', operationKind: 'project_token_context',
  operationName: 'Movement0108ProjectTokenContext', querySha256: context.canonicalSha256,
  endpoint: 'https://backboard.railway.com/graphql/v2', method: 'POST', authKind: 'project_token', authHeaderName: 'Project-Access-Token',
  authSourceName: 'RAILWAY_TOKEN', forbiddenAuthSourceName: 'RAILWAY_API_TOKEN', redirectPolicy: 'reject', retries: 0,
  timeoutMs: 10000, maxBodyBytes: 1048576, maxHeaderBytes: 16384, acceptedStatus: 200,
  baselineParentHead: BASELINE_PARENT_HEAD, reviewedHead: codeIdentity.reviewedHead, reviewedBranch: codeIdentity.reviewedBranch,
  expectedBranch: BRANCH, codeIdentity, authority: state, manualLiveAuthorizationRequired: true });
}
function createDraft(...args) {
 if (args.length !== 3) fail();
 const [binding, forbidden, reviewedCode] = args; let target;
 try { target = targets.describeTarget(binding); } catch { fail(); }
 const reviewedInventory = inventory(forbidden, target), codeIdentity = verifyCodeIdentity(reviewedCode);
 const targetReview = freeze({ category: 'operator_plan_constraints', requiredForFirstContext: { projectId: target.projectId, environmentId: target.environmentId },
  qualificationConstraints: { serviceId: target.serviceId, serviceInstanceId: target.serviceInstanceId }, environmentKind: target.environmentKind,
  lifecycle: target.lifecycle, independentlyAuthoritative: false });
 const contextReview = reviews.reviewProjectTokenContext(binding);
 const manifest = freeze({ ...operationFacts(codeIdentity), targetReview, forbiddenRailwayInventory: reviewedInventory, crossSystemForbidden });
 const draft = Object.freeze({});
 drafts.set(draft, { binding, manifest, contextReview, codeIdentity,
  reviewedCode: freeze({ reviewedHead: codeIdentity.reviewedHead, reviewedBranch: codeIdentity.reviewedBranch }),
  reviewedInventory, targetReview, reviewAck: null, handoff: null, ticketIssued: false });
 return draft;
}
function draftRecord(draft) { const record = drafts.get(draft); if (!record) fail(); return record; }
function hostChecklist(value) {
 exact(value, ['nodeMajor', ...HOST_KEYS]); if (!Number.isInteger(value.nodeMajor) || value.nodeMajor < 24) fail();
 for (const key of HOST_KEYS) if (value[key] !== true) fail();
 return freeze({ nodeMajor: value.nodeMajor, ...Object.fromEntries(HOST_KEYS.map(k => [k, true])) });
}
function reviewPackage(...args) {
 if (args.length !== 3) fail();
 const [draft, binding, ack] = args, record = draftRecord(draft);
 if (record.binding !== binding || record.reviewAck) fail();
 exact(ack, ['reviewed', 'manifestSha256', 'targetReview', 'inventoryReview', 'codeReview', 'hostChecklist', 'contextReview']);
 if (ack.reviewed !== true || ack.manifestSha256 !== hash(canonical(record.manifest))) fail();
 for (const [key, expected] of Object.entries({ targetReview: record.targetReview, inventoryReview: record.reviewedInventory,
  codeReview: { reviewed: true, ...record.codeIdentity }, contextReview: { reviewed: true, ...record.contextReview.meta } }))
  if (canonical(ack[key]) !== canonical(expected)) fail();
 const host = hostChecklist(ack.hostChecklist);
 if (canonical(verifyCodeIdentity(record.reviewedCode)) !== canonical(record.codeIdentity)) fail();
 // The package owns this ORIGINAL fixed context review/handoff; callers cannot
 // substitute a schema handoff. This 0110 handoff step requires no additional
 // 0109 change; the later 0112 context-result transfer is separately source-pinned.
 const permit = reviews.approveProjectTokenContextReview(record.contextReview, ack.contextReview);
 record.handoff = reviews.consumeProjectTokenContextPermitForAdapter(permit, binding);
 record.reviewAck = freeze({ reviewed: true, manifestSha256: ack.manifestSha256, targetReview: record.targetReview,
  inventoryReview: record.reviewedInventory, codeReview: freeze({ reviewed: true, ...record.codeIdentity }), hostChecklist: host,
  contextReview: freeze({ reviewed: true, ...record.contextReview.meta }) });
 return reviewArtifact(draft);
}
function finalAcknowledgement(record) {
 if (!record.reviewAck) fail();
 return freeze({ manualLiveAuthorization: false, operationKind: 'project_token_context', operationName: 'Movement0108ProjectTokenContext',
  manifestSha256: hash(canonical(record.manifest)), reviewedHead: record.codeIdentity.reviewedHead,
  reviewedBranch: record.codeIdentity.reviewedBranch, codeIdentitySha256: hash(canonical(record.codeIdentity)),
  inventoryReviewSha256: hash(canonical(record.reviewedInventory)), targetReviewSha256: hash(canonical(record.targetReview)),
  hostReviewSha256: hash(canonical(record.reviewAck.hostChecklist)), operationReviewSha256: hash(canonical(record.reviewAck.contextReview)) });
}
function reviewArtifact(...args) {
 if (args.length !== 1) fail(); const record = draftRecord(args[0]);
 return freeze({ notice: 'LIVE REQUEST NOT AUTHORIZED', outcome: 'PRELIVE_NOT_AUTHORIZED', manifest: record.manifest,
  manifestSha256: hash(canonical(record.manifest)), hostAttestationKeys: ['nodeMajor', ...HOST_KEYS],
  contextReviewMetadata: record.contextReview.meta, localReviewComplete: record.reviewAck !== null,
  finalAcknowledgementTemplate: record.reviewAck ? finalAcknowledgement(record) : null });
}
function authorizeFirstLiveContext(...args) {
 if (args.length !== 3) fail();
 const [draft, binding, ack] = args, record = draftRecord(draft);
 if (record.binding !== binding || !record.reviewAck || record.ticketIssued) fail();
 const expected = finalAcknowledgement(record); exact(ack, Object.keys(expected));
 for (const key of Object.keys(expected)) if (ack[key] !== (key === 'manualLiveAuthorization' ? true : expected[key])) fail();
 if (canonical(verifyCodeIdentity(record.reviewedCode)) !== canonical(record.codeIdentity)) fail();
 record.ticketIssued = true;
 const ticket = Object.freeze({}); tickets.set(ticket, { record, acknowledgement: freeze({ ...ack }) }); return ticket;
}
function consumeLiveTicketForContext(...args) {
 const entry = tickets.get(args[0]); if (!entry) fail(); tickets.delete(args[0]); // Burn before every validation.
 if (args.length !== 4) fail();
 const [, binding, manifest, operationKind] = args, record = entry.record;
 if (binding !== record.binding || manifest !== record.manifest || operationKind !== 'project_token_context' ||
  canonical(verifyCodeIdentity(record.reviewedCode)) !== canonical(record.codeIdentity)) fail();
 const authority = Object.freeze({}); authorities.set(authority, entry); return authority;
}
function takeContextExecutionAuthority(...args) {
 const entry = authorities.get(args[0]); if (!entry) fail(); authorities.delete(args[0]);
 if (args.length !== 2) fail(); const binding = args[1], record = entry.record;
 if (binding !== record.binding || canonical(verifyCodeIdentity(record.reviewedCode)) !== canonical(record.codeIdentity)) fail();
 // A future trusted wrapper takes this only once, then immediately invokes 0109.
 // No credential read, adapter.open/execute or network call occurs here.
 return freeze({ privateTarget: binding, contextHandoff: record.handoff, operationKind: 'project_token_context' });
}
function takeFirstContextExecutionAuthority(...args) {
 const entry = authorities.get(args[0]); if (!entry) fail();
 // Wrong public arity still delegates to the same burn-before-validation pool.
 if (args.length !== 1) return takeContextExecutionAuthority(args[0]);
 return takeContextExecutionAuthority(args[0], entry.record.binding);
}
function reviewTemplate(...args) {
 if (args.length) fail();
 const codeIdentity = freeze({ ...verifySources(), reviewedHead: null, reviewedBranch: null });
 return freeze({ notice: 'LIVE REQUEST NOT AUTHORIZED', outcome: 'PRELIVE_NOT_AUTHORIZED', manifest: operationFacts(codeIdentity),
  railwayLabels: labels, actualRailwayIdsUnresolved: true,
  target: { projectId: null, environmentId: null, serviceId: null, serviceInstanceId: null },
  forbiddenRailwayInventory: { inventoryReviewed: false, ...Object.fromEntries(CATEGORIES.map(k => [k, { reviewed: false, ids: null }])) },
  crossSystemForbidden, hostChecklist: { nodeMajor: null, ...Object.fromEntries(HOST_KEYS.map(k => [k, false])) },
  reviewed: false, manualLiveAuthorization: false });
}
// Separate planning namespace only: deliberately no ticket/authority or adapter consumer.
const acquisitionDrafts = new WeakMap(), acquisitionReviews = new WeakMap();
function acquisitionFacts(codeIdentity, expectedTarget, forbiddenRailwayInventory) {
 const operations = [
  { kind: 'provider', operationName: 'Movement0108ProjectTokenContext', querySha256: context.canonicalSha256, maxRequests: 1 },
  { kind: 'provider', operationName: identity.documents.projectServices.operationName, querySha256: identity.documents.projectServices.canonicalSha256, maxRequests: 1 },
  { kind: 'human_review', operationName: 'HUMAN_SERVICE_REVIEW', required: true },
  { kind: 'provider', operationName: identity.documents.serviceInstance.operationName, querySha256: identity.documents.serviceInstance.canonicalSha256, maxRequests: 1 },
  { kind: 'human_review', operationName: 'HUMAN_TARGET_REVIEW', required: true }
 ];
 return freeze({ version: 'movement_railway_identity_acquisition_auth_v1', operationKind: 'target_identity_acquisition',
  reviewedHead: codeIdentity.reviewedHead, reviewedBranch: codeIdentity.reviewedBranch, codeIdentity,
  expectedTarget, forbiddenRailwayInventory, crossSystemForbidden, orderedOperations: operations,
  exactRequestOrderRequired: true, maxProviderRequests: 3, retries: 0, fallbackAllowed: false, redirectPolicy: 'reject',
  humanServiceReviewRequired: true, finalHumanTargetReviewRequired: true, schemaAuthorized: false,
  liveAuthorized: false, manualLiveAuthorization: false, transportSupported: false, authority: state });
}
function createAcquisitionDraft(...args) {
 if (args.length !== 3) fail(); const [binding, forbidden, reviewedCode] = args;
 let target; try { target = targets.describeTarget(binding); } catch { fail(); }
 const reviewedInventory = inventory(forbidden, target), codeIdentity = verifyCodeIdentity(reviewedCode);
 const expectedTarget = freeze({ projectId: target.projectId, environmentId: target.environmentId,
  serviceId: target.serviceId, serviceInstanceId: target.serviceInstanceId,
  serviceName: null, environmentKind: target.environmentKind, lifecycle: target.lifecycle,
  independentlyAuthoritative: false });
 const manifest = acquisitionFacts(codeIdentity, expectedTarget, reviewedInventory), draft = Object.freeze({});
 acquisitionDrafts.set(draft, { binding, manifest, codeIdentity,
  reviewedCode: freeze({ reviewedHead: codeIdentity.reviewedHead, reviewedBranch: codeIdentity.reviewedBranch }),
  reviewIssued: false, reviewComplete: false });
 return draft;
}
function reviewAcquisitionPackage(...args) {
 if (args.length !== 1) fail(); const draft = args[0], e = acquisitionDrafts.get(draft);
 if (!e || e.reviewIssued || canonical(verifyCodeIdentity(e.reviewedCode)) !== canonical(e.codeIdentity)) fail();
 const review = freeze({ notice: 'LIVE ACQUISITION NOT AUTHORIZED', outcome: 'PRELIVE_NOT_AUTHORIZED',
  manifest: e.manifest, manifestSha256: hash(canonical(e.manifest)), localReviewComplete: false, liveAuthorized: false });
 acquisitionReviews.set(review, { entry: e }); e.reviewIssued = true; return review;
}
function approveAcquisitionPackageReview(...args) {
 const owned = acquisitionReviews.get(args[0]); if (!owned) fail(); acquisitionReviews.delete(args[0]);
 if (args.length !== 3 || args[1] !== owned.entry.binding) fail(); const e = owned.entry, ack = args[2];
 exact(ack, ['reviewed', 'manifest', 'manifestSha256', 'liveAuthorized']);
 if (ack.reviewed !== true || ack.liveAuthorized !== false || ack.manifestSha256 !== hash(canonical(e.manifest)) ||
  canonical(ack.manifest) !== canonical(e.manifest) || e.reviewComplete ||
  canonical(verifyCodeIdentity(e.reviewedCode)) !== canonical(e.codeIdentity)) fail();
 e.reviewComplete = true;
 return freeze({ notice: 'LIVE ACQUISITION NOT AUTHORIZED', outcome: 'PRELIVE_NOT_AUTHORIZED',
  manifest: e.manifest, manifestSha256: hash(canonical(e.manifest)), localReviewComplete: true, liveAuthorized: false });
}
function acquisitionReviewTemplate(...args) {
 if (args.length) fail(); const codeIdentity = freeze({ ...verifySources(), reviewedHead: null, reviewedBranch: null });
 const expectedTarget = { projectId: null, environmentId: null, serviceId: null, serviceInstanceId: null,
  serviceName: null, environmentKind: null, lifecycle: null, independentlyAuthoritative: false };
 const forbidden = { inventoryReviewed: false, ...Object.fromEntries(CATEGORIES.map(k => [k, { reviewed: false, ids: null }])) };
 return freeze({ notice: 'LIVE ACQUISITION NOT AUTHORIZED', outcome: 'PRELIVE_NOT_AUTHORIZED',
  manifest: acquisitionFacts(codeIdentity, expectedTarget, forbidden), actualRailwayIdsUnresolved: true,
  reviewed: false, localReviewComplete: false, manualLiveAuthorization: false, liveAuthorized: false,
  executableAuthorization: executableAcquisitionReviewTemplate() });
}
// Executable v4 is separate from historical v1/v2/v3 material.
const executableDrafts = new WeakMap(), executableReviews = new WeakMap(), acquisitionTickets = new WeakMap();
const acquisitionTargets = new WeakMap();
const INPUT_PATH = 'docs/0114e-current-acquisition-input-review.json';
const EVIDENCE_PATH = 'docs/0114e-qualification-target-evidence.json';
const SCOPE_KEYS = ['projectId','environmentId','serviceId','serviceInstanceId','environmentKind','lifecycle'];
function textReference(v) {
 if (typeof v !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_. /:#-]{0,255}$/.test(v) || /sb_secret_|^eyJ|privatekey|railway.*token/i.test(v)) fail(); return v;
}
function attemptReference(v) {
 if (typeof v !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_. /:#-]{0,127}$/.test(v) || /sb_secret_|^eyJ|privatekey|railway.*token/i.test(v)) fail(); return v;
}
function serviceLabel(v) {
 if (typeof v !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_. /-]{0,127}$/.test(v) || /sb_secret_|^eyJ|privatekey|railway.*token/i.test(v)) fail(); return v;
}
function digest(v) { if (typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v)) fail(); return v; }
function reviewJson(text) {
 // JSON.parse alone silently chooses the last duplicate key. Reviews must not.
 const stack = []; let i = 0;
 while (i < text.length) {
  const c = text[i++];
  if (c === '"') {
   const start = i - 1; let closed = false;
   while (i < text.length) { const next = text[i++]; if (next === '\\') i++; else if (next === '"') { closed = true; break; } }
   if (!closed) fail(); const top = stack[stack.length-1];
   if (top?.keyExpected) { const key = JSON.parse(text.slice(start,i)); if (top.keys.has(key)) fail(); top.keys.add(key); top.keyExpected = false; }
  } else if (c === '{' || c === '[') stack.push({keys:new Set(),keyExpected:c === '{',object:c === '{'});
  else if (c === '}' || c === ']') stack.pop();
  else if (c === ',' && stack[stack.length-1]?.object) stack[stack.length-1].keyExpected = true;
 }
 return JSON.parse(text);
}
function boundedText(file, limit) {
 let descriptor;
 try {
  descriptor=fs.openSync(file,'r');
  const stat=fs.fstatSync(descriptor);if(!stat.isFile())fail();
  const bytes=Buffer.alloc(limit+1);let offset=0;
  while(offset<bytes.length){const count=fs.readSync(descriptor,bytes,offset,bytes.length-offset,null);if(count===0)break;offset+=count;}
  if(offset>limit)fail();return bytes.subarray(0,offset).toString('utf8');
 } catch { fail(); }
 finally { if(descriptor!==undefined)try{fs.closeSync(descriptor);}catch{} }
}
function trackedText(relative) {
 if (![INPUT_PATH,EVIDENCE_PATH,POLICY_PATH,'docs/0114e-qualification-project-id-review.md','docs/0114e-qualification-lifecycle-review.md'].includes(relative) &&
  !/^docs\/0114i-lifecycle-reviews\/[A-Za-z0-9][A-Za-z0-9_.-]{0,127}\.json$/.test(relative)) fail();
 const root=path.resolve(ROOT), requested=path.resolve(ROOT,relative), allowed=path.resolve(ROOT,'docs/0114i-lifecycle-reviews');
 let real; try { real=fs.realpathSync(requested); } catch { fail(); }
 if (relative.startsWith('docs/0114i-lifecycle-reviews/') && !(real===allowed || real.startsWith(allowed+path.sep))) fail();
 const value = boundedText(real,relative.startsWith('docs/0114i-lifecycle-reviews/')?MAX_LIFECYCLE_BYTES:1048576);
 return value.replace(/\r\n/g,'\n');
}
function strictTimestamp(value) {
 if(typeof value!=='string')fail();const ms=Date.parse(value);
 if(!Number.isSafeInteger(ms)||new Date(ms).toISOString()!==value)fail();return ms;
}
function safeReviewPath(value) {
 if(typeof value!=='string'||value.length>256||value.includes('\\')||value.includes('\0')||value.includes(':')||
  value.startsWith('/')||value.split('/').some(s=>!s||s==='.'||s==='..'||/[. ]$/.test(s)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s)))fail();
 return value;
}
function reference(value) {
 exact(value,['path','sha256','record']);safeReviewPath(value.path);digest(value.sha256);textReference(value.record);
 const text=trackedText(value.path);if(hash(text)!==value.sha256)fail();return freeze({...value});
}
function activationRecord(descriptor, pkg, target) {
 exact(descriptor,['path','sha256']);
 if(!/^docs\/0114i-lifecycle-reviews\/[A-Za-z0-9][A-Za-z0-9_.-]{0,127}\.json$/.test(descriptor.path))fail();digest(descriptor.sha256);
 const raw=trackedText(descriptor.path);if(Buffer.byteLength(raw,'utf8')>MAX_LIFECYCLE_BYTES||hash(raw)!==descriptor.sha256)fail();
 const record=reviewJson(raw);exact(record,['version','policy','attemptReference','subjectSha256','target','operator','evidence','review','validity']);
 if(record.version!=='movement_railway_qualification_lifecycle_review_v1')fail();
 exact(record.policy,['path','sha256']);if(record.policy.path!==POLICY_PATH||record.policy.sha256!==APPROVED_LIFECYCLE_POLICY_SHA256||hash(trackedText(POLICY_PATH))!==APPROVED_LIFECYCLE_POLICY_SHA256)fail();
 attemptReference(record.attemptReference);digest(record.subjectSha256);
 exact(record.target,['projectId','environmentId','serviceId','serviceName','serviceInstanceId','environmentKind']);
 for(const k of ['projectId','environmentId','serviceId','serviceInstanceId','environmentKind'])if(record.target[k]!==target[k])fail();
 if(record.target.serviceName!==pkg.expectedTarget.serviceName)fail();
 exact(record.operator,['reference','assertedAt','allocationEvidence','acknowledgements']);textReference(record.operator.reference);
 exact(record.operator.acknowledgements,['hasAllocationAuthority','targetCreated','currentlyAllocated','reservedForAttempt','notProduction','notRetired','notDecommissioned','notKnownDeleted','noIncompatibleUse','noUnresolvedTeardown','notConsumedUnderApplicablePolicy','noKnownRelevantChange']);
 for(const v of Object.values(record.operator.acknowledgements))if(v!==true)fail();
 exact(record.evidence,['identity','disposable','inventory','observations','newProviderObservationOccurred']);if(typeof record.evidence.newProviderObservationOccurred!=='boolean')fail();
 const arrays=[record.operator.allocationEvidence,record.evidence.identity,record.evidence.disposable,record.evidence.inventory,record.evidence.observations];
 if(arrays.some(a=>!Array.isArray(a))||arrays.slice(0,4).some(a=>a.length<1)||arrays.some(a=>a.length>16)||arrays.reduce((n,a)=>n+a.length,0)>16)fail();
 const refs=arrays.map(a=>a.map(reference));
 exact(record.review,['reviewerReference','independentlyReviewed','result','reviewedAt','evidenceReference','acceptance']);
 textReference(record.review.reviewerReference);textReference(record.review.evidenceReference);
 if(record.review.reviewerReference===record.operator.reference||record.review.independentlyReviewed!==true||record.review.result!=='NO_MISMATCH')fail();
 exact(record.review.acceptance,['factsAccepted','identityBindingAccepted','inventoryAccepted','policyMappingAccepted']);for(const v of Object.values(record.review.acceptance))if(v!==true)fail();
 exact(record.validity,['expiresAt','value','scope']);if(record.validity.value!=='active'||record.validity.scope!=='one_package_one_attempt')fail();
 const assertedAtMs=strictTimestamp(record.operator.assertedAt),reviewedAtMs=strictTimestamp(record.review.reviewedAt),expiresAtMs=strictTimestamp(record.validity.expiresAt);
 if(assertedAtMs>reviewedAtMs||expiresAtMs!==reviewedAtMs+1800000)fail();
 const subject={...pkg};delete subject.lifecycleReview;const subjectSha256=hash(canonical(subject));if(record.subjectSha256!==subjectSha256)fail();
 const canonicalRecord=canonical(record);if(Buffer.byteLength(canonicalRecord,'utf8')>MAX_LIFECYCLE_BYTES)fail();
 return freeze({descriptor:freeze({...descriptor}),record:freeze({...record,operator:freeze({...record.operator,allocationEvidence:refs[0]}),evidence:freeze({...record.evidence,identity:refs[1],disposable:refs[2],inventory:refs[3],observations:refs[4]})}),canonicalRecord,
  assertionKey:hash(canonicalRecord),subjectSha256,attemptReference:record.attemptReference,reviewedAt:record.review.reviewedAt,reviewedAtMs,
  expiresAt:record.validity.expiresAt,expiresAtMs,scope:record.validity.scope,policySha256:record.policy.sha256});
}
function claimLifecycle(lifecycle) {
 requireExecutableHost();const {u,m}=clocks();if(lifecycle.reviewedAtMs>u||u>=lifecycle.expiresAtMs)fail();sweepExpired(u);
 const existing=admissionByAssertionKey.get(lifecycle.assertionKey),indexed=attemptReferenceIndex.get(lifecycle.attemptReference);
 if(existing){if(existing.canonicalRecord!==lifecycle.canonicalRecord||existing.subjectSha256!==lifecycle.subjectSha256||existing.attemptReference!==lifecycle.attemptReference)fail();fail();}
 if(indexed!==undefined||admissionByAssertionKey.size>=MAX_LIFECYCLE_ENTRIES)fail();
 const remaining=lifecycle.expiresAtMs-u,monoDeadline=m+remaining;if(!Number.isSafeInteger(remaining)||remaining<=0||!Number.isFinite(monoDeadline)||monoDeadline<m||monoDeadline===m)fail();
 const e={state:'claimed',canonicalRecord:lifecycle.canonicalRecord,subjectSha256:lifecycle.subjectSha256,attemptReference:lifecycle.attemptReference,
  expiresAtMs:lifecycle.expiresAtMs,monoDeadline,originalDraftEntry:null,carrier:null,closeReason:null,expiryTimer:null,stopRun:null,
  drafts:new Set(),reviews:new Set(),tickets:new Set(),permits:new Set()};
 // Final pure pre-claim fence and insertion are adjacent in this synchronous turn.
 const finalClock=clocks();
 if(!executableEnabled||hostRevoked||clockFault||lifecycle.reviewedAtMs>finalClock.u||finalClock.u>=lifecycle.expiresAtMs||finalClock.m>=monoDeadline||
  admissionByAssertionKey.has(lifecycle.assertionKey)||attemptReferenceIndex.has(lifecycle.attemptReference)||admissionByAssertionKey.size>=MAX_LIFECYCLE_ENTRIES)fail();
 admissionByAssertionKey.set(lifecycle.assertionKey,e);attemptReferenceIndex.set(lifecycle.attemptReference,lifecycle.assertionKey);
 try{createCarrier(e);scheduleLifecycle(e);return e;}catch{closeLifecycle(e,'claim_setup_failure');throw Error('Railway first-live preflight unavailable');}
}
function reviewedInput(descriptor, target, codeIdentity, forbidden) {
 exact(descriptor,['path','sha256']); if (descriptor.path !== INPUT_PATH) fail(); digest(descriptor.sha256);
 const text = trackedText(INPUT_PATH); if (hash(text) !== descriptor.sha256) fail();
 const value = reviewJson(text);
 exact(value,['version','outcome','reviewed','inputReviewComplete','liveAuthorized','manualLiveAuthorization','reviewedHead','reviewedBranch',
  'requiredCodeReview','expectedTarget','historicalLabels','targetInputSources','forbiddenRailwayInventory','hostReview','codeIdentity',
  'crossSystemForbidden','independentReview','executableAcquisitionPrepared','providerObservationOccurred','targetIdentityProven',
  'serviceIdentityProven','serviceInstanceIdentityProven','evidenceBinding','lifecycleReview']);
 if (value.version !== 'movement_railway_acquisition_input_review_v3' || value.outcome !== 'PRELIVE_NOT_AUTHORIZED' ||
  value.reviewed !== true || value.inputReviewComplete !== true) fail();
 for (const k of ['liveAuthorized','manualLiveAuthorization','executableAcquisitionPrepared','providerObservationOccurred',
  'targetIdentityProven','serviceIdentityProven','serviceInstanceIdentityProven']) if (value[k] !== false) fail();
 if (value.reviewedHead !== codeIdentity.reviewedHead || value.reviewedBranch !== codeIdentity.reviewedBranch ||
  canonical(value.requiredCodeReview) !== canonical({reviewedHead:codeIdentity.reviewedHead,reviewedBranch:codeIdentity.reviewedBranch}) ||
  canonical(value.codeIdentity) !== canonical(codeIdentity) || canonical(value.historicalLabels) !== canonical(labels) ||
  canonical(value.crossSystemForbidden) !== canonical(crossSystemForbidden) || canonical(value.forbiddenRailwayInventory) !== canonical(forbidden)) fail();
 const expected = value.expectedTarget; exact(expected,[...SCOPE_KEYS,'serviceName','branch','rootDirectory']);
 for (const k of SCOPE_KEYS) if (expected[k] !== target[k]) fail();
 if (expected.branch !== BRANCH || expected.rootDirectory !== '/movement-app') fail(); serviceLabel(expected.serviceName);
 exact(value.targetInputSources,['projectId','environmentId','serviceId','serviceInstanceId','serviceName']);
 for (const k of ['projectId','environmentId','serviceId','serviceInstanceId','serviceName']) {
  const e = value.targetInputSources[k]; exact(e,['independentlyReviewed','source','reviewer']);
  if (k === 'serviceInstanceId' && expected[k] === null) { if (e.independentlyReviewed !== false || e.source !== null || e.reviewer !== null) fail(); }
  else { if (e.independentlyReviewed !== true) fail(); textReference(e.source); textReference(e.reviewer); }
 }
 exact(value.hostReview,['reviewed','reviewer','checklist']); if (value.hostReview.reviewed !== true) fail();
 textReference(value.hostReview.reviewer); const host = hostChecklist(value.hostReview.checklist);
 const review = value.independentReview; exact(review,['reviewed','reviewer','evidenceReference']);
 if (review.reviewed !== true) fail(); textReference(review.reviewer); textReference(review.evidenceReference);
 const evidence = value.evidenceBinding; exact(evidence,['path','sha256','record']);
 if (evidence.path !== EVIDENCE_PATH || evidence.record !== 'qualificationReview.reviewedContext') fail(); digest(evidence.sha256);
 const evidenceText = trackedText(EVIDENCE_PATH); if (hash(evidenceText) !== evidence.sha256) fail();
 const facts = reviewJson(evidenceText), scoped = facts.qualificationReview;
 if (!scoped || scoped.result !== 'NO_MISMATCH' || scoped.reviewerIndependentlyInspectedProvider !== true || scoped.reviewerDistinctFromAcquirer !== true) fail();
 textReference(scoped.reviewerReference);
 const observed = scoped.reviewedContext;
 for (const k of ['projectId','environmentId','serviceId','serviceName']) if (observed[k] !== expected[k]) fail();
 for (const k of ['projectId','environmentId','serviceId']) if (facts.identifiers[k].value !== expected[k]) fail();
 const lifecycle=activationRecord(value.lifecycleReview,value,target);
 return freeze({ expectedTarget: {...Object.fromEntries(SCOPE_KEYS.map(k=>[k,target[k]])),serviceName:expected.serviceName,
  inputReview:{path:descriptor.path,sha256:descriptor.sha256,reviewer:review.reviewer,evidenceReference:review.evidenceReference,
   evidenceBinding:{...evidence},lifecycleReview:{...value.lifecycleReview}}},host,lifecycle });
}
function verifyAcquisition(e) {
 if (canonical(verifyCodeIdentity(e.reviewedCode)) !== canonical(e.codeIdentity)) fail();
 const current = reviewedInput(e.inputDescriptor,targets.describeTarget(e.binding),e.codeIdentity,e.inventoryReview.inventory);
 if (canonical(current) !== canonical(e.inputSnapshot) || hash(canonical(e.manifest)) !== e.manifestSha256) fail();
}
const executionPolicy = freeze({ humanWaitMs: 300000, maxProviderRequests: 3, sameSessionContextLifetime: true,
 closeOnEveryTerminalExit: true, crashResumeSupported: false, retries: 0, fallbackAllowed: false, redirectPolicy: 'reject' });
function executableManifest(codeIdentity, expectedTarget, forbidden) {
 return freeze({ ...acquisitionFacts(codeIdentity,expectedTarget,forbidden), version: 'movement_railway_identity_acquisition_auth_v4',
  transportSupported: true, executionPolicy, manualLiveAuthorizationRequired: true });
}
function createExecutableAcquisitionDraft(...args) {
 let lifecycleEntry;
 try {
  if (args.length !== 4) fail(); requireExecutableHost(); const [binding, forbidden, code, input] = args, target = targets.describeTarget(binding);
  const inventoryReview = identity.reviewForbiddenInventory(binding,forbidden), codeIdentity = verifyCodeIdentity(code);
  const inputSnapshot = reviewedInput(input,target,codeIdentity,inventoryReview.inventory);
  const inputDescriptor = freeze({path:input.path,sha256:input.sha256}); lifecycleEntry=claimLifecycle(inputSnapshot.lifecycle);
  const eligibility=freeze({assertionKey:inputSnapshot.lifecycle.assertionKey,activationRecordSha256:inputSnapshot.lifecycle.descriptor.sha256,
   subjectSha256:inputSnapshot.lifecycle.subjectSha256,attemptReference:inputSnapshot.lifecycle.attemptReference,reviewedAt:inputSnapshot.lifecycle.reviewedAt,
   expiresAt:inputSnapshot.lifecycle.expiresAt,scope:inputSnapshot.lifecycle.scope,policySha256:inputSnapshot.lifecycle.policySha256});
  const manifest = executableManifest(codeIdentity,{...inputSnapshot.expectedTarget,lifecycleEligibility:eligibility,expectations:identity.reviewTemplate().expectations},inventoryReview.inventory);
  const draft = Object.freeze({}),entry={ binding,inventoryReview,codeIdentity,manifest,inputSnapshot,inputDescriptor,manifestSha256:hash(canonical(manifest)),contextReview: reviews.reviewProjectTokenContext(binding),
   reviewedCode: freeze({ reviewedHead: codeIdentity.reviewedHead, reviewedBranch: codeIdentity.reviewedBranch }), lifecycleEntry,
   reviewIssued: false, reviewComplete: false, ticketIssued: false, contextHandoff: null, host: null };
  executableDrafts.set(draft,entry);lifecycleEntry.originalDraftEntry=entry;lifecycleEntry.drafts.add(draft);lifecycleFence(lifecycleEntry);return draft;
 } catch { if(lifecycleEntry)closeLifecycle(lifecycleEntry,'draft_failure');fail(); }
}
function reviewExecutableAcquisitionPackage(...args) {
 if (args.length !== 1) fail(); const e = executableDrafts.get(args[0]);
 if (!e || e.reviewIssued) fail(); try{verifyAcquisition(e);lifecycleFence(e.lifecycleEntry);}catch{if(e)closeLifecycle(e.lifecycleEntry,'review_failure');fail();}
 const review = freeze({ outcome: 'PRELIVE_NOT_AUTHORIZED', manifest: e.manifest, manifestSha256: hash(canonical(e.manifest)),
  contextReviewMetadata: e.contextReview.meta, hostAttestationKeys: ['nodeMajor',...HOST_KEYS], liveAuthorized: false });
 lifecycleFence(e.lifecycleEntry);executableReviews.set(review,e);e.lifecycleEntry.reviews.add(review); e.reviewIssued = true; return review;
}
function acquisitionFinalAcknowledgement(e) {
 if (!e.reviewComplete) fail();
 return freeze({ manualLiveAuthorization: false, version: e.manifest.version, operationKind: 'target_identity_acquisition',
  manifestSha256: hash(canonical(e.manifest)), reviewedHead: e.codeIdentity.reviewedHead, reviewedBranch: e.codeIdentity.reviewedBranch,
  codeIdentitySha256: hash(canonical(e.codeIdentity)), hostReviewSha256: hash(canonical(e.host)) });
}
function approveExecutableAcquisitionPackageReview(...args) {
 const e = executableReviews.get(args[0]); if (!e) fail(); executableReviews.delete(args[0]);
 e.lifecycleEntry.reviews.delete(args[0]);
 try {
  if (args.length !== 3 || args[1] !== e.binding || e.reviewComplete) fail();
  const ack = args[2]; exact(ack,['reviewed','manifest','manifestSha256','contextReview','hostChecklist']);
  if (ack.reviewed !== true || canonical(ack.manifest) !== canonical(e.manifest) ||
   ack.manifestSha256 !== hash(canonical(e.manifest)) || canonical(ack.contextReview) !== canonical({ reviewed: true,...e.contextReview.meta }) ||
   canonical(verifyCodeIdentity(e.reviewedCode)) !== canonical(e.codeIdentity)) fail();
  verifyAcquisition(e);e.host = hostChecklist(ack.hostChecklist);
  if (canonical(e.host) !== canonical(e.inputSnapshot.host)) fail();
  const p = reviews.approveProjectTokenContextReview(e.contextReview,ack.contextReview);
  e.contextHandoff = reviews.consumeProjectTokenContextPermitForAdapter(p,e.binding);lifecycleFence(e.lifecycleEntry); e.reviewComplete = true;
  return freeze({ outcome: 'PRELIVE_NOT_AUTHORIZED', localReviewComplete: true, manifest: e.manifest, liveAuthorized: false,
   finalAcknowledgementTemplate: acquisitionFinalAcknowledgement(e) });
 } catch {closeLifecycle(e.lifecycleEntry,'review_approval_failure');fail();}
}
function authorizeAcquisition(...args) {
 if (args.length !== 3) fail(); const e = executableDrafts.get(args[0]);
 if (!e || e.ticketIssued) fail();
 try {
  if (args[1] !== e.binding || !e.reviewComplete) fail();
  const expected = acquisitionFinalAcknowledgement(e), ack = args[2]; exact(ack,Object.keys(expected));
  for (const k of Object.keys(expected)) if (ack[k] !== (k === 'manualLiveAuthorization' ? true : expected[k])) fail();
  verifyAcquisition(e);lifecycleFence(e.lifecycleEntry);e.ticketIssued = true;
  lifecycleFence(e.lifecycleEntry);const ticket = Object.freeze({}); acquisitionTickets.set(ticket,e);e.lifecycleEntry.tickets.add(ticket); return ticket;
 }catch{closeLifecycle(e.lifecycleEntry,'manual_authorization_failure');fail();}
}
// Private redemption, installed only into the pinned literal acquisition owner.
function redeemAcquisitionTicketForWrapper(...args) {
 const e = acquisitionTickets.get(args[0]); if (!e) fail(); acquisitionTickets.delete(args[0]);
 e.lifecycleEntry.tickets.delete(args[0]);
 try {
  if (args.length !== 1 || canonical(verifyCodeIdentity(e.reviewedCode)) !== canonical(e.codeIdentity) ||
   require('./qualification-railway-acquisition-wrapper.cjs') !== acquisitionOwner || typeof wrapperSetup!=='function') fail();
  verifyAcquisition(e);lifecycleFence(e.lifecycleEntry);
  const acquisitionTargetPermit = Object.freeze({}); acquisitionTargets.set(acquisitionTargetPermit,e);e.lifecycleEntry.permits.add(acquisitionTargetPermit);
  const payload=freeze({ privateTarget: e.binding, contextHandoff: e.contextHandoff, inventoryReview: e.inventoryReview,
   acquisitionTargetPermit, lifecycleCarrier:e.lifecycleEntry.carrier, adapterAssociate, operationKind: 'target_identity_acquisition', executionPolicy });
  lifecycleFence(e.lifecycleEntry);return wrapperSetup(payload);
 }catch{closeLifecycle(e.lifecycleEntry,'redemption_failure');fail();}
}
function consumeAcquisitionTarget(...args) {
 const e = acquisitionTargets.get(args[0]); if (!e) fail(); acquisitionTargets.delete(args[0]);
 e.lifecycleEntry.permits.delete(args[0]);
 try {
  if (args.length !== 2 || args[1] !== e.binding || require('./qualification-railway-target-identity.cjs') !== identityOwner) fail();
  verifyAcquisition(e);lifecycleFence(e.lifecycleEntry);
  return freeze({expectedTarget:e.manifest.expectedTarget,manifestSha256:e.manifestSha256,lifecycleCarrier:e.lifecycleEntry.carrier});
 }catch{closeLifecycle(e.lifecycleEntry,'target_permit_failure');fail();}
}
function cancelExecutableAcquisitionDraft(...args){
 if(args.length!==1)fail();const e=executableDrafts.get(args[0]);if(!e)fail();closeLifecycle(e.lifecycleEntry,'draft_cancelled');return Object.freeze({outcome:'ACQUISITION_CANCELLED'});
}
function executableAcquisitionReviewTemplate(...args) {
 if (args.length) fail(); const codeIdentity = freeze({ ...verifySources(), reviewedHead: null, reviewedBranch: null });
 const safe = identity.reviewTemplate();
 return freeze({ outcome: 'PRELIVE_NOT_AUTHORIZED', reviewed: false, liveAuthorized: false, manualLiveAuthorization: false,
  manifest: executableManifest(codeIdentity,{ ...safe.ids, serviceName:null, inputReview:null,lifecycleEligibility:null, expectations: safe.expectations, environmentKind: null, lifecycle: null },
   safe.forbiddenRailwayInventory) });
}
const authorizationExports = Object.freeze(Object.assign(Object.create(null), { state, baselineParentHead: BASELINE_PARENT_HEAD, sourceHashes: SOURCE_HASHES, verifyCodeIdentity,
 createExecutableAcquisitionDraft, reviewExecutableAcquisitionPackage, approveExecutableAcquisitionPackageReview, authorizeAcquisition,
 cancelExecutableAcquisitionDraft,executableAcquisitionReviewTemplate,
 createAcquisitionDraft, reviewAcquisitionPackage, approveAcquisitionPackageReview, acquisitionReviewTemplate,
 createDraft, reviewArtifact, reviewPackage, authorizeFirstLiveContext, consumeLiveTicketForContext,
 takeContextExecutionAuthority, takeFirstContextExecutionAuthority, reviewTemplate }));
module.exports=authorizationExports;
// No public redemption getter/installer. Complete the literal wrapper's private
// connection before either outer import returns; null prototypes support cycles.
const acquisitionOwner = require('./qualification-railway-acquisition-wrapper.cjs');
const connectAcquisitionOwner = Reflect.get(acquisitionOwner, '_connectAcquisitionRedemption');
if (typeof connectAcquisitionOwner !== 'function') fail();
wrapperSetup=connectAcquisitionOwner(redeemAcquisitionTicketForWrapper);if(typeof wrapperSetup!=='function')fail();
const identityOwner = require('./qualification-railway-target-identity.cjs');
const connectIdentityOwner = Reflect.get(identityOwner, '_connectAcquisitionTargetConsumer');
if (typeof connectIdentityOwner !== 'function') fail();
connectIdentityOwner(consumeAcquisitionTarget);
const connectAdapter=Reflect.get(adapter,'_connectLifecycleDispatch');
if(typeof connectAdapter==='function')adapterAssociate=connectAdapter((carrier)=>carrier.check());
// The main-only host owns enablement and shutdown. Ordinary imports complete all
// private links in a permanently disabled state and expose no upgrade connector.
const ownerHost=require('./qualification-railway-acquisition-owner-host.cjs');
const connectHost=Reflect.get(ownerHost,'_connectAuthorizationOwner');
if(typeof connectHost==='function'){
 const connection=connectHost(Object.freeze({
  enable(token){if(token!==hostAssociation||hostRevoked||executableEnabled||typeof adapterAssociate!=='function'||typeof wrapperSetup!=='function')fail();executableEnabled=true;},
  shutdown(){if(hostRevoked)return;hostRevoked=true;executableEnabled=false;for(const e of admissionByAssertionKey.values())closeLifecycle(e,'host_shutdown');},
  facade:Object.freeze({createExecutableAcquisitionDraft,reviewExecutableAcquisitionPackage,approveExecutableAcquisitionPackageReview,
   authorizeAcquisition,cancelExecutableAcquisitionDraft,beginAuthorizedAcquisition:acquisitionOwner.beginAuthorizedAcquisition,
   takePendingHumanReview:acquisitionOwner.takePendingHumanReview,submitServiceReview:acquisitionOwner.submitServiceReview,
   submitTargetReview:acquisitionOwner.submitTargetReview,cancelAcquisition:acquisitionOwner.cancelAcquisition})
 }));
 if(!connection||typeof connection!=='object'||!Object.isFrozen(connection))fail();hostAssociation=connection;
}
