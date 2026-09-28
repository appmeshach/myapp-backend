const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const name = '0053_requester_alignment_continuation_recovery';
const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8');
const migration = read('../migrations/' + name + '.sql');
const sql = migration.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
const behavioral = read(name + '_test.sql');

function rollbackBatch() {
  assert.match(migration.trim(), /^BEGIN;[\s\S]*COMMIT;$/);
  assert.match(behavioral.trim(), /^BEGIN;[\s\S]*ROLLBACK;$/);
  const batch = migration.trim().replace(/COMMIT;$/, '') + '\n' + behavioral.trim().replace(/^BEGIN;/, '');
  assert.doesNotMatch(batch.replace(/--[^\n]*/g, ''), /\bCOMMIT\s*;/i);
  const snapshot = "SELECT jsonb_build_object('rpc', (SELECT jsonb_build_object('oid',p.oid,'definition',pg_get_functiondef(p.oid),'acl',p.proacl,'owner',p.proowner) FROM pg_proc p WHERE p.oid=to_regprocedure('public.get_my_requester_movement_continuation()')), 'history', (SELECT jsonb_agg(to_jsonb(m) ORDER BY version) FROM supabase_migrations.schema_migrations m), 'users',(SELECT count(*) FROM auth.users), 'alignments',(SELECT count(*) FROM public.alignments)) AS state";
  return ['\\set ON_ERROR_STOP on', snapshot, '\\gset before_', batch, snapshot,
    '\\gset after_', "SELECT :'before_state'::jsonb = :'after_state'::jsonb AS restored", '\\gset',
    '\\if :restored', "SELECT '0053 rollback verified' AS result;", '\\else', '\\quit 1', '\\endif', ''].join('\n');
}
if (process.argv.includes('--print-rollback')) { process.stdout.write(rollbackBatch()); process.exit(0); }

test('0053 is a no-argument read-only caller-scoped hardened RPC', () => {
  assert.match(sql, /get_my_requester_movement_continuation\(\) RETURNS TABLE \( movement_need_id uuid \)/);
  assert.match(sql, /LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''/);
  assert.match(sql, /v_member_id := auth\.uid\(\); IF v_member_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;/);
  assert.match(sql, /SELECT a\.movement_need_id FROM public\.alignments AS a WHERE a\.member_needing_movement_id = v_member_id AND a\.status IN \('awaiting_activation_payment', 'activated'\) ORDER BY a\.created_at DESC, a\.id DESC LIMIT 1;/);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|JOIN)\b|deadline|departure|discoverable/i);
  assert.equal((sql.match(/RETURN QUERY/g) || []).length, 1);
});

test('0053 execution is authenticated-only', () => {
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.get_my_requester_movement_continuation\(\) FROM PUBLIC, anon, authenticated, service_role;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.get_my_requester_movement_continuation\(\) TO authenticated;/);
  assert.equal((sql.match(/GRANT /g) || []).length, 1);
});

test('live test batch installs transiently and always rolls back without changing migration history', () => {
  const batch = rollbackBatch();
  assert.equal((batch.match(/^BEGIN;/gm) || []).length, 1);
  assert.equal((batch.match(/^ROLLBACK;/gm) || []).length, 1);
  assert.doesNotMatch(batch, /DISABLE TRIGGER|session_replication_role/);
  assert.match(batch, /0053 rollback verified/);
});