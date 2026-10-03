'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../migrations/0080_funded_movement_coordination_entry.sql'), 'utf8').replace(/\r\n/g, '\n');
const expected = [...source.matchAll(/CREATE(?: OR REPLACE)? FUNCTION (\w+\.\w+)\(([^]*?)\)\s*RETURNS ([^]*?)\s*LANGUAGE (sql|plpgsql)\s*(STABLE\s*)?SECURITY\s+DEFINER\s+SET\s+search_path\s*=\s*''\s*AS (\$\w*\$)([^]*?)\6/g)].map(m => ({name:m[1],args:m[2],result:m[3],language:m[4],volatility:m[5]?'s':'v',body:m[7]}));
assert.equal(expected.length,21);
const normalize = value => value.toLowerCase().replace(/timestamp with time zone/g,'timestamptz').replace(/::(?:integer|bigint|text|boolean)/g,'').replace(/\s+/g,'').trim();
const catalogSql = `SET search_path=''; SELECT coalesce(jsonb_agg(jsonb_build_object('name',n.nspname||'.'||p.proname,'args',pg_get_function_arguments(p.oid),'result',pg_get_function_result(p.oid),'body',p.prosrc,'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'language',l.lanname,'config',p.proconfig,'kind',p.prokind,'volatility',p.provolatile,'strict',p.proisstrict,'parallel',p.proparallel,'acl',(SELECT jsonb_agg(CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END ORDER BY a.grantee) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type='EXECUTE' AND a.grantee<>p.proowner),'grantable',(SELECT count(*) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.is_grantable)) ORDER BY n.nspname,p.proname),'[]'::jsonb) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname||'.'||p.proname IN (${expected.map(e=>"'"+e.name+"'").join(',')});`;
function verifyDefinitions(rows) {
 assert.equal(rows.length,expected.length,'Installed 0080/source mismatch: function count; no definitions overwritten');
 for(const e of expected) {
  const r=rows.find(r=>r.name===e.name);assert(r,'Installed 0080/source mismatch: '+e.name);
  for(const field of ['args','result'])assert.equal(normalize(r[field]),normalize(e[field]),'Installed 0080/source mismatch: '+e.name+' '+field);
  assert.equal(r.body.replace(/\r\n/g,'\n'),e.body,'Installed 0080/source mismatch: '+e.name+' body');
  assert.deepEqual([r.owner,r.definer,r.language,r.config,r.kind,r.volatility,r.strict,r.parallel,r.grantable],['postgres',true,e.language,['search_path=""'],'f',e.volatility,false,'u',0],'Installed 0080/source mismatch: '+e.name+' attributes');
  assert.deepEqual(r.acl,['public.open_my_funded_movement_coordination','public.get_my_funded_movement_coordination_readiness'].includes(e.name)?['authenticated']:e.name.startsWith('private.')?null:e.name.includes('journey_completion')?['service_role']:['authenticated','service_role'],'Installed 0080/source mismatch: '+e.name+' ACL');
 }
}
function selectMode(history,rows,receipt) {
 if(history===0&&!rows.some(r=>expected.slice(0,8).some(e=>e.name===r.name))&&!receipt)return 'source';
 assert.equal(history,1,'Incomplete 0080 installation/history; no automatic replacement');
 assert(receipt,'Incomplete 0080 installation: receipt table');
 verifyDefinitions(rows);return 'installed';
}
function inspect(query,database='postgres') {
 const rows=JSON.parse(query(database,catalogSql));
 const history=Number(query(database,"SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='0080';"));
 const receipt=query(database,"SELECT to_regclass('private.funded_movement_coordination_entries') IS NOT NULL;")==='t';
 return selectMode(history,rows,receipt);
}
function verify(query,database) {verifyDefinitions(JSON.parse(query(database,catalogSql)));}
module.exports={inspect,verify,verifyDefinitions,selectMode,expected,catalogSql};
