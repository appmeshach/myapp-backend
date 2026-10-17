'use strict';
// Fixed local container / schema-only clone. No URL, project or credential input.
const assert=require('node:assert/strict'),http=require('node:http'),cp=require('node:child_process'),path=require('node:path'),crypto=require('node:crypto');
// Existing untyped test harnesses are outside the worker runtime type graph.
const harnessPath=name=>path.resolve(__dirname,'../../supabase/tests',name);
const h=require(harnessPath('0099_shared_segment_assessment_job_foundation_harness.cjs'));
const previous=require(harnessPath('0095_requester_deadline_matching_context_repair_harness.cjs'));
const {quote}=require(harnessPath('0093_requester_route_generation_claim_boundary_harness.cjs'));
const {createAssessmentJobBackend}=require('../../supabase/functions/_shared/shared-segment-assessment-job-runtime.ts');
const {executeOne}=require('./worker.cjs'),{calculateIsolated}=require('./compute.cjs');
const {emptyResult}=require('../../supabase/functions/_shared/shared-segment-assessment-contracts.ts');
const {stats}=require('./qualification-report.cjs');
const {CONTRACT}=require('./runtime.cjs');
const {observeIdle}=require('./qualify.cjs');
const {setTimeout:delay}=require('node:timers/promises');
const ROOT=path.resolve(__dirname,'../..');
const allowed={claim_shared_segment_assessment_job_for_server:[],load_shared_segment_assessment_job_context_for_server:['p_job_id','p_lease_token'],
 finalize_shared_segment_assessment_job_for_server:['p_job_id','p_lease_token','p_context','p_result','p_recovery_only'],fail_shared_segment_assessment_job_for_server:['p_job_id','p_lease_token','p_category']};
const literal=v=>v===null?'NULL':typeof v==='boolean'?String(v):typeof v==='object'?quote(JSON.stringify(v))+'::jsonb':quote(v);
async function bridge(c){
 const secret='qualification_'+crypto.randomBytes(24).toString('hex'),session=c.session();let calls=0,hook=null,chain=Promise.resolve();
 const query=sql=>{const task=chain.then(async()=>{calls++;return JSON.parse(await session.send("SET ROLE service_role; SET statement_timeout='4s'; "+sql));});chain=task.catch(()=>{});return task;};
 const server=http.createServer(async(req,res)=>{
  try{
   if(req.method!=='POST'||req.headers.apikey!==secret)throw Error();const name=req.url.split('/').at(-1);if(!allowed[name])throw Error();
   let raw='';for await(const part of req){raw+=part;if(raw.length>4*1024*1024)throw Error();}
   const args=JSON.parse(raw);assert.deepEqual(Object.keys(args).sort(),allowed[name].slice().sort());
   if(hook&&await hook(name,args,req,res))return;
   const value=await query(`SELECT public.${name}(${Object.entries(args).map(([k,v])=>`${k}=>${literal(v)}`).join(',')});`);
   res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(value));
  }catch{if(!res.destroyed){res.writeHead(503);res.end('{}');}}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(undefined)));
 const url=`http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */(server.address()).port}`;
 return {url,secret,backend:createAssessmentJobBackend(url,secret),query,calls:()=>calls,setHook:v=>{hook=v;},
  async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await chain;session.close();}};
}
// Batch real fixture helpers in one transaction. Every pair gets trusted route
// evidence through the existing claim/publication RPC; no hand-inserted job.
function seed(c,n){
 const schema='host0101_'+crypto.randomBytes(6).toString('hex');
 let setup=previous.fixtures().replace(/^BEGIN;/,'').replace('SET TRANSACTION ISOLATION LEVEL READ COMMITTED;','').replaceAll('pg_temp.',schema+'.').replaceAll('CREATE TEMP TABLE','CREATE TABLE').replaceAll(' ON COMMIT DROP','');
 setup=setup.replace(/'test_router',\s*'directions',\s*'v1',/,"'mapbox-directions-v5','mapbox-directions','v5-driving-geojson-full-v1',");
 c.target(`BEGIN; CREATE SCHEMA ${schema}; ${setup}
 CREATE TABLE ${schema}.pairs(requester uuid,need uuid,availability uuid);
 DO $seed$ DECLARE a record;n record;cl record;origin uuid;destination uuid;BEGIN
 FOR i IN 1..${n} LOOP
  SELECT * INTO a FROM ${schema}.interest_offering_fixture('0101-'||i,3,interval '4 hours');
  SELECT * INTO n FROM ${schema}.interest_requester_fixture('0101-'||i,1);
  SELECT location_reference_id INTO origin FROM private.movement_need_locations WHERE movement_need_id=n.movement_need_id AND role='origin';
  SELECT location_reference_id INTO destination FROM private.movement_need_locations WHERE movement_need_id=n.movement_need_id AND role='destination';
  SELECT * INTO cl FROM public.claim_requester_route_generation_for_server(n.movement_need_id,n.member_id,'mapbox-directions-v5','mapbox-directions','v5-driving-geojson-full-v1','requester_route_evidence_v1','geojson_linestring_v1');
  PERFORM public.record_claimed_requester_route_evidence_for_server(n.movement_need_id,n.member_id,cl.generation_claim_token,origin,destination,
   'requester_route_evidence_v1','geojson_linestring_v1','mapbox-directions-v5','mapbox-directions','v5-driving-geojson-full-v1','local-fixture',
   '{"type":"LineString","coordinates":[[3.4,6.4],[3.5,6.5]]}'::jsonb,1000,300,clock_timestamp(),NULL);
  INSERT INTO ${schema}.pairs VALUES(n.member_id,n.movement_need_id,a.availability_id);
 END LOOP;END;$seed$;COMMIT;`);
 return JSON.parse(c.target(`SELECT json_agg(json_build_object('requester',requester,'need',need,'availability',availability)) FROM ${schema}.pairs;`));
}
function workerProcess(b,mode='normal'){
 const options=/** @type {import('node:child_process').ForkOptions & {windowsHide:boolean}} */({env:{SUPABASE_URL:b.url,SUPABASE_SERVICE_ROLE_KEY:b.secret},execArgv:['--no-warnings'],silent:true,windowsHide:true});
 const child=cp.fork(path.join(ROOT,'supabase/tests/fixtures/0101-worker-process.cjs'),[mode],options);
 let output='',closed=false,events=[];const waiters=[];
 child.stdout.on('data',v=>{output+=v;if(output.length>1024*1024)child.kill('SIGKILL');});child.stderr.on('data',v=>{output+=v;});
 child.on('message',v=>{if(!v||typeof v!=='object'||!('event' in v))return;events.push(v);for(const w of [...waiters])if(v.event===w.name){clearTimeout(w.timer);waiters.splice(waiters.indexOf(w),1);w.resolve(v);}});
 const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',(code,signal)=>{closed=true;for(const w of waiters){clearTimeout(w.timer);w.reject(Error('Worker closed before barrier'));}resolve({code,signal});});});
 return {child,done,events,output:()=>output,wait(name){const found=events.find(v=>v.event===name);if(found)return Promise.resolve(found);
  return new Promise((resolve,reject)=>{if(closed)return reject(Error('Worker closed'));const w={name,resolve,reject,timer:setTimeout(()=>{child.kill('SIGKILL');reject(Error('Worker barrier timeout'));},10000)};waiters.push(w);});},
  async stop(signal=/** @type {NodeJS.Signals} */('SIGTERM')){if(process.platform==='win32')child.send(signal);else child.kill(signal);return await done;},kill(){child.kill('SIGKILL');}};
}
function safeOutput(text,secret){
 if(text.includes(secret)||/coordinates|canonical_context|lease_token|job_id|assessment_id|sb_secret_|Bearer |[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i.test(text))return false;
 try{return text.trim().split('\n').filter(Boolean).every(line=>{const e=JSON.parse(line);return Object.keys(e).every(k=>['event','timestamp','uptimeSeconds','workerVersion','algorithmVersion','pollCount','attemptCount','durationMs','computeMs','cpuMs','peakRssBytes','rssBytes','state','resultCategory'].includes(k));});}catch{return false;}
}
/** @returns {Promise<any>} */
async function integration(idleMs=0){
 let report;await h.run(async c=>{
  assert(/^requester0093_[a-f0-9]{12}$/.test(c.db));const b=await bridge(c),processes=[];
  const out={queue:[],dedup:null,restart:[],idle:null,processLeakCheck:true,dbCalls:0,jobsCompleted:0,childCpuMs:0,peakChildRssBytes:0};
  const register=f=>b.query(h.register(f));
  const expired=j=>c.target(`UPDATE private.shared_segment_assessment_jobs SET lease_expires_at=clock_timestamp()-interval '1 millisecond' WHERE id='${j.job_id}';`);
  const record=async(name,fn)=>{const start=performance.now();await fn();out.restart.push({scenario:name,passed:true,durationMs:performance.now()-start});};
  const spawn=mode=>{const p=workerProcess(b,mode);processes.push(p);return p;};
  const compute=async(a,b,options={})=>{const v=await calculateIsolated(a,b,options);out.childCpuMs+=v.metrics.cpuMs;out.peakChildRssBytes=Math.max(out.peakChildRssBytes,v.metrics.peakRssBytes);return v;};
  try{
   for(const n of [1,10,100]){
    const pairs=seed(c,n);for(const f of pairs)await register(f);
    const started=performance.now(),dbBefore=b.calls(),durations=[];let first=0,parentPeak=0;
    for(let i=0;i<n;i++){
     // run.cjs retains this interval after every operation, not just idle polls.
     // Preserve its pacing so queue drain/age do not imply faster throughput.
     if(i>0)await delay(CONTRACT.pollMs);
     const backend={...b.backend,claim:async s=>{const j=await b.backend.claim(s);if(i===0)first=performance.now()-started;return j;}};
     const v=await executeOne(backend,{compute});assert.equal(v.state,'completed');durations.push(v.metrics.computeMs);parentPeak=Math.max(parentPeak,process.memoryUsage().rss);
    }
    const drainMs=performance.now()-started;
    // Queue age is measured from authoritative DB created_at through completed updated_at.
    const needs=pairs.map(f=>quote(f.need)).join(',');const q=JSON.parse(c.target(`SELECT json_build_object('maxQueueAgeMs',max(extract(epoch FROM(updated_at-created_at))*1000),'retries',sum(attempt_count-1),'failures',count(*) FILTER(WHERE status<>'completed')) FROM private.shared_segment_assessment_jobs WHERE movement_need_id IN (${needs});`));
    const publications=Number(c.target(`SELECT count(*) FROM private.shared_segment_geographic_assessments WHERE movement_need_id IN (${needs});`));assert.equal(publications,n);
    out.queue.push({jobs:n,firstClaimMs:first,drainMs,maxQueueAgeMs:Number(q.maxQueueAgeMs),computeMs:stats(durations),retries:Number(q.retries),failures:q.failures,duplicatePublications:Math.max(0,publications-n),dbCalls:b.calls()-dbBefore,peakParentRssBytes:parentPeak});out.jobsCompleted+=n;
   }
   const f=seed(c,1)[0];for(let i=0;i<100;i++)assert.equal((await register(f)).state,'job_registered');
   assert.equal(c.target(`SELECT count(*) FROM private.shared_segment_assessment_jobs WHERE movement_need_id='${f.need}';`),'1');
   assert.equal((await executeOne(b.backend,{compute})).state,'completed');out.jobsCompleted++;
   const before=b.calls();for(let i=0;i<100;i++)assert.equal((await register(f)).state,'assessment_reuse');assert.equal(b.calls()-before,100);
   out.dedup={registrationAttempts:100,canonicalJobs:1,reuseOperations:100,newComputes:0,publications:Number(c.target(`SELECT count(*) FROM private.shared_segment_geographic_assessments WHERE movement_need_id='${f.need}';`))};
   await record('before_claim',async()=>{
    const x=seed(c,1)[0];await register(x);let reached;
    const barrier=new Promise(resolve=>{reached=resolve;});b.setHook(async name=>{if(name==='claim_shared_segment_assessment_job_for_server'){reached();return true;}return false;});
    const p=spawn('normal');await barrier;p.kill();await p.done;b.setHook(null);
    assert.equal(c.target(`SELECT status FROM private.shared_segment_assessment_jobs WHERE movement_need_id='${x.need}';`),'pending');
    assert.equal((await executeOne(b.backend,{compute})).state,'completed');out.jobsCompleted++;
   });
   await record('after_claim',async()=>{
    const x=seed(c,1)[0];await register(x);let reached;
    const barrier=new Promise(resolve=>{reached=resolve;});b.setHook(async name=>{if(name==='load_shared_segment_assessment_job_context_for_server'){reached();return true;}return false;});
    const p=spawn('normal');await barrier;p.kill();await p.done;b.setHook(null);
    const j=JSON.parse(c.target(`SELECT json_build_object('job_id',id,'lease_token',lease_token) FROM private.shared_segment_assessment_jobs WHERE movement_need_id='${x.need}';`));
    assert.equal(c.target(`SELECT status||':'||attempt_count FROM private.shared_segment_assessment_jobs WHERE id='${j.job_id}';`),'running:1');
    assert.equal(c.target(`SELECT count(*) FROM private.shared_segment_geographic_assessments WHERE movement_need_id='${x.need}';`),'0');
    // Wait for the real unchanged 60-second lease, with no timing guess.
    while(c.target(`SELECT lease_expires_at<=clock_timestamp() FROM private.shared_segment_assessment_jobs WHERE id='${j.job_id}';`)!=='t')await delay(1000);
    const next=await b.backend.claim(AbortSignal.timeout(5000));if(next.state!=='claimed')throw Error('Expected claim');assert.equal(next.attempt_count,2);assert.notEqual(next.lease_token,j.lease_token);
    const loaded=await b.backend.load(next.job_id,next.lease_token,AbortSignal.timeout(5000));if(loaded.state!=='ready')throw Error('Expected context');
    const v=await compute(loaded.snapshot.offerer_shape,loaded.snapshot.requester_shape);
    await record('stale_token',async()=>assert.equal((await b.backend.finalize(j.job_id,j.lease_token,loaded.snapshot.context,v.result,AbortSignal.timeout(5000))).state,'lease_invalid'));
    assert.equal((await b.backend.finalize(next.job_id,next.lease_token,loaded.snapshot.context,v.result,AbortSignal.timeout(5000))).state,'completed');out.jobsCompleted++;
   });
   await record('child_kill',async()=>{
    const x=seed(c,1)[0];await register(x);
    const v=await executeOne(b.backend,{compute:(a,b,o)=>calculateIsolated(a,b,{...o,childPath:path.join(ROOT,'supabase/tests/fixtures/0101-compute-killed.cjs')})});assert.equal(v.state,'pending');
    assert.equal(c.target(`SELECT last_failure FROM private.shared_segment_assessment_jobs WHERE movement_need_id='${x.need}';`),'compute_terminated');
    assert.equal(c.target(`SELECT count(*) FROM private.shared_segment_geographic_assessments WHERE movement_need_id='${x.need}';`),'0');
    for(let attempt=2;attempt<=3;attempt++){
     c.target(`UPDATE private.shared_segment_assessment_jobs SET next_attempt_at=clock_timestamp() WHERE movement_need_id='${x.need}';`);
     const v=await executeOne(b.backend,{compute:()=>Promise.reject(Object.assign(Error(),{code:'compute_terminated'}))});assert.equal(v.state,attempt===3?'failed':'pending');
    }
   });
   await record('lost_publication_ack',async()=>{
    const x=seed(c,1)[0];await register(x);let reached;
    /** @type {{value:any}} */ const committed={value:null};
    const barrier=new Promise(resolve=>{reached=resolve;});b.setHook(async(name,args)=>{if(name!=='finalize_shared_segment_assessment_job_for_server')return false;
     committed.value=await b.query(`SELECT public.${name}(${Object.entries(args).map(([k,v])=>`${k}=>${literal(v)}`).join(',')});`);reached();return true;});
    const p=spawn('normal');await barrier;p.kill();await p.done;b.setHook(null);assert(committed.value);assert.equal(committed.value.state,'completed');
    assert.equal((await register(x)).state,'assessment_reuse');assert.equal((await b.backend.claim(AbortSignal.timeout(5000))).state,'idle');
    const j=JSON.parse(c.target(`SELECT json_build_object('job_id',id,'lease_token',lease_token,'context',canonical_context) FROM private.shared_segment_assessment_jobs WHERE movement_need_id='${x.need}';`));
    const recovered=await b.backend.finalize(j.job_id,j.lease_token,j.context,null,AbortSignal.timeout(5000),true);if(recovered.state!=='completed')throw Error('Expected completion');assert.equal(recovered.publication_state,'reuse_existing');
    assert.equal(c.target(`SELECT count(*) FROM private.shared_segment_geographic_assessments WHERE movement_need_id='${x.need}';`),'1');out.jobsCompleted++;
   });
   for(const signal of /** @type {NodeJS.Signals[]} */(['SIGTERM','SIGINT']))await record(signal==='SIGTERM'?'sigterm_idle':'sigint_idle',async()=>{
    const p=spawn('normal');await p.wait('worker_ready');const result=await p.stop(signal);assert.equal(result.code,0);assert(p.events.some(e=>e.event==='worker_stopped'));
    const stopped=p.events.findIndex(e=>e.event==='shutdown_started');assert(p.events.slice(stopped+1).every(e=>e.event!=='worker_ready'));
   });
   await record('sigterm_compute',async()=>{
    const x=seed(c,1)[0];await register(x);const p=spawn('stall');await p.wait('compute_started');const result=await p.stop();assert.equal(result.code,0);
    assert.equal(c.target(`SELECT status FROM private.shared_segment_assessment_jobs WHERE movement_need_id='${x.need}';`),'running');
    assert.equal(c.target(`SELECT count(*) FROM private.shared_segment_geographic_assessments WHERE movement_need_id='${x.need}';`),'0');
    const j=JSON.parse(c.target(`SELECT json_build_object('job_id',id) FROM private.shared_segment_assessment_jobs WHERE movement_need_id='${x.need}';`));expired(j);
    assert.equal((await executeOne(b.backend,{compute})).state,'completed');out.jobsCompleted++;
   });
   await record('calculation_failed',async()=>{
    const x=seed(c,1)[0];await register(x);const result=emptyResult();result.assessmentState='assessment_unavailable';result.reasons=['calculation_failed'];
    assert.equal((await executeOne(b.backend,{compute:async()=>({result,metrics:{wallMs:0,computeMs:0,cpuMs:0,peakRssBytes:0}})})).state,'pending');
    assert.equal(c.target(`SELECT count(*) FROM private.shared_segment_geographic_assessments WHERE movement_need_id='${x.need}';`),'0');
    c.target(`UPDATE private.shared_segment_assessment_jobs SET next_attempt_at=clock_timestamp() WHERE movement_need_id='${x.need}';`);assert.equal((await executeOne(b.backend,{compute})).state,'completed');out.jobsCompleted++;
   });
   if(idleMs)out.idle=await observeIdle(idleMs,b.backend);
   out.processLeakCheck=processes.every(p=>safeOutput(p.output(),b.secret));assert(out.processLeakCheck);
   out.dbCalls=b.calls();report=out;
  }finally{for(const p of processes)p.kill();b.setHook(null);await b.close();}
 });return report;
}
module.exports={integration,seed,bridge,workerProcess,safeOutput};
