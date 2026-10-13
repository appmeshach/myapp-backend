'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process'),{EventEmitter}=require('node:events');
const adapter=require('../../scripts/assessment-worker/qualification-child-adapter.cjs'),supervisor=require('../../scripts/assessment-worker/qualification-supervisor.cjs'),p=require('../../scripts/assessment-worker/qualification-child-protocol.cjs'),{fixture}=require('./fixtures/0104-qualification.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'movement-0104-child-test-'));
const entryIdentity=require('../../scripts/assessment-worker/qualification-child-entry-identity.cjs'),entry=path.resolve('scripts/assessment-worker/qualification-child-entry.cjs');
test.after(()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert(path.basename(root).startsWith('movement-0104-child-test-'));fs.rmSync(root,{recursive:true,force:true});});
test.beforeEach(t=>t.mock.method(global,'fetch',async()=>{throw Error('No network');}));
function fake(f,edit=(v)=>v,onSend=()=>{}){
 const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.connected=true;child.sent=[];child.kills=0;
 child.disconnect=()=>{child.connected=false;child.emit('disconnect');};child.kill=()=>{child.kills++;child.emit('exit',null,'SIGKILL');};
 let wire;
 const emit=value=>{const v=edit(structuredClone(value),child);if(v!==undefined)queueMicrotask(()=>child.emit('message',v));};
 child.send=(v,callback)=>{child.sent.push(structuredClone(v));if(callback)callback(null);onSend(v,child);queueMicrotask(()=>{
  if(!child.connected)return;
  if(v.type==='initialize'){wire=v.binding;emit({type:'ready',binding:wire});}
  if(v.type==='register')emit({type:'backend_request',binding:wire,requestId:1,method:'register',args:[f.pair.requester,f.pair.need,f.pair.availability]});
  if(v.type==='prepare')emit({type:'backend_request',binding:wire,requestId:2,method:'claim',args:[]});
  if(v.type==='backend_result'&&v.requestId===1)emit({type:'registered',binding:wire,value:v.value});
  if(v.type==='backend_result'&&v.requestId===2)emit({type:'backend_request',binding:wire,requestId:3,method:'load',args:[f.plan.jobId,f.token]});
  if(v.type==='backend_result'&&v.requestId===3)emit({type:'prepared',binding:wire,value:{envelope:f.envelope,claim:f.claim,fixture:{needId:f.pair.need,requesterId:f.pair.requester,availabilityId:f.pair.availability}}});
  if(v.type==='release')emit({type:'fault_receipt',binding:wire,value:{controlled:f.controlled,claim:f.claim}});
  if(v.type==='receipt_ack'){child.connected=false;child.emit('disconnect');child.emit('exit',null,'SIGKILL');}
 });};
 const fork=(entry,args,options)=>{assert.equal(entry,path.resolve('scripts/assessment-worker/qualification-child-entry.cjs'));assert.deepEqual(args,[]);assert.equal(options.execPath,process.execPath);assert.deepEqual(options.execArgv,[]);assert.equal(options.shell,false);assert.equal(options.windowsHide,true);assert.deepEqual(options.stdio,['ignore','pipe','pipe','ipc']);assert(!JSON.stringify(options).includes('sb_secret_'));assert(!Object.keys(options.env).some(k=>/MOVEMENT|RAILWAY|NODE_OPTIONS|PASSWORD/i.test(k)));queueMicrotask(()=>emit({type:'hello',version:p.VERSION}));return child;};
 return {child,fork};
}
test('fixed inherited child sequence integrates with supervisor, parent survives and restart stays null',async()=>{
 const f=fixture(root),transport=fake(f),worker=adapter.createChildAdapter(f.plan,{backend:f.backend,fork:transport.fork});
 const pid=process.pid,out=await supervisor.supervise(f.plan,{...f.dependencies,worker});assert.equal(process.pid,pid);assert.equal(out.platformRestart,null);assert.equal(out.restartAttribution.measurement,null);assert.equal(out.restartAttribution.limitation,'restart_origin_unattributable');
 assert.equal(transport.child.sent.filter(v=>v.type==='release').length,1);assert.equal(transport.child.sent.filter(v=>v.type==='receipt_ack').length,1);assert.equal(transport.child.kills,0);
 const serialized=JSON.stringify(out)+fs.readdirSync(f.plan.stateDirectory).map(n=>fs.readFileSync(path.join(f.plan.stateDirectory,n),'utf8')).join('');
 for(const raw of [f.plan.jobId,f.token,f.replacement,f.pair.need,f.pair.requester,f.plan.env.MOVEMENT_QUALIFICATION_FIXTURE_KEY,f.plan.env.MOVEMENT_QUALIFICATION_FIXTURE_CAPSULE,f.plan.env.MOVEMENT_QUALIFICATION_SERVICE_ROLE_KEY])assert(!serialized.includes(raw));
 assert(!/railwayExecutionVerified|verifiedRailwayWorker|Railway execution verified|platformRestart":true/i.test(serialized));
 await assert.rejects(worker.fire(f.envelope,async()=>{},{authorized:true}));
});
for(const key of ['executable','execPath','entry','script','shell','command','args','env'])test('operator process override rejects '+key,()=>{const f=fixture(root);let spawns=0;assert.throws(()=>adapter.createChildAdapter(f.plan,{backend:f.backend,fork:()=>{spawns++;},[key]:'arbitrary'}));assert.equal(spawns,0);});
for(const [name,edit] of [
 ['boolean IPC',()=>true],['unknown type',()=>({type:'release_me'})],['oversized IPC',v=>({...v,extra:'x'.repeat(p.LIMIT+1)})],['extra property',v=>({...v,authorized:true})],['child release',v=>v.type==='ready'?{type:'release',binding:v.binding}:v],['bad version',v=>v.type==='hello'?{...v,version:'bad'}:v],
 ...p.KEYS.map(k=>['wrong '+k,v=>v.type==='hello'?v:{...v,binding:{...v.binding,[k]:'00'.repeat(32)}}]),
])test('IPC rejects '+name,async()=>{const f=fixture(root),transport=fake(f,edit),worker=adapter.createChildAdapter(f.plan,{backend:f.backend,fork:transport.fork});await assert.rejects(worker.register(f.envelope),/Qualification child unavailable/);assert.equal(transport.child.sent.filter(v=>v.type==='release').length,0);});
for(const auth of [true,{},JSON.parse('{"authorized":true}'),{qualificationRunSha256:'00'.repeat(32)}])test('serialized/boolean authorization cannot release '+JSON.stringify(auth),async()=>{const f=fixture(root),transport=fake(f),worker=adapter.createChildAdapter(f.plan,{backend:f.backend,fork:transport.fork});await worker.register(f.envelope);await worker.prepare(f.envelope);await assert.rejects(worker.fire(f.envelope,async()=>{},auth));assert.equal(transport.child.sent.filter(v=>v.type==='release').length,0);});
test('release before preparation rejects without spawning a child',async()=>{const f=fixture(root),transport=fake(f),worker=adapter.createChildAdapter(f.plan,{backend:f.backend,fork:transport.fork});await assert.rejects(worker.fire(f.envelope,async()=>{},{}));assert.equal(transport.child.sent.length,0);});
test('fsync failure prevents cross-process release',async t=>{const f=fixture(root),transport=fake(f),worker=adapter.createChildAdapter(f.plan,{backend:f.backend,fork:transport.fork}),sync=fs.fsyncSync;let writes=0;t.mock.method(fs,'fsyncSync',fd=>{if(++writes===5)throw Error('synthetic failure');return sync(fd);});await assert.rejects(supervisor.supervise(f.plan,{...f.dependencies,worker}));assert.equal(transport.child.sent.filter(v=>v.type==='release').length,0);});
test('observer failure prevents cross-process release',async()=>{const f=fixture(root),transport=fake(f),worker=adapter.createChildAdapter(f.plan,{backend:f.backend,fork:transport.fork});await assert.rejects(supervisor.supervise(f.plan,{...f.dependencies,worker,observer:async()=>{throw Error('synthetic');}}));assert.equal(transport.child.sent.filter(v=>v.type==='release').length,0);});
for(const stage of ['initialize','prepare'])test('disconnect '+stage+' rejects',async()=>{const f=fixture(root),transport=fake(f,v=>v,(v,c)=>{if(v.type===stage)queueMicrotask(()=>c.disconnect());}),worker=adapter.createChildAdapter(f.plan,{backend:f.backend,fork:transport.fork});if(stage==='initialize')await assert.rejects(worker.register(f.envelope));else{await worker.register(f.envelope);await assert.rejects(worker.prepare(f.envelope));}assert.equal(transport.child.sent.filter(v=>v.type==='release').length,0);});
test('unexpected exit before preparation cannot qualify',async()=>{const f=fixture(root),transport=fake(f,v=>v,(v,c)=>{if(v.type==='initialize')queueMicrotask(()=>c.emit('exit',0,null));}),worker=adapter.createChildAdapter(f.plan,{backend:f.backend,fork:transport.fork});await assert.rejects(worker.register(f.envelope));});
test('hung child hits bounded parent timeout',async()=>{const f=fixture(root),transport=fake(f,()=>undefined),worker=adapter.createChildAdapter(f.plan,{backend:f.backend,fork:transport.fork,timeoutMs:100});await assert.rejects(worker.register(f.envelope));assert(transport.child.kills>0);});
for(const [name,mutate] of [
 ['no receipt',(v,c)=>{if(v.type==='release')c.emit('exit',null,'SIGKILL');}],
 ['wrong exit',(v,c)=>{if(v.type==='receipt_ack')c.emit('exit',0,null);}],
 ['missing signal',(v,c)=>{if(v.type==='receipt_ack')c.emit('exit',1,null);}],
 ['wrong signal',(v,c)=>{if(v.type==='receipt_ack')c.emit('exit',null,'SIGTERM');}],
 ['duplicate receipt',(v,c)=>{if(v.type==='receipt_ack')c.emit('message',{type:'fault_receipt',binding:v.binding,value:{controlled:{},claim:{}}});}],
 ['credential stdout',(v,c)=>{if(v.type==='initialize')c.stdout.emit('data',Buffer.from('sb_secret_synthetic'));}],
 ['oversized stderr',(v,c)=>{if(v.type==='initialize')c.stderr.emit('data',Buffer.alloc(p.LIMIT+1));}],
])test('controlled termination rejects '+name,async()=>{const f=fixture(root),transport=fake(f,v=>v,mutate),worker=adapter.createChildAdapter(f.plan,{backend:f.backend,fork:transport.fork});await assert.rejects(supervisor.supervise(f.plan,{...f.dependencies,worker}));});
test('replayed release capability cannot fire twice',async()=>{const f=fixture(root),transport=fake(f),owned=adapter.createChildAdapter(f.plan,{backend:f.backend,fork:transport.fork});let args;const worker={register:owned.register,prepare:owned.prepare,fire:async(...a)=>{args=a;const result=await owned.fire(...a);assert.deepEqual(result,{code:null,signal:'SIGKILL'});assert(!Object.hasOwn(result,'railwayExecutionVerified'));return result;}};try{await supervisor.supervise(f.plan,{...f.dependencies,worker});await assert.rejects(owned.fire(...args));assert.equal(transport.child.sent.filter(v=>v.type==='release').length,1);}finally{adapter.closeChildAdapter(owned);}});
test('duplicate backend requests reject',async()=>{const f=fixture(root),transport=fake(f,(v,c)=>{if(v.type==='backend_request')queueMicrotask(()=>c.emit('message',v));return v;}),worker=adapter.createChildAdapter(f.plan,{backend:f.backend,fork:transport.fork});await assert.rejects(worker.register(f.envelope));});
test('disconnect after preparation cannot release',async()=>{const f=fixture(root),transport=fake(f),worker=adapter.createChildAdapter(f.plan,{backend:f.backend,fork:transport.fork});await worker.register(f.envelope);await worker.prepare(f.envelope);transport.child.disconnect();await assert.rejects(worker.fire(f.envelope,async()=>{},{}));assert.equal(transport.child.sent.filter(v=>v.type==='release').length,0);});
test('receipt persistence failure prevents child acknowledgement',async t=>{const f=fixture(root),transport=fake(f),worker=adapter.createChildAdapter(f.plan,{backend:f.backend,fork:transport.fork}),sync=fs.fsyncSync;let writes=0;t.mock.method(fs,'fsyncSync',fd=>{if(++writes===6)throw Error('synthetic receipt persistence failure');return sync(fd);});await assert.rejects(supervisor.supervise(f.plan,{...f.dependencies,worker}));assert.equal(transport.child.sent.filter(v=>v.type==='release').length,1);assert.equal(transport.child.sent.filter(v=>v.type==='receipt_ack').length,0);});
test('source or migration mismatch prevents child creation',()=>{for(const mutate of [f=>f.plan.report.workerSourceSha256='00'.repeat(32),f=>f.plan.migrationDigest='00'.repeat(32)]){const f=fixture(root);mutate(f);let calls=0;assert.throws(()=>adapter.createChildAdapter(f.plan,{backend:f.backend,fork:()=>{calls++;}}));assert.equal(calls,0);}});
test('fixed child entry without inherited IPC exits safely and parent survives',async()=>{const pid=process.pid;const result=cp.spawnSync(process.execPath,[path.resolve('scripts/assessment-worker/qualification-child-entry.cjs')],{shell:false,env:{},encoding:'utf8',timeout:10000,windowsHide:true});assert.equal(result.status,1);assert.equal(result.stdout,'');assert.equal(result.stderr,'');assert.equal(process.pid,pid);});
test('real inherited channel rejects pre-preparation release',async()=>{const child=cp.fork(path.resolve('scripts/assessment-worker/qualification-child-entry.cjs'),[],{execArgv:[],env:{},shell:false,silent:true,windowsHide:true});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(Error('synthetic child timeout'));},10000);child.once('message',()=>child.send({type:'release',binding:Object.fromEntries(p.KEYS.map(k=>[k,'00'.repeat(32)]))}));child.once('exit',code=>{clearTimeout(timer);try{assert.equal(code,1);resolve();}catch(e){reject(e);}});});assert.equal(output,'');});
test('normal worker has no adapter imports or crash switch',()=>{const s=fs.readFileSync('scripts/assessment-worker/run.cjs','utf8');assert(!/qualification-child|qualification-execution|qualification-supervisor|controlledFailure|--crash|deploymentRestart|redeploy/.test(s));});
test('real POSIX dedicated synthetic child self-terminates while supervisor survives',{skip:process.platform==='win32'},async()=>{
 const f=fixture(root),owned=adapter.createChildAdapter(f.plan,{backend:f.backend}),pid=process.pid;let terminated=false,reads=0;
 const worker={register:owned.register,prepare:owned.prepare,fire:async(...args)=>{const result=await owned.fire(...args);assert.deepEqual(result,{code:null,signal:'SIGKILL'});terminated=true;return result;}};
 const provider={read:async()=>{if(++reads>2)throw Error('synthetic stop after child fault, no provider');return {instance:f.observations[0].instance,execution:{...f.observations[0].execution,updatedAt:new Date(Date.now()-100).toISOString(),observedAt:new Date().toISOString()}};}};
 try{await assert.rejects(supervisor.supervise(f.plan,{...f.dependencies,worker,provider,now:()=>Date.now()}));assert(terminated);assert.equal(process.pid,pid);}finally{adapter.closeChildAdapter(owned);}
});
test('fixed actual child file identity is accepted without a path option',()=>{const pin=entryIdentity.pinFixedChildEntry();pin.assertUnchanged();assert.deepEqual(Object.keys(entryIdentity),['pinFixedChildEntry']);});
test('missing fixed entry fails closed',t=>{const realpath=fs.realpathSync;t.mock.method(fs,'realpathSync',file=>{if(file===entry){const e=Error('synthetic missing file');e.code='ENOENT';throw e;}return realpath(file);});assert.throws(()=>entryIdentity.pinFixedChildEntry(),e=>e.message==='Qualification child unavailable');});
test('byte-identical regular file substitution after pin rejects before fork',async t=>{
 const f=fixture(root),transport=fake(f);let forks=0;const worker=adapter.createChildAdapter(f.plan,{backend:f.backend,fork:(...args)=>{forks++;return transport.fork(...args);}});
 const other=path.join(root,'synthetic-copy.cjs');fs.copyFileSync(entry,other);const lstat=fs.lstatSync,open=fs.openSync;
 t.mock.method(fs,'lstatSync',(file,options)=>lstat(file===entry?other:file,options));
 t.mock.method(fs,'openSync',(file,...args)=>open(file===entry?other:file,...args));
 await assert.rejects(worker.register(f.envelope),/Qualification child unavailable/);assert.equal(forks,0);
});
test('same file identity with changed content rejects',t=>{const pin=entryIdentity.pinFixedChildEntry(),read=fs.readFileSync;t.mock.method(fs,'readFileSync',(file,...args)=>typeof file==='number'?Buffer.from('synthetic substituted source'):read(file,...args));assert.throws(()=>pin.assertUnchanged());});
test('non-regular entry substitution rejects',t=>{const lstat=fs.lstatSync;t.mock.method(fs,'lstatSync',(file,options)=>lstat(file===entry?root:file,options));assert.throws(()=>entryIdentity.pinFixedChildEntry());});
test('canonical redirect outside reviewed location rejects',t=>{const realpath=fs.realpathSync;t.mock.method(fs,'realpathSync',file=>file===entry?path.join(root,'other.cjs'):realpath(file));assert.throws(()=>entryIdentity.pinFixedChildEntry());});
test('canonical redirect to another repository file rejects',t=>{const realpath=fs.realpathSync;t.mock.method(fs,'realpathSync',file=>file===entry?path.resolve('scripts/assessment-worker/qualification-child-adapter.cjs'):realpath(file));assert.throws(()=>entryIdentity.pinFixedChildEntry());});
test('synthetic entry symlink substitution rejects where OS permits',t=>{
 const link=path.join(root,'synthetic-entry-link.cjs');try{fs.symlinkSync(entry,link,'file');}catch(e){if(['EPERM','ENOTSUP'].includes(e.code)){t.skip('OS disallows synthetic file symlinks');return;}throw e;}
 const lstat=fs.lstatSync;t.mock.method(fs,'lstatSync',(file,options)=>lstat(file===entry?link:file,options));assert.throws(()=>entryIdentity.pinFixedChildEntry());
});
test('synthetic parent junction/symlink substitution rejects where OS permits',t=>{
 const parent=path.dirname(entry),link=path.join(root,'synthetic-parent-link');try{fs.symlinkSync(parent,link,process.platform==='win32'?'junction':'dir');}catch(e){if(['EPERM','ENOTSUP'].includes(e.code)){t.skip('OS disallows synthetic directory links');return;}throw e;}
 const lstat=fs.lstatSync;t.mock.method(fs,'lstatSync',(file,options)=>lstat(file===parent?link:file,options));assert.throws(()=>entryIdentity.pinFixedChildEntry());
});
test('legitimate Windows canonical casing and namespace preserve physical identity',{skip:process.platform!=='win32'},t=>{
 const realpath=fs.realpathSync;
 t.mock.method(fs,'realpathSync',file=>file===entry?path.toNamespacedPath(realpath(file).toUpperCase()):realpath(file));
 const pin=entryIdentity.pinFixedChildEntry();pin.assertUnchanged();
});
test('canonical spelling equivalence cannot bypass different file identity',{skip:process.platform!=='win32'},t=>{
 const realpath=fs.realpathSync,lstat=fs.lstatSync,other=path.join(root,'synthetic-different-file.cjs');fs.writeFileSync(other,'synthetic');const alternate=path.toNamespacedPath(entry.toUpperCase());
 t.mock.method(fs,'realpathSync',file=>file===entry?alternate:realpath(file));
 t.mock.method(fs,'lstatSync',(file,options)=>lstat(file===alternate?other:file,options));assert.throws(()=>entryIdentity.pinFixedChildEntry());
});
