'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {fixtures:baseFixtures}=require('./0079_funded_movement_activation_behavior.cjs');
const {inspect}=require('./0080_funded_movement_coordination_entry_harness.cjs');
const {query,snapshot}=require('./0074_trusted_financial_proposal_issuer_behavior.cjs');
const read=p=>fs.readFileSync(path.join(__dirname,p),'utf8').replace(/\r\n/g,'\n');
const migration=read('../migrations/0080_funded_movement_coordination_entry.sql');
const historicalMigrationBody=migration.replace(/^BEGIN;\s*/,'').replace(/COMMIT;\s*$/,'');
const migrationBody=require('./final_movement_regression_catalog.cjs').finalSourceBody(80);
const live=read('0080_funded_movement_coordination_entry_test.sql');
function fixtures(zero=false) {
 let base=baseFixtures(zero);
 // Real legacy branches within the existing rollback-only legacy activation.
 base=base.replace("THEN RAISE EXCEPTION ''Legacy activation regression''; END IF;",()=>`THEN RAISE EXCEPTION ''Legacy activation regression''; END IF;
 r:=pg_temp.snapshot_select_as(''authenticated'',f.requester,format(''SELECT * FROM public.open_my_funded_movement_coordination(%L)'',f.need));
 IF r->>''state'' IS DISTINCT FROM ''23514'' THEN RAISE EXCEPTION ''Legacy payment cannot qualify %'',r; END IF;
 BEGIN
  r:=pg_temp.snapshot_select_as(''authenticated'',f.offerer,format(''SELECT * FROM public.request_my_movement_end(%L)'',f.need)); IF r->>''ok'' IS DISTINCT FROM ''true'' THEN RAISE EXCEPTION ''Legacy RPC failure %'',r; END IF;
  r:=pg_temp.snapshot_select_as(''authenticated'',f.requester,format(''SELECT * FROM public.confirm_my_movement_end(%L)'',f.need)); IF r->>''ok'' IS DISTINCT FROM ''true'' THEN RAISE EXCEPTION ''Legacy RPC failure %'',r; END IF;
  IF (SELECT status FROM public.alignments WHERE id=a)<>''cancelled'' THEN RAISE EXCEPTION ''Legacy no travel regression''; END IF;
  RAISE EXCEPTION USING ERRCODE=''Z8001'',MESSAGE=''Rollback legacy branch'';
 EXCEPTION WHEN SQLSTATE ''Z8001'' THEN NULL; END;
 r:=pg_temp.snapshot_select_as(''authenticated'',f.offerer,format(''SELECT * FROM public.set_my_movement_meeting_point(%L,''''Legacy meeting point'''',NULL)'',f.need)); IF r->>''ok'' IS DISTINCT FROM ''true'' THEN RAISE EXCEPTION ''Legacy RPC failure %'',r; END IF;
 r:=pg_temp.snapshot_select_as(''authenticated'',f.offerer,format(''SELECT * FROM public.request_my_movement_start(%L)'',f.need)); IF r->>''ok'' IS DISTINCT FROM ''true'' THEN RAISE EXCEPTION ''Legacy RPC failure %'',r; END IF;
 r:=pg_temp.snapshot_select_as(''authenticated'',f.requester,format(''SELECT * FROM public.confirm_my_movement_start(%L)'',f.need)); IF r->>''ok'' IS DISTINCT FROM ''true'' THEN RAISE EXCEPTION ''Legacy RPC failure %'',r; END IF;
 r:=pg_temp.snapshot_select_as(''authenticated'',f.offerer,format(''SELECT * FROM public.request_my_movement_end(%L)'',f.need)); IF r->>''ok'' IS DISTINCT FROM ''true'' THEN RAISE EXCEPTION ''Legacy RPC failure %'',r; END IF;
 r:=pg_temp.snapshot_select_as(''authenticated'',f.requester,format(''SELECT * FROM public.confirm_my_movement_end(%L)'',f.need)); IF r->>''ok'' IS DISTINCT FROM ''true'' THEN RAISE EXCEPTION ''Legacy RPC failure %'',r; END IF;
 IF (SELECT status FROM public.alignments WHERE id=a)<>''completed'' OR (SELECT count(*) FROM private.movement_settlements WHERE alignment_id=a)<>1 THEN RAISE EXCEPTION ''Legacy completion regression''; END IF;
 `);
 return base+live.slice(0,live.indexOf('-- COORDINATION_0080_TESTS:')).replace(/^BEGIN;/,'');
}
function main() {
 assert.equal(query('postgres',"SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='0079';"),'1');
 const mode=inspect(query);console.log('0080 behavioral mode: '+mode);
 const before=query('postgres',snapshot);
 try {for(const zero of [false,true]) {
  const setup=mode==='source'?fixtures(zero).replace(/^BEGIN;/,()=> 'BEGIN;\n'+migrationBody):fixtures(zero);
  process.stdout.write(query('postgres',setup+live.slice(live.indexOf('-- COORDINATION_0080_TESTS:')))+'\n');
  console.log('PASS 0080 behavioral variant zero='+zero);
 }} finally {assert.equal(query('postgres',snapshot),before,'0080 application data/catalog/ACL/RLS/history fully restored');console.log('PASS application fingerprint unchanged');}
}
module.exports={fixtures,migrationBody,historicalMigrationBody};
if(require.main===module)try{main();}catch(e){console.error(e.stack);process.exitCode=1;}
