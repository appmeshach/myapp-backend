'use strict';
const fs=require('node:fs'),path=require('node:path');
const {run}=require('./0084_completed_movement_reputation_harness.cjs');
async function main(){await run(async c=>{
 const f=c.fresh();const pending=c.fresh({complete:false});
 const sql=fs.readFileSync(path.join(__dirname,'0084_completed_movement_reputation_test.sql'),'utf8')
  .replaceAll('__SCHEMA__',f.schema).replaceAll('__NEED__',f.need).replaceAll('__ALIGNMENT__',f.alignment)
  .replaceAll('__REQUESTER__',f.requester).replaceAll('__OFFERER__',f.offerer).replaceAll('__TRAVELLER__',f.traveller).replaceAll('__PENDING__',pending.need).replaceAll('__PENDING_REQUESTER__',pending.requester);
 console.log(c.target(sql));
 });}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
module.exports={main};
