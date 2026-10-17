'use strict';
// Local contracts only. Normal provider ingress is deliberately disconnected.
const crypto = require('node:crypto');
const targets = require('./qualification-railway-introspection-target.cjs');
const context = require('./qualification-railway-project-token-context.cjs');
const provider = require('./qualification-railway-target-identity-provider-boundary.cjs');
const adapter = require('./qualification-railway-https-adapter.cjs');
let consumeAcquisitionTarget = null;
const fail = () => { throw Error('Railway target identity unavailable'); };
const freeze = v => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
const hash = v => crypto.createHash('sha256').update(v, 'utf8').digest('hex');
function exact(v, keys) {
 if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).sort().join('|') !== keys.slice().sort().join('|')) fail();
 for (const key of Reflect.ownKeys(v)) {
  const d = Object.getOwnPropertyDescriptor(v, key);
  if (typeof key !== 'string' || !d || !d.enumerable || !Object.hasOwn(d, 'value')) fail();
 }
}
function canonical(v) {
 if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
 if (v && typeof v === 'object') { exact(v, Object.keys(v)); return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}'; }
 return JSON.stringify(v);
}
const sensitive = /sb_secret_|^eyJ|privatekey|railway.*token/i;
function identifier(v) {
 if (typeof v !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v) || sensitive.test(v)) fail(); return v;
}
function label(v) {
 if (typeof v !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_. /-]{0,127}$/.test(v) || sensitive.test(v)) fail(); return v;
}
const expectations = freeze({ projectName: 'thorough-blessing', environmentName: null,
 branch: 'feature/0092-shared-segment-suitability', rootDirectory: '/movement-app', historicalRegion: 'europe-west4-drams3a', labelsAuthoritative: false });
const crossSystemForbidden = freeze({ provider: 'Supabase', identifierKind: 'project_ref', production: 'xdfmoggrsucisfybqctb',
 inactive: 'udlsysezmzutydnifhsq', consumedHistoricalDisposable: 'uzkhnslyrhgucijcuoes', railwayNamespace: false, newQualificationAuthorized: false });
const state = freeze({ ...adapter.status, outcome: 'TARGET_IDENTITY_UNRESOLVED', targetIdentityAcquisitionReady: true,
 targetIdentityObserved: false, providerResultIngressConnected: false, manualLiveAuthorizationRequired: true });
const documents = freeze({
 projectServices: { operationName: 'Movement0111ProjectServices', source: `query Movement0111ProjectServices($id: String!) {
  project(id: $id) {
    id
    services {
      edges {
        node {
          id
          name
        }
      }
      pageInfo {
        hasNextPage
      }
    }
  }
}`, canonicalSha256: 'fa6231580d6acec3510c26f4be5972605a3648c4c47f7da73eaa24021b137833' },
 serviceInstance: { operationName: 'Movement0111ServiceInstance', source: `query Movement0111ServiceInstance(
  $serviceId: String!,
  $environmentId: String!
) {
  serviceInstance(
    serviceId: $serviceId,
    environmentId: $environmentId
  ) {
    id
    serviceName
    rootDirectory
    region
  }
}`, canonicalSha256: 'e247e7ec5e98cc71bc399304c37846ede31d7009096da4449f9bc8e88f267493' },
});
const sessions = new WeakMap(), reviews = new WeakMap(), permits = new WeakMap(), handoffs = new WeakMap(), invocations = new WeakMap();
const serviceReviews = new WeakMap();
const inventories = new WeakMap(), candidateReviews = new WeakMap(), targetHandoffs = new WeakMap();
const contextPermits = new WeakMap(), contextSlots = new WeakMap(), slotRecords = new WeakMap(), contextAcceptances = new WeakMap();
const CATEGORIES = ['projectIds', 'environmentIds', 'serviceIds', 'serviceInstanceIds'];
function record(session) { const r = sessions.get(session); if (!r) fail();if(r.acquisition)r.acquisition.lifecycleCarrier.check(); return r; }
function startTargetIdentitySession(...args) {
 // A located genuine permit burns even when arity/binding is wrong.
 let acquisition = null;
 try { if (args.length > 1 && consumeAcquisitionTarget) acquisition = consumeAcquisitionTarget(args[1],args[0],...args.slice(2)); }
 catch { fail(); }
 if (args.length !== 1 && args.length !== 2 || args.length === 2 && !acquisition) fail(); let target;
 try { target = targets.describeTarget(args[0]); } catch { fail(); }
 if (acquisition) {
  if(typeof acquisition.lifecycleCarrier?.check!=='function')fail();acquisition.lifecycleCarrier.check();
  for (const k of ['projectId','environmentId','serviceId','serviceInstanceId','environmentKind','lifecycle'])
   if (acquisition.expectedTarget[k] !== target[k]) fail();
 }
 const session = Object.freeze({});
 sessions.set(session, { binding: args[0], target, acquisition, stage: 'context_expected', revision: 0, executionContext: null,
  contextFacts: null, serviceFacts: null, serviceObservation: null, serviceReviewIssued: false, serviceApproval: null, instanceFacts: null, activeHandoff: null, activeInvocation: null, candidate: null, contextTransferLock: null });
 return session;
}
function inspectSession(...args) {
 if (args.length !== 1) fail(); const r = record(args[0]);
 const sources = { projectId: 'provider_project_token_context', environmentId: 'provider_project_token_context',
  serviceId: 'provider_project_services', serviceInstanceId: 'provider_service_instance_metadata' };
 return freeze({ outcome: r.candidate ? 'TARGET_IDENTITY_CANDIDATE' : 'TARGET_IDENTITY_UNRESOLVED', stage: r.stage, expectations: {...expectations,serviceName:r.acquisition?.expectedTarget.serviceName ?? null},
  ids: Object.fromEntries(Object.keys(sources).map(k => [k, { operatorExpectedValue: r.target[k],
   providerObservedValue: k === 'serviceId' ? r.serviceFacts?.serviceId ?? null : k === 'serviceInstanceId' ? r.instanceFacts?.serviceInstanceId ?? null : r.contextFacts?.[k] ?? null,
   expectedSource: 'operator_expected_constraint', providerEvidenceSource: sources[k] }])),
  projectNameObserved: null, environmentNameObserved: null, providerObserved: r.candidate !== null, globalAuthority: state });
}
function validateProjectServices(...args) {
 if (args.length !== 2) fail(); const [session, body] = args, r = record(session);
 if (!r.acquisition) fail(); const expected = r.acquisition.expectedTarget, projectId = r.target.projectId; identifier(projectId);
 exact(body, ['data']); exact(body.data, ['project']); exact(body.data.project, ['id', 'services']);
 const project = body.data.project; if (identifier(project.id) !== projectId) fail();
 exact(project.services, ['edges', 'pageInfo']); exact(project.services.pageInfo, ['hasNextPage']);
 // Require the complete single connection before inspecting/selecting edges.
 // No cursor, traversal, follow-up request or fallback is supported.
 if (project.services.pageInfo.hasNextPage !== false) fail();
 const edges = project.services.edges;
 if (!Array.isArray(edges) || edges.length > 256) fail();
 const ids = new Set(), names = new Set(); let selected = null;
 for (const edge of edges) {
  exact(edge, ['node']); exact(edge.node, ['id', 'name']); const id = identifier(edge.node.id), name = label(edge.node.name);
  if (ids.has(id) || names.has(name)) fail(); ids.add(id); names.add(name);
  if (name === expected.serviceName) { if (selected) fail(); selected = { serviceId: id, serviceName: name }; }
 }
 if (!selected || selected.serviceId !== expected.serviceId) fail(); return freeze({ ...selected, validationOnly: true, serviceContextProven: false });
}
function validateServiceInstance(...args) {
 if (args.length !== 2) fail(); const [session,body] = args, r = record(session); if (!r.acquisition) fail();
 const expected = r.acquisition.expectedTarget; exact(body, ['data']); exact(body.data, ['serviceInstance']);
 const value = body.data.serviceInstance; exact(value, ['id', 'serviceName', 'rootDirectory', 'region']);
 const serviceInstanceId = identifier(value.id); if (value.serviceName !== expected.serviceName || expected.serviceInstanceId !== null && serviceInstanceId !== expected.serviceInstanceId) fail();
 if (value.rootDirectory !== null && value.rootDirectory !== expectations.rootDirectory) fail();
 if (value.region !== null) label(value.region);
 return freeze({ serviceInstanceId, serviceName: value.serviceName, rootDirectory: value.rootDirectory, region: value.region,
  validationOnly: true, serviceContextProven: false });
}
function prepareContextTransferPermit(...args) {
 if (args.length !== 4) fail(); const [session, binding, executionContext, handoff] = args, r = record(session);
 if (r.binding !== binding || r.stage !== 'context_expected' || r.contextTransferLock ||
  !executionContext || typeof executionContext !== 'object' || !handoff || typeof handoff !== 'object') fail();
 const permit = Object.freeze({});
 contextPermits.set(permit, { session, binding, executionContext, handoff, revision: r.revision }); r.contextTransferLock = permit; return permit;
}
function takeContextTransferPermit(...args) {
 const e = contextPermits.get(args[0]); if (!e) fail(); contextPermits.delete(args[0]); const r = record(e.session);
 try {
  if (args.length !== 3 || args[1] !== e.executionContext || args[2] !== e.handoff || r.binding !== e.binding ||
   r.stage !== 'context_expected' || r.revision !== e.revision || r.contextTransferLock !== args[0]) fail();
  const slot = Object.freeze({}); const entry = { ...e, slot, phase: 'bound', acceptance: null };
  contextSlots.set(slot, entry); slotRecords.set(slot, entry); r.contextTransferLock = slot;
  return freeze({ ...e, slot });
 } catch { r.stage = 'failed'; r.contextTransferLock = null; fail(); }
}
function assertContextTransferSlot(...args) {
 if (args.length !== 1) fail(); const e = contextSlots.get(args[0]); if (!e) fail(); const r = record(e.session);
 if (e.phase !== 'bound' || r.contextTransferLock !== e.slot || r.binding !== e.binding || r.stage !== 'context_expected' || r.revision !== e.revision) fail();
}
function cancelContextTransferSlot(...args) {
 if (args.length !== 1) fail(); const e = slotRecords.get(args[0]); if (!e) return;
 slotRecords.delete(e.slot); contextSlots.delete(e.slot); if (e.acceptance) contextAcceptances.delete(e.acceptance);
 e.phase = 'cancelled'; const r = record(e.session); r.stage = 'failed'; r.contextFacts = null; r.executionContext = null; r.contextTransferLock = null;
}
function takeContextTransferSlot(...args) {
 const e = contextSlots.get(args[0]); if (!e) fail(); contextSlots.delete(args[0]); const r = record(e.session);
 try {
  if (args.length !== 2 || args[1] !== e.session || e.phase !== 'bound' || r.contextTransferLock !== e.slot ||
   r.binding !== e.binding || r.stage !== 'context_expected' || r.revision !== e.revision) fail();
  const acceptance = Object.freeze({}); e.acceptance = acceptance; e.phase = 'taken'; contextAcceptances.set(acceptance, e);
  return freeze({ session: e.session, binding: e.binding, executionContext: e.executionContext, handoff: e.handoff, slot: e.slot, acceptance });
 } catch { cancelContextTransferSlot(e.slot); fail(); }
}
function takeContextTransferAcceptance(...args) {
 const e = contextAcceptances.get(args[0]); if (!e) fail(); contextAcceptances.delete(args[0]); const r = record(e.session);
 try {
  if (args.length !== 2 || args[1] !== e.session || e.phase !== 'accepted' || r.contextTransferLock !== e.slot ||
   r.binding !== e.binding || r.stage !== 'project_services' || r.revision !== e.revision + 1 || r.executionContext !== e.executionContext || !r.contextFacts) fail();
  e.phase = 'done'; slotRecords.delete(e.slot); r.contextTransferLock = null;
  return freeze({ session: e.session, binding: e.binding, executionContext: e.executionContext, handoff: e.handoff, facts: r.contextFacts });
 } catch { cancelContextTransferSlot(e.slot); fail(); }
}
const contextTransfer = Object.freeze({ preparePermit: prepareContextTransferPermit, takePermit: takeContextTransferPermit,
 assertSlot: assertContextTransferSlot, takeSlot: takeContextTransferSlot, takeAcceptance: takeContextTransferAcceptance, cancelSlot: cancelContextTransferSlot,
 status: freeze({ targetIdentityResultBridgeReady: true, providerResultIngressConnected: false }) });
function acceptContextObservation(...args) {
 if (args.length !== 2) fail(); const [session, result] = args, r = record(session);
 if (r.stage !== 'context_expected') fail();
 let observed;
 try {
  observed = provider.takeObservation(result, session);
  if (observed.kind !== 'project_token_context' || observed.session !== session || observed.binding !== r.binding ||
   !observed.executionContext || typeof observed.executionContext !== 'object' ||
   observed.endpoint !== 'https://backboard.railway.com/graphql/v2' || observed.authKind !== 'project_token' ||
   canonical(observed.request) !== canonical(context.buildRequest())) fail();
  const facts = context.validateContextResponse(r.binding, observed.body);
  let transfer;
  if (r.contextTransferLock) {
   transfer = contextAcceptances.get(observed.acceptance);
   if (!transfer || transfer.phase !== 'taken' || transfer.slot !== r.contextTransferLock || transfer.session !== session ||
    transfer.binding !== r.binding || transfer.executionContext !== observed.executionContext || transfer.revision !== r.revision || !observed.completion) fail();
  }
  r.contextFacts = facts;
  r.executionContext = observed.executionContext; r.stage = 'project_services'; r.revision++;
  if (transfer) { transfer.phase = 'accepted'; adapter.consumeContextResultTransfer(observed.completion, session); }
  return inspectSession(session);
 } catch {
  if (r.contextTransferLock) cancelContextTransferSlot(r.contextTransferLock);
  if (observed?.completion) { try { adapter.closeExecutionContext(observed.executionContext); } catch {} }
  r.stage = 'failed'; r.contextFacts = null; r.executionContext = null; fail();
 }
}
function requestFor(r) {
 const key = r.stage === 'project_services' ? 'projectServices' : r.stage === 'service_instance' ? 'serviceInstance' : null;
 if (!key || !r.contextFacts || !r.executionContext || !r.acquisition) fail();
 if (key === 'serviceInstance') {
  const a = r.serviceApproval;
  if (!a || a.facts !== r.serviceFacts || a.observation !== r.serviceObservation || a.binding !== r.binding ||
   a.executionContext !== r.executionContext || a.revision !== r.revision) fail();
 }
 const doc = documents[key];
 if (hash(doc.source + '\n') !== doc.canonicalSha256) fail();
 const variables = key === 'projectServices' ? { id: r.contextFacts.projectId } : { serviceId: r.serviceFacts.serviceId, environmentId: r.contextFacts.environmentId };
 return freeze({ query: doc.source, operationName: doc.operationName, variables });
}
function reviewNextIdentityRequest(...args) {
 if (args.length !== 1) fail(); const session = args[0], r = record(session), request = requestFor(r);
 const meta = freeze({ stage: r.stage, operationName: request.operationName, querySha256: hash(request.query + '\n'),
  variablesSha256: hash(canonical(request.variables)), targetSha256: r.target.targetSha256, sameExecutionContextRequired: true,
  manualLiveAuthorizationRequired: true, liveAuthorized: false });
 const review = freeze({ meta, artifacts: { graphql: request.query + '\n', variablesJson: JSON.stringify(request.variables) + '\n', metaJson: JSON.stringify(meta) + '\n' } });
 reviews.set(review, { session, binding: r.binding, executionContext: r.executionContext, stage: r.stage, revision: r.revision, request, meta });
 return review;
}
function validStage(entry) {
 const r = record(entry.session);
 if (r.binding !== entry.binding || r.executionContext !== entry.executionContext || r.stage !== entry.stage || r.revision !== entry.revision) fail();
 return r;
}
function approveIdentityReview(...args) {
 const entry = reviews.get(args[0]); if (!entry) fail(); reviews.delete(args[0]);
 if (args.length !== 2) fail(); validStage(entry); const ack = args[1]; exact(ack, ['reviewed', ...Object.keys(entry.meta)]);
 if (ack.reviewed !== true) fail(); for (const key of Object.keys(entry.meta)) if (ack[key] !== entry.meta[key]) fail();
 const permit = Object.freeze({}); permits.set(permit, entry); return permit;
}
function consumeIdentityPermitForFutureAdapter(...args) {
 const entry = permits.get(args[0]); if (!entry) fail(); permits.delete(args[0]);
 if (args.length !== 2 || args[1] !== entry.session) fail(); const r = validStage(entry);
 const handoff = Object.freeze({}); handoffs.set(handoff, entry); r.activeHandoff = handoff; r.stage = entry.stage + '_pending'; return handoff;
}
function takeIdentityHandoffForFutureAdapter(...args) {
 const entry = handoffs.get(args[0]); if (!entry) fail(); handoffs.delete(args[0]); const r = record(entry.session);
 try {
  if (args.length !== 3 || args[1] !== entry.session || args[2] !== entry.executionContext || r.activeHandoff !== args[0] ||
   r.stage !== entry.stage + '_pending' || r.revision !== entry.revision) fail();
  const invocation = Object.freeze({}); invocations.set(invocation, entry); r.activeHandoff = null; r.activeInvocation = invocation;
  return freeze({ kind: entry.stage, session: entry.session, binding: entry.binding, executionContext: entry.executionContext, request: entry.request, invocation });
 } catch { r.stage = 'failed'; r.activeHandoff = null; fail(); }
}
function acceptIdentityObservation(...args) {
 const entry = invocations.get(args[1]); if (!entry) fail(); invocations.delete(args[1]);
 const r = record(entry.session);
 try {
  if (args.length !== 3 || args[0] !== entry.session || r.activeInvocation !== args[1] || r.stage !== entry.stage + '_pending' || r.revision !== entry.revision) fail();
  const observed = provider.takeObservation(args[2]);
  if (observed.kind !== entry.stage || observed.session !== entry.session || observed.binding !== entry.binding ||
   observed.invocation !== args[1] || observed.executionContext !== entry.executionContext ||
   observed.endpoint !== 'https://backboard.railway.com/graphql/v2' || observed.authKind !== 'project_token' ||
   canonical(observed.request) !== canonical(entry.request)) fail();
  if (entry.stage === 'project_services') {
   const facts = validateProjectServices(entry.session, observed.body);
   if (facts.serviceId !== r.target.serviceId) fail(); r.serviceFacts = facts; r.serviceObservation = observed; r.stage = 'service_review';
  } else {
   const facts = validateServiceInstance(entry.session, observed.body);
   if (r.target.serviceInstanceId !== null && facts.serviceInstanceId !== r.target.serviceInstanceId) fail();
   r.instanceFacts = facts; r.stage = 'candidate';
   r.candidate = freeze({ projectId: r.contextFacts.projectId, environmentId: r.contextFacts.environmentId,
    serviceId: r.serviceFacts.serviceId, serviceInstanceId: facts.serviceInstanceId, projectNameExpected: expectations.projectName,
    projectNameObserved: null, environmentNameObserved: null, serviceNameExpected: r.acquisition.expectedTarget.serviceName, serviceNameObserved: facts.serviceName,
    expectedServiceId:r.acquisition.expectedTarget.serviceId,observedServiceId:r.serviceFacts.serviceId,manifestSha256:r.acquisition.manifestSha256,
    rootDirectoryObserved: facts.rootDirectory, regionObserved: facts.region,
    evidence: { projectEnvironment: 'provider_project_token_context', service: 'provider_project_services', serviceInstance: 'provider_service_instance_metadata' },
    providerObserved: true, humanReviewed: false, serviceContextProven: false });
  }
  r.activeInvocation = null; r.revision++; return inspectSession(entry.session);
 } catch { r.stage = 'failed'; r.activeInvocation = null; fail(); }
}
// Descriptive review bytes never serve as authority. Only the original review
// in this module's private pool can advance its original observation/session.
function reviewObservedServiceCandidate(...args) {
 if (args.length !== 1) fail(); const session = args[0], r = record(session);
 if (r.stage !== 'service_review' || !r.serviceFacts || !r.serviceObservation || r.serviceReviewIssued || r.serviceApproval) fail();
 const candidate = freeze({ observedServiceId: r.serviceFacts.serviceId, observedServiceName: r.serviceFacts.serviceName,
  expectedServiceId: r.target.serviceId, expectedServiceName: r.acquisition.expectedTarget.serviceName, manifestSha256:r.acquisition.manifestSha256, providerObserved: true,
  evidenceSource: 'provider_project_services', projectId: r.contextFacts.projectId, environmentId: r.contextFacts.environmentId,
  projectNameExpected: expectations.projectName, environmentNameExpected: expectations.environmentName,
  projectNameObserved: null, environmentNameObserved: null, parentContextEvidenceSource: 'provider_project_token_context' });
 const review = freeze({ candidate, revision: r.revision, liveAuthorized: false });
 serviceReviews.set(review, { session, binding: r.binding, executionContext: r.executionContext, contextFacts: r.contextFacts,
  facts: r.serviceFacts, observation: r.serviceObservation, revision: r.revision, candidate });
 r.serviceReviewIssued = true; return review;
}
function approveObservedServiceCandidate(...args) {
 const e = serviceReviews.get(args[0]); if (!e) fail(); serviceReviews.delete(args[0]); // Burn before arity, ownership or acknowledgement.
 if (args.length !== 3 || args[1] !== e.session) fail(); const r = record(e.session);
 if (r.stage !== 'service_review' || r.revision !== e.revision || r.binding !== e.binding ||
  r.executionContext !== e.executionContext || r.contextFacts !== e.contextFacts || r.serviceFacts !== e.facts ||
  r.serviceObservation !== e.observation || r.serviceApproval) fail();
 const ack = args[2]; exact(ack, ['reviewed', 'candidate', 'revision', 'liveAuthorized']);
 if (ack.reviewed !== true || ack.revision !== e.revision || ack.liveAuthorized !== false ||
  canonical(ack.candidate) !== canonical(e.candidate)) fail();
 r.revision++; r.serviceApproval = { facts: e.facts, observation: e.observation, binding: e.binding,
  executionContext: e.executionContext, revision: r.revision };
 r.stage = 'service_instance'; return inspectSession(e.session);
}
function reviewForbiddenInventory(...args) {
 if (args.length !== 2) fail(); const [binding, value] = args; let target;
 try { target = targets.describeTarget(binding); } catch { fail(); }
 exact(value, ['inventoryReviewed', 'basis', 'provenance', ...CATEGORIES]);
 if (value.inventoryReviewed !== true) fail(); label(value.basis); label(value.provenance);
 const normalized = { inventoryReviewed: true, basis: value.basis, provenance: value.provenance };
 for (const category of CATEGORIES) {
  const e = value[category]; exact(e, ['reviewed', 'completenessAcknowledged', 'completenessIsOperatorAssertion', 'ids', 'labels']);
  if (e.reviewed !== true || e.completenessAcknowledged !== true || e.completenessIsOperatorAssertion !== true ||
   !Array.isArray(e.ids) || e.ids.length > 256 || new Set(e.ids).size !== e.ids.length || !Array.isArray(e.labels) || e.labels.length > e.ids.length) fail();
  e.ids.forEach(identifier); const seen = new Set();
  const labels = e.labels.map(v => { exact(v, ['id', 'label']); identifier(v.id); label(v.label);
   if (!e.ids.includes(v.id) || seen.has(v.id)) fail(); seen.add(v.id); return { id: v.id, label: v.label }; });
  const actual = target[category.slice(0, -1)]; if (actual !== null && e.ids.includes(actual)) fail();
  normalized[category] = { reviewed: true, completenessAcknowledged: true, completenessIsOperatorAssertion: true, ids: e.ids.slice(), labels };
 }
 const review = freeze({ inventory: normalized, inventorySha256: hash(canonical(normalized)), crossSystemForbidden });
 inventories.set(review, { binding, inventory: review.inventory }); return review;
}
function reviewTargetCandidate(...args) {
 if (args.length !== 1) fail(); const r = record(args[0]); if (r.stage !== 'candidate' || !r.candidate) fail();
 const review = freeze({ candidate: r.candidate, candidateSha256: hash(canonical(r.candidate)), liveAuthorized: false });
 candidateReviews.set(review, { session: args[0], revision: r.revision }); return review;
}
function approveTargetCandidate(...args) {
 const entry = candidateReviews.get(args[0]); if (!entry) fail(); candidateReviews.delete(args[0]);
 if (args.length !== 3) fail(); const r = record(entry.session), inventoryReview = args[1], inventory = inventories.get(inventoryReview);
 if (r.stage !== 'candidate' || r.revision !== entry.revision || !inventory || inventory.binding !== r.binding) fail();
 const ack = args[2]; exact(ack, ['reviewed', 'candidate', 'candidateSha256', 'inventorySha256', 'noForbiddenCollision', 'intendedDisposableNonProduction']);
 if (ack.reviewed !== true || ack.noForbiddenCollision !== true || ack.intendedDisposableNonProduction !== true ||
  canonical(ack.candidate) !== canonical(r.candidate) || ack.candidateSha256 !== args[0].candidateSha256 || ack.inventorySha256 !== inventoryReview.inventorySha256) fail();
 for (const category of CATEGORIES) if (inventory.inventory[category].ids.includes(r.candidate[category.slice(0, -1)])) fail();
 r.stage = 'reviewed'; r.revision++;
 const handoff = Object.freeze({}); targetHandoffs.set(handoff, { binding: r.binding, candidate: freeze({ ...r.candidate, humanReviewed: true }), inventory: inventory.inventory }); return handoff;
}
function takeReviewedTargetFor0110(...args) {
 const entry = targetHandoffs.get(args[0]); if (!entry) fail(); targetHandoffs.delete(args[0]);
 if (args.length !== 2 || args[1] !== entry.binding) fail(); targets.describeTarget(entry.binding);
 const legacy = freeze({ inventoryReviewed: true, ...Object.fromEntries(CATEGORIES.map(k => [k, entry.inventory[k].ids])) });
 const scope = { environmentKind: 'disposable', lifecycle: 'active', projectId: entry.candidate.projectId,
  environmentId: entry.candidate.environmentId, serviceId: entry.candidate.serviceId, serviceInstanceId: entry.candidate.serviceInstanceId };
 const privateTarget = targets.bindTarget(scope, scope, legacy);
 return freeze({ privateTarget, reviewedCandidate: entry.candidate,
  inventoryFor0110: { inventoryReviewed: true, ...Object.fromEntries(CATEGORIES.map(k => [k, { reviewed: true, ids: entry.inventory[k].ids }])) },
  inventoryProvenance: entry.inventory, liveAuthorized: false });
}
function reviewTemplate(...args) {
 if (args.length) fail(); return freeze({ notice: 'TARGET IDENTITY NOT OBSERVED', outcome: 'TARGET_IDENTITY_UNRESOLVED',
  ids: { projectId: null, environmentId: null, serviceId: null, serviceInstanceId: null }, expectations,
  observed: null, providerObserved: false, humanReviewed: false, manualLiveAuthorization: false, globalAuthority: state,
  forbiddenRailwayInventory: { inventoryReviewed: false, basis: null, provenance: null,
   ...Object.fromEntries(CATEGORIES.map(k => [k, { reviewed: false, completenessAcknowledged: false, completenessIsOperatorAssertion: true, ids: null, labels: [] }])) },
  crossSystemForbidden, documents });
}
module.exports = Object.assign(Object.create(null), { state, documents, contextTransfer, startTargetIdentitySession, inspectSession,
 validateProjectServices, validateServiceInstance, acceptContextObservation, reviewNextIdentityRequest,
 approveIdentityReview, consumeIdentityPermitForFutureAdapter, takeIdentityHandoffForFutureAdapter, acceptIdentityObservation, reviewForbiddenInventory,
 reviewObservedServiceCandidate, approveObservedServiceCandidate, reviewTargetCandidate, approveTargetCandidate, takeReviewedTargetFor0110, reviewTemplate });
Object.defineProperty(module.exports,'_connectAcquisitionTargetConsumer',{configurable:true,value(...args){
 if (args.length !== 1 || consumeAcquisitionTarget || typeof args[0] !== 'function') fail();
 consumeAcquisitionTarget = args[0]; Reflect.deleteProperty(module.exports,'_connectAcquisitionTargetConsumer'); Object.freeze(module.exports);
}});
// Export the private initialization slot before entering either side of the cycle.
require('./qualification-railway-live-authorization.cjs');
