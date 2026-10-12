'use strict';
const {calculateIsolated}=require('./compute.cjs');
async function main(){const {cases}=await import('../0099-geographic-support-benchmark.mjs');const lines=[];
 for(const [name,shapes] of Object.entries(cases)){
  const v=await calculateIsolated(shapes[0],shapes[1]);const line=JSON.stringify({name,...v.metrics,supervisorOverheadMs:v.metrics.wallMs-v.metrics.computeMs,
   state:v.result.assessmentState,geographicResult:v.result.geographicResult,reason:v.result.reasons[0]||null,workUnits:v.result.workUnits});lines.push(line);console.log(line);
 }
 if(process.argv.includes('--record'))require('node:fs').writeFileSync(require('node:path').resolve(__dirname,'../../docs/0099-worker-benchmark-results.txt'),lines.join('\n')+'\n');
}
module.exports={main};if(require.main===module)main().catch(()=>{console.error('Worker benchmark unavailable');process.exitCode=1;});
