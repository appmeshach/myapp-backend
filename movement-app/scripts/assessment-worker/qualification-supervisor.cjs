'use strict';
// Qualification-only library. No CLI, remote process adapter, execution query or fault switch.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const operator=require('./qualification-operator-evidence.cjs'),railway=require('./qualification-railway-evidence.cjs');
const boundary=require('./qualification-remote.cjs'),admin=require('./qualify-remote-schema.cjs');
const VERSION='0103-qualification-supervisor-v1',WINDOW=3600000;
// Unforgeable in-process release capability. There is deliberately no remote token
// decoder: a future cross-process adapter needs separate review.
const faultAuthorizations=new WeakMap();
const PHASES=Object.freeze(['initialized','provider_preflight','job_registered','original_claim_observed','fault_authorized','fault_observed','provider_recovery_wait','replacement_execution_observed','lease_reclaim_observed','stale_token_fenced','publication_observed','completed']);
const fail=()=>{throw Error('Qualification supervisor evidence unavailable');};
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
function exact(v,keys){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join('|')!==keys.slice().sort().join('|'))fail();}
function uuid(v){if(typeof v!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v))fail();}
function digest(v){if(typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v))fail();}
function id(v){if(typeof v!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v)||/sb_secret_|eyJ|token|PRIVATE KEY/i.test(v))fail();}
function time(v,now,future=0){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString()!==v||Date.parse(v)>now+future||now-Date.parse(v)>WINDOW)fail();return Date.parse(v);}
function stamp(now){if(!Number.isFinite(now))fail();return new Date(now).toISOString();}
function leaseTimestamp(raw,now){
 if(typeof raw!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(raw))fail();
 const parts=raw.replace(/(?:Z|\+00:00)$/,'').split('.'),normalized=parts[0]+'.'+(parts[1]||'').padEnd(3,'0').slice(0,3)+'Z';
 const expiry=time(normalized,now,60000);if(expiry<=now)fail();return normalized;
}
// A sequence recorder is not an evidence verifier: only supervise supplies proven transitions.
function phaseMachine(now=Date.now()){
 const phases=[{phase:'initialized',observedAt:stamp(now)}];let ended=false;
 return Object.freeze({advance(phase,at){
  if(ended||phase!=='failed'&&phase!==PHASES[phases.length])fail();
  const value=time(at,Date.parse(at));if(value<Date.parse(phases.at(-1).observedAt)||value-Date.parse(phases[0].observedAt)>WINDOW)fail();
  phases.push({phase,observedAt:at});ended=['failed','completed'].includes(phase);
 },snapshot(){return structuredClone(phases);}});
}
function startup(plan,now){
 exact(plan,['report','env','ack','mode','jobId','executionId','deploymentId','supervisorNonce','migrationDigest','stateDirectory']);
 // Existing denylist/ack guards run before files, provider, database or worker work.
 const bound=operator.context(plan.report,plan.env,plan.ack,now);
 if(plan.mode!=='remote-staging'||bound.provider!=='Railway'||plan.migrationDigest!==bound.migrationDigest||plan.migrationDigest!==admin.migrationDigest())fail();
 uuid(plan.jobId);id(plan.executionId);id(plan.deploymentId);digest(plan.supervisorNonce);
 if(Object.keys(plan.env).some(k=>/RAILWAY.*(?:TOKEN|PASSWORD|SECRET)/i.test(k)))fail();
 const ids={};for(const [key,suffix] of Object.entries({project:'PROJECT',environment:'ENVIRONMENT',service:'SERVICE',serviceInstance:'SERVICE_INSTANCE'})){
  ids[key]=plan.env['MOVEMENT_QUALIFICATION_RAILWAY_'+suffix+'_ID'];id(ids[key]);
 }
 const config=boundary.configuration(plan.env,plan.ack);
 const capsule=boundary.open(plan.env.MOVEMENT_QUALIFICATION_FIXTURE_CAPSULE,plan.env.MOVEMENT_QUALIFICATION_FIXTURE_KEY,config.projectRefHash);
 time(capsule.createdAt,now); // tighter than the legacy capsule parser's clock tolerance
 const supervisorRunSha256=hash(plan.supervisorNonce);
 const binding={...bound,identities:{...Object.fromEntries(Object.entries(ids).map(([k,v])=>[k+'Sha256',hash(v)])),deploymentSha256:hash(plan.deploymentId)},supervisorRunSha256,jobSha256:hash(plan.jobId)};
 const envelope={supervisorRunSha256,jobSha256:binding.jobSha256,executionSha256:hash(plan.executionId),qualificationRunSha256:bound.qualificationRunSha256};
 return {bound,ids,pair:capsule.pairs[2],binding,envelope};
}
function envelopeCheck(actual,expected){exact(actual,Object.keys(expected));for(const k of Object.keys(expected))if(actual[k]!==expected[k])fail();}
function reserveLocalSupervisor(directory,binding){
 if(typeof directory!=='string'||!path.isAbsolute(directory)||fs.lstatSync(directory).isSymbolicLink()||!fs.statSync(directory).isDirectory())fail();
 const root=fs.realpathSync(directory),repository=operator.repositoryRoot();
 if(!fs.statSync(root).isDirectory()||operator.within(repository,path.resolve(directory))||operator.within(repository,root))fail();
 const file=path.join(root,binding.qualificationRunSha256+'.0103.jsonl');
 // O_EXCL reserves this report only inside this canonical LOCAL directory.
 // It cannot prevent another directory/workstation or journal deletion/loss.
 // Existing, malformed or partial journals are never resumed or accepted as evidence.
 // Even preflight failure consumes this local slot; it is not global fault authority.
 const fd=fs.openSync(file,'wx',0o600);
 try{fs.writeSync(fd,JSON.stringify({version:VERSION,...binding,phase:'initialized'})+'\n');fs.fsyncSync(fd);}catch{fs.closeSync(fd);fail();}
 return {append(value){fs.writeSync(fd,JSON.stringify(value)+'\n');fs.fsyncSync(fd);},close(){fs.closeSync(fd);}};
}
async function bounded(fn,ms=5000){let timer;const controller=new AbortController();try{
 return await Promise.race([Promise.resolve().then(()=>fn(controller.signal)),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Qualification supervisor evidence unavailable'));},ms);})]);
 }finally{controller.abort();clearTimeout(timer);}}
function observation(v,plan,ids,now){
 exact(v,['instance','execution']);const i=v.instance,e=v.execution;
 exact(i,['id','serviceId','environmentId','deploymentId','region','restartPolicyType','restartPolicyMaxRetries']);
 if(i.id!==ids.serviceInstance||i.serviceId!==ids.service||i.environmentId!==ids.environment||i.deploymentId!==plan.deploymentId||i.region!==plan.report.host.region||!['ON_FAILURE','ALWAYS'].includes(i.restartPolicyType)||!Number.isInteger(i.restartPolicyMaxRetries)||i.restartPolicyMaxRetries<1)fail();
 exact(e,['id','deploymentId','createdAt','updatedAt','completedAt','status','observedAt']);id(e.id);
 const created=time(e.createdAt,now),updated=time(e.updatedAt,now),observed=time(e.observedAt,now);
 if(e.deploymentId!==plan.deploymentId||created>updated||updated>observed||!['RUNNING','CRASHED','RESTARTING'].includes(e.status))fail();
 if(e.completedAt!==null&&(time(e.completedAt,now)<created||Date.parse(e.completedAt)>updated))fail();
 if(e.status==='RUNNING'&&e.completedAt!==null)fail();return structuredClone(v);
}
const SNAPSHOT_KEYS=['jobId','needId','requesterId','availabilityId','status','attempt','leaseToken','leaseExpiresAt','updatedAt','assessmentId','publicationCount'];
function snapshot(v,plan,pair,now){
 exact(v,SNAPSHOT_KEYS);for(const k of ['jobId','needId','requesterId','availabilityId'])uuid(v[k]);
 if(v.jobId!==plan.jobId||v.needId!==pair.need||v.requesterId!==pair.requester||v.availabilityId!==pair.availability||!Number.isInteger(v.attempt)||!Number.isInteger(v.publicationCount)||v.publicationCount<0||!['pending','running','completed'].includes(v.status))fail();
 time(v.updatedAt,now);if(v.leaseExpiresAt!==null)time(v.leaseExpiresAt,now,60000);
 if(v.leaseToken!==null)uuid(v.leaseToken);if(v.assessmentId!==null)uuid(v.assessmentId);return structuredClone(v);
}
// Runs only in a future dedicated child adapter, never in the normal worker.
// prepare performs register/claim/load; fire reuses immutable private responses so
// controlledFailure rechecks them without a second claim. The supervisor controls release.
/** @param {any} plan @param {any} dependencies */
function controlledWorker(plan,{backend,terminate,now=()=>Date.now()}){
 plan=structuredClone(plan);
 const context=startup(plan,now()),{pair,envelope}=context;let registration,claim,loaded,fired=false;
 return Object.freeze({
  async register(ticket){envelopeCheck(ticket,envelope);if(registration||fired)fail();
   registration=structuredClone(await bounded(signal=>backend.register(pair.requester,pair.need,pair.availability,signal)));return structuredClone(registration);
  },
  async prepare(ticket){envelopeCheck(ticket,envelope);if(!registration||claim||fired)fail();
   exact(registration,['state','job_id','status','attempt_count']);
   if(registration.state!=='job_registered'||registration.job_id!==plan.jobId||registration.status!=='pending'||registration.attempt_count!==0)fail();
   claim=structuredClone(await bounded(signal=>backend.claim(signal)));
   exact(claim,['state','job_id','lease_token','lease_expires_at','attempt_count']);uuid(claim.job_id);uuid(claim.lease_token);
   if(claim.state!=='claimed'||claim.job_id!==plan.jobId||claim.attempt_count!==1)fail();
   leaseTimestamp(claim.lease_expires_at,now());
   loaded=structuredClone(await bounded(signal=>backend.load(claim.job_id,claim.lease_token,signal)));
   exact(loaded,['state','job_id','attempt_count','lease_expires_at','snapshot','assessment']);
   exact(loaded.snapshot,['input_state','reason','context','input_context_fingerprint','expires_at','offerer_shape','requester_shape']);
   if(loaded.state!=='ready'||loaded.job_id!==plan.jobId||loaded.attempt_count!==1||loaded.lease_expires_at!==claim.lease_expires_at||loaded.snapshot.input_state!=='ready'||loaded.snapshot.reason!==null||loaded.snapshot.context.need_id!==pair.need||loaded.snapshot.context.requester_id!==pair.requester)fail();
   exact(loaded.assessment,['lookup_state','assessment_id','algorithm_version','parameter_fingerprint','canonical_result']);
   if(loaded.assessment.lookup_state!=='not_found'||Object.entries(loaded.assessment).some(([k,v])=>k!=='lookup_state'&&v!==null))fail();
   return {envelope:structuredClone(envelope),claim:structuredClone(claim),fixture:{needId:pair.need,requesterId:pair.requester,availabilityId:pair.availability}};
  },
  async fire(ticket,observe,authorization){
   const allowed=authorization&&faultAuthorizations.get(authorization);
   if(!allowed)fail();faultAuthorizations.delete(authorization);
   envelopeCheck(allowed,envelope);envelopeCheck(ticket,envelope);if(!claim||!loaded||fired||typeof observe!=='function')fail();fired=true;
   const cached={register:async()=>structuredClone(registration),claim:async()=>structuredClone(claim),load:async()=>structuredClone(loaded)};
   // No default termination in this foundation: a reviewed child adapter must supply it.
   if(typeof terminate!=='function')fail();
   return railway.controlledFailure(plan,{backend:cached,observe:receipt=>observe(structuredClone(receipt)),terminate,now});
  }
 });
}
function readQuery(document,variables,env,options){
 if(typeof document!=='string'||/\b(?:mutation|subscription|deploymentRestart|redeploy|deploy)\b/i.test(document))fail();
 return railway.cliQuery(document,variables,env,options);
}
// Provider execution traversal is unknown locally. No live/default read adapter exists.
// Dependencies are reviewed code capabilities, never operator JSON/attestations.
/** @param {any} plan @param {any} dependencies */
async function supervise(plan,{provider,worker,capture,loadOldToken,observer=async()=>{},now=()=>Date.now(),wait=ms=>new Promise(r=>setTimeout(r,ms))}){
 plan=structuredClone(plan);
 let journal,machine;
 try{
  const {bound,ids,pair,binding,envelope}=startup(plan,now());
  exact(provider,['read']);exact(worker,['register','prepare','fire']);
  for(const fn of [provider.read,worker.register,worker.prepare,worker.fire,capture,loadOldToken,observer,now,wait])if(typeof fn!=='function')fail();
  journal=reserveLocalSupervisor(plan.stateDirectory,binding);machine=phaseMachine(now());
  const advance=phase=>{machine.advance(phase,stamp(now()));journal.append({phase,observedAt:stamp(now())});};
  const started=now(),deadline=started+180000;
  const read=async()=>observation(await bounded(signal=>provider.read(signal)),plan,ids,now());
  const take=async()=>snapshot(await bounded(signal=>capture(plan.jobId,signal)),plan,pair,now());
  const poll=async(get,accept)=>{for(let n=0;n<180;n++){
   if(now()>deadline)fail();const v=await get();if(accept(v))return v;
   await bounded(()=>wait(1000));
  }fail();};
  const before=await read();if(before.execution.id!==plan.executionId||before.execution.status!=='RUNNING')fail();advance('provider_preflight');
  const registered=await bounded(()=>worker.register(structuredClone(envelope)));exact(registered,['state','job_id','status','attempt_count']);
  if(registered.state!=='job_registered'||registered.job_id!==plan.jobId||registered.status!=='pending'||registered.attempt_count!==0)fail();
  const unused=await take();if(unused.status!=='pending'||unused.attempt!==0||unused.publicationCount!==0||unused.assessmentId!==null||unused.leaseToken!==null||unused.leaseExpiresAt!==null)fail();advance('job_registered');
  const prepared=await bounded(()=>worker.prepare(structuredClone(envelope)));exact(prepared,['envelope','claim','fixture']);envelopeCheck(prepared.envelope,envelope);
  exact(prepared.fixture,['needId','requesterId','availabilityId']);if(prepared.fixture.needId!==pair.need||prepared.fixture.requesterId!==pair.requester||prepared.fixture.availabilityId!==pair.availability)fail();
  const claim=prepared.claim;exact(claim,['state','job_id','lease_token','lease_expires_at','attempt_count']);uuid(claim.lease_token);
  if(claim.state!=='claimed'||claim.job_id!==plan.jobId||claim.attempt_count!==1)fail();
  const claimExpiry=leaseTimestamp(claim.lease_expires_at,now());
  const original=await take();if(original.status!=='running'||original.attempt!==1||original.leaseToken!==claim.lease_token||original.publicationCount!==0||original.assessmentId!==null||claimExpiry!==original.leaseExpiresAt||Date.parse(original.updatedAt)<Date.parse(claimExpiry)-60000||Date.parse(claimExpiry)-60000<Date.parse(before.execution.createdAt))fail();
  advance('original_claim_observed');
  // Re-observe exact running execution immediately before releasing the one-shot.
  const current=await read();if(current.execution.id!==before.execution.id||current.execution.status!=='RUNNING'||current.execution.createdAt!==before.execution.createdAt||current.instance.restartPolicyType!==before.instance.restartPolicyType||current.instance.restartPolicyMaxRetries!==before.instance.restartPolicyMaxRetries||Date.parse(current.execution.observedAt)<Date.parse(before.execution.observedAt))fail();
  await bounded(()=>observer(structuredClone({version:VERSION,...binding,phase:'original_claim_observed'})));
  leaseTimestamp(claim.lease_expires_at,now());
  advance('fault_authorized'); // fsync must finish before the worker can terminate
  const authorization=Object.freeze({});faultAuthorizations.set(authorization,structuredClone(envelope));
  let controlled;
  try{await bounded(()=>worker.fire(structuredClone(envelope),async receipt=>{
   exact(receipt,['controlled','claim']);envelopeCheck(receipt.claim,claim);
   const c=receipt.controlled;exact(c,['method',...Object.keys(bound),'identities','jobSha256','leaseTokenSha256','executionSha256','derivedLeaseStartAt','leaseDurationMs','leaseStartDerivation','terminatedAt','leaseExpiresAt','providerOperations']);
   for(const k of Object.keys(bound))if(c[k]!==bound[k])fail();
   exact(c.identities,Object.keys(ids).map(k=>k+'Sha256'));for(const k of Object.keys(ids))if(c.identities[k+'Sha256']!==hash(ids[k]))fail();
   if(c.method!=='qualification_worker_self_termination_v1'||c.jobSha256!==binding.jobSha256||c.leaseTokenSha256!==hash(claim.lease_token)||c.executionSha256!==envelope.executionSha256||c.leaseDurationMs!==60000||c.leaseStartDerivation!=='leaseExpiresAt - leaseDurationMs'||!Array.isArray(c.providerOperations)||c.providerOperations.length||c.leaseExpiresAt!==original.leaseExpiresAt)fail();
   const terminated=time(c.terminatedAt,now()),start=time(c.derivedLeaseStartAt,now()),expiry=time(c.leaseExpiresAt,now(),60000);
   if(expiry-start!==60000||start>terminated||terminated>=expiry||terminated<=Date.parse(before.execution.observedAt))fail();
   controlled=structuredClone(c);journal.append({controlledFailure:controlled});
  },authorization));}finally{faultAuthorizations.delete(authorization);}
  if(!controlled)fail();
  const fault=await poll(read,v=>{if(v.execution.id!==before.execution.id)fail();return ['CRASHED','RESTARTING'].includes(v.execution.status);});
  if(fault.instance.restartPolicyType!==before.instance.restartPolicyType||fault.instance.restartPolicyMaxRetries!==before.instance.restartPolicyMaxRetries)fail();
  advance('fault_observed');advance('provider_recovery_wait');
  const replacement=await poll(read,v=>{if(v.execution.id===before.execution.id)return false;if(v.execution.status!=='RUNNING')fail();return true;});
  if(replacement.instance.restartPolicyType!==before.instance.restartPolicyType||replacement.instance.restartPolicyMaxRetries!==before.instance.restartPolicyMaxRetries)fail();advance('replacement_execution_observed');
  const reclaimed=await poll(take,v=>{
   if(v.status==='running'&&v.attempt===1){if(v.leaseToken!==original.leaseToken||v.publicationCount!==0||v.assessmentId!==null)fail();return false;}
   if(v.status!=='running'||v.attempt!==2||v.leaseToken===original.leaseToken||v.leaseToken===null||v.publicationCount!==0||v.assessmentId!==null||Date.parse(v.updatedAt)<Date.parse(original.leaseExpiresAt)||Date.parse(v.updatedAt)<Date.parse(replacement.execution.createdAt))fail();return true;
  });advance('lease_reclaim_observed');
  const oldLoad=await bounded(signal=>loadOldToken(plan.jobId,original.leaseToken,signal));exact(oldLoad,['state']);if(oldLoad.state!=='lease_invalid')fail();advance('stale_token_fenced');
  const completed=await poll(take,v=>{
   if(v.status==='running'&&v.attempt===2){if(v.leaseToken!==reclaimed.leaseToken||v.publicationCount!==0||v.assessmentId!==null)fail();return false;}
   if(v.status!=='completed'||v.attempt!==2||v.leaseToken!==reclaimed.leaseToken||v.assessmentId===null||v.publicationCount!==1||Date.parse(v.updatedAt)<Date.parse(reclaimed.updatedAt))fail();return true;
  });
  const db=railway.recoveryFromSnapshots(original,reclaimed,completed,oldLoad,controlled);
  const correlation=railway.correlateRestart({instance:before.instance,executions:[before.execution,fault.execution,replacement.execution],controlled,db},ids,bound,now());
  if(correlation.measurement!==null||correlation.limitation!=='restart_origin_unattributable')fail();advance('publication_observed');advance('completed');
  const evidence={version:VERSION,...binding,phases:machine.snapshot(),controlledFailure:controlled,recovery:{...db,replacementExecutionSha256:hash(replacement.execution.id)},executions:[before.execution,fault.execution,replacement.execution].map(({id,deploymentId,...rest})=>({...rest,executionSha256:hash(id),deploymentSha256:hash(deploymentId)})),providerOperations:[],restartAttribution:{measurement:null,limitation:'restart_origin_unattributable'},platformRestart:null,observedAt:stamp(now())};
  journal.append({evidence});return evidence;
 }catch{
  if(journal&&machine){try{machine.advance('failed',stamp(now()));journal.append({phase:'failed',failure:'supervisor_evidence_unavailable'});}catch{}}
  fail();
 }finally{if(journal)journal.close();}
}
module.exports={VERSION,PHASES,phaseMachine,controlledWorker,supervise,readQuery};
