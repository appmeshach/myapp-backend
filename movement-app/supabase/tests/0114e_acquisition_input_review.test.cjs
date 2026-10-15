'use strict';
// Documentation/worksheet conformance only. No production input-review module,
// sealed package, authorization capability or live entry point is introduced.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {loadAcquisition,clone,inventory}=require('./fixtures/0114d-acquisition-wrapper.cjs');
const base=path.resolve(__dirname,'../../scripts/assessment-worker');
const normal=require(path.join(base,'qualification-railway-live-authorization.cjs'));
const template=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../docs/0114e-acquisition-input-review-template.json'),'utf8'));
const cats=['projectIds','environmentIds','serviceIds','serviceInstanceIds'],ids=cats.map(k=>k.slice(0,-1));
const head='ee228de90d4f1d68662948670bb15efed7fb6f0f',branch='feature/0092-shared-segment-suitability';
function offline(t){
 const f=loadAcquisition();f.drift.head=head;
 t.after(()=>{
  assert.equal(f.calls.length,0);assert.equal(f.reads.length,0);assert.equal(f.opens.length,0);assert.equal(f.sessions.length,0);
  assert.equal(f.timers.size,0);assert.deepEqual(f.trace,[]);
  for(const r of f.records)assert.equal(Object.hasOwn(r.value,'ticketIssued'),false);
 });
 return f;
}
test.beforeEach(t=>{
 let calls=0;
 for(const [o,k] of [[require('node:http'),'request'],[require('node:http'),'get'],[require('node:https'),'request'],[require('node:https'),'get'],[global,'fetch']])
  t.mock.method(o,k,()=>{calls++;throw Error('REAL NETWORK FORBIDDEN');});
 t.after(()=>assert.equal(calls,0));
});
function candidate(){
 const c=clone(template);
 Object.assign(c.expectedTarget,{projectId:'synthetic-project',environmentId:'synthetic-env',serviceId:'synthetic-service',environmentKind:'disposable',lifecycle:'active'});
 c.reviewedHead=head;c.reviewedBranch=branch;
 c.codeIdentity={...c.codeIdentity,reviewedHead:head,reviewedBranch:branch};
 c.forbiddenRailwayInventory=inventory();
 for(const k of ids)if(c.expectedTarget[k]!==null)c.targetInputSources[k]={independentlyReviewed:true,source:'synthetic independently supplied metadata',reviewer:'synthetic reviewer'};
 c.hostReview={reviewed:true,reviewer:'synthetic reviewer',checklist:{nodeMajor:24,...Object.fromEntries(Object.keys(template.hostReview.checklist).filter(k=>k!=='nodeMajor').map(k=>[k,true]))}};
 c.independentReview={reviewed:true,reviewer:'synthetic independent reviewer',evidenceReference:'synthetic offline record'};
 return c;
}
// Test-only executable model of the manual review procedure documented in 0114E.
// It returns descriptive checks, not a reviewed package or an execution capability.
function checkWorksheet(f,c){
 for(const k of ['liveAuthorized','manualLiveAuthorization','executableAcquisitionPrepared','providerObservationOccurred','targetIdentityProven','serviceIdentityProven','serviceInstanceIdentityProven'])
  assert.equal(c[k],false);
 assert.equal(c.outcome,'PRELIVE_NOT_AUTHORIZED');assert.equal(c.reviewed,false);assert.equal(c.inputReviewComplete,false);
 assert.equal(c.reviewedHead,head);assert.equal(c.reviewedBranch,branch);
 assert.deepEqual(c.requiredCodeReview,template.requiredCodeReview);
 assert.equal(c.expectedTarget.serviceName,template.expectedTarget.serviceName);
 assert.equal(c.expectedTarget.branch,branch);assert.equal(c.expectedTarget.rootDirectory,'/movement-app');
 assert.deepEqual(c.historicalLabels,template.historicalLabels);assert.deepEqual(c.crossSystemForbidden,template.crossSystemForbidden);
 const prohibited=Object.values(template.historicalLabels).filter(v=>typeof v==='string').concat(
  ['xdfmoggrsucisfybqctb','udlsysezmzutydnifhsq','uzkhnslyrhgucijcuoes']);
 for(const k of ids){
  const value=c.expectedTarget[k];
  if(k!=='serviceInstanceId'||value!==null){
   assert.equal(prohibited.includes(value),false);
   const evidence=c.targetInputSources[k];
   assert.equal(evidence.independentlyReviewed,true);
   for(const field of ['source','reviewer'])assert.ok(typeof evidence[field]==='string'&&evidence[field].trim());
  }
 }
 const scope=Object.fromEntries(['environmentKind','lifecycle',...ids].map(k=>[k,c.expectedTarget[k]]));
 // Do not reduce the full inventory to the target bind API's legacy denylist
 // until its reviewed/completeness flags and schema are checked by the owner.
 const binding=f.targets.bindTarget(scope,{...scope},{inventoryReviewed:true,...Object.fromEntries(cats.map(k=>[k,[]]))});
 const reviewed=f.identity.reviewForbiddenInventory(binding,c.forbiddenRailwayInventory);
 const code=f.auth.verifyCodeIdentity({reviewedHead:c.reviewedHead,reviewedBranch:c.reviewedBranch});
 assert.deepEqual(clone(code),c.codeIdentity);
 const host=c.hostReview;
 assert.equal(host.reviewed,true);assert.ok(typeof host.reviewer==='string'&&host.reviewer.trim());
 assert.deepEqual(Object.keys(host.checklist).sort(),Object.keys(template.hostReview.checklist).sort());
 assert.ok(Number.isInteger(host.checklist.nodeMajor)&&host.checklist.nodeMajor>=24);
 for(const k of Object.keys(host.checklist).filter(k=>k!=='nodeMajor'))assert.equal(host.checklist[k],true);
 assert.equal(c.independentReview.reviewed,true);
 for(const k of ['reviewer','evidenceReference'])assert.ok(typeof c.independentReview[k]==='string'&&c.independentReview[k].trim());
 return {outcome:c.outcome,liveAuthorized:false,manualLiveAuthorization:false,executableAcquisitionPrepared:false,
  target:clone(f.targets.describeTarget(binding)),inventory:clone(reviewed.inventory),codeIdentity:clone(code)};
}
const reject=fn=>assert.throws(fn);
test('safe worksheet has null IDs, false authority, unreviewed inventory and current exact identity',t=>{
 const f=offline(t);
 assert.equal(template.outcome,'PRELIVE_NOT_AUTHORIZED');
 for(const k of ['reviewed','inputReviewComplete','liveAuthorized','manualLiveAuthorization','executableAcquisitionPrepared','providerObservationOccurred','targetIdentityProven','serviceIdentityProven','serviceInstanceIdentityProven'])assert.equal(template[k],false);
 for(const k of ids)assert.equal(template.expectedTarget[k],null);
 for(const k of ['reviewedHead','reviewedBranch']){assert.equal(template[k],null);assert.equal(template.codeIdentity[k],null);}
 assert.equal(template.forbiddenRailwayInventory.inventoryReviewed,false);
 for(const k of cats){const e=template.forbiddenRailwayInventory[k];for(const flag of ['reviewed','completenessAcknowledged','completenessIsOperatorAssertion'])assert.equal(e[flag],false);assert.equal(e.ids,null);assert.equal(e.labels,null);}
 assert.equal(template.hostReview.reviewed,false);
 assert.deepEqual(template.codeIdentity,normal.acquisitionReviewTemplate().manifest.codeIdentity);
 assert.deepEqual(template.hostReview.checklist,normal.reviewTemplate().hostChecklist);
 reject(()=>checkWorksheet(f,clone(template)));
});
test('synthetic independently reviewed candidate is descriptive PRELIVE only; no session/context/ticket/request',t=>{
 const f=offline(t),result=checkWorksheet(f,candidate());
 assert.equal(result.outcome,'PRELIVE_NOT_AUTHORIZED');assert.equal(result.liveAuthorized,false);assert.equal(result.manualLiveAuthorization,false);
 assert.equal(result.executableAcquisitionPrepared,false);assert.equal(result.target.serviceInstanceId,null);
 assert.equal(Object.keys(result).includes('ticket'),false);
});
for(const id of ['thorough-blessing','myapp-backend','europe-west4-drams3a',branch,'/movement-app'])
 for(const field of ids)test('historical label cannot replace '+field+': '+id,t=>{
  const f=offline(t),c=candidate();c.expectedTarget[field]=id;reject(()=>checkWorksheet(f,c));
 });
for(const ref of ['xdfmoggrsucisfybqctb','udlsysezmzutydnifhsq','uzkhnslyrhgucijcuoes'])
 for(const field of ids)test('non-Railway namespace rejected in '+field+': '+ref,t=>{
  const f=offline(t),c=candidate();c.expectedTarget[field]=ref;reject(()=>checkWorksheet(f,c));
 });
for(const value of [null,'','has whitespace','/path','x'.repeat(129),12,{},'bad?value'])
 for(const field of ['projectId','environmentId','serviceId'])test('malformed '+field+': '+JSON.stringify(value),t=>{
  const f=offline(t),c=candidate();c.expectedTarget[field]=value;reject(()=>checkWorksheet(f,c));
 });
for(const field of ['environmentKind','lifecycle','serviceName','branch','rootDirectory'])
 test('target expectation mismatch: '+field,t=>{const f=offline(t),c=candidate();c.expectedTarget[field]='wrong';reject(()=>checkWorksheet(f,c));});
for(const field of ['projectId','environmentId','serviceId'])
 test('independent metadata required: '+field,t=>{const f=offline(t),c=candidate();c.targetInputSources[field].independentlyReviewed=false;reject(()=>checkWorksheet(f,c));});
test('optional known instance expectation is validated but remains unobserved',t=>{
 const f=offline(t),c=candidate();c.expectedTarget.serviceInstanceId='synthetic-instance';
 c.targetInputSources.serviceInstanceId={independentlyReviewed:true,source:'synthetic metadata',reviewer:'synthetic reviewer'};
 assert.equal(checkWorksheet(f,c).target.serviceInstanceId,'synthetic-instance');
});
for(const cat of cats)for(const flag of ['reviewed','completenessAcknowledged','completenessIsOperatorAssertion'])
 test('explicit inventory acknowledgement required: '+cat+' '+flag,t=>{
  const f=offline(t),c=candidate();c.forbiddenRailwayInventory[cat][flag]=false;reject(()=>checkWorksheet(f,c));
 });
for(const mode of ['unreviewed','basis','provenance','idsNull','duplicate','unboundLabel'])
 test('inventory rejects '+mode,t=>{
  const f=offline(t),c=candidate(),v=c.forbiddenRailwayInventory;
  if(mode==='unreviewed')v.inventoryReviewed=false;if(mode==='basis')v.basis=null;if(mode==='provenance')v.provenance=null;
  if(mode==='idsNull')v.projectIds.ids=null;if(mode==='duplicate')v.projectIds.ids=['synthetic-denied','synthetic-denied'];
  if(mode==='unboundLabel')v.projectIds.labels=[{id:'synthetic-denied',label:'synthetic name'}];
  reject(()=>checkWorksheet(f,c));
 });
for(const cat of cats)test('forbidden collision: '+cat,t=>{
 const f=offline(t),c=candidate(),field=cat.slice(0,-1);
 if(field==='serviceInstanceId'){c.expectedTarget[field]='synthetic-instance';c.targetInputSources[field]={independentlyReviewed:true,source:'synthetic metadata',reviewer:'synthetic reviewer'};}
 c.forbiddenRailwayInventory[cat].ids=[c.expectedTarget[field]];reject(()=>checkWorksheet(f,c));
});
test('inventory labels are descriptive and must reference listed forbidden IDs',t=>{
 const f=offline(t),c=candidate();
 c.forbiddenRailwayInventory.projectIds={reviewed:true,completenessAcknowledged:true,completenessIsOperatorAssertion:true,
  ids:['synthetic-denied'],labels:[{id:'synthetic-denied',label:'synthetic forbidden project'}]};
 assert.equal(checkWorksheet(f,c).inventory.projectIds.labels[0].label,'synthetic forbidden project');
});
for(const mode of ['candidateHead','candidateBranch','currentHead','currentBranch','recordedHash','recordedSelf'])
 test('reviewed code binding fails: '+mode,t=>{
  const f=offline(t),c=candidate();
  if(mode==='candidateHead')c.reviewedHead='b'.repeat(40);if(mode==='candidateBranch')c.reviewedBranch='wrong';
  if(mode==='currentHead')f.drift.head='b'.repeat(40);if(mode==='currentBranch')f.drift.branch='wrong';
  if(mode==='recordedHash')c.codeIdentity.sourceHashes[Object.keys(normal.sourceHashes)[0]]='0'.repeat(64);
  if(mode==='recordedSelf')c.codeIdentity.authorizationBoundarySha256='0'.repeat(64);
  reject(()=>checkWorksheet(f,c));
 });
for(const file of [...Object.keys(normal.sourceHashes),'qualification-railway-live-authorization.cjs'])
 test('source drift invalidates offline review: '+file,t=>{
  const f=offline(t),c=candidate(),p=path.join(base,file);
  f.drift.files.set(p,fs.readFileSync(p,'utf8')+'// synthetic drift');reject(()=>checkWorksheet(f,c));
 });
for(const key of Object.keys(template.hostReview.checklist))
 test('host checklist rejects unsafe or missing assertion: '+key,t=>{
  const f=offline(t),c=candidate();c.hostReview.checklist[key]=key==='nodeMajor'?23:false;reject(()=>checkWorksheet(f,c));
 });
for(const mode of ['extra','unreviewed','missingReviewer','manualTrue','liveTrue','executableTrue','identityTrue'])
 test('host checklist and worksheet cannot grant authority: '+mode,t=>{
  const f=offline(t),c=candidate();
  if(mode==='extra')c.hostReview.checklist.extra=true;if(mode==='unreviewed')c.hostReview.reviewed=false;
  if(mode==='missingReviewer')c.independentReview.reviewer=null;if(mode==='manualTrue')c.manualLiveAuthorization=true;
  if(mode==='liveTrue')c.liveAuthorized=true;if(mode==='executableTrue')c.executableAcquisitionPrepared=true;
  if(mode==='identityTrue')c.targetIdentityProven=true;reject(()=>checkWorksheet(f,c));
 });
test('worksheet copies and serialization are data, never opaque authorization capabilities',t=>{
 const f=offline(t),c=candidate();
 for(const v of [c,{...c},clone(c)]){
  reject(()=>f.auth.reviewAcquisitionPackage(v));reject(()=>f.auth.reviewExecutableAcquisitionPackage(v));
 }
 // Do not call beginAuthorizedAcquisition even with invalid worksheet data in 0114E.
});
test('pins, canonical byte rule, self hash and forbidden namespace are exact',()=>{
 assert.equal(Object.keys(normal.sourceHashes).length,12);
 for(const [file,sha]of Object.entries(template.codeIdentity.sourceHashes)){
  const bytes=fs.readFileSync(path.join(base,file),'utf8').replace(/\r\n/g,'\n');
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),sha);
 }
 const self=fs.readFileSync(path.join(base,'qualification-railway-live-authorization.cjs'),'utf8').replace(/\r\n/g,'\n');
 assert.equal(crypto.createHash('sha256').update(self).digest('hex'),template.codeIdentity.authorizationBoundarySha256);
 assert.deepEqual(template.crossSystemForbidden,normal.reviewTemplate().crossSystemForbidden);
});
test('normal local Git identity is current; historical milestone metadata becomes stale',()=>{
 const cp=require('node:child_process');
 const current=cp.execFileSync('git',['-c','safe.directory='+path.resolve(__dirname,'../../..'),'rev-parse','HEAD'],{encoding:'utf8',env:{},windowsHide:true}).trim();
 const c=normal.verifyCodeIdentity({reviewedHead:current,reviewedBranch:branch});
 assert.equal(c.reviewedHead,current);assert.equal(c.reviewedBranch,branch);
 if(current!==head)reject(()=>normal.verifyCodeIdentity({reviewedHead:head,reviewedBranch:branch}));
 assert.equal(template.reviewedHead,null);assert.equal(template.reviewedBranch,null);
});
test('templates contain only safe data and no credential patterns',()=>{
 const text=JSON.stringify(template);
 assert.doesNotMatch(text,/sb_secret_|-----BEGIN [^-]*PRIVATE KEY|eyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]+|Bearer\s+[A-Za-z0-9_-]+/);
 assert.equal(Object.hasOwn(template,'credential'),false);assert.equal(Object.hasOwn(template,'token'),false);
 for(const source of Object.values(template.targetInputSources)){assert.equal(source.source,null);assert.equal(source.reviewer,null);assert.equal(source.independentlyReviewed,false);}
});
test('global authority remains false/null after offline checks',t=>{
 const f=offline(t);checkWorksheet(f,candidate());
 for(const state of [f.auth.state,f.identity.state,f.adapter.status,normal.state]){
  for(const k of ['providerContextObserved','projectEnvironmentContextProven','serviceContextProven','executionSchemaReady'])assert.equal(state[k],false);
  for(const k of ['identity_proven','causality_proven','restart_origin_proven','platformRestart'])assert.equal(state[k],null);
 }
 assert.equal(f.identity.state.targetIdentityObserved,false);
});

test('CRLF checkout bytes preserve canonical source identity',t=>{
 const f=offline(t),c=candidate();
 for(const file of [...Object.keys(normal.sourceHashes),'qualification-railway-live-authorization.cjs']){
  const p=path.join(base,file),text=fs.readFileSync(p,'utf8');
  f.drift.files.set(p,text.split(String.fromCharCode(13)).join('').split(String.fromCharCode(10)).join(String.fromCharCode(13,10)));
 }
 assert.equal(checkWorksheet(f,c).codeIdentity.authorizationBoundarySha256,template.codeIdentity.authorizationBoundarySha256);
});
for(const mode of ['BOM','EOF'])test('canonical source verification preserves '+mode+' significance',t=>{
 const f=offline(t),c=candidate(),p=path.join(base,'qualification-railway-acquisition-wrapper.cjs'),text=fs.readFileSync(p,'utf8');
 f.drift.files.set(p,mode==='BOM'?String.fromCharCode(0xFEFF)+text:text+String.fromCharCode(10));
 reject(()=>checkWorksheet(f,c));
});

// Actual offline assessment, still ordinary JSON. This does not relax the
// complete worksheet model above or prepare a binding/draft/ticket/context.
const actualHead='72ba10ec5a058d234749d177cc4d70ad07761faa';
const root=path.resolve(base,'../..');
const actualPath='docs/0114e-actual-acquisition-input-review.json';
const evidencePath='docs/0114f-operator-acquired-target-metadata.json';
const protectedInputs=[
 'docs/0114e-acquisition-input-review-template.json',evidencePath,
 'docs/0114f-target-metadata-evidence-template.json',
 'docs/0114e-railway-acquisition-input-review.md',
 'docs/0114f-railway-target-metadata-resolution.md',
 'docs/0114d-railway-acquisition-wrapper.md',
 'docs/MOVEMENT_LAUNCH_READINESS_REGISTER.md',
 'supabase/tests/0114e_acquisition_input_review.test.cjs',
 'supabase/tests/0114f_target_metadata_evidence.test.cjs',
 'supabase/tests/0114d_acquisition_wrapper.test.cjs',
 'supabase/tests/fixtures/0114d-acquisition-wrapper.cjs',
 'supabase/tests/fixtures/0114d-authorization-loader.cjs'
];
const actualValues={projectId:'0fa3268a-396f-4042-a4c0-a92c23fdf486',
 environmentId:'69b93a87-a91b-4c14-8656-6b0ca3135cee',serviceId:'b053fe9d-716b-49f4-ac24-324c221d054d'};
const actualRead=p=>fs.readFileSync(path.join(root,p),'utf8');
const actualJSON=p=>JSON.parse(actualRead(p));
const canonicalHash=text=>crypto.createHash('sha256').update(text.replace(/\r\n/g,'\n')).digest('hex');
function exactKeys(v,keys){assert.deepEqual(Reflect.ownKeys(v).sort(),keys.slice().sort());}
function inspectActualReview(f,c,source=actualJSON(evidencePath),read=actualRead){
 exactKeys(c,[...Object.keys(template),'offlineReview']);
 for(const key of ['version','historicalLabels','crossSystemForbidden'])assert.deepEqual(c[key],template[key]);
 assert.equal(c.outcome,'PRELIVE_NOT_AUTHORIZED');
 for(const key of ['reviewed','inputReviewComplete','liveAuthorized','manualLiveAuthorization','providerObservationOccurred',
  'targetIdentityProven','executableAcquisitionPrepared','serviceIdentityProven','serviceInstanceIdentityProven'])assert.equal(c[key],false);
 assert.equal(c.reviewedHead,actualHead);assert.equal(c.reviewedBranch,branch);
 assert.deepEqual(c.requiredCodeReview,{reviewedHead:actualHead,reviewedBranch:branch});
 const code=f.auth.verifyCodeIdentity({reviewedHead:c.reviewedHead,reviewedBranch:c.reviewedBranch});
 assert.deepEqual(clone(code),c.codeIdentity);assert.equal(Object.keys(code.sourceHashes).length,12);
 assert.deepEqual(c.codeIdentity.sourceHashes,template.codeIdentity.sourceHashes);
 assert.equal(c.codeIdentity.authorizationBoundarySha256,template.codeIdentity.authorizationBoundarySha256);
 assert.equal(source.reviewed,true);assert.equal(source.evidenceReviewComplete,true);
 assert.equal(source.outcome,'PRELIVE_NOT_AUTHORIZED');
 for(const key of ['liveAuthorized','manualLiveAuthorization','providerObservationOccurred','targetIdentityProven','executableAcquisitionPrepared'])assert.equal(source[key],false);
 const expectedTarget={...clone(template.expectedTarget),...actualValues};
 assert.deepEqual(c.expectedTarget,expectedTarget); // Keeps instance, kind and lifecycle null.
 assert.equal(source.identifiers.serviceInstanceId.value,null);
 exactKeys(c.targetInputSources,ids);
 const prohibited=['xdfmoggrsucisfybqctb','udlsysezmzutydnifhsq','uzkhnslyrhgucijcuoes','thorough-blessing','production','myapp-backend'];
 for(const [field,value]of Object.entries(actualValues)){
  const r=source.identifiers[field];assert.equal(r.field,field);assert.equal(r.provider,'Railway');
  assert.equal(r.value,value);assert.equal(c.expectedTarget[field],r.value);
  assert.equal(prohibited.includes(r.value),false);
  for(const flag of ['independentlyReviewed','contextCompared','authoritativeForInputReview'])assert.equal(r[flag],true);
  assert.equal(r.sourceClassification,'operator_supplied_provider_metadata');
  assert.equal(r.reviewerReference,'AT');assert.doesNotMatch(r.reviewerReference,/railway\s+ai|\bai\s+agent\b/i);
  assert.equal(r.reviewedAt,'2026-10-15T14:01:00.000Z');
  assert.equal(r.acquisitionDate,'2026-10-14');assert.equal(r.acquisitionTimeKnown,false);assert.equal(r.acquiredAt,null);
  assert.equal(r.reviewerDistinctFromAcquirer,true);
  assert.deepEqual(r.labelContext,source.expectedContext);
  assert.deepEqual(c.targetInputSources[field],{independentlyReviewed:true,source:evidencePath+'#identifiers.'+field,reviewer:r.reviewerReference});
 }
 assert.deepEqual(c.targetInputSources.serviceInstanceId,template.targetInputSources.serviceInstanceId);
 // Unknown inventories must stay unknown: null is not an asserted empty list.
 assert.deepEqual(c.forbiddenRailwayInventory,template.forbiddenRailwayInventory);
 assert.deepEqual(c.hostReview,template.hostReview);assert.deepEqual(c.independentReview,template.independentReview);
 const a=c.offlineReview;
 exactKeys(a,['status','targetInputsReviewed','codeIdentityReviewed','forbiddenInputBoundaryReviewed',
  'forbiddenInventoryComplete','executionHostReviewed','readyFor0114DPreparation','sourceEvidence','protectedInputHashes','unresolved']);
 assert.equal(a.status,'INCOMPLETE');
 for(const flag of ['targetInputsReviewed','codeIdentityReviewed','forbiddenInputBoundaryReviewed'])assert.equal(a[flag],true);
 for(const flag of ['forbiddenInventoryComplete','executionHostReviewed','readyFor0114DPreparation'])assert.equal(a[flag],false);
 exactKeys(a.sourceEvidence,['path','commit','sha256']);
 assert.equal(a.sourceEvidence.path,evidencePath);assert.equal(a.sourceEvidence.commit,actualHead);
 assert.equal(a.sourceEvidence.sha256,canonicalHash(read(evidencePath)));
 assert.deepEqual(source,JSON.parse(read(evidencePath)));
 exactKeys(a.protectedInputHashes,protectedInputs);
 for(const file of protectedInputs)assert.equal(a.protectedInputHashes[file],canonicalHash(read(file)),file+' review is stale');
 exactKeys(a.unresolved,['forbiddenInventory','hostChecklist','independentPackageReview','environmentKind','lifecycle']);
 for(const reason of Object.values(a.unresolved))assert.ok(typeof reason==='string'&&reason.length>20);
 // No unreviewed fields or secret-bearing substitutions can enter this candidate.
 assert.doesNotMatch(JSON.stringify(c),/sb_secret_|-----BEGIN|Bearer\s+|https?:\/\/|eyJ[A-Za-z0-9_-]{16,}/);
 return {outcome:c.outcome,inputReviewComplete:false,readyFor0114DPreparation:false,liveAuthorized:false};
}
function actualOffline(t){const f=offline(t);f.drift.head=actualHead;return f;}

test('actual 0114E consumes reviewed AT evidence and current code without assuming readiness',t=>{
 const f=actualOffline(t),c=actualJSON(actualPath),result=inspectActualReview(f,c);
 assert.equal(result.inputReviewComplete,false);assert.equal(result.readyFor0114DPreparation,false);
 for(const [field,value]of Object.entries(actualValues))assert.equal(c.expectedTarget[field],value);
 assert.equal(c.expectedTarget.serviceInstanceId,null);
 assert.equal(c.hostReview.checklist.nodeMajor,null);
 for(const cat of cats){assert.equal(c.forbiddenRailwayInventory[cat].ids,null);assert.equal(c.forbiddenRailwayInventory[cat].completenessAcknowledged,false);}
 // A structural assessment is not a completed worksheet under the existing rules.
 reject(()=>checkWorksheet(f,c));assert.equal(f.records.length,0);
});
for(const flag of ['reviewed','evidenceReviewComplete'])test('actual intake requires source '+flag,t=>{
 const f=actualOffline(t),s=actualJSON(evidencePath);s[flag]=false;reject(()=>inspectActualReview(f,actualJSON(actualPath),s));
});
for(const field of Object.keys(actualValues)){
 for(const [key,value]of [['value','altered-id'],['independentlyReviewed',false],['contextCompared',false],
  ['authoritativeForInputReview',false],['sourceClassification','operator_acquired_not_independently_reviewed'],
  ['reviewerReference','Railway AI'],['reviewedAt',null],['reviewerDistinctFromAcquirer',false]])
 test('actual evidence rejects '+field+' '+key,t=>{
  const f=actualOffline(t),s=actualJSON(evidencePath);s.identifiers[field][key]=value;
  reject(()=>inspectActualReview(f,actualJSON(actualPath),s));
 });
 for(const value of ['altered-id','xdfmoggrsucisfybqctb','udlsysezmzutydnifhsq','uzkhnslyrhgucijcuoes','thorough-blessing','production','myapp-backend'])
 test('actual candidate rejects substitution '+field+' '+value,t=>{
  const f=actualOffline(t),c=actualJSON(actualPath);c.expectedTarget[field]=value;reject(()=>inspectActualReview(f,c));
 });
 for(const key of ['source','reviewer','independentlyReviewed'])test('actual provenance cannot be replaced '+field+' '+key,t=>{
  const f=actualOffline(t),c=actualJSON(actualPath);c.targetInputSources[field][key]=key==='independentlyReviewed'?false:'other';reject(()=>inspectActualReview(f,c));
 });
}
for(const mode of ['candidateInstance','sourceInstance','kind','lifecycle','reviewed','complete','host','inventory','independentReview'])
 test('actual assessment cannot invent missing input or completion '+mode,t=>{
  const f=actualOffline(t),c=actualJSON(actualPath),s=actualJSON(evidencePath);
  if(mode==='candidateInstance')c.expectedTarget.serviceInstanceId='invented-instance';
  if(mode==='sourceInstance')s.identifiers.serviceInstanceId.value='invented-instance';
  if(mode==='kind')c.expectedTarget.environmentKind='disposable';if(mode==='lifecycle')c.expectedTarget.lifecycle='active';
  if(mode==='reviewed')c.reviewed=true;if(mode==='complete')c.inputReviewComplete=true;
  if(mode==='host')c.hostReview.reviewed=true;if(mode==='inventory')c.forbiddenRailwayInventory=inventory();
  if(mode==='independentReview')c.independentReview={reviewed:true,reviewer:'AT',evidenceReference:'invented package review'};
  reject(()=>inspectActualReview(f,c,s));
 });
for(const mode of ['candidateHead','candidateBranch','currentHead','currentBranch','requiredHead','requiredBranch','sourceCommit','selfHash','pinCount'])
 test('actual review rejects stale identity '+mode,t=>{
  const f=actualOffline(t),c=actualJSON(actualPath);
  if(mode==='candidateHead')c.reviewedHead=head;if(mode==='candidateBranch')c.reviewedBranch='other';
  if(mode==='currentHead')f.drift.head=head;if(mode==='currentBranch')f.drift.branch='other';
  if(mode==='requiredHead')c.requiredCodeReview.reviewedHead=head;if(mode==='requiredBranch')c.requiredCodeReview.reviewedBranch='other';
  if(mode==='sourceCommit')c.offlineReview.sourceEvidence.commit=head;
  if(mode==='selfHash')c.codeIdentity.authorizationBoundarySha256='0'.repeat(64);
  if(mode==='pinCount')c.codeIdentity.sourceHashes.extra='0'.repeat(64);
  reject(()=>inspectActualReview(f,c));
 });
for(const file of [...Object.keys(normal.sourceHashes),'qualification-railway-live-authorization.cjs'])
 test('actual code review becomes stale on source change '+file,t=>{
  const f=actualOffline(t);const p=path.join(base,file);f.drift.files.set(p,fs.readFileSync(p,'utf8')+'\n// synthetic drift');
  reject(()=>inspectActualReview(f,actualJSON(actualPath)));
 });
for(const file of protectedInputs)test('actual review becomes stale on protected input change '+file,t=>{
 const f=actualOffline(t),read=p=>actualRead(p)+(p===file?'\n':'');
 reject(()=>inspectActualReview(f,actualJSON(actualPath),actualJSON(evidencePath),read));
});
for(const key of ['liveAuthorized','manualLiveAuthorization','providerObservationOccurred','targetIdentityProven',
 'executableAcquisitionPrepared','serviceIdentityProven','serviceInstanceIdentityProven','credential','token','ticket','context','session','draft'])
 test('actual candidate rejects authority or secret-bearing field '+key,t=>{
  const f=actualOffline(t),c=actualJSON(actualPath);c[key]=true;reject(()=>inspectActualReview(f,c));
 });
test('actual candidate current identity verified by normal local Git only',()=>{
 const c=actualJSON(actualPath);
 assert.deepEqual(clone(normal.verifyCodeIdentity({reviewedHead:c.reviewedHead,reviewedBranch:c.reviewedBranch})),c.codeIdentity);
});
for(const mode of ['evidencePath','evidenceHash','extraProtectedPath'])
 test('actual evidence linkage cannot redirect reads or replace digest '+mode,t=>{
  const f=actualOffline(t),c=actualJSON(actualPath),reads=[];
  if(mode==='evidencePath')c.offlineReview.sourceEvidence.path='0102-remote-fixtures.capsule';
  if(mode==='evidenceHash')c.offlineReview.sourceEvidence.sha256='0'.repeat(64);
  if(mode==='extraProtectedPath')c.offlineReview.protectedInputHashes['0102-remote-fixtures.capsule']='0'.repeat(64);
  const read=p=>{reads.push(p);assert.ok(protectedInputs.includes(p));return actualRead(p);};
  reject(()=>inspectActualReview(f,c,actualJSON(evidencePath),read));
  assert.equal(reads.includes('0102-remote-fixtures.capsule'),false);
 });
test('actual intake preserves safe template and reviewed 0114F bytes from starting HEAD',()=>{
 const cp=require('node:child_process');
 for(const file of ['docs/0114e-acquisition-input-review-template.json',evidencePath]){
  const bytes=cp.execFileSync('git',['-c','safe.directory='+path.resolve(root,'..'),'show',actualHead+':movement-app/'+file],{env:{},windowsHide:true});
  assert.deepEqual(fs.readFileSync(path.join(root,file)),bytes);
 }
});
