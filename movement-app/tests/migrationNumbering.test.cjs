'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
test('final migration sequence is uniquely 0001 through 0086 with byte-identical historical SQL',()=>{
 const dir='supabase/migrations/',files=fs.readdirSync(dir).filter(f=>/^\d{4}_.*\.sql$/.test(f)).sort();
 assert.equal(files.length,86);assert.deepEqual(files.map(f=>f.slice(0,4)),Array.from({length:86},(_,i)=>String(i+1).padStart(4,'0')));
 assert.deepEqual(files.slice(-5),['0082_trusted_temporal_evidence_hardening.sql','0083_financial_movement_completion.sql','0084_completed_movement_reputation.sql','0085_funded_mutual_no_travel_release.sql','0086_funded_unilateral_dispute_freeze.sql']);
 assert(!fs.existsSync(dir+'0082_financial_movement_completion.sql'));
 const hash=f=>crypto.createHash('sha256').update(require('./support/historicalMigrationBytes.cjs').historicalMigrationBytes(f)).digest('hex');
 assert.equal(hash(files[81]),'75cba03be6dc31d9869861ba53e50623d9756028d2b0be281ddac903d3b15351');
 assert.equal(hash(files[82]),'c9df4dedc931b090b0615fc79c4af3bfc5cd51af66b28b05d42229d4e428a976');
 const inv=require('../docs/0082-temporal-audit-inventory.json');
 assert.equal(crypto.createHash('sha256').update(inv.migrations.map(m=>m.name+'\n'+fs.readFileSync(dir+m.name,'utf8').replace(/\r\n/g,'\n')).join('\n')).digest('hex'),'488e25e92fe84140b1300dbc8a58a3db6e7de21256a08dc01f4c9c5c4109d223');
});
