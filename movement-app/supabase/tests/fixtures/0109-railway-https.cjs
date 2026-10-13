'use strict';
// TEST ONLY: isolated adapter loading with synthetic env/HTTPS/timers. This is
// not imported by production code and cannot populate the normal adapter WeakMaps.
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path'), { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');
const file = path.resolve('scripts/assessment-worker/qualification-railway-https-adapter.cjs');
const localRequire = createRequire(file);
function rootBody() { return { data: { __schema: { queryType: { name: 'Query' } } } }; }
function responseBody(request) {
 if (request.operationName === 'Movement0108ProjectTokenContext') return { data: { projectToken: { projectId: 'synthetic-project', environmentId: 'synthetic-env' } } };
 if (request.operationName === 'Movement0106QueryRoot') return rootBody();
 if (request.variables.name === 'Query') {
  const type = { kind: 'SCALAR', name: 'ID', ofType: null };
  return { data: { __type: { kind: 'OBJECT', name: 'Query', fields: ['deploymentInstanceExecutions', 'unrelatedRootField'].map(name => ({ name, args: [], type })), inputFields: null, enumValues: null } } };
 }
 return { data: { __type: { kind: 'SCALAR', name: 'ID', fields: null, inputFields: null, enumValues: null } } };
}
function loadAdapter({ env = { RAILWAY_TOKEN: 'synthetic-private-credential' }, driver = {} } = {}) {
 const calls = [], reads = [], timers = new Map(); let timerId = 0, destroyed = 0;
 const guardedEnv = new Proxy(env, { get(target, key) { reads.push(key); return Reflect.get(target, key); } });
 const fakeHttps = { request(options, callback) {
  const call = { options, body: null }; calls.push(call);
  if (driver.mode === 'throw') throw Error('synthetic sensitive transport failure');
  const req = new EventEmitter(); call.req = req;
  req.destroy = () => { destroyed++; req.emit('error', Error('synthetic private error')); };
  req.end = text => {
   call.body = JSON.parse(text);
   if (driver.mode === 'timeout') return;
   queueMicrotask(() => {
    if (driver.mode === 'connection') { req.emit('error', Error('synthetic private connection error')); return; }
    const res = new EventEmitter(); call.res = res;
    res.statusCode = driver.status ?? 200;
    res.headers = { 'content-type': driver.contentType ?? 'application/json', ...driver.headers };
    res.rawHeaders = driver.rawHeaders ?? ['Content-Type', res.headers['content-type']];
    res.destroy = () => { destroyed++; res.destroyed = true; res.emit('close'); };
    callback(res);
    if (res.destroyed) return;
    if (driver.mode === 'aborted') { res.emit('aborted'); return; }
    if (driver.mode === 'close') { res.emit('close'); return; }
    if (driver.mode === 'responseError') { res.emit('error', Error('synthetic private response error')); return; }
    const raw = driver.raw ?? JSON.stringify(driver.body ?? responseBody(call.body));
    for (const chunk of driver.chunks ?? [Buffer.from(raw)]) {
     res.emit('data', chunk); if (res.destroyed) return;
    }
    res.emit('end'); res.emit('close');
   });
  };
  return req;
 } };
 const module = { exports: {} };
 vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
  module, require: name => name === 'node:https' ? fakeHttps : name === 'node:util'
   ? { TextDecoder: localRequire('node:util').TextDecoder, debuglog: () => ({ enabled: driver.debugEnabled ?? false }) }
   : localRequire(name),
  Buffer, process: { env: guardedEnv },
  setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
  clearTimeout: id => timers.delete(id),
 }, { filename: file });
 return { api: module.exports, calls, reads, timers, env,
  fireTimeouts: () => { for (const timer of [...timers.values()]) timer.callback(); },
  destroyed: () => destroyed };
}
module.exports = { loadAdapter, rootBody };
