const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const name = '0054_offerer_open_availability_recovery';
const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/\r\n/g, '\n');
const raw = read('../migrations/' + name + '.sql');
const sql = raw.replace(/--[^\n]*/g, '');
const live = read(name + '_test.sql');
const rpc = 'public.list_my_open_offering_movement_availabilities';
const fields = ['availability_id uuid', 'offering_movement_intent_id uuid', 'vehicle_id uuid',
  'total_places integer', 'remaining_places integer', 'expires_at timestamptz',
  'origin_area text', 'destination_area text', 'earliest_departure_at timestamptz',
  'latest_departure_at timestamptz', 'vehicle_make text', 'vehicle_model text',
  'vehicle_year integer', 'vehicle_color text'];

// Hash complete table contents, never print private records. Includes users,
// migration history, operational state and all private fixture dependencies.
const snapshot = `SELECT jsonb_build_object(
  'tables', (SELECT jsonb_object_agg(n.nspname||'.'||c.relname,
    query_to_xml(format('SELECT count(*) AS rows, md5(coalesce(string_agg(to_jsonb(t)::text, '''' ORDER BY to_jsonb(t)::text), '''')) AS hash FROM %I.%I t',n.nspname,c.relname),false,true,'')::text)
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind='r' AND n.nspname IN ('public','private','auth','supabase_migrations')),
  'functions', (SELECT jsonb_agg(jsonb_build_object('oid',p.oid,'def',md5(pg_get_functiondef(p.oid)),'acl',p.proacl,'owner',p.proowner) ORDER BY p.oid)
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('public','private') AND p.prokind='f')
) AS state`;
function rollbackBatch() {
  assert.match(raw.trim(), /^BEGIN;[\s\S]*COMMIT;$/);
  assert.match(live.trim(), /^BEGIN;[\s\S]*ROLLBACK;$/);
  const batch = raw.trim().replace(/COMMIT;$/, '') + '\n'
    + live.replace(/^BEGIN;\s*SET TRANSACTION ISOLATION LEVEL READ COMMITTED;/, '');
  assert.doesNotMatch(batch.replace(/--[^\n]*/g, ''), /\bCOMMIT\s*;/i);
  return ['\\set ON_ERROR_STOP on', snapshot, '\\gset before_', batch,
    snapshot, '\\gset after_', "SELECT :'before_state'::jsonb = :'after_state'::jsonb AS restored",
    '\\gset', '\\if :restored', "SELECT '0054 complete rollback verified' AS result;",
    '\\else', '\\quit 1', '\\endif', ''].join('\n');
}
if (process.argv.includes('--print-rollback')) { process.stdout.write(rollbackBatch()); process.exit(0); }

test('0054 adds one transactional read RPC with only a bounded limit input', () => {
  assert.equal((sql.match(/^BEGIN;/gm) || []).length, 1);
  assert.equal((sql.match(/^COMMIT;/gm) || []).length, 1);
  assert.deepEqual([...sql.matchAll(/CREATE FUNCTION ([\w.]+)/g)].map(m => m[1]), [rpc]);
  assert.match(sql, /\(\s*p_limit integer DEFAULT 20\s*\)/);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\b/i);
});
test('0054 authenticates existing member and grants only authenticated execution', () => {
  assert.match(sql, /SECURITY DEFINER\s+SET search_path = ''/);
  assert.match(sql, /v_member_id uuid := auth.uid\(\)/);
  assert.match(sql, /v_member_id IS NULL OR NOT EXISTS \(\s*SELECT 1 FROM public.members m WHERE m.id = v_member_id/);
  assert.match(sql, /p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public.list_my_open_offering_movement_availabilities\(integer\)\s+FROM PUBLIC, anon, authenticated, service_role/);
  assert.deepEqual([...sql.matchAll(/GRANT[^;]+;/g)].map(m => m[0]),
    [`GRANT EXECUTE ON FUNCTION ${rpc}(integer)\nTO authenticated;`]);
});
test('0054 exposes exactly safe recovery fields and trusted broad labels', () => {
  const result = sql.match(/RETURNS TABLE \(([\s\S]*?)\)/)[1].split(',').map(s => s.trim());
  assert.deepEqual(result, fields);
  assert.equal((sql.match(/JOIN private.trusted_location_discovery_areas/g) || []).length, 2);
  assert.doesNotMatch(sql, /latitude|longitude|provider|route_shape|alignment_id|payment_id/);
});
test('0054 filters owned candidates authoritatively before limiting, releasing each lock set', () => {
  assert.match(sql, /WHERE a.offering_member_id = v_member_id\s+ORDER BY i.earliest_departure_at ASC, a.created_at ASC, a.id ASC/);
  assert.match(sql, /BEGIN\s+PERFORM private.assert_offering_movement_availability\(v_candidate.id\);\s+EXCEPTION WHEN check_violation OR no_data_found THEN\s+CONTINUE candidates;\s+END;/);
  assert.doesNotMatch(sql, /WHEN OTHERS|WHEN raise_exception|WHEN insufficient_privilege|\bLIMIT\b/);
  assert.match(sql, /RAISE SQLSTATE 'ZX054'[\s\S]*EXCEPTION WHEN SQLSTATE 'ZX054' THEN\s+NULL;/);
  assert.ok(sql.indexOf('RETURN NEXT') > sql.indexOf("EXCEPTION WHEN SQLSTATE 'ZX054'"));
  assert.match(sql, /RETURN NEXT;\s+v_returned := v_returned \+ 1;\s+EXIT candidates WHEN v_returned >= p_limit/);
});
test('0054 rollback batch verifies complete data and function restoration', () => {
  const batch = rollbackBatch();
  assert.equal((batch.match(/^BEGIN;/gm) || []).length, 1);
  assert.equal((batch.match(/^ROLLBACK;/gm) || []).length, 1);
  assert.doesNotMatch(batch, /DISABLE TRIGGER|session_replication_role/);
  assert.match(batch, /0054 complete rollback verified/);
  assert.match(live, /WHERE NOT passed/);
});
