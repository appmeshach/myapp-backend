'use strict';
// Conformance model for a human procedure. No production parser, intake capability,
// automated provenance verifier or live-input promotion function is shipped.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const {loadAcquisition,clone}=require('./fixtures/0114d-acquisition-wrapper.cjs');
const root=path.resolve(__dirname,'../..'),base=path.join(root,'scripts/assessment-worker');
const normal=require(path.join(base,'qualification-railway-live-authorization.cjs'));
const template=JSON.parse(fs.readFileSync(path.join(root,'docs/0114f-target-metadata-evidence-template.json'),'utf8'));
const ePath=path.join(root,'docs/0114e-acquisition-input-review-template.json');
const eSafe=JSON.parse(fs.readFileSync(ePath,'utf8'));
const fields=['projectId','environmentId','serviceId','serviceInstanceId'];
const acquisitionCommit='13120f715ea70913eb791f0fb8bc224f2c67a15c';
const recordedAcquisition=JSON.parse(cp.execFileSync('git',['-c','safe.directory='+path.resolve(root,'..'),'show',acquisitionCommit+
 ':movement-app/docs/0114f-operator-acquired-target-metadata.json'],{encoding:'utf8',env:{},windowsHide:true}));
const historicalKeys=['acquisitionDate','acquisitionTimeKnown','historicalAcquisitionCommit','reviewerDistinctFromAcquirer'];
const blocked=['xdfmoggrsucisfybqctb','udlsysezmzutydnifhsq','uzkhnslyrhgucijcuoes',
 'thorough-blessing','myapp-backend','feature/0092-shared-segment-suitability','/movement-app','europe-west4-drams3a','RAILPACK_NODE_VERSION=24'];
const fixtureValues=['synthetic-project','synthetic-env','synthetic-environment','synthetic-service','synthetic-instance',
 'synthetic-expected-instance','expected-instance','other','changed','partial','synthetic','PROJECT','ENVIRONMENT','SERVICE','SERVICE_INSTANCE'];
const secretPattern=/sb_secret_|^eyJ|-----BEGIN|private.?key|(?:bearer|railway|api|access)[ _-]*token|token[=:]|cookie[=:]|authorization[=:]|https?:\/\//i;
function exact(v,keys){assert.ok(v&&typeof v==='object'&&!Array.isArray(v));assert.deepEqual(Reflect.ownKeys(v).sort(),keys.slice().sort());}
function safeData(v){
 if(typeof v==='string')assert.doesNotMatch(v,secretPattern);
 else if(v&&typeof v==='object')for(const [key,d]of Object.entries(Object.getOwnPropertyDescriptors(v))){
  assert.ok(Object.hasOwn(d,'value'));assert.doesNotMatch(key,/credential|password|cookie|header|token|private.?key/i);safeData(d.value);
 }
}
const reference=v=>assert.ok(typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9 ._:/()-]{0,255}$/.test(v));
function timestamp(v){assert.ok(typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v));assert.equal(new Date(v).toISOString(),v);}

function inspectSourceSurface(r,field){
 assert.equal(r.sourceKind,'operator_visible_provider_metadata');
 assert.ok(['identifier_field','copy_identifier_control','identifier_url_path_segment','identifier_query_parameter'].includes(r.sourceSurface));
 if(r.sourceSurface==='identifier_query_parameter'){
  assert.equal(field,'environmentId');assert.equal(r.sourceParameterName,'environmentId');
  assert.equal(r.labelContext.environmentName,'production');
  assert.equal(r.labelContext.projectName,template.expectedContext.projectName);
 }else assert.equal(r.sourceParameterName,null);
}
// Structural assertion model ONLY: human source authenticity cannot be derived
// from JSON, reviewer strings or UUID spelling. Never writes or promotes inputs.
function inspectRecord(r,field){
 const historical=Object.hasOwn(r,'historicalAcquisitionCommit');
 exact(r,[...Object.keys(template.identifiers[field]),...(historical?historicalKeys:[])]);safeData(r);
 assert.equal(r.field,field);assert.equal(r.provider,'Railway');
 assert.ok(typeof r.value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(r.value));
 assert.equal(blocked.includes(r.value),false);
 assert.equal(fixtureValues.some(v=>v.toLowerCase()===r.value.toLowerCase()),false);
 assert.doesNotMatch(r.value,/^(synthetic|test|fixture|example)(?:[-_]|$)/i);
 assert.equal(r.sourceClassification,'operator_supplied_provider_metadata');
 inspectSourceSurface(r,field);
 for(const k of ['sourceReference','acquisitionReference','reviewerReference','reviewReference'])reference(r[k]);
 timestamp(r.reviewedAt);
 if(historical){
  // This exception is bound to the already committed acquisition, not fresh intake.
  assert.ok(template.requiredFields.includes(field));
  assert.equal(r.historicalAcquisitionCommit,acquisitionCommit);
  assert.equal(r.acquisitionDate,'2026-10-14');assert.equal(r.acquisitionTimeKnown,false);
  assert.equal(r.acquiredAt,null);assert.equal(r.reviewerDistinctFromAcquirer,true);
  assert.equal(r.acquisitionReference,'Repository acquisition record '+acquisitionCommit);
  for(const k of ['value','provider','sourceKind','sourceSurface','sourceParameterName','sourceReference','acquiredByReference','labelContext'])
   assert.deepEqual(r[k],recordedAcquisition.identifiers[field][k]);
  assert.ok(r.reviewedAt.slice(0,10)>r.acquisitionDate);
 }else{
  reference(r.acquiredByReference);timestamp(r.acquiredAt);
  assert.ok(Date.parse(r.reviewedAt)>=Date.parse(r.acquiredAt));
 }
 if(r.acquiredByReference!==null){
  reference(r.acquiredByReference);
  assert.notEqual(r.acquiredByReference.trim().toLowerCase(),r.reviewerReference.trim().toLowerCase());
 }
 assert.doesNotMatch(r.reviewerReference,/railway\s+ai|\bai\s+agent\b/i);
 assert.equal(r.independentlyReviewed,true);assert.equal(r.authoritativeForInputReview,true);assert.equal(r.contextCompared,true);
 exact(r.labelContext,Object.keys(template.expectedContext));
 for(const k of ['projectName','serviceName','branch','rootDirectory'])assert.equal(r.labelContext[k],template.expectedContext[k]);
 if(r.labelContext.environmentName!==null)reference(r.labelContext.environmentName);
 return clone(r);
}
function inspectCandidate(c){
 exact(c,Object.keys(template));
 // codeIdentity and crossSystemForbidden are descriptive exact copies, never authority.
 for(const k of ['version','recordingContext','expectedContext','requiredFields','optionalUntilProviderObservation','codeIdentity','crossSystemForbidden'])
  assert.deepEqual(c[k],template[k]);
 assert.equal(c.samePersonReviewPermitted,false);assert.equal(c.outcome,'PRELIVE_NOT_AUTHORIZED');
 for(const k of ['liveAuthorized','manualLiveAuthorization','providerObservationOccurred','targetIdentityProven','executableAcquisitionPrepared'])assert.equal(c[k],false);
 assert.equal(c.reviewed,false);assert.equal(c.evidenceReviewComplete,false);
 exact(c.identifiers,fields);
 for(const field of fields){
  const record=c.identifiers[field];
  if(field==='serviceInstanceId'&&record.value===null){
   assert.deepEqual(record,template.identifiers.serviceInstanceId);continue;
  }
  inspectRecord(record,field);
 }
 return Object.freeze({outcome:'PRELIVE_NOT_AUTHORIZED',evidenceReviewComplete:true,
  liveAuthorized:false,manualLiveAuthorization:false,providerObservationOccurred:false,targetIdentityProven:false,
  executableAcquisitionPrepared:false,automaticallyPromoted:false});
}
// Hypothetical evidence shapes; numeric UUIDs are fabricated test data, not actual
// Railway IDs, reviewers or source evidence. No real evidence record is produced.
function candidate(){
 const c=clone(template);
 for(const [i,field]of fields.entries()){
  if(field==='serviceInstanceId')continue;
  Object.assign(c.identifiers[field],{
   value:'00000000-0000-4000-8000-'+String(i+1).padStart(12,'0'),sourceKind:'operator_visible_provider_metadata',
   sourceSurface:'identifier_field',sourceReference:'Hypothetical provider dashboard identifier field',
   sourceClassification:'operator_supplied_provider_metadata',acquiredByReference:'hypothetical operator A',
   acquiredAt:'2026-10-14T10:00:00.000Z',acquisitionReference:'hypothetical capture reference',
   independentlyReviewed:true,reviewerReference:'hypothetical reviewer B',reviewedAt:'2026-10-14T11:00:00.000Z',
   reviewReference:'hypothetical independent comparison',contextCompared:true,authoritativeForInputReview:true
  });
 }
 return c;
}
const reject=fn=>assert.throws(fn);
test.beforeEach(t=>{
 let calls=0;
 for(const [o,k]of [[require('node:http'),'request'],[require('node:https'),'request'],[global,'fetch']])
  t.mock.method(o,k,()=>{calls++;throw Error('REAL NETWORK FORBIDDEN');});
 const f=loadAcquisition();
 t.after(()=>{
  assert.equal(calls,0);assert.deepEqual(f.reads,[]);assert.deepEqual(f.calls,[]);
  assert.equal(f.opens.length,0);assert.equal(f.sessions.length,0);assert.equal(f.records.length,0);
  assert.equal(f.timers.size,0);assert.deepEqual(f.trace,[]);
 });
});
test('safe evidence template keeps all actual IDs unresolved and every authority claim false',()=>{
 assert.equal(template.outcome,'PRELIVE_NOT_AUTHORIZED');
 for(const k of ['reviewed','evidenceReviewComplete','liveAuthorized','manualLiveAuthorization','providerObservationOccurred','targetIdentityProven','executableAcquisitionPrepared'])assert.equal(template[k],false);
 for(const field of fields){
  const r=template.identifiers[field];assert.equal(r.field,field);assert.equal(r.value,null);assert.equal(r.provider,'Railway');
  for(const k of ['independentlyReviewed','authoritativeForInputReview','contextCompared'])assert.equal(r[k],false);
  for(const k of ['sourceReference','reviewerReference','acquiredByReference','reviewedAt','acquiredAt','reviewReference','acquisitionReference'])assert.equal(r[k],null);
 }
 reject(()=>inspectCandidate(clone(template)));
});
test('hypothetical completed evidence assertions remain descriptive PRELIVE data without automatic promotion',()=>{
 const result=inspectCandidate(candidate());
 assert.deepEqual(result,{outcome:'PRELIVE_NOT_AUTHORIZED',evidenceReviewComplete:true,liveAuthorized:false,
  manualLiveAuthorization:false,providerObservationOccurred:false,targetIdentityProven:false,executableAcquisitionPrepared:false,automaticallyPromoted:false});
});
for(const value of blocked)for(const field of fields)
 test('label/cross-system substitution rejected: '+field+' '+value,()=>{
  const c=candidate();if(field==='serviceInstanceId')c.identifiers[field]={...clone(c.identifiers.serviceId),field};
  c.identifiers[field].value=value;reject(()=>inspectCandidate(c));
 });
for(const value of fixtureValues)
 test('known synthetic/test/source-tag value never becomes reviewed live input: '+value,()=>{
  const c=candidate();c.identifiers.projectId.value=value;reject(()=>inspectCandidate(c));
 });
for(const classification of ['synthetic_test_value','historical_untrusted','label_only','unknown'])
 test('non-authoritative provenance rejected: '+classification,()=>{
  const c=candidate();c.identifiers.projectId.sourceClassification=classification;reject(()=>inspectCandidate(c));
 });
for(const field of fields)for(const key of ['sourceReference','reviewerReference','acquiredByReference','acquisitionReference','reviewReference'])
 test('independent evidence requires '+field+' '+key,()=>{
  const c=candidate();if(field==='serviceInstanceId')c.identifiers[field]={...clone(c.identifiers.serviceId),field};
  c.identifiers[field][key]=null;reject(()=>inspectCandidate(c));
 });
for(const field of fields)for(const key of ['independentlyReviewed','authoritativeForInputReview','contextCompared'])
 test('review flag required: '+field+' '+key,()=>{
  const c=candidate();if(field==='serviceInstanceId')c.identifiers[field]={...clone(c.identifiers.serviceId),field};
  c.identifiers[field][key]=false;reject(()=>inspectCandidate(c));
 });
test('instance may stay null until later fixed provider observation',()=>assert.equal(inspectCandidate(candidate()).providerObservationOccurred,false));
test('supplied instance requires same evidence structure',()=>{
 const c=candidate();c.identifiers.serviceInstanceId={...clone(c.identifiers.serviceId),field:'serviceInstanceId',value:'00000000-0000-4000-8000-000000000004'};
 assert.equal(inspectCandidate(c).executableAcquisitionPrepared,false);
});
for(const value of [null,'',17,{},'has whitespace','/path','a'.repeat(129),'bad?value'])
 test('malformed identifier rejected: '+JSON.stringify(value),()=>{
  const c=candidate();c.identifiers.projectId.value=value;reject(()=>inspectCandidate(c));
 });
for(const mode of ['samePerson','caseAlias','beforeAcquisition','missingTime','invalidTime','wrongProvider','wrongKind','wrongSurface','wrongField','wrongContext','samePersonPolicy'])
 test('review provenance rejects '+mode,()=>{
  const c=candidate(),r=c.identifiers.projectId;
  if(mode==='samePerson')r.reviewerReference=r.acquiredByReference;
  if(mode==='caseAlias')r.reviewerReference=r.acquiredByReference.toUpperCase();
  if(mode==='beforeAcquisition')r.reviewedAt='2026-10-13T10:00:00.000Z';
  if(mode==='missingTime')r.reviewedAt=null;if(mode==='invalidTime')r.acquiredAt='not a timestamp';
  if(mode==='wrongProvider')r.provider='Supabase';if(mode==='wrongKind')r.sourceKind='repository_fixture';
  if(mode==='wrongSurface')r.sourceSurface='API_export';if(mode==='wrongField')r.field='serviceId';
  if(mode==='wrongContext')r.labelContext.rootDirectory='/other';
  if(mode==='samePersonPolicy')c.samePersonReviewPermitted=true;
  reject(()=>inspectCandidate(c));
 });
for(const surface of ['identifier_field','copy_identifier_control','identifier_url_path_segment'])
 test('allowed human-visible surface: '+surface,()=>{
  const c=candidate();c.identifiers.projectId.sourceSurface=surface;assert.equal(inspectCandidate(c).liveAuthorized,false);
 });
for(const key of ['token','credential','headers','cookie','password','privateKey','unknown'])
 test('extra secret-bearing or unreviewed record field rejected: '+key,()=>{
  const c=candidate();c.identifiers.projectId[key]='synthetic-placeholder';reject(()=>inspectCandidate(c));
 });
for(const value of ['sb_secret_SYNTHETIC_ONLY','eyJ_SYNTHETIC_ONLY','Bearer token SYNTHETIC_ONLY',
 '-----BEGIN SYNTHETIC PRIVATE KEY-----','token=SYNTHETIC_ONLY','cookie=SYNTHETIC_ONLY','https://invalid.example/path'])
 test('obvious secret pattern or raw URL rejected in every textual evidence surface: '+value.split(/[ =]/)[0],()=>{
  for(const key of ['value','sourceReference','reviewerReference','reviewReference','acquisitionReference','acquiredByReference']){
   const c=candidate();c.identifiers.projectId[key]=value;reject(()=>inspectCandidate(c));
  }
 });
for(const key of ['liveAuthorized','manualLiveAuthorization','providerObservationOccurred','targetIdentityProven','executableAcquisitionPrepared'])
 test('completed evidence assertions cannot set '+key,()=>{
  const c=candidate();c[key]=true;reject(()=>inspectCandidate(c));
 });
test('copied/serialized evidence and review summaries remain ordinary data',()=>{
 const c=candidate(),result=inspectCandidate(clone(c));
 assert.deepEqual(result,inspectCandidate({...c}));
 assert.equal(Object.hasOwn(result,'ticket'),false);assert.equal(Object.hasOwn(result,'privateTarget'),false);
 assert.equal(Object.hasOwn(result,'contextHandoff'),false);assert.equal(result.automaticallyPromoted,false);
 // No authorization or wrapper function is invoked even with invalid inputs.
});
test('0114E current v2 template preserves safe defaults; historical v1 stays historical',()=>{
 const old=cp.execFileSync('git',['-c','safe.directory='+path.resolve(root,'..'),'show',
  '19150ae041e7cf78cedd5ba1247a551a5d26df06:movement-app/docs/0114e-acquisition-input-review-template.json'],
  {encoding:'utf8',env:{},windowsHide:true});
 assert.equal(JSON.parse(old).version,'movement_railway_acquisition_input_review_v1');
 assert.equal(eSafe.version,'movement_railway_acquisition_input_review_v2');assert.equal(eSafe.expectedTarget.serviceName,null);assert.equal(eSafe.inputReviewComplete,false);
 for(const field of fields)assert.equal(eSafe.expectedTarget[field],null);
});
test('all 12 pins and authorization self hash remain exact',()=>{
 assert.equal(Object.keys(template.codeIdentity.sourceHashes).length,12);
 assert.deepEqual(template.codeIdentity,normal.acquisitionReviewTemplate().manifest.codeIdentity);
 for(const [file,sha]of Object.entries(template.codeIdentity.sourceHashes))
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(base,file),'utf8').replace(/\r\n/g,'\n')).digest('hex'),sha);
});
test('template records no invented reviewers, time attestations or secret-bearing data',()=>{
 for(const r of Object.values(template.identifiers)){
  for(const [key,value]of Object.entries(r))assert.doesNotMatch(key,/token|credential|password|cookie|header|private.?key/i);
  for(const value of Object.values(r))if(typeof value==='string')assert.doesNotMatch(value,secretPattern);
 }
});
test('global authority remains false/null',()=>{
 const f=loadAcquisition();
 for(const state of [normal.state,f.auth.state,f.adapter.status,f.identity.state]){
  for(const key of ['providerContextObserved','projectEnvironmentContextProven','serviceContextProven','executionSchemaReady'])assert.equal(state[key],false);
  for(const key of ['identity_proven','causality_proven','restart_origin_proven','platformRestart'])assert.equal(state[key],null);
 }
 assert.equal(f.identity.state.targetIdentityObserved,false);assert.equal(f.reads.length,0);
});

function queryCandidate(){
 const c=candidate(),r=c.identifiers.environmentId;
 r.sourceSurface='identifier_query_parameter';r.sourceParameterName='environmentId';
 r.labelContext.environmentName='production';
 r.sourceReference='Named environmentId parameter with production selected in project thorough-blessing';
 return c;
}
test('only named environmentId query evidence with intended context passes the review model',()=>{
 const r=inspectCandidate(queryCandidate());assert.equal(r.liveAuthorized,false);assert.equal(r.automaticallyPromoted,false);
});
for(const field of ['projectId','serviceId','serviceInstanceId'])test('query surface cannot identify '+field,()=>{
 const c=queryCandidate();c.identifiers[field]={...clone(c.identifiers.environmentId),field,sourceParameterName:field};
 reject(()=>inspectCandidate(c));
});
for(const name of ['projectId','serviceId','foo','EnvironmentId','environment','environmentId=synthetic-value',null])
 test('query parameter name is exact and restricted: '+name,()=>{
  const c=queryCandidate();c.identifiers.environmentId.sourceParameterName=name;reject(()=>inspectCandidate(c));
 });
for(const context of ['wrongEnvironment','nullEnvironment','wrongProject'])
 test('query evidence requires production and intended project context: '+context,()=>{
  const c=queryCandidate(),r=c.identifiers.environmentId;
  if(context==='wrongEnvironment')r.labelContext.environmentName='staging';
  if(context==='nullEnvironment')r.labelContext.environmentName=null;
  if(context==='wrongProject')r.labelContext.projectName='different-project';
  reject(()=>inspectCandidate(c));
 });
for(const surface of ['identifier_field','copy_identifier_control','identifier_url_path_segment'])
 test('other surfaces must not carry a query parameter declaration: '+surface,()=>{
  const c=candidate();c.identifiers.environmentId.sourceSurface=surface;c.identifiers.environmentId.sourceParameterName='environmentId';
  reject(()=>inspectCandidate(c));
 });
for(const value of ['https://invalid.example/path?environmentId=synthetic-value','?environmentId=synthetic-value',
 'environmentId=synthetic-value','#environmentId=synthetic-value','review#fragment'])
 test('raw URL query or fragment remains prohibited evidence reference: '+value.split(/[?=#]/)[0],()=>{
  const c=queryCandidate();c.identifiers.environmentId.sourceReference=value;reject(()=>inspectCandidate(c));
 });
for(const value of [null,'',17,'has whitespace','bad?value','x'.repeat(129)])
 test('query extraction does not relax environment ID grammar: '+JSON.stringify(value),()=>{
  const c=queryCandidate();c.identifiers.environmentId.value=value;reject(()=>inspectCandidate(c));
 });
for(const reviewer of ['Railway AI Agent','Railway AI','AI Agent'])
 test('provider AI cannot act as independent human reviewer: '+reviewer,()=>{
  const c=queryCandidate();c.identifiers.environmentId.reviewerReference=reviewer;reject(()=>inspectCandidate(c));
 });
test('URL inference or operator acquisition alone does not satisfy independent review',()=>{
 const c=queryCandidate(),r=c.identifiers.environmentId;
 r.independentlyReviewed=false;r.authoritativeForInputReview=false;r.reviewerReference=null;r.reviewedAt=null;r.reviewReference=null;
 reject(()=>inspectCandidate(c));
});
function actualEvidence(){
 return JSON.parse(fs.readFileSync(path.join(root,'docs/0114f-operator-acquired-target-metadata.json'),'utf8'));
}
test('AT independently reviewed exact actual metadata with explicit historical unknown acquisition time',()=>{
 const actual=actualEvidence();
 assert.equal(actual.outcome,'PRELIVE_NOT_AUTHORIZED');
 assert.equal(actual.reviewed,true);assert.equal(actual.evidenceReviewComplete,true);
 for(const k of ['liveAuthorized','manualLiveAuthorization','providerObservationOccurred','targetIdentityProven','executableAcquisitionPrepared'])assert.equal(actual[k],false);
 const values={projectId:'0fa3268a-396f-4042-a4c0-a92c23fdf486',environmentId:'69b93a87-a91b-4c14-8656-6b0ca3135cee',serviceId:'b053fe9d-716b-49f4-ac24-324c221d054d'};
 for(const [field,value]of Object.entries(values)){
  const r=actual.identifiers[field];inspectRecord(r,field);
  assert.equal(r.value,value);assert.equal(r.reviewerReference,'AT');
  assert.equal(r.reviewedAt,'2026-10-15T14:01:00.000Z');
  assert.equal(r.acquiredAt,null);assert.equal(r.acquiredByReference,null);
  assert.equal(r.acquisitionDate,'2026-10-14');assert.equal(r.acquisitionTimeKnown,false);
  assert.equal(r.historicalAcquisitionCommit,acquisitionCommit);assert.equal(r.reviewerDistinctFromAcquirer,true);
  assert.equal(r.independentlyReviewed,true);assert.equal(r.contextCompared,true);
  assert.equal(r.authoritativeForInputReview,true);assert.equal(r.sourceClassification,'operator_supplied_provider_metadata');
 }
 assert.deepEqual(actual.identifiers.serviceInstanceId,recordedAcquisition.identifiers.serviceInstanceId);
 assert.equal(actual.identifiers.serviceInstanceId.value,null);
 assert.deepEqual(actual.codeIdentity,recordedAcquisition.codeIdentity);
 assert.equal(Object.keys(actual.codeIdentity.sourceHashes).length,12);
 assert.equal(actual.identifiers.environmentId.sourceParameterName,'environmentId');
 assert.equal(actual.expectedContext.environmentName,'production');
 const text=JSON.stringify(actual);assert.doesNotMatch(text,/https?:\/\//);assert.doesNotMatch(text,/environmentId=/);
});
for(const field of ['projectId','environmentId','serviceId']){
 for(const key of historicalKeys)test('historical exception requires explicit '+field+' '+key,()=>{
  const r=clone(actualEvidence().identifiers[field]);delete r[key];reject(()=>inspectRecord(r,field));
 });
 for(const [key,value]of [
  ['acquisitionDate','2026-10-13'],['acquisitionDate','2026-02-30'],['acquisitionTimeKnown',true],
  ['historicalAcquisitionCommit','0'.repeat(40)],['acquiredAt','2026-10-14T22:00:00.000Z'],
  ['reviewerDistinctFromAcquirer',false],['reviewedAt','2026-10-14T23:59:59.000Z'],
  ['value','fresh-unrecorded-id'],['acquiredByReference','invented operator'],['acquisitionReference',null],
  ['independentlyReviewed',false],['contextCompared',false],['authoritativeForInputReview',false],
  ['reviewerReference',null],['reviewerReference','Railway AI'],['reviewReference',null],['reviewedAt',null],
  ['sourceClassification','operator_acquired_not_independently_reviewed']
 ])test('historical unknown-time review rejects '+field+' '+key+' '+JSON.stringify(value),()=>{
  const r=clone(actualEvidence().identifiers[field]);r[key]=value;reject(()=>inspectRecord(r,field));
 });
}
test('fresh acquisitions cannot borrow the historical unknown-time exception',()=>{
 const r=clone(actualEvidence().identifiers.projectId);
 r.value='00000000-0000-4000-8000-000000000099';reject(()=>inspectRecord(r,'projectId'));
 for(const value of [null,'',undefined]){
  const c=candidate();c.identifiers.projectId.acquiredAt=value;reject(()=>inspectCandidate(c));
 }
});
test('recorded operator and AT must be different whenever an operator reference exists',()=>{
 const c=candidate();c.identifiers.projectId.acquiredByReference='AT';c.identifiers.projectId.reviewerReference='AT';
 reject(()=>inspectCandidate(c));
 c.identifiers.projectId.reviewerReference='at';reject(()=>inspectCandidate(c));
});
test('0114E versioned safe template cannot inherit historical authority',()=>{
 const opts={env:{},windowsHide:true};
 const gitArgs=['-c','safe.directory='+path.resolve(root,'..')];
 const old=cp.execFileSync('git',[...gitArgs,'show',acquisitionCommit+':movement-app/docs/0114e-acquisition-input-review-template.json'],opts);
 const historical=JSON.parse(old.toString('utf8')),work=JSON.parse(fs.readFileSync(ePath,'utf8'));
 assert.equal(historical.version,'movement_railway_acquisition_input_review_v1');assert.equal(work.version,'movement_railway_acquisition_input_review_v2');
 for(const k of ['reviewed','inputReviewComplete','liveAuthorized','manualLiveAuthorization'])assert.equal(work[k],false);
 assert.equal(work.expectedTarget.serviceName,null);assert.equal(work.targetInputSources.serviceName.independentlyReviewed,false);
});

test('safe golden evidence template stays unpopulated with nullable parameter declarations',()=>{
 for(const field of fields){
  assert.equal(template.identifiers[field].value,null);assert.equal(template.identifiers[field].sourceParameterName,null);
 }
});
