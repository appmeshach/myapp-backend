'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {fixtures:baseFixtures}=require('./0080_funded_movement_coordination_entry_behavior.cjs');
const {inspect}=require('./0081_financial_movement_start_harness.cjs');
const {query,snapshot}=require('./0074_trusted_financial_proposal_issuer_behavior.cjs');
const read=p=>fs.readFileSync(path.join(__dirname,p),'utf8').replace(/\r\n/g,'\n');
const migration=read('../migrations/0081_financial_movement_start.sql');
const historicalMigrationBody=migration.replace(/^BEGIN;\s*/,'').replace(/COMMIT;\s*$/,'');
const migrationBody=require('./final_movement_regression_catalog.cjs').finalSourceBody(81);
const live=read('0081_financial_movement_start_test.sql');
function fixtures(zero=false) {
 // Recovery needs trusted broad discovery labels, absent from the older
 // snapshot fixture's manually assembled endpoints. Use normal producers before
 // any need/intent/offer graph is constructed; never repair protected endpoints.
 const base=baseFixtures(zero).replace(/CREATE FUNCTION pg_temp.snapshot_state_endpoint\([^]*?\n\$\$;/,()=>`CREATE FUNCTION pg_temp.snapshot_state_endpoint(
 p_owner_member_id uuid,p_label text,p_provider_place_reference text,p_latitude numeric,p_longitude numeric)
 RETURNS uuid LANGUAGE plpgsql AS $$
 DECLARE selected uuid; resolved uuid;
 BEGIN
  SELECT x.location_reference_id INTO STRICT selected FROM public.record_verified_selected_location_for_server(
   p_owner_member_id,gen_random_uuid(),p_label,'test-provider',p_provider_place_reference,'selection_proof_v1',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '4 hours') x;
  SELECT x.resolved_location_reference_id INTO STRICT resolved FROM public.record_attested_location_resolution_for_server(
   p_owner_member_id,selected,gen_random_uuid(),'test-provider','geocode','v1',p_provider_place_reference,'test-resolution-v1',
   'Lagos meeting area','region-lagos','Lagos',p_latitude,p_longitude,clock_timestamp(),clock_timestamp()+interval '4 hours') x;
  RETURN resolved;
 END; $$;`);
 return base+live.slice(0,live.indexOf('-- START_0081_TESTS:')).replace(/^BEGIN;/,'');
}
function main() {
 assert.equal(query('postgres',"SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='0080';"),'1');
 const mode=inspect(query);console.log('0081 behavioral mode: '+mode);
 const before=query('postgres',snapshot);
 try {for(const zero of [false,true]) {
  const setup=mode==='source'?fixtures(zero).replace(/^BEGIN;/,()=> 'BEGIN;\n'+migrationBody):fixtures(zero);
  process.stdout.write(query('postgres',setup+live.slice(live.indexOf('-- START_0081_TESTS:')))+'\n');
  console.log('PASS 0081 behavioral variant zero='+zero);
 }} finally {assert.equal(query('postgres',snapshot),before,'0081 application data/catalog/ACL/RLS/history fully restored');console.log('PASS application fingerprint unchanged');}
}
module.exports={fixtures,migrationBody,historicalMigrationBody};
if(require.main===module)try{main();}catch(e){console.error(e.stack);process.exitCode=1;}
