'use strict';
// Explicit local verification only. Never installs the migration.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { fixtures, query, snapshot } = require('./0074_trusted_financial_proposal_issuer_behavior.cjs');
const live = fs.readFileSync(path.join(__dirname, '0075_safe_financial_proposal_projection_test.sql'), 'utf8');
function main() {
  assert.equal(query('postgres', "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='0075';"), '1', '0075 local installation required; this runner never applies it');
  const before = query('postgres', snapshot);
  try { process.stdout.write(query('postgres', fixtures() + live.replace(/^BEGIN;/, '')) + '\n'); }
  finally { assert.equal(query('postgres', snapshot), before, '0075 external rollback fingerprint unchanged'); }
}
if (require.main === module) {
  try { main(); } catch (e) { console.error(e.stack); process.exitCode = 1; }
}
