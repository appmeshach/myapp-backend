'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),cp=require('node:child_process'),crypto=require('node:crypto'),path=require('node:path');
const {parameterFingerprint,ASSESSMENT_VERSION}=require('../supabase/functions/_shared/shared-segment-assessment-contracts.ts');
const {safeOutput,workerProcess}=require('../scripts/assessment-worker/qualification-integration.cjs');
const RUN=path.resolve('scripts/assessment-worker/run.cjs');
async function fakeControl({job=false,denied=false}={}){
 const secret='qualification_'+crypto.randomBytes(16).toString('hex'),id=crypto.randomUUID(),token=crypto.randomUUID(),fp=await parameterFingerprint();let claims=0,finalizes=0;
 const expires=new Date(Date.now()+60000).toISOString(),shape={type:'LineString',coordinates:[[0,0],[0.003,0]]};
 const context={need_id:crypto.randomUUID(),requester_id:crypto.randomUUID(),intent_id:crypto.randomUUID(),offerer_id:crypto.randomUUID(),algorithm_version:ASSESSMENT_VERSION,parameter_fingerprint:fp,
 offerer_evidence:{id:crypto.randomUUID(),version:1},requester_evidence:{id:crypto.randomUUID(),version:1},expires_at:expires};
 const server=http.createServer(async(req,res)=>{
  for await(const _ of req){}assert.equal(req.headers.apikey,secret);
  if(denied){res.writeHead(401);res.end('{}');return;}
  const name=req.url.split('/').at(-1);let value;
  if(name==='claim_shared_segment_assessment_job_for_server'){claims++;value=job?{state:'claimed',job_id:id,lease_token:token,lease_expires_at:expires,attempt_count:1}:{state:'idle'};}
  else if(name==='load_shared_segment_assessment_job_context_for_server')value={state:'ready',job_id:id,attempt_count:1,lease_expires_at:expires,
   snapshot:{input_state:'ready',reason:null,input_context_fingerprint:'a'.repeat(64),expires_at:expires,context,offerer_shape:shape,requester_shape:shape},
   assessment:{lookup_state:'not_found',assessment_id:null,algorithm_version:null,parameter_fingerprint:null,canonical_result:null}};
  else if(name==='finalize_shared_segment_assessment_job_for_server'){finalizes++;value={state:'completed',assessment_id:crypto.randomUUID(),publication_state:'published'};}
  else value={state:'pending'};
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(value));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {url:`http://127.0.0.1:${server.address().port}`,secret,claims:()=>claims,finalizes:()=>finalizes,async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
test('actual process missing config and invalid args exit nonzero with fixed errors',()=>{
 for(const args of [[],['--unknown'],['--once','--once']]){
  const v=cp.spawnSync(process.execPath,['--no-warnings',RUN,...args],{env:{},encoding:'utf8',timeout:15000,windowsHide:true});assert.equal(v.status,1);assert.match(v.stderr,/bootstrap_failed/);assert(!/Error:|stack|SUPABASE/.test(v.stderr));
 }
});
test('actual --once process validates authenticated control path and exits zero while idle',async()=>{
 const b=await fakeControl();try{const p=workerProcess(b,'once');const v=await p.done;assert.equal(v.code,0);assert.equal(b.claims(),1);assert(p.events.some(v=>v.event==='worker_ready'));assert(safeOutput(p.output(),b.secret));}finally{await b.close();}
});
test('actual process authenticated bootstrap failure exits nonzero and leaks no secret',async()=>{
 const b=await fakeControl({denied:true});try{const p=workerProcess(b,'once');const v=await p.done;assert.equal(v.code,1);assert(!p.output().includes(b.secret));assert(!p.events.some(v=>v.event==='worker_ready'));}finally{await b.close();}
});
for(const signal of ['SIGTERM','SIGINT'])test('idle process clean shutdown '+signal,{timeout:15000},async t=>{
 const b=await fakeControl();let p;try{p=workerProcess(b);await p.wait('worker_ready');const v=await p.stop(signal);assert.equal(v.code,0);assert.equal(b.claims(),1);assert(p.events.some(v=>v.event==='shutdown_started'));assert(p.events.some(v=>v.event==='worker_stopped'));assert(safeOutput(p.output(),b.secret));
  t.diagnostic(process.platform==='win32'?'Windows: signal handler dispatched over test IPC; not POSIX delivery':'Actual POSIX signal delivered to Node worker');
 }finally{p?.kill();await b.close();}
});
test('SIGTERM during active isolated compute terminates child, stops claims and publishes nothing',{timeout:15000},async t=>{
 const b=await fakeControl({job:true});let p;try{p=workerProcess(b,'stall');await p.wait('compute_started');const started=performance.now(),v=await p.stop();assert.equal(v.code,0);assert(performance.now()-started<6000);assert.equal(b.claims(),1);assert.equal(b.finalizes(),0);assert(p.events.some(v=>v.state==='interrupted'));assert(safeOutput(p.output(),b.secret));
  t.diagnostic(process.platform==='win32'?'Windows: signal handler dispatch; active child terminated using SIGKILL':'Actual POSIX SIGTERM during child supervision');
 }finally{p?.kill();await b.close();}
});
