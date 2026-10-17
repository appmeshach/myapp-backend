'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),cp=require('node:child_process');
const migration='supabase/migrations/0094_requester_route_generation_context.sql';
test('all 0001–0093 migration content equals committed HEAD modulo checkout line endings',()=>{
  const prefix=cp.execFileSync('git',['rev-parse','--show-prefix'],{encoding:'utf8'}).trim();
  const files=fs.readdirSync('supabase/migrations').filter(f=>/^00(?:[0-8]\d|9[0-3])_.*\.sql$/.test(f)).sort();assert.equal(files.length,93);
  for(const file of files){const name='supabase/migrations/'+file;assert.equal(fs.readFileSync(name,'utf8').replace(/\r\n/g,'\n'),cp.execFileSync('git',['show','HEAD:'+prefix+name],{encoding:'utf8',maxBuffer:4*1024*1024}).replace(/\r\n/g,'\n'),name);}
});
test('0094 adds only its context RPC and role grants; no evidence or product mutation',()=>{
  const sql=fs.readFileSync(migration,'utf8');assert.equal((sql.match(/CREATE FUNCTION/g)||[]).length,1);assert.doesNotMatch(sql,/CREATE TABLE|ALTER TABLE|CREATE OR REPLACE|\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO|FROM|public\.|private\.)/i);
  assert.match(sql,/SECURITY DEFINER SET search_path=''/);assert.match(sql,/FROM PUBLIC,anon,authenticated,service_role/);assert.match(sql,/TO service_role/);
});
test('integration runners import without connecting or invoking providers',()=>{assert.equal(typeof require('./0094_requester_route_generation_context_harness.cjs').run,'function');assert.equal(typeof require('./0094_requester_route_generation_context_concurrency.cjs').main,'function');});
