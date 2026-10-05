'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const helper=require('../supabase/tests/final_movement_regression_catalog.cjs');
const stems={79:'0079_funded_movement_activation',80:'0080_funded_movement_coordination_entry',81:'0081_financial_movement_start'};
const roles=(v,n)=>v===79?(['public.activate_my_funded_movement','public.get_my_movement_activation_status','public.get_my_activation_payment_status'].includes(n)?['authenticated']:['public.create_alignment_activation_payment','public.mark_alignment_activation_payment_succeeded'].includes(n)?['service_role']:null):
 (v===80?['public.open_my_funded_movement_coordination','public.get_my_funded_movement_coordination_readiness']:['public.get_my_movement_start_status','public.request_my_funded_movement_start','public.confirm_my_funded_movement_start']).includes(n)?['authenticated']:n.startsWith('private.')?null:n.includes('journey_completion')?['service_role']:['authenticated','service_role'];
for(const [key,stem] of Object.entries(stems)){
 const v=Number(key),h=require('../supabase/tests/'+stem+'_harness.cjs');
 const rows=h.finalExpected.map(e=>({...e,owner:'postgres',definer:true,config:['search_path=""'],kind:'f',strict:false,parallel:'u',grantable:0,acl:roles(v,e.name)}));
 test(stem+' final owners retain strict original or later source',()=>{
  h.verifyDefinitions(rows);
  for(const e of h.finalExpected){const owning=helper.definitions(e.ownerVersion).find(x=>x.name===e.name);assert.equal(e.body,owning.body);
   if(e.ownerVersion===v)assert.equal(e.body,h.expected.find(x=>x.name===e.name).body);
  }
  const expectedOwners=v===79?{'private.assert_funded_activation':82,'public.activate_my_funded_movement':82}:v===80?{'private.funded_coordination_alignment':83,'private.assert_funded_coordination_entry':83,'private.protect_financial_coordination_journey':83,'private.protect_financial_coordination_alignment':83,'public.get_my_movement_coordination_status':81}:{'private.funded_coordination_alignment':83,'private.assert_funded_coordination_entry':83,'private.protect_financial_coordination_journey':83,'private.protect_financial_coordination_alignment':83,'private.require_funded_start_actor':82};
  assert.deepEqual(Object.fromEntries(h.finalExpected.filter(e=>e.ownerVersion!==v).map(e=>[e.name,e.ownerVersion])),expectedOwners);
 });
 test(stem+' missing bodies, malformed attributes and ACL drift fail closed',()=>{
  assert.throws(()=>h.verifyDefinitions(rows.slice(1)),/function count/);
  for(const patch of [{body:'wrong'},{acl:['PUBLIC']},{config:[]},{owner:'authenticated'},{args:'wrong'}])assert.throws(()=>h.verifyDefinitions([{...rows[0],...patch},...rows.slice(1)]));
  assert.throws(()=>h.selectMode(1,rows,false),/Incomplete/);
 });
 test(stem+' final source suffix and installed verification never repair catalog',()=>{
  const sql=helper.finalSourceBody(v);let position=-1;
  for(let owner=v;owner<=83;owner++){const first=helper.definitions(owner)[0].body;const next=sql.indexOf(first,position+1);assert(next>position);position=next;}
  const calls=[];assert.throws(()=>helper.assertFinalInstalled((_db,s)=>{calls.push(s);return '0';},'postgres',v),/no automatic source replacement/);
  assert(calls.every(s=>s.startsWith('SELECT')));
  const runner=fs.readFileSync('supabase/tests/'+stem+'_concurrency.cjs','utf8');assert.match(runner,/if \(mode === 'source'\) target\('BEGIN; '\+migrationBody\+' COMMIT;'\)/);
 });
}
test('0083 overlap defeats intermediate 0082 expectation',()=>{
 const h=require('../supabase/tests/0081_financial_movement_start_harness.cjs');
 const original=helper.definitions(82).find(e=>e.name==='private.assert_funded_coordination_entry');
 const final=h.finalExpected.find(e=>e.name===original.name);assert.equal(final.ownerVersion,83);assert.notEqual(final.body,original.body);
 const rows=h.finalExpected.map(e=>({...e,owner:'postgres',definer:true,config:['search_path=""'],kind:'f',strict:false,parallel:'u',grantable:0,acl:roles(81,e.name)}));
 rows.find(e=>e.name===original.name).body=original.body;assert.throws(()=>h.verifyDefinitions(rows),/body/);
});
test('public row-type qualification is formatting; counterfeit schemas remain rejected',()=>{
 const h=require('../supabase/tests/0079_funded_movement_activation_harness.cjs');
 const rows=h.finalExpected.map(e=>({...e,owner:'postgres',definer:true,config:['search_path=""'],kind:'f',strict:false,parallel:'u',grantable:0,acl:roles(79,e.name)}));
 const row=rows.find(e=>e.name==='private.assert_funded_activation');row.args=row.args.replace('a alignments','a public.alignments');h.verifyDefinitions(rows);
 row.args=row.args.replace('public.alignments','private.alignments');assert.throws(()=>h.verifyDefinitions(rows),/args/);
});
