const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const name = '0056_active_movement_coordination_recovery';
const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/\r\n/g, '\n');
const raw = read('../migrations/' + name + '.sql');
const sql = raw.replace(/--[^\n]*/g, '');
const live = read(name + '_test.sql');
const rpc = 'public.list_my_active_movement_continuations';
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
    '\\gset', '\\if :restored', "SELECT '0056 complete rollback verified' AS result;",
    '\\else', '\\quit 1', '\\endif', ''].join('\n');
}
if (process.argv.includes('--print-rollback')) { process.stdout.write(rollbackBatch()); process.exit(0); }


test('0056 defines one transactional authenticated-only read RPC', () => {
  assert.equal((sql.match(/^BEGIN;/gm)||[]).length,1);
  assert.equal((sql.match(/^COMMIT;/gm)||[]).length,1);
  assert.deepEqual([...sql.matchAll(/CREATE FUNCTION ([\w.]+)/g)].map(m=>m[1]),[rpc]);
  assert.match(sql,/p_limit integer DEFAULT 20/);
  assert.match(sql,/SECURITY DEFINER\s+SET search_path = ''/);
  assert.match(sql,/v_member_id uuid := auth.uid\(\)/);
  assert.match(sql,/FROM public.members m WHERE m.id = v_member_id/);
  assert.match(sql,/p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50/);
  assert.match(sql,/FROM PUBLIC, anon, authenticated, service_role/);
  assert.deepEqual([...sql.matchAll(/GRANT[^;]+;/g)].map(m=>m[0]),[`GRANT EXECUTE ON FUNCTION ${rpc}(integer) TO authenticated;`]);
  assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\b/i);
});
test('0056 requires actual in-progress lifecycle and canonical authorization for both principals',()=>{
  assert.match(sql,/private.movement_coordination_context\(a.movement_need_id, false\)/);
  assert.match(sql,/a.offering_member_id = v_member_id OR a.member_needing_movement_id = v_member_id/);
  assert.match(sql,/a.status = 'in_progress'/);
  assert.match(sql,/c.alignment_id = a.id AND c.journey_status = 'in_progress'/);
  assert.match(sql,/c.began_at IS NOT NULL AND isfinite\(c.began_at\)/);
  assert.match(sql,/ORDER BY c.began_at DESC, a.movement_need_id DESC\s+LIMIT p_limit/);
  assert.doesNotMatch(sql,/awaiting_activation_payment|'activated'|'completed'|departure|WHEN OTHERS/);
});
test('0056 returns only narrow safe fields and trusted broad labels',()=>{
  assert.deepEqual(sql.match(/RETURNS TABLE \(([^)]+)\)/)[1].split(',').map(s=>s.trim()),
    ['movement_need_id uuid','origin_area text','destination_area text','started_at timestamptz']);
  assert.equal((sql.match(/JOIN private.trusted_location_discovery_areas/g)||[]).length,2);
  assert.doesNotMatch(sql,/public.movement_needs|latitude|longitude|provider|route_shape/);
});
test('0056 rollback batch checks complete restoration and no writes',()=>{
  const batch=rollbackBatch();
  assert.equal((batch.match(/^BEGIN;/gm)||[]).length,1);
  assert.equal((batch.match(/^ROLLBACK;/gm)||[]).length,1);
  assert.doesNotMatch(batch,/DISABLE TRIGGER|session_replication_role/);
  assert.match(live,/before_state=after_state/);
});
