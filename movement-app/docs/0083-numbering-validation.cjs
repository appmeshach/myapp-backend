'use strict';
const fs=require('node:fs'),cp=require('node:child_process'),assert=require('node:assert/strict');
const test=cp.spawnSync('node',['--test','tests/migrationNumbering.test.cjs'],{encoding:'utf8',windowsHide:true});assert.equal(test.status,0,test.stdout+test.stderr);
const summaries=[];
for(const kind of ['focused','client','temporal','completion','full']){
 const file='docs/0083-numbering-'+kind+'-results.txt',b=fs.readFileSync(file);
 const s=b.toString(b[0]===255&&b[1]===254?'utf16le':'utf8').replace(/^\uFEFF/,'').replace(/\r\n/g,'\n').split('\n').map(x=>x.trimEnd()).join('\n');
 assert.match(s,/fail 0\n/);assert.match(s,/duration_ms/);fs.writeFileSync(file,s);summaries.push(kind+':\n'+s.slice(s.lastIndexOf('ℹ tests')));
}
const diff=cp.spawnSync('git',['diff','--check'],{encoding:'utf8',windowsHide:true});assert.equal(diff.status,0,diff.stdout+diff.stderr);
const output='docs/0083-numbering-validation.txt';if(!fs.existsSync(output))fs.writeFileSync(output,'');
const status=cp.spawnSync('git',['status','--short'],{encoding:'utf8',windowsHide:true});assert.equal(status.status,0);
fs.writeFileSync(output,'A — NUMBERING FINALIZED, READY FOR LOCAL DRY-RUN\nRename: 0082_financial_movement_completion.sql → 0083_financial_movement_completion.sql; old absent/new present.\nTemporal SHA: 75cba03be6dc31d9869861ba53e50623d9756028d2b0be281ddac903d3b15351\nCompletion SHA: c9df4dedc931b090b0615fc79c4af3bfc5cd51af66b28b05d42229d4e428a976\nHistorical normalized SHA: 488e25e92fe84140b1300dbc8a58a3db6e7de21256a08dc01f4c9c5c4109d223\nAll 81 historical raw hashes unchanged. Exactly 83 unique sequential migration versions.\nTypeScript passed. git diff --check passed. No SQL semantic/client source changes.\nNo install/db push/staging/commit/push/history edit/remote change. No paid dependency.\nReference updates and working-tree categories: docs/0083-numbering-finalized.md\n\n'+summaries.join('\n')+'\nComplete git status --short:\n'+status.stdout);
console.log(summaries.join('\n'));console.log('PASS numbering/hashes/diff; complete git status saved.');
