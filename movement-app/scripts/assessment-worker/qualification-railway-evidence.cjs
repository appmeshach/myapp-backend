'use strict';
// Operator-only read queries. There is no provider mutation, token input or file-proof intake.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const boundary=require('./qualification-remote.cjs');
const LIMIT=256*1024,TIMEOUT=10000,WINDOW=3600000;
const NAMES=Object.freeze(['MOVEMENT_QUALIFICATION_SERVICE_ROLE_KEY','MOVEMENT_QUALIFICATION_FIXTURE_CAPSULE','MOVEMENT_QUALIFICATION_FIXTURE_KEY']);
const SCOPE=['project','environment','service','serviceInstance'];
const fail=()=>{throw Error('Railway qualification evidence unavailable');};
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const SECRET=/sb_secret_|eyJ|Bearer\s|https?:\/\/|PRIVATE KEY|railway[_-]?(?:api[_-]?)?token/i;
const SEALED_QUERY=`query MovementQualificationSealed($projectId: String!, $environmentId: String!, $serviceId: String!) {
 project(id: $projectId) { id environments { edges { node { id } } pageInfo { hasNextPage hasPreviousPage } } services { edges { node { id } } pageInfo { hasNextPage hasPreviousPage } } }
 environment(id: $environmentId) { id variables { edges { node { id name isSealed serviceId environmentId } } pageInfo { hasNextPage hasPreviousPage } } }
 serviceInstance(serviceId: $serviceId, environmentId: $environmentId) {
  id serviceId environmentId region restartPolicyType restartPolicyMaxRetries latestDeployment { id }
 }
}`;
const CAPABILITY_QUERY=`query MovementQualificationVariableConnection {
 connection: __type(name: "EnvironmentVariablesConnection") { fields { name } }
 page: __type(name: "PageInfo") { fields { name } }
}`;
function exact(v,keys){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join('|')!==keys.slice().sort().join('|'))fail();}
function identifier(v){if(typeof v!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v)||SECRET.test(v))fail();return v;}
function digest(v){if(typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v))fail();}
function time(v,now){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString()!==v||Date.parse(v)>now||now-Date.parse(v)>WINDOW)fail();return Date.parse(v);}
function identity(env,bound,ack){
 const config=boundary.configuration(env,ack);
 if(bound.provider!=='Railway'||bound.projectRefHash!==config.projectRefHash)fail();
 const result={};for(const name of SCOPE)result[name]=identifier(env['MOVEMENT_QUALIFICATION_RAILWAY_'+name.replace(/([a-z])([A-Z])/g,'$1_$2').toUpperCase()+'_ID']);
 return result;
}
function hashes(ids){return Object.fromEntries(SCOPE.map(k=>[k+'Sha256',hash(ids[k])]));}
function cliQuery(document,variables,env,{spawn=cp.spawnSync}={}){
 // Fixed reviewed document only, including conservative rejection of other operation kinds.
 if(typeof document!=='string'||/\b(?:mutation|subscription)\b/i.test(document)||![SEALED_QUERY,CAPABILITY_QUERY].includes(document))fail();
 exact(variables,document===CAPABILITY_QUERY?[]:['projectId','environmentId','serviceId']);Object.values(variables).forEach(identifier);
 // Reject token shortcuts without reading their values. CLI reads its own login session.
 if(Object.keys(env).some(k=>/RAILWAY.*(?:TOKEN|PASSWORD|SECRET)/i.test(k)))fail();
 let file;
 try{file=env.MOVEMENT_QUALIFICATION_RAILWAY_CLI_FILE;if(typeof file!=='string'||!path.isAbsolute(file)||!fs.statSync(file).isFile()||!/railway(?:\.exe)?$/i.test(path.basename(file)))fail();file=fs.realpathSync(file);}catch{fail();}
 const childEnv=Object.fromEntries(['PATH','SystemRoot','USERPROFILE','HOME','APPDATA','LOCALAPPDATA','TEMP','TMP'].filter(k=>typeof env[k]==='string').map(k=>[k,env[k]]));
 let result;try{result=spawn(file,['api',document,'--variables',JSON.stringify(variables)],{env:childEnv,shell:false,windowsHide:true,encoding:'utf8',timeout:TIMEOUT,maxBuffer:LIMIT,stdio:['ignore','pipe','pipe']});}catch{fail();}
 if(!result||result.error||result.status!==0||typeof result.stdout!=='string'||typeof result.stderr!=='string'||result.stderr.length||Buffer.byteLength(result.stdout)>LIMIT||SECRET.test(result.stdout))fail();
 let parsed;try{parsed=JSON.parse(result.stdout);}catch{fail();}
 exact(parsed,['data']);
 const inspect=value=>{if(value&&typeof value==='object'){for(const [key,child] of Object.entries(value)){if(/value|password|token|credential|authorization|privatekey/i.test(key))fail();inspect(child);}}};
 inspect(parsed.data);return parsed.data;
}
function nodes(connection,check){
 exact(connection,['edges','pageInfo']);exact(connection.pageInfo,['hasNextPage','hasPreviousPage']);
 if(connection.pageInfo.hasNextPage!==false||connection.pageInfo.hasPreviousPage!==false)fail();
 if(!Array.isArray(connection.edges)||connection.edges.length>2000)fail();
 const seen=new Set();return connection.edges.map(edge=>{exact(edge,['node']);check(edge.node);if(seen.has(edge.node.id))fail();seen.add(edge.node.id);return edge.node;});
}
function validateMetadata(data,ids,bound){
 exact(data,['project','environment','serviceInstance']);
 exact(data.project,['id','environments','services']);if(data.project.id!==ids.project)fail();
 const idsOnly=node=>{exact(node,['id']);identifier(node.id);};
 if(!nodes(data.project.environments,idsOnly).some(n=>n.id===ids.environment)||!nodes(data.project.services,idsOnly).some(n=>n.id===ids.service))fail();
 exact(data.environment,['id','variables']);if(data.environment.id!==ids.environment)fail();
 const variables=nodes(data.environment.variables,n=>{
  exact(n,['id','name','isSealed','serviceId','environmentId']);identifier(n.id);
  if(typeof n.name!=='string'||!/^[A-Z_][A-Z0-9_]{0,127}$/.test(n.name)||typeof n.isSealed!=='boolean'||n.environmentId!==ids.environment)fail();
  if(n.serviceId!==null)identifier(n.serviceId);
 });
 const instance=data.serviceInstance;
 exact(instance,['id','serviceId','environmentId','region','restartPolicyType','restartPolicyMaxRetries','latestDeployment']);
 if(instance.id!==ids.serviceInstance||instance.serviceId!==ids.service||instance.environmentId!==ids.environment||instance.region!==bound.region||!['ALWAYS','ON_FAILURE','NEVER'].includes(instance.restartPolicyType)||!Number.isInteger(instance.restartPolicyMaxRetries)||instance.restartPolicyMaxRetries<0)fail();
 if(instance.latestDeployment!==null){exact(instance.latestDeployment,['id']);identifier(instance.latestDeployment.id);}
 const selected=NAMES.map(name=>{
  const matches=variables.filter(n=>n.name===name);if(matches.length!==1||matches[0].serviceId!==ids.service||matches[0].isSealed!==true)fail();return matches[0];
 });
 return {instance,selected};
}
function collectSealed(bound,env,ack,{spawn=cp.spawnSync,now=Date.now()}={}){
 const ids=identity(env,bound,ack);
 // Do not assume Relay pagination fields exist in the supplied partial schema.
 const capability=cliQuery(CAPABILITY_QUERY,{},env,{spawn});exact(capability,['connection','page']);
 for(const [name,required] of Object.entries({connection:['edges','pageInfo'],page:['hasNextPage','hasPreviousPage']})){
  exact(capability[name],['fields']);if(!Array.isArray(capability[name].fields))fail();
  const names=capability[name].fields.map(field=>{exact(field,['name']);if(typeof field.name!=='string'||!/^[_A-Za-z][_0-9A-Za-z]*$/.test(field.name))fail();return field.name;});
  if(new Set(names).size!==names.length||required.some(field=>!names.includes(field)))fail();
 }
 const data=cliQuery(SEALED_QUERY,{projectId:ids.project,environmentId:ids.environment,serviceId:ids.service},env,{spawn});
 const {selected}=validateMetadata(data,ids,bound);
 return {method:'railway_variable_metadata_v1',...bound,identities:hashes(ids),observedAt:new Date(now).toISOString(),variables:selected.map(v=>({name:v.name,variableSha256:hash(v.id),isSealed:true,serviceSha256:hash(v.serviceId),environmentSha256:hash(v.environmentId)}))};
}
function verifySealed(proof,bound,env,ack,now=Date.now()){
 const expected=hashes(identity(env,bound,ack));
 exact(proof,['method',...Object.keys(bound),'identities','observedAt','variables']);if(proof.method!=='railway_variable_metadata_v1')fail();
 for(const k of Object.keys(bound))if(proof[k]!==bound[k])fail();
 exact(proof.identities,Object.keys(expected));for(const k of Object.keys(expected))if(proof.identities[k]!==expected[k])fail();
 time(proof.observedAt,now);if(!Array.isArray(proof.variables)||proof.variables.length!==3)fail();
 const names=new Set(),ids=new Set();for(const v of proof.variables){
  exact(v,['name','variableSha256','isSealed','serviceSha256','environmentSha256']);digest(v.variableSha256);
  if(!NAMES.includes(v.name)||names.has(v.name)||ids.has(v.variableSha256)||v.isSealed!==true||v.serviceSha256!==expected.serviceSha256||v.environmentSha256!==expected.environmentSha256)fail();names.add(v.name);ids.add(v.variableSha256);
 }return true;
}
// Strict projection of provider executions and private harness DB snapshots.
// No exitCode/actor/cause field is invented. These checks establish correlation,
// not automatic origin; manual provider actions remain indistinguishable.
function correlateRestart({instance,executions,controlled,db},ids,bound,now=Date.now()){
 exact(instance,['id','serviceId','environmentId','deploymentId','region','restartPolicyType','restartPolicyMaxRetries']);
 if(instance.id!==ids.serviceInstance||instance.serviceId!==ids.service||instance.environmentId!==ids.environment||instance.region!==bound.region||!['ON_FAILURE','ALWAYS'].includes(instance.restartPolicyType)||!Number.isInteger(instance.restartPolicyMaxRetries)||instance.restartPolicyMaxRetries<1)fail();identifier(instance.deploymentId);
 if(!Array.isArray(executions)||executions.length!==3)fail();
 const states=['RUNNING',null,'RUNNING'];let previous=-Infinity;
 for(let i=0;i<executions.length;i++){
  const e=executions[i];exact(e,['id','deploymentId','createdAt','updatedAt','completedAt','status','observedAt']);identifier(e.id);
  const created=time(e.createdAt,now),updated=time(e.updatedAt,now),observed=time(e.observedAt,now);
  if(e.completedAt!==null&&(time(e.completedAt,now)<created||Date.parse(e.completedAt)>updated))fail();
  if(e.deploymentId!==instance.deploymentId||created>updated||updated>observed||observed<=previous||(i===1?!['CRASHED','RESTARTING'].includes(e.status):e.status!==states[i]))fail();previous=observed;
 }
 if(executions[0].id!==executions[1].id||executions[2].id===executions[0].id||Date.parse(executions[2].createdAt)<Date.parse(executions[1].updatedAt))fail();
 exact(controlled,['method',...Object.keys(bound),'identities','jobSha256','leaseTokenSha256','executionSha256','derivedLeaseStartAt','leaseDurationMs','leaseStartDerivation','terminatedAt','leaseExpiresAt','providerOperations']);
 for(const k of Object.keys(bound))if(controlled[k]!==bound[k])fail();
 const expectedIdentities=hashes(ids);exact(controlled.identities,Object.keys(expectedIdentities));for(const k of Object.keys(expectedIdentities))if(controlled.identities[k]!==expectedIdentities[k])fail();
 if(controlled.method!=='qualification_worker_self_termination_v1'||controlled.executionSha256!==hash(executions[0].id)||!Array.isArray(controlled.providerOperations)||controlled.providerOperations.length)fail();
 for(const k of ['jobSha256','leaseTokenSha256','executionSha256'])digest(controlled[k]);
 const start=time(controlled.derivedLeaseStartAt,now),terminated=time(controlled.terminatedAt,now),expires=time(controlled.leaseExpiresAt,now);
 if(controlled.leaseDurationMs!==60000||controlled.leaseStartDerivation!=='leaseExpiresAt - leaseDurationMs'||start>terminated||terminated>=expires||expires-start!==controlled.leaseDurationMs||start<Date.parse(executions[0].createdAt)||terminated<=Date.parse(executions[0].observedAt)||terminated>Date.parse(executions[1].observedAt))fail();
 exact(db,['jobSha256','originalLeaseTokenSha256','replacementLeaseTokenSha256','originalAttempt','replacementAttempt','reclaimedAt','completedAt','staleTokenState','publicationCount']);
 digest(db.jobSha256);digest(db.originalLeaseTokenSha256);digest(db.replacementLeaseTokenSha256);
 if(db.jobSha256!==controlled.jobSha256||db.originalLeaseTokenSha256!==controlled.leaseTokenSha256||db.originalLeaseTokenSha256===db.replacementLeaseTokenSha256||db.originalAttempt!==1||db.replacementAttempt!==2||db.staleTokenState!=='lease_invalid'||db.publicationCount!==1)fail();
 if(time(db.reclaimedAt,now)<expires||Date.parse(db.reclaimedAt)<Date.parse(executions[2].createdAt)||time(db.completedAt,now)<Date.parse(db.reclaimedAt))fail();
 return {measurement:null,limitation:'restart_origin_unattributable',deploymentSha256:hash(instance.deploymentId),identities:hashes(ids)};
}
// Private observer snapshots use the actual immutable job/assessment identity.
// They are never accepted as an operator-supplied public count/checkbox.
function jobSql(jobId){
 if(typeof jobId!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(jobId))fail();
 return `BEGIN READ ONLY; SET LOCAL statement_timeout='10s';
 SELECT json_build_object('jobId',j.id,'needId',j.movement_need_id,'requesterId',j.requesting_member_id,'availabilityId',j.availability_id,'status',j.status,'attempt',j.attempt_count,'leaseToken',j.lease_token,'leaseExpiresAt',j.lease_expires_at,'updatedAt',j.updated_at,'assessmentId',j.assessment_id,
 'publicationCount',(SELECT count(*) FROM private.shared_segment_geographic_assessments a WHERE a.offerer_route_evidence_id=j.offerer_route_evidence_id AND a.requester_route_evidence_id=j.requester_route_evidence_id AND a.algorithm_version=j.algorithm_version AND a.input_context_fingerprint=j.input_context_fingerprint)) FROM private.shared_segment_assessment_jobs j WHERE j.id='${jobId}'::uuid; COMMIT;`;
}
function captureJob(report,env,ack,jobId){
 const operator=require('./qualification-operator-evidence.cjs'),admin=require('./qualify-remote-schema.cjs');
 operator.context(report,env,ack);const config=boundary.configuration(env,ack),pg=admin.postgresConfiguration(env,config);
 admin.verifyCatalog(admin.psql(admin.catalogSql(),pg));const snapshot=admin.psql(jobSql(jobId),pg);
 exact(snapshot,['jobId','needId','requesterId','availabilityId','status','attempt','leaseToken','leaseExpiresAt','updatedAt','assessmentId','publicationCount']);
 if(snapshot.jobId!==jobId||!Number.isInteger(snapshot.attempt)||!Number.isInteger(snapshot.publicationCount))fail();
 for(const k of ['updatedAt','leaseExpiresAt'])if(snapshot[k]!==null){const stamp=Date.parse(snapshot[k]);if(!Number.isFinite(stamp))fail();snapshot[k]=new Date(stamp).toISOString();}
 return snapshot; // workstation-private memory only; contains IDs/lease token
}
function recoveryFromSnapshots(original,reclaimed,completed,oldLoad,controlled){
 for(const snapshot of [original,reclaimed,completed]){
  exact(snapshot,['jobId','needId','requesterId','availabilityId','status','attempt','leaseToken','leaseExpiresAt','updatedAt','assessmentId','publicationCount']);
  if(snapshot.jobId!==original.jobId||snapshot.needId!==original.needId||snapshot.requesterId!==original.requesterId||snapshot.availabilityId!==original.availabilityId)fail();
 }
 if(original.status!=='running'||original.attempt!==1||original.publicationCount!==0||original.assessmentId!==null||typeof original.leaseToken!=='string'||hash(original.jobId)!==controlled.jobSha256||hash(original.leaseToken)!==controlled.leaseTokenSha256||original.leaseExpiresAt!==controlled.leaseExpiresAt||reclaimed.status!=='running'||reclaimed.attempt!==2||reclaimed.publicationCount!==0||reclaimed.assessmentId!==null||typeof reclaimed.leaseToken!=='string'||reclaimed.leaseToken===original.leaseToken||completed.status!=='completed'||completed.attempt!==2||completed.leaseToken!==reclaimed.leaseToken||typeof completed.assessmentId!=='string'||completed.publicationCount!==1||Date.parse(reclaimed.updatedAt)<Date.parse(original.leaseExpiresAt)||Date.parse(completed.updatedAt)<Date.parse(reclaimed.updatedAt))fail();
 exact(oldLoad,['state']);if(oldLoad.state!=='lease_invalid')fail();
 return {jobSha256:hash(original.jobId),originalLeaseTokenSha256:hash(original.leaseToken),replacementLeaseTokenSha256:hash(reclaimed.leaseToken),originalAttempt:1,replacementAttempt:2,reclaimedAt:reclaimed.updatedAt,completedAt:completed.updatedAt,staleTokenState:oldLoad.state,publicationCount:completed.publicationCount};
}
// Library-only primitive for a future dedicated fresh-fixture supervisor. Normal
// run.cjs has no switch or import enabling this path. The private observer is required
// to retain the original claim before this process terminates itself.
/** @param {any} plan @param {any} [dependencies] */
async function controlledFailure({report,env,ack,mode,jobId,executionId},{backend,observe,terminate=()=>process.kill(process.pid,'SIGKILL'),now=()=>Date.now()}={}){
 const operator=require('./qualification-operator-evidence.cjs'),bound=operator.context(report,env,ack,now());
 if(mode!=='remote-staging'||typeof observe!=='function'||!backend||typeof backend.register!=='function'||typeof backend.claim!=='function'||typeof backend.load!=='function'||typeof jobId!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(jobId))fail();
 const providerIds=identity(env,bound,ack);identifier(executionId);
 const config=boundary.configuration(env,ack),capsule=boundary.open(env.MOVEMENT_QUALIFICATION_FIXTURE_CAPSULE,env.MOVEMENT_QUALIFICATION_FIXTURE_KEY,config.projectRefHash),pair=capsule.pairs[2];
 const signal=()=>AbortSignal.timeout(5000),registered=await backend.register(pair.requester,pair.need,pair.availability,signal());
 if(registered.state!=='job_registered'||registered.job_id!==jobId||registered.attempt_count!==0)fail();
 const claim=await backend.claim(signal());
 if(claim.state!=='claimed'||claim.job_id!==jobId||claim.attempt_count!==1)fail();
 const loaded=await backend.load(claim.job_id,claim.lease_token,signal());
 if(loaded.state!=='ready'||loaded.snapshot.context.need_id!==pair.need||loaded.snapshot.context.requester_id!==pair.requester)fail();
 // RPC returns expiry, not claim time. PostgreSQL UTC timestamps may have microseconds.
 // Validate the calendar before normalizing to millisecond evidence precision.
 const raw=claim.lease_expires_at;
 if(typeof raw!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(raw))fail();
 const canonical=raw.replace(/(?:Z|\+00:00)$/,'').split('.');
 const normalized=canonical[0]+'.'+(canonical[1]||'').padEnd(3,'0').slice(0,3)+'Z';
 const terminatedAt=now(),expires=Date.parse(normalized);
 if(!Number.isFinite(expires)||new Date(expires).toISOString()!==normalized)fail();
 if(!Number.isFinite(expires)||terminatedAt>=expires||expires-terminatedAt>60000)fail();
 const controlled={method:'qualification_worker_self_termination_v1',...bound,identities:hashes(providerIds),jobSha256:hash(jobId),leaseTokenSha256:hash(claim.lease_token),executionSha256:hash(executionId),derivedLeaseStartAt:new Date(expires-60000).toISOString(),leaseDurationMs:60000,leaseStartDerivation:'leaseExpiresAt - leaseDurationMs',terminatedAt:new Date(terminatedAt).toISOString(),leaseExpiresAt:new Date(expires).toISOString(),providerOperations:[]};
 // The supervisor must capture promptly; an unresponsive observer cannot trigger a later fault.
 let timer;
 try{await Promise.race([observe({controlled,claim}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Qualification observer unavailable')),5000);})]);}
 finally{clearTimeout(timer);}
 if(now()>=expires)fail();
 terminate();throw Error('Controlled qualification termination returned');
}
module.exports={SEALED_QUERY,CAPABILITY_QUERY,NAMES,cliQuery,collectSealed,verifySealed,correlateRestart,jobSql,captureJob,recoveryFromSnapshots,controlledFailure};
