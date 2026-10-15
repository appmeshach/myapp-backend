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
// Preserve the previous assessment exactly. Its review inputs were recorded in
// this later commit, while its reviewed code HEAD remains the older actualHead.
const qualificationHead='4f8d8b043f1876e1f4ff3bfa66ef85aa7ffed4e0';
const historicalInputs=new Map();
function historicalRead(p){
 assert.ok(protectedInputs.includes(p));
 if(!historicalInputs.has(p))historicalInputs.set(p,require('node:child_process').execFileSync('git',
  ['-c','safe.directory='+path.resolve(root,'..'),'show',qualificationHead+':movement-app/'+p],{encoding:'utf8',env:{},windowsHide:true}));
 return historicalInputs.get(p);
}
const canonicalHash=text=>crypto.createHash('sha256').update(text.replace(/\r\n/g,'\n')).digest('hex');
function exactKeys(v,keys){assert.deepEqual(Reflect.ownKeys(v).sort(),keys.slice().sort());}
function inspectActualReview(f,c,source=actualJSON(evidencePath),read=historicalRead){
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

test('historical 0114E snapshot consumed reviewed AT evidence without assuming readiness',t=>{
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
 const f=actualOffline(t),read=p=>historicalRead(p)+(p===file?'\n':'');
 reject(()=>inspectActualReview(f,actualJSON(actualPath),actualJSON(evidencePath),read));
});
for(const key of ['liveAuthorized','manualLiveAuthorization','providerObservationOccurred','targetIdentityProven',
 'executableAcquisitionPrepared','serviceIdentityProven','serviceInstanceIdentityProven','credential','token','ticket','context','session','draft'])
 test('actual candidate rejects authority or secret-bearing field '+key,t=>{
  const f=actualOffline(t),c=actualJSON(actualPath);c[key]=true;reject(()=>inspectActualReview(f,c));
 });
test('historical assessment fails current Git identity instead of silently refreshing',()=>{
 const c=actualJSON(actualPath);
 reject(()=>normal.verifyCodeIdentity({reviewedHead:c.reviewedHead,reviewedBranch:c.reviewedBranch}));
 const currentHead=require('node:child_process').execFileSync('git',
  ['-c','safe.directory='+path.resolve(root,'..'),'rev-parse','HEAD'],{encoding:'utf8',env:{},windowsHide:true}).trim();
 const current=normal.verifyCodeIdentity({reviewedHead:currentHead,reviewedBranch:branch});
 assert.deepEqual(current.sourceHashes,c.codeIdentity.sourceHashes);
 assert.equal(c.reviewedHead,actualHead);
});
for(const mode of ['evidencePath','evidenceHash','extraProtectedPath'])
 test('actual evidence linkage cannot redirect reads or replace digest '+mode,t=>{
  const f=actualOffline(t),c=actualJSON(actualPath),reads=[];
  if(mode==='evidencePath')c.offlineReview.sourceEvidence.path='0102-remote-fixtures.capsule';
  if(mode==='evidenceHash')c.offlineReview.sourceEvidence.sha256='0'.repeat(64);
  if(mode==='extraProtectedPath')c.offlineReview.protectedInputHashes['0102-remote-fixtures.capsule']='0'.repeat(64);
  const read=p=>{reads.push(p);assert.ok(protectedInputs.includes(p));return historicalRead(p);};
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

const qualificationPath='docs/0114e-qualification-target-evidence.json';
const qualificationFacts={
 'version':'movement_railway_qualification_target_evidence_v1','outcome':'PRELIVE_NOT_AUTHORIZED',
 'recordingContext.head':qualificationHead,'recordingContext.branch':branch,
 'expectedContext.projectName':'thorough-blessing','expectedContext.environmentName':'qualification',
 'expectedContext.serviceName':'movement-qualification','expectedContext.branch':null,'expectedContext.rootDirectory':null,
 'identifiers.projectId.value':'0fa3268a-396f-4042-a4c0-a92c23fdf486',
 'identifiers.environmentId.value':'9410a813-0429-4bc7-bfbb-d54b85e17c8a',
 'identifiers.serviceId.value':'ef516a68-9bb7-429e-a395-48ef2676593a','identifiers.serviceInstanceId.value':null,
 'projectEvidenceReference.scope':'prior_review_of_unchanged_project_identity_only',
 'projectEvidenceReference.qualificationContextCompared':false,
 'priorAssessment.historicalOnly':true,'priorAssessment.currentForQualification':false,'priorAssessment.requiresNew0114EReview':true,
 'operatorObservations.sourceClassification':'operator_acquired_not_independently_reviewed','operatorObservations.independentlyReviewed':false,
 'operatorObservations.creation.environmentCreated':true,'operatorObservations.creation.createdForQualification':true,
 'operatorObservations.creation.separateFromProduction':true,'operatorObservations.creation.creationMethod':'Empty Environment',
 'operatorObservations.creation.productionDuplicated':false,'operatorObservations.creation.productionVariablesCopied':false,
 'operatorObservations.creation.onlyNewEmptyService':true,
 'operatorObservations.service.created':true,'operatorObservations.service.initialGeneratedName':'athletic-serenity',
 'operatorObservations.service.name':'movement-qualification','operatorObservations.service.renameApplied':true,
 'operatorObservations.service.status':'offline','operatorObservations.service.variablesAdded':false,
 'operatorObservations.service.deploymentAuthorized':false,
 'operatorObservations.productionSafety.autoDeployManuallyDisabled':true,
 'operatorObservations.productionSafety.disabledBeforeQualificationSetup':true,
 'operatorObservations.productionSafety.productionRestarted':false,
 'operatorObservations.productionSafety.previousCrashedQualificationDeploymentRestarted':false,
 'operatorObservations.productionSafety.serviceHealth':null,'operatorObservations.productionSafety.previousRemoteWritesOccurred':null,
 'operatorObservations.productionSafety.logMessage':'Remote qualification unavailable; ENVIRONMENT TEARDOWN REQUIRED if remote writes began',
 'operatorObservations.productionSafety.logMessageIsConditional':true,
 'sourceConfiguration.status':'pending_not_applied','sourceConfiguration.sourceConfigurationApplied':false,
 'sourceConfiguration.applyingWouldRedeploy':true,'sourceConfiguration.activeConfigurationVerified':false,
 'sourceConfiguration.pendingIntended.repo':'appmeshach/myapp-backend',
 'sourceConfiguration.pendingIntended.branch':branch,'sourceConfiguration.pendingIntended.rootDirectory':'/movement-app',
 'sourceConfiguration.appliedConfiguration.repo':null,'sourceConfiguration.appliedConfiguration.branch':null,
 'sourceConfiguration.appliedConfiguration.rootDirectory':null,
 'eligibility.environmentKindIntent':'disposable','eligibility.intentSource':'operator_report',
 'eligibility.independentlyReviewed':true,'eligibility.eligibilityComplete':false,
 'eligibility.environmentKind':'disposable','eligibility.lifecycle':null,
 'eligibility.reviewerReference':'AT','eligibility.reviewedAt':'2026-10-15T18:11:49.000Z',
 'eligibility.reviewReference':'AT independently confirmed qualification is separate from production and movement-qualification belongs to the intended disposable qualification target',
 'qualificationReview.recordingContext.head':'e5e2481781b0861853ab4e5b7eb19a2fe62d1d0b',
 'qualificationReview.recordingContext.branch':branch,
 'qualificationReview.reviewerReference':'AT','qualificationReview.reviewedAt':'2026-10-15T18:11:49.000Z',
 'qualificationReview.reviewerIndependentlyInspectedProvider':true,'qualificationReview.reviewerDistinctFromAcquirer':true,
 'qualificationReview.result':'NO_MISMATCH',
 'qualificationReview.reviewReference':'AT independently inspected Railway and compared exact project environment and service IDs with the qualification context. No mismatch',
 'qualificationReview.reviewedContext.projectName':'thorough-blessing',
 'qualificationReview.reviewedContext.projectId':'0fa3268a-396f-4042-a4c0-a92c23fdf486',
 'qualificationReview.reviewedContext.environmentName':'qualification',
 'qualificationReview.reviewedContext.environmentId':'9410a813-0429-4bc7-bfbb-d54b85e17c8a',
 'qualificationReview.reviewedContext.serviceName':'movement-qualification',
 'qualificationReview.reviewedContext.serviceId':'ef516a68-9bb7-429e-a395-48ef2676593a',
 'qualificationReview.confirmedFacts.separateFromProduction':true,'qualificationReview.confirmedFacts.serviceBelongsToEnvironment':true,
 'qualificationReview.confirmedFacts.intendedDisposableQualificationTarget':true,
 'qualificationReview.confirmedFacts.serviceOffline':true,'qualificationReview.confirmedFacts.sourceSettingsPending':true
};
for(const key of ['reviewed','evidenceReviewComplete','inputReviewComplete','readyFor0114DPreparation','deploymentAuthorized',
 'liveAuthorized','manualLiveAuthorization','providerObservationOccurred','targetIdentityProven','executableAcquisitionPrepared'])qualificationFacts[key]=false;
for(const field of ['environmentId','serviceId']){
 for(const key of ['independentlyReviewed','contextCompared','authoritativeForInputReview'])qualificationFacts['identifiers.'+field+'.'+key]=true;
 for(const key of ['acquiredByReference','acquiredAt'])qualificationFacts['identifiers.'+field+'.'+key]=null;
 qualificationFacts['identifiers.'+field+'.reviewerReference']='AT';
 qualificationFacts['identifiers.'+field+'.reviewedAt']='2026-10-15T18:11:49.000Z';
 qualificationFacts['identifiers.'+field+'.reviewReference']=field==='environmentId'
  ?'AT independently inspected Railway and compared the exact qualification environment ID and intended context. No mismatch'
  :'AT independently inspected Railway and compared the exact movement-qualification service ID and intended context. No mismatch';
 qualificationFacts['identifiers.'+field+'.sourceClassification']='operator_supplied_provider_metadata';
 qualificationFacts['identifiers.'+field+'.sourceKind']='operator_visible_provider_metadata';
}
Object.assign(qualificationFacts,{
 'identifiers.environmentId.sourceSurface':'identifier_query_parameter',
 'identifiers.environmentId.sourceParameterName':'environmentId',
 'identifiers.serviceId.sourceSurface':'identifier_url_path_segment',
 'identifiers.serviceId.sourceParameterName':null,
 'projectEvidenceReference.operatorSource.sourceSurface':'identifier_url_path_segment',
 'projectEvidenceReference.operatorSource.sourceParameterName':null,
 'projectEvidenceReference.operatorSource.sourceReference':'Operator-supplied typed project path segment for thorough-blessing with qualification selected',
 'projectEvidenceReference.operatorSource.independentlyReviewed':false
});
const getFact=(c,p)=>p.split('.').reduce((v,k)=>v[k],c);
function inspectQualificationSurface(r,field){
 assert.ok(['identifier_field','copy_identifier_control','identifier_url_path_segment','identifier_query_parameter'].includes(r.sourceSurface));
 if(r.sourceSurface==='identifier_query_parameter'){
  assert.equal(field,'environmentId');assert.equal(r.sourceParameterName,'environmentId');
 }else assert.equal(r.sourceParameterName,null);
}
function inspectQualificationEvidence(c){
 exactKeys(c,['version','outcome','reviewed','evidenceReviewComplete','inputReviewComplete','readyFor0114DPreparation',
  'deploymentAuthorized','liveAuthorized','manualLiveAuthorization','providerObservationOccurred','targetIdentityProven',
  'executableAcquisitionPrepared','recordingContext','expectedContext','identifiers','projectEvidenceReference','priorAssessment',
  'operatorObservations','sourceConfiguration','eligibility','qualificationReview']);
 for(const [p,value]of Object.entries(qualificationFacts))assert.deepEqual(getFact(c,p),value,p);
 for(const p of ['recordingContext','expectedContext','operatorObservations','operatorObservations.creation',
  'operatorObservations.service','operatorObservations.productionSafety','sourceConfiguration',
  'sourceConfiguration.pendingIntended','sourceConfiguration.appliedConfiguration','eligibility','qualificationReview',
  'qualificationReview.recordingContext','qualificationReview.reviewedContext','qualificationReview.confirmedFacts']){
  const keys=[...new Set(Object.keys(qualificationFacts).filter(k=>k.startsWith(p+'.')).map(k=>k.slice(p.length+1).split('.')[0]))];
  exactKeys(getFact(c,p),keys);
 }
 const historical=actualJSON(evidencePath);
 assert.deepEqual(c.identifiers.projectId,historical.identifiers.projectId);
 assert.equal(historical.reviewed,true);assert.equal(historical.evidenceReviewComplete,true);
 assert.equal(historical.identifiers.environmentId.value,'69b93a87-a91b-4c14-8656-6b0ca3135cee');
 assert.equal(historical.identifiers.serviceId.value,'b053fe9d-716b-49f4-ac24-324c221d054d');
 assert.deepEqual(c.projectEvidenceReference,{path:evidencePath,record:'identifiers.projectId',
  commit:'72ba10ec5a058d234749d177cc4d70ad07761faa',sha256:canonicalHash(actualRead(evidencePath)),
  scope:'prior_review_of_unchanged_project_identity_only',qualificationContextCompared:false,
  operatorSource:{sourceSurface:'identifier_url_path_segment',sourceParameterName:null,
   sourceReference:'Operator-supplied typed project path segment for thorough-blessing with qualification selected',independentlyReviewed:false}});
 inspectQualificationSurface(c.projectEvidenceReference.operatorSource,'projectId');
 assert.deepEqual(c.priorAssessment,{path:actualPath,snapshotCommit:qualificationHead,sha256:canonicalHash(actualRead(actualPath)),
  historicalOnly:true,currentForQualification:false,requiresNew0114EReview:true});
 const fSafe=actualJSON('docs/0114f-target-metadata-evidence-template.json');
 exactKeys(c.identifiers,ids);
 for(const field of ['environmentId','serviceId','serviceInstanceId']){
  const r=c.identifiers[field];exactKeys(r,Object.keys(fSafe.identifiers[field]));
  assert.equal(r.field,field);assert.equal(r.provider,'Railway');assert.deepEqual(r.labelContext,c.expectedContext);
  if(field==='serviceInstanceId')assert.deepEqual(r,{...fSafe.identifiers[field],labelContext:c.expectedContext});
  else{
   inspectQualificationSurface(r,field);
   assert.match(r.value,/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
   for(const key of ['sourceReference','acquisitionReference'])assert.match(r[key],/^[A-Za-z0-9][A-Za-z0-9 ._:/()-]{0,255}$/);
  }
 }
 assert.doesNotMatch(JSON.stringify(c),/https?:\/\/|[?#]|environmentId=|sb_secret_|-----BEGIN|Bearer\s+|eyJ[A-Za-z0-9_-]{16,}/);
 return {reviewed:false,inputReviewComplete:false,readyFor0114DPreparation:false};
}
for(const [p,value]of Object.entries(qualificationFacts))test('qualification operator evidence preserves '+p,t=>{
 const f=offline(t),c=actualJSON(qualificationPath);assert.deepEqual(getFact(c,p),value);inspectQualificationEvidence(c);
 assert.equal(f.records.length,0);
});
for(const p of [
 'identifiers.projectId.value','identifiers.environmentId.value','identifiers.serviceId.value','identifiers.serviceInstanceId.value',
 'identifiers.environmentId.independentlyReviewed','identifiers.serviceId.independentlyReviewed',
 'identifiers.environmentId.authoritativeForInputReview','identifiers.serviceId.authoritativeForInputReview',
 'identifiers.environmentId.contextCompared','identifiers.serviceId.contextCompared',
 'identifiers.environmentId.reviewerReference','identifiers.serviceId.reviewedAt','identifiers.environmentId.reviewReference',
 'sourceConfiguration.sourceConfigurationApplied','sourceConfiguration.activeConfigurationVerified',
 'sourceConfiguration.appliedConfiguration.repo','sourceConfiguration.appliedConfiguration.branch','sourceConfiguration.appliedConfiguration.rootDirectory',
 'operatorObservations.productionSafety.previousRemoteWritesOccurred','eligibility.eligibilityComplete','eligibility.lifecycle',
 'reviewed','inputReviewComplete','readyFor0114DPreparation','deploymentAuthorized','liveAuthorized','manualLiveAuthorization',
 'providerObservationOccurred','targetIdentityProven','executableAcquisitionPrepared'
])test('qualification evidence rejects authority transfer or invented fact '+p,t=>{
 offline(t);const c=actualJSON(qualificationPath),parts=p.split('.'),key=parts.pop();
 const parent=parts.reduce((v,k)=>v[k],c);parent[key]=typeof parent[key]==='boolean'?!parent[key]:'invented';
 reject(()=>inspectQualificationEvidence(c));
});
test('production evidence, safe worksheet and historical incomplete assessment remain byte-identical',t=>{
 offline(t);const cp=require('node:child_process');
 for(const file of [evidencePath,'docs/0114e-acquisition-input-review-template.json',actualPath]){
  const old=cp.execFileSync('git',['-c','safe.directory='+path.resolve(root,'..'),'show',qualificationHead+':movement-app/'+file],{env:{},windowsHide:true});
  assert.deepEqual(fs.readFileSync(path.join(root,file)),old);
 }
});
test('historical assessment is stale against changed worktree inputs and new qualification facts',t=>{
 const f=actualOffline(t);reject(()=>inspectActualReview(f,actualJSON(actualPath),actualJSON(evidencePath),actualRead));
 reject(()=>inspectActualReview(f,actualJSON(qualificationPath)));
});
for(const field of ['serviceId','projectId'])test('qualification query source cannot identify '+field,t=>{
 offline(t);const r={sourceSurface:'identifier_query_parameter',sourceParameterName:'environmentId'};
 reject(()=>inspectQualificationSurface(r,field));
 const c=actualJSON(qualificationPath);
 if(field==='projectId')Object.assign(c.projectEvidenceReference.operatorSource,r);
 else Object.assign(c.identifiers[field],r);
 reject(()=>inspectQualificationEvidence(c));
});
for(const name of ['projectId','serviceId','foo','EnvironmentId','environment',null])
 test('qualification environment query name must be exact '+name,t=>{
  offline(t);const c=actualJSON(qualificationPath);c.identifiers.environmentId.sourceParameterName=name;
  reject(()=>inspectQualificationSurface(c.identifiers.environmentId,'environmentId'));
  reject(()=>inspectQualificationEvidence(c));
 });
for(const field of ['environmentId','serviceId','projectId'])
 for(const text of ['https://invalid.example/path','?environmentId=synthetic','environmentId=synthetic','#fragment'])
 test('qualification source description rejects raw URL query or fragment '+field+' '+text.split(/[?=#]/)[0],t=>{
  offline(t);const c=actualJSON(qualificationPath);
  const r=field==='projectId'?c.projectEvidenceReference.operatorSource:c.identifiers[field];
  r.sourceReference=text;reject(()=>inspectQualificationEvidence(c));
 });
test('qualification evidence stores only extracted IDs and inert source descriptions',t=>{
 offline(t);const c=actualJSON(qualificationPath);inspectQualificationEvidence(c);
 assert.doesNotMatch(actualRead(qualificationPath),/https?:\/\/|[?#]|environmentId=/);
 assert.deepEqual(c.identifiers.projectId,actualJSON(evidencePath).identifiers.projectId);
 for(const field of ['environmentId','serviceId']){
  const r=c.identifiers[field];for(const flag of ['independentlyReviewed','authoritativeForInputReview','contextCompared'])assert.equal(r[flag],true);
  assert.equal(r.reviewerReference,'AT');assert.equal(r.reviewedAt,'2026-10-15T18:11:49.000Z');assert.ok(r.reviewReference);
 }
});
for(const path of ['identifiers.environmentId','identifiers.serviceId','eligibility'])
 for(const [key,value]of [['reviewerReference','Railway AI'],['reviewerReference',null],
  ['reviewedAt',null],['reviewedAt','2026-10-15T14:01:00.000Z'],['reviewedAt','2026-10-15T18:11:48.000Z'],
  ['reviewReference',null],['reviewReference',''],['independentlyReviewed',false]])
 test('new qualification human review rejects '+path+' '+key+' '+JSON.stringify(value),t=>{
  offline(t);const c=actualJSON(qualificationPath);getFact(c,path)[key]=value;reject(()=>inspectQualificationEvidence(c));
 });
for(const field of ['environmentId','serviceId'])test('qualification review is separate from historical production review '+field,t=>{
 offline(t);const c=actualJSON(qualificationPath),old=actualJSON(evidencePath).identifiers[field];
 assert.notEqual(c.identifiers[field].value,old.value);assert.notEqual(c.identifiers[field].reviewedAt,old.reviewedAt);
 c.identifiers[field]=clone(old);reject(()=>inspectQualificationEvidence(c));
});
for(const key of ['reviewerIndependentlyInspectedProvider','reviewerDistinctFromAcquirer'])
 test('qualification human review requires explicit independence '+key,t=>{
  offline(t);const c=actualJSON(qualificationPath);c.qualificationReview[key]=false;reject(()=>inspectQualificationEvidence(c));
 });
test('historical project and operator source are untouched by new qualification review',t=>{
 offline(t);const cp=require('node:child_process');
 const old=JSON.parse(cp.execFileSync('git',['-c','safe.directory='+path.resolve(root,'..'),'show',
  'e5e2481781b0861853ab4e5b7eb19a2fe62d1d0b:movement-app/'+qualificationPath],{encoding:'utf8',env:{},windowsHide:true}));
 const c=actualJSON(qualificationPath);
 assert.deepEqual(c.identifiers.projectId,old.identifiers.projectId);assert.deepEqual(c.projectEvidenceReference,old.projectEvidenceReference);
 assert.deepEqual(c.sourceConfiguration,old.sourceConfiguration);assert.deepEqual(c.identifiers.serviceInstanceId,old.identifiers.serviceInstanceId);
 assert.equal(c.eligibility.environmentKind,'disposable');assert.equal(c.eligibility.independentlyReviewed,true);
 assert.equal(c.eligibility.lifecycle,null);assert.equal(c.eligibility.eligibilityComplete,false);
 assert.equal(c.reviewed,false);assert.equal(c.evidenceReviewComplete,false);assert.equal(c.inputReviewComplete,false);
});
