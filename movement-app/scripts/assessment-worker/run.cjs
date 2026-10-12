'use strict';
// Private development entry point. Does not generate routes or accept client IDs.
const {createAssessmentJobBackend}=require('../../supabase/functions/_shared/shared-segment-assessment-job-runtime.ts');
const {executeOne}=require('./worker.cjs');
const {setTimeout:delay}=require('node:timers/promises');
async function main(){
 if(Number(process.versions.node.split('.')[0])<24)throw Error('Worker requires Node 24 or later');
 if(process.argv.slice(2).some(v=>v!=='--once'))throw Error('Unknown worker argument');
 const url=process.env.SUPABASE_URL,secret=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!secret)throw Error('Worker configuration unavailable');
 const backend=createAssessmentJobBackend(url,secret),controller=new AbortController();
 const stop=()=>controller.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
 try{do{await executeOne(backend,{signal:controller.signal,log:v=>process.stdout.write(JSON.stringify(v)+'\n')});
  if(process.argv.includes('--once'))break;await delay(1000,undefined,{signal:controller.signal});
 }while(!controller.signal.aborted);}catch{if(!controller.signal.aborted)throw Error('Worker unavailable');}
 finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
module.exports={main};if(require.main===module)main().catch(()=>{console.error('Assessment worker unavailable');process.exitCode=1;});
