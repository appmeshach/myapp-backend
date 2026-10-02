'use strict';
// Explicit local PostgreSQL runner. Importing exports performs no database work.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const read = p => fs.readFileSync(path.join(__dirname,p),'utf8').replace(/\r\n/g,'\n');
const container = 'supabase_db_movement-app';
const live = read('0069_trusted_pricing_quote_producer_test.sql');
// Reuse the existing full data/schema/ACL/RLS snapshot, without loading its tests.
const snapshot = read('pricing_quote_foundation.test.cjs').match(/const snapshot = `([\s\S]*?)`;/)[1];
function psql(database,input) {
  return cp.spawnSync('docker',['exec','-i',container,'psql','-X','-qAt','-U','postgres','-d',database,
    '-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],{input,encoding:'utf8',timeout:60000,maxBuffer:32*1024*1024,windowsHide:true});
}
function query(database,input) {
  const r=psql(database,input);
  if(r.error || r.status!==0) throw new Error(String(r.error||'')+r.stderr+r.stdout);
  return r.stdout.trim();
}
function fixtures() {
  const marker='-- 0069 tests follow;';
  assert(live.includes(marker));
  return live.slice(0,live.indexOf(marker));
}
function main() {
  assert.equal(query('postgres',"SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='0069';"),'1','Apply 0069 locally first');
  const before=query('postgres',snapshot+';');
  const result=psql('postgres',live);
  process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');
  const after=query('postgres',snapshot+';');
  assert.equal(after,before,'Rollback must restore all data, definitions, permissions and migration history');
  console.log('PASS full external rollback snapshot');
  if(result.error) throw result.error;
  process.exitCode=result.status??1;
}
module.exports={read,container,snapshot,psql,query,fixtures};
if(require.main===module)main();
