'use strict';
const fs=require('node:fs'),cp=require('node:child_process'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const prefix=cp.execFileSync('git',['rev-parse','--show-prefix'],{cwd:root,encoding:'utf8'}).trim();
function historicalMigrationBytes(name){
 assert(/^008[23]_[a-z_]+\.sql$/.test(name));
 const relative='supabase/migrations/'+name;
 const committed=cp.execFileSync('git',['show','HEAD:'+prefix+relative],{cwd:root});
 const working=fs.readFileSync(path.join(root,relative));
 assert.equal(working.toString('utf8').replace(/\r\n/g,'\n'),committed.toString('utf8').replace(/\r\n/g,'\n'),'Historical SQL differs beyond checkout line endings: '+name);
 return committed;
}
module.exports={historicalMigrationBytes};
