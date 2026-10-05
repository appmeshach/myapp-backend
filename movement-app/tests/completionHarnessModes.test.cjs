'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const h=require('../supabase/tests/0082_financial_movement_completion_harness.cjs');
const b=require('../supabase/tests/0082_financial_movement_completion_behavior.cjs');
const read=p=>fs.readFileSync(p,'utf8');
test('normal installed fixtures never inject pre-hardening diagnostics',()=>{
 assert.equal(b.timestampDiagnostics,'');for(const zero of [false,true]){
  const sql=b.fixtures(zero);assert.doesNotMatch(sql,/CREATE OR REPLACE FUNCTION private\.|Creation diagnostic guard source drift|0082_LOCATION_DIAGNOSTIC/);
 }
});
test('through-0081 source composes temporal first and completion second',()=>{
 const query=(_db,sql)=>sql===h.catalogSql?'[]':sql.includes("version='0083'")?'0':sql.includes("version='0082'")?'0':sql.includes('IS NULL')?'t':'f';
 assert.equal(h.inspect(query),'source');const source=h.sourceBody(query);
 assert(source.indexOf('CREATE SEQUENCE private.alignment_face_attempt_ordinal_seq')<source.indexOf('CREATE TABLE private.funded_movement_completion_requests'));
 assert.equal(source,b.migrationBody);
});
test('partial completion and missing prerequisite fail closed without source repair',()=>{
 assert.throws(()=>h.selectMode(1,[],false),/Incomplete/);assert.throws(()=>h.selectMode(1,[],true),/mismatch/);
 assert.throws(()=>h.selectMode(0,[{name:'private.assert_funded_completion'}],false),/Incomplete/);
 const query=(_db,sql)=>sql===h.catalogSql?'[]':sql.includes("version='0083'")?'0':sql.includes("version='0082'")?'1':'f';
 assert.throws(()=>h.inspect(query),/Incomplete 0082 prerequisite/);
});
test('final verifier requires 32 temporal-only and all 12 completion bodies',()=>{
 assert.equal(h.temporalExpected.length,32);assert(!h.temporalExpected.some(e=>e.name==='private.assert_funded_coordination_entry'));
 assert.equal(h.expected.length,12);assert.equal(h.expected.filter(e=>e.name==='private.assert_funded_coordination_entry').length,1);
 assert.match(read('supabase/tests/0082_financial_movement_completion_concurrency.cjs'),/verify\(query, database\)/);
});
test('final overlap drift is rejected even when every other completion function matches',()=>{
 const publicReaders=['public.get_my_funded_movement_completion_status','public.request_my_funded_movement_completion','public.confirm_my_funded_movement_completion','public.list_my_completed_movement_recoveries'];
 const rows=h.expected.map(e=>({...e,owner:'postgres',definer:true,config:['search_path=""'],kind:'f',strict:false,parallel:'u',grantable:0,
  acl:publicReaders.includes(e.name)?['authenticated']:e.name.startsWith('private.')?null:e.name.includes('journey_completion')?['service_role']:['authenticated','service_role']}));
 h.verifyDefinitions(rows);
 rows.find(r=>r.name==='private.assert_funded_coordination_entry').body='intermediate temporal body';
 assert.throws(()=>h.verifyDefinitions(rows),/assert_funded_coordination_entry body/);
});
test('source ACL capture fails closed on unexpected PUBLIC execution',()=>{
 assert.throws(()=>h.captureTemporalAcls(()=>JSON.stringify([{name:'private.assert_funded_activation',acl:['PUBLIC']}]),'clone'),/must not expose PUBLIC/);
});
test('source legacy denial uses declared callers without changing installed actor or SQLSTATE',()=>{
 const source=b.completionChecks('source'),installed=b.completionChecks('installed');
 assert.match(source,/THEN pg_temp.completion_legacy_owner_result\(key,j\) ELSE pg_temp.snapshot_select_as\('authenticated'/);
 assert.doesNotMatch(source,/SET ROLE postgres|CREATE OR REPLACE FUNCTION private\./);
 assert.match(installed,/snapshot_select_as\('service_role',f.offerer,format\('SELECT \* FROM public.%I/);
 assert.match(source,/retry->>'state'='23514'/);
});
test('legacy diagnostic entry points fail before any protected function patch',()=>{
 assert.match(read('supabase/tests/0082_financial_movement_completion_constraint_mode_probe.cjs'),/throw new Error\('Pre-hardening diagnostics are archived/);
 const s=read('supabase/tests/0082_financial_movement_completion_settlement_stress.cjs');
 assert.match(s,/historicalModes=\['--discovery-only','--proposal-diagnostics','--proposal-only'\]/);
 assert(s.indexOf('historicalModes.some')<s.indexOf("process.argv.includes('--discovery-only')"));
});
