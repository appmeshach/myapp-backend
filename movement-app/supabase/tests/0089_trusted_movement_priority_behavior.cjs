'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const {run}=require('./0089_trusted_movement_priority_harness.cjs'),{support}=require('./0089_trusted_movement_priority_test_support.cjs');
async function main(){await run(async c=>{const h=support(c);let checks=0;const check=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
 const strength=(n=0,sum=0,count=0,wait=0,tau=135)=>h.json(`SELECT to_jsonb(s) FROM private.movement_priority_strengths_v1(${n},${sum},${count},${wait},${tau}) s;`);
 for(const [n,v] of [[0,0],[1,25],[2,40],[3,50],[5,62.5]])check(strength(n).history,v,'exact authoritative history curve '+n);
 check(strength(50).history-strength(49).history<strength(2).history-strength(1).history,true,'diminishing returns');
 check(strength().reputation,50,'neutral newcomer');check(strength(0,5,1).reputation<100,true,'one rating confidence');check(strength(0,480,100).reputation>strength(0,5,1).reputation,true,'many strong ratings beat one perfect');
 for(const t of [0,5,15,30,45,60,120]){const values=[135,75,45,20].map(tau=>strength(0,0,0,t,tau).waiting);check(values.every((v,i)=>i===0||v>=values[i-1]),true,'seat waiting order '+t);}
 const weights=[[.4,.35,.25,135],[.3,.25,.45,75],[.22,.18,.6,45],[.15,.1,.75,20],[.35,.4,.25,60]];
 for(let i=0;i<5;i++){const [hw,rw,ww,tau]=weights[i],s=strength(3,24,5,60,tau),context=i===4?'requester_initiated_v1':`offerer_initiated_${i+1}_seat_v1`,actual=Number(c.target(`SELECT private.movement_priority_v1(3,24,5,60,'${context}');`));check(Math.abs(actual-(hw*s.history+rw*s.reputation+ww*s.waiting))<1e-10,true,'exact numeric policy '+context);}
 for(const args of ["-1,0,0,0,135","0,5,0,0,135","0,0,0,-1,135","0,0,0,0,0","0,0,0,'NaN',135","0,0,0,'Infinity',135"]){assert.throws(()=>c.target(`SELECT * FROM private.movement_priority_strengths_v1(${args});`),/23514/);checks++;}
 const a=h.offering(1),b=h.offering(4,a.member_id),v=h.requester(),n=h.requester();
 const completions=[];for(let i=0;i<3;i++){const f=h.completed(v.member_id,i===1?'offering_member':'primary_requester');completions.push(f);check(h.rate(f,i===1?f.requester:f.offerer,5).ok,true,'genuine rating');}
 check(c.target(`SELECT count(*) FROM private.completed_movement_principals WHERE member_id='${v.member_id}';`),'3','both roles count');
 check(c.target(`SELECT count(DISTINCT person_role) FROM private.completed_movement_principals WHERE member_id='${v.member_id}';`),'2','both historical roles');
 check(h.memberScore(v.member_id),44.0625,'receipt-derived score');check(h.memberScore(n.member_id),17.5,'newcomer neutral');
 const vi=h.interest(v,a),ni=h.interest(n,a,30),vb=h.interest(v,b),nb=h.interest(n,b,30);
 check(h.list(a).rows.map(x=>x.interest_id),[vi,ni],'one seat veteran first');check(h.list(b).rows.map(x=>x.interest_id),[nb,vb],'four seats waiting newcomer first');
 c.target(`UPDATE private.offering_movement_availability SET remaining_places=1 WHERE id='${b.availability_id}';`);
 check(h.list(b).rows.map(x=>x.interest_id),[nb,vb],'original four-seat policy despite one remaining');
 const before=h.money(),operational=c.target(`SELECT ${c.inboxSchema}.inbox_operational_snapshot();`);
 for(let i=0;i<3;i++)check(h.list(b).rows.map(x=>x.interest_id),[nb,vb],'stable repeated order');
 check(h.money(),before,'no money/history/member changes');check(c.target(`SELECT ${c.inboxSchema}.inbox_operational_snapshot();`),operational,'no operational writes or timestamps');
 const keys=['interest_id','movement_need_id','availability_id','origin_area','destination_area','people_count','earliest_departure_at','latest_departure_at','requester_origin_distance_to_route_meters','interest_created_at'].sort();check(Object.keys(h.list(a).rows[0]).sort(),keys,'exact ten safe fields');
 check(h.list(a,1).rows.map(x=>x.interest_id),[vi],'limit after ranking');check(h.list(a,20,b.availability_id).rows.map(x=>x.interest_id),[nb,vb],'owned availability');
 const foreign=h.offering(1);check(h.list(a,20,foreign.availability_id),h.list(a,20,'00000000-0000-4000-8000-000000000000'),'foreign/missing indistinguishable');
 check(h.list(a,20,null).rows.every(x=>[a.availability_id,b.availability_id].includes(x.availability_id)),true,'null availability ownership');
 const originalScore=h.memberScore(n.member_id);
 for(const column of ['completed_movements','rating']){assert.throws(()=>c.target(`UPDATE public.members SET ${column}=${column==='rating'?5:99} WHERE id='${n.member_id}';`),/23514/);checks++;check(h.memberScore(n.member_id),originalScore,'display field cannot forge ranking');}
 const tieA=h.offering(2),tieN=h.requester(),tieM=h.requester(),tie1=h.interest(tieN,tieA),stamp=c.target(`SELECT created_at FROM private.requester_movement_interests WHERE id='${tie1}';`);
 const tieEvidence=c.target(`SELECT ${c.inboxSchema}.inbox_match('${tieM.movement_need_id}','${tieA.intent_id}','${tieA.route_id}');`);
 const tie2=c.target(`INSERT INTO private.requester_movement_interests(request_id,movement_need_id,requesting_member_id,availability_id,offering_member_id,offering_movement_intent_id,route_match_evidence_id,route_match_evidence_version,created_at,expires_at) SELECT gen_random_uuid(),'${tieM.movement_need_id}','${tieM.member_id}',a.id,a.offering_member_id,a.offering_movement_intent_id,e.id,e.version,'${stamp}',least(a.expires_at,e.expires_at) FROM private.offering_movement_availability a JOIN private.trusted_route_match_evidence e ON e.id='${tieEvidence}' WHERE a.id='${tieA.availability_id}' RETURNING id;`);
 const expected=[tie1,tie2].sort();
 for(const expression of [`'${stamp}'::timestamptz`,`'${stamp}'::timestamptz-interval '1 minute'`]){const restore=h.instrument('public.list_requester_movement_interests_for_offerer(uuid,integer)',expression);try{for(let i=0;i<3;i++)check(h.list(tieA).rows.map(x=>x.interest_id),expected,'equal/regressed clock exact score ties use UUID');}finally{restore();}}
 c.target(`UPDATE public.movement_needs SET status='paused' WHERE id='${v.movement_need_id}';`);
 check(h.list(a,1).rows.map(x=>x.interest_id),[ni],'invalid high-scoring support does not consume limit');
 for(const role of ['anon','authenticated','service_role']){
  for(const table of ['completed_movement_principals','completed_movement_ratings']){check(c.target(`SELECT has_table_privilege('${role}','private.${table}','SELECT,INSERT,UPDATE,DELETE');`),'f','private provenance ACL');assert.throws(()=>c.target(`BEGIN; SET LOCAL ROLE ${role}; SELECT * FROM private.${table};`),/42501/);checks++;}
  assert.throws(()=>c.target(`BEGIN; SET LOCAL ROLE ${role}; SELECT private.movement_priority_v1(0,0,0,0,'requester_initiated_v1');`),/42501/);checks++;
 }
 for(const isolation of ['REPEATABLE READ','SERIALIZABLE']){assert.throws(()=>c.target(`BEGIN ISOLATION LEVEL ${isolation}; SELECT set_config('request.jwt.claim.sub','${a.member_id}',true); SET LOCAL ROLE authenticated; SELECT * FROM public.list_requester_movement_interests_for_offerer();`),/25000/);checks++;}
 fs.writeFileSync('docs/0089-behavior-results.json',JSON.stringify({passed:checks,failed:0},null,2)+'\n');console.log('PASS '+checks+' priority behavior assertions');
 });}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});module.exports={main};
