'use strict';
// Test-only result issuer in a separate VM dependency; never an export or input
// of the normal module. No environment or transport access.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const file = path.resolve(__dirname, '../../../scripts/assessment-worker/qualification-railway-target-identity.cjs');
function loadIdentity(capture = false) {
 const results = new WeakMap(), closed = new WeakSet(), issued = [], consumed = [];
 const bridge = { takeObservation(handle) {
  const record = results.get(handle); if (!record) throw Error('Synthetic observation unavailable');
  results.delete(handle); consumed.push(handle);
  if (closed.has(record.executionContext)) throw Error('Synthetic observation unavailable'); return record;
 } };
 let makePermit;
 const sandbox = { module: { exports: {} }, require(name) {
  if (name === './qualification-railway-live-authorization.cjs') { makePermit=require('./0114h-reviewed-context.cjs').connect(sandbox.module); return {}; }
  if (name === './qualification-railway-target-identity-provider-boundary.cjs') return bridge;
  if (name.startsWith('./')) return require(path.resolve(path.dirname(file), name));
  return require(name);
 } };
 vm.runInNewContext(fs.readFileSync(file, 'utf8') + (capture ? '\nmodule.exports = { ...module.exports, testRecord: session => sessions.get(session) };' : ''), sandbox, { filename: file });
 const raw=sandbox.module.exports; const api={...raw,startTargetIdentitySession(...args){return args.length===1?raw.startTargetIdentitySession(args[0],makePermit(args[0])):raw.startTargetIdentitySession(...args);}};
 return { api, issued, consumed, closeExecution(context) { closed.add(context); }, issue(record) {
  const result = Object.freeze({}); results.set(result, record); issued.push(result); return result;
 } };
}
module.exports = { loadIdentity };
