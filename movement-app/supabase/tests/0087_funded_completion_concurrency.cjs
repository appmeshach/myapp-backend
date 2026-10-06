'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const {run}=require('./0087_funded_completion_harness.cjs'),{support}=require('./0087_funded_completion_test_support.cjs');
async function main(){await run(async c=>{
 const h=support(c);let scenarios=0;
 const action=(f,key,actor)=>c.action(f,key,actor,key===h.dispute?'completion_concern':undefined);
 const caught=(f,key,actor)=>`DO $$ BEGIN PERFORM set_config('request.jwt.claim.sub','${actor}',true); SET LOCAL ROLE authenticated; BEGIN PERFORM * FROM public.${key}('${f.need}'${key===h.dispute?",'completion_concern'":''}); RAISE EXCEPTION 'Unexpected success'; EXCEPTION WHEN check_violation THEN RAISE NOTICE 'EXPECTED_REJECTION'; END; RESET ROLE; END $$;`;
 async function race(f,first,second,{actor1=f.requester,actor2=f.requester,rollback=false,reject=false,label}={}){
  const a=new c.Session(),b=new c.Session();await a.begin();await b.begin();await a.send(action(f,first,actor1));const pending=b.send(reject?caught(f,second,actor2):action(f,second,actor2));
  await c.blocked(a,b,label);await a.send(rollback?'ROLLBACK;':'COMMIT;');await pending;await b.send('COMMIT;');if(reject)assert.match(b.err,/EXPECTED_REJECTION/);
  assert.doesNotMatch(a.err+b.err,/ERROR|40P01|deadlock|timed out|timeout expired/i);a.close();b.close();scenarios++;
 }
 const terminal=(f,review,method)=>{assert.equal(c.target(`SELECT count(*) FROM private.funded_completion_disputes WHERE alignment_id='${f.alignment}';`),review?'1':'0');assert.equal(c.target(`SELECT count(*) FROM private.funded_movement_completions WHERE alignment_id='${f.alignment}';`),review?'0':'1');if(!review)assert.equal(c.target(`SELECT completion_method FROM private.funded_movement_completions WHERE alignment_id='${f.alignment}';`),method);c.target(`SELECT private.assert_funded_coordination_entry('${f.alignment}');`);};
 for(const reviewFirst of [true,false])for(const rollback of [false,true]){
  const f=c.fresh({started:true});h.requested(f);const before=h.economics(f),money=h.money();
  const actor=h.instrument('private.require_funded_completion_actor()',"(SELECT response_deadline_at-interval '1 microsecond' FROM private.funded_completion_response_windows WHERE alignment_id=NEW.alignment_id)"),review=h.instrument('private.require_completion_dispute_actor()',"(SELECT response_deadline_at-interval '1 microsecond' FROM private.funded_completion_response_windows WHERE alignment_id=NEW.alignment_id)");
  try{await race(f,reviewFirst?h.dispute:h.confirm,reviewFirst?h.confirm:h.dispute,{rollback,reject:!rollback,label:`in-window boundary confirm vs review reviewFirst=${reviewFirst} rollback=${rollback}`});terminal(f,reviewFirst!==rollback,'requester_confirmed');if(reviewFirst!==rollback)assert.equal(h.money(),money);else h.assertSettlement(f,before);}finally{review();actor();}
 }
 for(const reviewFirst of [true,false])for(const rollback of [false,true]){
  const f=c.fresh({started:true});h.requested(f,{expired:true});
  // Isolate the before-deadline review admission and later timeout sample. No
  // historical row edits or predicates are removed; this models the boundary.
  const restore=h.instrument('private.require_completion_dispute_actor()',"(SELECT response_deadline_at-interval '1 second' FROM private.funded_completion_response_windows WHERE alignment_id=NEW.alignment_id)");
  try{await race(f,reviewFirst?h.dispute:h.read,reviewFirst?h.read:h.dispute,{actor1:reviewFirst?f.requester:f.offerer,actor2:reviewFirst?f.offerer:f.requester,rollback,reject:!reviewFirst&&!rollback,label:`timeout vs review reviewFirst=${reviewFirst} rollback=${rollback}`});terminal(f,reviewFirst!==rollback,'response_timeout');}finally{restore();}
 }
 for(const confirmFirst of [true,false])for(const rollback of [false,true]){
  const f=c.fresh({started:true});h.requested(f,{expired:true});const before=h.economics(f);await race(f,confirmFirst?h.confirm:h.read,confirmFirst?h.read:h.confirm,{actor1:confirmFirst?f.requester:f.offerer,actor2:confirmFirst?f.offerer:f.requester,rollback,label:`late confirm vs timeout confirmFirst=${confirmFirst} rollback=${rollback}`});terminal(f,false,'response_timeout');h.assertSettlement(f,before);
 }
 for(const confirmFirst of [true,false])for(const rollback of [false,true]){
  const f=c.fresh({started:true});h.requested(f);const before=h.economics(f);
  const actor=h.instrument('private.require_funded_completion_actor()',`(SELECT response_deadline_at+CASE WHEN auth.uid()='${f.requester}'::uuid THEN -interval '1 microsecond' ELSE interval '0 seconds' END FROM private.funded_completion_response_windows WHERE alignment_id=NEW.alignment_id)`),status=h.instrument('public.'+h.read+'(uuid)',`(SELECT x.response_deadline_at FROM private.funded_completion_response_windows x WHERE x.alignment_id='${f.alignment}')`);
  try{await race(f,confirmFirst?h.confirm:h.read,confirmFirst?h.read:h.confirm,{actor1:confirmFirst?f.requester:f.offerer,actor2:confirmFirst?f.offerer:f.requester,rollback,label:`boundary confirm vs timeout confirmFirst=${confirmFirst} rollback=${rollback}`});terminal(f,false,confirmFirst!==rollback?'requester_confirmed':'response_timeout');h.assertSettlement(f,before);}finally{status();actor();}
 }
 for(const reviewFirst of [true,false])for(const rollback of [false,true]){
  const f=c.fresh({started:true});h.requested(f);const before=h.economics(f),money=h.money();
  const actor=h.instrument('private.require_funded_completion_actor()',"(SELECT response_deadline_at FROM private.funded_completion_response_windows WHERE alignment_id=NEW.alignment_id)"),review=h.instrument('private.require_completion_dispute_actor()',"(SELECT response_deadline_at-interval '1 microsecond' FROM private.funded_completion_response_windows WHERE alignment_id=NEW.alignment_id)");
  try{await race(f,reviewFirst?h.dispute:h.confirm,reviewFirst?h.confirm:h.dispute,{rollback,reject:!rollback,label:`boundary late confirm vs review reviewFirst=${reviewFirst} rollback=${rollback}`});terminal(f,reviewFirst!==rollback,'response_timeout');if(reviewFirst!==rollback)assert.equal(h.money(),money);else h.assertSettlement(f,before);}finally{review();actor();}
 }
 for(const rollback of [false,true]){
  const f=c.fresh({started:true});h.requested(f);const before=h.economics(f);
  c.target(`CREATE TABLE private._0087_admission_clock(observed timestamptz NOT NULL); INSERT INTO private._0087_admission_clock SELECT response_deadline_at-interval '1 microsecond' FROM private.funded_completion_response_windows WHERE alignment_id='${f.alignment}';`);
  const restore=h.instrument('private.require_funded_completion_actor()',"(SELECT observed FROM private._0087_admission_clock)");
  try{const a=new c.Session(),b=new c.Session();await a.begin();await b.begin();await a.send(`SELECT id FROM private.wallet_accounts WHERE member_id='${f.requester}' ORDER BY id FOR UPDATE;`);const pending=b.send(action(f,h.confirm,f.requester));await c.blocked(a,b,'confirm deadline crosses during wallet wait rollback='+rollback);
   c.target(`UPDATE private._0087_admission_clock SET observed=(SELECT response_deadline_at FROM private.funded_completion_response_windows WHERE alignment_id='${f.alignment}');`);
   await a.send(rollback?'ROLLBACK;':'COMMIT;');await pending;await b.send('COMMIT;');assert.doesNotMatch(a.err+b.err,/ERROR|40P01|deadlock|timed out/i);a.close();b.close();scenarios++;terminal(f,false,'response_timeout');h.assertSettlement(f,before);
  }finally{restore();c.target('DROP TABLE private._0087_admission_clock;');}
 }
 for(const key of [h.read,h.dispute])for(const rollback of [false,true]){const f=c.fresh({started:true});h.requested(f,{expired:key===h.read});await race(f,key,key,{rollback,label:`duplicate ${key} rollback=${rollback}`});terminal(f,key===h.dispute,'response_timeout');}
 for(const offererFirst of [false,true]){const f=c.fresh({started:true});h.requested(f,{expired:true});await race(f,h.read,h.read,{actor1:offererFirst?f.offerer:f.requester,actor2:offererFirst?f.requester:f.offerer,label:'principal status refresh vs timeout offererFirst='+offererFirst});terminal(f,false,'response_timeout');}
 for(const completionFirst of [false,true]){
  const f=c.fresh({started:true,offerer:'00000000-0000-4000-8000-0000000087aa',requester:'00000000-0000-4000-8000-0000000087bb'}),g=c.fresh({started:true,offerer:f.offerer,requester:f.requester});h.requested(f);h.requested(g,{expired:true});
  const a=new c.Session(),b=new c.Session();await a.begin();await b.begin();await a.send(completionFirst?action(g,h.read,g.offerer):action(f,h.dispute,f.requester));const pending=b.send(completionFirst?action(f,h.dispute,f.requester):action(g,h.read,g.offerer));await c.blocked(a,b,'shared principal timeout/review completionFirst='+completionFirst);await a.send('COMMIT;');await pending;await b.send('COMMIT;');assert.doesNotMatch(a.err+b.err,/ERROR|40P01|deadlock|timed out/i);a.close();b.close();scenarios++;terminal(f,true);terminal(g,false,'response_timeout');
 }
 for(const rollback of [false,true]){
  const f=c.fresh({started:true});h.requested(f,{expired:true});const a=new c.Session(),b=new c.Session();await a.begin();await b.begin();await a.send(`SELECT id FROM private.wallet_accounts WHERE member_id='${f.requester}' ORDER BY id FOR UPDATE;`);const pending=b.send(action(f,h.read,f.offerer));await c.blocked(a,b,'timeout waits on wallet account rollback='+rollback);await a.send(rollback?'ROLLBACK;':'COMMIT;');await pending;await b.send('COMMIT;');assert.doesNotMatch(a.err+b.err,/ERROR|40P01|deadlock|timed out/i);a.close();b.close();scenarios++;terminal(f,false,'response_timeout');
 }
 {const f=c.fresh({started:true});h.requested(f);const a=new c.Session(),b=new c.Session();await a.begin();await b.begin();await a.send(`SELECT id FROM private.wallet_accounts WHERE member_id='${f.requester}' ORDER BY id FOR UPDATE;`);await b.send(action(f,h.dispute,f.requester));await b.send('COMMIT;');await a.send('ROLLBACK;');assert.doesNotMatch(a.err+b.err,/ERROR|40P01|deadlock|timed out/i);a.close();b.close();scenarios++;terminal(f,true);}
 assert.equal(c.target('SELECT deadlocks FROM pg_stat_database WHERE datname=current_database();'),'0');const result={scenarios,blockingProofs:c.proofs,deadlocks:0,walletAccountGateBypassed:true};fs.writeFileSync('docs/0087-concurrency-results.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
 });}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});module.exports={main};
