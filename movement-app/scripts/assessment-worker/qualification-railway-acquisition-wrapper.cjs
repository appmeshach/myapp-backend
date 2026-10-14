'use strict';
// Synchronous initialization only: no connector or redemption function survives
// a completed ordinary import. The literal authorization owner supplies it.
let redeemTicket = null;
const exported = Object.assign(Object.create(null), { beginAuthorizedAcquisition, takePendingHumanReview, submitServiceReview, submitTargetReview, cancelAcquisition });
module.exports = exported;
Object.defineProperty(exported, '_connectAcquisitionRedemption', { configurable: true, value(...args) {
 if (args.length !== 1 || redeemTicket || typeof args[0] !== 'function') throw Error('Railway acquisition unavailable');
 redeemTicket = args[0]; Reflect.deleteProperty(exported, '_connectAcquisitionRedemption'); Object.freeze(exported);
} });
const authorization = require('./qualification-railway-live-authorization.cjs');
const identity = require('./qualification-railway-target-identity.cjs');
const adapter = require('./qualification-railway-https-adapter.cjs');
const { performance } = require('node:perf_hooks');
const HUMAN_WAIT_MS = 300000;
const runs = new WeakMap(), serviceGates = new WeakMap(), targetGates = new WeakMap(), issuedResults = new WeakMap();
const fail = () => { throw Error('Railway acquisition unavailable'); };
const freeze = v => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
function globals() {
 for (const state of [authorization.state, identity.state, adapter.status]) {
  for (const key of ['providerContextObserved','projectEnvironmentContextProven','serviceContextProven','executionSchemaReady']) if (state[key] !== false) fail();
  for (const key of ['identity_proven','causality_proven','restart_origin_proven','platformRestart']) if (state[key] !== null) fail();
 }
 if (identity.state.targetIdentityObserved !== false) fail();
}
function current(e, stage) {
 if (e.terminal || runs.get(e.handle) !== e || identity.inspectSession(e.session).stage !== stage) fail();
 globals();
}
function burnGate(e) {
 clearTimeout(e.timer); e.timer = null;
 if (e.review) {
  serviceGates.delete(e.review); targetGates.delete(e.review);
  // Existing consumers burn the genuine review before rejecting missing arity.
  try {
   if (e.phase === 'service_review') identity.approveObservedServiceCandidate(e.review);
   else if (e.phase === 'candidate') identity.approveTargetCandidate(e.review);
  } catch {}
 }
 e.review = null;
}
function terminate(e) {
 if (e.terminal) return;
 e.terminal = true; runs.delete(e.handle); burnGate(e); issuedResults.delete(e.handle);
 const c = e.executionContext; e.executionContext = null;
 try { if (c) adapter.closeExecutionContext(c); }
 finally { e.session = null; e.target = null; e.inventoryReview = null; e.contextHandoff = null; }
}
function gate(e, phase, review) {
 current(e, phase); e.phase = phase; e.review = review; e.promptTaken = false;
 e.deadline = performance.now() + HUMAN_WAIT_MS;
 (phase === 'service_review' ? serviceGates : targetGates).set(review, e);
 e.timer = setTimeout(() => { try { terminate(e); } catch {} }, HUMAN_WAIT_MS);
}
function requestHandoff(e, stage) {
 current(e, stage);
 const review = identity.reviewNextIdentityRequest(e.session);
 const permit = identity.approveIdentityReview(review, { ...review.meta, reviewed: true });
 return identity.consumeIdentityPermitForFutureAdapter(permit, e.session);
}
async function acquireServices(e) {
 try {
  const p = identity.contextTransfer.preparePermit(e.session,e.target,e.executionContext,e.contextHandoff);
  const b = adapter.bindContextResultTransfer(e.executionContext,e.contextHandoff,p);
  e.providerRequests++; const r = await adapter.executeHandoff(e.executionContext,e.contextHandoff);
  if (e.terminal) return;
  const t = adapter.prepareContextResultTransfer(r,b); identity.acceptContextObservation(e.session,t);
  current(e,'project_services');
  const h = requestHandoff(e,'project_services');
  const transfer = adapter.bindProjectServicesTransfer(e.executionContext,e.session,h);
  e.phase = 'project_services_pending'; e.providerRequests++;
  const result = await adapter.executeProjectServices(transfer); if (e.terminal) return;
  const receipt = adapter.prepareProjectServicesResult(result,transfer);
  identity.acceptIdentityObservation(e.session,receipt.invocation,receipt.result);
  current(e,'service_review'); if (e.providerRequests !== 2) fail();
  gate(e,'service_review',identity.reviewObservedServiceCandidate(e.session));
 } catch { try { terminate(e); } catch {} }
}
async function acquireInstance(e) {
 try {
  const h = requestHandoff(e,'service_instance');
  const transfer = adapter.bindServiceInstanceTransfer(e.executionContext,e.session,h);
  e.phase = 'service_instance_pending'; if (++e.providerRequests !== 3) fail();
  const result = await adapter.executeServiceInstance(transfer); if (e.terminal) return;
  const receipt = adapter.prepareServiceInstanceResult(result,transfer);
  identity.acceptIdentityObservation(e.session,receipt.invocation,receipt.result);
  current(e,'candidate'); gate(e,'candidate',identity.reviewTargetCandidate(e.session));
 } catch { try { terminate(e); } catch {} }
}
function beginAuthorizedAcquisition(...args) {
 let e;
 try {
  if (!redeemTicket) fail();
  const extracted = redeemTicket(...args);
  if (args.length !== 1 || extracted.operationKind !== 'target_identity_acquisition' ||
   extracted.executionPolicy.humanWaitMs !== HUMAN_WAIT_MS || extracted.executionPolicy.maxProviderRequests !== 3) fail();
  globals();
  const handle = Object.freeze({});
  e = { handle, target: extracted.privateTarget, contextHandoff: extracted.contextHandoff, inventoryReview: extracted.inventoryReview,
   session: null, executionContext: null, terminal: false, phase: 'context_expected', review: null, timer: null, deadline: null,
   promptTaken: false, providerRequests: 0 };
  e.session = identity.startTargetIdentitySession(e.target);
  e.executionContext = adapter.openExecutionContext(e.target);
  runs.set(handle,e); void acquireServices(e); return handle;
 } catch { if (e) { try { terminate(e); } catch {} } fail(); }
}
function locate(handle) { const e = runs.get(handle); if (!e || e.terminal) fail(); return e; }
function takePendingHumanReview(...args) {
 const e = locate(args[0]);
 try {
  if (args.length !== 1) fail();
  if (!e.review) return freeze({ stage: e.phase, review: null });
  if (performance.now() >= e.deadline || e.promptTaken) fail();
  current(e,e.phase); e.promptTaken = true;
  return freeze({ stage: e.phase, review: e.review, humanWaitMs: HUMAN_WAIT_MS,
   inventoryReview: e.phase === 'candidate' ? { inventory: e.inventoryReview.inventory, inventorySha256: e.inventoryReview.inventorySha256 } : null });
 } catch { try { terminate(e); } catch {} fail(); }
}
function submitServiceReview(...args) {
 const e = locate(args[0]), owned = serviceGates.get(args[1]);
 if (owned) serviceGates.delete(args[1]);
 try {
  if (args.length !== 3 || owned !== e || !e.promptTaken || args[1] !== e.review || e.phase !== 'service_review' || performance.now() >= e.deadline) fail();
  current(e,'service_review'); clearTimeout(e.timer); e.timer = null;
  identity.approveObservedServiceCandidate(e.review,e.session,args[2]); e.review = null;
  current(e,'service_instance'); e.phase = 'service_instance'; void acquireInstance(e);
  return Object.freeze({ stage: 'service_instance', humanServiceReviewAccepted: true });
 } catch { if (owned && owned !== e) { try { terminate(owned); } catch {} } try { terminate(e); } catch {} fail(); }
}
function submitTargetReview(...args) {
 const e = locate(args[0]), owned = targetGates.get(args[1]);
 if (owned) targetGates.delete(args[1]);
 try {
  if (args.length !== 3 || owned !== e || !e.promptTaken || args[1] !== e.review || e.phase !== 'candidate' || performance.now() >= e.deadline) fail();
  current(e,'candidate'); clearTimeout(e.timer); e.timer = null;
  const handoff = identity.approveTargetCandidate(e.review,e.inventoryReview,args[2]); e.review = null;
  current(e,'reviewed'); if (e.providerRequests !== 3) fail();
  const reviewed = identity.takeReviewedTargetFor0110(handoff,e.target);
  const result = freeze({ outcome: 'TARGET_IDENTITY_REVIEWED', stage: 'reviewed', reviewedTarget: reviewed.reviewedCandidate,
   providerRequests: 3, manualLiveAuthorizationConsumed: true, liveAuthorized: false });
  // No target/qualification handoff escapes. Result issuance is private and one-use.
  terminate(e); issuedResults.set(e.handle,result);
  const issued = issuedResults.get(e.handle); issuedResults.delete(e.handle); return issued;
 } catch { if (owned && owned !== e) { try { terminate(owned); } catch {} } try { terminate(e); } catch {} fail(); }
}
function cancelAcquisition(...args) {
 const e = locate(args[0]);
 try { terminate(e); if (args.length !== 1) fail(); return Object.freeze({ outcome: 'ACQUISITION_CANCELLED' }); }
 catch { fail(); }
}
