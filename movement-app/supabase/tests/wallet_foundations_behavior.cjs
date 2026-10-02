'use strict';
// Explicit local integration runner; not discovered by node --test.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
function psql(input) {
  const r = spawnSync('docker', ['exec', '-i', 'supabase_db_movement-app', 'psql',
    '-X', '-qAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], {
    input, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024, windowsHide: true,
  });
  if (r.error) throw r.error;
  return r;
}
function query(input) {
  const r = psql(input);
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
}
// Compare whole fixture-bearing tables and all public/private function definitions
// and ACLs in fresh connections, including after an expected-condition failure.
const fingerprint = `SELECT jsonb_build_object(
  'tables',(SELECT jsonb_object_agg(name,query_to_xml(format(
    'SELECT count(*) AS n, md5(coalesce(string_agg(to_jsonb(t)::text, '''' ORDER BY to_jsonb(t)::text), '''')) AS hash FROM %s t', name),false,true,'')::text)
    FROM unnest(ARRAY['auth.users','public.members','private.wallet_accounts','private.wallet_transactions','private.wallet_postings']) t(name)),
  'functions',(SELECT md5(string_agg(pg_get_functiondef(p.oid)||coalesce(p.proacl::text,''),'' ORDER BY p.oid))
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private') AND p.prokind='f'));`;
assert.equal(query("SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version IN ('0066','0067');"), '2', 'Run Supabase migration up --local through 0067 first');
const before = query(fingerprint);
const r = psql(fs.readFileSync(path.join(__dirname, 'wallet_foundations_behavior_test.sql'), 'utf8'));
process.stdout.write(r.stdout); process.stderr.write(r.stderr);
const after = query(fingerprint);
assert.equal(after, before, 'Rollback must leave users, members, wallet rows and functions unchanged');
console.log('PASS rollback fingerprint: all fixture-bearing tables and public/private functions unchanged');
process.exitCode = r.status ?? 1;
