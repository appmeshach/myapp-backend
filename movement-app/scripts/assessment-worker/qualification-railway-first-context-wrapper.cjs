'use strict';
// One-shot only. Import never opens a context; no continuation resource escapes.
const liveAuthorization = require('./qualification-railway-live-authorization.cjs');
const adapter = require('./qualification-railway-https-adapter.cjs');
const identity = require('./qualification-railway-target-identity.cjs');
const fail = () => { throw Error('Railway first-context wrapper unavailable'); };
function requireGlobalState(state) {
 for (const key of ['providerContextObserved', 'projectEnvironmentContextProven', 'serviceContextProven', 'executionSchemaReady'])
  if (state[key] !== false) fail();
 for (const key of ['identity_proven', 'causality_proven', 'restart_origin_proven', 'platformRestart'])
  if (state[key] !== null) fail();
}
async function runFirstContext(...args) {
 let executionContext, complete = false;
 try {
  // Forward arity to the owner so a genuine authority with extras is burned.
  const extracted = liveAuthorization.takeFirstContextExecutionAuthority(...args);
  if (args.length !== 1 || extracted.operationKind !== 'project_token_context') fail();
  const target = extracted.privateTarget, handoff = extracted.contextHandoff;
  executionContext = adapter.openExecutionContext(target);
  const session = identity.startTargetIdentitySession(target);
  const permit = identity.contextTransfer.preparePermit(session, target, executionContext, handoff);
  const binding = adapter.bindContextResultTransfer(executionContext, handoff, permit);
  const result = await adapter.executeHandoff(executionContext, handoff);
  const receipt = adapter.prepareContextResultTransfer(result, binding);
  identity.acceptContextObservation(session, receipt);
  const status = identity.inspectSession(session);
  if (status.stage !== 'project_services' || status.outcome !== 'TARGET_IDENTITY_UNRESOLVED' ||
   status.ids.projectId.providerObservedValue == null || status.ids.environmentId.providerObservedValue == null ||
   status.ids.serviceId.providerObservedValue !== null || status.ids.serviceInstanceId.providerObservedValue !== null ||
   status.providerObserved !== false || identity.state.targetIdentityObserved !== false || identity.state.providerResultIngressConnected !== false) fail();
  for (const state of [status.globalAuthority, identity.state, adapter.status, liveAuthorization.state]) requireGlobalState(state);
  let candidateReviewable = false;
  try { identity.reviewTargetCandidate(session); candidateReviewable = true; } catch {}
  if (candidateReviewable) fail();
  complete = true;
 } catch {
  complete = false; // Never expose underlying errors, inspection records or bodies.
 } finally {
  if (executionContext) {
   try { adapter.closeExecutionContext(executionContext); } catch { complete = false; }
  }
 }
 if (!complete) fail();
 return Object.freeze({ outcome: 'TARGET_IDENTITY_UNRESOLVED', stage: 'project_services', contextObservationAccepted: true,
  serviceObserved: false, targetIdentityObserved: false, manualLiveAuthorizationConsumed: true });
}
module.exports = Object.freeze({ runFirstContext });
