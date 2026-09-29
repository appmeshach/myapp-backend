const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const name = '0055_offerer_alignment_continuation_recovery';
const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/\r\n/g, '\n');
const raw = read('../migrations/' + name + '.sql');
const sql = raw.replace(/--[^\n]*/g, '');
const live = read(name + '_test.sql');
const rpc = 'public.list_my_offerer_movement_continuations';
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
    '\\gset', '\\if :restored', "SELECT '0055 complete rollback verified' AS result;",
    '\\else', '\\quit 1', '\\endif', ''].join('\n');
}
if (process.argv.includes('--print-rollback')) { process.stdout.write(rollbackBatch()); process.exit(0); }

test('0055 adds exactly one transactional read RPC with a limit-only signature', () => {
  assert.equal((sql.match(/^BEGIN;/gm) || []).length, 1);
  assert.equal((sql.match(/^COMMIT;/gm) || []).length, 1);
  assert.deepEqual([...sql.matchAll(/CREATE FUNCTION ([\w.]+)/g)].map(m => m[1]), [rpc]);
  assert.match(sql, /list_my_offerer_movement_continuations\(p_limit integer DEFAULT 20\)/);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|PERFORM)\b/i);
});
test('0055 requires an existing authenticated member and authenticated-only execution', () => {
  assert.match(sql, /LANGUAGE plpgsql\s+SECURITY DEFINER\s+SET search_path = ''/);
  assert.match(sql, /v_member_id uuid := auth.uid\(\)/);
  assert.match(sql, /v_member_id IS NULL OR NOT EXISTS \(\s+SELECT 1 FROM public.members m WHERE m.id = v_member_id/);
  assert.match(sql, /p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public.list_my_offerer_movement_continuations\(integer\)\s+FROM PUBLIC, anon, authenticated, service_role/);
  assert.deepEqual([...sql.matchAll(/GRANT[^;]+;/g)].map(m => m[0]),
    [`GRANT EXECUTE ON FUNCTION ${rpc}(integer)\nTO authenticated;`]);
});
test('0055 exposes only the safe shape using trusted broad mappings without legacy fallback', () => {
  assert.deepEqual(sql.match(/RETURNS TABLE \(([\s\S]*?)\)/)[1].split(',').map(s => s.trim()),
    ['movement_need_id uuid','alignment_status text','origin_area text','destination_area text','created_at timestamptz']);
  assert.equal((sql.match(/JOIN private.trusted_location_discovery_areas/g) || []).length, 2);
  assert.match(sql, /ol.role = 'origin'/);
  assert.match(sql, /dl.role = 'destination'/);
  assert.match(sql, /od.discovery_area_label, dd.discovery_area_label/);
  assert.doesNotMatch(sql, /public.movement_needs|latitude|longitude|route_shape|provider|alignment_id|movement_offer_id|payment_id/);
});
test('0055 scopes to offerer and accepted lifecycle without departure/availability eligibility', () => {
  assert.match(sql, /WHERE a.offering_member_id = v_member_id\s+AND a.status IN \('awaiting_activation_payment', 'activated'\)/);
  assert.match(sql, /ORDER BY a.created_at DESC, a.movement_need_id DESC\s+LIMIT p_limit/);
  assert.doesNotMatch(sql, /member_needing_movement_id|departure|expires_at|discoverable|assert_offering|WHEN OTHERS/);
});
test('0055 rollback batch verifies complete restoration and live read-only behavior', () => {
  const batch = rollbackBatch();
  assert.equal((batch.match(/^BEGIN;/gm) || []).length, 1);
  assert.equal((batch.match(/^ROLLBACK;/gm) || []).length, 1);
  assert.doesNotMatch(batch, /DISABLE TRIGGER|session_replication_role/);
  assert.match(batch, /0055 complete rollback verified/);
  assert.match(live, /WHERE NOT passed/);
  assert.match(live, /before_state=after_state/);
});
