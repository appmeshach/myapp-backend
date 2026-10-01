'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(
  path.resolve(__dirname, '../supabase/migrations/0064_wallet_ledger_foundation.sql'),
  'utf8',
);

function has(pattern, message) {
  assert.match(migration, pattern, message);
}

test('wallet foundation defines private accounts, transactions and postings', () => {
  has(/CREATE TABLE private\.wallet_accounts/i);
  has(/CREATE TABLE private\.wallet_transactions/i);
  has(/CREATE TABLE private\.wallet_postings/i);
  has(/member_available/);
  has(/member_held/);
  has(/member_withdrawable/);
  has(/platform_revenue/);
  has(/provider_clearing/);
});

test('wallet foundation keeps operational money writes away from clients', () => {
  for (const table of ['wallet_accounts', 'wallet_transactions', 'wallet_postings']) {
    has(new RegExp(`REVOKE ALL ON TABLE private\\.${table} FROM PUBLIC, anon, authenticated, service_role`, 'i'));
    has(new RegExp(`GRANT SELECT ON TABLE private\\.${table} TO service_role`, 'i'));
  }
  assert.doesNotMatch(migration, /GRANT\s+(?:INSERT|UPDATE|DELETE|ALL)[\s\S]{0,100}authenticated/i);
  assert.doesNotMatch(migration, /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.\w*wallet/i);
});

test('wallet transaction kinds cover funding, hold, settlement, withdrawal and refund without activating movement', () => {
  for (const kind of [
    'wallet_top_up',
    'movement_hold',
    'movement_hold_release',
    'requester_platform_charge',
    'offering_platform_charge',
    'movement_contribution_settlement',
    'withdrawal',
    'refund',
    'provider_fee',
    'internal_transfer',
  ]) has(new RegExp(`'${kind}'`));
  assert.doesNotMatch(migration, /UPDATE\s+public\.alignments[\s\S]{0,200}status\s*=\s*'activated'/i);
  assert.doesNotMatch(migration, /mark_alignment_activation_payment_succeeded/i);
});

test('wallet ledger is append-only and account lifecycle cannot reopen', () => {
  has(/Wallet ledger history is append-only/);
  has(/BEFORE UPDATE OR DELETE OR TRUNCATE\s+ON private\.wallet_transactions/i);
  has(/BEFORE UPDATE OR DELETE OR TRUNCATE\s+ON private\.wallet_postings/i);
  has(/Wallet account identity is immutable/);
  has(/Wallet account lifecycle cannot reopen or change terminal state/);
});

test('wallet transactions are idempotent and provider references cannot duplicate', () => {
  has(/idempotency_key text NOT NULL UNIQUE/i);
  has(/CREATE UNIQUE INDEX wallet_transactions_provider_reference_unique/i);
  has(/WHERE provider IS NOT NULL AND provider_reference IS NOT NULL/i);
});

test('movement financial transactions bind to existing financial components and alignments', () => {
  has(/financial_component_id uuid NULL REFERENCES private\.financial_components\(id\)/i);
  has(/alignment_id uuid NULL REFERENCES public\.alignments\(id\)/i);
  has(/transaction_kind NOT IN \([\s\S]*'requester_platform_charge'[\s\S]*'offering_platform_charge'[\s\S]*'movement_contribution_settlement'[\s\S]*\)[\s\S]*OR financial_component_id IS NOT NULL/i);
});

test('postings require positive values, one account per transaction and matching currency', () => {
  has(/amount_minor bigint NOT NULL CHECK \(amount_minor > 0\)/i);
  has(/UNIQUE \(transaction_id, account_id\)/i);
  has(/Wallet posting requires an active account/);
  has(/Wallet posting currency must match transaction currency/);
});

test('double-entry balance is enforced as a deferred transaction invariant', () => {
  has(/CREATE FUNCTION private\.assert_wallet_transaction_balanced/i);
  has(/v_posting_count < 2/i);
  has(/v_debits <= 0/i);
  has(/v_credits <= 0/i);
  has(/v_debits IS DISTINCT FROM v_credits/i);
  const deferredCount = (migration.match(/DEFERRABLE INITIALLY DEFERRED/g) || []).length;
  assert.equal(deferredCount, 2);
});

test('foundation is provider-neutral and does not create virtual accounts or provider callbacks', () => {
  assert.doesNotMatch(migration, /paystack|flutterwave|monnify|opay|palmpay/i);
  assert.doesNotMatch(migration, /webhook|callback|virtual_account|account_number/i);
});
