'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {parseArgs,offline,observeIdle,summarize,EXPECTED}=require('../../scripts/assessment-worker/qualify.cjs');
const {schema,validate,stats,verdict,markdown}=require('../../scripts/assessment-worker/qualification-report.cjs');
const {configuration,validateRuntime,event,CONTRACT}=require('../../scripts/assessment-worker/runtime.cjs');
const {safeOutput}=require('../../scripts/assessment-worker/qualification-integration.cjs');
const {executeOne}=require('../../scripts/assessment-worker/worker.cjs');
const {calculateIsolated}=require('../../scripts/assessment-worker/compute.cjs');
const {assessSharedSegment}=require('../functions/_shared/shared-segment-assessment-geometry.ts');
test('worker runtime declaration intentionally requires native Node 24 TS support',()=>{validateRuntime('24.13.1');assert.throws(()=>validateRuntime('22.13.1'));assert.equal(JSON.parse(fs.readFileSync('scripts/assessment-worker/package.json')).engines.node,'>=24');assert.equal(CONTRACT.concurrency,1);});
test('eager worker configuration accepts project transport conventions without secret output',()=>{
 for(const secret of ['sb_secret_fixture','legacy-service-token'])assert.equal(configuration({SUPABASE_URL:'https://example.invalid',SUPABASE_SERVICE_ROLE_KEY:secret}).secret,secret);
 assert.equal(configuration({SUPABASE_URL:'http://localhost:54321',SUPABASE_SERVICE_ROLE_KEY:'fixture'}).url,'http://localhost:54321');
});
for(const url of ['bad','http://example.invalid','https://user:pass@example.invalid','https://example.invalid/path','https://example.invalid?key=secret'])test('bad startup URL fails eagerly '+url,()=>assert.throws(()=>configuration({SUPABASE_URL:url,SUPABASE_SERVICE_ROLE_KEY:'fixture'}),/configuration/));
test('missing and whitespace secret fail eagerly',()=>{assert.throws(()=>configuration({}));assert.throws(()=>configuration({SUPABASE_URL:'https://example.invalid',SUPABASE_SERVICE_ROLE_KEY:'secret\n'}));});
test('CLI safe defaults and operator cost inputs',()=>{const o=parseArgs(['--offline','--memory-limit-mb','512','--monthly-fixed-cost','5.5','--currency','USD']);assert.equal(o.runs,5);assert.equal(o.memoryLimitBytes,512*1048576);assert.equal(o.host.monthlyFixedCost,5.5);});
for(const args of [[],['--offline','--integration'],['--offline','--runs','0'],['--offline','--runs','21'],['--offline','--runs','1.5'],['--offline','--runs','NaN'],['--offline','--runs'],['--offline','--runs','2','--runs','3'],['--offline','--unknown'],['--offline','--idle-minutes','61'],['--offline','--idle-seconds','11'],['--offline','--idle-seconds','1','--idle-minutes','1'],['--offline','--monthly-fixed-cost','5'],['--offline','--provider','sb_secret_leak'],['--offline','--provider','https://private.invalid'],['--offline','--provider',crypto.randomUUID()]])test('invalid CLI rejected '+args.join(' '),()=>assert.throws(()=>parseArgs(args)));
test('bounded statistics include median, p95 only with 20 observations',()=>{assert.deepEqual(stats([]),{count:0,min:null,p50:null,p95:null,max:null});assert.equal(stats([4,2,1,3]).p50,2.5);assert.equal(stats([1,2,3,4,5]).p95,null);assert.equal(stats(Array.from({length:20},(_,i)=>i+1)).p95,19);assert.throws(()=>stats([NaN]));});
test('metric aggregation counts failures, timeouts and abnormal terminations',()=>{
 const samples=[{metrics:{wallMs:10,computeMs:8,cpuMs:7,peakRssBytes:100},failure:null},{metrics:null,failure:'compute_timeout'},{metrics:null,failure:'compute_terminated'}];
 const s=summarize('small',[2,2],EXPECTED.small,samples,false);assert.equal(s.failures,2);assert.equal(s.timeouts,1);assert.equal(s.abnormalTerminations,1);assert.equal(s.wallMs.max,10);assert.equal(s.peakRssBytes,100);
});
test('frozen expected results and failure classifications are preserved over repetitions',async()=>{
 const cases=await import('../../scripts/0099-geographic-support-benchmark.mjs');let calls=0;
 const result=await offline(2,async(a,b,o)=>{calls++;if(o){throw Object.assign(Error(),{code:o.childPath.includes('stall')?'compute_timeout':'compute_terminated'});}return {result:assessSharedSegment(a,b),metrics:{wallMs:2,computeMs:1,cpuMs:1,peakRssBytes:1}};});
 assert.equal(calls,16);assert.equal(result.length,10);assert(result.every(c=>c.passed));assert.equal(result[0].samples[0].observation,'first-process-run');assert.equal(result[1].samples[0].observation,'subsequent-process-run');
 assert.equal(result[2].samples[0].reason,'processing_limit');assert.equal(result[6].samples[0].state,null);assert.equal(Object.keys(cases.cases).length,6);
});
test('runtime failure does not become processing_limit',async()=>{const cases=await offline(1,async()=>{throw Object.assign(Error(),{code:'compute_timeout'});});assert(cases.slice(0,6).every(c=>!c.passed&&c.samples[0].state===null&&c.samples[0].reason===null));});
test('invalid diagnostic line terminates a live child before the deadline without leaking its output',async()=>{
 const shape={type:'LineString',coordinates:[[0,0],[0.003,0]]};
 await assert.rejects(calculateIsolated(shape,shape,{childPath:path.join(__dirname,'fixtures/0101-compute-malformed-diagnostic.cjs'),timeoutMs:5000}),
  e=>e.code==='compute_terminated'&&!e.message.includes('not-a-metric-record'));
});
test('pass fail incomplete gates do not manufacture host qualification',()=>{
 const all={correctness:true,reliability:true,lease:true,memory:true,process:true,integration:true,security:true};
 assert.equal(verdict({gates:all},5).result,'qualified');assert.equal(verdict({gates:{...all,memory:null}},5).result,'incomplete');
 assert.equal(verdict({gates:{...all,lease:false}},5).classification,'HOST_UNQUALIFIED');assert.equal(verdict({gates:all},1).result,'incomplete');
});
test('structured logging strips credentials, identities, shapes and raw error text',()=>{
 const v=event('job_transition',{state:'completed',attemptCount:1,durationMs:5,jobId:crypto.randomUUID(),canonical_context:{},coordinates:[[1,2]],secret:'sb_secret_fixture',resultCategory:'processing_limit'});
 assert(!JSON.stringify(v).includes('secret'));assert(!('jobId' in v));assert.equal(v.resultCategory,'processing_limit');assert(safeOutput(JSON.stringify(v),'sb_secret_fixture'));
 assert(!safeOutput(JSON.stringify({...v,job_id:crypto.randomUUID()}),'sb_secret_fixture'));
});
test('schema forbids all unrecognized nested and top-level properties',()=>{
 const fixture=s=>s.anyOf?null:s.enum?s.enum[0]:s.type==='object'?Object.fromEntries(Object.entries(s.properties).map(([k,v])=>[k,fixture(v)])):s.type==='array'?[]:s.type==='number'?0:s.type==='boolean'?true:s.pattern?.includes('64')?'a'.repeat(64):s.pattern?.includes('40')?'a'.repeat(40):s.pattern?.startsWith('^v')?'v24.13.1':s.pattern?.includes('T.*Z')?'2026-10-12T00:00:00Z':'unknown';
 const r=fixture(schema);r.timestamp='2026-10-12T00:00:00.000Z';r.algorithm.version='shared_segment_geographic_assessment_v1';r.security.logAllowlist=true;r.security.childIsolation=true;r.usage={wallMs:0,totalChildCpuMs:0,parentCpuMs:0,peakParentRssBytes:0,peakChildRssBytes:0,dbCalls:0,jobsCompleted:0,bytesTransferred:null};
 validate(r);const text=markdown(r);assert.equal(markdown(r),text);assert.match(text,/BLOCKED/);
 assert.throws(()=>validate({...r,secret:'sb_secret_fixture'}));const extra=structuredClone(r);extra.host.credentials='secret';assert.throws(()=>validate(extra));
 for(const privateValue of ['sb_secret_fixture',crypto.randomUUID(),'eyJfixture']){const hidden=structuredClone(r);hidden.host.provider=privateValue;assert.throws(()=>validate(hidden));assert.throws(()=>markdown(hidden));}
 const bad=structuredClone(r);bad.usage.parentCpuMs=Infinity;assert.throws(()=>validate(bad));
});
test('short idle observation measures actual polls, bounded resource metrics and no transaction',async()=>{
 let polls=0;const v=await observeIdle(30,{claim:async()=>{polls++;return {state:'idle'};}},{intervalMs:5});assert.equal(v.pollCount,polls);assert.equal(v.dbCalls,polls);assert.equal(v.cpuDeltaMs.count,polls);assert(v.cpuDeltaMs.max>=0);assert(v.rssBytes.max>0);assert(v.cpuMs>=0);assert(v.maxEventLoopDelayMs>=0);
 await assert.rejects(observeIdle(0));await assert.rejects(observeIdle(1,{claim:async()=>({state:'claimed'})}));
});
test('shutdown signal already aborted prevents all claims',async()=>{let calls=0;const c=new AbortController();c.abort();await assert.rejects(executeOne({claim:async()=>{calls++;return {state:'idle'};}},{signal:c.signal}));assert.equal(calls,0);});
