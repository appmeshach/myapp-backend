'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../migrations/0079_funded_movement_activation.sql'), 'utf8').replace(/\r\n/g, '\n');
const expected = [...source.matchAll(/CREATE(?: OR REPLACE)? FUNCTION (\w+\.\w+)\(([^]*?)\)\s*RETURNS ([^]*?)\s*LANGUAGE (sql|plpgsql)\s*(STABLE\s*)?SECURITY\s+DEFINER\s+SET\s+search_path\s*=\s*''\s*AS (\$\w*\$)([^]*?)\6/g)].map(m => ({name:m[1],args:m[2],result:m[3],language:m[4],volatility:m[5]?'s':'v',body:m[7]}));
assert.equal(expected.length,13);
const {compose,assertFinalInstalled}=require('./final_movement_regression_catalog.cjs');
const finalExpected=compose(expected,79);
const normalize = require('./final_movement_regression_catalog.cjs').normalizeSignature;
const catalogSql = `SET search_path=''; SELECT coalesce(jsonb_agg(jsonb_build_object('name',n.nspname||'.'||p.proname,'args',pg_get_function_arguments(p.oid),'result',pg_get_function_result(p.oid),'body',p.prosrc,'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'language',l.lanname,'config',p.proconfig,'kind',p.prokind,'volatility',p.provolatile,'strict',p.proisstrict,'parallel',p.proparallel,'acl',(SELECT jsonb_agg(CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END ORDER BY a.grantee) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type='EXECUTE' AND a.grantee<>p.proowner),'grantable',(SELECT count(*) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.is_grantable)) ORDER BY n.nspname,p.proname),'[]'::jsonb) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname||'.'||p.proname IN (${expected.map(e=>"'"+e.name+"'").join(',')});`;
function verifyDefinitions(rows,{historicalBoundary=false}={}) {
 const owning=historicalBoundary?expected:finalExpected;
 assert.equal(rows.length,expected.length,'Installed 0079/source mismatch: function count; no definitions overwritten');
 for(const e of owning) {
  const r=rows.find(r=>r.name===e.name);assert(r,'Installed 0079/source mismatch: '+e.name);
  for(const field of ['args','result'])assert.equal(normalize(r[field]),normalize(e[field]),'Installed 0079/source mismatch: '+e.name+' '+field);
  assert.equal(r.body.replace(/\r\n/g,'\n'),e.body,'Installed 0079/source mismatch: '+e.name+' body');
  assert.deepEqual([r.owner,r.definer,r.language,r.config,r.kind,r.volatility,r.strict,r.parallel,r.grantable],['postgres',true,e.language,['search_path=""'],'f',e.volatility,false,'u',0],'Installed 0079/source mismatch: '+e.name+' attributes');
  assert.deepEqual(r.acl,['public.activate_my_funded_movement','public.get_my_movement_activation_status','public.get_my_activation_payment_status'].includes(e.name)?['authenticated']:['public.create_alignment_activation_payment','public.mark_alignment_activation_payment_succeeded'].includes(e.name)?['service_role']:null,'Installed 0079/source mismatch: '+e.name+' ACL');
 }
}
function selectMode(history,rows,receipt) {
 if(history===0&&!rows.some(r=>expected.slice(0,8).some(e=>e.name===r.name))&&!receipt)return 'source';
 assert.equal(history,1,'Incomplete 0079 installation/history; no automatic replacement');
 assert(receipt,'Incomplete 0079 installation: receipt table');
 verifyDefinitions(rows);return 'installed';
}
function inspect(query,database='postgres') {
 const rows=JSON.parse(query(database,catalogSql));
 const history=Number(query(database,"SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='0079';"));
 const receipt=query(database,"SELECT to_regclass('private.funded_movement_activations') IS NOT NULL;")==='t';
 const mode=selectMode(history,rows,receipt);if(mode==='installed')assertFinalInstalled(query,database,79);return mode;
}
function verify(query,database) {verifyDefinitions(JSON.parse(query(database,catalogSql)));}
module.exports={inspect,verify,verifyDefinitions,selectMode,expected,finalExpected,catalogSql};
