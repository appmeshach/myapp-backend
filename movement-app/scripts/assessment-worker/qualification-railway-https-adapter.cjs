'use strict';
// Production path exists, but import reads no environment and sends no request.
// No transport/token/body/session injection; tests load separate VM instances.
const https = require('node:https');
const crypto = require('node:crypto');
const { TextDecoder, debuglog } = require('node:util');
const contract = require('./qualification-railway-transport-contract.cjs').contract;
const targets = require('./qualification-railway-introspection-target.cjs');
const reviews = require('./qualification-railway-context-review.cjs');
const contextValidator = require('./qualification-railway-project-token-context.cjs');
const plan = require('./qualification-railway-introspection-plan.cjs');
const builder = require('./qualification-railway-introspection-request.cjs');
const freeze = v => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
const safety = freeze({ timeoutMs: 10000, maxBodyBytes: 1024 * 1024, maxHeaderBytes: 16384,
 acceptedStatus: 200, jsonContentTypes: ['application/json', 'application/graphql-response+json'],
 charset: 'utf-8', redirects: false, retries: 0 });
const status = freeze({ adapterImplemented: true, transportContractReady: true, providerContextAttestationReady: true,
 providerContextObserved: false, projectEnvironmentContextProven: false, serviceContextProven: false,
 executionSchemaReady: false, identity_proven: null, causality_proven: null, restart_origin_proven: null,
 platformRestart: null, restartAttribution: { measurement: null, limitation: 'restart_origin_unattributable' } });
const contexts = new WeakMap(), results = new WeakMap();
const transferBindings = new WeakMap(), contextTransfers = new WeakMap();
const servicesBindings = new WeakMap(), servicesTransfers = new WeakMap(), servicesResults = new WeakMap(), servicesReceipts = new WeakMap();
const instanceBindings = new WeakMap(), instanceTransfers = new WeakMap(), instanceResults = new WeakMap(), instanceReceipts = new WeakMap();
const fail = () => { throw Error('Railway private HTTPS evidence unavailable'); };
const hash = v => crypto.createHash('sha256').update(v).digest('hex');
function requireQuietDiagnostics() {
 // Native https debug logs can contain connection options/headers. Inspect only
 // name presence and logger enabled-state, never NODE_DEBUG's environment value.
 if (Object.hasOwn(process.env, 'NODE_DEBUG') || debuglog('http').enabled || debuglog('https').enabled) fail();
}
function invalidate(record) {
 record.closed = true; record.attested = false; record.secret = null; record.identityAttestation = null;
 for (const [pool, handles] of [[servicesBindings, record.servicesBindings], [servicesTransfers, record.servicesTransfers],
  [servicesResults, record.servicesResults], [servicesReceipts, record.servicesReceipts],
  [instanceBindings, record.instanceBindings], [instanceTransfers, record.instanceTransfers],
  [instanceResults, record.instanceResults], [instanceReceipts, record.instanceReceipts]]) {
  for (const handle of handles) pool.delete(handle); handles.clear();
 }
 if (record.servicesAttempt) record.servicesAttempt.phase = 'cancelled';
 if (record.instanceAttempt) record.instanceAttempt.phase = 'cancelled';
 for (const result of record.results) results.delete(result);
 record.results.clear();
 for (const handle of record.transferBindings) {
  const e = transferBindings.get(handle); transferBindings.delete(handle);
  if (e) { try { e.owner.contextTransfer.cancelSlot(e.slot); } catch {} }
 }
 for (const handle of record.transfers) {
  const e = contextTransfers.get(handle); contextTransfers.delete(handle);
  if (e) { try { e.owner.contextTransfer.cancelSlot(e.slot); } catch {} }
 }
 record.transferBindings.clear(); record.transfers.clear(); record.transferBinding = null;
 if (record.cancel) { const cancel = record.cancel; record.cancel = null; cancel(); }
}
function openExecutionContext(...args) {
 if (args.length !== 1) fail();
 const binding = args[0];
 try { targets.describeTarget(binding); } catch { fail(); }
 // The only production credential read; never invoked against real env in tests.
 let secret;
 try {
  requireQuietDiagnostics();
  if (Object.hasOwn(process.env, 'RAILWAY_API_TOKEN') || !Object.hasOwn(process.env, 'RAILWAY_TOKEN')) fail();
  secret = process.env.RAILWAY_TOKEN;
  if (typeof secret !== 'string' || secret.length === 0) fail();
 } catch { fail(); }
 const handle = Object.freeze({});
 contexts.set(handle, { binding, secret, closed: false, attested: false, busy: false, cancel: null, results: new Set(),
  transferBindings: new Set(), transfers: new Set(), transferBinding: null, identityAttestation: null, servicesAttempt: null,
  servicesBindings: new Set(), servicesTransfers: new Set(), servicesResults: new Set(), servicesReceipts: new Set(),
  instanceAttempt: null, instanceBindings: new Set(), instanceTransfers: new Set(), instanceResults: new Set(), instanceReceipts: new Set() });
 return handle;
}
function closeExecutionContext(...args) {
 if (args.length !== 1) fail();
 const record = contexts.get(args[0]); if (!record) fail(); invalidate(record);
}
function post(record, request) {
 return new Promise((resolve, reject) => {
  let req, response, timer, settled = false;
  const stop = () => {
   if (settled) return; settled = true; clearTimeout(timer); record.cancel = null;
   try { response?.destroy(); } catch {}
   try { req?.destroy(); } catch {}
   reject(Error('Railway private HTTPS evidence unavailable'));
  };
  record.cancel = stop;
  timer = setTimeout(stop, safety.timeoutMs);
  try {
   requireQuietDiagnostics();
   // All options are fixed internally. agent:false avoids global-agent/proxy intake.
   req = https.request({ protocol: 'https:', hostname: 'backboard.railway.com', port: 443,
    path: '/graphql/v2', method: 'POST', agent: false, rejectUnauthorized: true,
    maxHeaderSize: safety.maxHeaderBytes,
    headers: { 'Content-Type': contract.contentType, 'Project-Access-Token': record.secret } }, res => {
    response = res;
    if (settled) { try { res.destroy(); } catch {} return; }
    try {
    res.on('error', stop); res.on('aborted', stop);
    let bytes = 0, chunks = [], expectedLength = null, ended = false;
    res.on('close', () => { if (!ended) stop(); });
    if (!res.headers || !Array.isArray(res.rawHeaders) || res.rawHeaders.length % 2 || !res.rawHeaders.every(v => typeof v === 'string')) { stop(); return; }
    const contentType = res.headers['content-type'], encoding = res.headers['content-encoding'], length = res.headers['content-length'];
    const count = (res.rawHeaders || []).filter((_, i) => i % 2 === 0).filter(v => typeof v === 'string' && v.toLowerCase() === 'content-type').length;
    if (res.statusCode !== safety.acceptedStatus || typeof contentType !== 'string' || count !== 1 ||
     !/^application\/(?:json|graphql-response\+json)(?:\s*;\s*charset\s*=\s*utf-8)?$/i.test(contentType.trim()) ||
     (encoding !== undefined && encoding !== 'identity')) { stop(); return; }
    if (length !== undefined) {
     if (typeof length !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(length)) { stop(); return; }
     expectedLength = Number(length);
     if (!Number.isSafeInteger(expectedLength) || expectedLength > safety.maxBodyBytes) { stop(); return; }
    }
    res.on('data', chunk => {
     if (settled) return;
     if (!Buffer.isBuffer(chunk)) { stop(); return; }
     bytes += chunk.length;
     if (bytes > safety.maxBodyBytes) { chunks = []; stop(); return; }
     chunks.push(chunk);
    });
    res.on('end', () => {
     ended = true; if (settled) return;
     if (expectedLength !== null && expectedLength !== bytes) { stop(); return; }
     let body;
     try {
      body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); chunks = [];
      if (!body || typeof body !== 'object' || Array.isArray(body)) { stop(); return; }
     } catch { stop(); return; }
     settled = true; clearTimeout(timer); record.cancel = null; resolve(body);
    });
    } catch { stop(); }
   });
   req.on('error', stop);
   req.end(JSON.stringify(request));
  } catch { stop(); }
 });
}
async function executeHandoff(...args) {
 if (args.length !== 2) fail();
 const [executionContext, handoff] = args, record = contexts.get(executionContext);
 if (!record || record.closed || record.busy) fail();
 record.busy = true;
 try {
  const invocation = reviews.takeAdapterHandoff(handoff, record.binding);
  if ((invocation.kind === 'schema' && !record.attested) || (invocation.kind === 'context' && record.attested)) fail();
  if (record.transferBinding) {
   const e = transferBindings.get(record.transferBinding);
   if (!e || e.handoff !== handoff || invocation.kind !== 'context' || !fixedContextRequest(invocation.request)) fail();
   requireOwner(e.owner).contextTransfer.assertSlot(e.slot);
  }
  const body = await post(record, invocation.request);
  if (record.closed) fail();
  const result = Object.freeze({});
  results.set(result, { executionContext, binding: record.binding, handoff, invocation,
   request: invocation.request, kind: invocation.kind, endpoint: contract.endpoint, authKind: contract.preferredAuthKind, body,
   transferBinding: record.transferBinding });
  record.results.add(result); return result;
 } catch { invalidate(record); fail(); }
}
function consumeResult(handle, kind) {
 const result = results.get(handle); if (!result) fail();
 results.delete(handle);
 const record = contexts.get(result.executionContext);
 if (record) record.results.delete(handle);
 if (!record || record.closed || result.binding !== record.binding || result.kind !== kind ||
  result.endpoint !== contract.endpoint || result.authKind !== contract.preferredAuthKind) {
  if (record) invalidate(record); fail();
 }
 return { result, record };
}
function consumeContextResult(...args) {
 if (args.length !== 1) fail();
 const { result, record } = consumeResult(args[0], 'context');
 try {
  if (record.attested) fail();
  const facts = contextValidator.validateContextResponse(record.binding, result.body);
  if (record.transferBinding) {
   const e = transferBindings.get(record.transferBinding); transferBindings.delete(record.transferBinding);
   record.transferBindings.delete(record.transferBinding); record.transferBinding = null;
   if (e) e.owner.contextTransfer.cancelSlot(e.slot);
  }
  record.attested = true; record.busy = false;
  return freeze({ providerContextObserved: true, projectEnvironmentContextProven: true,
   projectIdSha256: hash(facts.projectId), environmentIdSha256: hash(facts.environmentId),
   serviceContextProven: false, executionSchemaReady: false, identity_proven: null, causality_proven: null,
   restart_origin_proven: null, platformRestart: null,
   restartAttribution: { measurement: null, limitation: 'restart_origin_unattributable' } });
 } catch { invalidate(record); fail(); }
}
function consumeSchemaResult(...args) {
 if (args.length !== 1) fail();
 const { result, record } = consumeResult(args[0], 'schema');
 try {
  if (!record.attested || JSON.stringify(builder.buildRequest(result.invocation.session)) !== JSON.stringify(result.request)) fail();
  const evidence = plan.accept(result.invocation.session, result.body);
  record.busy = false; return evidence;
 } catch { invalidate(record); fail(); }
}
// Literal owner path, resolved only after initialization. No issuer/callback
// parameter. Each binding captures the owner instance and rejects replacement.
function requireOwner(expected = null) {
 const owner = require('./qualification-railway-target-identity.cjs');
 if (!owner.contextTransfer || (expected && owner !== expected) ||
  !['takePermit', 'assertSlot', 'takeSlot', 'takeAcceptance', 'cancelSlot'].every(k => typeof owner.contextTransfer[k] === 'function')) fail();
 return owner;
}
function fixedContextRequest(request) {
 return request?.operationName === 'Movement0108ProjectTokenContext' &&
  JSON.stringify(request) === JSON.stringify(contextValidator.buildRequest());
}
function bindContextResultTransfer(...args) {
 const record = contexts.get(args[0]); let slot, owner;
 try {
  owner = requireOwner();
  const e = owner.contextTransfer.takePermit(args[2], args[0], args[1]); slot = e.slot;
  if (args.length !== 3 || !record || record.closed || record.attested || record.busy || record.transferBinding || record.results.size ||
   record.binding !== e.binding || e.executionContext !== args[0] || e.handoff !== args[1]) fail();
  const handle = Object.freeze({});
  transferBindings.set(handle, { ...e, owner, record }); record.transferBinding = handle; record.transferBindings.add(handle); return handle;
 } catch {
  if (slot) { try { owner.contextTransfer.cancelSlot(slot); } catch {} }
  if (record) invalidate(record); fail();
 }
}
function prepareContextResultTransfer(...args) {
 // Same results table as ordinary consumption; independently burn both owned
 // inputs before argument validation. No second independently consumable R.
 const result = results.get(args[0]), e = transferBindings.get(args[1]);
 if (result) { results.delete(args[0]); contexts.get(result.executionContext)?.results.delete(args[0]); }
 if (e) { transferBindings.delete(args[1]); e.record.transferBindings.delete(args[1]); }
 try {
  if (args.length !== 2 || !result || !e) fail();
  const record = contexts.get(result.executionContext);
  if (record !== e.record || record.closed || record.attested || !record.busy || result.executionContext !== e.executionContext ||
   result.binding !== e.binding || result.handoff !== e.handoff || result.transferBinding !== args[1] || record.transferBinding !== args[1] ||
   result.kind !== 'context' || result.endpoint !== 'https://backboard.railway.com/graphql/v2' || result.authKind !== 'project_token' ||
   result.invocation.kind !== 'context' || result.invocation.binding !== e.binding || !fixedContextRequest(result.request) ||
   JSON.stringify(result.invocation.request) !== JSON.stringify(result.request)) fail();
  requireOwner(e.owner).contextTransfer.assertSlot(e.slot);
  const facts = contextValidator.validateContextResponse(e.binding, result.body);
  const receipt = Object.freeze({}); record.transferBinding = null;
  contextTransfers.set(receipt, { ...e, phase: 'receipt', facts, body: result.body, request: result.request }); record.transfers.add(receipt); return receipt;
 } catch {
  if (e) { try { e.owner.contextTransfer.cancelSlot(e.slot); } catch {} invalidate(e.record); }
  const record = result && contexts.get(result.executionContext); if (record) invalidate(record); fail();
 }
}
function consumeContextResultTransfer(...args) {
 const e = contextTransfers.get(args[0]); if (!e) fail(); contextTransfers.delete(args[0]); e.record.transfers.delete(args[0]);
 try {
  const owner = requireOwner(e.owner);
  // Owner consumers burn slot/acceptance before validating the expected session.
  const bound = e.phase === 'receipt' ? owner.contextTransfer.takeSlot(e.slot, args[1]) : owner.contextTransfer.takeAcceptance(e.acceptance, args[1]);
  const record = contexts.get(e.executionContext);
  if (args.length !== 2 || record !== e.record || record.closed || record.attested || !record.busy || record.binding !== e.binding ||
   bound.session !== e.session || bound.binding !== e.binding || bound.executionContext !== e.executionContext || bound.handoff !== e.handoff || !fixedContextRequest(e.request)) fail();
  if (e.phase === 'receipt') {
   const completion = Object.freeze({});
   contextTransfers.set(completion, { ...e, phase: 'completion', acceptance: bound.acceptance }); record.transfers.add(completion);
   // Only the original strict context body from R, never a reconstruction from
   // summaries/IDs or the generic record, headers, credential or invocation.
   return freeze({ kind: 'project_token_context', session: e.session, binding: e.binding, executionContext: e.executionContext,
    endpoint: 'https://backboard.railway.com/graphql/v2', authKind: 'project_token', request: e.request,
    body: e.body,
    acceptance: bound.acceptance, completion });
  }
  if (bound.facts.projectId !== e.facts.projectId || bound.facts.environmentId !== e.facts.environmentId) fail();
  // Retain completed original S/C attestation for the separate services path.
  // Ordinary context summaries still grant no identity-session provenance.
  record.identityAttestation = freeze({ session: e.session, binding: e.binding, executionContext: e.executionContext, owner, facts: bound.facts });
  record.attested = true; record.busy = false; return Object.freeze({ contextTransferComplete: true });
 } catch {
  try { e.owner.contextTransfer.cancelSlot(e.slot); } catch {} invalidate(e.record); fail();
 }
}
// Only this fixed operation is added. Requests come from the original identity
// owner; no request/body/credential/transport argument is accepted.
function requireServicesOwner(expected = null) {
 const owner = requireOwner(expected);
 if (!['takeIdentityHandoffForFutureAdapter', 'validateProjectServices'].every(k => typeof owner[k] === 'function')) fail();
 return owner;
}
function plainKeys(value, keys) {
 if (!value || typeof value !== 'object' || Array.isArray(value) ||
  Reflect.ownKeys(value).length !== keys.length || Object.keys(value).sort().join('|') !== keys.slice().sort().join('|')) fail();
 for (const key of keys) {
  const d = Object.getOwnPropertyDescriptor(value, key);
  if (!d || !d.enumerable || !Object.hasOwn(d, 'value')) fail();
 }
}
function fixedProjectServicesRequest(request, attestation, owner) {
 plainKeys(request, ['query', 'operationName', 'variables']); plainKeys(request.variables, ['id']);
 const doc = owner.documents?.projectServices;
 if (!doc || request.operationName !== 'Movement0111ProjectServices' || request.query !== doc.source ||
  hash(request.query + '\n') !== 'fa6231580d6acec3510c26f4be5972605a3648c4c47f7da73eaa24021b137833' ||
  doc.canonicalSha256 !== 'fa6231580d6acec3510c26f4be5972605a3648c4c47f7da73eaa24021b137833' ||
  request.variables.id !== attestation.facts.projectId) fail();
}
function assertServicesAttempt(e) {
 const record = contexts.get(e.executionContext), owner = requireServicesOwner(e.owner), attestation = record?.identityAttestation;
 if (record !== e.record || record.closed || !record.attested || !record.busy || record.servicesAttempt !== e ||
  record.binding !== e.binding || attestation !== e.attestation || attestation.session !== e.session ||
  attestation.executionContext !== e.executionContext || attestation.binding !== e.binding || attestation.owner !== owner) fail();
 fixedProjectServicesRequest(e.request, attestation, owner); return record;
}
function bindProjectServicesTransfer(...args) {
 const record = contexts.get(args[0]);
 try {
  const owner = requireServicesOwner();
  // The original H burns inside the owner before its session/context validation.
  const original = owner.takeIdentityHandoffForFutureAdapter(args[2], args[1], args[0]);
  const attestation = record?.identityAttestation;
  if (args.length !== 3 || !record || record.closed || !record.attested || record.busy || record.servicesAttempt ||
   record.results.size || record.transferBinding || record.transfers.size || !attestation ||
   original.kind !== 'project_services' || original.session !== args[1] || original.executionContext !== args[0] ||
   original.binding !== record.binding || attestation.session !== original.session || attestation.binding !== original.binding ||
   attestation.executionContext !== original.executionContext || attestation.owner !== owner) fail();
  fixedProjectServicesRequest(original.request, attestation, owner);
  const transfer = Object.freeze({}), e = { ...original, owner, record, attestation, phase: 'bound' };
  record.servicesAttempt = e; record.busy = true; servicesBindings.set(transfer, e); record.servicesBindings.add(transfer);
  return transfer;
 } catch { if (record) invalidate(record); fail(); }
}
async function executeProjectServices(...args) {
 const e = servicesBindings.get(args[0]); if (!e) fail();
 servicesBindings.delete(args[0]); e.record.servicesBindings.delete(args[0]);
 try {
  if (args.length !== 1 || e.phase !== 'bound') fail(); assertServicesAttempt(e);
  e.phase = 'dispatching'; servicesTransfers.set(args[0], e); e.record.servicesTransfers.add(args[0]);
  const body = await post(e.record, e.request); assertServicesAttempt(e);
  e.phase = 'responded'; const result = Object.freeze({});
  servicesResults.set(result, { entry: e, kind: 'project_services', session: e.session, binding: e.binding,
   executionContext: e.executionContext, invocation: e.invocation, request: e.request,
   endpoint: contract.endpoint, authKind: contract.preferredAuthKind, body: freeze(body) });
  e.record.servicesResults.add(result); return result;
 } catch { invalidate(e.record); fail(); }
}
function prepareProjectServicesResult(...args) {
 const result = servicesResults.get(args[0]), e = servicesTransfers.get(args[1]);
 if (result) { servicesResults.delete(args[0]); result.entry.record.servicesResults.delete(args[0]); }
 if (e) { servicesTransfers.delete(args[1]); e.record.servicesTransfers.delete(args[1]); }
 try {
  if (args.length !== 2 || !result || !e || e.phase !== 'responded' || result.entry !== e ||
   result.kind !== 'project_services' || result.session !== e.session || result.binding !== e.binding ||
   result.executionContext !== e.executionContext || result.invocation !== e.invocation || result.request !== e.request ||
   result.endpoint !== 'https://backboard.railway.com/graphql/v2' || result.authKind !== 'project_token') fail();
  assertServicesAttempt(e);
  // Early objective validation protects the transport attempt. The unchanged
  // identity owner independently repeats the final semantic/expected-ID checks.
  const facts = e.owner.validateProjectServices(e.attestation.facts.projectId, result.body);
  if (facts.serviceId !== targets.describeTarget(e.binding).serviceId) fail();
  e.phase = 'receipt'; const receipt = Object.freeze({});
  servicesReceipts.set(receipt, result); e.record.servicesReceipts.add(receipt);
  return freeze({ invocation: e.invocation, result: receipt });
 } catch {
  if (e) invalidate(e.record); if (result && result.entry !== e) invalidate(result.entry.record); fail();
 }
}
function cancelProjectServicesTransfer(...args) {
 const e = servicesBindings.get(args[0]) || servicesTransfers.get(args[0]); if (!e) fail();
 servicesBindings.delete(args[0]); servicesTransfers.delete(args[0]);
 e.record.servicesBindings.delete(args[0]); e.record.servicesTransfers.delete(args[0]);
 invalidate(e.record); if (args.length !== 1) fail();
}
function consumeProjectServicesReceipt(...args) {
 const result = servicesReceipts.get(args[0]); if (!result) fail();
 servicesReceipts.delete(args[0]); const e = result.entry; e.record.servicesReceipts.delete(args[0]);
 try {
  if (args.length !== 1 || e.phase !== 'receipt') fail(); assertServicesAttempt(e);
  e.phase = 'consumed'; e.record.busy = false;
  return freeze({ kind: result.kind, session: result.session, binding: result.binding, executionContext: result.executionContext,
   invocation: result.invocation, request: result.request, endpoint: result.endpoint, authKind: result.authKind, body: result.body });
 } catch { invalidate(e.record); fail(); }
}
// Independent fixed instance namespace. The genuine identity handoff remains
// the sole proof of human service approval; no adapter approval flag is added.
function requireInstanceOwner(expected = null) {
 const owner = requireOwner(expected);
 if (!['takeIdentityHandoffForFutureAdapter', 'validateServiceInstance'].every(k => typeof owner[k] === 'function')) fail();
 return owner;
}
function fixedServiceInstanceRequest(request, attestation, binding, owner) {
 plainKeys(request, ['query', 'operationName', 'variables']); plainKeys(request.variables, ['serviceId', 'environmentId']);
 const doc = owner.documents?.serviceInstance;
 if (!doc || request.operationName !== 'Movement0111ServiceInstance' || request.query !== doc.source ||
  hash(request.query + '\n') !== 'e247e7ec5e98cc71bc399304c37846ede31d7009096da4449f9bc8e88f267493' ||
  doc.canonicalSha256 !== 'e247e7ec5e98cc71bc399304c37846ede31d7009096da4449f9bc8e88f267493' ||
  request.variables.environmentId !== attestation.facts.environmentId ||
  request.variables.serviceId !== targets.describeTarget(binding).serviceId) fail();
 // Service equality is a consistency check: services early/final acceptance
 // already required that constraint. Execution bytes/approved observed IDs come
 // only from the original owner handoff, never from this comparison.
}
function assertInstanceAttempt(e) {
 const record = contexts.get(e.executionContext), owner = requireInstanceOwner(e.owner), attestation = record?.identityAttestation;
 const history = record?.servicesAttempt;
 if (record !== e.record || record.closed || !record.attested || !record.busy || record.instanceAttempt !== e ||
  record.binding !== e.binding || attestation !== e.attestation || attestation.session !== e.session ||
  attestation.executionContext !== e.executionContext || attestation.binding !== e.binding || attestation.owner !== owner ||
  history !== e.servicesHistory || history.phase !== 'consumed' || history.kind !== 'project_services' ||
  history.session !== e.session || history.executionContext !== e.executionContext || history.binding !== e.binding ||
  history.owner !== owner || history.attestation !== attestation) fail();
 fixedServiceInstanceRequest(e.request, attestation, e.binding, owner); return record;
}
function bindServiceInstanceTransfer(...args) {
 const record = contexts.get(args[0]);
 try {
  const owner = requireInstanceOwner();
  // Original H burns inside the unchanged owner, which checks S/C/stage/revision.
  const original = owner.takeIdentityHandoffForFutureAdapter(args[2], args[1], args[0]);
  const attestation = record?.identityAttestation, history = record?.servicesAttempt;
  if (args.length !== 3 || !record || record.closed || !record.attested || record.busy || record.instanceAttempt ||
   record.results.size || record.transferBinding || record.transfers.size || !attestation || !history ||
   original.kind !== 'service_instance' || original.session !== args[1] || original.executionContext !== args[0] ||
   original.binding !== record.binding || attestation.session !== original.session || attestation.binding !== original.binding ||
   attestation.executionContext !== original.executionContext || attestation.owner !== owner ||
   history.phase !== 'consumed' || history.kind !== 'project_services' || history.session !== original.session ||
   history.executionContext !== original.executionContext || history.binding !== original.binding ||
   history.owner !== owner || history.attestation !== attestation) fail();
  fixedServiceInstanceRequest(original.request, attestation, original.binding, owner);
  const transfer = Object.freeze({}), e = { ...original, owner, record, attestation, servicesHistory: history, phase: 'bound' };
  record.instanceAttempt = e; record.busy = true; instanceBindings.set(transfer, e); record.instanceBindings.add(transfer);
  return transfer;
 } catch { if (record) invalidate(record); fail(); }
}
async function executeServiceInstance(...args) {
 const e = instanceBindings.get(args[0]); if (!e) fail();
 instanceBindings.delete(args[0]); e.record.instanceBindings.delete(args[0]);
 try {
  if (args.length !== 1 || e.phase !== 'bound') fail(); assertInstanceAttempt(e);
  e.phase = 'dispatching'; instanceTransfers.set(args[0], e); e.record.instanceTransfers.add(args[0]);
  const body = await post(e.record, e.request); assertInstanceAttempt(e);
  e.phase = 'responded'; const result = Object.freeze({});
  instanceResults.set(result, { entry: e, kind: 'service_instance', session: e.session, binding: e.binding,
   executionContext: e.executionContext, invocation: e.invocation, request: e.request,
   endpoint: contract.endpoint, authKind: contract.preferredAuthKind, body: freeze(body) });
  e.record.instanceResults.add(result); return result;
 } catch { invalidate(e.record); fail(); }
}
function prepareServiceInstanceResult(...args) {
 const result = instanceResults.get(args[0]), e = instanceTransfers.get(args[1]);
 if (result) { instanceResults.delete(args[0]); result.entry.record.instanceResults.delete(args[0]); }
 if (e) { instanceTransfers.delete(args[1]); e.record.instanceTransfers.delete(args[1]); }
 try {
  if (args.length !== 2 || !result || !e || e.phase !== 'responded' || result.entry !== e ||
   result.kind !== 'service_instance' || result.session !== e.session || result.binding !== e.binding ||
   result.executionContext !== e.executionContext || result.invocation !== e.invocation || result.request !== e.request ||
   result.endpoint !== 'https://backboard.railway.com/graphql/v2' || result.authKind !== 'project_token') fail();
  assertInstanceAttempt(e);
  const facts = e.owner.validateServiceInstance(result.body), expected = targets.describeTarget(e.binding).serviceInstanceId;
  if (expected !== null && facts.serviceInstanceId !== expected) fail();
  e.phase = 'receipt'; const receipt = Object.freeze({});
  instanceReceipts.set(receipt, result); e.record.instanceReceipts.add(receipt);
  return freeze({ invocation: e.invocation, result: receipt });
 } catch {
  if (e) invalidate(e.record); if (result && result.entry !== e) invalidate(result.entry.record); fail();
 }
}
function cancelServiceInstanceTransfer(...args) {
 const e = instanceBindings.get(args[0]) || instanceTransfers.get(args[0]); if (!e) fail();
 instanceBindings.delete(args[0]); instanceTransfers.delete(args[0]);
 e.record.instanceBindings.delete(args[0]); e.record.instanceTransfers.delete(args[0]);
 invalidate(e.record); if (args.length !== 1) fail();
}
function consumeServiceInstanceReceipt(...args) {
 const result = instanceReceipts.get(args[0]); if (!result) fail();
 instanceReceipts.delete(args[0]); const e = result.entry; e.record.instanceReceipts.delete(args[0]);
 try {
  if (args.length !== 1 || e.phase !== 'receipt') fail(); assertInstanceAttempt(e);
  e.phase = 'consumed'; e.record.busy = false;
  return freeze({ kind: result.kind, session: result.session, binding: result.binding, executionContext: result.executionContext,
   invocation: result.invocation, request: result.request, endpoint: result.endpoint, authKind: result.authKind, body: result.body });
 } catch { invalidate(e.record); fail(); }
}
// Private consumer wiring is synchronous at module initialization. The boundary
// deletes/freezes its temporary linker before either normal import returns.
// No consumer, raw-body factory, issuer or callback registration survives import.
function consumeIdentityProviderObservation(...args) {
 if (instanceReceipts.has(args[0])) return consumeServiceInstanceReceipt(...args);
 if (servicesReceipts.has(args[0])) return consumeProjectServicesReceipt(...args);
 return consumeContextResultTransfer(...args); // Preserve context arity/burn semantics.
}
module.exports = Object.freeze(Object.assign(Object.create(null), { status, safety, openExecutionContext, closeExecutionContext,
 bindProjectServicesTransfer, executeProjectServices, prepareProjectServicesResult, cancelProjectServicesTransfer,
 bindServiceInstanceTransfer, executeServiceInstance, prepareServiceInstanceResult, cancelServiceInstanceTransfer,
 executeHandoff, consumeContextResult, consumeSchemaResult, bindContextResultTransfer, prepareContextResultTransfer, consumeContextResultTransfer }));
const linkConsumer = Reflect.get(require('./qualification-railway-target-identity-provider-boundary.cjs'), '_connectProjectServicesConsumer');
if (typeof linkConsumer !== 'function') fail(); linkConsumer(consumeIdentityProviderObservation);
