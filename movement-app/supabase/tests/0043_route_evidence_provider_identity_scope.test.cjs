const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const test = require('node:test');

const read = name => fs.readFileSync(path.join(__dirname, '../migrations', name), 'utf8').replace(/\r\n/g, '\n');
const strip = s => s.replace(/--[^\n]*/g, '').trim();
const sql = strip(read('0043_route_evidence_provider_identity_scope.sql'));
const marker = 'CREATE OR REPLACE FUNCTION public.record_offering_route_evidence_for_server';
const writer = sql.slice(sql.indexOf(marker));
const replay = writer.slice(writer.indexOf('  IF FOUND THEN'), writer.indexOf('  SELECT COALESCE'));

test('historical migrations remain unchanged modulo checkout line endings', () => {
  for (const [file, hash] of Object.entries({
    '0023_route_evidence_foundation.sql': '6450422c27bf9cf06c48b3d2ab1cd1a26898c9108a52f0a5067ff551a1521617',
    '0025_trusted_route_producer_boundary.sql': '8739ef54c193de0646c44f5311b902835ac949ed6efaf47755d3be8e1f33ad89',
    '0033_route_generation_claim_boundary.sql': '3c9e3646400ec49764fa9c6af8cc20a803fbe924d52c566907c4042f595ef5c1',
    '0042_trusted_movement_offer_authorization.sql': 'c41da59fc4051e4cdb805e77337627fc7789460834f64530ee0f4897756f18ab',
  })) assert.equal(crypto.createHash('sha256').update(read(file)).digest('hex'), hash, file);
});

test('one outer transaction replaces only the named global constraint', () => {
  assert.equal((sql.match(/^BEGIN;/gm) || []).length, 1);
  assert.equal((sql.match(/^COMMIT;/gm) || []).length, 1);
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /COMMIT;$/);
  assert.equal(sql.slice(0, sql.indexOf(marker)).replace(/\s+/g, ' ').trim(),
    'BEGIN; ALTER TABLE private.offering_route_evidence DROP CONSTRAINT offering_route_evidence_provider_namespace_provider_product_key; ALTER TABLE private.offering_route_evidence ADD CONSTRAINT offering_route_evidence_intent_provider_identity_key UNIQUE ( offering_movement_intent_id, provider_namespace, provider_product, provider_version, provider_route_reference );');
});

test('0025 writer and ACL are preserved with exactly the two authorized logic changes', () => {
  const original = strip(read('0025_trusted_route_producer_boundary.sql'));
  const expected = original.slice(original.indexOf(marker))
    .replace('WHERE e.provider_namespace=p_provider_namespace', 'WHERE e.offering_movement_intent_id=v_intent.id\n    AND e.provider_namespace=p_provider_namespace')
    .replace('      OR v_existing.generated_at IS DISTINCT FROM p_generated_at\n', '');
  assert.equal(writer.replace(/\s+/g, ' '), expected.replace(/\s+/g, ' '));
});

test('signature, return shape and service-only security boundary are unchanged', () => {
  assert.match(writer, /LANGUAGE plpgsql\s+SECURITY DEFINER\s+SET search_path = ''/);
  const signature = 'uuid,text,text,text,text,jsonb,bigint,bigint,timestamptz,timestamptz';
  assert.ok(writer.includes(`${signature}\n) FROM PUBLIC,anon,authenticated,service_role;`));
  assert.ok(writer.includes(`${signature}\n) TO service_role;`));
  assert.equal((sql.match(/\bGRANT\b/g) || []).length, 1);
});

test('replay locks by authoritative intent and all four provider identity fields', () => {
  assert.match(writer, /SELECT e\.\* INTO v_existing\s+FROM private\.offering_route_evidence e\s+WHERE e.offering_movement_intent_id=v_intent.id\s+AND e.provider_namespace=p_provider_namespace\s+AND e.provider_product=p_provider_product\s+AND e.provider_version=p_provider_version\s+AND e.provider_route_reference=p_provider_route_reference\s+FOR UPDATE;/);
});

test('replay compares all material facts but never overwrites stored generation time', () => {
  for (const [field, value] of Object.entries({
    offering_movement_intent_id: 'v_intent.id', offering_member_id: 'v_intent.offering_member_id',
    origin_location_reference_id: 'v_origin.id', destination_location_reference_id: 'v_destination.id',
    evidence_schema_version: "'offering_route_evidence_v1'", route_shape_format: "'geojson_linestring_v1'",
    route_shape: 'p_route_shape', route_distance_meters: 'p_route_distance_meters',
    route_duration_seconds: 'p_route_duration_seconds', expires_at: 'v_effective_expires_at',
  })) assert.ok(replay.includes(`v_existing.${field} IS DISTINCT FROM ${value}`), field);
  assert.doesNotMatch(replay, /p_generated_at|\b(?:UPDATE|INSERT|DELETE)\b/);
  assert.match(replay, /v_existing.status<>'current'/);
  assert.match(replay, /v_existing.expires_at<=v_now/);
  assert.match(replay, /PERFORM private.assert_offering_route_evidence\(v_existing.id\);\s+RETURN QUERY SELECT v_existing.id, v_existing.version, v_existing.status, v_existing.expires_at;\s+RETURN;/);
});

test('new evidence retains generation, endpoint, expiry, shape and lifecycle checks', () => {
  for (const fragment of [
    'FOR UPDATE;', 'private.assert_offering_movement_intent(v_intent.id)',
    "v_origin.source_kind<>'provider_resolved'", "v_destination.source_kind<>'provider_resolved'",
    'v_origin.owner_member_id<>v_intent.offering_member_id', 'v_destination.owner_member_id<>v_intent.offering_member_id',
    'NOT isfinite(p_generated_at)', 'p_generated_at>v_now', 'p_generated_at<v_intent.created_at',
    'p_generated_at<v_origin.resolved_at', 'p_generated_at<v_destination.resolved_at',
    'NOT isfinite(p_expires_at) OR p_expires_at<=v_now', 'v_effective_expires_at := LEAST(',
    'p_route_distance_meters<=0 OR p_route_duration_seconds<=0', 'private.assert_geojson_linestring_v1(p_route_shape)',
    'COALESCE(MAX(e.version),0)+1', "SET status='superseded'", 'private.assert_offering_route_evidence(v_new_id)',
    'SET CONSTRAINTS private.offering_route_evidence_complete IMMEDIATE;',
  ]) assert.ok(writer.includes(fragment), fragment);
});

test('no new client authority, vendor coupling, operational mutations or protection changes', () => {
  assert.doesNotMatch(sql, /mapbox|google|osrm|detour|p_offering_member_id|p_origin|p_destination|DISABLE|CREATE POLICY|DROP TRIGGER/i);
  assert.deepEqual([...sql.matchAll(/\b(?:INSERT INTO|UPDATE) (private\.[a-z_]+)/g)].map(m => m[1]),
    ['private.offering_route_evidence', 'private.offering_route_evidence']);
  assert.equal((sql.match(/CREATE OR REPLACE FUNCTION/g) || []).length, 1);
});
