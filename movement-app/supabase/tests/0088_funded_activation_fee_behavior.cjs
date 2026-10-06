'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const {run}=require('./0088_funded_activation_fee_harness.cjs'),{support}=require('./0088_funded_activation_fee_test_support.cjs');
async function main(){let legacy,legacyState;await run(async c=>{
 const h=support(c);let checks=0;const check=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;console.log('PASS '+label);};
 check(h.state(),legacyState,'upgrade changes no existing business evidence or ledger');
 check(c.target('SELECT count(*) FROM private.funded_activation_fee_legacy;'),String(legacy.length),'exact old-policy boundary');
 for(const f of legacy){check(c.target(`SELECT count(*) FROM private.funded_activation_fee_finalizations WHERE alignment_id='${f.alignment}';`),'0','old activation never reinterpreted as finalization');c.target(`SELECT private.assert_activation_fee_finalization('${f.agreement}');`);checks++;}
 const pendingLegacy=legacy[0],legacyAmounts=h.amounts(pendingLegacy),legacyMoney=h.economics(pendingLegacy);
 check(c.result(pendingLegacy,'request_my_movement_end',pendingLegacy.offerer).ok,true,'old pending activation retains explicit mutual consent');
 const legacyClosed=c.result(pendingLegacy,'confirm_my_movement_end',pendingLegacy.requester);check(legacyClosed.ok,true,'old pending graph records non-financial no travel');check(legacyClosed.rows[0].released_minor,null,'old pending activation cannot create a new R+C release');check(h.economics(pendingLegacy),legacyMoney,'old policy remains truthful with R+C held and no invented earned activation R');
 for(const zero of [false,true]){
  const f=c.fresh({stage:'hold',zero}),amount=h.amounts(f),before=h.economics(f);
  check(before.held,amount.requester_platform_share+amount.movement_contribution,'pre-activation exact R+C held');
  check(c.target(`SELECT count(*) FROM private.wallet_transactions WHERE alignment_id='${f.alignment}' AND transaction_kind='requester_platform_charge';`),'0','no pre-activation charge');
  check(h.activate(f).ok,true,'successful activation');h.assertFee(f);checks++;
  check(h.economics(f),{held:amount.movement_contribution,withdrawable:before.withdrawable,revenue:before.revenue+amount.requester_platform_share},'activation exact R revenue / C held / O uncharged');
  check(c.target(`SELECT f.finalized_at=a.activated_at AND f.amount_minor=c.amount_minor AND f.currency=g.currency AND f.requester_member_id=g.member_needing_movement_id AND f.financial_component_id=c.id FROM private.funded_activation_fee_finalizations f JOIN private.funded_movement_activations a USING(financial_agreement_id,alignment_id) JOIN private.financial_agreements g ON g.id=f.financial_agreement_id JOIN private.financial_components c ON c.id=f.financial_component_id WHERE f.alignment_id='${f.alignment}';`),'t','exact finite paired immutable fee provenance');
  const replay=h.state(),fee=h.feeState(f);check(h.activate(f).ok,true,'duplicate activation succeeds');check(h.state(),replay,'activation replay zero business writes');check(h.feeState(f),fee,'activation replay zero fee changes');
  if(zero)check(amount.requester_platform_share,0,'genuine zero R no fabricated transaction');
  for(const method of ['requester_confirmed','response_timeout']){
   const done=c.fresh({started:true,zero});h.requested(done,{expired:method==='response_timeout'});const money=h.economics(done),r=c.result(done,method==='response_timeout'?h.read:h.confirm,method==='response_timeout'?done.offerer:done.requester);
   check(r.ok,true,'completion '+method);check(r.rows[0].completion_method,method,'truthful completion '+method);h.assertSettlement(done,money);checks++;
   const a=h.amounts(done);check(h.economics(done).held,0,'completion drains only C');check(h.economics(done).withdrawable,a.movement_contribution-a.offering_platform_share,'offerer exact C-O');
   const replay=h.state(),fee=h.feeState(done);check(c.result(done,h.confirm,done.requester).ok,true,'terminal completion replay');check(h.state(),replay,'zero duplicate completion settlement');check(h.feeState(done),fee,'R never charged twice or rewritten');
  }
  const closed=c.fresh({zero}),a=h.amounts(closed),old=h.economics(closed);
  check(c.result(closed,'request_my_movement_end',closed.offerer).ok,true,'first explicit no-travel consent');check(c.result(closed,'confirm_my_movement_end',closed.offerer).ok,false,'one-sided refund remains impossible');
  const result=c.result(closed,'confirm_my_movement_end',closed.requester);check(result.ok,true,'second explicit no-travel consent');check(result.rows[0].released_minor,null,'safe projection never claims release');
  check(result.rows[0].funding_disposition,'held_review_required','contribution remains held for future review');check(result.rows[0].end_status,'no_travel_held','distinct no-travel receipt state');
  check(h.economics(closed),old,'no-travel moves no R / C / O');
  check(c.target(`SELECT count(*) FROM private.wallet_transactions WHERE alignment_id='${closed.alignment}' AND transaction_kind='movement_hold_release';`),'0','mutual consent cannot release C or R');
  check(c.target(`SELECT count(*) FROM private.funded_no_travel_closures WHERE alignment_id='${closed.alignment}';`),'0','no fabricated old release receipt');
  check(c.target(`SELECT count(*) FROM private.funded_movement_disputes WHERE alignment_id='${closed.alignment}';`),'0','schedule change does not invent allegation');
  for(const key of ['request_my_funded_movement_start','confirm_my_funded_movement_start','request_my_funded_movement_completion','confirm_my_funded_movement_completion'])check(c.result(closed,key,key.startsWith('request')?closed.offerer:closed.requester).ok,false,'held no-travel blocks '+key);
  check(c.target(`SELECT count(*) FROM private.wallet_transactions t JOIN private.financial_components c ON c.id=t.financial_component_id WHERE t.alignment_id='${closed.alignment}' AND t.transaction_kind='movement_hold_release' AND c.component_key='requester_platform_share';`),'0','no requester-fee release');h.assertFee(closed);checks++;
  const stable=h.state();check(c.result(closed,'confirm_my_movement_end',closed.requester).ok,true,'no-travel replay');check(h.state(),stable,'no duplicate release');
  const disputed=c.fresh({zero}),money=h.money();check(c.result(disputed,'open_my_funded_movement_dispute',disputed.offerer,'movement_concern').ok,true,'0086 pre-start dispute');
  check(c.result(disputed,'confirm_my_funded_movement_start',disputed.requester).ok,false,'pre-start dispute blocks actual start');check(h.money(),money,'0086 freezes C and retains R');h.assertFee(disputed);checks++;
  const reviewed=c.fresh({zero,started:true});h.requested(reviewed);const held=h.money();check(c.result(reviewed,h.dispute,reviewed.requester,'completion_concern').ok,true,'0087 requester review');check(c.result(reviewed,h.confirm,reviewed.requester).ok,false,'review blocks settlement');check(h.money(),held,'0087 holds C and retains R');h.assertFee(reviewed);checks++;
 }
 // Actual rollback includes activation, finalization, revenue provisioning and ledger.
 const rollback=c.fresh({stage:'hold'}),before=h.state(),feeBefore=h.feeState(rollback);
 c.target('BEGIN; '+h.activationAction(rollback)+' ROLLBACK;');check(h.state(),before,'activation rollback zero business writes');check(h.feeState(rollback),feeBefore,'activation rollback zero receipt/charge');
 const failed=c.fresh({stage:'hold'});c.target(`UPDATE private.wallet_accounts SET status='closed' WHERE member_id='${failed.requester}' AND account_kind='member_withdrawable';`);const failState=h.state();check(h.activate(failed).ok,false,'closed account fails activation');check(h.state(),failState,'failed activation leaves no partial graph');check(c.target(`SELECT count(*) FROM private.funded_activation_fee_finalizations WHERE alignment_id='${failed.alignment}';`),'0','failed activation no fee receipt');
 const unheld=c.fresh({stage:'agreement'});check(h.activate(unheld).ok,false,'unfunded activation cannot charge');
 for(const who of [rollback.offerer,rollback.traveller,null]){const old=h.state();check(h.activate(rollback,who).ok,false,'exact authenticated requester only');check(h.state(),old,'unauthorized activation atomic');}
 const malformed=c.fresh({stage:'hold'}),other=c.fresh({stage:'hold'});
 const attempt=(mut={})=>{
  const x={alignment:'a.id',component:'component.id',requester:'g.member_needing_movement_id',amount:'component.amount_minor',currency:'g.currency',feeStamp:'stamp',kind:"'requester_platform_charge'",txAlignment:'a.id',txCurrency:'g.currency',txStamp:'stamp',debit:'held_id',credit:'revenue_id',debitDirection:"'debit'",postingAmount:'component.amount_minor',postingStamp:'stamp',...mut};
  return `BEGIN; SET CONSTRAINTS ALL DEFERRED; SELECT set_config('request.jwt.claim.sub','${malformed.requester}',true); DO $$ DECLARE g private.financial_agreements%ROWTYPE; a public.alignments%ROWTYPE; component private.financial_components%ROWTYPE; stamp timestamptz; held_id uuid; revenue_id uuid; tx uuid; BEGIN
   g:=private.funded_activation_agreement('${malformed.agreement}',1,true); SELECT * INTO STRICT a FROM public.alignments WHERE id=g.alignment_id; PERFORM private.assert_alignment_face_ready(a.id);
   SELECT * INTO STRICT component FROM private.financial_components WHERE agreement_id=g.id AND component_key='requester_platform_share';
   SELECT id INTO STRICT held_id FROM private.wallet_accounts WHERE member_id=g.member_needing_movement_id AND account_kind='member_held';
   INSERT INTO private.wallet_accounts(member_id,account_kind,currency) VALUES(NULL,'platform_revenue',g.currency) ON CONFLICT(account_kind,currency) WHERE member_id IS NULL DO NOTHING;
   SELECT id INTO STRICT revenue_id FROM private.wallet_accounts WHERE member_id IS NULL AND account_kind='platform_revenue' AND currency=g.currency;
   stamp:=clock_timestamp(); INSERT INTO private.funded_movement_activations VALUES(g.id,a.id,stamp);
   INSERT INTO private.funded_movement_activation_faces SELECT g.id,r.member_id,(SELECT id FROM private.alignment_face_verifications WHERE alignment_id=a.id AND member_id=r.member_id ORDER BY attempt_ordinal DESC LIMIT 1) FROM private.required_face_members(a.id) r;
   INSERT INTO private.funded_activation_fee_finalizations VALUES(g.id,${x.alignment},${x.component},${x.requester},${x.amount},${x.currency},${x.feeStamp});
   INSERT INTO private.wallet_transactions(transaction_kind,currency,alignment_id,financial_component_id,idempotency_key,created_at) VALUES(${x.kind},${x.txCurrency},${x.txAlignment},component.id,'requester_platform_charge:'||component.id::text,${x.txStamp}) RETURNING id INTO tx;
   INSERT INTO private.wallet_postings(transaction_id,account_id,direction,amount_minor,created_at) VALUES(tx,${x.debit},${x.debitDirection},${x.postingAmount},${x.postingStamp}),(tx,${x.credit},'credit',component.amount_minor,stamp);
   UPDATE public.alignments SET status='activated',activated_at=stamp,updated_at=stamp WHERE id=a.id;
  END $$; COMMIT;`;
 };
 for(const [label,mut] of Object.entries({alignment:{alignment:`'${other.alignment}'::uuid`},component:{component:`(SELECT id FROM private.financial_components WHERE agreement_id=g.id AND component_key='movement_contribution')`},requester:{requester:`'${other.requester}'::uuid`},amount:{amount:'component.amount_minor+1'},currency:{currency:"'USD'"},receiptTimestamp:{feeStamp:"stamp-interval '1 microsecond'"},transactionAlignment:{txAlignment:`'${other.alignment}'::uuid`},transactionCurrency:{txCurrency:"'USD'"},transactionTimestamp:{txStamp:"stamp+interval '1 microsecond'"},transactionKind:{kind:"'movement_hold_release'"},account:{debit:`(SELECT id FROM private.wallet_accounts WHERE member_id=g.member_needing_movement_id AND account_kind='member_available')`},direction:{debitDirection:"'credit'"},postingAmount:{postingAmount:'component.amount_minor+1'},postingTimestamp:{postingStamp:"stamp+interval '1 microsecond'"}})){
  const old=h.state();assert.throws(()=>c.target(attempt(mut)),/23514|23503|23505/);checks++;check(h.state(),old,'forged '+label+' rolls back complete graph');check(c.target(`SELECT count(*) FROM private.funded_activation_fee_finalizations WHERE alignment_id='${malformed.alignment}';`),'0','forged '+label+' no finalization');
 }
 c.target(attempt());checks++;h.assertFee(malformed);checks++;
 for(const table of ['funded_activation_fee_finalizations','funded_activation_fee_legacy']){
  check(c.target(`SELECT relrowsecurity FROM pg_class WHERE oid='private.${table}'::regclass;`),'t','fee RLS');
  for(const role of ['anon','authenticated','service_role'])for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'])check(c.target(`SELECT has_table_privilege('${role}','private.${table}','${privilege}');`),'f','private fee '+role+' '+privilege);
  for(const command of [`UPDATE private.${table} SET alignment_id=alignment_id WHERE false`,`DELETE FROM private.${table} WHERE false`,`TRUNCATE private.${table} CASCADE`]){assert.throws(()=>c.target(command),/23514/);checks++;}
 }
 assert.throws(()=>c.target(`INSERT INTO private.funded_activation_fee_legacy SELECT financial_agreement_id,alignment_id,activated_at FROM private.funded_movement_activations WHERE false;`),/23514/);checks++;
 for(const signature of ['activation_fee_is_finalized(uuid)','assert_activation_fee_finalization(uuid)','require_activation_fee_actor()','validate_activation_fee_graph()']){
  check(c.target(`SELECT prosecdef AND proconfig=ARRAY['search_path=""'] FROM pg_proc WHERE oid='private.${signature}'::regprocedure;`),'t','private definer empty search path');
  for(const role of ['anon','authenticated','service_role'])check(c.target(`SELECT has_function_privilege('${role}','private.${signature}','EXECUTE');`),'f','no private app execution');
 }
 for(const role of ['anon','authenticated','service_role'])check(c.target(`SELECT has_function_privilege('${role}','public.activate_my_funded_movement(uuid,integer)','EXECUTE');`),role==='authenticated'?'t':'f','activation authenticated only');
 for(const role of ['authenticated','service_role']){
  check(h.call(rollback,`SELECT private.assert_activation_fee_finalization('${rollback.agreement}')`,rollback.requester,role).ok,false,'actual private helper denied '+role);
  check(h.call(rollback,`INSERT INTO private.funded_activation_fee_finalizations SELECT * FROM private.funded_activation_fee_finalizations`,rollback.requester,role).ok,false,'actual direct table denied '+role);
  check(h.call(rollback,`INSERT INTO private.wallet_transactions(transaction_kind,currency,alignment_id,financial_component_id,idempotency_key) SELECT 'requester_platform_charge','NGN','${rollback.alignment}',id,'forged:'||id FROM private.financial_components WHERE agreement_id='${rollback.agreement}' AND component_key='requester_platform_share'`,rollback.requester,role).ok,false,'actual direct ledger denied '+role);
 }
 const fake=h.state();assert.throws(()=>c.target(`BEGIN; SELECT set_config('request.jwt.claim.sub','${rollback.requester}',true); INSERT INTO private.wallet_transactions(transaction_kind,currency,alignment_id,financial_component_id,idempotency_key) SELECT 'requester_platform_charge','NGN','${rollback.alignment}',id,'requester_platform_charge:'||id FROM private.financial_components WHERE agreement_id='${rollback.agreement}' AND component_key='requester_platform_share'; COMMIT;`),/23514/);checks++;check(h.state(),fake,'receiptless charge impossible');
 const temporal=c.fresh({stage:'hold'}),restore=h.instrument('public.activate_my_funded_movement(uuid,integer)',`(SELECT h.fully_held_at-interval '1 day' FROM private.movement_funding_holds h WHERE h.financial_agreement_id='${temporal.agreement}')`);
 try{const result=h.activate(temporal);check(result.ok,true,'regressed activation observation accepted by immutable provenance: '+JSON.stringify(result));}finally{restore();}
 check(c.target(`SELECT a.activated_at<h.fully_held_at FROM private.funded_movement_activations a JOIN private.movement_funding_holds h USING(financial_agreement_id) WHERE a.financial_agreement_id='${temporal.agreement}';`),'t','regressed observation relationship actually holds');
 h.assertFee(temporal);checks++;const history=h.state(),feeHistory=h.feeState(temporal),later=h.instrument('public.get_my_movement_activation_status(uuid,integer)',"clock_timestamp()-interval '2 days'");
 try{check(h.call(temporal,`SELECT * FROM public.get_my_movement_activation_status('${temporal.agreement}',1)`).ok,true,'later regressed sample preserves activation history');check(h.activate(temporal).ok,true,'regressed activation exact replay');check(h.state(),history,'regressed read/replay no business writes');check(h.feeState(temporal),feeHistory,'regressed read/replay no fee writes');}finally{later();}
 for(const name of ['private.assert_activation_fee_finalization(uuid)','private.assert_funded_no_travel(uuid)','private.assert_undisposed_funded_graph(uuid)'])check(h.definition(name).includes('clock_timestamp()'),false,'historical '+name+' never resamples clock');
 check(c.target("SELECT bool_and(amount_minor>0) FROM private.financial_components WHERE component_key='movement_contribution';"),'t','current positive-seat economics cannot legitimately produce zero C');
 assert.throws(()=>c.target(`UPDATE private.financial_components SET amount_minor=0 WHERE agreement_id='${malformed.agreement}' AND component_key='movement_contribution';`),/23514/);checks++;
 assert.throws(()=>c.target("SELECT * FROM private.calculate_financial_proposal_economics(0,1,'shared_platform_fee_v1','equal_split_requester_remainder_v1');"),/23514/);checks++;
 for(const mode of ['IMMEDIATE','DEFERRED']){const f=c.fresh({stage:'hold'});c.target('BEGIN; SET CONSTRAINTS ALL '+mode+'; '+h.activationAction(f)+' COMMIT;');h.assertFee(f);checks++;}
 const output={passed:checks,failed:0};fs.writeFileSync('docs/0088-policy-behavior-results.json',JSON.stringify(output,null,2)+'\n');console.log('PASS '+checks+' PostgreSQL 0088 behavior/security assertions');
 },{beforeInstall(c){const h=require('./0087_funded_completion_test_support.cjs').support(c);legacy=[];for(const state of ['activated','completed','cancelled','disputed']){const f=c.fresh({started:state==='completed'});if(state==='completed'){h.requested(f);assert(c.result(f,h.confirm,f.requester).ok);}if(state==='cancelled'){assert(c.result(f,'request_my_movement_end',f.offerer).ok);assert(c.result(f,'confirm_my_movement_end',f.requester).ok);}if(state==='disputed')assert(c.result(f,'open_my_funded_movement_dispute',f.offerer,'movement_concern').ok);legacy.push(f);}legacyState=h.state();}});}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});module.exports={main};
