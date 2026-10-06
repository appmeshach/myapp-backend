'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');const {run}=require('./0087_funded_completion_harness.cjs'),{support}=require('./0087_funded_completion_test_support.cjs');
async function main(){await run(async c=>{
 const h=support(c);let checks=0;const check=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;console.log('PASS '+label);};
 for(const relation of ['equal','regressed']){
  const f=c.fresh({started:true});h.requested(f,{offset:`(SELECT started_at${relation==='regressed'?"-interval '1 day'":''} FROM public.journeys WHERE id='${f.journey}')`});
  check(c.target(`SELECT q.requested_at${relation==='equal'?'=':'<'}j.started_at FROM private.funded_movement_completion_requests q JOIN public.journeys j ON j.id=q.journey_id WHERE q.alignment_id='${f.alignment}';`),'t',relation+' request clock relationship');
  // Old request metadata may already be expired; suppress only the live status
  // sample to inspect confirmation causality independently of timeout policy.
  const restoreStatus=h.instrument('public.'+h.read+'(uuid)',`(SELECT requested_at FROM private.funded_completion_response_windows WHERE alignment_id='${f.alignment}')`);
  const restoreStamp=h.instrument('private.require_funded_completion_actor()',`(SELECT requested_at${relation==='regressed'?"-interval '1 day'":''} FROM private.funded_completion_response_windows WHERE alignment_id=NEW.alignment_id)`);
  try{const result=c.result(f,h.confirm,f.requester);if(!result.ok)c.target(`BEGIN; SELECT set_config('request.jwt.claim.sub','${f.requester}',true); SELECT private.finalize_funded_completion('${f.need}','requester_confirmed'); ROLLBACK;`);check(result.ok,true,relation+' confirmed settlement accepted');check(result.rows[0].completion_method,'requester_confirmed','truthful method');}finally{restoreStamp();restoreStatus();}
  check(c.target(`SELECT r.completed_at${relation==='equal'?'=':'<'}q.requested_at FROM private.funded_movement_completions r JOIN private.funded_movement_completion_requests q USING(alignment_id) WHERE r.alignment_id='${f.alignment}';`),'t',relation+' completion clock relationship');
  const before=h.state();for(const signature of ['private.assert_funded_completion(uuid)','private.assert_funded_coordination_entry(uuid)']){check(h.definition(signature).includes('clock_timestamp()'),false,'historical '+signature+' no later clock');c.target(`SELECT ${signature.slice(0,signature.indexOf('('))}('${f.alignment}');`);checks++;}
  check(c.result(f,h.read,f.offerer).rows[0].settlement_state,'settled','historical settled read');check(c.result(f,h.confirm,f.requester).ok,true,'historical confirmed replay');check(h.state(),before,'historical validation/read/replay no writes');
  const rating=h.instrument('public.rate_my_completed_movement_person(uuid,integer,integer)',`(SELECT completed_at-interval '1 day' FROM private.funded_movement_completions WHERE alignment_id='${f.alignment}')`);
  try{c.target('BEGIN; '+c.as(f,f.requester,`SELECT * FROM public.rate_my_completed_movement_person('${f.need}',1,4);`)+' COMMIT;');checks++;}finally{rating();}
  check(c.target(`SELECT submitted_at<r.completed_at AND stars=4 FROM private.completed_movement_ratings v JOIN private.funded_movement_completions r USING(alignment_id) WHERE v.alignment_id='${f.alignment}';`),'t','explicit human rating accepts regressed metadata');
 }
 const f=c.fresh({started:true});h.requested(f);const before=h.state();
 assert.throws(()=>c.target(`BEGIN; SELECT set_config('request.jwt.claim.sub','${f.offerer}',true); INSERT INTO private.funded_movement_completions VALUES('${f.alignment}','${f.agreement}','${f.journey}',clock_timestamp()+interval '2 days','response_timeout'); COMMIT;`),/23514: Response window remains open/);checks++;check(h.state(),before,'forged future metadata cannot manufacture expired timeout admission');
 for(const offset of ['-interval \'1 microsecond\'','',"+interval '1 microsecond'"]){
  const fresh=c.fresh({started:true});h.requested(fresh);const restore=h.instrument('private.require_completion_dispute_actor()',`(SELECT response_deadline_at${offset} FROM private.funded_completion_response_windows WHERE alignment_id=NEW.alignment_id)`);try{check(c.result(fresh,h.dispute,fresh.requester,'completion_concern').ok,offset.startsWith('-'),'review deadline boundary '+offset);}finally{restore();}
 }
 for(const offset of ["-interval '1 microsecond'",'',"+interval '1 microsecond'"]){
  const f=c.fresh({started:true});h.requested(f);const before=h.economics(f);
  check(c.target(`SELECT count(*) FROM private.funded_movement_completions WHERE alignment_id='${f.alignment}';`),'0','boundary confirm before lazy materialization');
  const restore=h.instrument('private.require_funded_completion_actor()',`(SELECT response_deadline_at${offset} FROM private.funded_completion_response_windows WHERE alignment_id=NEW.alignment_id)`);
  try{const result=c.result(f,h.confirm,f.requester);check(result.ok,true,'boundary direct confirm '+offset);check(result.rows[0].completion_method,offset.startsWith('-')?'requester_confirmed':'response_timeout','boundary stored basis '+offset);}finally{restore();}
  check(c.target(`SELECT r.completed_at=w.response_deadline_at${offset} FROM private.funded_movement_completions r JOIN private.funded_completion_response_windows w USING(alignment_id) WHERE r.alignment_id='${f.alignment}';`),'t','boundary one authoritative sample '+offset);
  h.assertSettlement(f,before);checks++;const replay=h.state();check(c.result(f,h.confirm,f.requester).ok,true,'boundary terminal replay');check(h.state(),replay,'boundary replay no duplicate settlement');
 }
 const reviewed=c.fresh({started:true});h.requested(reviewed);check(c.result(reviewed,h.dispute,reviewed.requester,'completion_concern').ok,true,'review admitted in window');
 const frozen=h.state(),late=h.instrument('private.require_funded_completion_actor()',"clock_timestamp()+interval '2 days'"),lateStatus=h.instrument('public.'+h.read+'(uuid)',"clock_timestamp()+interval '2 days'");
 try{check(c.result(reviewed,h.confirm,reviewed.requester).ok,false,'committed review beats late confirm');check(c.result(reviewed,h.read,reviewed.offerer).rows[0].dispute_active,true,'committed review beats timeout');check(h.state(),frozen,'late actions leave reviewed graph and all money unchanged');}finally{lateStatus();late();}
 const timeout=c.fresh({started:true});h.requested(timeout);
 const status=h.instrument('public.'+h.read+'(uuid)',`(SELECT x.response_deadline_at FROM private.funded_completion_response_windows x WHERE x.alignment_id='${timeout.alignment}')`),actor=h.instrument('private.require_funded_completion_actor()',"(SELECT response_deadline_at FROM private.funded_completion_response_windows WHERE alignment_id=NEW.alignment_id)");
 try{const result=c.result(timeout,h.read,timeout.offerer);assert.equal(result.ok,true,JSON.stringify(result));check(result.rows[0].completion_method,'response_timeout','timeout exactly at deadline');}finally{actor();status();}
 check(c.target(`SELECT r.completed_at=w.response_deadline_at FROM private.funded_movement_completions r JOIN private.funded_completion_response_windows w USING(alignment_id) WHERE r.alignment_id='${timeout.alignment}';`),'t','timeout receipt exact admission sample');
 for(const signature of ['private.assert_funded_completion(uuid)','private.assert_funded_coordination_entry(uuid)']){
  const saved=h.definition(signature),old=require('../../docs/0087-installed-baseline-audit.json').functions.find(x=>x.signature===signature||x.name===signature.slice(0,signature.indexOf('('))).definition;
  c.target(old.replaceAll('clock_timestamp()',`(SELECT completed_at-interval '2 days' FROM private.funded_movement_completions WHERE alignment_id='${timeout.alignment}')`));
  try{assert.throws(()=>c.target(`SELECT ${signature.slice(0,signature.indexOf('('))}('${timeout.alignment}');`),/23514/);checks++;}finally{c.target(saved);}
 }
 const past=h.instrument('public.'+h.read+'(uuid)',`(SELECT x.completed_at-interval '2 days' FROM private.funded_movement_completions x WHERE x.alignment_id='${timeout.alignment}')`);
 const settled=h.state();try{check(c.result(timeout,h.read,timeout.requester).rows[0].completion_method,'response_timeout','later regressed sample retains historical timeout');check(c.result(timeout,h.confirm,timeout.requester).ok,true,'confirmed replay retains timeout truth');check(h.state(),settled,'regressed timeout historical truth zero writes');}finally{past();}
 for(const extra of ['requested_at','response_deadline_at','completion_method','settlement_timestamp','requester_identity','financial_amount']){assert.throws(()=>c.target('BEGIN; '+c.as(f,f.offerer,`SELECT * FROM public.${h.request}(p_movement_need_id=>'${f.need}',${extra}=>'forged');`)+' COMMIT;'),/42883/);checks++;}
 assert.throws(()=>c.target(`BEGIN; INSERT INTO public.journeys(alignment_id,vehicle_id,status,started_at,completed_at) SELECT gen_random_uuid(),vehicle_id,'completed',clock_timestamp(),clock_timestamp()-interval '1 day' FROM public.journeys WHERE id='${f.journey}'; COMMIT;`),/23514: Journey completion requires exact temporal provenance/);checks++;
 fs.writeFileSync('docs/0087-temporal-results.json',JSON.stringify({passed:checks,failed:0},null,2)+'\n');console.log('PASS '+checks+' PostgreSQL 0087 temporal assertions');
 });}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});module.exports={main};
