'use strict';
const assert=require('node:assert/strict');
function support(c){const h=require('./0089_trusted_movement_priority_test_support.cjs').support(c),s=c.inboxSchema;
 const call=(actor,sql,role='authenticated')=>JSON.parse(c.target(`BEGIN; SELECT ${s}.inbox_as('${role}',${actor?"'"+actor+"'":'NULL'},'${sql.replaceAll("'","''")}'); COMMIT;`));
 function offer(n,a,{wait=0,stamp,seats=1}={}){const interest=h.interest(n,a),e=c.target(`SELECT route_match_evidence_id FROM private.requester_movement_interests WHERE id='${interest}';`);let original;
  try{if(wait||stamp){original=c.target("SELECT pg_get_functiondef('private.create_movement_offer_internal(uuid,uuid,uuid,integer,text,text,integer)'::regprocedure);");assert(/NOW\(\)/i.test(original));c.target(original.replace(/\bNOW\(\)/gi,stamp?"'"+stamp+"'::timestamptz":`clock_timestamp()-interval '${wait} minutes'`));}
   const result=call(a.member_id,`SELECT * FROM public.create_movement_offer('${n.movement_need_id}','${e}','${a.availability_id}',${seats})`);assert.equal(result.ok,true,JSON.stringify(result));return result.rows[0].movement_offer_id;
  }finally{if(original)c.target(original);}}
 const list=(n,limit=20,actor=n.member_id,role='authenticated',need=n.movement_need_id)=>call(actor,`SELECT * FROM public.discover_masked_offers_for_my_need('${need}',${limit===null?'NULL':limit})`,role);
 const fields=['movement_offer_id','seats_offered','estimated_arrival_minutes','offer_status','offer_created_at','vehicle_make','vehicle_model','vehicle_year','vehicle_color','vehicle_seat_capacity','age','common_movement_area','identity_verified','profile_media_verified','completed_movements','rating'];
 const operations=()=>c.target(`SELECT ${s}.inbox_operational_snapshot();`);
 const history=(member,wait=0)=>h.memberScore(member,wait,'requester_initiated_v1');
 return {...h,call,offer,list,fields,operations,history};}
module.exports={support};
