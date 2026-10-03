'use strict';

// Explicit local runner. Importing this module never opens a database connection.
// Requires separately authorized application of 0073; never applies migrations.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const read = p => fs.readFileSync(path.join(__dirname, p), 'utf8').replace(/\r\n/g, '\n');
const container = 'supabase_db_movement-app';
const migration = read('../migrations/0073_financial_proposal_movement_context_binding_foundation.sql');
const precondition = migration.slice(migration.indexOf('LOCK TABLE'), migration.indexOf('ALTER TABLE'));
const live = read('0073_financial_proposal_movement_context_binding_test.sql').replace(
  '-- MIGRATION_PRECONDITION_PROBE',
  `SELECT pg_temp.probe('exact 0073 precondition rejects existing proposals', '${precondition.replaceAll("'", "''")}', '23514');`
);
// Includes data, catalog definitions, ACLs, RLS, and migration history.
const snapshot = read('pricing_quote_foundation.test.cjs').match(/const snapshot = `([\s\S]*?)`;/)[1];

function command(args, input) {
  const r = cp.spawnSync('docker', ['exec', '-i', container, ...args], {
    input, encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024, windowsHide: true,
  });
  if (r.error || r.status !== 0) throw new Error(String(r.error || '') + r.stderr + r.stdout);
  return r.stdout.trim();
}
function query(database, input) {
  return command(['psql', '-X', '-qAt', '-U', 'postgres', '-d', database,
    '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], input);
}
function fixtures() {
  const marker = '-- BINDING_0073_TESTS:';
  assert(live.includes(marker));
  return live.slice(0, live.indexOf(marker));
}
function main() {
  assert.equal(query('postgres', "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='0073';"), '1',
    'Apply 0073 locally only after separate authorization');
  const before = query('postgres', snapshot);
  try {
    process.stdout.write(query('postgres', live) + '\n');
  } finally {
    assert.equal(query('postgres', snapshot), before, 'Behavioral SQL must roll back data, definitions, ACLs, RLS and migration history');
  }
  console.log('PASS full external rollback fingerprint');
}
module.exports = { read, container, migration, precondition, live, snapshot, command, query, fixtures };
if (require.main === module) {
  try { main(); } catch (e) { console.error(e.stack); process.exitCode = 1; }
}
