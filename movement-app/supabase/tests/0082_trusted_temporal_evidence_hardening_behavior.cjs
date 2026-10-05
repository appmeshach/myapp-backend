'use strict';
const assert=require('node:assert/strict');
const {disposable,source,migrationBody,read}=require('./0082_trusted_temporal_evidence_hardening_harness.cjs');
const {fixtures}=require('./0081_financial_movement_start_behavior.cjs');
const {fixtures:issuerFixtures}=require('./0074_trusted_financial_proposal_issuer_behavior.cjs');
const testSql=read('0082_trusted_temporal_evidence_hardening_test.sql').replace('-- FACE_PREFLIGHT_PROBE',
 `SELECT pg_temp.probe('unexpected preexisting face history aborts before any ordinal backfill','${migrationBody.replaceAll("'","''")}','23514','empty face history');`);
async function main(){const results=[];await disposable(async c=>{
 function checked(label,sql){const output=c.target(sql),checks=output.split('\n').filter(l=>/\|[tf](?:\||$)/.test(l));assert(checks.length,label+' produced no persisted checks');assert(checks.every(l=>!/\|f(?:\||$)/.test(l)),label);results.push({label,passed:checks.length,failed:0,output});console.log('PASS '+label+': '+checks.length+' persisted checks');}
 // Build real provider evidence under the previous installed contracts, commit,
 // then prove source cutover accepts this historical chain without rewriting it.
 const schema='temporal_compat';
 c.target(issuerFixtures().replace(/^BEGIN;/,'BEGIN; CREATE SCHEMA '+schema+';').replaceAll('pg_temp.',schema+'.').replaceAll('CREATE TEMP TABLE','CREATE TABLE').replaceAll(' ON COMMIT DROP','')+' COMMIT;');
 const evidenceSql="SELECT jsonb_build_object('location',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM private.movement_location_resolution_evidence t),'route',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM private.offering_route_evidence t),'match',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM private.trusted_route_match_evidence t),'discovery',(SELECT jsonb_agg(to_jsonb(t) ORDER BY resolution_evidence_id) FROM private.trusted_location_discovery_areas t));";
 const before=c.target(evidenceSql);
 c.target(`DO $test$ DECLARE e private.offering_route_evidence%ROWTYPE; rejected boolean:=false; BEGIN
  BEGIN
   SELECT x.* INTO STRICT e FROM private.offering_route_evidence x WHERE status='current' LIMIT 1;
   -- Controlled old-guard evaluation: creation check sees a forward reading,
   -- remaining checks see ordinary time. Every predicate/trigger remains active.
   -- This reproduces an old accepted row with a later default recording sample
   -- beyond its expiry, without manipulating system clocks or protected history.
   EXECUTE replace(pg_get_functiondef('private.protect_offering_route_evidence()'::regprocedure),
     'NEW.created_at > clock_timestamp()', 'NEW.created_at > (clock_timestamp()+interval ''2 hours'')');
   UPDATE private.offering_route_evidence SET status='superseded' WHERE id=e.id;
   INSERT INTO private.offering_route_evidence(offering_movement_intent_id,offering_member_id,origin_location_reference_id,destination_location_reference_id,version,evidence_schema_version,provider_namespace,provider_product,provider_version,provider_route_reference,route_shape_format,route_shape,route_distance_meters,route_duration_seconds,generated_at,expires_at,status,created_at)
   VALUES(e.offering_movement_intent_id,e.offering_member_id,e.origin_location_reference_id,e.destination_location_reference_id,e.version+1,e.evidence_schema_version,e.provider_namespace,e.provider_product,e.provider_version,gen_random_uuid()::text,e.route_shape_format,e.route_shape,e.route_distance_meters,e.route_duration_seconds,e.generated_at,clock_timestamp()+interval '30 minutes','current',clock_timestamp()+interval '1 hour');
   EXECUTE '${migrationBody.replaceAll("'","''")}';
  EXCEPTION WHEN check_violation THEN IF SQLERRM<>'Incompatible historical route attestation' THEN RAISE; END IF; rejected:=true;
  END;
  IF NOT rejected OR to_regclass('private.alignment_face_attempt_ordinal_seq') IS NOT NULL THEN RAISE EXCEPTION 'Compatibility did not fail atomically'; END IF;
 END $test$;`);
 assert.equal(c.target(evidenceSql),before);console.log('PASS incompatible historical evidence aborts atomically before schema cutover');
 c.install();assert.equal(c.target(evidenceSql),before);console.log('PASS compatible historical evidence preserved byte-for-byte');
 const normalEndpoint=fixtures().match(/CREATE FUNCTION pg_temp.snapshot_state_endpoint\([^]*?\n END; \$\$;/);
 assert(normalEndpoint,'Normal through-0081 endpoint producer helper');
 const ingestionFixtures=issuerFixtures().replace(/CREATE FUNCTION pg_temp.snapshot_state_endpoint\([^]*?\n\$\$;/,()=>normalEndpoint[0]);
 checked('temporal ingestion and attestation',ingestionFixtures+read('0082_trusted_temporal_ingestion_test.sql'));
 const materializationSql=read('0077_financial_proposal_requester_materialization_test.sql');
 checked('normal construction with regressing producer clocks',require('./0077_financial_proposal_requester_materialization_behavior.cjs').fixtures()+materializationSql.slice(0,materializationSql.indexOf('DO $tests$')).replace(/^BEGIN;/,'')+read('0082_trusted_temporal_materialization_test.sql'));
 for(const zero of [false,true])checked('temporal behavioral zero='+zero,fixtures(zero)+testSql);
 // Existing 0079/80/81 SQL scenarios, under corrected source, each rollback.
 for(const [file,marker] of [['0079_funded_movement_activation_test.sql','-- ACTIVATION_0079_TESTS:'],['0080_funded_movement_coordination_entry_test.sql','-- COORDINATION_0080_TESTS:'],['0081_financial_movement_start_test.sql','-- START_0081_TESTS:']]) {
  let live=read(file);assert(live.includes(marker),file);
  // Through-0081 guard rejects this mutation before the older 0079 immutable
  // guard. Keep exact SQLSTATE and pin the stronger installed guard's message.
  if(file.startsWith('0079'))live=live.replace("g.alignment_id),'23514','immutable');", "g.alignment_id),'23514','Financial coordination lifecycle unavailable');");
  // 0081 explicitly introduced offerer start authority at this valid meeting
  // point. Retain the old case but assert the through-0081 projection and no start.
  if(file.startsWith('0080'))live=live.replace("'meeting point human text edit no start authority',r#>>'{rows,0,meeting_point_text}'='Main entrance' AND r#>>'{rows,0,can_request_start}'='false' AND r#>>'{rows,0,can_confirm_start}'='false'", "'meeting point reflects 0081 offerer authority without starting',r#>>'{rows,0,meeting_point_text}'='Main entrance' AND r#>>'{rows,0,can_request_start}'='true' AND r#>>'{rows,0,can_confirm_start}'='false' AND NOT EXISTS(SELECT 1 FROM private.funded_movement_start_requests WHERE alignment_id=g.alignment_id)");
  checked('impacted '+file,fixtures()+live.slice(live.indexOf(marker)));
 }
});
 require('node:fs').writeFileSync('docs/0082-temporal-behavior-results.json',JSON.stringify({sourceSha:require('node:crypto').createHash('sha256').update(source).digest('hex'),passed:results.reduce((n,r)=>n+r.passed,0),failed:0,compatibilityChecks:2,cleanup:true,applicationFingerprintUnchanged:true,results},null,2)+'\n');
}
module.exports={main,fixtures,migrationBody,source};
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
