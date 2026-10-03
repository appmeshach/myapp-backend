'use strict';
// Explicit local verification only. Never installs the migration.
// --verify-source replaces only 0077 functions inside the fixture rollback
// transaction; catalog/data/ACL/history fingerprint must be restored afterward.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { fixtures: issuerFixtures, query, snapshot } = require('./0074_trusted_financial_proposal_issuer_behavior.cjs');
const live = fs.readFileSync(path.join(__dirname, '0077_financial_proposal_requester_materialization_test.sql'), 'utf8');
const consentSql = fs.readFileSync(path.join(__dirname,'0076_financial_proposal_offerer_consent_test.sql'),'utf8');
function fixtures() {
  return issuerFixtures() + consentSql.slice(0,consentSql.indexOf('DO $tests$')).replace(/^BEGIN;/,'');
}
function sourceDefinitions() {
  const migration=fs.readFileSync(path.join(__dirname,'../migrations/0077_financial_proposal_requester_materialization.sql'),'utf8');
  const definitions=['graph','materialize'].map(tag=>{
    const start=migration.indexOf(tag==='graph' ? 'CREATE FUNCTION private.' : 'CREATE FUNCTION public.');
    const end=migration.indexOf('$'+tag+'$;',start);
    assert(start>=0 && end>start, 'Exact 0077 function source required');
    return migration.slice(start,end+tag.length+3).replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION');
  });
  return definitions.join('\n');
}
function main() {
  assert.equal(query('postgres', "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='0077';"), '1', '0077 local installation required; this runner never applies it');
  const before = query('postgres', snapshot);
  try {
    const setup=process.argv.includes('--verify-source')
      ? fixtures().replace(/^BEGIN;/,()=> 'BEGIN;\n'+sourceDefinitions()) : fixtures();
    process.stdout.write(query('postgres', setup + live.replace(/^BEGIN;/, '')) + '\n');
  }
  finally { assert.equal(query('postgres', snapshot), before, '0077 external rollback fingerprint unchanged'); }
}
module.exports = { fixtures, sourceDefinitions };
if (require.main === module) {
  try { main(); } catch (e) { console.error(e.stack); process.exitCode = 1; }
}
