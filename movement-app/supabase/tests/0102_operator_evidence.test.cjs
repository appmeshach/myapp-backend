'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const production=require('../../scripts/assessment-worker/qualification-operator-evidence.cjs'),trust=require('../../scripts/assessment-worker/qualification-evidence-trust.cjs');
const boundary=require('../../scripts/assessment-worker/qualification-remote.cjs'),admin=require('../../scripts/assessment-worker/qualify-remote-schema.cjs'),reports=require('../../scripts/assessment-worker/qualification-report.cjs');
const ref='abcdefghijklmnopqrst',now=Date.now(),stamp=new Date(now).toISOString();
const publicPem='-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAcYWxHYOyBz21Z1mdST5qlJCC0gb60lsCB3bmfeS3LPA=\n-----END PUBLIC KEY-----\n';
const expectedFingerprint='13228a92e18fb61153185a048c4edb496cdee1b83d1e894f8f216568211f0fa9';
const keys=crypto.generateKeyPairSync('ed25519'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'movement-0102-test-'));
const keyFile=path.join(temp,'ephemeral-signing.pem');
fs.writeFileSync(keyFile,keys.privateKey.export({type:'pkcs8',format:'pem'}),{flag:'wx',mode:0o600});
test.after(()=>{assert.equal(path.dirname(temp),path.resolve(os.tmpdir()));assert(path.basename(temp).startsWith('movement-0102-test-'));fs.rmSync(temp,{recursive:true,force:true});});
// Positive tests use memory-only source copies with a random identity.
// Production has no trust injection; no test reads the real operator key.
const workerDir=path.resolve(__dirname,'../../scripts/assessment-worker');
function loadTrust(source){
 const mod={exports:{}};
 vm.runInNewContext(source,{require:createRequire(path.join(workerDir,'qualification-evidence-trust.cjs')),module:mod,Buffer},{filename:'isolated-trust.cjs'});return mod.exports;
}
const trustSource=fs.readFileSync(path.join(workerDir,'qualification-evidence-trust.cjs'),'utf8');
const ephemeralPublic=keys.publicKey.export({type:'spki',format:'pem'}),ephemeralFingerprint=crypto.createHash('sha256').update(keys.publicKey.export({type:'spki',format:'der'})).digest('hex');
const isolatedTrust=loadTrust(trustSource.replace(publicPem.trim().split('\n')[1],ephemeralPublic.trim().split('\n')[1]).replace(expectedFingerprint,ephemeralFingerprint));
const isolated={exports:{}};
vm.runInNewContext(fs.readFileSync(path.join(workerDir,'qualification-operator-evidence.cjs'),'utf8'),{
 require:name=>name==='./qualification-evidence-trust.cjs'?isolatedTrust:createRequire(path.join(workerDir,'qualification-operator-evidence.cjs'))(name),
 module:isolated,__dirname:workerDir,process,Buffer,structuredClone,
},{filename:'isolated-operator-evidence.cjs'});
const evidence=isolated.exports;
const env=()=>({MOVEMENT_QUALIFICATION_ENVIRONMENT_KIND:'disposable',MOVEMENT_QUALIFICATION_PROJECT_REF:ref,MOVEMENT_QUALIFICATION_SUPABASE_URL:'https://'+ref+'.supabase.co',MOVEMENT_QUALIFICATION_SERVICE_ROLE_KEY:'sb_secret_synthetic',MOVEMENT_QUALIFICATION_EVIDENCE_SIGNING_KEY_FILE:keyFile,MOVEMENT_QUALIFICATION_DB_CONNECTION_MODE:'session_pooler',MOVEMENT_QUALIFICATION_DB_HOST:'aws-0-eu-west-1.pooler.supabase.com',MOVEMENT_QUALIFICATION_DB_USER:'postgres.'+ref,MOVEMENT_QUALIFICATION_DB_PASSWORD:'synthetic-password'});
function report(){
 const r=JSON.parse(fs.readFileSync('docs/0101-offline-qualification/qualification.json','utf8'));
 Object.assign(r,{timestamp:stamp,workerSourceSha256:production.workerSourceHash(),schemaVersion:'movement_worker_remote_qualification_v2',mode:'remote-staging',host:{...r.host,provider:'Railway',machine:'Hobby',region:'europe-west4-drams3a'},gates:{correctness:true,reliability:true,lease:true,memory:true,process:null,integration:true,security:null},result:'incomplete',classification:'QUALIFICATION_INCOMPLETE',reasons:['process_not_measured','security_not_measured']});
 r.remote={projectRefHash:boundary.hash(ref),environmentKind:'disposable',fixtureCleanup:boundary.cleanup(),schema:{operatorCatalogVerified:true,runtimeCompatible:true,fullCatalogVerifiedOnHost:false},measurements:Object.fromEntries(Object.keys(reports.remoteSchema.properties.remote.properties.measurements.properties).map(k=>[k,['platformRestart','hostSecretStorage','participantAcl'].includes(k)?null:true])),safeLogs:true,dbCalls:1,jobsCompleted:3,childCpuMs:1,peakChildRssBytes:1,newComputes:3,publications:3,failure:null};
 reports.validate(r);return r;
}
function catalog(){
 const identities={register_requester_availability_assessment_job_for_server:'p_verified_member_id uuid, p_movement_need_id uuid, p_availability_id uuid',claim_shared_segment_assessment_job_for_server:'',load_shared_segment_assessment_job_context_for_server:'p_job_id uuid, p_lease_token uuid',finalize_shared_segment_assessment_job_for_server:'p_job_id uuid, p_lease_token uuid, p_context jsonb, p_result jsonb, p_recovery_only boolean',fail_shared_segment_assessment_job_for_server:'p_job_id uuid, p_lease_token uuid, p_category text'};
 const functions=[...admin.expectedFunctions()].map(([name,body])=>({name,body,owner:'postgres',definer:name!=='private.shared_segment_assessment_parameters',config:name==='public.get_shared_segment_geographic_assessment_context_for_server'?['search_path=""','TimeZone=UTC']:['search_path=""'],identity:identities[name.split('.')[1]]||'',acl:name.startsWith('public.')?['postgres=X/postgres','service_role=X/postgres']:['postgres=X/postgres']}));
 const parameters=admin.expectedFunctions().get('private.shared_segment_assessment_parameters').match(/SELECT '([^]*?)'::text/)[1];
 return {versions:fs.readdirSync('supabase/migrations').filter(v=>/^\d{4}_.*\.sql$/.test(v)).map(v=>v.slice(0,4)),functions,parameters,tables:['shared_segment_assessment_jobs','shared_segment_geographic_assessments'].map((name,i)=>({name,rls:true,policies:0,participantSelect:false,serviceSelect:false,triggers:[{name:i?'protect_shared_segment_geographic_assessment':'protect_shared_segment_assessment_job',enabled:'O',type:i?27:31,function:'private.'+(i?'protect_shared_segment_geographic_assessment':'protect_shared_segment_assessment_job')}]}))};
}
function collect(t,r=report(),acl=true){
 t.mock.method(admin,'psql',(sql,pg)=>{assert(sql.startsWith('BEGIN READ ONLY;'));assert.equal(pg.PGUSER,'postgres.'+ref);return catalog();});
 return evidence.collect(r,env(),true,{verifyParticipantAcl:acl,now});
}
test('exact reviewed Ed25519 key and independently computed SPKI fingerprint',()=>{
 const key=crypto.createPublicKey(publicPem);assert.equal(key.asymmetricKeyType,'ed25519');
 assert.equal(crypto.createHash('sha256').update(key.export({type:'spki',format:'der'})).digest('hex'),expectedFingerprint);assert.equal(trust.FINGERPRINT,expectedFingerprint);
 assert.deepEqual(Object.keys(trust).sort(),['FINGERPRINT','assertSigningKey','verifySignature']);assert(Object.isFrozen(trust));
});
test('corrupted public key or fingerprint fails closed at module load',()=>{
 assert.throws(()=>loadTrust(trustSource.replace(expectedFingerprint,'00'.repeat(32))));
 assert.throws(()=>loadTrust(trustSource.replace(publicPem.trim().split('\n')[1],ephemeralPublic.trim().split('\n')[1])));
});
test('random Ed25519 key cannot sign accepted production evidence',t=>{
 let calls=0;t.mock.method(admin,'psql',()=>{calls++;});assert.throws(()=>trust.assertSigningKey(keys.privateKey));
 assert.throws(()=>production.collect(report(),env(),true,{verifyParticipantAcl:true,now}));assert.equal(calls,0);
 const p=Buffer.from('ephemeral-only');assert.equal(trust.verifySignature(p,crypto.sign(null,p,keys.privateKey)),false);
});
for(const value of ['',publicPem,ephemeralPublic])test('env verifier override rejects even without artifact '+value.length,()=>{
 const e={...env(),MOVEMENT_QUALIFICATION_EVIDENCE_VERIFY_KEY:value};assert.throws(()=>production.finalize(report(),null,e,true,now));assert.throws(()=>evidence.collect(report(),e,true,{now}));
});
test('legacy private PEM env input rejected',()=>assert.throws(()=>production.finalize(report(),null,{...env(),MOVEMENT_QUALIFICATION_EVIDENCE_SIGNING_KEY:'unsupported'},true,now)));
for(const file of [undefined,'relative.pem',path.join(temp,'missing.pem'),temp,path.join(workerDir,'qualification-evidence-trust.cjs')])test('invalid signing file rejects '+String(file),t=>{
 let calls=0;t.mock.method(admin,'psql',()=>{calls++;});assert.throws(()=>evidence.collect(report(),{...env(),MOVEMENT_QUALIFICATION_EVIDENCE_SIGNING_KEY_FILE:file},true,{verifyParticipantAcl:true,now}));assert.equal(calls,0);
});
test('key path resolving into repository rejects',t=>{
 const original=fs.realpathSync;t.mock.method(fs,'realpathSync',file=>file===keyFile?path.join(workerDir,'qualification-evidence-trust.cjs'):original(file));
 assert.throws(()=>evidence.collect(report(),env(),true,{now}));
});
test('non-Ed25519 or malformed signing key fails with sanitized error',()=>{
 const rsa=crypto.generateKeyPairSync('rsa',{modulusLength:2048}),file=path.join(temp,'invalid.pem');
 for(const contents of ['invalid',rsa.privateKey.export({type:'pkcs8',format:'pem'})]){fs.writeFileSync(file,contents);assert.throws(()=>evidence.collect(report(),{...env(),MOVEMENT_QUALIFICATION_EVIDENCE_SIGNING_KEY_FILE:file},true,{now}),e=>e.message==='Operator evidence unavailable');}
});
test('no evidence keeps all fields null; env boolean shortcuts ignored',()=>{
 const e={...env(),MOVEMENT_QUALIFICATION_PLATFORM_RESTART:'true',MOVEMENT_QUALIFICATION_HOST_SECRET_STORAGE:'true',MOVEMENT_QUALIFICATION_PARTICIPANT_ACL:'true'},out=production.finalize(report(),null,e,true,now);
 for(const k of ['platformRestart','hostSecretStorage','participantAcl'])assert.equal(out.remote.measurements[k],null);assert.equal(out.classification,'QUALIFICATION_INCOMPLETE');
});
test('isolated matching signer grants only catalog ACL; production rejects its signature',t=>{
 let calls=0;t.mock.method(global,'fetch',async()=>{calls++;throw Error();});
 const r=report(),a=collect(t,r),e=env();delete e.MOVEMENT_QUALIFICATION_DB_PASSWORD;delete e.MOVEMENT_QUALIFICATION_EVIDENCE_SIGNING_KEY_FILE;
 const out=evidence.finalize(r,a,e,true,now);assert.equal(out.remote.measurements.participantAcl,true);
 assert.equal(out.remote.measurements.platformRestart,null);assert.equal(out.remote.measurements.hostSecretStorage,null);assert.equal(out.classification,'QUALIFICATION_INCOMPLETE');reports.validate(out);assert.equal(calls,0);
 assert.deepEqual(out.cases,r.cases);assert.deepEqual(out.usage,r.usage);
 const serialized=JSON.stringify(a);for(const v of [ref,keyFile,env().MOVEMENT_QUALIFICATION_DB_PASSWORD,env().MOVEMENT_QUALIFICATION_SERVICE_ROLE_KEY,'https://','coordinates','BEGIN READ ONLY','PRIVATE KEY'])assert(!serialized.includes(v));
 assert.throws(()=>production.finalize(r,a,e,true,now));
});
test('without catalog ACL is null; finalize never reads private file',t=>{
 const r=report(),a=collect(t,r,false),original=fs.readFileSync;
 t.mock.method(fs,'readFileSync',(file,...args)=>{assert.notEqual(file,keyFile);return original(file,...args);});
 const out=evidence.finalize(r,a,env(),true,now);for(const k of ['platformRestart','hostSecretStorage','participantAcl'])assert.equal(out.remote.measurements[k],null);
});
for(const field of ['provider','machine','region','projectRefHash','workerSourceSha256','migrationDigest','qualificationRunSha256'])test('wrong binding rejects '+field,t=>{
 const r=report(),a=collect(t,r);a[field]=field.endsWith('Sha256')||field.endsWith('Hash')||field==='migrationDigest'?'00'.repeat(32):'wrong';assert.throws(()=>evidence.finalize(r,a,env(),true,now));
});
test('different report rejects exact run binding',t=>{const r=report(),a=collect(t,r);r.usage.dbCalls++;assert.throws(()=>evidence.finalize(r,a,env(),true,now));});
test('migration change invalidates source binding',t=>{const r=report();t.mock.method(admin,'migrationDigest',()=> '00'.repeat(32));assert.throws(()=>evidence.collect(r,env(),true,{now}));});
for(const [name,mutate] of [
 ['missing signature',a=>delete a.signature],['old version',a=>a.version='0102-operator-evidence-v1'],['wrong signature',a=>a.signature='A'.repeat(86)],['manual ACL',a=>{a.catalogProof=null;a.evidence.participantAcl=true;}],['malformed proof',a=>a.catalogProof.method='manual'],['future',a=>a.observedAt=new Date(now+1).toISOString()],['expired',a=>a.observedAt=new Date(now-evidence.WINDOW_MS-1).toISOString()],['invalid date',a=>a.observedAt='2026-02-30T00:00:00.000Z'],['expired catalog',a=>a.catalogProof.observedAt=new Date(now-evidence.WINDOW_MS-1).toISOString()],['secret',a=>a.secret='sb_secret_private'],['URL',a=>a.catalogProof.catalogSha256='https://private.invalid'],['raw ref',a=>a.catalogProof.catalogSha256=ref],['UUID',a=>a.catalogProof.catalogSha256=crypto.randomUUID()],['coordinates',a=>a.coordinates=[[1,2]]],['password',a=>a.password='private'],['artifact verifier',a=>a.publicKey=ephemeralPublic],['signing path',a=>a.signingFile=keyFile],
])test('artifact rejects '+name,t=>{const r=report(),a=collect(t,r);mutate(a);assert.throws(()=>evidence.finalize(r,a,env(),true,now));});
for(const field of ['platformRestart','hostSecretStorage'])for(const asserted of [true,{recordSha256:'ab'.repeat(32)},{leaseRecoveryVerified:true,duplicatePublications:0},{uiReadbackBlocked:true,apiReadbackBlocked:true},'screenshot.png','operator prose'])test('provider assertion rejects '+field+' '+JSON.stringify(asserted),t=>{
 const r=report(),a=collect(t,r);a.evidence[field]=asserted;
 const {signature,...payload}=a;a.signature=crypto.sign(null,Buffer.from(evidence.canonical(payload)),keys.privateKey).toString('base64url');
 assert.throws(()=>evidence.finalize(r,a,env(),true,now));
});
test('old observations reject; collector has no observation intake',t=>{
 const r=report(),a=collect(t,r);a.observations={platformRestart:{leaseRecoveryVerified:true},hostSecretStorage:{uiReadbackBlocked:true}};assert.throws(()=>evidence.finalize(r,a,env(),true,now));assert.equal(evidence.observations,undefined);
});
test('catalog mismatch cannot produce ACL evidence',t=>{
 let calls=0;t.mock.method(admin,'psql',()=>{calls++;return {...catalog(),versions:[]};});assert.throws(()=>evidence.collect(report(),env(),true,{verifyParticipantAcl:true,now}));assert.equal(calls,1);
 const valid=catalog();admin.verifyCatalog(valid);valid.tables[0].participantSelect=true;assert.throws(()=>admin.verifyCatalog(valid));
});
for(const denied of boundary.DENIED)test('denylist precedes key read/DB/network '+denied,t=>{
 let calls=0;const original=fs.readFileSync;t.mock.method(fs,'readFileSync',(file,...args)=>{if(file===keyFile)calls++;return original(file,...args);});t.mock.method(admin,'psql',()=>{calls++;});t.mock.method(global,'fetch',async()=>{calls++;});
 const e={...env(),MOVEMENT_QUALIFICATION_PROJECT_REF:denied,MOVEMENT_QUALIFICATION_SUPABASE_URL:'https://'+denied+'.supabase.co'},r=report();
 assert.throws(()=>evidence.collect(r,e,true,{verifyParticipantAcl:true,now}));assert.throws(()=>production.finalize(r,null,e,true,now));assert.equal(calls,0);
});
test('missing ack, stale/old source report and preasserted fields reject',()=>{
 assert.throws(()=>production.finalize(report(),null,env(),false,now));
 for(const change of [r=>r.timestamp=new Date(now-evidence.WINDOW_MS-1).toISOString(),r=>r.workerSourceSha256='00'.repeat(32),r=>r.remote.measurements.participantAcl=true,r=>r.remote.measurements.platformRestart=true,r=>r.remote.measurements.hostSecretStorage=true]){const r=report();change(r);assert.throws(()=>production.finalize(r,null,env(),true,now));}
});
for(const gate of ['correctness','reliability','lease','memory','process','integration','security'])test('ACL proof preserves false gate '+gate,t=>{
 const r=report();r.gates[gate]=false;const a=collect(t,r),out=evidence.finalize(r,a,env(),true,now);assert.equal(out.gates[gate],false);assert.notEqual(out.classification,'TARGET_HOST_TECHNICALLY_QUALIFIED');
});
test('strict validator rejects technical qualification if either provider field is null',t=>{
 const r=report(),out=evidence.finalize(r,collect(t,r),env(),true,now);
 for(const field of ['platformRestart','hostSecretStorage']){const v=structuredClone(out);Object.assign(v,{result:'qualified',classification:'TARGET_HOST_TECHNICALLY_QUALIFIED',gates:Object.fromEntries(Object.keys(v.gates).map(k=>[k,true]))});for(const k of Object.keys(v.remote.measurements))v.remote.measurements[k]=true;v.remote.measurements[field]=null;assert.throws(()=>reports.validate(v),/Unproven/);}
});
test('CLI rejects booleans, old observations and overwrites',()=>{
 for(const flag of ['--platform-restart','--host-secret-storage','--participant-acl','--observations'])assert.throws(()=>evidence.main(['finalize','--ack-disposable-environment',flag,'true'],env()));
 const file=path.join(temp,'report.json'),out=path.join(temp,'preserved.json');fs.writeFileSync(file,JSON.stringify(report()));fs.writeFileSync(out,'preserved');
 assert.throws(()=>evidence.main(['finalize','--ack-disposable-environment','--report',file,'--output',out],env()));assert.equal(fs.readFileSync(out,'utf8'),'preserved');
});
test('isolated CLI collects actual catalog verifier then imports incomplete without private key',t=>{
 const file=path.join(temp,'cli-report.json'),artifact=path.join(temp,'evidence.json'),out=path.join(temp,'final.json');let calls=0;t.mock.method(admin,'psql',()=>{calls++;return catalog();});t.mock.method(process.stdout,'write',()=>true);
 fs.writeFileSync(file,JSON.stringify(report()));evidence.main(['collect','--ack-disposable-environment','--report',file,'--verify-participant-acl','--output',artifact],env());assert.equal(calls,1);
 const e=env();delete e.MOVEMENT_QUALIFICATION_DB_PASSWORD;delete e.MOVEMENT_QUALIFICATION_EVIDENCE_SIGNING_KEY_FILE;
 evidence.main(['finalize','--ack-disposable-environment','--report',file,'--evidence',artifact,'--output',out],e);
 const result=JSON.parse(fs.readFileSync(out,'utf8'));assert.equal(result.classification,'QUALIFICATION_INCOMPLETE');assert.equal(result.remote.measurements.participantAcl,true);assert.equal(calls,1);
});
test('signed sealed-variable proof alone promotes only storage and preserves false gates',t=>{
 const railway=require('../../scripts/assessment-worker/qualification-railway-evidence.cjs'),r=report(),e=env(),cli=path.join(temp,'railway.exe');fs.writeFileSync(cli,'synthetic non-executable fixture');
 Object.assign(e,{MOVEMENT_QUALIFICATION_RAILWAY_CLI_FILE:cli,MOVEMENT_QUALIFICATION_RAILWAY_PROJECT_ID:'synthetic-project',MOVEMENT_QUALIFICATION_RAILWAY_ENVIRONMENT_ID:'synthetic-environment',MOVEMENT_QUALIFICATION_RAILWAY_SERVICE_ID:'synthetic-service',MOVEMENT_QUALIFICATION_RAILWAY_SERVICE_INSTANCE_ID:'synthetic-instance'});
 const connection=nodes=>({edges:nodes.map(node=>({node})),pageInfo:{hasNextPage:false,hasPreviousPage:false}});
 const data={project:{id:'synthetic-project',environments:connection([{id:'synthetic-environment'}]),services:connection([{id:'synthetic-service'}])},environment:{id:'synthetic-environment',variables:{...connection(railway.NAMES.map((name,i)=>({id:'synthetic-variable-'+i,name,isSealed:true,serviceId:'synthetic-service',environmentId:'synthetic-environment'}))),pageInfo:{hasNextPage:false,hasPreviousPage:false}}},serviceInstance:{id:'synthetic-instance',serviceId:'synthetic-service',environmentId:'synthetic-environment',region:r.host.region,restartPolicyType:'ON_FAILURE',restartPolicyMaxRetries:10,latestDeployment:{id:'synthetic-deployment'}}};
 const capability={connection:{fields:[{name:'edges'},{name:'pageInfo'}]},page:{fields:[{name:'hasNextPage'},{name:'hasPreviousPage'}]}};
 const spawn=(_file,args)=>({status:0,stderr:'',stdout:JSON.stringify({data:args[1]===railway.CAPABILITY_QUERY?capability:data})});
 const a=evidence.collect(r,e,true,{verifyRailwaySecrets:true,spawn,now}),out=evidence.finalize(r,a,e,true,now);
 assert.equal(out.remote.measurements.hostSecretStorage,true);assert.equal(out.remote.measurements.platformRestart,null);assert.equal(out.remote.measurements.participantAcl,null);assert.equal(out.classification,'QUALIFICATION_INCOMPLETE');
 const changed=structuredClone(a);changed.railwaySecretProof.identities.serviceSha256='00'.repeat(32);assert.throws(()=>evidence.finalize(r,changed,e,true,now));
 r.gates.security=false;const failed=evidence.collect(r,e,true,{verifyRailwaySecrets:true,spawn,now});assert.equal(evidence.finalize(r,failed,e,true,now).gates.security,false);
});
