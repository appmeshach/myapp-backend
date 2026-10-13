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
const fail = () => { throw Error('Railway private HTTPS evidence unavailable'); };
const hash = v => crypto.createHash('sha256').update(v).digest('hex');
function requireQuietDiagnostics() {
 // Native https debug logs can contain connection options/headers. Inspect only
 // name presence and logger enabled-state, never NODE_DEBUG's environment value.
 if (Object.hasOwn(process.env, 'NODE_DEBUG') || debuglog('http').enabled || debuglog('https').enabled) fail();
}
function invalidate(record) {
 record.closed = true; record.attested = false; record.secret = null;
 for (const result of record.results) results.delete(result);
 record.results.clear();
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
 contexts.set(handle, { binding, secret, closed: false, attested: false, busy: false, cancel: null, results: new Set() });
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
  const body = await post(record, invocation.request);
  if (record.closed) fail();
  const result = Object.freeze({});
  results.set(result, { executionContext, binding: record.binding, handoff, invocation,
   request: invocation.request, kind: invocation.kind, endpoint: contract.endpoint, authKind: contract.preferredAuthKind, body });
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
module.exports = Object.freeze({ status, safety, openExecutionContext, closeExecutionContext,
 executeHandoff, consumeContextResult, consumeSchemaResult });
