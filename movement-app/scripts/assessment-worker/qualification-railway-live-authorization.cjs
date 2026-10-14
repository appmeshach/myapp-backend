'use strict';
// Local preflight only: no credential reader, network/CLI adapter call or schema
// authorization. Live tickets are exercised only in isolated synthetic tests.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), cp = require('node:child_process');
const targets = require('./qualification-railway-introspection-target.cjs');
const context = require('./qualification-railway-project-token-context.cjs');
const reviews = require('./qualification-railway-context-review.cjs');
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
 'qualification-railway-https-adapter.cjs': 'a7b95e582df45a30b126ef63c313a9ad90ef78373d2688d40aab2d3fa9e2bf29',
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
 // substitute a schema handoff. No change to any 0109 module is required.
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
module.exports = Object.freeze({ state, baselineParentHead: BASELINE_PARENT_HEAD, sourceHashes: SOURCE_HASHES, verifyCodeIdentity,
 createDraft, reviewArtifact, reviewPackage, authorizeFirstLiveContext, consumeLiveTicketForContext,
 takeContextExecutionAuthority, reviewTemplate });
