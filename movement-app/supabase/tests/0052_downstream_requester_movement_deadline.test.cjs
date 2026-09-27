const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const name = '0052_downstream_requester_movement_deadline';
const rpc = 'public.get_trusted_matching_context_for_server(uuid,uuid,uuid)';
const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/\r\n/g, '\n');
const clean = text => text.replace(/--[^\n]*/g, '');
const normalize = text => clean(text).replace(/\s+/g, ' ').trim();
const raw = read(`../migrations/${name}.sql`);
const sql = clean(raw);
const live = read(`${name}_test.sql`);
const start = 'CREATE OR REPLACE FUNCTION\npublic.get_trusted_matching_context_for_server(';
const previous = read('../migrations/0050_state_bound_movement_matching.sql');
const deadline = /IF COALESCE\(\s*v_need\.latest_departure_at,\s*v_need\.earliest_departure_at\s*\) <= clock_timestamp\(\) THEN\s*RAISE EXCEPTION USING\s*ERRCODE = '23514',\s*MESSAGE = 'Movement need is not available for matching';\s*END IF;/g;

// Include all fixture tables, including writer receipts and auth-trigger rows.
const tables = [
  'auth.users', 'public.members', 'public.vehicles', 'public.member_vehicle_access',
  'public.movement_needs', 'public.movement_participants', 'public.movement_offers',
  'public.alignments', 'public.journeys',
  ...[
    'movement_location_references', 'movement_location_resolution_evidence',
    'movement_location_selection_receipts', 'movement_location_selection_attestations',
    'trusted_location_discovery_areas', 'trusted_location_state_evidence',
    'offering_movement_intents', 'offering_movement_intent_locations',
    'offering_movement_intent_creation_receipts', 'offering_route_evidence',
    'movement_need_locations', 'movement_need_creation_receipts',
    'trusted_route_match_evidence', 'offering_movement_availability',
    'requester_movement_interests', 'movement_offer_route_match_bindings',
    'movement_offer_availability_bindings',
  ].map(table => `private.${table}`),
];
const metadata = `SELECT jsonb_build_object(
  'oid', p.oid, 'owner', p.proowner, 'acl', p.proacl,
  'security_definer', p.prosecdef, 'config', p.proconfig,
  'arguments', pg_get_function_identity_arguments(p.oid),
  'result', pg_get_function_result(p.oid),
  'anon', has_function_privilege('anon', p.oid, 'EXECUTE'),
  'authenticated', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
  'service_role', has_function_privilege('service_role', p.oid, 'EXECUTE')
) AS metadata FROM pg_proc p WHERE p.oid = '${rpc}'::regprocedure`;
const snapshot = `SELECT jsonb_build_object(
  'definition', pg_get_functiondef('${rpc}'::regprocedure),
  'metadata', (${metadata}),
  'history', (SELECT jsonb_agg(to_jsonb(m) ORDER BY version)
    FROM supabase_migrations.schema_migrations m),
  'counts', jsonb_build_array(${tables.map(table => `(SELECT count(*) FROM ${table})`).join(',\n    ')}),
  'fixture_users', (SELECT count(*) FROM auth.users WHERE email LIKE '%@test-0052.invalid')
) AS state`;

function rollbackBatch() {
  assert.match(raw.trim(), /^BEGIN;[\s\S]*COMMIT;$/);
  assert.match(live, /^BEGIN;\s*SET TRANSACTION ISOLATION LEVEL READ COMMITTED;/);
  assert.match(live.trim(), /ROLLBACK;$/);
  const migration = raw.trim().replace(/COMMIT;$/, '')
    .replace(/^BEGIN;/, 'BEGIN;\nSET TRANSACTION ISOLATION LEVEL READ COMMITTED;');
  const behavioral = live.replace(/^BEGIN;\s*SET TRANSACTION ISOLATION LEVEL READ COMMITTED;/, '');
  const batch = `\\set ON_ERROR_STOP on
${snapshot}
\\gset before_
SELECT :'before_state'::jsonb->'metadata' AS function_before;
SELECT min(version) AS first_version, max(version) AS latest_version, count(*) AS migration_count
FROM supabase_migrations.schema_migrations;
${migration}
${metadata}
\\gset applied_
SELECT :'applied_metadata'::jsonb AS function_during_test;
SELECT (:'before_state'::jsonb->'metadata' = :'applied_metadata'::jsonb
  AND :'applied_metadata'::jsonb->>'anon' = 'false'
  AND :'applied_metadata'::jsonb->>'authenticated' = 'false'
  AND :'applied_metadata'::jsonb->>'service_role' = 'true'
  AND :'applied_metadata'::jsonb->>'security_definer' = 'true') AS identity_preserved
\\gset
\\if :identity_preserved
SELECT '0052 OID, owner, ACL, security, search_path and signature preserved; service-only' AS result;
\\else
\\echo '0052 identity/permissions verification FAILED'
ROLLBACK;
\\quit 1
\\endif
${behavioral}
${snapshot}
\\gset after_
SELECT :'before_state'::jsonb = :'after_state'::jsonb AS restored
\\gset
\\if :restored
SELECT '0052 rollback verified: definition, identity, permissions, history and fixture counts restored' AS result;
SELECT :'after_state'::jsonb->'metadata' AS function_after_rollback,
  :'after_state'::jsonb->'fixture_users' AS fixture_users_remaining;
SELECT min(version) AS first_version, max(version) AS latest_version, count(*) AS migration_count
FROM supabase_migrations.schema_migrations;
\\else
\\echo '0052 rollback verification FAILED'
\\quit 1
\\endif
`;
  assert.doesNotMatch(clean(batch), /\bCOMMIT\s*;/i);
  return batch;
}

if (process.argv.includes('--print-rollback')) {
  process.stdout.write(rollbackBatch());
  process.exit(0);
}

test('0052 replaces only the exact existing public signature in one transaction', () => {
  assert.match(sql, /^BEGIN;/);
  assert.match(sql.trim(), /COMMIT;$/);
  assert.equal((sql.match(/CREATE OR REPLACE FUNCTION/g) || []).length, 1);
  assert.match(sql, /public\.get_trusted_matching_context_for_server\(\s*p_movement_need_id uuid,\s*p_offering_movement_intent_id uuid,\s*p_offering_member_id uuid\s*\)/);
  assert.doesNotMatch(sql, /\bDROP\b/i);
});

test('removing only the two deadline guards exactly restores the complete 0050 contract', () => {
  assert.ok(previous.includes(start));
  assert.ok(raw.includes(start));
  assert.equal((sql.match(deadline) || []).length, 2);
  assert.equal(normalize(raw.slice(raw.indexOf(start)).replace(deadline, '')),
    normalize(previous.slice(previous.indexOf(start))));
});

test('early effective deadline check follows locked need and status validation', () => {
  const checks = [...sql.matchAll(deadline)];
  assert.equal(checks.length, 2);
  assert.match(sql.slice(0, checks[0].index), /FROM public\.movement_needs n[\s\S]*FOR SHARE;[\s\S]*IF v_need\.status <> 'discoverable' THEN[\s\S]*END IF;\s*$/);
  assert.match(sql.slice(checks[0].index + checks[0][0].length), /^\s*IF v_need\.member_id = p_offering_member_id THEN/);
});

test('final fresh clock check follows dependency/state validation immediately before return', () => {
  const checks = [...sql.matchAll(deadline)];
  assert.equal(checks.length, 2);
  assert.match(sql.slice(0, checks[1].index), /PERFORM private\.assert_state_bound_matching_context\(\s*v_requester_origin\.id,\s*v_requester_destination\.id,\s*v_evidence\.id\s*\);\s*$/);
  assert.match(sql.slice(checks[1].index + checks[1][0].length), /^\s*RETURN QUERY/);
  assert.equal((sql.match(/RETURN QUERY/g) || []).length, 1);
});

test('function retains security definer, empty search path and service-only grants', () => {
  assert.match(sql, /SECURITY DEFINER\s+SET search_path = ''/);
  assert.match(sql, /REVOKE ALL\s+ON FUNCTION\s+public\.get_trusted_matching_context_for_server\(\s*uuid,\s*uuid,\s*uuid\s*\)\s*FROM PUBLIC, anon, authenticated, service_role;/);
  assert.match(sql, /GRANT EXECUTE\s+ON FUNCTION\s+public\.get_trusted_matching_context_for_server\(\s*uuid,\s*uuid,\s*uuid\s*\)\s*TO service_role;/);
});

test('migration adds no writes, trigger bypass, clock hooks or unrelated policies', () => {
  assert.doesNotMatch(sql, /\b(?:DELETE|TRUNCATE|UPDATE|INSERT|ALTER|DROP)\b/i);
  assert.doesNotMatch(sql, /session_replication_role|DISABLE\s+TRIGGER|financial_proposal|max_detour|pg_sleep|pg_temp/i);
});

test('behavioral fixtures expire naturally with intact production writers and guards', () => {
  assert.equal((live.match(/pg_sleep\(/g) || []).length, 2);
  assert.match(live, /deadline:=clock_timestamp\(\)\+interval '4 seconds'/);
  assert.match(live, /public\.record_attested_location_resolution_for_server/);
  assert.match(live, /public\.create_movement_need/);
  assert.doesNotMatch(clean(live), /DISABLE\s+TRIGGER|DROP\s+TRIGGER|session_replication_role|CREATE(?: OR REPLACE)? FUNCTION (?:public|private)\./i);
  assert.match(live, /WHERE NOT passed/);
  assert.match(live, /count\(\*\) FROM pg_temp\.interest_results\)<>25/);
  const matrix = live.slice(live.indexOf('DO $test$'));
  assert.equal((matrix.match(/PERFORM pg_temp\.(?:interest_check|deadline_denied)\(/g) || []).length, 25);
});

test('rollback batch preserves identity and verifies complete restoration without commit', () => {
  const batch = rollbackBatch();
  assert.equal((clean(batch).match(/^BEGIN;/gm) || []).length, 1);
  assert.doesNotMatch(clean(batch), /\bCOMMIT\s*;/i);
  assert.match(batch, /\\set ON_ERROR_STOP on/);
  assert.match(batch, /\\if :identity_preserved/);
  assert.match(batch, /\\if :restored/);
  assert.ok(batch.lastIndexOf('ROLLBACK;') < batch.indexOf('\\gset after_'));
  assert.match(batch, /\\quit 1/);
});
