const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const migrationPath = 'supabase/migrations/0023_route_evidence_foundation.sql';
const testPath = 'supabase/tests/0023_route_evidence_foundation_test.sql';
const priorProposalPath = 'supabase/migrations/0021_financial_proposal_foundation.sql';
const sqlRaw = fs.readFileSync(migrationPath, 'utf8');
const liveRaw = fs.readFileSync(testPath, 'utf8');
const proposalRaw = fs.readFileSync(priorProposalPath, 'utf8');
function withoutComments(source) {
  return source.replace(/'(?:''|[^'])*'|--[^\r\n]*|\/\*[\s\S]*?\*\//g,
    token => token.startsWith("'") ? token : ' ');
}
const sql = withoutComments(sqlRaw);
const live = withoutComments(liveRaw);
function must(re, msg) { assert.match(sql, re, msg); }
function mustNot(re, msg) { assert.doesNotMatch(sql, re, msg); }

test('0023 creates exactly one private route-evidence table', () => {
  const creates = [...sql.matchAll(/CREATE\s+TABLE\s+([A-Za-z0-9_."]+)/gi)]
    .map(m => m[1].replaceAll('"','').toLowerCase());
  assert.deepEqual(creates, ['private.offering_route_evidence']);
});

test('0023 is transactional and does not modify installed migrations', () => {
  assert.match(sql.trim(), /^BEGIN;/i);
  assert.match(sql.trim(), /COMMIT;\s*$/i);
  assert.doesNotMatch(sql, /ALTER\s+TABLE\s+private\.financial_proposals/i);
  assert.match(proposalRaw, /route_evidence_id\s+uuid\s+CHECK\s*\(\s*route_evidence_id\s+IS\s+NULL\s*\)/i);
});

test('route evidence is tied to offering intent, not requester demand', () => {
  must(/offering_movement_intent_id\s+uuid\s+NOT\s+NULL\s+REFERENCES\s+private\.offering_movement_intents/i);
  mustNot(/movement_need_id\s+uuid/i);
  mustNot(/requesting_member_id\s+uuid/i);
  mustNot(/movement_context_snapshot_id\s+uuid/i);
});

test('normalized provider-neutral provenance and route shape are required', () => {
  for (const col of ['provider_namespace','provider_product','provider_version','provider_route_reference']) {
    must(new RegExp(`${col}\\s+text\\s+NOT\\s+NULL`, 'i'));
  }
  must(/route_shape_format\s+text\s+NOT\s+NULL\s+CHECK\s*\(\s*route_shape_format\s*=\s*'geojson_linestring_v1'/i);
  must(/route_shape\s+jsonb\s+NOT\s+NULL/i);
});

test('route metrics are offerer-route totals only and integer based', () => {
  must(/route_distance_meters\s+bigint\s+NOT\s+NULL\s+CHECK\s*\(\s*route_distance_meters\s*>\s*0/i);
  must(/route_duration_seconds\s+bigint\s+NOT\s+NULL\s+CHECK\s*\(\s*route_duration_seconds\s*>\s*0/i);
  mustNot(/requester_(?:distance|proximity)|deviation_(?:meters|metres)|shared_route_distance|detour/i);
});

test('no map vendor, PostGIS, geocoding or routing call is introduced', () => {
  mustNot(/\b(?:google\s*maps|mapbox|here\s+maps|tomtom|openstreetmap|osrm|graphhopper|valhalla)\b/i);
  mustNot(/CREATE\s+EXTENSION\s+.*postgis/i);
  mustNot(/\b(?:geometry|geography)\s*\(/i);
  mustNot(/\b(?:geocode|reverse_geocode|directions|distance_matrix|routes_api)\b/i);
});

test('privacy is RLS no-policy service SELECT-only', () => {
  must(/ALTER\s+TABLE\s+private\.offering_route_evidence\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
  must(/REVOKE\s+ALL\s+ON\s+private\.offering_route_evidence\s+FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i);
  must(/GRANT\s+SELECT\s+ON\s+private\.offering_route_evidence\s+TO\s+service_role/i);
  mustNot(/CREATE\s+POLICY/i);
});

test('exact helper inventory is private and execution-revoked', () => {
  const names = [...sql.matchAll(/CREATE\s+FUNCTION\s+private\.([A-Za-z0-9_]+)/gi)].map(m=>m[1]);
  assert.deepEqual(names, [
    'assert_geojson_linestring_v1',
    'assert_offering_route_evidence',
    'protect_offering_route_evidence',
    'validate_offering_route_evidence',
  ]);
  for (const name of names) {
    const def = sql.match(new RegExp(`CREATE\\s+FUNCTION\\s+private\\.${name}\\b[\\s\\S]*?\\$\\$;`, 'i'))?.[0];
    assert.ok(def, name);
    assert.match(def, /SECURITY\s+DEFINER[\s\S]*SET\s+search_path\s*=\s*''/i);
    must(new RegExp(`REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+private\\.${name}\\([^;]*\\)\\s+FROM\\s+PUBLIC\\s*,\\s*anon\\s*,\\s*authenticated\\s*,\\s*service_role`, 'i'));
  }
});

test('triggers attach only to the new private table', () => {
  const ons = [...sql.matchAll(/CREATE\s+(?:CONSTRAINT\s+)?TRIGGER\b[\s\S]*?\bON\s+([A-Za-z0-9_."]+)[\s\S]*?EXECUTE\s+FUNCTION/gi)]
    .map(m=>m[1].replaceAll('"','').toLowerCase());
  assert.deepEqual(ons, ['private.offering_route_evidence','private.offering_route_evidence']);
});

test('evidence versions are unique with at most one current per intent', () => {
  must(/UNIQUE\s*\(\s*offering_movement_intent_id\s*,\s*version\s*\)/i);
  must(/CREATE\s+UNIQUE\s+INDEX\s+offering_route_evidence_one_current[\s\S]*WHERE\s+status\s*=\s*'current'/i);
});

test('resolved provider endpoints are required for route evidence', () => {
  must(/resolution_status\s*<>\s*'resolved'/i);
  must(/source_kind\s*<>\s*'provider_resolved'/i);
  must(/Offering route evidence requires resolved eligible endpoints/i);
});

test('intent owner and exact origin/destination bindings are revalidated', () => {
  must(/intent_row\.offering_member_id\s*<>\s*evidence_row\.offering_member_id/i);
  must(/role='origin'[\s\S]*location_reference_id=evidence_row\.origin_location_reference_id/i);
  must(/role='destination'[\s\S]*location_reference_id=evidence_row\.destination_location_reference_id/i);
});

test('GeoJSON LineString shape is structurally and range validated', () => {
  must(/p_shape->>'type'\s*<>\s*'LineString'/i);
  must(/jsonb_array_length\(p_shape->'coordinates'\)\s*<\s*2/i);
  must(/longitude_value\s*<\s*-180[\s\S]*longitude_value\s*>\s*180/i);
  must(/latitude_value\s*<\s*-90[\s\S]*latitude_value\s*>\s*90/i);
});

test('evidence fields are immutable and history cannot be deleted or reopened', () => {
  must(/Offering route evidence history cannot be deleted/i);
  must(/Offering route evidence fields are immutable/i);
  must(/Offering route evidence lifecycle cannot reopen or change terminal state/i);
});

test('lifecycle is narrow current to superseded or elapsed expired', () => {
  must(/status\s+text\s+NOT\s+NULL\s+DEFAULT\s+'current'\s+CHECK\s*\(\s*status\s+IN\s*\(\s*'current'\s*,\s*'superseded'\s*,\s*'expired'/i);
  must(/NEW\.status\s+NOT\s+IN\s*\(\s*'superseded'\s*,\s*'expired'\s*\)/i);
  must(/Offering route evidence expiry has not elapsed/i);
});

test('0023 introduces no public/client route RPC or writer', () => {
  mustNot(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\./i);
  mustNot(/GRANT\s+(?:INSERT|UPDATE|DELETE|ALL|EXECUTE)[\s\S]*\bTO\s+(?:anon|authenticated|service_role)/i);
});

test('0023 does not redefine existing operational functions or attach operational triggers', () => {
  const forbidden = ['create_movement_offer','accept_movement_offer','create_alignment_activation_payment','request_journey_start','confirm_journey_start','request_movement_end','confirm_movement_end','get_post_activation_people','get_my_movement_settlement_status'];
  for (const name of forbidden) mustNot(new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:public\\.|private\\.)?${name}\\b`, 'i'));
});

test('0023 has no requester matching, negotiation or pricing machinery', () => {
  mustNot(/\b(?:counterproposal|negotiation|requester_accept|come_to_route|meet_closer)\b/i);
  mustNot(/\b(?:price|pricing|fare|surge|fuel|toll|wallet|refund|payout)\b/i);
});

test('0023 has no automatic operational or financial row creation', () => {
  for (const target of ['public.alignments','public.journeys','private.financial_proposals','private.financial_agreements','private.financial_components','private.alignment_activation_payments','private.movement_settlements']) {
    mustNot(new RegExp(`INSERT\\s+INTO\\s+${target.replace('.', '\\.')}`, 'i'));
  }
});

test('behavioral rollback harness covers core security, immutability and closed seam', () => {
  for (const phrase of [
    'service SELECT works', 'authenticated cannot read route evidence', 'cannot mutate route evidence',
    'invalid route coordinate rejected', 'wrong endpoint rejected', 'unresolved endpoint rejected',
    'evidence fields immutable', 'superseded cannot reopen', 'route evidence gate remains closed',
    'no operational rows created',
  ]) assert.match(live, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), 'i'));
});

test('behavioral test is rollback-only', () => {
  assert.match(live.trim(), /^BEGIN;/i);
  assert.match(live.trim(), /ROLLBACK;\s*$/i);
  assert.doesNotMatch(live, /\bCOMMIT\s*;/i);
});
