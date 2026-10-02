'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const sql = read('supabase/migrations/0067_wallet_provisioning_fail_closed.sql').replace(/--[^\n]*/g, '');
test('0067 replaces only provisioning and preserves the exact return contract', () => {
  assert.match(sql, /^BEGIN;/); assert.match(sql, /COMMIT;\s*$/);
  assert.deepEqual([...sql.matchAll(/CREATE OR REPLACE FUNCTION ([\w.]+)/g)].map(x => x[1]), ['public.ensure_ngn_wallet_accounts_for_server']);
  const old = read('supabase/migrations/0065_wallet_access_foundation.sql');
  const signature = s => s.match(/ensure_ngn_wallet_accounts_for_server\([\s\S]*?\)\s*RETURNS TABLE \([\s\S]*?\)/)[0].replace(/\s+/g, ' ');
  assert.equal(signature(sql), signature(old));
  assert.match(sql, /SECURITY DEFINER\s+SET search_path = ''/);
});
test('member serialization and complete existing-state validation precede the zero-only insert', () => {
  const insert = sql.indexOf('INSERT INTO private.wallet_accounts');
  for (const token of ['FOR UPDATE;', 'ORDER BY a.id FOR SHARE;', 'v_total <> 3 OR v_active <> 3 OR v_kinds <> 3', 'IF v_total = 0 THEN']) {
    assert(sql.indexOf(token) > 0 && sql.indexOf(token) < insert, token);
  }
  assert.match(sql, /count\(DISTINCT a.account_kind\)/);
  assert.equal((sql.match(/INSERT INTO/g) || []).length, 1);
});
test('0067 keeps service-only execution and introduces no other wallet operation', () => {
  assert.match(sql, /FROM PUBLIC, anon, authenticated, service_role;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public.ensure_ngn_wallet_accounts_for_server\(uuid\)\s+TO service_role;/);
  assert.equal((sql.match(/GRANT /g) || []).length, 1);
  assert.doesNotMatch(sql, /CREATE TABLE|CREATE POLICY|ALTER |DROP |DELETE |TRUNCATE |wallet_postings|wallet_transactions|get_my_wallet_balance|record_wallet_top_up|provider|activation|settlement|refund|withdrawal|payment/i);
});
test('real behavioral audit uses deployed runtime and rolls back', () => {
  const harness = read('supabase/tests/wallet_foundations_behavior_test.sql');
  assert.match(harness, /^BEGIN;/);
  assert.match(harness, /SET CONSTRAINTS ALL IMMEDIATE;\s*ROLLBACK;\s*$/);
  assert.doesNotMatch(harness, /\bCOMMIT\s*;|CREATE OR REPLACE|DISABLE TRIGGER|session_replication_role/i);
  const runner = read('supabase/tests/wallet_foundations_behavior.cjs');
  assert.match(runner, /ON_ERROR_STOP=1/);
  assert.match(runner, /assert.equal\(after, before/);
});
