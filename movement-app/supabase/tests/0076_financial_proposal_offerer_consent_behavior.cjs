'use strict';
// Explicit local verification only. Never installs the migration.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { fixtures, query, snapshot } = require('./0074_trusted_financial_proposal_issuer_behavior.cjs');
const live = fs.readFileSync(path.join(__dirname, '0076_financial_proposal_offerer_consent_test.sql'), 'utf8');
function main() {
  assert.equal(query('postgres', "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='0076';"), '1', '0076 local installation required; this runner never applies it');
  const before = query('postgres', snapshot);
  try { process.stdout.write(query('postgres', fixtures() + live.replace(/^BEGIN;/, '')) + '\n'); }
  finally { assert.equal(query('postgres', snapshot), before, '0076 external rollback fingerprint unchanged'); }
}
if (require.main === module) {
  try { main(); } catch (e) { console.error(e.stack); process.exitCode = 1; }
}
