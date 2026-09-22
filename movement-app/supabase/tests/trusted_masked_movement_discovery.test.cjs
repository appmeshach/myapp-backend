const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const migrationPath =
  'supabase/migrations/0041_trusted_masked_movement_discovery.sql';

const livePath =
  'supabase/tests/0041_trusted_masked_movement_discovery_test.sql';

const sqlRaw =
  fs.readFileSync(migrationPath, 'utf8');

const liveRaw =
  fs.readFileSync(livePath, 'utf8');

function withoutComments(source) {
  return source.replace(
    /'(?:''|[^'])*'|--[^\r\n]*|\/\*[\s\S]*?\*\//g,
    token => token.startsWith("'") ? token : ' ',
  );
}

const sql =
  withoutComments(sqlRaw);

const live =
  withoutComments(liveRaw);

function must(re, msg) {
  assert.match(sql, re, msg);
}

function mustNot(re, msg) {
  assert.doesNotMatch(sql, re, msg);
}


test('0041 is one transactional discovery-only migration', () => {
  assert.match(
    sql.trim(),
    /^BEGIN;/i,
  );

  assert.match(
    sql.trim(),
    /COMMIT;\s*$/i,
  );

  const functions = [
    ...sql.matchAll(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.([A-Za-z0-9_]+)/gi,
    ),
  ].map(match => match[1]);

  assert.deepEqual(
    functions,
    ['discover_masked_movement_needs'],
  );

  mustNot(
    /\bCREATE\s+TABLE\b|\bALTER\s+TABLE\b|\bCREATE\s+TRIGGER\b/i,
  );
});


test('0041 preserves the existing discovery RPC signature', () => {
  must(
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.discover_masked_movement_needs\s*\(\s*p_limit\s+integer\s+DEFAULT\s+20\s*\)/i,
  );

  must(
    /RETURNS\s+TABLE\s*\([\s\S]*movement_need_id\s+uuid[\s\S]*origin_area\s+text[\s\S]*destination_area\s+text[\s\S]*earliest_departure_at\s+timestamptz[\s\S]*latest_departure_at\s+timestamptz[\s\S]*people_count\s+integer[\s\S]*age\s+integer[\s\S]*common_movement_area\s+text[\s\S]*identity_verified\s+boolean[\s\S]*profile_media_verified\s+boolean[\s\S]*completed_movements\s+integer[\s\S]*rating\s+numeric[\s\S]*\)/i,
  );
});


test('discovery remains security definer with empty search path', () => {
  must(
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.discover_masked_movement_needs[\s\S]*LANGUAGE\s+plpgsql[\s\S]*SECURITY\s+DEFINER[\s\S]*SET\s+search_path\s*=\s*''/i,
  );
});


test('discovery remains authenticated-only', () => {
  must(
    /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.discover_masked_movement_needs\s*\(\s*integer\s*\)\s+FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i,
  );

  must(
    /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.discover_masked_movement_needs\s*\(\s*integer\s*\)\s+TO\s+authenticated/i,
  );
});


test('discovery requires authenticated caller and bounded limit', () => {
  must(
    /v_member_id\s*:=\s*auth\.uid\(\)/i,
  );

  must(
    /IF\s+v_member_id\s+IS\s+NULL[\s\S]*Authentication required/i,
  );

  must(
    /IF\s+p_limit\s+IS\s+NULL[\s\S]*p_limit is required/i,
  );

  must(
    /p_limit\s*<\s*1\s+OR\s+p_limit\s*>\s*50/i,
  );
});


test('origin and destination come only from trusted discovery-area evidence', () => {
  must(
    /origin_discovery\.discovery_area_label\s+AS\s+origin_area/i,
  );

  must(
    /destination_discovery\.discovery_area_label\s+AS\s+destination_area/i,
  );

  must(
    /INNER\s+JOIN\s+private\.movement_need_locations\s+AS\s+origin_binding[\s\S]*origin_binding\.movement_need_id\s*=\s*mn\.id[\s\S]*origin_binding\.role\s*=\s*'origin'/i,
  );

  must(
    /INNER\s+JOIN\s+private\.movement_need_locations\s+AS\s+destination_binding[\s\S]*destination_binding\.movement_need_id\s*=\s*mn\.id[\s\S]*destination_binding\.role\s*=\s*'destination'/i,
  );

  must(
    /INNER\s+JOIN\s+private\.trusted_location_discovery_areas\s+AS\s+origin_discovery[\s\S]*origin_discovery\.resolved_location_reference_id\s*=\s*origin_binding\.location_reference_id/i,
  );

  must(
    /INNER\s+JOIN\s+private\.trusted_location_discovery_areas\s+AS\s+destination_discovery[\s\S]*destination_discovery\.resolved_location_reference_id\s*=\s*destination_binding\.location_reference_id/i,
  );
});


test('precise movement-need labels cannot be discovery fallback', () => {
  mustNot(
    /\bmn\.origin_area\b/i,
  );

  mustNot(
    /\bmn\.destination_area\b/i,
  );

  mustNot(
    /\bCOALESCE\s*\([\s\S]{0,200}(?:origin_area|destination_area)/i,
  );
});


test('missing trusted broad-area evidence fails closed through inner joins', () => {
  const trustedJoins = [
    ...sql.matchAll(
      /INNER\s+JOIN\s+private\.trusted_location_discovery_areas/gi,
    ),
  ];

  assert.equal(
    trustedJoins.length,
    2,
  );

  mustNot(
    /LEFT\s+(?:OUTER\s+)?JOIN\s+private\.trusted_location_discovery_areas/i,
  );

  mustNot(
    /RIGHT\s+(?:OUTER\s+)?JOIN\s+private\.trusted_location_discovery_areas/i,
  );

  mustNot(
    /FULL\s+(?:OUTER\s+)?JOIN\s+private\.trusted_location_discovery_areas/i,
  );
});


test('original discoverability and self-exclusion rules remain present', () => {
  must(
    /mn\.status\s*=\s*'discoverable'/i,
  );

  must(
    /mn\.member_id\s*<>\s*v_member_id/i,
  );

  must(
    /ORDER\s+BY\s+mn\.earliest_departure_at\s+ASC\s*,\s*mn\.created_at\s+ASC/i,
  );

  must(
    /LIMIT\s+p_limit/i,
  );
});


test('0041 introduces no movement mutation or offer attachment behavior', () => {
  mustNot(
    /\bINSERT\s+INTO\s+public\.movement_(?:needs|offers|participants)\b/i,
  );

  mustNot(
    /\bUPDATE\s+public\.movement_(?:needs|offers|participants)\b/i,
  );

  mustNot(
    /\bDELETE\s+FROM\s+public\.movement_(?:needs|offers|participants)\b/i,
  );

  mustNot(
    /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.(?:create_movement_offer|accept_movement_offer|create_movement_need)\b/i,
  );
});


test('behavioral harness covers trusted broad labels and fail-closed legacy exclusion', () => {
  for (const phrase of [
    'trusted broad-area evidence exists for both endpoints',
    'precise labels remain stored on movement need',
    'trusted movement need is discoverable',
    'discovery returns trusted broad origin and destination',
    'discovery does not expose precise movement need labels',
    'legacy resolved endpoints have no trusted discovery area',
    'legacy movement need remains otherwise discoverable',
    'legacy need without trusted broad area is excluded',
    'requester cannot discover own trusted movement need',
    'anon cannot invoke masked movement discovery',
  ]) {
    assert.match(
      live,
      new RegExp(
        phrase.replace(
          /[.*+?^${}()|[\]\\]/g,
          '\\$&',
        ),
        'i',
      ),
    );
  }
});


test('behavioral harness requires exactly fifteen passing checks and rolls back', () => {
  assert.match(
    live.trim(),
    /^BEGIN;/i,
  );

  assert.match(
    live,
    /total_count\s*<>\s*15/i,
  );

  assert.match(
    live,
    /failed_count\s*<>\s*0/i,
  );

  assert.match(
    live.trim(),
    /ROLLBACK;\s*$/i,
  );

  assert.doesNotMatch(
    live,
    /\bCOMMIT\s*;/i,
  );
});