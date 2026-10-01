'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(
  path.resolve(__dirname, '../supabase/migrations/0065_wallet_access_foundation.sql'),
  'utf8',
);
const executableSql = migration.replace(/--[^\n]*/g, '');

function has(pattern, message) {
  assert.match(migration, pattern, message);
}

test('0065 is additive and transaction wrapped', () => {
  has(/^BEGIN;/);
  has(/COMMIT;\s*$/);
  assert.doesNotMatch(executableSql, /\b(?:ALTER|DROP|TRUNCATE)\b/i);
});

test('service-only provisioning creates exactly the three NGN member account kinds', () => {
  has(/CREATE FUNCTION public\.ensure_ngn_wallet_accounts_for_server\(\s*p_member_id uuid\s*\)/i);
  for (const kind of ['member_available', 'member_held', 'member_withdrawable']) {
    has(new RegExp(`'${kind}'`));
  }
  assert.doesNotMatch(executableSql, /platform_revenue|provider_clearing[\s\S]{0,300}INSERT INTO private\.wallet_accounts/i);
  has(/ON CONFLICT \(member_id, account_kind, currency\)[\s\S]*DO NOTHING/i);
});

test('provisioning validates member and fails closed for closed or partial wallets', () => {
  has(/FROM public\.members m[\s\S]*WHERE m\.id = p_member_id[\s\S]*FOR SHARE/i);
  has(/v_total IS DISTINCT FROM 3/i);
  has(/v_active IS DISTINCT FROM 3/i);
  has(/Member wallet unavailable/);
});

test('provisioning is service-role only and exposes no client wallet writer', () => {
  has(/REVOKE ALL ON FUNCTION public\.ensure_ngn_wallet_accounts_for_server\(uuid\)[\s\S]*FROM PUBLIC, anon, authenticated, service_role/i);
  has(/GRANT EXECUTE ON FUNCTION public\.ensure_ngn_wallet_accounts_for_server\(uuid\)[\s\S]*TO service_role/i);
  assert.doesNotMatch(executableSql, /GRANT EXECUTE ON FUNCTION public\.ensure_ngn_wallet_accounts_for_server\(uuid\)[\s\S]*TO authenticated/i);
});

test('member balance projection authenticates from auth uid and never accepts a member id', () => {
  has(/CREATE FUNCTION public\.get_my_wallet_balance\(\)/i);
  has(/v_caller uuid := auth\.uid\(\)/i);
  has(/Authenticated member required/);
  assert.doesNotMatch(executableSql, /get_my_wallet_balance\([^)]*uuid/i);
});

test('unprovisioned wallet returns explicit not-ready zero balances without creating accounts', () => {
  has(/IF v_total = 0 THEN[\s\S]*'NGN'::text, false, 0::bigint, 0::bigint, 0::bigint/i);
  const balanceStart = executableSql.indexOf('CREATE FUNCTION public.get_my_wallet_balance()');
  assert(balanceStart >= 0);
  const balanceBody = executableSql.slice(balanceStart);
  assert.doesNotMatch(balanceBody, /INSERT INTO private\.wallet_accounts/i);
});

test('balance is derived from immutable postings and only caller member accounts', () => {
  has(/LEFT JOIN private\.wallet_postings p ON p\.account_id=a\.id/i);
  has(/a\.member_id=v_caller/i);
  has(/a\.currency='NGN'/i);
  has(/a\.status='active'/i);
  has(/p\.direction='credit'[\s\S]*p\.amount_minor::numeric[\s\S]*-p\.amount_minor::numeric/i);
});

test('safe projection returns only currency readiness and three balance values', () => {
  has(/RETURNS TABLE \(\s*currency text,\s*wallet_ready boolean,\s*available_minor bigint,\s*held_minor bigint,\s*withdrawable_minor bigint\s*\)/i);
  assert.doesNotMatch(executableSql, /provider_reference|idempotency_key|transaction_id|financial_component_id/i);
});

test('balance projection is authenticated read-only and fails closed on impossible balances', () => {
  has(/GRANT EXECUTE ON FUNCTION public\.get_my_wallet_balance\(\)[\s\S]*TO authenticated/i);
  has(/v_available < 0 OR v_held < 0 OR v_withdrawable < 0/i);
  has(/v_available > v_bigint_max/i);
  assert.doesNotMatch(executableSql, /INSERT INTO private\.wallet_transactions|INSERT INTO private\.wallet_postings|UPDATE private\.wallet_|DELETE FROM private\.wallet_/i);
});

test('0065 does not implement movement financial operations or provider integration', () => {
  assert.doesNotMatch(executableSql, /wallet_top_up|movement_hold|movement_hold_release|movement_contribution_settlement|withdrawal|refund/i);
  assert.doesNotMatch(executableSql, /paystack|flutterwave|monnify|opay|palmpay|webhook|callback|virtual_account/i);
  assert.doesNotMatch(executableSql, /UPDATE\s+public\.alignments|mark_alignment_activation_payment_succeeded/i);
});
