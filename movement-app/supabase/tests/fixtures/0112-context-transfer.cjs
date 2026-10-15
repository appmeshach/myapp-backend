'use strict';
// TEST ONLY: coherent isolated adapter/identity/ingress graph. WeakMap capture
// permits fault injection ONLY into VM-owned synthetic records, never normal maps.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { EventEmitter } = require('node:events');
const base = path.resolve(__dirname, '../../../scripts/assessment-worker');
const keys = ['qualification-railway-https-adapter.cjs', 'qualification-railway-target-identity.cjs', 'qualification-railway-target-identity-provider-boundary.cjs'];
function loadTransfer({ body = null } = {}) {
 const cache = new Map(), records = [], calls = [], reads = [], timers = new Map(); let ownerOverride = null; let makePermit;
 class CapturedWeakMap extends WeakMap { set(key, value) { records.push({ key, value }); return super.set(key, value); } }
 const env = new Proxy({ RAILWAY_TOKEN: 'synthetic-private-credential' }, { get(target, key) { reads.push(key); return target[key]; } });
 const https = { request(options, callback) {
  const req = new EventEmitter(); req.destroy = () => {}; req.end = text => {
   calls.push({ request: JSON.parse(text), options });
   queueMicrotask(() => {
    const res = new EventEmitter(); res.statusCode = 200; res.headers = { 'content-type': 'application/json' }; res.rawHeaders = ['Content-Type', 'application/json']; res.destroy = () => {};
    callback(res);
    const data = body ?? { data: { projectToken: { projectId: 'synthetic-project', environmentId: 'synthetic-env' } } };
    res.emit('data', Buffer.from(JSON.stringify(data))); res.emit('end'); res.emit('close');
   });
  }; return req;
 } };
 function load(key) {
  if (cache.has(key)) return cache.get(key).exports;
  const module = { exports: {} }; cache.set(key, module);
  const sandbox = { module, Buffer, WeakMap: CapturedWeakMap, process: { env },
   setTimeout(fn, ms) { const handle = {}; timers.set(handle, { fn, ms }); return handle; }, clearTimeout(handle) { timers.delete(handle); },
   require(name) {
    if (name === './qualification-railway-live-authorization.cjs') { makePermit=require('./0114h-reviewed-context.cjs').connect(module); return {}; }
    if (name === 'node:https') return https;
    if (name === 'node:util') return { TextDecoder: require('node:util').TextDecoder, debuglog: () => ({ enabled: false }) };
    if (name.startsWith('./')) {
     const dep = name.slice(2); if (dep === keys[1] && ownerOverride) return ownerOverride;
     return keys.includes(dep) ? load(dep) : require(path.join(base, dep));
    }
    return require(name);
   } };
  vm.runInNewContext(fs.readFileSync(path.join(base, key), 'utf8'), sandbox, { filename: path.join(base, key) });
  if(key===keys[1]){const raw=module.exports;module.exports=Object.freeze({...raw,startTargetIdentitySession(...args){return args.length===1?raw.startTargetIdentitySession(args[0],makePermit(args[0])):raw.startTargetIdentitySession(...args);}});}
  return module.exports;
 }
 const identity = load(keys[1]), adapter = load(keys[0]), ingress = load(keys[2]);
 return { identity, adapter, ingress, calls, reads, timers, records, replaceOwner(value) { ownerOverride = value; },
  resultRecord(handle) { return records.find(e => e.key === handle && e.value.body)?.value; },
  contextRecord(handle) { return records.find(e => e.key === handle && Object.hasOwn(e.value, 'secret'))?.value; },
  sessionRecord(handle) { return records.find(e => e.key === handle && Object.hasOwn(e.value, 'revision') && Object.hasOwn(e.value, 'candidate'))?.value; } };
}
module.exports = { loadTransfer };
