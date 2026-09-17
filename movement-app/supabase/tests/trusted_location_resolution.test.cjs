'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const raw = fs.readFileSync('supabase/migrations/0026_trusted_location_resolution_boundary.sql','utf8');
const liveRaw = fs.readFileSync('supabase/tests/0026_trusted_location_resolution_boundary_test.sql','utf8');
const strip = s => s.replace(/'(?:''|[^'])*'|--[^\r\n]*|\/\*[\s\S]*?\*\//g,t => t.startsWith("'") ? t : ' ');
const sql = strip(raw), live = strip(liveRaw);
const definitions = [...sql.matchAll(/CREATE FUNCTION ([\w.]+)\(([^]*?)AS (\$\w+\$)([^]*?)\3;/g)];
const definition = name => definitions.find(m => m[1]===name);
const writer = definition('public.record_location_resolution_for_server');
const w = writer?.[4] || '';
const a = definition('private.assert_movement_location_resolution_evidence')?.[4] || '';
const table = sql.match(/CREATE TABLE private.movement_location_resolution_evidence \(([^]*?)\n\);/)?.[1] || '';
const must = (s,re) => assert.match(s,re);

test('0026 has a transaction wrapper and exactly one new private table', () => {
  must(sql,/^\s*BEGIN;/); must(sql,/COMMIT;\s*$/);
  assert.deepEqual([...sql.matchAll(/CREATE TABLE ([\w.]+)/g)].map(m=>m[1]),['private.movement_location_resolution_evidence']);
});
test('exact function inventory contains one public writer and three private helpers', () => {
  assert.deepEqual(definitions.map(m=>m[1]),[
    'private.protect_movement_location_resolution_evidence',
    'private.assert_movement_location_resolution_evidence',
    'private.validate_movement_location_resolution_evidence',
    'public.record_location_resolution_for_server']);
});
test('each function is SECURITY DEFINER with its own empty search path', () => {
  for(const m of definitions) must(m[2],/SECURITY DEFINER SET search_path = ''/);
});
test('exact public signature exposes only normalized trusted result inputs', () => {
  const params=writer[2].split(')')[0].match(/p_\w+ \w+(?: DEFAULT NULL)?/g);
  assert.deepEqual(params,[
    'p_source_location_reference_id uuid','p_producer_request_id uuid','p_provider_namespace text',
    'p_provider_product text','p_provider_version text','p_provider_place_reference text',
    'p_resolution_version text','p_latitude numeric','p_longitude numeric',
    'p_resolved_at timestamptz','p_expires_at timestamptz DEFAULT NULL']);
});
test('return shape contains four identifiers/version/expiry fields only', () => {
  must(writer[2],/RETURNS TABLE \(evidence_id uuid,resolved_location_reference_id uuid,version integer,expires_at timestamptz\)/);
});
test('writer explicitly revokes all four roles then grants service-only execution', () => {
  must(sql,/REVOKE ALL ON FUNCTION public\.record_location_resolution_for_server\(uuid,uuid,text,text,text,text,text,numeric,numeric,timestamptz,timestamptz\)\s+FROM PUBLIC,anon,authenticated,service_role;/);
  const grants=[...sql.matchAll(/GRANT EXECUTE[^;]+;/g)].map(m=>m[0]);
  assert.equal(grants.length,1); must(grants[0],/public\.record_location_resolution_for_server[^]*TO service_role;/);
});
test('all private helpers revoke execution from every application role', () => {
  for(const name of definitions.map(m=>m[1]).filter(n=>n.startsWith('private.'))) {
    const escaped=name.replaceAll('.','\\.');
    must(sql,new RegExp(`REVOKE ALL ON FUNCTION ${escaped}\\([^)]*\\) FROM PUBLIC,anon,authenticated,service_role;`));
  }
});
test('new table has RLS and no policies', () => {
  must(sql,/ALTER TABLE private\.movement_location_resolution_evidence ENABLE ROW LEVEL SECURITY;/);
  assert.doesNotMatch(sql,/CREATE POLICY|DISABLE ROW LEVEL SECURITY/i);
});
test('table grants are exactly SELECT-only service role with explicit revocation', () => {
  must(sql,/REVOKE ALL ON private\.movement_location_resolution_evidence FROM PUBLIC,anon,authenticated,service_role;/);
  const grants=[...sql.matchAll(/GRANT (?!EXECUTE)[^;]+;/g)].map(m=>m[0]);
  assert.deepEqual(grants,['GRANT SELECT ON private.movement_location_resolution_evidence TO service_role;']);
});
test('evidence stores only the specified nonduplicated columns', () => {
  const cols=table.split('\n').map(l=>l.trim().match(/^(\w+) (uuid|integer|text|timestamptz)\b/)?.[1]).filter(Boolean);
  assert.deepEqual(cols,['id','source_location_reference_id','resolved_location_reference_id','version','producer_request_id','provider_product','provider_version','resolution_schema_version','requested_expires_at','recorded_at']);
});
test('links are distinct and both FKs restrict deletion', () => {
  assert.equal((table.match(/REFERENCES private\.movement_location_references\(id\) ON DELETE RESTRICT/g)||[]).length,2);
  must(table,/CHECK \(source_location_reference_id<>resolved_location_reference_id\)/);
});
test('request, target and source version identities are unique', () => {
  must(table,/producer_request_id uuid NOT NULL UNIQUE/); must(table,/resolved_location_reference_id uuid NOT NULL UNIQUE/);
  must(table,/UNIQUE \(source_location_reference_id,version\)/); must(table,/version integer NOT NULL CHECK \(version >= 1\)/);
});
test('table provenance is bounded nonblank and schema/timestamps constrained', () => {
  for(const field of ['provider_product','provider_version']) {
    assert(table.includes(`${field}=btrim(${field}) AND length(${field}) BETWEEN 1 AND 100 AND ${field} ~ '[^[:space:]]'`));
  }
  must(table,/resolution_schema_version='movement_location_resolution_v1'/);
  must(table,/CHECK \(isfinite\(requested_expires_at\)\)/); must(table,/CHECK \(isfinite\(recorded_at\)\)/);
});
test('evidence UPDATE and DELETE always raise including no-op updates', () => {
  const protect=definition('private.protect_movement_location_resolution_evidence')[4];
  must(protect,/BEGIN\s+RAISE EXCEPTION USING ERRCODE='23514'/);
  must(sql,/BEFORE UPDATE OR DELETE ON private\.movement_location_resolution_evidence/);
});
test('validation is attached immediately to every evidence insert', () => {
  must(sql,/AFTER INSERT ON private\.movement_location_resolution_evidence\s+FOR EACH ROW EXECUTE FUNCTION private\.validate_movement_location_resolution_evidence\(\)/);
  assert.doesNotMatch(sql,/DEFERRABLE|DISABLE TRIGGER|DROP TRIGGER/);
  must(definition('private.validate_movement_location_resolution_evidence')[4],/assert_movement_location_resolution_evidence\(NEW.id\)/);
});
test('writer explicitly requires READ COMMITTED', () => {
  must(w,/current_setting\('transaction_isolation'\)<>'read committed'/); must(w,/ERRCODE='25000'/);
});
test('all required arguments have explicit NULL guards', () => {
  for(const name of ['source_location_reference_id','producer_request_id','provider_namespace','provider_product','provider_version','provider_place_reference','resolution_version','latitude','longitude','resolved_at']) assert(w.includes(`p_${name} IS NULL`));
});
test('coordinates reject out-of-range and nonfinite numeric values', () => {
  for(const body of [w,a]) {
    must(body,/latitude BETWEEN -90 AND 90/); must(body,/longitude BETWEEN -180 AND 180/);
    must(body,/latitude::text IN \('NaN','Infinity','-Infinity'\)/); must(body,/longitude::text IN \('NaN','Infinity','-Infinity'\)/);
    must(body,/latitude IS NULL/); must(body,/longitude IS NULL/);
  }
});
test('provider fields validate trimming lengths and non-space content', () => {
  must(w,/ARRAY\[p_provider_namespace,p_provider_product,p_provider_version,p_resolution_version\]/);
  must(w,/length\(v_text\) NOT BETWEEN 1 AND 100/); must(w,/v_text !~ '\[\^\[:space:\]\]'/);
  must(w,/length\(p_provider_place_reference\) NOT BETWEEN 1 AND 500/);
});
test('source lock precedes eligibility and fresh time', () => {
  must(w,/WHERE r.id=p_source_location_reference_id FOR UPDATE;\s+IF NOT FOUND THEN[^]*?END IF;\s+v_now := clock_timestamp\(\);\s+IF v_source.resolution_status/);
});
test('source must be unresolved eligible structurally coherent and unexpired', () => {
  for(const body of [w,a]) {
    must(body,/resolution_status IS DISTINCT FROM 'unresolved'/);
    must(body,/source_kind NOT IN \('member_declared','member_selected'\)/);
    must(body,/resolved_at IS NOT NULL OR [\w.]+resolution_version IS NOT NULL/);
  }
  must(w,/v_source.expires_at IS NOT NULL AND v_source.expires_at<=v_now/);
});
test('provider hints enforce both identity fields in writer and assertion', () => {
  must(w,/v_source.provider_namespace IS NOT NULL AND\s+\(v_source.provider_namespace IS DISTINCT FROM p_provider_namespace\s+OR v_source.provider_place_reference IS DISTINCT FROM p_provider_place_reference\)/);
  must(a,/s.provider_namespace IS DISTINCT FROM t.provider_namespace/); must(a,/s.provider_place_reference IS DISTINCT FROM t.provider_place_reference/);
});
test('resolution timestamp cannot predate declaration or exceed fresh time', () => {
  must(w,/NOT isfinite\(p_resolved_at\) OR p_resolved_at<v_source.created_at OR p_resolved_at>v_now/);
});
test('requested expiry is finite and future', () => {
  must(w,/p_expires_at IS NOT NULL AND \(NOT isfinite\(p_expires_at\) OR p_expires_at<=v_now\)/);
});
test('effective expiry is source bounded and checked against new creation time', () => {
  must(w,/v_now := clock_timestamp\(\);\s+v_expiry := LEAST\(p_expires_at,v_source.expires_at\);\s+IF v_expiry IS NOT NULL AND v_expiry<=v_now/);
  must(w,/p_resolution_version,p_resolved_at,v_now,v_expiry/);
});
test('owner and label come from the source and target kind/status are fixed', () => {
  must(w,/v_source.owner_member_id,v_source.declared_label,'provider_resolved','resolved'/);
  must(a,/s.owner_member_id IS DISTINCT FROM t.owner_member_id/); must(a,/s.declared_label IS DISTINCT FROM t.declared_label/);
});
test('versions derive from locked source and fixed evidence schema', () => {
  must(w,/COALESCE\(MAX\(e.version\),0\)\+1 INTO v_version/);
  must(w,/WHERE e.source_location_reference_id=v_source.id/);
  must(w,/'movement_location_resolution_v1',p_expires_at,v_now/);
});
test('retry compares all ten normalized payload fields including requested expiry', () => {
  for(const field of ['source_location_reference_id','provider_product','provider_version','requested_expires_at']) must(w,new RegExp(`v_existing\\.${field} IS DISTINCT FROM`));
  for(const field of ['provider_namespace','provider_place_reference','resolution_version','latitude','longitude','resolved_at']) must(w,new RegExp(`v_target\\.${field} IS DISTINCT FROM p_${field}`));
  must(w,/ERRCODE='23514', MESSAGE='Location resolution request does not match recorded evidence'/);
});
test('exact retry returns original IDs before allocation or insert', () => {
  must(w,/RETURN QUERY SELECT v_existing.id,v_target.id,v_existing.version,v_target.expires_at;\s+RETURN;\s+END IF;\s+SELECT COALESCE/);
});
test('retry asserts eligibility immediately before returning', () => {
  must(w,/PERFORM private\.assert_movement_location_resolution_evidence\(v_existing.id\);\s+RETURN QUERY/);
  must(a,/FOR SHARE;\s+v_now := clock_timestamp\(\);/);
  must(a,/s.expires_at<=v_now/); must(a,/t.expires_at<=v_now/);
});
test('assertion verifies exact effective expiry and recording correspondence', () => {
  must(a,/t.expires_at IS DISTINCT FROM LEAST\(e.requested_expires_at,s.expires_at\)/);
  must(a,/t.created_at IS DISTINCT FROM e.recorded_at/);
});
test('only two inserts occur and no errors are swallowed leaving orphan targets', () => {
  assert.deepEqual([...w.matchAll(/INSERT INTO ([\w.]+)/g)].map(m=>m[1]),['private.movement_location_references','private.movement_location_resolution_evidence']);
  assert.doesNotMatch(w,/EXCEPTION WHEN|ON CONFLICT|\bCOMMIT\b|\bROLLBACK\b/);
  must(w,/assert_movement_location_resolution_evidence\(v_evidence_id\)/);
});
test('no old reference mutation, endpoint rebinding or history supersession', () => {
  assert.doesNotMatch(sql,/\bUPDATE\s+private\.|\bDELETE FROM\s+private\.|\bTRUNCATE\s|offering_movement_intent|superseded/i);
});
test('no old function or trigger replacement and no advisory locks', () => {
  assert.doesNotMatch(sql,/CREATE OR REPLACE|ALTER FUNCTION|ALTER TRIGGER|pg_advisory/i);
  assert.equal((sql.match(/CREATE TRIGGER/g)||[]).length,2);
});
test('no stale statement or transaction clocks', () => {
  assert.doesNotMatch(sql,/statement_timestamp|transaction_timestamp|\bnow\(/i);
});
test('provider place identity is not globally unique', () => {
  assert.doesNotMatch(sql,/UNIQUE[^;]*provider_place_reference/);
});
test('no provider vendor or network integration', () => {
  assert.doesNotMatch(sql,/google|mapbox|valhalla|osrm|https?:\/\/|\bfetch\s*\(|\bhttp\w*\s*\(|\bnet\.|api_key/i);
});
test('no requester matching or operational/financial writes', () => {
  assert.doesNotMatch(sql,/movement_needs|movement_offers|alignments|journeys|payments|pricing|detour|wallet|chat/i);
});
test('behavioral harness uses rollback and collision-free tagged bodies', () => {
  must(live,/^\s*BEGIN;/); must(live,/ROLLBACK;\s*$/); assert(!live.includes('$$'));
  for(const tag of ['check_result','try_statement','call_writer','resolution_tests']) assert.equal((live.match(new RegExp(`\\$${tag}\\$`,'g'))||[]).length,2);
});
test('behavioral matrix covers privilege binding history and same-transaction versions', () => {
  for(const label of ['writer execute service only','service no direct mutation','original source unchanged','owner derived','label derived','exact source target link','version starts at one','same transaction second request version two','intent endpoints unchanged','version one evidence unchanged','even no-op evidence UPDATE rejected','evidence DELETE rejected','0022 resolved location UPDATE rejected']) assert(live.includes(label),label);
});
test('behavioral replay matrix covers original requested expiry despite clamping', () => {
  must(live,/'expires_at',to_jsonb\(deadline\+interval '2 hours'\)/);
  must(live,/'replay rejects changed '\|\|variant.field/);
  must(live,/count\(\*\) FROM private.movement_location_references\)=locations_before/);
});
test('behavioral numeric and provider-hint matrices cover regression cases', () => {
  for(const label of ['null latitude','null longitude','NaN latitude','infinite longitude','negative infinite latitude','future resolution','resolution before source','past expiry','blank namespace','blank product','blank provider version','blank place','blank resolution version','selected hint exact identity accepted','selected hint rejects changed']) assert(live.includes(label),label);
});
test('behavioral harness does not fake expiry/concurrency or disable protections', () => {
  assert.doesNotMatch(live,/pg_sleep|DISABLE TRIGGER|session_replication_role/i);
  must(live,/SET CONSTRAINTS private.offering_intent_complete,private.offering_intent_locations_complete IMMEDIATE;/);
});
