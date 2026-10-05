'use strict';
// Destructive reconstruction is restricted to a validated disposable clone.
const fs=require('node:fs'),assert=require('node:assert/strict');
const {disposable}=require('./0082_trusted_temporal_evidence_hardening_harness.cjs');
const {query}=require('./0074_trusted_financial_proposal_issuer_behavior.cjs');
const {verify,captureTemporalAcls}=require('./0082_financial_movement_completion_harness.cjs');
const {migrationBody,fixtures,completionChecks}=require('./0082_financial_movement_completion_behavior.cjs');
async function main(){await disposable(async({database,target})=>{
 assert(/^temporal0082_[a-f0-9]{12}$/.test(database));
 target('DROP SCHEMA public CASCADE; DROP SCHEMA private CASCADE; CREATE SCHEMA public; GRANT USAGE ON SCHEMA public TO PUBLIC;');
 const files=require('../../docs/0082-temporal-audit-inventory.json').migrations;
 // Inventory every Movement policy from historical source before replay rather
 // than guessing which policies a platform-schema clone already contains.
 const policies=files.flatMap(f=>[...fs.readFileSync('supabase/migrations/'+f.name,'utf8').matchAll(/CREATE POLICY (\w+)\s+ON storage\.(\w+)/g)]);
 assert(policies.length>0);target(policies.map(m=>'DROP POLICY IF EXISTS '+m[1]+' ON storage.'+m[2]+';').join('\n'));
 for(const f of files)target(fs.readFileSync('supabase/migrations/'+f.name,'utf8'));
 assert.equal(target("SELECT to_regclass('private.alignment_face_attempt_ordinal_seq') IS NULL AND to_regclass('private.funded_movement_completions') IS NULL;"),'t');
 const temporalAcls=captureTemporalAcls(query,database);
 target('BEGIN; '+migrationBody+' COMMIT;');verify(query,database,temporalAcls);
 console.log('PASS through-0081 → temporal 0082 → completion 0083; final 32+12 catalog/ACL verified');
 for(const zero of [false,true]){const output=target(fixtures(zero)+completionChecks('source'));
  assert.equal(output.split('\n').filter(x=>/\|t\|/.test(x)).length,zero?74:75);console.log('PASS composed source completion zero='+zero);
 }
},{extraSchemas:['storage']});}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
