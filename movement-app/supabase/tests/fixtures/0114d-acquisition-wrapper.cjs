'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const base=path.resolve(__dirname,'../../../scripts/assessment-worker');
const names={auth:'qualification-railway-live-authorization.cjs',wrapper:'qualification-railway-acquisition-wrapper.cjs',identity:'qualification-railway-target-identity.cjs',adapter:'qualification-railway-https-adapter.cjs',targets:'qualification-railway-introspection-target.cjs'};
const clone=v=>JSON.parse(JSON.stringify(v));
const categories=['projectIds','environmentIds','serviceIds','serviceInstanceIds'];
const inventory=()=>({inventoryReviewed:true,basis:'synthetic reviewed safety policy',provenance:'synthetic independently reviewed metadata',
 ...Object.fromEntries(categories.map(k=>[k,{reviewed:true,completenessAcknowledged:true,completenessIsOperatorAssertion:true,ids:[],labels:[]}]))});
const historicalArchive=new Map();
function loadAcquisition(driver={}) {
 const cache=new Map(),records=[],calls=[],reads=[],opens=[],sessions=[],trace=[],timers=new Map();let hostInit=null,hostToken=null,inputSequence=0;
 const readSource=(p,enc)=>{if(!driver.historicalCommit||path.dirname(p)!==base)return fs.readFileSync(p,enc);const archiveKey=driver.historicalCommit+':'+p;if(!historicalArchive.has(archiveKey))historicalArchive.set(archiveKey,require('node:child_process').execFileSync('git',['-c','safe.directory='+path.resolve(base,'../../..'),'show',driver.historicalCommit+':movement-app/scripts/assessment-worker/'+path.basename(p)],{encoding:'utf8',env:{},windowsHide:true}));return historicalArchive.get(archiveKey);};
 const drift={head:'a'.repeat(40),branch:'feature/0092-shared-segment-suitability',files:new Map()};let now=Date.now(),mono=0,wrapperOverride=null;
 const TestDate=class extends Date{static now(){return now;}};
 class CapturedWeakMap extends WeakMap{set(k,v){records.push({key:k,value:v});return super.set(k,v);}}
 const env=new Proxy({RAILWAY_TOKEN:'synthetic-private-credential'},{get(t,k){reads.push(k);return t[k];}});
 const bodyFor=name=>name==='Movement0108ProjectTokenContext'?{data:{projectToken:{projectId:'synthetic-project',environmentId:'synthetic-env'}}}:
   name==='Movement0111ProjectServices'?{data:{project:{id:'synthetic-project',services:{edges:[{node:{id:'synthetic-service',name:driver.serviceName??'myapp-backend'}}],pageInfo:{hasNextPage:false}}}}}:
   {data:{serviceInstance:{id:'synthetic-instance',serviceName:driver.serviceName??'myapp-backend',rootDirectory:'/movement-app',region:null}}};
 const https={request(options,callback){
  const call={options,request:null,destroyed:false};calls.push(call);if(driver.traceNative)trace.push('nativeRequest');const req=new EventEmitter();
  req.destroy=()=>{call.destroyed=true;};req.end=text=>{
   call.request=JSON.parse(text);trace.push(call.request.operationName);
   const respond=()=>{if(call.destroyed)return;if(driver.errorOperation===call.request.operationName){req.emit('error',Error('synthetic raw error'));return;}
    const res=new EventEmitter();res.statusCode=driver.redirectOperation===call.request.operationName?302:200;
    res.headers={'content-type':'application/json'};res.rawHeaders=['Content-Type','application/json'];res.destroy=()=>{call.destroyed=true;};
    callback(res);if(call.destroyed)return;
    res.emit('data',Buffer.from(JSON.stringify(driver.bodies?.[call.request.operationName]??bodyFor(call.request.operationName))));res.emit('end');res.emit('close');};
   call.respond=respond;if(driver.holdOperation!==call.request.operationName)queueMicrotask(respond);
  };return req;
 }};
 function load(key){
  if(cache.has(key))return cache.get(key).exports;
  const module={exports:{}};cache.set(key,module);
  let source=readSource(path.join(base,key),'utf8');
  if(key===names.adapter&&driver.traceFence)source=source.replace("if(record.lifecycle)dispatchFence(record.lifecycle.carrier,operationName);","recordFence(operationName);\n   if(record.lifecycle)dispatchFence(record.lifecycle.carrier,operationName);");
  if(key===names.auth)source=source.replace('if (args.length !== 1 || canonical(verifyCodeIdentity(e.reviewedCode)) !== canonical(e.codeIdentity) ||',
   "recordRedemption();\n if (args.length !== 1 || canonical(verifyCodeIdentity(e.reviewedCode)) !== canonical(e.codeIdentity) ||");
  vm.runInNewContext(source,{module,Buffer,WeakMap:CapturedWeakMap,Date:TestDate,__dirname:base,__filename:path.join(base,key),process:{env},
   recordRedemption(){trace.push('redeemAcquisitionTicketForWrapper');if(driver.fail==='redeemAcquisitionTicketForWrapper')throw Error('Synthetic after burn');},
   recordFence(operationName){trace.push('fence:'+operationName);if(driver.failFence===operationName){now+=1900000;mono+=1900000;}},
   setTimeout(fn,ms){const h={};timers.set(h,{fn,ms,due:now+ms});return h;},clearTimeout(h){timers.delete(h);},
   require(name){
    if(name==='node:https')return https;
    if(name==='node:perf_hooks')return{performance:{now:()=>mono}};
    if(name==='node:util')return{TextDecoder:require('node:util').TextDecoder,debuglog:()=>({enabled:false})};
    if(name==='node:fs')return{existsSync:fs.existsSync,realpathSync:p=>path.resolve(p),readFileSync:(p,enc)=>drift.files.has(p)?drift.files.get(p):readSource(p,enc),
     openSync:p=>({data:Buffer.from(drift.files.has(p)?drift.files.get(p):readSource(p)),offset:0}),fstatSync:()=>({isFile:()=>true}),
     readSync:(h,buffer,offset,length)=>{const count=Math.min(length,h.data.length-h.offset);if(count>0)h.data.copy(buffer,offset,h.offset,h.offset+count);h.offset+=count;return count;},closeSync:()=>{}};
    if(name==='node:child_process')return{execFileSync(command,args,options){
     assert.equal(command,'git');assert.deepEqual(Object.keys(options.env),[]);
     const action=args.slice(2).join(' ');if(action==='rev-parse HEAD')return drift.head;if(action==='branch --show-current')return drift.branch;assert.fail('Unexpected subprocess');
    }};
    if(name==='./qualification-railway-acquisition-owner-host.cjs')return Object.freeze(Object.defineProperty(Object.create(null),'_connectAuthorizationOwner',{value(init){hostInit=init;hostToken=Object.freeze({});return hostToken;}}));
    if(name.startsWith('./')){if(name.slice(2)===names.identity&&driver.ownerReplacement)return {};if(name.slice(2)===names.wrapper&&wrapperOverride)return wrapperOverride;return load(name.slice(2));}return require(name);
   }},{filename:path.join(base,key)});
  const api=module.exports;
  function wrap(method){
   const invoke=api[method];
   return(...args)=>{trace.push(method);if(driver.fail===method)throw Error('synthetic internal error');
    const result=invoke(...args);

    if(method==='openExecutionContext')opens.push(result);if(method==='startTargetIdentitySession')sessions.push(result);
    if(method==='closeExecutionContext'&&driver.closeAfterFailure)throw Error('synthetic close failure');return result;};
  }
  const methods=key===names.identity?['startTargetIdentitySession','acceptContextObservation','acceptIdentityObservation','reviewObservedServiceCandidate','approveObservedServiceCandidate','reviewTargetCandidate','approveTargetCandidate','inspectSession']:
   key===names.adapter?['openExecutionContext','closeExecutionContext']:[];
  if(methods.length){const wrapped=Object.fromEntries(methods.map(m=>[m,wrap(m)]));if(!Object.isFrozen(api))Object.assign(api,wrapped);else module.exports=Object.freeze({...api,...wrapped});}
  return module.exports;
 }
 const auth=load(names.auth),identity=load(names.identity),adapter=load(names.adapter),targets=load(names.targets),wrapper=load(names.wrapper);
 if(hostInit)hostInit.enable(hostToken);
 const scope={environmentKind:'disposable',lifecycle:'active',projectId:'synthetic-project',environmentId:'synthetic-env',serviceId:'synthetic-service',serviceInstanceId:driver.expectedInstanceId??null};
 const binding=()=>targets.bindTarget(scope,scope,{inventoryReviewed:true,...Object.fromEntries(categories.map(k=>[k,[]]))});
 function input(target,name=driver.serviceName??'myapp-backend',forbidden=inventory()){
  const crypto=require('node:crypto'),hash=s=>crypto.createHash('sha256').update(s.replace(/\r\n/g,'\n')).digest('hex');
  const c=JSON.parse(fs.readFileSync(path.join(base,'../../docs/0114e-acquisition-input-review-template.json'),'utf8'));
  c.version='movement_railway_acquisition_input_review_v3';c.reviewed=true;c.inputReviewComplete=true;
  c.reviewedHead=drift.head;c.reviewedBranch=drift.branch;c.requiredCodeReview={reviewedHead:drift.head,reviewedBranch:drift.branch};
  c.codeIdentity=clone(auth.verifyCodeIdentity(c.requiredCodeReview));
  Object.assign(c.expectedTarget,clone(targets.describeTarget(target)),{serviceName:name});
  delete c.expectedTarget.constraintCategory;delete c.expectedTarget.targetSha256;delete c.expectedTarget.independentlyAuthoritative;delete c.expectedTarget.identity_proven;
  c.targetInputSources.serviceName={independentlyReviewed:true,source:'synthetic reviewed name and ID',reviewer:'synthetic independent reviewer'};
  for(const k of ['projectId','environmentId','serviceId','serviceInstanceId'])if(c.expectedTarget[k]!==null)c.targetInputSources[k]={independentlyReviewed:true,source:'synthetic reviewed metadata',reviewer:'synthetic independent reviewer'};
  c.forbiddenRailwayInventory=clone(forbidden);c.hostReview={reviewed:true,reviewer:'synthetic host reviewer',checklist:{nodeMajor:24,...Object.fromEntries(Object.keys(c.hostReview.checklist).filter(k=>k!=='nodeMajor').map(k=>[k,true]))}};
  c.independentReview={reviewed:true,reviewer:'synthetic package reviewer',evidenceReference:'synthetic package review'};
  const facts={qualificationReview:{result:'NO_MISMATCH',reviewerIndependentlyInspectedProvider:true,reviewerDistinctFromAcquirer:true,reviewerReference:'synthetic reviewer',reviewedContext:Object.fromEntries(['projectId','environmentId','serviceId','serviceName'].map(k=>[k,c.expectedTarget[k]]))},identifiers:Object.fromEntries(['projectId','environmentId','serviceId'].map(k=>[k,{value:c.expectedTarget[k]}]))};
  const evidenceText=JSON.stringify(facts)+'\n',evidencePath='docs/0114e-qualification-target-evidence.json';
  c.evidenceBinding={path:evidencePath,sha256:hash(evidenceText),record:'qualificationReview.reviewedContext'};
  const policyPath='docs/0114i-qualification-lifecycle-policy-design.md',policyText=readSource(path.join(base,'../..',policyPath),'utf8').replace(/\r\n/g,'\n');
  const ref={path:evidencePath,sha256:hash(evidenceText),record:'qualificationReview.reviewedContext'};
  const lifecyclePath='docs/0114i-lifecycle-reviews/synthetic-review.json';c.lifecycleReview={path:lifecyclePath,sha256:null};
  const subject=clone(c);delete subject.lifecycleReview;
  const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
  const reviewedAt=new Date(now).toISOString(),record={version:'movement_railway_qualification_lifecycle_review_v1',policy:{path:policyPath,sha256:hash(policyText)},
   attemptReference:'synthetic-attempt-reference-'+(++inputSequence),subjectSha256:hash(canonical(subject)),target:{projectId:c.expectedTarget.projectId,environmentId:c.expectedTarget.environmentId,
    serviceId:c.expectedTarget.serviceId,serviceName:c.expectedTarget.serviceName,serviceInstanceId:c.expectedTarget.serviceInstanceId,environmentKind:c.expectedTarget.environmentKind},
   operator:{reference:'synthetic operator',assertedAt:new Date(now).toISOString(),allocationEvidence:[ref],acknowledgements:{hasAllocationAuthority:true,targetCreated:true,currentlyAllocated:true,reservedForAttempt:true,notProduction:true,notRetired:true,notDecommissioned:true,notKnownDeleted:true,noIncompatibleUse:true,noUnresolvedTeardown:true,notConsumedUnderApplicablePolicy:true,noKnownRelevantChange:true}},
   evidence:{identity:[ref],disposable:[ref],inventory:[ref],observations:[],newProviderObservationOccurred:false},
   review:{reviewerReference:'synthetic independent reviewer',independentlyReviewed:true,result:'NO_MISMATCH',reviewedAt,evidenceReference:'synthetic lifecycle review',acceptance:{factsAccepted:true,identityBindingAccepted:true,inventoryAccepted:true,policyMappingAccepted:true}},
   validity:{expiresAt:new Date(Date.parse(reviewedAt)+1800000).toISOString(),value:'active',scope:'one_package_one_attempt'}};
  const lifecycleText=JSON.stringify(record)+'\n';c.lifecycleReview.sha256=hash(lifecycleText);drift.files.set(path.join(base,'../..',lifecyclePath),lifecycleText);
  const packageText=JSON.stringify(c)+'\n',packagePath='docs/0114e-current-acquisition-input-review.json';
  drift.files.set(path.join(base,'../..',evidencePath),evidenceText);drift.files.set(path.join(base,'../..',packagePath),packageText);
  return {descriptor:{path:packagePath,sha256:hash(packageText)},package:c,facts,record,lifecyclePath:path.join(base,'../..',lifecyclePath),packagePath:path.join(base,'../..',packagePath),evidencePath:path.join(base,'../..',evidencePath)};
 }
 function reviewed(){
  const forbidden=inventory();if(driver.forbiddenInstance)forbidden.serviceInstanceIds.ids=[driver.forbiddenInstance];
  const target=binding(),inputs=input(target,undefined,forbidden),draft=auth.createExecutableAcquisitionDraft(target,forbidden,{reviewedHead:drift.head,reviewedBranch:drift.branch},inputs.descriptor);
  const review=auth.reviewExecutableAcquisitionPackage(draft),ack={reviewed:true,manifest:clone(review.manifest),manifestSha256:review.manifestSha256,
   contextReview:{reviewed:true,...clone(review.contextReviewMetadata)},hostChecklist:{nodeMajor:24,...Object.fromEntries(review.hostAttestationKeys.filter(k=>k!=='nodeMajor').map(k=>[k,true]))}};
  const approved=auth.approveExecutableAcquisitionPackageReview(review,target,ack);return{target,draft,review,ack,approved,inputs};
 }
 function authorized(){const f=reviewed(),finalAck={...clone(f.approved.finalAcknowledgementTemplate),manualLiveAuthorization:true};
  const ticket=auth.authorizeAcquisition(f.draft,f.target,finalAck);return{...f,finalAck,ticket};}
 const run=h=>records.find(r=>r.key===h&&Object.hasOwn(r.value,'terminal'))?.value;
 async function pending(h,stage){for(let i=0;i<100;i++){const e=run(h);if(e?.terminal)throw Error('Synthetic acquisition terminated');if(e?.review&&e.phase===stage)return wrapper.takePendingHumanReview(h);await Promise.resolve();}throw Error('Synthetic prompt not reached');}
 return{auth,identity,adapter,wrapper,targets,binding,input,reviewed,authorized,drift,driver,records,calls,reads,opens,sessions,trace,timers,run,pending,
  replaceWrapper(value){wrapperOverride=value;},
  contextRecord:c=>records.find(r=>r.key===c&&Object.hasOwn(r.value,'secret'))?.value,
  clock(){return{now,mono};},setUtc(value){now=value;},setMono(value){mono=value;},fireTimer(timer){for(const[h,t]of timers)if(t===timer)timers.delete(h);timer.fn();},
  advance(ms){now+=ms;mono+=ms;for(const[h,t]of[...timers])if(t.due<=now){timers.delete(h);t.fn();}},elapse(ms){now+=ms;mono+=ms;},
  advanceUtc(ms){now+=ms;},advanceMono(ms){mono+=ms;},rewindUtc(ms){now-=ms;mono+=1;}};
}
const serviceAck=p=>({...clone(p.review),reviewed:true});
const targetAck=p=>({reviewed:true,candidate:clone(p.review.candidate),candidateSha256:p.review.candidateSha256,inventorySha256:p.inventoryReview.inventorySha256,noForbiddenCollision:true,intendedDisposableNonProduction:true});
module.exports={loadAcquisition,clone,inventory,serviceAck,targetAck};
