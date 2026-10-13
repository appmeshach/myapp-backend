'use strict';
// Synthetic metadata and child transport only; never invoke installed Railway CLI.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const railway=require('../../scripts/assessment-worker/qualification-railway-evidence.cjs'),operator=require('../../scripts/assessment-worker/qualification-operator-evidence.cjs'),boundary=require('../../scripts/assessment-worker/qualification-remote.cjs'),admin=require('../../scripts/assessment-worker/qualify-remote-schema.cjs'),reports=require('../../scripts/assessment-worker/qualification-report.cjs');
const ref='abcdefghijklmnopqrst',now=Date.now(),iso=delta=>new Date(now+delta).toISOString();
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'movement-railway-test-')),cli=path.join(dir,'railway.exe');fs.writeFileSync(cli,'synthetic non-executable transport fixture');
test.after(()=>{assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert(path.basename(dir).startsWith('movement-railway-test-'));fs.rmSync(dir,{recursive:true,force:true});});
test.beforeEach(t=>{t.mock.method(require('node:child_process'),'spawnSync',()=>{throw Error('Tests must inject synthetic provider transport');});t.mock.method(global,'fetch',async()=>{throw Error('Tests must not contact any provider');});});
const env=()=>({MOVEMENT_QUALIFICATION_ENVIRONMENT_KIND:'disposable',MOVEMENT_QUALIFICATION_PROJECT_REF:ref,MOVEMENT_QUALIFICATION_SUPABASE_URL:'https://'+ref+'.supabase.co',MOVEMENT_QUALIFICATION_SERVICE_ROLE_KEY:'sb_secret_synthetic',MOVEMENT_QUALIFICATION_RAILWAY_CLI_FILE:cli,MOVEMENT_QUALIFICATION_RAILWAY_PROJECT_ID:'synthetic-project',MOVEMENT_QUALIFICATION_RAILWAY_ENVIRONMENT_ID:'synthetic-environment',MOVEMENT_QUALIFICATION_RAILWAY_SERVICE_ID:'synthetic-service',MOVEMENT_QUALIFICATION_RAILWAY_SERVICE_INSTANCE_ID:'synthetic-instance',PATH:process.env.PATH,USERPROFILE:process.env.USERPROFILE,SystemRoot:process.env.SystemRoot});
const ids={project:'synthetic-project',environment:'synthetic-environment',service:'synthetic-service',serviceInstance:'synthetic-instance'};
const bound=()=>({provider:'Railway',machine:'Hobby',region:'europe-west4-drams3a',projectRefHash:boundary.hash(ref),workerSourceSha256:'ab'.repeat(32),migrationDigest:admin.migrationDigest(),qualificationRunSha256:'cd'.repeat(32)});
const connection=items=>({edges:items.map(node=>({node})),pageInfo:{hasNextPage:false,hasPreviousPage:false}});
function data(){return {project:{id:ids.project,environments:connection([{id:ids.environment}]),services:connection([{id:ids.service}])},environment:{id:ids.environment,variables:{...connection(railway.NAMES.map((name,i)=>({id:'synthetic-variable-'+i,name,isSealed:true,serviceId:ids.service,environmentId:ids.environment}))),pageInfo:{hasNextPage:false,hasPreviousPage:false}}},serviceInstance:{id:ids.serviceInstance,serviceId:ids.service,environmentId:ids.environment,region:bound().region,restartPolicyType:'ON_FAILURE',restartPolicyMaxRetries:10,latestDeployment:{id:'synthetic-deployment'}}};}
const capability=()=>({connection:{fields:[{name:'edges'},{name:'pageInfo'}]},page:{fields:[{name:'hasNextPage'},{name:'hasPreviousPage'}]}});
const result=data=>({status:0,stdout:JSON.stringify({data}),stderr:''});
function spawnFor(value=data()){return (_file,args)=>result(args[1]===railway.CAPABILITY_QUERY?capability():value);}
test('sealed collection uses metadata-only query, arrays and credential-free child env',()=>{
 let calls=0;const e={...env(),MOVEMENT_QUALIFICATION_DB_PASSWORD:'synthetic-secret'};
 const proof=railway.collectSealed(bound(),e,true,{now,spawn:(file,args,options)=>{
  calls++;assert.equal(file,cli);assert.equal(args[0],'api');assert(!/\b(?:mutation|subscription|value|values)\b/i.test(args[1]));
  assert.equal(options.shell,false);assert.equal(options.windowsHide,true);assert.equal(options.timeout,10000);assert.equal(options.maxBuffer,256*1024);
  assert.equal(options.env.MOVEMENT_QUALIFICATION_DB_PASSWORD,undefined);assert.equal(options.env.MOVEMENT_QUALIFICATION_SERVICE_ROLE_KEY,undefined);
  return spawnFor()(file,args);
 }});
 assert.equal(calls,2);assert(railway.verifySealed(proof,bound(),env(),true,now));
 const serialized=JSON.stringify(proof);for(const v of [...Object.values(ids),'synthetic-variable-0',ref,'sb_secret_','value','https://'])assert(!serialized.includes(v));
});
for(const [name,change] of [
 ['missing variable',v=>v.environment.variables.edges.pop()],['false seal',v=>v.environment.variables.edges[0].node.isSealed=false],['duplicate required name',v=>{const node={...v.environment.variables.edges[0].node,id:'synthetic-other'};v.environment.variables.edges.push({node});}],['wrong variable service',v=>v.environment.variables.edges[0].node.serviceId='other'],['wrong variable environment',v=>v.environment.variables.edges[0].node.environmentId='other'],['value field',v=>v.environment.variables.edges[0].node.value='synthetic-secret'],['rendered scalar',v=>v.environment.variables='masked'],['extra scalar field',v=>v.variables={name:'masked'}],['wrong project',v=>v.project.id='other'],['unrelated project environment',v=>v.project.environments.edges=[]],['unrelated project service',v=>v.project.services.edges=[]],['wrong instance',v=>v.serviceInstance.id='other'],['wrong instance service',v=>v.serviceInstance.serviceId='other'],['wrong instance environment',v=>v.serviceInstance.environmentId='other'],['wrong region',v=>v.serviceInstance.region='other'],['next page',v=>v.environment.variables.pageInfo.hasNextPage=true],['previous page',v=>v.environment.variables.pageInfo.hasPreviousPage=true],['missing completeness',v=>delete v.environment.variables.pageInfo],['duplicate variable ID',v=>v.environment.variables.edges[1].node.id=v.environment.variables.edges[0].node.id],['null data',v=>v.environment=null],
])test('sealed provider metadata rejects '+name,()=>{const v=data();change(v);assert.throws(()=>railway.collectSealed(bound(),env(),true,{now,spawn:spawnFor(v)}));});
for(const [name,value] of [['malformed JSON',{status:0,stdout:'{',stderr:''}],['GraphQL errors',{status:0,stdout:JSON.stringify({data:data(),errors:[{message:'synthetic error'}]}),stderr:''}],['timeout',{status:null,error:{code:'ETIMEDOUT'},stdout:'',stderr:''}],['stdout overflow',{status:0,stdout:'a'.repeat(256*1024+1),stderr:''}],['stderr warning',{status:0,stdout:JSON.stringify({data:data()}),stderr:'synthetic warning'}],['credential output',{status:0,stdout:'sb_secret_synthetic',stderr:''}],['credential stderr',{status:1,stdout:'',stderr:'Bearer synthetic-token'}],['provider failure',{status:1,stdout:'',stderr:''}]])test('transport rejects '+name+' with sanitized error',()=>{
 assert.throws(()=>railway.collectSealed(bound(),env(),true,{now,spawn:()=>value}),e=>e.message==='Railway qualification evidence unavailable');
});
test('schema capability is checked, not assumed; absent PageInfo rejects',()=>{
 assert.throws(()=>railway.collectSealed(bound(),env(),true,{now,spawn:()=>result({connection:{fields:[{name:'edges'}]},page:null})}));
});
test('sealed proof with NEVER policy cannot imply restart proof',()=>{
 const v=data();v.serviceInstance.restartPolicyType='NEVER';v.serviceInstance.restartPolicyMaxRetries=0;
 const p=railway.collectSealed(bound(),env(),true,{now,spawn:spawnFor(v)});assert(railway.verifySealed(p,bound(),env(),true,now));assert.equal(p.platformRestart,undefined);
});
for(const document of ['mutation { deploymentRestart }','subscription { executions }','query { variables }','query { deploymentRestart }'])test('non-reviewed document rejected '+document,()=>{
 let calls=0;assert.throws(()=>railway.cliQuery(document,{},env(),{spawn:()=>{calls++;}}));assert.equal(calls,0);
});
for(const name of ['RAILWAY_TOKEN','RAILWAY_API_TOKEN','MOVEMENT_QUALIFICATION_RAILWAY_TOKEN'])test('token env shortcut rejects '+name,()=>assert.throws(()=>railway.collectSealed(bound(),{...env(),[name]:'synthetic-token'},true,{now,spawn:spawnFor()})));
test('CLI must be an explicit absolute regular Railway file',()=>{
 for(const file of [undefined,'railway.exe',dir,path.join(dir,'missing.exe')])assert.throws(()=>railway.collectSealed(bound(),{...env(),MOVEMENT_QUALIFICATION_RAILWAY_CLI_FILE:file},true,{now,spawn:spawnFor()}));
});
for(const denied of boundary.DENIED)test('denylist precedes provider call '+denied,()=>{
 let calls=0;const e={...env(),MOVEMENT_QUALIFICATION_PROJECT_REF:denied,MOVEMENT_QUALIFICATION_SUPABASE_URL:'https://'+denied+'.supabase.co'};assert.throws(()=>railway.collectSealed(bound(),e,true,{now,spawn:()=>{calls++;}}));assert.equal(calls,0);
});
for(const field of ['provider','machine','region','projectRefHash','workerSourceSha256','migrationDigest','qualificationRunSha256'])test('persisted proof replay rejects '+field,()=>{
 const b=bound(),proof=railway.collectSealed(b,env(),true,{now,spawn:spawnFor()});proof[field]='other';assert.throws(()=>railway.verifySealed(proof,b,env(),true,now));
});
for(const change of [p=>p.value='synthetic-secret',p=>p.variables[0].value='masked',p=>p.variables[0].isSealed=false,p=>p.identities.serviceSha256='00'.repeat(32),p=>p.variables[1].name=p.variables[0].name,p=>p.observedAt=iso(1),p=>p.observedAt=iso(-3600001)])test('persisted sealed proof rejects alteration '+change.toString(),()=>{
 const b=bound(),p=railway.collectSealed(b,env(),true,{now,spawn:spawnFor()});change(p);assert.throws(()=>railway.verifySealed(p,b,env(),true,now));
});
for(const collection of ['environments','services'])for(const [name,change] of [
 ['next page',c=>c.pageInfo.hasNextPage=true],['previous page',c=>c.pageInfo.hasPreviousPage=true],
 ['missing pageInfo',c=>delete c.pageInfo],['null pageInfo',c=>c.pageInfo=null],['array pageInfo',c=>c.pageInfo=[]],
 ['missing boolean',c=>delete c.pageInfo.hasNextPage],['string boolean',c=>c.pageInfo.hasNextPage='false'],
 ['numeric boolean',c=>c.pageInfo.hasPreviousPage=0],['extra field',c=>c.pageInfo.cursor='synthetic'],
])test('project completeness rejects '+collection+' '+name,()=>{
 const v=data();change(v.project[collection]);assert.throws(()=>railway.collectSealed(bound(),env(),true,{now,spawn:spawnFor(v)}));
});
test('fixed query requests all three completeness objects',()=>{
 assert.equal((railway.SEALED_QUERY.match(/pageInfo \{ hasNextPage hasPreviousPage \}/g)||[]).length,3);
});
function restart(){
 const b=bound(),h=boundary.hash;
 return {instance:{id:ids.serviceInstance,serviceId:ids.service,environmentId:ids.environment,deploymentId:'synthetic-deployment',region:b.region,restartPolicyType:'ON_FAILURE',restartPolicyMaxRetries:10},executions:[{id:'synthetic-old',deploymentId:'synthetic-deployment',createdAt:iso(-100000),updatedAt:iso(-95000),completedAt:null,status:'RUNNING',observedAt:iso(-94000)},{id:'synthetic-old',deploymentId:'synthetic-deployment',createdAt:iso(-100000),updatedAt:iso(-80000),completedAt:iso(-80000),status:'CRASHED',observedAt:iso(-79000)},{id:'synthetic-new',deploymentId:'synthetic-deployment',createdAt:iso(-75000),updatedAt:iso(-70000),completedAt:null,status:'RUNNING',observedAt:iso(-69000)}],controlled:{method:'qualification_worker_self_termination_v1',...b,identities:Object.fromEntries(Object.entries(ids).map(([k,v])=>[k+'Sha256',h(v)])),jobSha256:h('synthetic-job'),leaseTokenSha256:h('synthetic-old-lease'),executionSha256:h('synthetic-old'),derivedLeaseStartAt:iso(-93000),leaseDurationMs:60000,leaseStartDerivation:'leaseExpiresAt - leaseDurationMs',terminatedAt:iso(-81000),leaseExpiresAt:iso(-33000),providerOperations:[]},db:{jobSha256:h('synthetic-job'),originalLeaseTokenSha256:h('synthetic-old-lease'),replacementLeaseTokenSha256:h('synthetic-new-lease'),originalAttempt:1,replacementAttempt:2,reclaimedAt:iso(-32000),completedAt:iso(-31000),staleTokenState:'lease_invalid',publicationCount:1}};
}
for(const policy of ['ON_FAILURE','ALWAYS'])test('complete lifecycle plus DB validates correlation but cannot attribute restart '+policy,()=>{
 const r=restart();r.instance.restartPolicyType=policy;const out=railway.correlateRestart(r,ids,bound(),now);assert.equal(out.measurement,null);assert.equal(out.limitation,'restart_origin_unattributable');
});
for(const [name,change] of [
 ['NEVER',r=>r.instance.restartPolicyType='NEVER'],['zero retries',r=>r.instance.restartPolicyMaxRetries=0],['policy only',r=>r.executions=[]],['RUNNING only',r=>r.executions=r.executions.slice(0,1)],['wrong old execution',r=>r.executions[1].id='unrelated'],['wrong deployment',r=>r.executions[2].deploymentId='unrelated'],['wrong instance',r=>r.instance.id='unrelated'],['wrong service',r=>r.instance.serviceId='unrelated'],['wrong environment',r=>r.instance.environmentId='unrelated'],['operator mutation',r=>r.controlled.providerOperations=['deploymentRestart']],['redeploy',r=>r.controlled.providerOperations=['redeploy']],['no DB recovery',r=>r.db=null],['no controlled death',r=>r.controlled=null],['no stale fence',r=>r.db.staleTokenState='ready'],['two publications',r=>r.db.publicationCount=2],['no publication',r=>r.db.publicationCount=0],['wrong job',r=>r.db.jobSha256='00'.repeat(32)],['same token',r=>r.db.replacementLeaseTokenSha256=r.db.originalLeaseTokenSha256],['lease shortened',r=>r.controlled.leaseExpiresAt=iso(-40000)],['early reclaim',r=>r.db.reclaimedAt=iso(-34000)],['wrong run',r=>r.controlled.qualificationRunSha256='00'.repeat(32)],['old source',r=>r.controlled.workerSourceSha256='00'.repeat(32)],['future timestamp',r=>r.executions[2].observedAt=iso(1)],['expired lifecycle',r=>r.executions[0].createdAt=iso(-3600001)],['reordered lifecycle',r=>r.executions[1].observedAt=iso(-95000)],['invented exitCode',r=>r.executions[1].exitCode=1],
])test('restart correlator rejects '+name,()=>{const r=restart();change(r);assert.throws(()=>railway.correlateRestart(r,ids,bound(),now));});
function runtimeReport(){
 const r=JSON.parse(fs.readFileSync('docs/0101-offline-qualification/qualification.json','utf8'));
 Object.assign(r,{timestamp:iso(-1000),workerSourceSha256:operator.workerSourceHash(),schemaVersion:'movement_worker_remote_qualification_v2',mode:'remote-staging',host:{...r.host,provider:'Railway',machine:'Hobby',region:bound().region},gates:{correctness:true,reliability:true,lease:true,memory:true,process:null,integration:true,security:null},result:'incomplete',classification:'QUALIFICATION_INCOMPLETE',reasons:['process_not_measured','security_not_measured']});
 r.remote={projectRefHash:boundary.hash(ref),environmentKind:'disposable',fixtureCleanup:boundary.cleanup(),schema:{operatorCatalogVerified:true,runtimeCompatible:true,fullCatalogVerifiedOnHost:false},measurements:Object.fromEntries(Object.keys(reports.remoteSchema.properties.remote.properties.measurements.properties).map(k=>[k,['platformRestart','hostSecretStorage','participantAcl'].includes(k)?null:true])),safeLogs:true,dbCalls:1,jobsCompleted:3,childCpuMs:1,peakChildRssBytes:1,newComputes:3,publications:3,failure:null};return r;
}
function controlled(){
 const e=env(),pairs=Array.from({length:4},()=>({requester:crypto.randomUUID(),need:crypto.randomUUID(),availability:crypto.randomUUID()}));e.MOVEMENT_QUALIFICATION_FIXTURE_KEY='ab'.repeat(32);
 e.MOVEMENT_QUALIFICATION_FIXTURE_CAPSULE=boundary.seal({version:'0102',projectRefHash:boundary.hash(ref),migrationDigest:admin.migrationDigest(),createdAt:iso(-1000),pairs},e.MOVEMENT_QUALIFICATION_FIXTURE_KEY);
 const jobId=crypto.randomUUID(),token=crypto.randomUUID(),plan={report:runtimeReport(),env:e,ack:true,mode:'remote-staging',jobId,executionId:'synthetic-old'};
 const backend={register:async()=>({state:'job_registered',job_id:jobId,attempt_count:0}),claim:async()=>({state:'claimed',job_id:jobId,lease_token:token,attempt_count:1,lease_expires_at:iso(59000)}),load:async()=>({state:'ready',snapshot:{context:{need_id:pairs[2].need,requester_id:pairs[2].requester}}})};return {plan,backend,token};
}
test('controlled primitive captures designated private claim and terminates only itself',async()=>{
 const {plan,backend,token}=controlled();let deaths=0,receipt;
 await assert.rejects(railway.controlledFailure(plan,{backend,observe:async r=>{receipt=r;},terminate:()=>{deaths++;},now:()=>now}),/termination returned/);
 assert.equal(deaths,1);assert.equal(receipt.claim.lease_token,token);assert(!JSON.stringify(receipt.controlled).includes(token));assert.deepEqual(receipt.controlled.providerOperations,[]);
 assert.equal(receipt.controlled.derivedLeaseStartAt,iso(-1000));assert.equal(receipt.controlled.leaseDurationMs,60000);
 assert.equal(receipt.controlled.leaseStartDerivation,'leaseExpiresAt - leaseDurationMs');assert(!Object.hasOwn(receipt.controlled,'claimedAt'));
});
for(const delta of [30000,59000,60000])test('lease expiry changes explicit derived boundary '+delta,async()=>{
 const {plan,backend}=controlled(),original=backend.claim;backend.claim=async()=>({...await original(),lease_expires_at:iso(delta)});let receipt;
 await assert.rejects(railway.controlledFailure(plan,{backend,observe:async r=>{receipt=r;},terminate:()=>{},now:()=>now}),/termination returned/);
 assert.equal(receipt.controlled.leaseExpiresAt,iso(delta));assert.equal(receipt.controlled.derivedLeaseStartAt,iso(delta-60000));
 assert(!Object.hasOwn(receipt.controlled,'claimedAt'));
});
for(const stamp of [undefined,null,123,'invalid','2026-02-30T00:00:00.000Z',iso(60001),iso(0),iso(-1),iso(59000).replace('T',' '),iso(59000)+'garbage'])test('controlled expiry fails closed '+String(stamp),async()=>{
 const {plan,backend}=controlled(),original=backend.claim;backend.claim=async()=>({...await original(),lease_expires_at:stamp});let deaths=0,observations=0;
 await assert.rejects(railway.controlledFailure(plan,{backend,observe:async()=>{observations++;},terminate:()=>{deaths++;},now:()=>now}));assert.equal(deaths,0);assert.equal(observations,0);
});
test('PostgreSQL UTC microseconds normalize with explicit millisecond derivation',async()=>{
 const {plan,backend}=controlled(),original=backend.claim;backend.claim=async()=>({...await original(),lease_expires_at:iso(59000).replace('.000Z','.000123+00:00')});let receipt;
 await assert.rejects(railway.controlledFailure(plan,{backend,observe:async r=>{receipt=r;},terminate:()=>{},now:()=>now}),/termination returned/);
 assert.equal(receipt.controlled.derivedLeaseStartAt,iso(-1000));assert.equal(receipt.controlled.leaseExpiresAt,iso(59000));
});
for(const [name,change] of [
 ['claimedAt added',c=>c.claimedAt=c.derivedLeaseStartAt],['claimedAt replaces derived',c=>{c.claimedAt=c.derivedLeaseStartAt;delete c.derivedLeaseStartAt;}],
 ['wrong derivation',c=>c.leaseStartDerivation='observed'],['wrong duration',c=>c.leaseDurationMs=59000],
 ['future derived',c=>c.derivedLeaseStartAt=iso(1)],['invalid derived',c=>c.derivedLeaseStartAt='invalid'],
 ['invalid calendar',c=>c.derivedLeaseStartAt='2026-02-30T00:00:00.000Z'],['future expiry',c=>c.leaseExpiresAt=iso(1)],
 ['wrong derived boundary',c=>c.derivedLeaseStartAt=iso(-92000)],
])test('derived chronology rejects '+name,()=>{const r=restart();change(r.controlled);assert.throws(()=>railway.correlateRestart(r,ids,bound(),now));});
for(const [name,change] of [['normal worker',p=>p.mode='integration'],['missing ack',p=>p.ack=false],['old report',p=>p.report.workerSourceSha256='00'.repeat(32)],['wrong expected job',p=>p.jobId=crypto.randomUUID()],['missing capsule',p=>delete p.env.MOVEMENT_QUALIFICATION_FIXTURE_CAPSULE]])test('controlled failure rejects '+name,async()=>{
 const {plan,backend}=controlled();change(plan);let deaths=0;await assert.rejects(railway.controlledFailure(plan,{backend,observe:async()=>{},terminate:()=>{deaths++;},now:()=>now}));assert.equal(deaths,0);
});
test('one-shot fault rejects an already attempted/reused job',async()=>{
 const {plan,backend}=controlled();backend.register=async()=>({state:'job_registered',job_id:plan.jobId,attempt_count:1});let deaths=0;
 await assert.rejects(railway.controlledFailure(plan,{backend,observe:async()=>{},terminate:()=>{deaths++;},now:()=>now}));assert.equal(deaths,0);
});
test('normal worker entry has no crash switch or provider module import',()=>{
 const source=fs.readFileSync('scripts/assessment-worker/run.cjs','utf8');assert(!source.includes('controlledFailure'));assert(!source.includes('qualification-railway-evidence'));assert(!source.includes('deploymentRestart'));
});
test('job snapshot SQL is read-only and rejects injected/non-UUID identifiers',()=>{
 const sql=railway.jobSql(crypto.randomUUID());assert(sql.startsWith('BEGIN READ ONLY;'));assert(!/\b(?:INSERT|UPDATE|DELETE|ALTER|TRUNCATE)\s/i.test(sql));
 for(const id of ['x','0;DELETE FROM private.shared_segment_assessment_jobs',undefined])assert.throws(()=>railway.jobSql(id));
});
test('actual snapshot projection requires advancing lease, fencing and one publication',()=>{
 const jobId=crypto.randomUUID(),old=crypto.randomUUID(),replacement=crypto.randomUUID(),assessment=crypto.randomUUID();
 const original={jobId,needId:crypto.randomUUID(),requesterId:crypto.randomUUID(),availabilityId:crypto.randomUUID(),status:'running',attempt:1,leaseToken:old,leaseExpiresAt:iso(-33000),updatedAt:iso(-93000),assessmentId:null,publicationCount:0};
 const reclaimed={...original,attempt:2,leaseToken:replacement,leaseExpiresAt:iso(28000),updatedAt:iso(-32000)};
 const completed={...reclaimed,status:'completed',assessmentId:assessment,updatedAt:iso(-31000),publicationCount:1};
 const controlled={jobSha256:boundary.hash(jobId),leaseTokenSha256:boundary.hash(old),leaseExpiresAt:original.leaseExpiresAt};
 const proof=railway.recoveryFromSnapshots(original,reclaimed,completed,{state:'lease_invalid'},controlled);assert.equal(proof.publicationCount,1);assert(!JSON.stringify(proof).includes(jobId));assert(!JSON.stringify(proof).includes(old));
 assert.throws(()=>railway.recoveryFromSnapshots(original,reclaimed,{...completed,publicationCount:2},{state:'lease_invalid'},controlled));
 assert.throws(()=>railway.recoveryFromSnapshots(original,reclaimed,completed,{state:'ready'},controlled));
});
test('restart correlation rejects migration and provider-identity replay',()=>{
 const r=restart();r.controlled.migrationDigest='00'.repeat(32);assert.throws(()=>railway.correlateRestart(r,ids,bound(),now));
 const other=restart();other.controlled.identities.serviceSha256='00'.repeat(32);assert.throws(()=>railway.correlateRestart(other,ids,bound(),now));
});
