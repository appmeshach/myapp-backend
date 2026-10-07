'use strict';
const assert=require('node:assert/strict');
function support(c){
 const h=require('./0088_funded_activation_fee_test_support.cjs').support(c),s=c.inboxSchema;
 const json=sql=>JSON.parse(c.target(sql));
 const offering=(places=1,member)=>json(`SELECT to_jsonb(x) FROM ${s}.inbox_offering_fixture('priority-${places}',${places},interval '1 hour',${member?"'"+member+"'":'NULL'}) x;`);
 const requester=()=>json(`SELECT to_jsonb(x) FROM ${s}.inbox_requester_fixture('priority',1) x;`);
 function interest(n,a,wait=0){c.target(`INSERT INTO private.trusted_location_state_evidence(resolution_evidence_id,resolved_location_reference_id,provider_namespace,state_provider_reference,state_name,state_key,recorded_at) SELECT e.id,e.resolved_location_reference_id,l.provider_namespace,'region-lagos','Lagos',private.canonical_nigerian_state_key('Lagos'),clock_timestamp() FROM private.movement_location_resolution_evidence e JOIN private.movement_location_references l ON l.id=e.resolved_location_reference_id WHERE NOT EXISTS(SELECT 1 FROM private.trusted_location_state_evidence s WHERE s.resolution_evidence_id=e.id);`);
  const e=c.target(`SELECT ${s}.inbox_match('${n.movement_need_id}','${a.intent_id}','${a.route_id}');`);
  // Same complete trusted construction used by 0048's equal-time tie fixture;
  // timestamps are immutable from insertion and every production trigger runs.
  if(wait)return c.target(`INSERT INTO private.requester_movement_interests(request_id,movement_need_id,requesting_member_id,availability_id,offering_member_id,offering_movement_intent_id,route_match_evidence_id,route_match_evidence_version,created_at,expires_at) SELECT gen_random_uuid(),'${n.movement_need_id}','${n.member_id}',a.id,a.offering_member_id,a.offering_movement_intent_id,e.id,e.version,clock_timestamp()-interval '${wait} minutes',least(a.expires_at,e.expires_at) FROM private.offering_movement_availability a JOIN private.trusted_route_match_evidence e ON e.id='${e}' WHERE a.id='${a.availability_id}' RETURNING id;`);
  return c.target(`SELECT ${s}.inbox_interest_fixture('${n.member_id}','${n.movement_need_id}','${a.availability_id}','${e}');`);}
 const list=(a,limit=20,availability=a.availability_id)=>json(`BEGIN; SELECT ${s}.inbox_list('${a.member_id}',${availability?"'"+availability+"'":'NULL'},${limit}); COMMIT;`);
 function completed(member,role='primary_requester'){const f=c.fresh({started:true,[role==='primary_requester'?'requester':'offerer']:member});h.requested(f);const before=h.economics(f);assert.equal(c.result(f,h.confirm,f.requester).ok,true);h.assertSettlement(f,before);return f;}
 const rate=(f,reviewer,stars)=>h.call(f,`SELECT * FROM public.rate_my_completed_movement_person('${f.need}',1,${stars})`,reviewer);
 const memberScore=(member,wait=0,context='offerer_initiated_1_seat_v1')=>Number(c.target(`SELECT private.movement_member_priority_v1('${member}',${wait},'${context}');`));
 return {...h,json,offering,requester,interest,list,completed,rate,memberScore};
}
module.exports={support};
