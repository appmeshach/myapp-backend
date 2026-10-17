'use strict';
// Explicit local validation; inert import. Historical assertions stay unchanged.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process'),assert=require('node:assert/strict');
const output=path.join(os.tmpdir(),'movement-0101-validation');
const jobs={
 foundation:['supabase/tests/0100_requester_geographic_support_validation.cjs','foundation'],
 assessment:['supabase/tests/0100_requester_geographic_support_validation.cjs','assessment'],
 assessmentBehavior:['supabase/tests/0100_requester_geographic_support_validation.cjs','assessment-behavior'],
 assessmentConcurrency:['supabase/tests/0100_requester_geographic_support_validation.cjs','assessment-route-concurrency'],
 requesterSql:['supabase/tests/0100_requester_geographic_support_validation.cjs','sql'],
 requesterConcurrency:['supabase/tests/0100_requester_geographic_support_validation.cjs','requester-concurrency'],
 routeBehavior:['supabase/tests/0100_requester_geographic_support_validation.cjs','route-behavior'],
 priority:['supabase/tests/0100_requester_geographic_support_validation.cjs','priority'],
 rosterBehavior:['supabase/tests/0100_requester_geographic_support_validation.cjs','roster-behavior'],
 rosterConcurrency:['supabase/tests/0100_requester_geographic_support_validation.cjs','roster-concurrency'],
 rosterTemporal:['supabase/tests/0100_requester_geographic_support_validation.cjs','roster-temporal'],
 workerBehavior:['supabase/tests/0099_shared_segment_assessment_job_foundation_harness.cjs'],
 workerConcurrency:['supabase/tests/0099_shared_segment_assessment_job_foundation_concurrency.cjs'],
 requesterIntegration:['supabase/tests/0100_requester_geographic_support_harness.cjs'],
 freshReset:['supabase/tests/0099_shared_segment_assessment_job_foundation_reset.cjs'],
 supabaseNode:['supabase/tests/0100_requester_geographic_support_validation.cjs','supabase-node'],
 rootNode:['supabase/tests/0100_requester_geographic_support_validation.cjs','root-node'],
 appTypecheck:['node_modules/typescript/bin/tsc','--noEmit'],
 edgeTypecheck:['node_modules/typescript/bin/tsc','--project','supabase/functions/tsconfig.json'],
 workerTypecheck:['node_modules/typescript/bin/tsc','--project','scripts/assessment-worker/tsconfig.json'],
};
function main(group=process.argv[2]){
 const names=group==='sql'?Object.keys(jobs).filter(k=>!['supabaseNode','rootNode','appTypecheck','edgeTypecheck','workerTypecheck'].includes(k)):group==='types'?['appTypecheck','edgeTypecheck','workerTypecheck']:group==='node'?['supabaseNode','rootNode']:[group];
 fs.mkdirSync(output,{recursive:true});let failed=false;
 for(const name of names){assert(jobs[name],'Unknown validation group');const log=path.join(output,name+'.txt'),fd=fs.openSync(log,'w');
  const r=cp.spawnSync(process.execPath,['--no-warnings',...jobs[name]],{stdio:['ignore',fd,fd],timeout:1200000,windowsHide:true});fs.closeSync(fd);
  const passed=r.status===0;failed||=!passed;console.log(`${name}: ${passed?'PASS':'FAIL'} (exit ${r.status}); ${log}`);
  console.log(fs.readFileSync(log,'utf8').split('\n').slice(-12).join('\n'));
 }
 if(failed)process.exitCode=1;
}
module.exports={main,output,jobs};if(require.main===module)main();
