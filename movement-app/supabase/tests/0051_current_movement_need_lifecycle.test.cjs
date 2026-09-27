const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const name = '0051_current_movement_need_lifecycle';
const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/\r\n/g, '\n');
const clean = text => text.replace(/'(?:''|[^'])*'|--[^\n]*|\/\*[\s\S]*?\*\//g,
  token => token.startsWith("'") ? token : ' ');
const sql = clean(read(`../migrations/${name}.sql`));
const live = clean(read(`${name}_test.sql`));

// Snapshot installation metadata and all tables touched by the fixture (including
// the auth-user member trigger). psql variables survive the test's ROLLBACK.
const snapshot = `SELECT jsonb_build_object(
  'rpcs', (SELECT jsonb_agg(jsonb_build_object(
    'oid', p.oid, 'definition', pg_get_functiondef(p.oid),
    'acl', p.proacl, 'owner', p.proowner) ORDER BY p.oid)
    FROM pg_proc p WHERE p.oid IN (
      to_regprocedure('public.discover_masked_movement_needs(integer)'),
      to_regprocedure('public.get_my_current_movement_need()'))),
  'history', (SELECT jsonb_agg(to_jsonb(m) ORDER BY version)
    FROM supabase_migrations.schema_migrations m),
  'counts', jsonb_build_array(
    (SELECT count(*) FROM auth.users),
    (SELECT count(*) FROM public.members),
    (SELECT count(*) FROM public.movement_needs),
    (SELECT count(*) FROM private.movement_need_locations),
    (SELECT count(*) FROM private.movement_location_references),
    (SELECT count(*) FROM private.movement_location_resolution_evidence),
    (SELECT count(*) FROM private.trusted_location_discovery_areas))
) AS state`;

function rollbackBatch() {
  const migration = read(`../migrations/${name}.sql`).trim();
  const behavioral = read(`${name}_test.sql`).trim();
  assert.match(migration, /^BEGIN;[\s\S]*COMMIT;$/);
  assert.match(behavioral, /^BEGIN;\s*SET TRANSACTION ISOLATION LEVEL READ COMMITTED;/);
  assert.match(behavioral, /ROLLBACK;$/);
  const batch = migration.replace(/COMMIT;$/, '') + '\n' + behavioral.replace(
    /^BEGIN;\s*SET TRANSACTION ISOLATION LEVEL READ COMMITTED;/, '');
  assert.doesNotMatch(clean(batch), /\bCOMMIT\s*;/i);
  assert.equal((clean(batch).match(/^BEGIN;/gm) || []).length, 1);
  return `\\set ON_ERROR_STOP on
${snapshot}
\\gset before_
SELECT count(*) AS migration_count_before, min(version) AS first_version, max(version) AS latest_version,
  to_regprocedure('public.get_my_current_movement_need()') IS NULL AS recovery_absent_before
FROM supabase_migrations.schema_migrations;
${batch}
${snapshot}
\\gset after_
SELECT :'before_state'::jsonb = :'after_state'::jsonb AS restored
\\gset
\\if :restored
SELECT '0051 rollback verified: RPC definitions, identities, permissions, migration history and fixture table counts restored' AS result;
SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;
\\else
\\echo '0051 rollback verification FAILED'
\\quit 1
\\endif
`;
}

if (process.argv.includes('--print-rollback')) {
  process.stdout.write(rollbackBatch());
  process.exit(0);
}
function definition(source, name) {
  const match = source.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$([a-z_]+)\\$;`));
  assert.ok(match, `missing function ${name}`);
  return match[0];
}
const discovery = definition(sql, 'discover_masked_movement_needs');
const current = definition(sql, 'get_my_current_movement_need');
const deadline = /AND COALESCE\(\s*mn\.latest_departure_at,\s*mn\.earliest_departure_at\s*\) > v_now/;

test('0051 exists and defines both RPCs in one transaction without deleting history', () => {
  assert.match(sql.trim(), /^BEGIN;/);
  assert.match(sql.trim(), /COMMIT;$/);
  assert.equal((sql.match(/CREATE OR REPLACE FUNCTION/g) || []).length, 2);
  assert.doesNotMatch(sql, /\b(?:DELETE|TRUNCATE|DROP|UPDATE|INSERT|ALTER)\b/i);
});

test('masked discovery excludes own and expired requests using the effective deadline', () => {
  assert.match(discovery, /v_now timestamptz := clock_timestamp\(\)/);
  assert.match(discovery, /WHERE mn\.status = 'discoverable'\s+AND mn\.member_id <> v_member_id/);
  assert.match(discovery, deadline);
});

test('masked discovery preserves the complete trusted masked 0041 contract', () => {
  const prior = definition(clean(read('../migrations/0041_trusted_masked_movement_discovery.sql')),
    'discover_masked_movement_needs');
  const normalize = value => value.replace(/\s+/g, ' ').trim();
  assert.equal(normalize(discovery.replace(/v_now timestamptz := clock_timestamp\(\);/, '').replace(deadline, '')),
    normalize(prior));
});

test('current recovery is caller-scoped, discoverable, and newest-first with the same deadline', () => {
  assert.match(current, /get_my_current_movement_need\(\)/);
  assert.match(current, /RETURNS TABLE \(\s*movement_need_id uuid\s*\)/);
  assert.match(current, /v_member_id := auth\.uid\(\)/);
  assert.match(current, /v_now timestamptz := clock_timestamp\(\)/);
  assert.match(current, /WHERE mn\.member_id = v_member_id\s+AND mn\.status = 'discoverable'/);
  assert.match(current, deadline);
  assert.match(current, /ORDER BY\s*mn\.created_at DESC,\s*mn\.id DESC\s+LIMIT 1;/);
});

test('both RPCs retain authenticated-only execution and hardened search paths', () => {
  for (const [name, args, body] of [
    ['discover_masked_movement_needs', 'integer', discovery],
    ['get_my_current_movement_need', '', current],
  ]) {
    assert.match(body, /SECURITY DEFINER\s+SET search_path = ''/);
    assert.match(body, /v_member_id := auth\.uid\(\);\s+IF v_member_id IS NULL THEN\s+RAISE EXCEPTION 'Authentication required';/);
    assert.match(sql, new RegExp(`REVOKE ALL\\s+ON FUNCTION public\\.${name}\\(${args}\\)\\s+FROM PUBLIC, anon, authenticated, service_role;`));
    assert.match(sql, new RegExp(`GRANT EXECUTE\\s+ON FUNCTION public\\.${name}\\(${args}\\)\\s+TO authenticated;`));
  }
  assert.equal((sql.match(/GRANT EXECUTE/g) || []).length, 2);
});

test('behavioral suite rolls back and requires every named check to pass', () => {
  assert.match(live.trim(), /^BEGIN;/);
  assert.match(live.trim(), /ROLLBACK;$/);
  assert.doesNotMatch(live, /\bCOMMIT\s*;|CREATE OR REPLACE FUNCTION public\./i);
  assert.equal((live.match(/PERFORM pg_temp.discovery_check\(/g) || []).length, 12);
  assert.match(live, /count\(\*\) FROM pg_temp.discovery_results\) <> 12/);
  assert.match(live, /WHERE NOT passed/);
});

test('rollback batch has one transaction, no commit, and verifies restoration after rollback', () => {
  const batch = rollbackBatch();
  assert.equal((clean(batch).match(/^BEGIN;/gm) || []).length, 1);
  assert.equal((clean(batch).match(/^ROLLBACK;/gm) || []).length, 1);
  assert.doesNotMatch(clean(batch), /\bCOMMIT\s*;/i);
  assert.ok(batch.indexOf('ROLLBACK;') < batch.indexOf('\\gset after_'));
  assert.match(batch, /\\set ON_ERROR_STOP on/);
  assert.match(batch, /\\quit 1/);
});

test('fixtures expire naturally without changing clocks, triggers or production functions', () => {
  assert.equal((live.match(/pg_sleep\(/g) || []).length, 1);
  assert.match(live, /t := clock_timestamp\(\);\s+INSERT INTO public\.movement_needs/);
  assert.match(live, /t \+ interval '2 seconds' - clock_timestamp\(\)/);
  assert.match(live, /UPDATE public\.movement_needs SET status = 'paused'/);
  assert.doesNotMatch(live, /DISABLE\s+TRIGGER|DROP\s+TRIGGER|session_replication_role|CREATE OR REPLACE FUNCTION (?:public|private)\./i);
});
