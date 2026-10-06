'use strict';
const assert=require('node:assert/strict');
function support(c){
 const h=require('./0087_funded_completion_test_support.cjs').support(c);
 const call=(f,sql,actor=f.requester,role='authenticated')=>JSON.parse(c.target(`BEGIN; SELECT ${f.schema}.snapshot_select_as('${role}',${actor===null?'NULL':"'"+actor+"'"},'${sql.replaceAll("'","''")}'); COMMIT;`).split('\n').filter(Boolean).at(-1));
 const activate=(f,actor=f.requester)=>call(f,`SELECT * FROM public.activate_my_funded_movement('${f.agreement}',1)`,actor);
 const activationAction=f=>c.as(f,f.requester,`SELECT * FROM public.activate_my_funded_movement('${f.agreement}',1);`);
 const amounts=f=>JSON.parse(c.target(`SELECT jsonb_object_agg(component_key,amount_minor) FROM private.financial_components WHERE agreement_id='${f.agreement}';`));
 const feeState=f=>c.target(`SELECT jsonb_build_object('activation',(SELECT to_jsonb(x) FROM private.funded_movement_activations x WHERE alignment_id='${f.alignment}'),'fee',(SELECT to_jsonb(x) FROM private.funded_activation_fee_finalizations x WHERE alignment_id='${f.alignment}'),'transactions',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM private.wallet_transactions x WHERE alignment_id='${f.alignment}'),'postings',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM private.wallet_postings p JOIN private.wallet_transactions t ON t.id=p.transaction_id WHERE t.alignment_id='${f.alignment}'));`);
 const assertFee=f=>{assert.equal(c.target(`SELECT count(*) FROM private.funded_activation_fee_finalizations WHERE alignment_id='${f.alignment}';`),'1');c.target(`SELECT private.assert_activation_fee_finalization('${f.agreement}');`);const r=amounts(f).requester_platform_share;assert.equal(c.target(`SELECT count(*) FROM private.wallet_transactions WHERE alignment_id='${f.alignment}' AND transaction_kind='requester_platform_charge';`),r>0?'1':'0');};
 const assertSettlement=(f,before)=>{const a=amounts(f);assert.deepEqual(h.economics(f),{held:before.held-a.movement_contribution,withdrawable:before.withdrawable+a.movement_contribution-a.offering_platform_share,revenue:before.revenue+a.offering_platform_share});assertFee(f);c.target(`SELECT private.assert_funded_coordination_entry('${f.alignment}');`);};
 return {...h,call,activate,activationAction,amounts,feeState,assertFee,assertSettlement};
}
module.exports={support};
