'use strict';
const assert=require('node:assert/strict');
const {run,source}=require('./0084_completed_movement_reputation_harness.cjs');
async function main(){await run(async c=>{
 const f=c.existing;
 assert.equal(c.target(`SELECT count(*) FROM private.completed_movement_principals WHERE alignment_id='${f.alignment}';`),'2');
 assert.equal(c.target(`SELECT bool_and(completed_movements=1 AND rating IS NULL) FROM public.members WHERE id IN('${f.offerer}','${f.requester}');`),'t');
 assert.equal(c.target(`SELECT completed_movements FROM public.members WHERE id='${f.traveller}';`),'0');
 assert.throws(()=>c.target(source),/Existing reputation requires reviewed reconciliation/);
 console.log('PASS exact historical completion backfill; principals only; unexplained aggregates fail closed');
 },{preexisting:true});}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
module.exports={main};
