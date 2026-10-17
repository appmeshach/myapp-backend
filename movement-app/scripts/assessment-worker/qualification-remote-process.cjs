'use strict';
// Private qualification subprocess; credentials never enter a compute child.
const {main}=require('./run.cjs');
const {configuration}=require('./qualification-remote.cjs');
const {createAssessmentJobBackend}=require('../../supabase/functions/_shared/shared-segment-assessment-job-runtime.ts');
// Injection is library-only for a loopback test driver, never a CLI/env switch.
/** @param {{config?:{url:string,secret:string}}} [options] */
async function start({config:injected}={}){
 const args=process.argv.slice(2);
 if(args.length!==2||!['idle','abandon'].includes(args[0])||args[1]!=='--ack-disposable-environment')throw Error('Qualification arguments unavailable');
 const c=injected||configuration(process.env,true),real=createAssessmentJobBackend(c.url,c.secret);
 let claim;
 const backend=args[0]==='abandon'?{...real,claim:async s=>{claim=await real.claim(s);return claim;},load:async()=>{
  process.send?.({event:'qualification_claimed',claim});return await new Promise(()=>{});
 }}:real;
 await main({args:[],env:{SUPABASE_URL:c.url,SUPABASE_SERVICE_ROLE_KEY:c.secret},backend,log:v=>{process.stdout.write(JSON.stringify(v)+'\n');process.send?.(v);}});
 if(process.connected)process.disconnect();
}
module.exports={start};if(require.main===module)start().catch(()=>{process.stderr.write('Qualification worker unavailable\n');process.exitCode=1;if(process.connected)process.disconnect();});
