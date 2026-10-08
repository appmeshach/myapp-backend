'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {run}=require('./0091_pre_departure_roster_freeze_harness.cjs');
const {support}=require('./0090_trusted_requester_priority_test_support.cjs');
async function main(){let existingUnavailable,preflightChecks=0;await run(async c=>{
 const h=support(c);let checks=0;const check=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks++;};
 const info=f=>JSON.parse(c.target(`SELECT to_jsonb(x) FROM ${f.schema}.snapshot_fixture x;`));
 const parent=f=>{const x=info(f);return {availability_id:x.availability,intent_id:x.intent,route_id:x.route,member_id:f.offerer,vehicle_id:x.vehicle};};
 const state=f=>JSON.parse(c.target(`SELECT jsonb_build_object('availability',(SELECT to_jsonb(x) FROM private.offering_movement_availability x WHERE id='${info(f).availability}'),'receipt',(SELECT to_jsonb(x) FROM private.offering_movement_roster_freezes x WHERE availability_id='${info(f).availability}'),'journey',(SELECT to_jsonb(x) FROM public.journeys x WHERE alignment_id='${f.alignment}'),'request',(SELECT to_jsonb(x) FROM private.funded_movement_start_requests x WHERE alignment_id='${f.alignment}'));`));
 const a=c.fresh({solo:true}),b=c.fresh({solo:true,parent:a,stage:'agreement'}),av=parent(a),pending=h.requester(),offer=h.offer(pending,av);
 check(state(a).availability.remaining_places,1,'three declared; two one-person accepted memberships; one unused');
 check(state(a).availability.total_places,3,'maximum capacity preserved');
 const unconsented=c.fresh({solo:true,parent:a,stage:'proposal'}),consented=c.fresh({solo:true,parent:a,stage:'proposal'});
 check(JSON.parse(c.target(`BEGIN; SELECT ${consented.schema}.consent(); COMMIT;`).split('\n').find(l=>l.startsWith('{'))).ok,true,'C proposal may be consented before freeze without membership');
 const money=h.money(),beforeOthers=c.target(`SELECT ${a.schema}.start_other_sources();`);
 check(c.result(a,'request_my_funded_movement_start').ok,true,'A authoritative offerer request');
 const frozen=state(a);check(frozen.availability.status,'unavailable','open parent closes');check(frozen.availability.remaining_places,1,'unused place remains truthful');
 check(c.target(`SELECT count(*) FROM private.offering_movement_roster_freezes WHERE availability_id='${av.availability_id}';`),'1','exactly one receipt');
 check(frozen.receipt.initiating_alignment_id,a.alignment,'first alignment identity');check(frozen.receipt.initiating_journey_id,a.journey,'first journey identity');check(frozen.receipt.start_authority,'funded','funded authority');
 check(h.money(),money,'start/freeze produces no wallet/component/priority writes');
 check(h.call(pending.member_id,'SELECT * FROM public.discover_offering_movement_availability(50)').rows.some(x=>x.availability_id===av.availability_id),false,'new raw discovery excludes parent');
 check(h.list(pending).rows,[],'0090 incoming discovery excludes pending C');
 check(h.call(a.offerer,'SELECT * FROM public.list_my_open_offering_movement_availabilities(50)').rows.some(x=>x.availability_id===av.availability_id),false,'open availability recovery excludes parent');
 const evidence=c.target(`SELECT route_match_evidence_id FROM private.movement_offer_route_match_bindings WHERE movement_offer_id='${offer}';`);
 for(const [label,actor,sql,role] of [
  ['new interest',pending.member_id,`SELECT * FROM public.create_requester_movement_interest(gen_random_uuid(),'${pending.movement_need_id}','${av.availability_id}','${evidence}')`],
  ['new offer',a.offerer,`SELECT * FROM public.create_movement_offer('${pending.movement_need_id}','${evidence}','${av.availability_id}',1)`],
  ['pending C acceptance',pending.member_id,`SELECT * FROM public.accept_movement_offer('${offer}')`],
  ['requester matching context',pending.member_id,`SELECT * FROM public.get_requester_availability_matching_context_for_server('${pending.member_id}','${pending.movement_need_id}','${av.availability_id}')`,'service_role'],
  ['intent scoped matching',pending.member_id,`SELECT * FROM public.get_trusted_matching_context_for_server('${pending.movement_need_id}','${av.intent_id}','${a.offerer}')`,'service_role']
 ]){const r=h.call(actor,sql,role);check(r.ok,false,label+' denied');check(r.state,'23514',label+' fail closed');}
 check(c.target(`SELECT status FROM public.movement_offers WHERE id='${offer}';`),'pending','pending offer history remains truthful');
 check(c.target(`SELECT bool_and(status='active') FROM private.requester_movement_interests WHERE movement_need_id='${pending.movement_need_id}';`),'t','pending interest history remains truthful');
 for(const [f,key,label] of [[unconsented,'issue','new/replayed live issuance'],[unconsented,'consent','new offerer consent'],[consented,'requester_accept','consented but unmaterialized C']]){
  const rejected=JSON.parse(c.target(`BEGIN; SELECT ${f.schema}.${key}(); COMMIT;`).split('\n').find(l=>l.startsWith('{')));check(rejected.ok,false,label+' denied');check(rejected.state,'23514',label+' exact eligibility rejection');
  check(c.target(`SELECT count(*) FROM public.alignments WHERE movement_need_id='${f.need}';`),'0',label+' no new membership');
 }
 const first=state(a).receipt;
 check(c.result(a,'request_my_funded_movement_start').ok,true,'A replay succeeds');check(state(a),frozen,'A replay performs no writes');
 check(c.result(a,'confirm_my_funded_movement_start',a.requester).ok,true,'A requester can confirm');
 // B was accepted before the cut but had not funded or activated.
 const funding=c.target(`BEGIN; SELECT ${b.schema}.hold_result(); COMMIT;`);
 check(JSON.parse(funding.split('\n').filter(l=>l.startsWith('{')).at(-1)).ok,true,'B still funds after freeze');
 check(h.call(b.requester,`SELECT * FROM public.activate_my_funded_movement('${b.agreement}',1)`).ok,true,'B activation after freeze');
 check(h.call(b.requester,`SELECT * FROM public.open_my_funded_movement_coordination('${b.need}')`).ok,true,'B coordination after freeze');
 check(h.call(b.offerer,`SELECT * FROM public.set_my_movement_meeting_point('${b.need}','B meeting point',NULL)`).ok,true,'B meeting point after freeze');
 check(c.result(b,'request_my_funded_movement_start').ok,true,'B later start request succeeds');check(state(a).receipt,first,'B reuses exact first provenance');
 check(c.result(b,'confirm_my_funded_movement_start',b.requester).ok,true,'B confirm start succeeds');
 const settlement=require('./0088_funded_activation_fee_test_support.cjs').support(c);
 for(const f of [a,b]){settlement.requested(f);const economics=settlement.economics(f);check(c.result(f,settlement.confirm,f.requester).ok,true,'accepted member completes');settlement.assertSettlement(f,economics);checks++;}
 check(state(a).availability.remaining_places,1,'completion never recycles unused capacity');check(state(a).availability.status,'unavailable','completion never reopens');check(state(a).receipt,first,'completion preserves historical receipt');
 check(c.target(`SELECT count(*) FROM private.financial_components WHERE agreement_id IN ('${a.agreement}','${b.agreement}');`),'6','exactly three components per accepted agreement; none for unused seat');
 check(c.target(`SELECT count(*) FROM private.financial_agreements g JOIN public.alignments x ON x.id=g.alignment_id JOIN private.movement_offer_availability_bindings y ON y.movement_offer_id=x.movement_offer_id WHERE y.availability_id='${av.availability_id}';`),'2','no unused-seat financial agreement');
 // Rollback returns the complete pre-start graph, not just status.
 const r=c.fresh({solo:true}),old=state(r),oldMoney=h.money();c.target('BEGIN; '+c.action(r,'request_my_funded_movement_start')+' ROLLBACK;');check(state(r),old,'rollback removes receipt/start and restores parent');check(h.money(),oldMoney,'rollback no money changes');
 check(c.result(r,'request_my_funded_movement_start').ok,true,'retry after rollback');
 for(const status of ['full','withdrawn','expired']){
  const f=c.fresh({solo:true}),p=parent(f);let restore;
  if(status==='expired')restore=h.instrument('private.protect_offering_movement_availability()',"clock_timestamp()+interval '3 hours'");
  try{c.target(`UPDATE private.offering_movement_availability SET status='${status}'${status==='full'?',remaining_places=0':''} WHERE id='${p.availability_id}';`);}finally{if(restore)restore();}
  const capacity=state(f).availability.remaining_places;check(c.result(f,'request_my_funded_movement_start').ok,true,status+' parent can establish departure');check(state(f).availability.status,status,'terminal status truthful');check(state(f).availability.remaining_places,capacity,'terminal capacity unchanged');
 }
 for(const [operation,sql] of [['update',`UPDATE private.offering_movement_roster_freezes SET frozen_at=clock_timestamp() WHERE availability_id='${av.availability_id}'`],['delete',`DELETE FROM private.offering_movement_roster_freezes WHERE availability_id='${av.availability_id}'`],['truncate','TRUNCATE private.offering_movement_roster_freezes']]){assert.throws(()=>c.target(sql),/23514/,operation+' immutable');checks++;}
 for(const role of ['anon','authenticated','service_role'])for(const sql of ['SELECT * FROM private.offering_movement_roster_freezes',`SELECT private.assert_offering_movement_roster_freeze('${av.availability_id}')`]){assert.throws(()=>c.target(`BEGIN; SET LOCAL ROLE ${role}; ${sql};`),/42501/);checks++;}
 const partial=c.fresh({solo:true}),p=parent(partial);
 assert.throws(()=>c.target(`BEGIN; UPDATE private.offering_movement_availability SET status='unavailable' WHERE id='${p.availability_id}'; COMMIT;`),/23514/);checks++;
 assert.throws(()=>c.target(`BEGIN; SELECT set_config('request.jwt.claim.sub','${partial.offerer}',true); SET CONSTRAINTS private.funded_start_request_complete DEFERRED; INSERT INTO private.funded_movement_start_requests VALUES('${partial.alignment}','${partial.journey}',clock_timestamp(),1); COMMIT;`),/23514/);checks++;
 assert.throws(()=>c.target(`BEGIN; SELECT set_config('request.jwt.claim.sub','${partial.offerer}',true); SET CONSTRAINTS private.roster_freeze_complete DEFERRED; SELECT private.construct_offering_movement_roster_freeze('${p.availability_id}','${partial.alignment}','${partial.journey}','funded',clock_timestamp()); COMMIT;`),/23503/);checks++;
 assert.throws(()=>c.target(`BEGIN; SELECT set_config('request.jwt.claim.sub','${partial.offerer}',true); SELECT private.construct_offering_movement_roster_freeze('${av.availability_id}','${partial.alignment}','${partial.journey}','funded',clock_timestamp()); COMMIT;`),/23514/);checks++;
 check(state(partial).receipt,null,'all partial/forged probes leave no receipt');
 // Sample a later start numerically before an earlier sibling's request.
 const t=c.fresh({solo:true}),u=c.fresh({solo:true,parent:t});check(c.result(t,'request_my_funded_movement_start').ok,true,'temporal first receipt');const temporal=state(t).receipt;
 const restore=h.instrument('public.request_my_funded_movement_start(uuid)',"clock_timestamp()-interval '1 hour'");try{check(c.result(u,'request_my_funded_movement_start').ok,true,'regressed sibling observation remains valid');}finally{restore();}
 c.target(`SELECT private.assert_offering_movement_roster_freeze('${parent(t).availability_id}');`);checks++;check(state(t).receipt,temporal,'regressed later sample cannot rewrite/invalidate history');
 check(c.result(existingUnavailable,'request_my_funded_movement_start').ok,true,'pre-existing unavailable terminal parent can freeze');check(state(existingUnavailable).availability.status,'unavailable','pre-existing unavailable status retained');check(state(existingUnavailable).availability.remaining_places,2,'pre-existing unavailable capacity retained');
 const na=c.fresh({solo:true}),nb=c.fresh({solo:true,parent:na});check(c.result(na,'request_my_funded_movement_start').ok,true,'A closes a second shared group');const heldMoney=h.money();check(c.result(nb,'request_my_movement_end',nb.offerer).ok,true,'B existing no-travel request after parent freeze');const held=c.result(nb,'confirm_my_movement_end',nb.requester);check(held.ok,true,'B existing no-travel confirmation');check(held.rows[0].funding_disposition,'held_review_required','existing held-funds policy unchanged');check(h.money(),heldMoney,'no-travel cannot move money');check(state(na).availability.remaining_places,1,'no-travel cannot recycle capacity');check(state(na).availability.status,'unavailable','no-travel cannot reopen parent');
 // Genuine availability-backed legacy acceptance and activation use all old
 // face/payment prerequisites. The obsolete journey RPC remains inaccessible
 // to clients; the member-facing wrapper delegates under its existing owner.
 const legacyParent=h.offering(3),legacyNeed=h.requester(),legacyOffer=h.offer(legacyNeed,legacyParent);
 const accepted=h.call(legacyNeed.member_id,`SELECT * FROM public.accept_movement_offer('${legacyOffer}')`);check(accepted.ok,true,'legacy acceptance retained');const alignment=accepted.rows[0].alignment_id;
 c.target(`DO $legacy$ DECLARE m uuid; submission uuid; media uuid; face uuid; payment uuid; BEGIN
  FOR m IN SELECT x.member_id FROM private.required_face_members('${alignment}') x LOOP
   submission:=public.create_profile_photo_submission_for_server(m,gen_random_uuid()::text||'/original.png','image/png',128);
   media:=public.prepare_profile_photo_submission_for_server(submission,gen_random_uuid()::text||'/processed.png');
   face:=public.start_alignment_face_verification_for_server('${alignment}',m,'legacy-0091',gen_random_uuid()::text);
   PERFORM public.complete_alignment_face_verification_for_server(face,media,true,true);
  END LOOP;
  SELECT payment_id INTO payment FROM public.create_alignment_activation_payment('${alignment}',100,'NGN','legacy-0091');
  PERFORM public.mark_alignment_activation_payment_succeeded(payment,'legacy-0091:'||gen_random_uuid());
 END; $legacy$;`);
 check(h.call(legacyParent.member_id,`SELECT * FROM public.set_my_movement_meeting_point('${legacyNeed.movement_need_id}','Legacy meeting point',NULL)`).ok,true,'legacy meeting point');const legacyMoney=h.money();
 assert.throws(()=>c.target(`BEGIN; SELECT set_config('request.jwt.claim.sub','${legacyNeed.member_id}',true); UPDATE public.journeys SET start_requested_at=clock_timestamp() WHERE alignment_id='${alignment}'; COMMIT;`),/42501/);checks++;
 check(h.call(legacyParent.member_id,`SELECT * FROM public.request_my_movement_start('${legacyNeed.movement_need_id}')`).ok,true,'legacy authoritative start');
 check(c.target(`SELECT status||':'||remaining_places FROM private.offering_movement_availability WHERE id='${legacyParent.availability_id}';`),'unavailable:2','legacy unused places close without zeroing');
 check(c.target(`SELECT start_authority FROM private.offering_movement_roster_freezes WHERE availability_id='${legacyParent.availability_id}';`),'legacy','legacy authority receipt');
 check(h.money(),legacyMoney,'legacy freeze creates no financial component or wallet movement');
 check(h.call(legacyNeed.member_id,`SELECT * FROM public.confirm_my_movement_start('${legacyNeed.movement_need_id}')`).ok,true,'legacy requester confirmation survives');
 console.log(JSON.stringify({behaviorAssertions:checks,preflightChecks,otherFingerprintChangedOnlyAsExpected:beforeOthers!==c.target(`SELECT ${a.schema}.start_other_sources();`)}));
 },{beforeRosterInstall(c){
  const source=fs.readFileSync(path.join(__dirname,'../migrations/0091_pre_departure_roster_freeze.sql'),'utf8'),preflight=source.slice(source.indexOf('DO $preflight$'),source.indexOf('$preflight$;')+'$preflight$;'.length);
  const f=c.fresh({solo:true});assert.throws(()=>c.target('BEGIN; '+c.action(f,'request_my_funded_movement_start')+' '+preflight+' ROLLBACK;'),/0091 preflight: availability-backed starts require deliberate roster-freeze remediation/);preflightChecks++;
  const legacy=fs.readFileSync(path.join(__dirname,'0019_mutual_no_travel_closure_test.sql'),'utf8');const result=c.target(legacy.replace(/ROLLBACK;\s*$/,preflight+' ROLLBACK;'));assert.doesNotMatch(result,/\|f(?:\||$)/m);preflightChecks++;
  existingUnavailable=c.fresh({solo:true});c.target(`UPDATE private.offering_movement_availability SET status='unavailable' WHERE id=(SELECT availability FROM ${existingUnavailable.schema}.snapshot_fixture);`);
 }});}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});module.exports={main};
