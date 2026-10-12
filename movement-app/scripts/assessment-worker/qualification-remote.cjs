'use strict';
// Qualification-only boundary. No production worker configuration is consulted.
const crypto=require('node:crypto'),path=require('node:path'),cp=require('node:child_process');
const {setTimeout:delay}=require('node:timers/promises');
const DENIED=Object.freeze(['xdfmoggrsucisfybqctb','udlsysezmzutydnifhsq']);
const WARNING='This qualification will create immutable synthetic Movement evidence.\nUse only a disposable non-production Supabase environment.\nThe environment must be destroyed after qualification.\n';
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const fail=()=>{throw Error('Disposable qualification configuration unavailable');};
function configuration(env,ack){
 const ref=env.MOVEMENT_QUALIFICATION_PROJECT_REF,url=env.MOVEMENT_QUALIFICATION_SUPABASE_URL,secret=env.MOVEMENT_QUALIFICATION_SERVICE_ROLE_KEY;
 if(!ack||env.MOVEMENT_QUALIFICATION_ENVIRONMENT_KIND!=='disposable'||typeof ref!=='string'||!/^[a-z0-9]{20}$/.test(ref)||DENIED.includes(ref))fail();
 let parsed;try{parsed=new URL(url);}catch{fail();}
 if(parsed.protocol!=='https:'||parsed.hostname!==ref+'.supabase.co'||parsed.port||parsed.username||parsed.password||parsed.pathname!=='/'||parsed.search||parsed.hash)fail();
 // Reject alternate URL spellings, escaped hostnames and lookalike domains.
 if(url!==`https://${ref}.supabase.co`&&url!==`https://${ref}.supabase.co/`)fail();
 if(typeof secret!=='string'||!secret||/\s/.test(secret))fail();
 if(secret.startsWith('eyJ')){
  let claims;try{claims=JSON.parse(Buffer.from(secret.split('.')[1],'base64url').toString());}catch{fail();}
  if(claims.role!=='service_role'||claims.ref!==ref||DENIED.includes(claims.ref))fail();
 }else if(!/^sb_secret_[A-Za-z0-9_-]+$/.test(secret))fail();
 return {ref,url:parsed.origin,secret,projectRefHash:hash(ref)};
}
function capsuleKey(value){if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))fail();return Buffer.from(value,'hex');}
function seal(value,key){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',capsuleKey(key),iv);const ciphertext=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),ciphertext]).toString('base64url');}
function open(value,key,projectRefHash){
 try{
  if(typeof value!=='string'||value.length>65536||!/^[A-Za-z0-9_-]+$/.test(value))fail();
  const raw=Buffer.from(value,'base64url'),decipher=crypto.createDecipheriv('aes-256-gcm',capsuleKey(key),raw.subarray(0,12));decipher.setAuthTag(raw.subarray(12,28));
  const v=JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)),decipher.final()]).toString());
  if(v.version!=='0102'||v.projectRefHash!==projectRefHash||v.migrationDigest!==require('./qualify-remote-schema.cjs').migrationDigest()||!Number.isFinite(Date.parse(v.createdAt))||Date.now()-Date.parse(v.createdAt)>3600000||Date.parse(v.createdAt)>Date.now()+60000||!Array.isArray(v.pairs)||v.pairs.length!==4)fail();
  const ids=[];for(const p of v.pairs){if(Object.keys(p).sort().join('|')!=='availability|need|requester')fail();for(const id of Object.values(p)){if(typeof id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id))fail();ids.push(id);}}
  if(new Set(ids).size!==ids.length)fail();return v;
 }catch{fail();}
}
const cleanup=()=>({strategy:'disposable_environment_teardown',recordLevelCleanupAttempted:false,environmentTeardownRequired:true,environmentTeardownCompleted:false});
function safeLogs(text,config){
 if([config.secret,config.url,config.ref].some(v=>text.includes(v))||/coordinates|canonical_context|lease_token|job_id|assessment_id|sb_secret_|eyJ|https?:|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/i.test(text))return false;
 const keys=['event','timestamp','uptimeSeconds','workerVersion','algorithmVersion','pollCount','attemptCount','durationMs','computeMs','cpuMs','peakRssBytes','rssBytes','state','resultCategory'];
 try{return text.trim().split('\n').filter(Boolean).every(line=>Object.keys(JSON.parse(line)).every(k=>keys.includes(k)));}catch{return false;}
}
function processTest(config,abandon=false,{entryPath=path.join(__dirname,'qualification-remote-process.cjs')}={}){
 return new Promise((resolve,reject)=>{
  const started=performance.now(),child=cp.fork(entryPath,[abandon?'abandon':'idle','--ack-disposable-environment'],
   /** @type {import('node:child_process').ForkOptions & {windowsHide:boolean}} */({env:{MOVEMENT_QUALIFICATION_ENVIRONMENT_KIND:'disposable',MOVEMENT_QUALIFICATION_PROJECT_REF:config.ref,MOVEMENT_QUALIFICATION_SUPABASE_URL:config.url,MOVEMENT_QUALIFICATION_SERVICE_ROLE_KEY:config.secret},execArgv:['--no-warnings'],silent:true,windowsHide:true}));
  let output='',ready=false,claimed=false,stopping=false,claim=null;
  const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Qualification process unavailable'));},15000);
  const collect=v=>{output+=v;if(output.length>65536)child.kill('SIGKILL');};child.stdout.on('data',collect);child.stderr.on('data',collect);
  child.on('message',v=>{if(!v||typeof v!=='object'||!('event' in v))return;if(v.event==='worker_ready')ready=true;if(v.event==='qualification_claimed'&&'claim' in v){claimed=true;claim=v.claim;}
   if(!stopping&&(abandon?claimed:ready)){stopping=true;child.kill(abandon?'SIGKILL':'SIGTERM');}});
  child.on('error',()=>{clearTimeout(timer);reject(Error('Qualification process unavailable'));});
  child.on('close',(code,signal)=>{clearTimeout(timer);resolve({passed:abandon?claimed&&signal==='SIGKILL':ready&&code===0,ready,safe:safeLogs(output,config),claim,durationMs:performance.now()-started});});
 });
}
// Dependencies may be replaced by local tests; CLI has no mock or endpoint switches.
/** @param {any} config @param {any} capsule @param {any} [dependencies] */
async function remote(config,capsule,{backend,compute,processCheck=processTest,wait=delay,now=()=>Date.now()}={}){
 const {createAssessmentJobBackend}=require('../../supabase/functions/_shared/shared-segment-assessment-job-runtime.ts');
 const {executeOne}=require('./worker.cjs'),{calculateIsolated}=require('./compute.cjs');
 const out={projectRefHash:config.projectRefHash,environmentKind:'disposable',fixtureCleanup:cleanup(),schema:{operatorCatalogVerified:true,runtimeCompatible:null,fullCatalogVerifiedOnHost:false},
  measurements:{startup:null,idleSigterm:null,jobExecution:null,exactReuse:null,staleFencing:null,childCrash:null,claimedLeaseRecovery:null,lostAcknowledgementRecovery:null,platformRestart:null,hostSecretStorage:null,participantAcl:null},
  safeLogs:true,dbCalls:0,jobsCompleted:0,childCpuMs:0,peakChildRssBytes:0,newComputes:0,publications:0,failure:null};
 const real=backend||createAssessmentJobBackend(config.url,config.secret),io=()=>AbortSignal.timeout(5000);
 const b=Object.fromEntries(Object.entries(real).map(([name,fn])=>[name,async(...args)=>{out.dbCalls++;return await fn(...args);} ]));
 const calculate=async(...args)=>{out.newComputes++;const got=await (compute||calculateIsolated)(...args);out.childCpuMs+=got.metrics.cpuMs;out.peakChildRssBytes=Math.max(out.peakChildRssBytes,got.metrics.peakRssBytes);return got;};
 try{
  // load is read-only and invalid, reserved identity can never authorize a write.
  const missing='01020000-0000-4000-8000-000000000000';
  if((await b.load(missing,missing,io())).state!=='lease_invalid')throw Error();
  out.schema.runtimeCompatible=true;
  // Dedicated environment must have no competing worker or existing runnable jobs.
  // First claim happens only after the read-only compatibility prerequisite.
  if((await b.claim(io())).state!=='idle')throw Error();
  if(process.platform!=='win32'){
   const p=await processCheck(config);out.measurements.startup=p.ready;out.measurements.idleSigterm=p.passed;out.safeLogs&&=p.safe;
  }
  const register=p=>b.register(p.requester,p.need,p.availability,io());
  const registered=await register(capsule.pairs[0]);if(registered.state!=='job_registered'||registered.attempt_count!==0)throw Error();
  const bound={...b,claim:async signal=>{const j=await b.claim(signal);if(j.state!=='claimed'||j.job_id!==registered.job_id)throw Error();return j;}};
  let published=null;
  const tracking={...bound,finalize:async(...args)=>{const v=await b.finalize(...args);if(v.state==='completed')published=v.assessment_id;return v;}};
  const job=await executeOne(tracking,{compute:calculate});if(job.state!=='completed'||!published)throw Error();
  out.jobsCompleted++;out.publications++;out.measurements.jobExecution=true;
  const before=out.newComputes,reused=await register(capsule.pairs[0]);
  if(reused.state!=='assessment_reuse'||reused.assessment.assessment_id!==published||out.newComputes!==before||(await b.claim(io())).state!=='idle')throw Error();out.measurements.exactReuse=true;
  // COMMIT acknowledgement is deliberately discarded locally, not retried as compute.
  const lost=await register(capsule.pairs[1]);if(lost.state!=='job_registered')throw Error();let dropped=false;
  const lostBackend={...b,claim:async s=>{const j=await b.claim(s);if(j.state!=='claimed'||j.job_id!==lost.job_id)throw Error();return j;},finalize:async(...args)=>{
   const v=await b.finalize(...args);if(!dropped&&v.state==='completed'){dropped=true;throw Error('Acknowledgement discarded');}return v;}};
  const count=out.newComputes;if((await executeOne(lostBackend,{compute:calculate})).state!=='completed'||out.newComputes!==count+1)throw Error();
  if((await register(capsule.pairs[1])).state!=='assessment_reuse')throw Error();out.measurements.lostAcknowledgementRecovery=true;out.jobsCompleted++;out.publications++;
  // Abrupt process death leaves the genuine 60-second DB lease. No SQL clock edits.
  const restart=await register(capsule.pairs[2]);if(restart.state!=='job_registered')throw Error();
  let old;
  if(process.platform!=='win32'){
   const killed=await processCheck(config,true);out.safeLogs&&=killed.safe;if(!killed.passed)throw Error();old=killed.claim;out.dbCalls++;
  }else{old=await b.claim(io());}
  if(old.state!=='claimed'||old.job_id!==restart.job_id)throw Error();
  const loaded=await b.load(old.job_id,old.lease_token,io());if(loaded.state!=='ready')throw Error();
  // This supervisor-held orphan proves lease/fencing, not a provider restart.
  const until=Date.parse(old.lease_expires_at);if(until-now()>61000||until<now())throw Error();
  const leaseWaitStarted=performance.now();
  while(now()<=until){if(performance.now()-leaseWaitStarted>70000)throw Error();await wait(Math.min(1000,until-now()+1));}
  const next=await b.claim(io());if(next.state!=='claimed'||next.job_id!==old.job_id||next.lease_token===old.lease_token||next.attempt_count!==old.attempt_count+1)throw Error();
  if((await b.finalize(old.job_id,old.lease_token,loaded.snapshot.context,null,io(),true)).state!=='lease_invalid')throw Error();out.measurements.staleFencing=true;
  const recovered=await executeOne({...b,claim:async()=>next},{compute:calculate});if(recovered.state!=='completed')throw Error();out.measurements.claimedLeaseRecovery=true;out.jobsCompleted++;out.publications++;
  // A real killed child is infrastructure failure, never geographic processing_limit.
  const crash=await register(capsule.pairs[3]);if(crash.state!=='job_registered')throw Error();let category=null;
  const crashBackend={...b,claim:async s=>{const j=await b.claim(s);if(j.state!=='claimed'||j.job_id!==crash.job_id)throw Error();return j;},fail:async(...args)=>{category=args[2];return await b.fail(...args);}};
  const failure=await executeOne(crashBackend,{compute:(a,b,o)=>calculateIsolated(a,b,{...o,childPath:path.resolve(__dirname,'../../supabase/tests/fixtures/0101-compute-killed.cjs')})});
  if(failure.state!=='pending'||category!=='compute_terminated'||failure.result)throw Error();out.measurements.childCrash=true;
 }catch{out.failure=out.schema.runtimeCompatible===null?'staging_schema_mismatch':'remote_execution_failed';if(out.schema.runtimeCompatible===null)out.schema.runtimeCompatible=false;}
 return out;
}
module.exports={DENIED,WARNING,configuration,hash,seal,open,cleanup,safeLogs,processTest,remote};
