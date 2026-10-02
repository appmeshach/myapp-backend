'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const raw = fs.readFileSync(
  path.join(__dirname, '../supabase/migrations/0068_wallet_ledger_hardening.sql'),
  'utf8'
);

const sql = raw.replace(/^\uFEFF/, '').replace(/--[^\n]*/g, '');

test('0068 is one forward migration that replaces only wallet account protection', () => {
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /COMMIT;\s*$/);

  assert.deepEqual(
    [...sql.matchAll(/CREATE OR REPLACE FUNCTION ([\w.]+)/g)].map(m => m[1]),
    ['private.protect_wallet_account']
  );

  assert.doesNotMatch(
    sql,
    /\bCREATE\s+TABLE\b|\bALTER\s+TABLE\b|\bDROP\b|\bCREATE\s+(?:CONSTRAINT\s+)?TRIGGER\b/i
  );
});

test('0068 preserves wallet account immutability and terminal lifecycle', () => {
  assert.match(sql, /TG_OP IN \('DELETE', 'TRUNCATE'\)/);
  assert.match(sql, /NEW\.status IS DISTINCT FROM 'active'/);
  assert.match(sql, /\(to_jsonb\(NEW\) - 'status'\) IS DISTINCT FROM \(to_jsonb\(OLD\) - 'status'\)/);
  assert.match(sql, /OLD\.status IS DISTINCT FROM 'active' OR NEW\.status IS DISTINCT FROM 'closed'/);
});

test('0068 derives closure balance from immutable postings with numeric arithmetic', () => {
  assert.match(sql, /FROM private\.wallet_postings p/);
  assert.match(sql, /p\.account_id = OLD\.id/);
  assert.match(sql, /WHEN p\.direction = 'credit' THEN p\.amount_minor::numeric/);
  assert.match(sql, /ELSE -p\.amount_minor::numeric/);
  assert.match(sql, /v_balance IS DISTINCT FROM 0::numeric/);
});

test('0068 keeps wallet account protection inaccessible to application roles', () => {
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION private\.protect_wallet_account\(\)\s+FROM PUBLIC, anon, authenticated, service_role;/
  );

  assert.doesNotMatch(sql, /\bGRANT\s+EXECUTE\b/i);
});

test('0068 adds no provider, client writer, or movement money operation', () => {
  assert.doesNotMatch(
    sql,
    /paystack|flutterwave|monnify|opay|palmpay|webhook|callback|virtual_account|https?:|secret/i
  );

  assert.doesNotMatch(
    sql,
    /record_wallet_top_up|movement_hold|hold_release|settlement|refund|withdrawal|provider_fee|activation/i
  );

  assert.doesNotMatch(
    sql,
    /\bINSERT INTO private\.wallet_(?:transactions|postings)\b/i
  );
});

test('0068 does not remove the existing same-account posting uniqueness rule', () => {
  assert.doesNotMatch(
    sql,
    /DROP\s+(?:CONSTRAINT|INDEX)|wallet_postings.*UNIQUE|ALTER\s+TABLE\s+private\.wallet_postings/i
  );
});
