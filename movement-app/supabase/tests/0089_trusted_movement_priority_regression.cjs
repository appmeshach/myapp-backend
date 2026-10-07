'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const {run}=require('./0089_trusted_movement_priority_harness.cjs'),{support}=require('./0089_trusted_movement_priority_test_support.cjs');
async function main(){await run(async c=>{const results={};
 const state=`INSERT INTO private.trusted_location_state_evidence(resolution_evidence_id,resolved_location_reference_id,provider_namespace,state_provider_reference,state_name,state_key,recorded_at) SELECT e.id,e.resolved_location_reference_id,l.provider_namespace,'region-lagos','Lagos',private.canonical_nigerian_state_key('Lagos'),clock_timestamp() FROM private.movement_location_resolution_evidence e JOIN private.movement_location_references l ON l.id=e.resolved_location_reference_id WHERE NOT EXISTS(SELECT 1 FROM private.trusted_location_state_evidence s WHERE s.resolution_evidence_id=e.id);`;
 for(const [name,prefix] of [['0048_offerer_interest_inbox','inbox'],['0049_interest_authorized_offer_continuation','interest']]){
  let live=fs.readFileSync('supabase/tests/'+name+'_test.sql','utf8').replace(/\r\n/g,'\n');
  const marker='  SELECT version INTO STRICT v_version FROM private.offering_route_evidence WHERE id=p_route;';assert(live.includes(marker));live=live.replace(marker,state+'\n'+marker);
  live=live.replace(/ROLLBACK;\s*$/,`SELECT 'COUNT='||count(*) FROM pg_temp.${prefix}_results; ROLLBACK;`);
  const output=c.target(live);assert.doesNotMatch(output,/\|f(?:\||$)/m);const count=Number(output.match(/COUNT=(\d+)/)[1]);results[name]=count;console.log('PASS '+count+' original '+name+' assertions; only current state-evidence fixture augmentation');
 }
 const h=support(c),f=c.fresh({started:true}),pending=c.fresh({started:true});h.requested(f);const before=h.economics(f);assert(c.result(f,h.confirm,f.requester).ok);h.assertSettlement(f,before);
 const reputation=fs.readFileSync('supabase/tests/0084_completed_movement_reputation_test.sql','utf8').replaceAll('__SCHEMA__',f.schema).replaceAll('__NEED__',f.need).replaceAll('__ALIGNMENT__',f.alignment).replaceAll('__REQUESTER__',f.requester).replaceAll('__OFFERER__',f.offerer).replaceAll('__TRAVELLER__',f.traveller).replaceAll('__PENDING__',pending.need).replaceAll('__PENDING_REQUESTER__',pending.requester);
 const output=c.target(reputation);results.reputation0084=Number(output.match(/PASS (\d+) reputation/)[1]);console.log(output);
 const timeout=c.fresh({started:true});h.requested(timeout,{expired:true});const timeoutBefore=h.economics(timeout);assert(c.result(timeout,h.read,timeout.requester).ok);h.assertSettlement(timeout,timeoutBefore);assert.equal(c.target(`SELECT completion_method FROM private.funded_movement_completions WHERE alignment_id='${timeout.alignment}';`),'response_timeout');results.exactConfirmedAndTimeoutSettlement=2;
 const held=c.fresh();assert(c.result(held,'request_my_movement_end',held.offerer).ok);const money=h.money();assert.equal(c.result(held,'confirm_my_movement_end',held.requester).rows[0].funding_disposition,'held_review_required');assert.equal(h.money(),money);results.heldNoTravelFinancialFreeze=2;
 const legacy=fs.readFileSync('supabase/tests/0019_mutual_no_travel_closure_test.sql','utf8');
 const generic=`DO $generic$ DECLARE x record; n integer:=0; BEGIN
  FOR x IN SELECT j.id,a.offering_member_id,a.member_needing_movement_id FROM public.journeys j JOIN public.alignments a ON a.id=j.alignment_id WHERE j.status='completed' AND NOT EXISTS(SELECT 1 FROM private.funded_movement_completions f WHERE f.alignment_id=a.id) LOOP
   n:=n+1;
   IF private.movement_member_priority_v1(x.offering_member_id,0,'offerer_initiated_1_seat_v1')<>17.5 OR private.movement_member_priority_v1(x.member_needing_movement_id,0,'offerer_initiated_1_seat_v1')<>17.5 THEN RAISE EXCEPTION 'Generic completed lifecycle falsely ranked'; END IF;
   INSERT INTO public.journey_reviews(journey_id,reviewer_member_id,reviewed_member_id,overall_rating) VALUES(x.id,x.offering_member_id,x.member_needing_movement_id,5);
   IF private.movement_member_priority_v1(x.member_needing_movement_id,0,'offerer_initiated_1_seat_v1')<>17.5 THEN RAISE EXCEPTION 'Untrusted review falsely ranked'; END IF;
  END LOOP;
  IF n=0 THEN RAISE EXCEPTION 'Missing genuine generic completion fixture'; END IF;
  RAISE NOTICE 'PASS % genuine generic completions and reviews cannot rank',n;
 END; $generic$;`;
 const legacyOutput=c.target(legacy.replace(/ROLLBACK;\s*$/,generic+' ROLLBACK;'));assert.doesNotMatch(legacyOutput,/\|f(?:\||$)/m);results.legacy0019=legacyOutput.split('\n').filter(l=>/\|t$/.test(l)).length;results.genericLifecycleAndReviewProvenance=3;console.log('PASS '+results.legacy0019+' legacy assertions and generic completion/review exclusion');
 fs.writeFileSync('docs/0089-regression-results.json',JSON.stringify(results,null,2)+'\n');
 });}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});module.exports={main};
