'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {fixtures:baseFixtures}=require('./0081_financial_movement_start_behavior.cjs');
const {inspect,sourceBody}=require('./0082_financial_movement_completion_harness.cjs');
const {query,snapshot}=require('./0074_trusted_financial_proposal_issuer_behavior.cjs');
const read=p=>fs.readFileSync(path.join(__dirname,p),'utf8').replace(/\r\n/g,'\n');
const migration=read('../migrations/0083_financial_movement_completion.sql');
const completionBody=migration.replace(/^BEGIN;\s*/,'').replace(/COMMIT;\s*$/,'');
const temporal=read('../migrations/0082_trusted_temporal_evidence_hardening.sql');
const migrationBody=temporal.replace(/^BEGIN;\s*/,'').replace(/COMMIT;\s*$/,'')+'\n'+completionBody;
const live=read('0082_financial_movement_completion_test.sql');
// Obsolete diagnostic patches are preserved in docs/0082-prehardening-timestamp-diagnostics.txt.
const timestampDiagnostics = '';
function completionChecks(mode='installed'){
 const checks=live.slice(live.indexOf('-- COMPLETION_0082_TESTS:'));
 if(mode!=='source')return checks;
 // 0012 revokes all app execution on the obsolete journey RPCs; use the
 // existing owner to exercise their financial guard. Mutual-end RPCs retain
 // authenticated execution. Do not invent installed service_role grants.
 const marker="retry:=pg_temp.snapshot_select_as('service_role',f.offerer,format('SELECT * FROM public.%I(%L)',key,j))";
 assert.equal(checks.split(marker).length,2,'Legacy denial fixture source drift');
 const ownerHelper=`CREATE FUNCTION pg_temp.completion_legacy_owner_result(p_key text,p_journey uuid) RETURNS jsonb LANGUAGE plpgsql AS $owner$
 BEGIN
  IF p_key NOT IN ('request_journey_completion','confirm_journey_completion') THEN RAISE EXCEPTION 'Unsupported legacy source key'; END IF;
  BEGIN
   EXECUTE format('SELECT * FROM public.%I(%L::uuid)',p_key,p_journey);
   RETURN jsonb_build_object('ok',true);
  EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'state',SQLSTATE,'message',SQLERRM); END;
 END $owner$;\n`;
 const replacement="retry:=CASE WHEN key IN ('request_journey_completion','confirm_journey_completion') THEN pg_temp.completion_legacy_owner_result(key,j) ELSE pg_temp.snapshot_select_as('authenticated',f.offerer,format('SELECT * FROM public.%I(%L)',key,j)) END";
 return ownerHelper+checks.replace(marker,replacement);
}

function fixtures(zero=false) {
 // Anchor related endpoint inputs to PostgreSQL, then read the persisted
 // producer result before constructing its descendant. Server-owned creation
 // timestamps remain untouched; no timestamp from an earlier path is reused.
 const base=baseFixtures(zero)
  .replace('DECLARE selected uuid; resolved uuid;', 'DECLARE selected uuid; resolved uuid; anchor timestamptz; parent_expiry timestamptz;')
  .replace('BEGIN\n  SELECT x.location_reference_id INTO STRICT selected', 'BEGIN\n  anchor:=clock_timestamp(); parent_expiry:=anchor+interval \'4 hours\';\n  SELECT x.location_reference_id INTO STRICT selected')
  .replace("clock_timestamp()-interval '1 minute',clock_timestamp()+interval '4 hours'", "anchor-interval '1 minute',parent_expiry")
  .replace('  SELECT x.resolved_location_reference_id INTO STRICT resolved', '  SELECT created_at INTO STRICT anchor FROM private.movement_location_references WHERE id=selected;\n  SELECT x.resolved_location_reference_id INTO STRICT resolved')
  .replace("p_latitude,p_longitude,clock_timestamp(),clock_timestamp()+interval '4 hours'", 'p_latitude,p_longitude,anchor,parent_expiry');
 assert(base.includes('p_latitude,p_longitude,anchor,parent_expiry'), 'Endpoint fixture source drift');
 return base+live.slice(0,live.indexOf('-- COMPLETION_0082_TESTS:')).replace(/^BEGIN;/,'');
}
function main() {
 assert.equal(query('postgres',"SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='0081';"),'1');
 const mode=inspect(query);console.log('0083 behavioral mode: '+mode);
 const load=mode==='source'?sourceBody(query):'';
 const before=query('postgres',snapshot);
 const executions=Number(process.argv.find(a=>a.startsWith('--stress='))?.split('=')[1]||1);
 assert(Number.isInteger(executions)&&executions>=1&&executions<=50);
 let checks=0;
 try {for(let execution=1;execution<=executions;execution++)for(const zero of [false,true]) {
  const setup=mode==='source'?fixtures(zero).replace(/^BEGIN;/,()=> 'BEGIN;\n'+load):fixtures(zero);
  const input=setup.replace(/^BEGIN;/,()=> `BEGIN; SELECT set_config('movement.fixture_scenario','behavior-${execution}-zero-${zero}',true);`)+completionChecks(mode);
  const output=query('postgres',input);
  const count=output.split('\n').filter(line=>/\|t\|/.test(line)).length;
  assert.equal(count,zero?74:75,'Complete behavioral check count');checks+=count;
  if(executions===1)process.stdout.write(output+'\n');
  console.log('PASS 0082 behavioral execution='+execution+' zero='+zero+' checks='+count);
 }} finally {assert.equal(query('postgres',snapshot),before,'0082 application data/catalog/ACL/RLS/history fully restored');console.log('PASS application fingerprint unchanged');}
 console.log('PASS '+executions+' complete behavioral executions; '+checks+' checks');
}
module.exports={fixtures,migrationBody,completionBody,timestampDiagnostics,completionChecks};
if(require.main===module)try{main();}catch(e){console.error(e.stack);process.exitCode=1;}
