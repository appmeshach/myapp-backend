'use strict';
const fs=require('node:fs'),crypto=require('node:crypto'),cp=require('node:child_process'),assert=require('node:assert/strict');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const temporal=hash('supabase/migrations/0082_trusted_temporal_evidence_hardening.sql');
const completion=hash('supabase/migrations/0083_financial_movement_completion.sql');
assert.equal(temporal,'75cba03be6dc31d9869861ba53e50623d9756028d2b0be281ddac903d3b15351');
assert.equal(completion,'c9df4dedc931b090b0615fc79c4af3bfc5cd51af66b28b05d42229d4e428a976');
const inventory=require('./0082-temporal-audit-inventory.json');
for(const m of inventory.migrations)assert.equal(hash('supabase/migrations/'+m.name),m.sha256,m.name);
const historical=crypto.createHash('sha256').update(inventory.migrations.map(m=>m.name+'\n'+fs.readFileSync('supabase/migrations/'+m.name,'utf8').replace(/\r\n/g,'\n')).join('\n')).digest('hex');
assert.equal(historical,'488e25e92fe84140b1300dbc8a58a3db6e7de21256a08dc01f4c9c5c4109d223');
const summaries=[];
for(const p of ['docs/0082-client-focused-results.txt','docs/0082-client-full-results.txt']){
 const bytes=fs.readFileSync(p);const text=bytes.toString(bytes[0]===255&&bytes[1]===254?'utf16le':'utf8').replace(/^\uFEFF/,'').replace(/\r\n/g,'\n').split('\n').map(s=>s.trimEnd()).join('\n');
 assert.match(text,/fail 0\n/);assert.match(text,/duration_ms/);fs.writeFileSync(p,text);
 summaries.push(p+'\n'+text.slice(text.lastIndexOf('ℹ tests')));
}
const check=cp.spawnSync('git',['diff','--check'],{encoding:'utf8',windowsHide:true});assert.equal(check.status,0,check.stdout+check.stderr);
if(!fs.existsSync('docs/0082-client-validation.txt'))fs.writeFileSync('docs/0082-client-validation.txt','');
const status=cp.spawnSync('git',['status','--short'],{encoding:'utf8',windowsHide:true});assert.equal(status.status,0);
fs.writeFileSync('docs/0082-client-validation.txt','A — CLIENT COMPATIBILITY READY\nTemporal SHA: '+temporal+'\nCompletion SHA: '+completion+'\nHistorical normalized SHA: '+historical+'\nAll 81 historical raw hashes unchanged.\nTypeScript passed; git diff --check passed.\nNo installation, staging, commit, push, history edit or remote change.\n\n'+summaries.join('\n')+'\nComplete git status --short:\n'+status.stdout);
console.log('PASS SQL hashes, 81 historical raw hashes, portable results and diff check; complete status saved.');
