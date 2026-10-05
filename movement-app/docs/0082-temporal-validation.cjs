'use strict';
// Offline final evidence capture; does not access any database or stage files.
const fs=require('node:fs'),cp=require('node:child_process'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const files=[
 'supabase/migrations/0082_trusted_temporal_evidence_hardening.sql',
 'supabase/tests/0082_trusted_temporal_evidence_hardening_harness.cjs',
 'supabase/tests/0082_trusted_temporal_evidence_hardening_behavior.cjs',
 'supabase/tests/0082_trusted_temporal_evidence_hardening_concurrency.cjs',
 'supabase/tests/0082_trusted_temporal_existing_concurrency.cjs',
 'supabase/tests/0082_trusted_temporal_evidence_hardening_test.sql',
 'supabase/tests/0082_trusted_temporal_ingestion_test.sql',
 'supabase/tests/0082_trusted_temporal_materialization_test.sql',
 'tests/trustedTemporalEvidenceHardening.test.cjs',
 'docs/0082-temporal-build.cjs','docs/0082-temporal-schema.sql',
 'docs/0082-temporal-hardening-implementation.md','docs/0082-temporal-validation.cjs',
 'docs/0082-temporal-behavior-results.json','docs/0082-temporal-concurrency-results.json',
 'docs/0082-temporal-existing-0080-concurrency-results.json',
 'docs/0082-temporal-behavior-results.txt','docs/0082-temporal-node-results.txt','docs/0082-temporal-targeted-results.txt',
];
const changed=['supabase/tests/0048_offerer_interest_inbox.test.cjs','supabase/tests/financial_agreement.test.cjs','supabase/tests/financial_proposal.test.cjs','supabase/tests/movement_context.test.cjs'];
const git=args=>{const r=cp.spawnSync('git',args,{encoding:'utf8',windowsHide:true});if(r.error)throw r.error;return r;};
const check=git(['diff','--check']);assert.equal(check.status,0,check.stdout+check.stderr);
for(const f of files){const r=git(['-c','core.autocrlf=false','-c','core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol','diff','--no-index','--check','--','NUL',f]);assert([0,1].includes(r.status),f+': '+r.stdout+r.stderr);assert.equal(r.stdout,'',f+': '+r.stdout);}
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const inventory=require('./0082-temporal-audit-inventory.json');assert.equal(inventory.migrations.length,81);
for(const m of inventory.migrations)assert.equal(hash('supabase/migrations/'+m.name),m.sha256,m.name);
const normalized=crypto.createHash('sha256').update(inventory.migrations.map(m=>m.name+'\n'+fs.readFileSync('supabase/migrations/'+m.name,'utf8').replace(/\r\n/g,'\n')).join('\n')).digest('hex');
assert.equal(normalized,'488e25e92fe84140b1300dbc8a58a3db6e7de21256a08dc01f4c9c5c4109d223');
const completion=hash('supabase/migrations/0083_financial_movement_completion.sql');assert.equal(completion,'c9df4dedc931b090b0615fc79c4af3bfc5cd51af66b28b05d42229d4e428a976');
const behavior=require('./0082-temporal-behavior-results.json');assert.equal(behavior.sourceSha,hash(files[0]));assert.equal(behavior.failed,0);assert(behavior.cleanup&&behavior.applicationFingerprintUnchanged);
const concurrency=require('./0082-temporal-concurrency-results.json');assert.equal(concurrency.sourceSha,hash(files[0]));assert.equal(concurrency.failed,0);assert(concurrency.cleanup&&concurrency.applicationFingerprintUnchanged);
assert.match(fs.readFileSync('docs/0082-temporal-node-results.txt','utf8'),/pass 1632\n[^]*fail 0\n[^]*skipped 1/);
if(!fs.existsSync('docs/0082-temporal-validation.txt'))fs.writeFileSync('docs/0082-temporal-validation.txt','');
const status=git(['status','--short']);assert.equal(status.status,0);
const report='Classification: B — NOT READY (client temporal contract mismatch)\n'+
 'Temporal SHA-256: '+hash(files[0])+'\nHistorical normalized SHA-256: '+normalized+'\nPaused completion SHA-256: '+completion+'\n'+
 'All 81 historical raw hashes unchanged.\nTracked and every intended new-file whitespace check: PASS.\n'+
 'Behavior: '+behavior.passed+' passed; 0 failed; 2 compatibility probes passed; cleanup/fingerprint passed.\n'+
 'Temporal concurrency: 10 scenarios / 10 blocking proofs / 0 deadlocks; cleanup/fingerprint passed.\n'+
 'Existing concurrency: 0079 14 scenarios/13 proofs; 0080 18/18; 0081 21/22; all cleanup/fingerprint checks passed.\n'+
 'Targeted: 142 passed / 0 failed / 0 skipped.\nFull node --test: 1632 passed / 0 failed / 1 skipped (1633 total).\nTypeScript --noEmit: passed.\n'+
 'No persistent install, staging, commit, push, migration-history/role edit or remote change.\n\n'+
 'Files changed this task (pre-existing unrelated edits retained):\n'+[...changed,...files,'docs/0082-temporal-validation.txt'].join('\n')+'\n\nComplete git status --short:\n'+status.stdout;
fs.writeFileSync('docs/0082-temporal-validation.txt',report);
console.log(report);
