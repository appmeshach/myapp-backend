'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{EventEmitter}=require('node:events');
const gap=require('../../scripts/assessment-worker/qualification-execution-schema-gap.cjs'),adapter=require('../../scripts/assessment-worker/qualification-child-adapter.cjs'),supervisor=require('../../scripts/assessment-worker/qualification-supervisor.cjs'),p=require('../../scripts/assessment-worker/qualification-child-protocol.cjs'),{fixture}=require('./fixtures/0104-qualification.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'movement-0105-test-'));
test.after(()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert(path.basename(root).startsWith('movement-0105-test-'));fs.rmSync(root,{recursive:true,force:true});});
test.beforeEach(t=>t.mock.method(global,'fetch',async()=>{throw Error('No network');}));
function fake(f){
 const child=new EventEmitter();child.pid=777;child.connected=true;child.stdout=new EventEmitter();child.stderr=new EventEmitter();
 child.disconnect=()=>{child.connected=false;child.emit('disconnect');};child.kill=()=>child.emit('exit',null,'SIGKILL');
 const emit=v=>queueMicrotask(()=>child.emit('message',v));
 child.send=(v,cb)=>{cb?.(null);const binding=v.binding;
  if(v.type==='initialize')emit({type:'ready',binding});
  if(v.type==='register')emit({type:'backend_request',binding,requestId:1,method:'register',args:[f.pair.requester,f.pair.need,f.pair.availability]});
  if(v.type==='prepare')emit({type:'backend_request',binding,requestId:2,method:'claim',args:[]});
  if(v.type==='backend_result'&&v.requestId===1)emit({type:'registered',binding,value:v.value});
  if(v.type==='backend_result'&&v.requestId===2)emit({type:'backend_request',binding,requestId:3,method:'load',args:[f.plan.jobId,f.token]});
  if(v.type==='backend_result'&&v.requestId===3)emit({type:'prepared',binding,value:{envelope:f.envelope,claim:f.claim,fixture:{needId:f.pair.need,requesterId:f.pair.requester,availabilityId:f.pair.availability}}});
  if(v.type==='release')emit({type:'fault_receipt',binding,value:{controlled:f.controlled,claim:f.claim}});
  if(v.type==='receipt_ack'){child.disconnect();child.emit('exit',null,'SIGKILL');}
 };
 return {fork:()=>{queueMicrotask(()=>{child.emit('spawn');emit({type:'hello',version:p.VERSION});});return child;}};
}
test('schema decision has no query/transport/variables capability',()=>{
 assert.equal(gap.decision,'insufficient');assert.equal(gap.queryImplemented,false);
 assert.deepEqual(Object.keys(gap),['decision','queryImplemented','sources','known','missing','runtime']);
 assert(!fs.existsSync('scripts/assessment-worker/qualification-execution-query.cjs'));
 const source=fs.readFileSync('scripts/assessment-worker/qualification-execution-schema-gap.cjs','utf8');assert(!/\bquery\s+\w+\s*[({]|\bmutation\b|\bsubscription\b|exitCode|first:|after:/.test(source));
});
test('known names and exact missing contract remain explicit, immutable',()=>{
 assert.equal(gap.known.fieldName,'deploymentInstanceExecutions');assert(gap.known.executionFields.includes('deploymentMeta'));assert.equal(gap.known.statuses.length,10);assert.equal(gap.known.serviceInstanceFields.length,8);
 for(const term of ['parent','argument','input object','output','pageInfo','cursor','filters','ordering','complete'])assert(gap.missing.some(v=>v.includes(term)));
 assert.throws(()=>gap.known.executionFields.push('invented'));assert.deepEqual(gap.runtime.supportedImmutableVariableNames,[]);
});
test('documentation distinguishes retained facts from absent type definitions',()=>{const doc=fs.readFileSync('docs/0105-railway-execution-schema-and-topology.md','utf8');for(const term of ['deploymentInstanceExecutions','deploymentMeta','ON_FAILURE','pageInfo','PID reuse','operator_plan_constraints','runtime_identity_provenance_unresolved'])assert(doc.includes(term));});
for(const [name,value] of [['arbitrary operator runtime ID',{runtimeId:'operator-value'}],['malformed runtime metadata',{runtime:{executionId:17}}],['partial runtime metadata',{runtime:{serviceId:'partial'}}],['runtime/control-plane mismatch',{runtime:{deploymentId:'other'}}],['child self-identity claim',{identity_proven:true}],['operator variable name',{runtimeVariableName:'ARBITRARY_ID'}]])test(name+' cannot enter adapter authority',()=>{
 const f=fixture(root);assert.throws(()=>adapter.createChildAdapter(f.plan,{backend:f.backend,...value}));
 assert.throws(()=>adapter.childTopology(value));assert.throws(()=>adapter.correlateOwnedChild(value));
});
test('real Node fork and inherited IPC locally bind the owned child',async()=>{
 const f=fixture(root),worker=adapter.createChildAdapter(f.plan,{backend:f.backend});
 try{await worker.register(f.envelope);const out=adapter.childTopology(worker);assert.equal(out.local.parentPid,process.pid);assert(out.local.childPid>0);assert.notEqual(out.local.childPid,process.pid);assert.equal(out.local.parentChildObserved,true);assert.equal(out.local.ipcObserved,true);assert.equal(out.local.spawnObserved,true);assert.equal(out.evidenceKind,'local_node_observation');assert.equal(out.identity_proven,null);assert.equal(out.restart_origin_proven,null);assert.throws(()=>adapter.correlateOwnedChild(worker));}finally{adapter.closeChildAdapter(worker);}
});
test('synthetic correlation cannot imply identity, causality or restart origin',async()=>{
 const f=fixture(root),worker=adapter.createChildAdapter(f.plan,{backend:f.backend,...fake(f)});
 await supervisor.supervise(f.plan,{...f.dependencies,worker});const out=adapter.correlateOwnedChild(worker);
 assert.equal(out.correlated,true);assert.equal(out.correlationScope,'validated_local_sequence_only');assert.equal(out.local.parentChildObserved,false);assert.equal(out.evidenceKind,'synthetic_transport');
 for(const key of ['identity_proven','causality_proven','restart_origin_proven','platformRestart'])assert.equal(out[key],null);
 assert.deepEqual(out.restartAttribution,{measurement:null,limitation:'restart_origin_unattributable'});assert.equal(out.runtime.source,null);assert.equal(out.controlPlane.independentlyAuthoritative,false);
 assert.deepEqual(out.recovery,{originalAttempt:1,replacementAttempt:2,staleTokenState:'lease_invalid',publicationCount:1});
 const json=JSON.stringify(out);for(const raw of [f.plan.jobId,f.token,f.plan.supervisorNonce,...Object.values(f.plan.env)])assert(!json.includes(raw));
 const artifact=JSON.parse(json);artifact.identity_proven=true;assert.throws(()=>adapter.correlateOwnedChild(artifact));assert.throws(()=>adapter.childTopology(artifact));assert.throws(()=>supervisor.completedQualification(artifact));
 out.runtime.identity_proven=true;assert.equal(adapter.childTopology(worker).runtime.identity_proven,null);
});
test('PID reuse and same binding do not transfer owned object identity',async()=>{
 const f=fixture(root),first=adapter.createChildAdapter(f.plan,{backend:f.backend,...fake(f)}),second=adapter.createChildAdapter(f.plan,{backend:f.backend,...fake(f)});
 try{await first.register(f.envelope);await second.register(f.envelope);assert.equal(adapter.childTopology(first).local.childPid,adapter.childTopology(second).local.childPid);for(const w of [first,second]){assert.equal(adapter.childTopology(w).identity_proven,null);assert.throws(()=>adapter.correlateOwnedChild(w));}assert.throws(()=>adapter.childTopology({pid:777}));}finally{adapter.closeChildAdapter(first);adapter.closeChildAdapter(second);}
});
test('failure and cleanup termination cannot create completed correlation',async()=>{const f=fixture(root),worker=adapter.createChildAdapter(f.plan,{backend:f.backend,...fake(f)});await worker.register(f.envelope);adapter.closeChildAdapter(worker);assert.equal(adapter.childTopology(worker).local.controlledExitObserved,false);assert.throws(()=>adapter.correlateOwnedChild(worker));});
test('even asserted identity never supplies restart-origin authority',()=>{assert.throws(()=>adapter.correlateOwnedChild({identity_proven:true,restart_origin_proven:true}));assert.equal(gap.runtime.identityProven,null);});
test('normal worker remains isolated',()=>{assert(!/qualification-child|qualification-execution|qualification-supervisor|topology|controlledFailure|--crash/.test(fs.readFileSync('scripts/assessment-worker/run.cjs','utf8')));});
