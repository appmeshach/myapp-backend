const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const test = require('node:test');
const name = '0048_offerer_interest_inbox';
const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/\r\n/g, '\n');
const raw = read(`../migrations/${name}.sql`);
const sql = raw.replace(/--[^\n]*/g, '');
const live = read(`${name}_test.sql`);
const previous = read('../migrations/0047_requester_movement_interest_foundation.sql');
const rpc = 'public.list_requester_movement_interests_for_offerer';
const fields = [
  'interest_id uuid', 'movement_need_id uuid', 'availability_id uuid',
  'origin_area text', 'destination_area text', 'people_count integer',
  'earliest_departure_at timestamptz', 'latest_departure_at timestamptz',
  'requester_origin_distance_to_route_meters bigint', 'interest_created_at timestamptz',
];
const migrationBody = s => s.replace(/^BEGIN;\s*/, '').replace(/COMMIT;\s*$/, '');

// Local review only. If the local database is still at 0046, install the exact
// unchanged prerequisite 0047 inside the same rollback transaction. This never
// applies 0047/0048 persistently or changes the checked-in prior migrations.
function rollbackBatch() {
  return `SELECT to_regclass('private.requester_movement_interests') IS NOT NULL AS had_0047
\\gset
BEGIN;
\\if :had_0047
\\else
${migrationBody(previous)}
\\endif
${migrationBody(raw)}
${live.replace(/^BEGIN;\s*SET TRANSACTION ISOLATION LEVEL READ COMMITTED;/, '')}
DO $restore$ BEGIN
  IF to_regprocedure('${rpc}(uuid,integer)') IS NOT NULL THEN
    RAISE EXCEPTION '0048 inbox survived rollback';
  END IF;
END; $restore$;
SELECT (to_regclass('private.requester_movement_interests') IS NOT NULL) = :'had_0047'::boolean AS prerequisite_restored
\\gset
\\if :prerequisite_restored
SELECT '0048 rollback verified; prior 0047 installation state preserved' AS result;
\\else
\\quit 1
\\endif
`;
}
if (process.argv.includes('--print-rollback')) {
  process.stdout.write(rollbackBatch());
  process.exit(0);
}

test('0048 preserves 0044 through 0047 byte-identically modulo line endings', () => {
  for (const [file, hash] of Object.entries({
    '0044_offering_movement_availability_foundation': '9bd7080c7023401afd622352e111a89d5c08f19c6c153202d9ec71462529149c',
    '0045_movement_offer_availability_capacity': 'e6525b9fa19e5354555ab0c406109d17329df58855b5accb083e12b967e95e27',
    '0046_requester_availability_matching_context': '2cd9a3fa4aa63859f7035e60462e78cb10768fab57a460d299eeb599999bebff',
    '0047_requester_movement_interest_foundation': '31d1e92f46975280cbf1e1fa51166302a74c5aa9f76c71ecf002db23f850433a',
  })) assert.equal(crypto.createHash('sha256').update(read(`../migrations/${file}.sql`)).digest('hex'), hash, file);
});

test('0048 has one transaction and exactly one new authenticated read RPC', () => {
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /COMMIT;\s*$/);
  assert.equal((sql.match(/^BEGIN;/gm) || []).length, 1);
  assert.equal((sql.match(/^COMMIT;/gm) || []).length, 1);
  assert.deepEqual([...sql.matchAll(/CREATE FUNCTION ([\w.]+)/g)].map(m => m[1]), [rpc]);
  assert.doesNotMatch(sql, /CREATE (?:OR REPLACE|TABLE|POLICY|INDEX)|ALTER\s|DROP\s|TRUNCATE\s|DISABLE\s/i);
  assert.match(sql, /p_availability_id uuid DEFAULT NULL,\s+p_limit integer DEFAULT 20/);
  assert.doesNotMatch(raw, /^\s*--[^\n]*CREATE FUNCTION/m);
});

test('definer security pins search path and authenticated-only execution', () => {
  assert.match(sql, /LANGUAGE plpgsql\s+SECURITY DEFINER\s+SET search_path = ''/);
  assert.equal((sql.match(/SECURITY DEFINER/g) || []).length, 1);
  assert.match(sql, /REVOKE ALL ON FUNCTION public.list_requester_movement_interests_for_offerer\(uuid,integer\)\s+FROM PUBLIC, anon, authenticated, service_role;/);
  assert.deepEqual([...sql.matchAll(/GRANT[^;]+;/g)].map(m => m[0]), [
    `GRANT EXECUTE ON FUNCTION ${rpc}(uuid,integer)\nTO authenticated;`,
  ]);
  assert.doesNotMatch(sql, /GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE)|TO service_role|TO anon/);
});

test('identity isolation and bounded limit are checked before candidate evaluation', () => {
  assert.match(sql, /v_member_id uuid := auth.uid\(\)/);
  assert.match(sql, /current_setting\('transaction_isolation'\) <> 'read committed'/);
  assert.match(sql, /v_member_id IS NULL OR NOT EXISTS \(\s+SELECT 1 FROM public.members m WHERE m.id = v_member_id/);
  assert.match(sql, /p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50/);
  assert.ok(sql.indexOf('p_limit IS NULL') < sql.indexOf('FOR v_candidate IN'));
});

test('availability filter and NULL scope require actual availability ownership', () => {
  assert.match(sql, /IF p_availability_id IS NOT NULL AND NOT EXISTS \(\s+SELECT 1 FROM private.offering_movement_availability a\s+WHERE a.id = p_availability_id AND a.offering_member_id = v_member_id\s+\) THEN\s+RETURN;/);
  const candidates = sql.slice(sql.indexOf('FOR v_candidate IN'), sql.indexOf('\n  LOOP'));
  assert.match(candidates, /i.offering_member_id = v_member_id\s+AND a.offering_member_id = v_member_id/);
  assert.match(candidates, /i.status = 'active'\s+AND i.expires_at > clock_timestamp\(\)/);
  assert.match(candidates, /p_availability_id IS NULL OR i.availability_id = p_availability_id/);
});

test('authoritative 0047 support is reused with narrowly scoped error handling', () => {
  assert.equal((sql.match(/PERFORM private.assert_requester_movement_interest\(v_candidate.id\)/g) || []).length, 1);
  assert.doesNotMatch(sql, /public.get_requester_movement_interest\(|WHEN OTHERS|WHEN SQLSTATE '23'|WHEN SQLSTATE '42'/i);
  assert.match(sql, /WHEN check_violation OR no_data_found THEN\s+CONTINUE candidates;/);
  assert.match(sql, /WHEN raise_exception THEN\s+IF SQLERRM IN \(/);
  assert.match(sql, /WHEN insufficient_privilege THEN\s+IF SQLERRM IN \(/);
  assert.equal((sql.match(/END IF;\s+RAISE;/g) || []).length, 2);
  assert.ok(sql.indexOf('PERFORM private.assert_requester_movement_interest') < sql.indexOf('SELECT i.id, n.id, a.id'));
});

test('each candidate releases validation locks before returning and acquiring another need', () => {
  const release = sql.indexOf("RAISE SQLSTATE 'ZX048'");
  const handler = sql.indexOf("EXCEPTION WHEN SQLSTATE 'ZX048' THEN");
  const result = sql.indexOf('RETURN NEXT;');
  assert.ok(release > sql.indexOf('v_visible := FOUND;') && handler > release && result > handler);
  assert.match(sql, /v_visible := false;\s+BEGIN/);
  assert.match(sql, /IF v_visible THEN\s+RETURN NEXT;/);
  assert.doesNotMatch(sql, /FOR UPDATE|FOR SHARE|SKIP LOCKED/);
});

test('safe return shape exactly extends 0047 without hidden or profile fields', () => {
  const signature = sql.match(/RETURNS TABLE \(([^]*?)\)\s+LANGUAGE/)[1];
  assert.deepEqual(signature.split(',').map(s => s.trim()), fields);
  for (const forbidden of ['latitude','longitude','location_reference_id','route_shape','offering_movement_intent_id',
    'route_evidence_id','route_match_evidence_id','member_id','email','phone','gallery','storage_path']) {
    assert.ok(!signature.includes(forbidden), forbidden);
  }
  assert.match(sql, /od.discovery_area_label, dd.discovery_area_label/);
  assert.equal((sql.match(/JOIN private.trusted_location_discovery_areas/g) || []).length, 2);
  assert.doesNotMatch(sql, /n.origin_area|n.destination_area|declared_label|COALESCE/i);
});

test('chronological ordering and output limit never rank or discard valid later rows', () => {
  assert.deepEqual([...sql.matchAll(/ORDER BY[^\n]+/g)].map(m => m[0]), ['ORDER BY i.created_at ASC, i.id ASC']);
  assert.match(sql, /RETURN NEXT;\s+v_returned := v_returned \+ 1;\s+EXIT candidates WHEN v_returned >= p_limit/);
  assert.doesNotMatch(sql, /\bLIMIT\s+p_limit/i);
  assert.doesNotMatch(sql, /rating|\bage\b|score|rank|best_match/i);
  assert.doesNotMatch(sql, /(?:distance|detour)[\w.]*\s*(?:<|>|BETWEEN)|max_distance|max_detour/i);
});

test('0048 has no operational mutations notification or evidence production', () => {
  assert.doesNotMatch(sql, /\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bMERGE\b|\bTRUNCATE\b/i);
  assert.doesNotMatch(sql, /pg_notify|record_trusted_route_match_evidence_for_server|post_activation|gallery|remaining_places\s*=/i);
  assert.doesNotMatch(sql, /CREATE\s+(?:TABLE|TRIGGER|POLICY)|ALTER TABLE/i);
});

test('protected context consumer allowlist remains pinned after sanctioned 0050 addition', () => {
  assert.equal(crypto.createHash('sha256').update(read('movement_context.test.cjs')).digest('hex'),
    '764e02a8eeb02f02793fe69d93b6d3919cd9f86e76d681c4c41cfa65ea0f5370');
  assert.doesNotMatch(sql, /\b(?:movement_location_references|offering_movement_intents|offering_movement_intent_locations|movement_context_snapshots|movement_context_snapshot_travellers)\b/);
});

test('behavioral harness covers the required privacy lifecycle cardinality and side effects', () => {
  for (const scenario of [
    'private route checks alone expose no requester', 'same need in two caller-owned availabilities appears twice',
    'multiple requester needs appear', 'foreign and nonexistent availability indistinguishable',
    'NULL filter lists across only caller-owned availabilities', 'requester cannot enumerate using offerer inbox',
    'return shape has exactly ten approved safe fields', 'large objective distance preserved',
    'withdrawn_interest', 'withdrawn_availability', 'unavailable', 'full', 'group_fit', 'paused_need',
    'closed_need', 'expired_need', 'superseded_match', 'revoked_access', 'vehicle_capacity', 'stale_intent',
    'expired route match evidence excluded', 'explicit expired interest status excluded',
    'replaced exact route support excluded', 'stale earlier candidate does not consume result limit',
    'deterministic created_at ASC then id ASC including ties', 'only authenticated granted inbox execution',
    'direct private read denied', 'inbox leaves all ',
  ]) assert.ok(live.includes(scenario), scenario);
  assert.match(live, /pg_sleep\(2.1\)/);
  assert.doesNotMatch(live, /DISABLE TRIGGER|session_replication_role|CREATE OR REPLACE FUNCTION private\./);
  assert.match(live, /IF EXISTS\(SELECT 1 FROM pg_temp.inbox_results WHERE NOT passed\) THEN\s+RAISE EXCEPTION/);
});

test('rollback harness compiles actual migration SQL and restores prerequisite state', () => {
  assert.match(live, /^BEGIN;\s+SET TRANSACTION ISOLATION LEVEL READ COMMITTED;/);
  assert.match(live, /ROLLBACK;\s*$/);
  const batch = rollbackBatch();
  assert.ok(batch.includes(migrationBody(raw)));
  assert.ok(batch.includes(migrationBody(previous)));
  assert.equal((batch.match(/^BEGIN;/gm) || []).length, 1);
  assert.equal((batch.match(/^ROLLBACK;/gm) || []).length, 1);
  assert.equal((batch.match(/^COMMIT;/gm) || []).length, 0);
  assert.match(batch, /0048 inbox survived rollback/);
  assert.match(batch, /prerequisite_restored/);
});
