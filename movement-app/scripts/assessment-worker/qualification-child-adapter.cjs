'use strict';
const cp=require('node:child_process'),path=require('node:path');
const supervisor=require('./qualification-supervisor.cjs'),p=require('./qualification-child-protocol.cjs');
const entryIdentity=require('./qualification-child-entry-identity.cjs'),operator=require('./qualification-operator-evidence.cjs');
const ENTRY=path.join(__dirname,'qualification-child-entry.cjs'),sessions=new WeakMap();
const ENV=['MOVEMENT_QUALIFICATION_ENVIRONMENT_KIND','MOVEMENT_QUALIFICATION_PROJECT_REF','MOVEMENT_QUALIFICATION_SUPABASE_URL','MOVEMENT_QUALIFICATION_SERVICE_ROLE_KEY','MOVEMENT_QUALIFICATION_FIXTURE_CAPSULE','MOVEMENT_QUALIFICATION_FIXTURE_KEY','MOVEMENT_QUALIFICATION_RAILWAY_PROJECT_ID','MOVEMENT_QUALIFICATION_RAILWAY_ENVIRONMENT_ID','MOVEMENT_QUALIFICATION_RAILWAY_SERVICE_ID','MOVEMENT_QUALIFICATION_RAILWAY_SERVICE_INSTANCE_ID'];
// No CLI and no default DB backend. Fork injection is trusted test code, not JSON.
/** @param {any} input @param {any} options */
function createChildAdapter(input,options){
 p.exact(options,['backend',...(Object.hasOwn(options,'fork')?['fork']:[]),...(Object.hasOwn(options,'timeoutMs')?['timeoutMs']:[])]);
 const {backend,fork=cp.fork,timeoutMs=30000}=options;
 if(!backend||['register','claim','load'].some(k=>typeof backend[k]!=='function')||typeof fork!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>60000)p.fail();
 const plan=structuredClone(input),context=supervisor.qualificationContext(plan,Date.now()),wire={...context.envelope,workerSourceSha256:context.bound.workerSourceSha256,migrationDigest:context.bound.migrationDigest};
 const fixedEntry=entryIdentity.pinFixedChildEntry();
 const privatePlan={...plan,env:Object.fromEntries(ENV.filter(k=>Object.hasOwn(plan.env,k)).map(k=>[k,plan.env[k]]))};
 let child,phase='unspawned',pending=null,terminal=false,released=false,receiptSeen=false,observer,request=0,originalClaim,output=0,timer,lifecycleTimer;
 let spawnObserved=false,ipcObserved=false,childPid=null,spawnObservedAt=null;
 const synthetic=Object.hasOwn(options,'fork');
 function stop(){if(terminal)return;terminal=true;clearTimeout(timer);clearTimeout(lifecycleTimer);if(pending){pending.reject(Error('Qualification child unavailable'));pending=null;}try{if(child&&child.connected)child.disconnect();}catch{}try{if(child)child.kill('SIGKILL');}catch{}}
 function send(type,extra={}){if(terminal||!child||!child.connected)p.fail();const v={type,binding:wire,...extra};p.message(v,wire);child.send(v,e=>{if(e)stop();});}
 function resolve(value){if(!pending)p.fail();const current=pending;pending=null;clearTimeout(timer);current.resolve(value);}
 function arm(){clearTimeout(timer);timer=setTimeout(stop,timeoutMs);}
 async function receive(value){try{
  if(terminal)p.fail();const v=p.message(value,wire);
  if(v.type==='hello'){
   if(phase!=='spawned')p.fail();phase='initializing';send('initialize',{plan:privatePlan});return;
  }
  if(v.type==='ready'){if(phase!=='initializing')p.fail();ipcObserved=true;phase='registering';send('register');return;}
  if(v.type==='backend_request'){
   const methods=['register','claim','load'];if(v.requestId!==request+1||v.method!==methods[request]||!(request===0?phase==='registering':phase==='preparing'))p.fail();request++;
   const expected=v.method==='register'?[context.pair.requester,context.pair.need,context.pair.availability]:v.method==='claim'?[]:[plan.jobId,originalClaim&&originalClaim.lease_token];
   if(v.args.length!==expected.length||v.args.some((x,i)=>x!==expected[i]))p.fail();
   const result=await backend[v.method](...v.args,AbortSignal.timeout(5000));if(terminal)p.fail();
   if(v.method==='claim'){p.exact(result,['state','job_id','lease_token','lease_expires_at','attempt_count']);if(result.state!=='claimed'||result.job_id!==plan.jobId||result.attempt_count!==1)p.fail();originalClaim=structuredClone(result);}
   send('backend_result',{requestId:v.requestId,value:result});return;
  }
  if(v.type==='registered'){if(phase!=='registering'||request!==1)p.fail();p.exact(v.value,['state','job_id','status','attempt_count']);if(v.value.state!=='job_registered'||v.value.job_id!==plan.jobId||v.value.status!=='pending'||v.value.attempt_count!==0)p.fail();phase='registered';resolve(structuredClone(v.value));return;}
  if(v.type==='prepared'){if(phase!=='preparing'||request!==3)p.fail();p.exact(v.value,['envelope','claim','fixture']);p.same(v.value.envelope,context.envelope);p.same(v.value.claim,originalClaim);p.same(v.value.fixture,{needId:context.pair.need,requesterId:context.pair.requester,availabilityId:context.pair.availability});phase='prepared';resolve(structuredClone(v.value));return;}
  if(v.type==='fault_receipt'){
   if(phase!=='released'||!released||receiptSeen)p.fail();receiptSeen=true;phase='receipt_pending';p.exact(v.value,['controlled','claim']);p.same(v.value.claim,originalClaim);
   await observer(structuredClone(v.value));if(terminal||phase!=='receipt_pending')p.fail();phase='receipt_acknowledged';send('receipt_ack');return;
  }
  p.fail();
 }catch{stop();}}
 function spawn(){
  if(child||phase!=='unspawned')p.fail();
  fixedEntry.assertUnchanged();
  if(operator.workerSourceHash()!==context.bound.workerSourceSha256)p.fail();
  phase='spawned';
  child=fork(ENTRY,[],{execPath:process.execPath,execArgv:[],env:Object.fromEntries(['SystemRoot','TEMP','TMP'].filter(k=>typeof process.env[k]==='string').map(k=>[k,process.env[k]])),shell:false,windowsHide:true,serialization:'json',stdio:['ignore','pipe','pipe','ipc']});
  lifecycleTimer=setTimeout(stop,120000);
  if(!child||typeof child.send!=='function'||typeof child.on!=='function'||!child.connected)p.fail();
  child.once('spawn',()=>{if(terminal||spawnObserved)return;spawnObserved=true;spawnObservedAt=new Date().toISOString();childPid=Number.isSafeInteger(child.pid)&&child.pid>0?child.pid:null;});
  child.on('message',receive);child.on('error',stop);
  child.on('disconnect',()=>{if(phase!=='receipt_acknowledged')stop();});
  child.on('exit',(code,signal)=>{
   if(terminal)return;
   if(phase!=='receipt_acknowledged'||!released||!receiptSeen||code!==null||signal!=='SIGKILL'){stop();return;}
   phase='self_terminated';terminal=true;clearTimeout(timer);clearTimeout(lifecycleTimer);resolve({code:null,signal:'SIGKILL'});
  });
  const collect=data=>{output+=Buffer.byteLength(data);if(output>p.LIMIT||data.length)stop();};
  if(!child.stdout||!child.stderr)p.fail();child.stdout.on('data',collect);child.stderr.on('data',collect);
 }
 async function command(ticket,expected,type){try{
  p.same(ticket,context.envelope);if(terminal||phase!==expected)p.fail();
  return await new Promise((resolve,reject)=>{pending={resolve,reject};arm();try{if(type==='register')spawn();else{phase='preparing';send('prepare');}}catch{stop();}});
 }catch{stop();p.fail();}}
 const worker=Object.freeze({register:ticket=>command(ticket,'unspawned','register'),prepare:ticket=>command(ticket,'registered','prepare'),async fire(ticket,observe,authorization){try{
  p.same(ticket,context.envelope);if(terminal||phase!=='prepared'||released||typeof observe!=='function')p.fail();
  supervisor.consumeFaultAuthorization(authorization,context.envelope,{workerSourceSha256:wire.workerSourceSha256,migrationDigest:wire.migrationDigest});
  released=true;observer=observe;phase='released';
  return await new Promise((resolve,reject)=>{pending={resolve,reject};arm();try{send('release');}catch{stop();}});
 }catch{stop();p.fail();}}});
 sessions.set(worker,{stop,snapshot:()=>({
  provider:'Railway',evidenceKind:synthetic?'synthetic_transport':'local_node_observation',
  binding:structuredClone(wire),controlPlane:{source:'operator_plan_constraints',independentlyAuthoritative:false,...structuredClone(context.binding.identities),executionSha256:wire.executionSha256},
  runtime:{source:null,identity_proven:null,limitation:'runtime_identity_provenance_unresolved'},
  local:{parentPid:process.pid,childPid,spawnObservedAt,spawnObserved,ipcObserved,ownedChild:!!child,parentChildObserved:!synthetic&&spawnObserved&&ipcObserved&&childPid!==null,sourceRevalidated:!!child,controlledExitObserved:phase==='self_terminated'},
  identity_proven:null,restart_origin_proven:null,platformRestart:null,restartAttribution:{measurement:null,limitation:'restart_origin_unattributable'},observedAt:new Date().toISOString(),
 })});supervisor.attachWorkerCleanup(worker,stop);return worker;
}
// Cancellation can terminate only the child owned by this reviewed adapter instance.
function closeChildAdapter(worker){const session=sessions.get(worker);if(!session)p.fail();session.stop();}
// No artifact decoder or runtime-ID input. Only the original owned worker is a key.
function childTopology(worker){const session=sessions.get(worker);if(arguments.length!==1||!session)p.fail();return session.snapshot();}
function correlateOwnedChild(worker){
 if(arguments.length!==1)p.fail();
 const topology=childTopology(worker),evidence=supervisor.completedQualification(worker);
 if(!topology.local.controlledExitObserved)p.fail();
 for(const key of ['qualificationRunSha256','supervisorRunSha256','jobSha256'])if(evidence[key]!==topology.binding[key])p.fail();
 if(evidence.controlledFailure.executionSha256!==topology.binding.executionSha256||evidence.identities.deploymentSha256!==topology.controlPlane.deploymentSha256)p.fail();
 return {...topology,correlated:true,correlationScope:'validated_local_sequence_only',providerObservationSource:'injected_reader_no_authenticated_completeness_proof',terminationReceiptAt:evidence.controlledFailure.terminatedAt,recovery:{originalAttempt:evidence.recovery.originalAttempt,replacementAttempt:evidence.recovery.replacementAttempt,staleTokenState:evidence.recovery.staleTokenState,publicationCount:evidence.recovery.publicationCount},causality_proven:null};
}
module.exports={createChildAdapter,closeChildAdapter,childTopology,correlateOwnedChild};
