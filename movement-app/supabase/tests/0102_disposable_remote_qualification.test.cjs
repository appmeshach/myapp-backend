'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs');
const boundary=require('../../scripts/assessment-worker/qualification-remote.cjs');
const admin=require('../../scripts/assessment-worker/qualify-remote-schema.cjs');
const {parseArgs}=require('../../scripts/assessment-worker/qualify.cjs');
const {validate,verdict,markdown,remoteSchema}=require('../../scripts/assessment-worker/qualification-report.cjs');
const ref='abcdefghijklmnopqrst',key='ab'.repeat(32);
const env=()=>({MOVEMENT_QUALIFICATION_ENVIRONMENT_KIND:'disposable',MOVEMENT_QUALIFICATION_PROJECT_REF:ref,MOVEMENT_QUALIFICATION_SUPABASE_URL:`https://${ref}.supabase.co`,MOVEMENT_QUALIFICATION_SERVICE_ROLE_KEY:'sb_secret_synthetic'});
const config=()=>boundary.configuration(env(),true);
const pairs=()=>Array.from({length:4},()=>({requester:crypto.randomUUID(),need:crypto.randomUUID(),availability:crypto.randomUUID()}));
const capsule=(changes={})=>({version:'0102',projectRefHash:boundary.hash(ref),migrationDigest:admin.migrationDigest(),createdAt:new Date().toISOString(),pairs:pairs(),...changes});
for(const forbidden of boundary.DENIED)test('forbidden ref rejected before network: '+forbidden,()=>{
 let calls=0;const e=env();e.MOVEMENT_QUALIFICATION_PROJECT_REF=forbidden;e.MOVEMENT_QUALIFICATION_SUPABASE_URL=`https://${forbidden}.supabase.co`;
 assert.throws(()=>{boundary.configuration(e,true);calls++;});assert.equal(calls,0);
});
for(const ack of [false,undefined])test('explicit disposable acknowledgement required '+ack,()=>assert.throws(()=>boundary.configuration(env(),ack)));
for(const kind of [undefined,'staging','production','Disposable'])test('exact disposable kind required '+kind,()=>assert.throws(()=>boundary.configuration({...env(),MOVEMENT_QUALIFICATION_ENVIRONMENT_KIND:kind},true)));
for(const url of ['https://zyxwvutsrqponmlkjihg.supabase.co','https://abcdefghijklmnopqrst.supabase.co.evil.test','http://abcdefghijklmnopqrst.supabase.co','https://abcdefghijklmnopqrst.supabase.co:443','https://abcdefghijklmnopqrst.supabase.co/rest/v1','https://u:p@abcdefghijklmnopqrst.supabase.co','https://abcdefghijklmnopqrst.supabase.co?x=1'])test('canonical URL fails closed '+url,()=>assert.throws(()=>boundary.configuration({...env(),MOVEMENT_QUALIFICATION_SUPABASE_URL:url},true)));
for(const name of ['PROJECT_REF','SUPABASE_URL','SERVICE_ROLE_KEY'])test('explicit variable required '+name,()=>{const e=env();delete e['MOVEMENT_QUALIFICATION_'+name];e.SUPABASE_URL=env().MOVEMENT_QUALIFICATION_SUPABASE_URL;e.SUPABASE_SERVICE_ROLE_KEY='sb_secret_normal';assert.throws(()=>boundary.configuration(e,true));});
test('normal production variables ignored',()=>assert.equal(boundary.configuration({...env(),SUPABASE_URL:`https://${boundary.DENIED[0]}.supabase.co`,SUPABASE_SERVICE_ROLE_KEY:'production'},true).secret,'sb_secret_synthetic'));
test('JWT credentials bind to disposable project and service role',()=>{
 const jwt=v=>'eyJheader.'+Buffer.from(JSON.stringify(v)).toString('base64url')+'.signature';
 for(const claims of [{ref:boundary.DENIED[0],role:'service_role'},{ref,role:'anon'}])assert.throws(()=>boundary.configuration({...env(),MOVEMENT_QUALIFICATION_SERVICE_ROLE_KEY:jwt(claims)},true));
 assert.equal(boundary.configuration({...env(),MOVEMENT_QUALIFICATION_SERVICE_ROLE_KEY:jwt({ref,role:'service_role'})},true).ref,ref);
});
test('remote CLI is separate and acknowledged; old mode defaults unchanged',()=>{
 assert.equal(parseArgs(['--remote-staging','--ack-disposable-environment']).mode,'remote-staging');
 for(const a of [['--remote-staging'],['--offline','--ack-disposable-environment'],['--integration','--remote-staging','--ack-disposable-environment']])assert.throws(()=>parseArgs(a));
 assert.equal(parseArgs(['--offline']).runs,5);assert.equal(parseArgs(['--integration']).mode,'integration');
});
test('capsule authenticates project, repository migrations, freshness and unique fixtures',()=>{
 const c=capsule(),sealed=boundary.seal(c,key);assert.deepEqual(boundary.open(sealed,key,c.projectRefHash),c);
 assert(!sealed.includes(ref));assert(!sealed.includes(c.pairs[0].need));
 for(const changed of [{projectRefHash:'00'.repeat(32)},{migrationDigest:'00'.repeat(32)},{createdAt:'2000-01-01T00:00:00.000Z'},{pairs:[c.pairs[0],c.pairs[0],c.pairs[0],c.pairs[0]]}])assert.throws(()=>boundary.open(boundary.seal({...c,...changed},key),key,c.projectRefHash));
 assert.throws(()=>boundary.open(sealed,'cd'.repeat(32),c.projectRefHash));
});
test('operator DB endpoint restricted before spawning psql; password stays environment-only',()=>{
 const c=config(),e={...env(),MOVEMENT_QUALIFICATION_DB_HOST:`db.${ref}.supabase.co`,MOVEMENT_QUALIFICATION_DB_PASSWORD:'test-password'};
 const pg=admin.postgresConfiguration(e,c);assert.equal(pg.PGSSLMODE,'verify-full');assert.equal(pg.PGPASSWORD,'test-password');
 for(const host of [`db.${boundary.DENIED[0]}.supabase.co`,'127.0.0.1','evil.test'])assert.throws(()=>admin.postgresConfiguration({...e,MOVEMENT_QUALIFICATION_DB_HOST:host},c));
});
test('preflight is read-only; fixture writes preserve guards, use temp helpers and trusted authority',()=>{
 const sql=admin.catalogSql();assert(sql.startsWith('BEGIN READ ONLY'));assert(!/\b(?:DELETE|TRUNCATE|INSERT|UPDATE|ALTER)\s/i.test(sql));
 const fixture=admin.fixtureSql();assert(fixture.includes('0102-disposable'));assert(fixture.includes('pg_temp.interest_offering_fixture'));assert(fixture.includes('record_claimed_requester_route_evidence_for_server'));
 assert(!/INSERT INTO private\.shared_segment_assessment_jobs/i.test(fixture));assert(!/\b(?:DELETE FROM|TRUNCATE|DISABLE TRIGGER|session_replication_role)\b/i.test(fixture));
 assert(!/CREATE SCHEMA/.test(fixture));assert(fixture.endsWith('COMMIT;'));
});
test('schema mismatch aborts before registration or computation',async()=>{
 let writes=0,computes=0;const r=await boundary.remote(config(),capsule(),{backend:{load:async()=>{throw Error('private body');},register:async()=>{writes++;}},compute:async()=>{computes++;}});
 assert.equal(r.failure,'staging_schema_mismatch');assert.equal(writes,0);assert.equal(computes,0);assert.equal(r.fixtureCleanup.recordLevelCleanupAttempted,false);
});
function fakeBackend(f){
 const jobs=[],evidence=new Map();let time=Date.now(),token,active=null,computes=0;
 const register=async(member,need,availability)=>{
  if(evidence.has(need))return {state:'assessment_reuse',assessment:{assessment_id:evidence.get(need)}};
  let job=jobs.find(j=>j.need===need);if(!job){job={need,member,availability,id:crypto.randomUUID(),attempt:0,status:'pending'};jobs.push(job);}
  return {state:'job_registered',job_id:job.id,attempt_count:job.attempt,status:job.status};
 };
 const claim=async()=>{const j=jobs.find(j=>j.status==='pending'||j.status==='running'&&j.until<=time);if(!j)return {state:'idle'};j.status='running';j.attempt++;j.token=crypto.randomUUID();j.until=time+60000;active=j;return {state:'claimed',job_id:j.id,lease_token:j.token,lease_expires_at:new Date(j.until).toISOString(),attempt_count:j.attempt};};
 const load=async(id,lease)=>{const j=jobs.find(j=>j.id===id);if(!j||j.token!==lease)return {state:'lease_invalid'};
  const context={algorithm_version:'shared_segment_geographic_assessment_v1',parameter_fingerprint:'1625aa38ea035ad2c26a8c13a3a4df37714fc32624089fa3894f57c2ddda29d5',need_id:j.need,requester_id:j.member,intent_id:crypto.randomUUID(),offerer_id:crypto.randomUUID()};
  return {state:'ready',lease_expires_at:new Date(j.until).toISOString(),snapshot:{context,offerer_shape:{type:'LineString',coordinates:[[0,0],[0.003,0]]},requester_shape:{type:'LineString',coordinates:[[0,0],[0.003,0]]}},assessment:{lookup_state:'not_found'}};
 };
 const finalize=async(id,lease,context,result,signal,recovery)=>{const j=jobs.find(j=>j.id===id);if(j.token!==lease)return {state:'lease_invalid'};if(evidence.has(j.need))return {state:'completed',assessment_id:evidence.get(j.need),publication_state:'reuse_existing'};if(recovery)return {state:'not_found'};const aid=crypto.randomUUID();evidence.set(j.need,aid);j.status='completed';return {state:'completed',assessment_id:aid,publication_state:'published'};};
 const fail=async(id,lease,category)=>{assert.equal(category,'compute_terminated');const j=jobs.find(j=>j.id===id);j.status='pending';return {state:'pending'};};
 const processCheck=async(c,abandon)=>({ready:true,passed:true,safe:true,claim:abandon?await claim():null});
 return {backend:{register,claim,load,finalize,fail},wait:async ms=>{time+=ms;},now:()=>time,processCheck,evidence,jobs};
}
test('canonical job, reuse with zero second compute, lost ACK, natural lease fencing and real crash',async()=>{
 const c=capsule(),fake=fakeBackend(c),{assessSharedSegment}=require('../functions/_shared/shared-segment-assessment-geometry.ts');
 const out=await boundary.remote(config(),c,{...fake,compute:async(a,b)=>({result:assessSharedSegment(a,b),metrics:{wallMs:1,computeMs:1,cpuMs:1,peakRssBytes:1}})});
 assert.equal(out.failure,null);assert.equal(out.newComputes,3);assert.equal(fake.evidence.size,3);assert.equal(fake.jobs.length,4);
 for(const name of ['jobExecution','exactReuse','staleFencing','childCrash','claimedLeaseRecovery','lostAcknowledgementRecovery'])assert.equal(out.measurements[name],true,name);
 assert.equal(out.measurements.platformRestart,null);assert.equal(out.measurements.hostSecretStorage,null);assert.equal(out.fixtureCleanup.environmentTeardownCompleted,false);
 const serialized=JSON.stringify(out);for(const secret of [ref,config().url,config().secret,...c.pairs.flatMap(p=>Object.values(p)),'coordinates','canonical_context'])assert(!serialized.includes(secret));
});
test('technical verdict requires all seven gates; local verdict remains local',()=>{
 const gates={correctness:true,reliability:true,lease:true,memory:true,process:true,integration:true,security:true};
 assert.equal(verdict({mode:'remote-staging',gates},5).classification,'TARGET_HOST_TECHNICALLY_QUALIFIED');
 for(const name of Object.keys(gates))for(const value of [false,null])assert.notEqual(verdict({mode:'remote-staging',gates:{...gates,[name]:value}},5).classification,'TARGET_HOST_TECHNICALLY_QUALIFIED');
 assert.equal(verdict({mode:'integration',gates},5).classification,'LOCAL_SAMPLE_QUALIFIED');assert.notEqual(verdict({mode:'remote-staging',gates},1).classification,'TARGET_HOST_TECHNICALLY_QUALIFIED');
});
test('remote schema denies private strings/extra fields and mandates teardown',()=>{
 const local=JSON.parse(fs.readFileSync('docs/0101-offline-qualification/qualification.json','utf8'));
 const remote={...local,schemaVersion:'movement_worker_remote_qualification_v2',mode:'remote-staging',remote:{projectRefHash:boundary.hash(ref),environmentKind:'disposable',fixtureCleanup:boundary.cleanup(),schema:{operatorCatalogVerified:true,runtimeCompatible:true,fullCatalogVerifiedOnHost:false},measurements:Object.fromEntries(Object.keys(remoteSchema.properties.remote.properties.measurements.properties).map(k=>[k,null])),safeLogs:true,dbCalls:0,jobsCompleted:0,childCpuMs:0,peakChildRssBytes:0,newComputes:0,publications:0,failure:null}};
 validate(remote);assert(markdown(remote).includes('ENVIRONMENT TEARDOWN REQUIRED'));
 for(const extra of [{url:config().url},{projectRef:ref},{coordinates:[[1,2]]},{id:crypto.randomUUID()}])assert.throws(()=>validate({...remote,remote:{...remote.remote,...extra}}));
 assert.throws(()=>validate({...remote,remote:{...remote.remote,fixtureCleanup:{...boundary.cleanup(),environmentTeardownCompleted:true}}}));
});
test('logs reject secrets, private IDs, geometry and raw URLs',()=>{
 const c=config();assert(boundary.safeLogs('{"event":"worker_ready"}',c));
 for(const text of [c.ref,c.url,c.secret,crypto.randomUUID(),'coordinates','{"unexpected":"private"}'])assert(!boundary.safeLogs(text,c));
});
test('real CLI qualification entry rejects forbidden/missing configuration before fetch or benchmark',async()=>{
 const {qualify}=require('../../scripts/assessment-worker/qualify.cjs'),names=Object.keys(env()),saved=Object.fromEntries(names.map(n=>[n,process.env[n]])),original=global.fetch;
 let calls=0;global.fetch=async()=>{calls++;throw Error('Network must remain inaccessible');};
 try{
  for(const changes of [{MOVEMENT_QUALIFICATION_PROJECT_REF:boundary.DENIED[0]},{MOVEMENT_QUALIFICATION_PROJECT_REF:boundary.DENIED[1]},{MOVEMENT_QUALIFICATION_ENVIRONMENT_KIND:'staging'},{MOVEMENT_QUALIFICATION_SERVICE_ROLE_KEY:undefined},{MOVEMENT_QUALIFICATION_SUPABASE_URL:'https://example.invalid'}]){
   for(const [n,v] of Object.entries({...env(),...changes})){if(v===undefined)delete process.env[n];else process.env[n]=v;}
   await assert.rejects(qualify(parseArgs(['--remote-staging','--ack-disposable-environment'])),e=>!e.message.includes(ref)&&!e.message.includes('sb_secret'));
  }
  assert.equal(calls,0);
 }finally{global.fetch=original;for(const [n,v] of Object.entries(saved)){if(v===undefined)delete process.env[n];else process.env[n]=v;}}
});
test('serializer cannot certify technical host from gates alone with absent process/security evidence',()=>{
 const local=JSON.parse(fs.readFileSync('docs/0101-offline-qualification/qualification.json','utf8'));
 const value={...local,mode:'remote-staging',schemaVersion:'movement_worker_remote_qualification_v2',result:'qualified',classification:'TARGET_HOST_TECHNICALLY_QUALIFIED',gates:Object.fromEntries(Object.keys(local.gates).map(k=>[k,true])),remote:{projectRefHash:boundary.hash(ref),environmentKind:'disposable',fixtureCleanup:boundary.cleanup(),schema:{operatorCatalogVerified:true,runtimeCompatible:true,fullCatalogVerifiedOnHost:false},measurements:Object.fromEntries(Object.keys(remoteSchema.properties.remote.properties.measurements.properties).map(k=>[k,null])),safeLogs:true,dbCalls:0,jobsCompleted:0,childCpuMs:0,peakChildRssBytes:0,newComputes:0,publications:0,failure:null}};
 assert.throws(()=>validate(value),/Unproven/);value.remote.measurements=Object.fromEntries(Object.keys(value.remote.measurements).map(k=>[k,true]));validate(value);
});
test('real POSIX supervisor readiness, idle SIGTERM and claimed-process SIGKILL',{skip:process.platform==='win32'},async()=>{
 const http=require('node:http');let claims=0,abandon=false;
 const server=http.createServer(async(req,res)=>{
  for await(const _chunk of req){};
  assert(req.url.endsWith('/claim_shared_segment_assessment_job_for_server'));
  const value=abandon?{state:'claimed',job_id:crypto.randomUUID(),lease_token:crypto.randomUUID(),lease_expires_at:new Date(Date.now()+60000).toISOString(),attempt_count:1}:{state:'idle'};
  claims++;res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(value));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const c={...config(),url:`http://127.0.0.1:${server.address().port}`};
 try{
  const options={entryPath:require('node:path').join(__dirname,'fixtures/0102-remote-process.cjs')};
  const idle=await boundary.processTest(c,false,options);assert(idle.ready);assert(idle.passed);assert(idle.safe);
  abandon=true;const killed=await boundary.processTest(c,true,options);assert(killed.passed);assert(killed.safe);assert.equal(killed.claim.state,'claimed');assert.equal(claims,2);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('actual remote CLI denial exits nonzero with sanitized conditional teardown message',()=>{
 const cp=require('node:child_process'),forbidden=boundary.DENIED[0];
 const result=cp.spawnSync(process.execPath,['--no-warnings','scripts/assessment-worker/qualify.cjs','--remote-staging','--ack-disposable-environment'],{
  env:{...process.env,...env(),MOVEMENT_QUALIFICATION_PROJECT_REF:forbidden,MOVEMENT_QUALIFICATION_SUPABASE_URL:`https://${forbidden}.supabase.co`},encoding:'utf8',windowsHide:true,timeout:15000});
 assert.equal(result.status,1);assert.equal(result.stdout,'');assert(result.stderr.includes('ENVIRONMENT TEARDOWN REQUIRED if remote writes began'));
 for(const value of [forbidden,config().secret,'no geographic evidence produced'])assert(!result.stderr.includes(value));
 const helper=cp.spawnSync(process.execPath,['--no-warnings','scripts/assessment-worker/qualification-remote-process.cjs','idle','--ack-disposable-environment'],{
  env:{SUPABASE_URL:`https://${forbidden}.supabase.co`,SUPABASE_SERVICE_ROLE_KEY:'sb_secret_forbidden'},encoding:'utf8',windowsHide:true,timeout:15000});
 assert.equal(helper.status,1);assert.equal(helper.stdout,'');assert(!helper.stderr.includes(forbidden));assert(!helper.stderr.includes('sb_secret'));
});
