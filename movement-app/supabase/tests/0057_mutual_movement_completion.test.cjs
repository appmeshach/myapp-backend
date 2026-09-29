const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const name = '0057_mutual_movement_completion';
const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/\r\n/g, '\n');
const raw = read('../migrations/' + name + '.sql');
const sql = raw.replace(/--[^\n]*/g, '');
const live = read(name + '_test.sql');
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
    '\\gset', '\\if :restored', "SELECT '0057 complete rollback verified' AS result;",
    '\\else', '\\quit 1', '\\endif', ''].join('\n');
}
if (process.argv.includes('--print-rollback')) { process.stdout.write(rollbackBatch()); process.exit(0); }

const names = ['get_my_movement_end_status_by_need','request_my_movement_end','confirm_my_movement_end','decline_my_movement_end'];
test('0057 exposes exact need-only signatures with safe output and authenticated grants', () => {
  assert.equal((sql.match(/CREATE FUNCTION/g)||[]).length, 5);
  assert.equal((sql.match(/SECURITY DEFINER SET search_path = ''/g)||[]).length, 5);
  for (const name of names) {
    const args = name.startsWith('request_') ? ', p_reason text DEFAULT NULL' : '';
    assert(sql.includes(`CREATE FUNCTION public.${name}(p_movement_need_id uuid${args})`));
    const signature = `public.${name}(uuid${args ? ',text' : ''})`;
    assert(sql.includes(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC, anon, authenticated, service_role;`));
    assert(sql.includes(`GRANT EXECUTE ON FUNCTION ${signature} TO authenticated;`));
  }
  for (const match of sql.matchAll(/RETURNS TABLE \(([^)]+)\)/g)) {
    assert.equal(match[1].replace(/\s+/g,' '), 'journey_state text, end_status text, requested_by_me boolean, action_required_from_me boolean, requested_at timestamptz, completed_at timestamptz');
  }
});
test('0057 delegates all lifecycle mutation and guards legacy implicit confirmation under locks', () => {
  for (const action of ['request','confirm','decline']) assert(sql.includes(`PERFORM * FROM public.${action}_movement_end(selected_id`));
  assert(sql.includes('FROM public.get_my_movement_end_status(selected_id)'));
  assert.doesNotMatch(sql,/\b(?:INSERT|DELETE|ALTER|DROP|TRUNCATE|CREATE TABLE|CREATE TRIGGER)\b/i);
  assert.doesNotMatch(sql,/\bUPDATE\s+(?:public|private)\./i);
  assert.match(sql,/IF EXISTS \(SELECT 1 FROM public.get_my_movement_end_status\(selected_id\) s WHERE s.action_required_from_me\)/);
  assert(sql.indexOf('FROM public.journeys j WHERE j.id=selected_id FOR UPDATE') < sql.indexOf('FROM public.alignments x WHERE x.id=selected_alignment FOR UPDATE'));
});
test('0057 private resolver requires real principal and unique mapping including no travel receipt', () => {
  assert.match(sql,/auth.uid\(\) IS NULL/);
  assert.match(sql,/FROM public.members m WHERE m.id=auth.uid\(\)/);
  assert.match(sql,/cardinality\(ids\) IS DISTINCT FROM 1/);
  assert.match(sql,/auth.uid\(\) NOT IN \(a.offering_member_id,a.member_needing_movement_id\)/);
  assert.match(sql,/private.movement_coordination_context\(p_movement_need_id,false\)/);
  assert.match(sql,/private.mutual_no_travel_closures/);
  assert.match(sql,/REVOKE ALL ON FUNCTION private.movement_end_context\(uuid\) FROM PUBLIC, anon, authenticated, service_role/);
});
test('0057 runner guarantees rollback and compares complete database contents and function definitions', () => {
  const batch = rollbackBatch();
  assert.equal((batch.match(/^BEGIN;/gm)||[]).length,1);
  assert.equal((batch.match(/^ROLLBACK;/gm)||[]).length,1);
  assert.doesNotMatch(batch,/DISABLE TRIGGER|session_replication_role|\bCOMMIT;/);
  assert.match(batch, /before_state.*after_state/);
  assert.match(snapshot, /public','private','auth','supabase_migrations/);
});
