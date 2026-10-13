'use strict';
// Operator workstation only. Catalog and authenticated sealed-variable metadata.
// Restart origin remains unprovable with the inspected provider fields.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const boundary=require('./qualification-remote.cjs'),admin=require('./qualify-remote-schema.cjs');
const reports=require('./qualification-report.cjs');
const trust=require('./qualification-evidence-trust.cjs');
const railway=require('./qualification-railway-evidence.cjs');
const VERSION='0102-operator-evidence-v3',WINDOW_MS=3600000;
const FIELDS=['platformRestart','hostSecretStorage','participantAcl'];
const fail=()=>{throw Error('Operator evidence unavailable');};
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function canonical(value){
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
 return JSON.stringify(value);
}
function exact(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join('|')!==keys.slice().sort().join('|'))fail();}
function digest(value){if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))fail();}
function fresh(value,now=Date.now()){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value||Date.parse(value)>now||now-Date.parse(value)>WINDOW_MS)fail();
}
function workerSourceHash(){return hash(fs.readdirSync(__dirname).filter(f=>/\.cjs$/.test(f)||f==='package.json').sort().map(f=>f+'\n'+fs.readFileSync(path.join(__dirname,f),'utf8').replace(/\r\n/g,'\n')).join('\n')+'\nmigrations\n'+admin.migrationDigest());}
function context(report,env,ack,now=Date.now()){
 // Denylist and acknowledgement precede file/source/process/database work.
 const config=boundary.configuration(env,ack);
 if(env.MOVEMENT_QUALIFICATION_EVIDENCE_VERIFY_KEY!==undefined||env.MOVEMENT_QUALIFICATION_EVIDENCE_SIGNING_KEY!==undefined)fail();
 reports.validate(report);
 if(report.mode!=='remote-staging'||report.remote.projectRefHash!==config.projectRefHash||report.workerSourceSha256!==workerSourceHash())fail();
 fresh(report.timestamp,now);
 if(Object.values(report.host).some(v=>typeof v==='string'&&(/\b[a-z0-9]{20}\b/.test(v)||[config.ref,config.secret].some(s=>v.includes(s)))))fail();
 // External fields cannot be laundered from a previously edited/finalized report.
 if(FIELDS.some(k=>report.remote.measurements[k]!==null))fail();
 return {provider:report.host.provider,machine:report.host.machine,region:report.host.region,projectRefHash:config.projectRefHash,
  workerSourceSha256:report.workerSourceSha256,migrationDigest:admin.migrationDigest(),qualificationRunSha256:hash(canonical(report))};
}
function repositoryRoot(){
 let dir=admin.ROOT;
 while(!fs.existsSync(path.join(dir,'.git'))){const parent=path.dirname(dir);if(parent===dir)return fs.realpathSync(admin.ROOT);dir=parent;}
 return fs.realpathSync(dir);
}
function within(root,file){const relative=path.relative(root,file);return relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));}
function signingKey(env){
 let key;
 try{
  const file=env.MOVEMENT_QUALIFICATION_EVIDENCE_SIGNING_KEY_FILE;
  if(typeof file!=='string'||!path.isAbsolute(file))fail();
  const root=repositoryRoot(),resolved=fs.realpathSync(file);
  if(within(root,path.resolve(file))||within(root,resolved))fail();
  const stat=fs.statSync(resolved);if(!stat.isFile()||stat.size>65536)fail();
  key=crypto.createPrivateKey(fs.readFileSync(resolved));trust.assertSigningKey(key);
 }catch{fail();}
 return key;
}
/** @param {any} report @param {any} env @param {boolean} ack @param {any} [options] */
function collect(report,env,ack,{verifyParticipantAcl=false,verifyRailwaySecrets=false,spawn,now=Date.now()}={}){
 const bound=context(report,env,ack,now),privateKey=signingKey(env);
 const railwaySecretProof=verifyRailwaySecrets?railway.collectSealed(bound,env,ack,{...(spawn?{spawn}:{}),now}):null;
 let catalogProof=null;
 if(verifyParticipantAcl){
  const catalog=admin.psql(admin.catalogSql(),admin.postgresConfiguration(env,boundary.configuration(env,ack)));
  admin.verifyCatalog(catalog);
  catalogProof={method:'0102_read_only_catalog_v1',observedAt:new Date(now).toISOString(),catalogSha256:hash(canonical(catalog))};
 }
 const payload={version:VERSION,...bound,observedAt:new Date(now).toISOString(),evidence:{platformRestart:null,hostSecretStorage:railwaySecretProof?true:null,participantAcl:catalogProof?true:null},catalogProof,railwaySecretProof};
 return {...payload,signature:crypto.sign(null,Buffer.from(canonical(payload)),privateKey).toString('base64url')};
}
function verify(artifact,bound,env,ack,now=Date.now()){
 exact(artifact,['version',...Object.keys(bound),'observedAt','evidence','catalogProof','railwaySecretProof','signature']);
 if(artifact.version!==VERSION)fail();
 for(const k of Object.keys(bound))if(artifact[k]!==bound[k])fail();
 fresh(artifact.observedAt,now);
 exact(artifact.evidence,FIELDS);
 if(artifact.evidence.platformRestart!==null)fail();
 if(artifact.railwaySecretProof===null){if(artifact.evidence.hostSecretStorage!==null)fail();}
 else if(artifact.evidence.hostSecretStorage!==true||!railway.verifySealed(artifact.railwaySecretProof,bound,env,ack,now))fail();
 if(artifact.catalogProof===null){if(artifact.evidence.participantAcl!==null)fail();}
 else{
  exact(artifact.catalogProof,['method','observedAt','catalogSha256']);
  if(artifact.catalogProof.method!=='0102_read_only_catalog_v1'||artifact.evidence.participantAcl!==true)fail();
  fresh(artifact.catalogProof.observedAt,now);digest(artifact.catalogProof.catalogSha256);
 }
 if(typeof artifact.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(artifact.signature))fail();
 const {signature,...payload}=artifact;
 const signatureBytes=Buffer.from(signature,'base64url');
 if(signatureBytes.toString('base64url')!==signature||!trust.verifySignature(Buffer.from(canonical(payload)),signatureBytes))fail();
 return artifact.evidence;
}
function finalize(report,artifact,env,ack,now=Date.now()){
 const bound=context(report,env,ack,now),out=structuredClone(report);
 const evidence=artifact===null?Object.fromEntries(FIELDS.map(k=>[k,null])):verify(artifact,bound,env,ack,now);
 Object.assign(out.remote.measurements,evidence);
 const m=out.remote.measurements;
 out.gates.process=out.gates.process===false?false:[m.startup,m.idleSigterm,m.platformRestart].some(v=>v===false)?false:[m.startup,m.idleSigterm,m.platformRestart].every(v=>v===true)?true:null;
 out.gates.security=out.gates.security===false||!out.remote.safeLogs||!out.security.childIsolation?false:m.hostSecretStorage===true&&m.participantAcl===true?true:null;
 // Runtime failures and incomplete runtime measurements must still block qualification.
 if(out.gates.integration===true)out.gates.integration=out.remote.failure==='staging_schema_mismatch'?null:out.remote.failure?false:[m.jobExecution,m.exactReuse,m.staleFencing,m.childCrash,m.claimedLeaseRecovery,m.lostAcknowledgementRecovery].every(v=>v===true);
 const runs=Math.min(...out.cases.filter(c=>c.expectedHash).map(c=>c.samples.length),20);
 Object.assign(out,reports.verdict(out,runs));reports.validate(out);return out;
}
function readJson(file){const raw=fs.readFileSync(file);if(raw.length>2*1024*1024)fail();try{return JSON.parse(raw.toString('utf8'));}catch{fail();}}
function main(args=process.argv.slice(2),env=process.env){
 const command=args[0],values={},flags=new Set();
 if(!['collect','finalize'].includes(command))fail();
 for(let i=1;i<args.length;i++){
  const k=args[i];if(flags.has(k)||Object.hasOwn(values,k))fail();
  if(['--ack-disposable-environment','--verify-participant-acl','--verify-railway-secrets'].includes(k))flags.add(k);
  else if(['--report','--evidence','--output'].includes(k)){const v=args[++i];if(!v||v.startsWith('--'))fail();values[k]=v;}
  else fail();
 }
 const ack=flags.has('--ack-disposable-environment');boundary.configuration(env,ack);
 if(!values['--report']||!values['--output']||command==='collect'&&values['--evidence']||command==='finalize'&&(flags.has('--verify-participant-acl')||flags.has('--verify-railway-secrets')))fail();
 const report=readJson(values['--report']);
 const output=command==='collect'?collect(report,env,ack,{verifyParticipantAcl:flags.has('--verify-participant-acl'),verifyRailwaySecrets:flags.has('--verify-railway-secrets')}):finalize(report,values['--evidence']?readJson(values['--evidence']):null,env,ack);
 // Exclusive creation keeps the original report and provenance immutable.
 fs.writeFileSync(path.resolve(values['--output']),JSON.stringify(output,null,2)+'\n',{flag:'wx',mode:0o600});
 process.stdout.write(command==='collect'?'Operator evidence collected. ENVIRONMENT TEARDOWN REQUIRED.\n':reports.markdown(output));
 return output;
}
module.exports={VERSION,WINDOW_MS,canonical,workerSourceHash,context,collect,verify,finalize,main};
if(require.main===module)try{main();}catch{process.stderr.write('Operator evidence unavailable. ENVIRONMENT TEARDOWN REQUIRED.\n');process.exitCode=1;}
