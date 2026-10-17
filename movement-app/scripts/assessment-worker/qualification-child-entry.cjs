'use strict';
// Fixed child entry. No command arguments, HTTP listener, live DB client or env crash switch.
const p=require('./qualification-child-protocol.cjs'),supervisor=require('./qualification-supervisor.cjs'),railway=require('./qualification-railway-evidence.cjs');
function runInheritedChild(){
 if(!process.channel||!process.connected||typeof process.send!=='function'||process.argv.length!==2){process.exitCode=1;return;}
 let phase='hello',plan,context,wire,worker,pending=null,request=0,timer,registration,claim,loaded;
 const deadline=Date.now()+120000;
 function fail(){clearTimeout(timer);if(pending)pending.reject(Error('Qualification child unavailable'));pending=null;process.exit(1);}
 function arm(){clearTimeout(timer);if(Date.now()>=deadline)p.fail();timer=setTimeout(fail,Math.min(30000,deadline-Date.now()));}
 function send(type,extra={}){const v={type,binding:wire,...extra};p.message(v,wire);process.send(v,e=>{if(e)fail();});}
 function rpc(method,args){if(pending)p.fail();return new Promise((resolve,reject)=>{pending={resolve,reject,requestId:++request};send('backend_request',{requestId:request,method,args});});}
 const backend={register:async(...args)=>{registration=await rpc('register',args.slice(0,3));return structuredClone(registration);},claim:async()=>{claim=await rpc('claim',[]);return structuredClone(claim);},load:async(...args)=>{loaded=await rpc('load',args.slice(0,2));return structuredClone(loaded);}};
 process.on('disconnect',fail);
 process.on('message',async value=>{try{
  const v=p.message(value,wire);arm();
  if(v.type==='backend_result'){
   if(!pending||v.requestId!==pending.requestId||!['registering','preparing'].includes(phase))p.fail();const current=pending;pending=null;current.resolve(v.value);return;
  }
  if(v.type==='initialize'){
   if(phase!=='hello')p.fail();phase='initializing';plan=structuredClone(v.plan);context=supervisor.qualificationContext(plan,Date.now());wire={...context.envelope,workerSourceSha256:context.bound.workerSourceSha256,migrationDigest:context.bound.migrationDigest};p.binding(v.binding,wire);
   worker=supervisor.controlledWorker(plan,{backend,terminate:()=>process.kill(process.pid,'SIGKILL')});phase='ready';send('ready');return;
  }
  if(v.type==='register'){if(phase!=='ready')p.fail();phase='registering';const value=await worker.register(context.envelope);phase='registered';send('registered',{value});return;}
  if(v.type==='prepare'){if(phase!=='registered')p.fail();phase='preparing';const value=await worker.prepare(context.envelope);phase='prepared_receipt_sent';send('prepared',{value});return;}
  if(v.type==='release'){
   if(phase!=='prepared_receipt_sent'||pending)p.fail();phase='released';
   // Authority is the inherited private parent channel and this sequence, never the
   // message hashes alone. The WeakMap capability stayed in the parent.
   const cached={register:async()=>structuredClone(registration),claim:async()=>structuredClone(claim),load:async()=>structuredClone(loaded)};
   await railway.controlledFailure(plan,{backend:cached,observe:receipt=>new Promise((resolve,reject)=>{if(pending)p.fail();phase='fault_receipt_sent';pending={resolve,reject,requestId:0};send('fault_receipt',{value:receipt});}),terminate:()=>{if(phase!=='receipt_acknowledged')p.fail();process.kill(process.pid,'SIGKILL');}});p.fail();
  }
  if(v.type==='receipt_ack'){if(phase!=='fault_receipt_sent'||!pending||pending.requestId!==0)p.fail();phase='receipt_acknowledged';const current=pending;pending=null;current.resolve();return;}
  p.fail();
 }catch{fail();}});
 arm();process.send({type:'hello',version:p.VERSION},e=>{if(e)fail();});
}
module.exports={runInheritedChild};if(require.main===module)runInheritedChild();
