'use strict';
const assert=require('node:assert/strict');
const {run}=require('./0091_pre_departure_roster_freeze_harness.cjs'),{support}=require('./0087_funded_completion_test_support.cjs');
async function main(){await run(async c=>{
 const h=support(c);let assertions=0;
 const receipt=f=>JSON.parse(c.target(`SELECT to_jsonb(x) FROM private.offering_movement_roster_freezes x JOIN ${f.schema}.snapshot_fixture s ON s.availability=x.availability_id;`));
 for(const equal of [true,false]){
  const a=c.fresh({solo:true}),b=c.fresh({solo:true,parent:a});assert(c.result(a,'request_my_funded_movement_start').ok);assertions++;
  const first=receipt(a),literal="'"+first.initiating_requested_at+"'::timestamptz"+(equal?'':"-interval '1 hour'");
  const restore=h.instrument('public.request_my_funded_movement_start(uuid)',literal);
  try{assert(c.result(b,'request_my_funded_movement_start').ok);assertions++;}finally{restore();}
  assert.deepEqual(receipt(a),first);assertions++;
  c.target(`SELECT private.assert_offering_movement_roster_freeze('${first.availability_id}'); SELECT private.assert_funded_coordination_entry('${b.alignment}');`);assertions+=2;
  assert(c.result(b,'confirm_my_funded_movement_start',b.requester).ok);assertions++;
 }
 const a=c.fresh({solo:true}),restore=h.instrument('private.protect_offering_movement_roster_freeze()',"clock_timestamp()-interval '1 hour'");
 try{assert(c.result(a,'request_my_funded_movement_start').ok);assertions++;}finally{restore();}
 const f=receipt(a);assert(Date.parse(f.frozen_at)<Date.parse(f.initiating_requested_at));assertions++;
 c.target(`SELECT private.assert_offering_movement_roster_freeze('${f.availability_id}');`);assertions++;
 assert(c.result(a,'request_my_funded_movement_start').ok);assertions++;assert.deepEqual(receipt(a),f);assertions++;
 console.log(JSON.stringify({temporalAssertions:assertions,deadlocks:Number(c.target(`SELECT deadlocks FROM pg_stat_database WHERE datname='${c.database}';`))}));
 });}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});module.exports={main};
