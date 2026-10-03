'use strict';
// Explicit integration runner. Never installs migrations; imported tools are inert.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { container, snapshot, command, query } = require('./0073_financial_proposal_movement_context_binding_behavior.cjs');
const live = fs.readFileSync(path.join(__dirname, '0074_trusted_financial_proposal_issuer_test.sql'), 'utf8');
function fixtures() { return live.slice(0, live.indexOf('-- ISSUER_0074_TESTS:')); }
function main() {
  assert.equal(query('postgres', "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='0074';"), '1', 'Install 0074 only with separate authorization');
  const before = query('postgres', snapshot);
  try {
    assert.throws(() => query('postgres', 'BEGIN ISOLATION LEVEL REPEATABLE READ; SELECT * FROM public.issue_financial_proposal_for_server(NULL,NULL,NULL,NULL);'), /25000/);
    process.stdout.write(query('postgres', live) + '\n');
  }
  finally { assert.equal(query('postgres', snapshot), before, '0074 external rollback fingerprint unchanged'); }
}
module.exports = { container, snapshot, command, query, fixtures };
if (require.main === module) {
  try { main(); } catch (error) { console.error(error.stack); process.exitCode = 1; }
}
