'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const raw = fs.readFileSync(path.join(__dirname, '../supabase/migrations/0066_wallet_top_up_foundation.sql'), 'utf8');
const sql = raw.replace(/--[^\n]*/g, '');

test('0066 replaces only the deferred dispatcher and rejects unexpected trigger tables', () => {
  assert.deepEqual([...sql.matchAll(/CREATE OR REPLACE FUNCTION ([\w.]+)/g)].map(m => m[1]), ['private.validate_wallet_transaction_deferred']);
  assert.match(sql, /IF TG_TABLE_NAME = 'wallet_transactions' THEN\s*PERFORM private.assert_wallet_transaction_balanced\(NEW.id\);\s*ELSIF TG_TABLE_NAME = 'wallet_postings' THEN\s*PERFORM private.assert_wallet_transaction_balanced\(NEW.transaction_id\);\s*ELSE\s*RAISE EXCEPTION/);
  assert.doesNotMatch(sql, /CREATE (?:CONSTRAINT )?TRIGGER|CREATE POLICY|ALTER TABLE/);
});

test('0066 adds only one transaction-wrapped narrow service RPC', () => {
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /COMMIT;\s*$/);
  assert.deepEqual([...sql.matchAll(/CREATE FUNCTION ([\w.]+)/g)].map(m => m[1]), ['public.record_wallet_top_up_for_server']);
  assert.match(sql, /p_member_id uuid,\s*p_amount_minor bigint,\s*p_currency text,\s*p_provider text,\s*p_provider_reference text\s*\)\s*RETURNS uuid/);
  assert.match(sql, /SECURITY DEFINER\s+SET search_path = ''/);
  assert.doesNotMatch(sql, /\b(?:ALTER|DROP|TRUNCATE|DELETE|DISABLE)\b|\bUPDATE\s+(?:private|public)\./i);
});
test('writer is service-only and never grants direct table writes', () => {
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.record_wallet_top_up_for_server\(uuid,bigint,text,text,text\)\s+FROM PUBLIC, anon, authenticated, service_role;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.record_wallet_top_up_for_server\(uuid,bigint,text,text,text\)\s+TO service_role;/);
  assert.equal((sql.match(/GRANT /g) || []).length, 1);
  assert.doesNotMatch(sql, /CREATE POLICY|TO authenticated|TO anon/);
});
test('input provenance is bounded, NGN-only, positive and internally hashed without ambiguous delimiters', () => {
  for (const pattern of [/p_amount_minor <= 0/, /p_currency <> 'NGN'/, /length\(p_provider\) NOT BETWEEN 1 AND 100/,
    /length\(p_provider_reference\) NOT BETWEEN 1 AND 255/, /\[\[:cntrl:\]\]/,
    /sha256\(convert_to\(\s*jsonb_build_array\(p_provider, p_provider_reference\)::text/]) assert.match(sql, pattern);
  assert.doesNotMatch(sql.slice(0, sql.indexOf('RETURNS')), /p_(?:account|idempotency|direction|transaction_kind|financial_component)/);
});
test('event lock precedes replay lookup and uses READ COMMITTED visibility', () => {
  assert.match(sql, /current_setting\('transaction_isolation'\) IS DISTINCT FROM 'read committed'/);
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\(v_key, 0\)\)/);
  assert(sql.indexOf('pg_advisory_xact_lock') < sql.indexOf('SELECT t.* INTO v_previous'));
  for (const field of ['transaction_kind', 'currency', 'alignment_id', 'financial_component_id', 'idempotency_key']) assert.match(sql, new RegExp('v_previous\\.' + field));
  assert.match(sql, /v_total <> 2 OR v_matching <> 2/);
  assert.match(sql, /RETURN v_previous.id/);
});
test('wallet state is checked before 0065 provisioning and clearing is unique and active', () => {
  assert(sql.indexOf('v_total NOT IN (0, 3)') < sql.indexOf('FROM public.ensure_ngn_wallet_accounts_for_server'));
  assert.match(sql, /FROM public.members m WHERE m.id = p_member_id FOR UPDATE/);
  assert.match(sql, /ON CONFLICT \(account_kind, currency\) WHERE member_id IS NULL DO NOTHING/);
  assert.match(sql, /account_kind = 'provider_clearing'[\s\S]*a.status = 'active'/);
  assert.match(sql, /v_balance \+ p_amount_minor > 9223372036854775807::numeric/);
});
test('exact accounting shape is internal and still asserts deferred ledger invariants', () => {
  assert.match(sql, /VALUES \('wallet_top_up', 'NGN', p_provider, p_provider_reference, v_key, NULL, NULL\)/);
  assert.match(sql, /VALUES \(v_id, v_clearing, 'debit', p_amount_minor\),\s*\(v_id, v_available, 'credit', p_amount_minor\)/);
  assert.equal((sql.match(/INSERT INTO private.wallet_postings/g) || []).length, 1);
  assert.match(sql, /private.assert_wallet_transaction_balanced\(v_id\)/);
  assert.doesNotMatch(sql, /SET CONSTRAINTS|session_replication_role/);
});
test('no provider integration or other money or movement lifecycle is added', () => {
  assert.doesNotMatch(sql, /paystack|flutterwave|monnify|opay|palmpay|webhook|callback|virtual_account|https?:|secret/i);
  assert.doesNotMatch(sql, /platform_revenue|movement_hold|hold_release|settlement|refund|withdrawal|provider_fee|internal_transfer/i);
  assert.doesNotMatch(sql, /INSERT INTO public\.|UPDATE public\.|activation|financial_agreements/);
});
