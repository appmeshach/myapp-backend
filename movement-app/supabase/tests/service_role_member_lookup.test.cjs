'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const migrationPath = 'supabase/migrations/0030_service_role_member_lookup.sql';
const behavioralPath = 'supabase/tests/0030_service_role_member_lookup_test.sql';
function withoutComments(source) {
  return source.replace(/'(?:''|[^'])*'|--[^\r\n]*|\/\*[\s\S]*?\*\//g,
    token => token.startsWith("'") ? token : ' ');
}
const sql = withoutComments(fs.readFileSync(migrationPath, 'utf8'));
const behavioral = withoutComments(fs.readFileSync(behavioralPath, 'utf8'));

test('0030 grants only service_role member SELECT in one transaction', () => {
  // Exact statement allowlist prevents write grants, anon grants, other tables,
  // authenticated revocations, grant options, and RLS/policy changes.
  assert.deepEqual(sql.split(';').map(statement => statement.replace(/\s+/g, ' ').trim()).filter(Boolean), [
    'BEGIN',
    'GRANT SELECT ON TABLE public.members TO service_role',
    'COMMIT',
  ]);
});

test('0030 behavioral harness checks effective member privileges and RLS', () => {
  assert.match(behavioral, /has_table_privilege\('service_role','public\.members','SELECT'\)/);
  assert.match(behavioral, /NOT has_table_privilege\('anon','public\.members','SELECT'\)/);
  assert.match(behavioral, /has_table_privilege\('authenticated','public\.members','SELECT'\)/);
  assert.match(behavioral, /SELECT relrowsecurity FROM pg_class WHERE oid='public\.members'::regclass/);
  assert.match(behavioral, /set_config\('role','service_role',true\)/);
  assert.match(behavioral, /PERFORM id FROM public\.members WHERE id='[^']+'::uuid LIMIT 2;/);
});

test('0030 behavioral harness rolls back and fails on unsuccessful checks', () => {
  assert.match(behavioral, /^\s*BEGIN;/);
  assert.match(behavioral, /ROLLBACK;\s*$/);
  assert.doesNotMatch(behavioral, /\bCOMMIT\s*;/);
  assert.match(behavioral, /count\(\*\) FROM pg_temp\.member_lookup_results\)<>5/);
  assert.match(behavioral, /EXISTS\(SELECT 1 FROM pg_temp\.member_lookup_results WHERE NOT passed\)/);
  assert.match(behavioral, /RAISE EXCEPTION '0030 behavioral checks failed'/);
});
