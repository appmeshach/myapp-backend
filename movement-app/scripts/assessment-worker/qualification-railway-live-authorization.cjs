'use strict';
// Local preflight only: no credential reader, network/CLI adapter call or schema
// authorization. Live tickets are exercised only in isolated synthetic tests.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), cp = require('node:child_process');
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
 'qualification-railway-acquisition-wrapper.cjs': '0dc8a07daace32d4984f3edf73301e4143cd2cb2de6232d5880bec33485b103e',
 'qualification-railway-first-context-wrapper.cjs': '7c3a376d1f7a1b733f3be90a3b7d43fb4aa2fd5256c5638a13e6301a3d78cf94',
 'qualification-railway-https-adapter.cjs': '6c25068a45e7ffe98f9db8bd1efe20e0bebad5140f740ea20725785af6361d6b',
 'qualification-railway-target-identity.cjs': '1dce76ecf7657f40d6ad98a7347eecff868772c5812eeadf025165c80ebfcb47',
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
  serviceName: identity.reviewTemplate().expectations.serviceName, environmentKind: target.environmentKind, lifecycle: target.lifecycle,
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
  serviceName: identity.reviewTemplate().expectations.serviceName, environmentKind: null, lifecycle: null, independentlyAuthoritative: false };
 const forbidden = { inventoryReviewed: false, ...Object.fromEntries(CATEGORIES.map(k => [k, { reviewed: false, ids: null }])) };
 return freeze({ notice: 'LIVE ACQUISITION NOT AUTHORIZED', outcome: 'PRELIVE_NOT_AUTHORIZED',
  manifest: acquisitionFacts(codeIdentity, expectedTarget, forbidden), actualRailwayIdsUnresolved: true,
  reviewed: false, localReviewComplete: false, manualLiveAuthorization: false, liveAuthorized: false,
  executableAuthorization: executableAcquisitionReviewTemplate() });
}
// Executable v2 is separate from the unchanged v1 planning-only pool.
const executableDrafts = new WeakMap(), executableReviews = new WeakMap(), acquisitionTickets = new WeakMap();
const executionPolicy = freeze({ humanWaitMs: 300000, maxProviderRequests: 3, sameSessionContextLifetime: true,
 closeOnEveryTerminalExit: true, crashResumeSupported: false, retries: 0, fallbackAllowed: false, redirectPolicy: 'reject' });
function executableManifest(codeIdentity, expectedTarget, forbidden) {
 return freeze({ ...acquisitionFacts(codeIdentity,expectedTarget,forbidden), version: 'movement_railway_identity_acquisition_auth_v2',
  transportSupported: true, executionPolicy, manualLiveAuthorizationRequired: true });
}
function createExecutableAcquisitionDraft(...args) {
 if (args.length !== 3) fail(); const [binding, forbidden, code] = args, target = targets.describeTarget(binding);
 const inventoryReview = identity.reviewForbiddenInventory(binding,forbidden), codeIdentity = verifyCodeIdentity(code);
 const manifest = executableManifest(codeIdentity,{ ...target, expectations: identity.reviewTemplate().expectations },inventoryReview.inventory);
 const draft = Object.freeze({});
 executableDrafts.set(draft,{ binding,inventoryReview,codeIdentity,manifest,contextReview: reviews.reviewProjectTokenContext(binding),
  reviewedCode: freeze({ reviewedHead: codeIdentity.reviewedHead, reviewedBranch: codeIdentity.reviewedBranch }),
  reviewIssued: false, reviewComplete: false, ticketIssued: false, contextHandoff: null, host: null });
 return draft;
}
function reviewExecutableAcquisitionPackage(...args) {
 if (args.length !== 1) fail(); const e = executableDrafts.get(args[0]);
 if (!e || e.reviewIssued || canonical(verifyCodeIdentity(e.reviewedCode)) !== canonical(e.codeIdentity)) fail();
 const review = freeze({ outcome: 'PRELIVE_NOT_AUTHORIZED', manifest: e.manifest, manifestSha256: hash(canonical(e.manifest)),
  contextReviewMetadata: e.contextReview.meta, hostAttestationKeys: ['nodeMajor',...HOST_KEYS], liveAuthorized: false });
 executableReviews.set(review,e); e.reviewIssued = true; return review;
}
function acquisitionFinalAcknowledgement(e) {
 if (!e.reviewComplete) fail();
 return freeze({ manualLiveAuthorization: false, version: e.manifest.version, operationKind: 'target_identity_acquisition',
  manifestSha256: hash(canonical(e.manifest)), reviewedHead: e.codeIdentity.reviewedHead, reviewedBranch: e.codeIdentity.reviewedBranch,
  codeIdentitySha256: hash(canonical(e.codeIdentity)), hostReviewSha256: hash(canonical(e.host)) });
}
function approveExecutableAcquisitionPackageReview(...args) {
 const e = executableReviews.get(args[0]); if (!e) fail(); executableReviews.delete(args[0]);
 if (args.length !== 3 || args[1] !== e.binding || e.reviewComplete) fail();
 const ack = args[2]; exact(ack,['reviewed','manifest','manifestSha256','contextReview','hostChecklist']);
 if (ack.reviewed !== true || canonical(ack.manifest) !== canonical(e.manifest) ||
  ack.manifestSha256 !== hash(canonical(e.manifest)) || canonical(ack.contextReview) !== canonical({ reviewed: true,...e.contextReview.meta }) ||
  canonical(verifyCodeIdentity(e.reviewedCode)) !== canonical(e.codeIdentity)) fail();
 e.host = hostChecklist(ack.hostChecklist);
 const p = reviews.approveProjectTokenContextReview(e.contextReview,ack.contextReview);
 e.contextHandoff = reviews.consumeProjectTokenContextPermitForAdapter(p,e.binding); e.reviewComplete = true;
 return freeze({ outcome: 'PRELIVE_NOT_AUTHORIZED', localReviewComplete: true, manifest: e.manifest, liveAuthorized: false,
  finalAcknowledgementTemplate: acquisitionFinalAcknowledgement(e) });
}
function authorizeAcquisition(...args) {
 if (args.length !== 3) fail(); const e = executableDrafts.get(args[0]);
 if (!e || args[1] !== e.binding || !e.reviewComplete || e.ticketIssued) fail();
 const expected = acquisitionFinalAcknowledgement(e), ack = args[2]; exact(ack,Object.keys(expected));
 for (const k of Object.keys(expected)) if (ack[k] !== (k === 'manualLiveAuthorization' ? true : expected[k])) fail();
 if (canonical(verifyCodeIdentity(e.reviewedCode)) !== canonical(e.codeIdentity)) fail();
 e.ticketIssued = true; const ticket = Object.freeze({}); acquisitionTickets.set(ticket,e); return ticket;
}
// Private redemption, installed only into the pinned literal acquisition owner.
function redeemAcquisitionTicketForWrapper(...args) {
 const e = acquisitionTickets.get(args[0]); if (!e) fail(); acquisitionTickets.delete(args[0]);
 if (args.length !== 1 || canonical(verifyCodeIdentity(e.reviewedCode)) !== canonical(e.codeIdentity) ||
  require('./qualification-railway-acquisition-wrapper.cjs') !== acquisitionOwner) fail();
 return freeze({ privateTarget: e.binding, contextHandoff: e.contextHandoff, inventoryReview: e.inventoryReview,
  operationKind: 'target_identity_acquisition', executionPolicy });
}
function executableAcquisitionReviewTemplate(...args) {
 if (args.length) fail(); const codeIdentity = freeze({ ...verifySources(), reviewedHead: null, reviewedBranch: null });
 const safe = identity.reviewTemplate();
 return freeze({ outcome: 'PRELIVE_NOT_AUTHORIZED', reviewed: false, liveAuthorized: false, manualLiveAuthorization: false,
  manifest: executableManifest(codeIdentity,{ ...safe.ids, expectations: safe.expectations, environmentKind: null, lifecycle: null },
   safe.forbiddenRailwayInventory) });
}
module.exports = Object.freeze(Object.assign(Object.create(null), { state, baselineParentHead: BASELINE_PARENT_HEAD, sourceHashes: SOURCE_HASHES, verifyCodeIdentity,
 createExecutableAcquisitionDraft, reviewExecutableAcquisitionPackage, approveExecutableAcquisitionPackageReview, authorizeAcquisition,
 executableAcquisitionReviewTemplate,
 createAcquisitionDraft, reviewAcquisitionPackage, approveAcquisitionPackageReview, acquisitionReviewTemplate,
 createDraft, reviewArtifact, reviewPackage, authorizeFirstLiveContext, consumeLiveTicketForContext,
 takeContextExecutionAuthority, takeFirstContextExecutionAuthority, reviewTemplate }));
// No public redemption getter/installer. Complete the literal wrapper's private
// connection before either outer import returns; null prototypes support cycles.
const acquisitionOwner = require('./qualification-railway-acquisition-wrapper.cjs');
const connectAcquisitionOwner = Reflect.get(acquisitionOwner, '_connectAcquisitionRedemption');
if (typeof connectAcquisitionOwner !== 'function') fail();
connectAcquisitionOwner(redeemAcquisitionTicketForWrapper);
