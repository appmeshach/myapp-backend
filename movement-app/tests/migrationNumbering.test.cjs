'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
test('final migration sequence is uniquely 0001 through 0083 with byte-identical SQL',()=>{
 const dir='supabase/migrations/',files=fs.readdirSync(dir).filter(f=>/^\d{4}_.*\.sql$/.test(f)).sort();
 assert.equal(files.length,83);assert.deepEqual(files.map(f=>f.slice(0,4)),Array.from({length:83},(_,i)=>String(i+1).padStart(4,'0')));
 assert.deepEqual(files.slice(-2),['0082_trusted_temporal_evidence_hardening.sql','0083_financial_movement_completion.sql']);
 assert(!fs.existsSync(dir+'0082_financial_movement_completion.sql'));
 const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(dir+f)).digest('hex');
 assert.equal(hash(files[81]),'75cba03be6dc31d9869861ba53e50623d9756028d2b0be281ddac903d3b15351');
 assert.equal(hash(files[82]),'c9df4dedc931b090b0615fc79c4af3bfc5cd51af66b28b05d42229d4e428a976');
 const inv=require('../docs/0082-temporal-audit-inventory.json');for(const m of inv.migrations)assert.equal(hash(m.name),m.sha256,m.name);
 assert.equal(crypto.createHash('sha256').update(inv.migrations.map(m=>m.name+'\n'+fs.readFileSync(dir+m.name,'utf8').replace(/\r\n/g,'\n')).join('\n')).digest('hex'),'488e25e92fe84140b1300dbc8a58a3db6e7de21256a08dc01f4c9c5c4109d223');
});
