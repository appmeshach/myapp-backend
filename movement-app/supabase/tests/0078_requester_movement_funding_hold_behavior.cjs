'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {fixtures:baseFixtures}=require('./0077_financial_proposal_requester_materialization_behavior.cjs');
const {inspect}=require('./0078_requester_movement_funding_hold_harness.cjs');
const {query,snapshot}=require('./0074_trusted_financial_proposal_issuer_behavior.cjs');
const read=p=>fs.readFileSync(path.join(__dirname,p),'utf8').replace(/\r\n/g,'\n');
const migration=read('../migrations/0078_requester_movement_funding_hold.sql');
const migrationBody=migration.replace(/^BEGIN;\s*/,'').replace(/COMMIT;\s*$/,'');
const live=read('0078_requester_movement_funding_hold_test.sql');
const materialize=read('0077_financial_proposal_requester_materialization_test.sql');
function fixtures(zero=false) {
 let base=baseFixtures();
 if(zero) {
  const start=base.indexOf('  -- Make this a two-person confirmed requester group.');
  const end=base.indexOf('  r := pg_temp.snapshot_select_as(',start);
  assert(start>=0&&end>start);base=base.slice(0,start)+base.slice(end);
  base=base.replace("'trusted_server_result_infrastructure_v1',12345","'trusted_server_result_infrastructure_v1',1");
 }
 return base+materialize.slice(0,materialize.indexOf('DO $tests$')).replace(/^BEGIN;/,'')
  +live.slice(0,live.indexOf('-- FUNDING_0078_TESTS:')).replace(/^BEGIN;/,'');
}
function main() {
 assert.equal(query('postgres',"SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='0077';"),'1');
 const mode=inspect(query);
 console.log('0078 behavioral mode: '+mode+'; installed definitions checked against source');
 const before=query('postgres',snapshot);
 try {
  for(const zero of [false,true]) {
   const setup=mode==='source'?fixtures(zero).replace(/^BEGIN;/,()=> 'BEGIN;\n'+migrationBody):fixtures(zero);
   process.stdout.write(query('postgres',setup+live.slice(live.indexOf('-- FUNDING_0078_TESTS:')))+'\n');
   console.log('PASS 0078 behavioral variant zero='+zero);
  }
 } finally { assert.equal(query('postgres',snapshot),before,'0078 application data/catalog/ACL/history fully restored'); }
}
module.exports={fixtures,migrationBody};
if(require.main===module)try{main();}catch(e){console.error(e.stack);process.exitCode=1;}
