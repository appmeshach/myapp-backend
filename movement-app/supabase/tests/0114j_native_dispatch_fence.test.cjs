'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {loadAcquisition,serviceAck,targetAck}=require('./fixtures/0114d-acquisition-wrapper.cjs');
const adapterPath=path.resolve(__dirname,'../../scripts/assessment-worker/qualification-railway-https-adapter.cjs');
const source=fs.readFileSync(adapterPath,'utf8').replace(/\r\n/g,'\n');
const flush=async()=>{for(let i=0;i<180;i++)await Promise.resolve();};
const reject=fn=>assert.throws(fn,/unavailable/);
test.beforeEach(t=>{let calls=0;for(const[o,k]of[[require('node:https'),'request'],[require('node:http'),'request'],[global,'fetch']])t.mock.method(o,k,()=>{calls++;throw Error('REAL NETWORK FORBIDDEN');});t.after(()=>assert.equal(calls,0));});

test('shared post prepares body, options, diagnostics and timer before adjacent pure fence/native construction',()=>{
 const start=source.indexOf('function post('),end=source.indexOf('\nasync function executeHandoff',start),post=source.slice(start,end);
 for(const token of ['JSON.stringify(request)','const options=','requireQuietDiagnostics()','setTimeout(stop, safety.timeoutMs)'])assert(post.indexOf(token)>0);
 const fence=post.indexOf("if(record.lifecycle)dispatchFence(record.lifecycle.carrier,operationName);");
 for(const token of ['JSON.stringify(request)','const options=','requireQuietDiagnostics()','setTimeout(stop, safety.timeoutMs)'])assert(post.indexOf(token)<fence);
 assert.match(post,/if\(record\.lifecycle\)dispatchFence\(record\.lifecycle\.carrier,operationName\);\n   req = nativeRequest\(options,onResponse\);/);
 assert.equal((source.match(/nativeRequest\(options,onResponse\)/g)||[]).length,1);
});

test('all three successful adapter fences immediately precede exactly three native requests',async()=>{
 const f=loadAcquisition({traceFence:true,traceNative:true}),a=f.authorized(),h=f.wrapper.beginAuthorizedAcquisition(a.ticket),p=await f.pending(h,'service_review');
 f.wrapper.submitServiceReview(h,p.review,serviceAck(p));const q=await f.pending(h,'candidate');f.wrapper.submitTargetReview(h,q.review,targetAck(q));
 const relevant=f.trace.filter(v=>v==='nativeRequest'||String(v).startsWith('fence:'));
 assert.deepEqual(relevant,['fence:Movement0108ProjectTokenContext','nativeRequest','fence:Movement0111ProjectServices','nativeRequest','fence:Movement0111ServiceInstance','nativeRequest']);
 assert.equal(f.calls.length,3);assert.deepEqual(f.calls.map(c=>c.request.operationName),['Movement0108ProjectTokenContext','Movement0111ProjectServices','Movement0111ServiceInstance']);
});

for(const operation of ['Movement0108ProjectTokenContext','Movement0111ProjectServices','Movement0111ServiceInstance'])test('expired final fence creates zero new native request: '+operation,async()=>{
 const f=loadAcquisition({traceFence:true,traceNative:true,failFence:operation}),a=f.authorized(),h=f.wrapper.beginAuthorizedAcquisition(a.ticket);
 if(operation==='Movement0111ServiceInstance'){
  const p=await f.pending(h,'service_review');f.wrapper.submitServiceReview(h,p.review,serviceAck(p));await flush();
 }else await flush();
 const before={Movement0108ProjectTokenContext:0,Movement0111ProjectServices:1,Movement0111ServiceInstance:2}[operation];
 assert.equal(f.calls.length,before);assert.equal(f.trace.filter(v=>v==='nativeRequest').length,before);reject(()=>f.wrapper.takePendingHumanReview(h));
 if(f.opens[0])assert.equal(f.contextRecord(f.opens[0]).closed,true);
});

test('adapter exposes no lifecycle fence, association setter, retry or generic request API',()=>{
 const adapter=require(adapterPath);assert(Object.isFrozen(adapter));
 assert(!Reflect.ownKeys(adapter).some(k=>/connect|fence|lifecycle|associate|install|retry|request/i.test(String(k))));
 assert.equal(adapter.safety.retries,0);assert.equal(adapter.safety.redirects,false);assert.equal(source.includes('http.request('),false);
});

test('request 1 retains corrected acquireServices context-transfer path',()=>{
 const wrapper=fs.readFileSync(path.resolve(__dirname,'../../scripts/assessment-worker/qualification-railway-acquisition-wrapper.cjs'),'utf8');
 const begin=wrapper.indexOf('async function acquireServices'),end=wrapper.indexOf('\nasync function acquireInstance',begin),body=wrapper.slice(begin,end);
 const ordered=['identity.contextTransfer.preparePermit','adapter.bindContextResultTransfer','adapter.executeHandoff'];let last=-1;
 for(const token of ordered){const at=body.indexOf(token);assert(at>last);last=at;}assert.equal(body.includes('acquireContext'),false);
});
