'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const need='00000000-0000-4000-8000-000000000081';
const early='2026-10-04T10:00:00.000000Z',late='2026-10-04T10:00:00.005338Z';
function load(file,data){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,AbortController,setTimeout,clearTimeout,require:n=>n==='../lib/supabase'?{supabase:{rpc:()=>({then:resolve=>resolve({data,error:null}),abortSignal:async()=>({data,error:null})})}}:n==='./coordinationService'?{validMovementNeed:v=>v===need}:{}});return exports;}
for(const time of [early,late])test('funded start accepts regressed/equal confirmation '+time,async()=>{
 const row={start_authority:'funded',meeting_point_text:'Station',meeting_point_revision:1,journey_state:'in_progress',start_requested_at:late,started_at:time,can_edit_meeting_point:false,can_request_start:false,can_confirm_start:false};
 assert.equal((await load('src/services/meetingJourneyService.ts',[row]).confirmMyFundedMovementStart(need,new AbortController().signal)).startedAt,time);
});
for(const time of [early,late])test('completion accepts regressed/equal confirmation '+time,async()=>{
 const row={journey_state:'completed',completion_requested_at:late,completed_at:time,can_request_completion:false,can_confirm_completion:false,response_deadline_at:'2026-10-04T22:00:00.005338Z',completion_method:'requester_confirmed',can_dispute_completion:false,dispute_active:false,settlement_state:'settled'};
 assert.equal((await load('src/services/fundedCompletionService.ts',[row]).confirmFundedCompletion(need,new AbortController().signal)).completedAt,time);
});
test('completed recovery accepts settlement before completion',async()=>{
 const row={movement_need_id:need,origin_area:'Origin',destination_area:'Destination',completed_at:late,settled_at:early,settlement_status:'settled',settlement_is_for_me:true};
 const api=load('src/services/completedMovementService.ts',[row]);
 assert.equal((await api.listMyCompletedMovementRecoveries())[0].settledAt,early);
});
test('latest request generation wins despite later timestamp on old response',async()=>{
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/state/meetingJourneyController.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,AbortController,setTimeout,clearTimeout});
 let resolve,calls=0;const old=new Promise(r=>resolve=r);const current={startedAt:early};
 const c=exports.createMeetingController(need,{read:()=>++calls===1?old:Promise.resolve(current)});
 c.activate();const pending=c.refresh();c.clear();c.activate();await c.refresh();resolve({startedAt:late});await pending;
 assert.equal(c.getSnapshot().status,current);
});
test('coordination projection uses server state rather than activation timestamp',async()=>{
 const api=load('src/services/movementService.ts',[{movement_need_id:need,journey_state:'not_started',coordination_ready:true}]);
 assert.equal((await api.openMyFundedMovementCoordination(need)).coordinationReady,true);
 // This projection deliberately exposes neither activation nor coordination clocks.
});
test('proposal consent accepts regressed creation/action clocks but preserves deadline and prerequisite',async()=>{
 const row={proposal_id:need,proposal_version:1,proposal_status:'current',created_at:late,expires_at:'2026-10-04T11:00:00Z',caller_role:'requester',currency:'NGN',quoted_platform_fee_total_minor:1,quoted_movement_contribution_minor:1,origin_area:'Origin',destination_area:'Destination',earliest_departure_at:early,latest_departure_at:null,people_count:1,seats_offered:1,vehicle_seat_capacity:1,proposed_pickup_area:null,proposed_dropoff_area:null,estimated_arrival_minutes:null,offering_accepted_at:late,requester_accepted_at:early};
 assert.equal((await load('src/services/movementService.ts',[row]).getMyFinancialProposal(need)).requesterAcceptedAt,early);
 for(const patch of [{offering_accepted_at:null},{requester_accepted_at:'invalid'},{requester_accepted_at:row.expires_at}])
  await assert.rejects(()=>load('src/services/movementService.ts',[{...row,...patch}]).getMyFinancialProposal(need));
});
