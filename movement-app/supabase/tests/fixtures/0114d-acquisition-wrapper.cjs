'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const base=path.resolve(__dirname,'../../../scripts/assessment-worker');
const names={auth:'qualification-railway-live-authorization.cjs',wrapper:'qualification-railway-acquisition-wrapper.cjs',identity:'qualification-railway-target-identity.cjs',adapter:'qualification-railway-https-adapter.cjs',targets:'qualification-railway-introspection-target.cjs'};
const clone=v=>JSON.parse(JSON.stringify(v));
const categories=['projectIds','environmentIds','serviceIds','serviceInstanceIds'];
const inventory=()=>({inventoryReviewed:true,basis:'synthetic reviewed safety policy',provenance:'synthetic independently reviewed metadata',
 ...Object.fromEntries(categories.map(k=>[k,{reviewed:true,completenessAcknowledged:true,completenessIsOperatorAssertion:true,ids:[],labels:[]}]))});
function loadAcquisition(driver={}) {
 const cache=new Map(),records=[],calls=[],reads=[],opens=[],sessions=[],trace=[],timers=new Map();
 const drift={head:'a'.repeat(40),branch:'feature/0092-shared-segment-suitability',files:new Map()};let now=0,wrapperOverride=null;
 class CapturedWeakMap extends WeakMap{set(k,v){records.push({key:k,value:v});return super.set(k,v);}}
 const env=new Proxy({RAILWAY_TOKEN:'synthetic-private-credential'},{get(t,k){reads.push(k);return t[k];}});
 const bodyFor=name=>name==='Movement0108ProjectTokenContext'?{data:{projectToken:{projectId:'synthetic-project',environmentId:'synthetic-env'}}}:
  name==='Movement0111ProjectServices'?{data:{project:{id:'synthetic-project',services:{edges:[{node:{id:'synthetic-service',name:'myapp-backend'}}],pageInfo:{hasNextPage:false}}}}}:
  {data:{serviceInstance:{id:'synthetic-instance',serviceName:'myapp-backend',rootDirectory:'/movement-app',region:null}}};
 const https={request(options,callback){
  const call={options,request:null,destroyed:false};calls.push(call);const req=new EventEmitter();
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
  let source=fs.readFileSync(path.join(base,key),'utf8');
  if(key===names.auth)source=source.replace('if (args.length !== 1 || canonical(verifyCodeIdentity(e.reviewedCode)) !== canonical(e.codeIdentity) ||',
   "recordRedemption();\n if (args.length !== 1 || canonical(verifyCodeIdentity(e.reviewedCode)) !== canonical(e.codeIdentity) ||");
  vm.runInNewContext(source,{module,Buffer,WeakMap:CapturedWeakMap,__dirname:base,__filename:path.join(base,key),process:{env},
   recordRedemption(){trace.push('redeemAcquisitionTicketForWrapper');if(driver.fail==='redeemAcquisitionTicketForWrapper')throw Error('Synthetic after burn');},
   setTimeout(fn,ms){const h={};timers.set(h,{fn,ms,due:now+ms});return h;},clearTimeout(h){timers.delete(h);},
   require(name){
    if(name==='node:https')return https;
    if(name==='node:perf_hooks')return{performance:{now:()=>now}};
    if(name==='node:util')return{TextDecoder:require('node:util').TextDecoder,debuglog:()=>({enabled:false})};
    if(name==='node:fs')return{existsSync:fs.existsSync,readFileSync:(p,enc)=>drift.files.has(p)?drift.files.get(p):fs.readFileSync(p,enc)};
    if(name==='node:child_process')return{execFileSync(command,args,options){
     assert.equal(command,'git');assert.deepEqual(Object.keys(options.env),[]);
     const action=args.slice(2).join(' ');if(action==='rev-parse HEAD')return drift.head;if(action==='branch --show-current')return drift.branch;assert.fail('Unexpected subprocess');
    }};
    if(name.startsWith('./')){if(name.slice(2)===names.wrapper&&wrapperOverride)return wrapperOverride;return load(name.slice(2));}return require(name);
   }},{filename:path.join(base,key)});
  const api=module.exports;
  function wrap(method){
   return(...args)=>{trace.push(method);if(driver.fail===method)throw Error('synthetic internal error');
    const result=api[method](...args);

    if(method==='openExecutionContext')opens.push(result);if(method==='startTargetIdentitySession')sessions.push(result);
    if(method==='closeExecutionContext'&&driver.closeAfterFailure)throw Error('synthetic close failure');return result;};
  }
  const methods=key===names.identity?['startTargetIdentitySession','acceptContextObservation','acceptIdentityObservation','reviewObservedServiceCandidate','approveObservedServiceCandidate','reviewTargetCandidate','approveTargetCandidate','inspectSession']:
   key===names.adapter?['openExecutionContext','closeExecutionContext']:[];
  if(methods.length)module.exports=Object.freeze({...api,...Object.fromEntries(methods.map(m=>[m,wrap(m)]))});
  return module.exports;
 }
 const auth=load(names.auth),identity=load(names.identity),adapter=load(names.adapter),targets=load(names.targets),wrapper=load(names.wrapper);
 const scope={environmentKind:'disposable',lifecycle:'active',projectId:'synthetic-project',environmentId:'synthetic-env',serviceId:'synthetic-service',serviceInstanceId:null};
 const binding=()=>targets.bindTarget(scope,scope,{inventoryReviewed:true,...Object.fromEntries(categories.map(k=>[k,[]]))});
 function reviewed(){
  const forbidden=inventory();if(driver.forbiddenInstance)forbidden.serviceInstanceIds.ids=[driver.forbiddenInstance];
  const target=binding(),draft=auth.createExecutableAcquisitionDraft(target,forbidden,{reviewedHead:drift.head,reviewedBranch:drift.branch});
  const review=auth.reviewExecutableAcquisitionPackage(draft),ack={reviewed:true,manifest:clone(review.manifest),manifestSha256:review.manifestSha256,
   contextReview:{reviewed:true,...clone(review.contextReviewMetadata)},hostChecklist:{nodeMajor:24,...Object.fromEntries(review.hostAttestationKeys.filter(k=>k!=='nodeMajor').map(k=>[k,true]))}};
  const approved=auth.approveExecutableAcquisitionPackageReview(review,target,ack);return{target,draft,review,ack,approved};
 }
 function authorized(){const f=reviewed(),finalAck={...clone(f.approved.finalAcknowledgementTemplate),manualLiveAuthorization:true};
  const ticket=auth.authorizeAcquisition(f.draft,f.target,finalAck);return{...f,finalAck,ticket};}
 const run=h=>records.find(r=>r.key===h&&Object.hasOwn(r.value,'terminal'))?.value;
 async function pending(h,stage){for(let i=0;i<100;i++){const e=run(h);if(e?.terminal)throw Error('Synthetic acquisition terminated');if(e?.review&&e.phase===stage)return wrapper.takePendingHumanReview(h);await Promise.resolve();}throw Error('Synthetic prompt not reached');}
 return{auth,identity,adapter,wrapper,targets,binding,reviewed,authorized,drift,driver,records,calls,reads,opens,sessions,trace,timers,run,pending,
  replaceWrapper(value){wrapperOverride=value;},
  contextRecord:c=>records.find(r=>r.key===c&&Object.hasOwn(r.value,'secret'))?.value,
  advance(ms){now+=ms;for(const[h,t]of[...timers])if(t.due<=now){timers.delete(h);t.fn();}},elapse(ms){now+=ms;}};
}
const serviceAck=p=>({...clone(p.review),reviewed:true});
const targetAck=p=>({reviewed:true,candidate:clone(p.review.candidate),candidateSha256:p.review.candidateSha256,inventorySha256:p.inventoryReview.inventorySha256,noForbiddenCollision:true,intendedDisposableNonProduction:true});
module.exports={loadAcquisition,clone,inventory,serviceAck,targetAck};
