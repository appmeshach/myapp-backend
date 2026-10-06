'use strict';
const assert=require('node:assert/strict');
function support(c){
 const read='get_my_funded_movement_completion_status',request='request_my_funded_movement_completion',confirm='confirm_my_funded_movement_completion',dispute='dispute_my_funded_movement_completion';
 const definition=signature=>c.target(`SELECT pg_get_functiondef('${signature}'::regprocedure);`);
 function instrument(signature,expression){const original=definition(signature);assert(original.includes('clock_timestamp()'),signature);c.target(original.replaceAll('clock_timestamp()',expression));return ()=>c.target(original);}
 function requested(f,{expired=false,offset}={}){
  const restores=[];try{
   if(expired||offset)restores.push(instrument('public.'+request+'(uuid)',expired?"clock_timestamp()-interval '13 hours'":offset));
   if(expired||offset)restores.push(instrument('public.'+read+'(uuid)',expired?"clock_timestamp()-interval '13 hours'":offset));
   const result=c.result(f,request,f.offerer);assert.equal(result.ok,true,JSON.stringify(result));return result.rows[0];
  }finally{for(const restore of restores.reverse())restore();}
 }
 const money=()=>c.target("SELECT jsonb_build_object('accounts',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM private.wallet_accounts x),'transactions',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM private.wallet_transactions x),'postings',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM private.wallet_postings x),'components',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM private.financial_components x),'members',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.members x),'principals',(SELECT jsonb_agg(to_jsonb(x) ORDER BY alignment_id,member_id) FROM private.completed_movement_principals x),'ratings',(SELECT jsonb_agg(to_jsonb(x) ORDER BY alignment_id,reviewer_member_id) FROM private.completed_movement_ratings x));");
 const state=()=>c.target("SELECT jsonb_build_object('money',"+"'"+money().replaceAll("'","''")+"'::jsonb,'requests',(SELECT jsonb_agg(to_jsonb(x) ORDER BY alignment_id) FROM private.funded_movement_completion_requests x),'windows',(SELECT jsonb_agg(to_jsonb(x) ORDER BY alignment_id) FROM private.funded_completion_response_windows x),'reviews',(SELECT jsonb_agg(to_jsonb(x) ORDER BY alignment_id) FROM private.funded_completion_disputes x),'completions',(SELECT jsonb_agg(to_jsonb(x) ORDER BY alignment_id) FROM private.funded_movement_completions x),'journeys',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.journeys x),'alignments',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.alignments x));");
 const sql=expressions=>c.target(expressions);
 function economics(f){return JSON.parse(c.target(`SELECT jsonb_build_object('held',(SELECT coalesce(sum(CASE WHEN p.direction='credit' THEN p.amount_minor::numeric ELSE -p.amount_minor::numeric END),0) FROM private.wallet_postings p JOIN private.wallet_accounts a ON a.id=p.account_id WHERE a.member_id='${f.requester}' AND a.account_kind='member_held'),'withdrawable',(SELECT coalesce(sum(CASE WHEN p.direction='credit' THEN p.amount_minor::numeric ELSE -p.amount_minor::numeric END),0) FROM private.wallet_postings p JOIN private.wallet_accounts a ON a.id=p.account_id WHERE a.member_id='${f.offerer}' AND a.account_kind='member_withdrawable'),'revenue',(SELECT coalesce(sum(CASE WHEN p.direction='credit' THEN p.amount_minor::numeric ELSE -p.amount_minor::numeric END),0) FROM private.wallet_postings p JOIN private.wallet_accounts a ON a.id=p.account_id WHERE a.account_kind='platform_revenue'));`));}
 function assertSettlement(f,before){
  const amounts=JSON.parse(c.target(`SELECT jsonb_object_agg(component_key,amount_minor) FROM private.financial_components WHERE agreement_id='${f.agreement}';`));
  assert.deepEqual(economics(f),{held:before.held-amounts.requester_platform_share-amounts.movement_contribution,withdrawable:before.withdrawable+amounts.movement_contribution-amounts.offering_platform_share,revenue:before.revenue+amounts.requester_platform_share+amounts.offering_platform_share});
  assert.equal(c.target(`SELECT bool_and((fc.amount_minor=0 AND NOT EXISTS(SELECT 1 FROM private.wallet_transactions t WHERE t.financial_component_id=fc.id AND t.transaction_kind<>'movement_hold')) OR (fc.amount_minor>0 AND (SELECT count(*) FROM private.wallet_transactions t WHERE t.financial_component_id=fc.id AND t.transaction_kind IN('requester_platform_charge','movement_contribution_settlement','offering_platform_charge'))=1)) FROM private.financial_components fc WHERE fc.agreement_id='${f.agreement}';`),'t');
  c.target(`SELECT private.assert_funded_coordination_entry('${f.alignment}');`);
 }
 return {read,request,confirm,dispute,definition,instrument,requested,money,state,sql,economics,assertSettlement};
}
module.exports={support};
