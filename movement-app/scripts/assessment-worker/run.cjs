'use strict';
// Provider-neutral private process entry point. No network listener.
const {setTimeout:delay}=require('node:timers/promises');
const {CONTRACT,validateRuntime,configuration,event}=require('./runtime.cjs');
// Dependency injection is for local process tests, never environment/CLI selectors.
/** @param {{args?:string[],env?:NodeJS.ProcessEnv,backend?:import('../../supabase/functions/_shared/shared-segment-assessment-job-contracts.ts').AssessmentJobBackend,compute?:typeof import('./compute.cjs').calculateIsolated,log?:(value:any)=>void}} [options] */
async function main({args=process.argv.slice(2),env=process.env,backend:injected,compute,log=v=>process.stdout.write(JSON.stringify(v)+'\n')}={}){
 validateRuntime();
 if(args.length>1||args.some(v=>v!=='--once'))throw Error('Unknown worker argument');
 const {url,secret}=configuration(env);
 const {createAssessmentJobBackend}=require('../../supabase/functions/_shared/shared-segment-assessment-job-runtime.ts');
 const {executeOne}=require('./worker.cjs');
 const backend=injected||createAssessmentJobBackend(url,secret),controller=new AbortController();
 let shutdownTimer,polls=0,ready=false;
 const stop=()=>{if(controller.signal.aborted)return;log(event('shutdown_started'));controller.abort();
  shutdownTimer=setTimeout(()=>{process.exitCode=1;process.exit(1);},CONTRACT.shutdownMs);shutdownTimer.unref();};
 process.on('SIGINT',stop);process.on('SIGTERM',stop);
 log(event('worker_started'));
 const measured={...backend,claim:async signal=>{signal.throwIfAborted();const value=await backend.claim(signal);polls++;
  if(!ready){ready=true;log(event('worker_ready',{pollCount:polls}));}return value;}};
 try{do{controller.signal.throwIfAborted();const got=await executeOne(measured,{signal:controller.signal,compute,log});
  log(event('worker_heartbeat',{pollCount:polls,state:got.state,rssBytes:process.memoryUsage().rss}));
  if(args.includes('--once')||controller.signal.aborted)break;await delay(CONTRACT.pollMs,undefined,{signal:controller.signal});
 }while(!controller.signal.aborted);}catch{if(!controller.signal.aborted)throw Error('Worker unavailable');}
 finally{if(!controller.signal.aborted)clearTimeout(shutdownTimer);process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
  log(event('worker_stopped',{pollCount:polls}));}
}
module.exports={main};if(require.main===module)main().catch(()=>{process.stderr.write(JSON.stringify(event('bootstrap_failed'))+'\n');process.exitCode=1;});
