'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../migrations/0081_financial_movement_start.sql'), 'utf8').replace(/\r\n/g, '\n');
const expected = [...source.matchAll(/CREATE(?: OR REPLACE)? FUNCTION (\w+\.\w+)\(([^]*?)\)\s*RETURNS ([^]*?)\s*LANGUAGE (sql|plpgsql)\s*(STABLE\s*)?SECURITY\s+DEFINER\s+SET\s+search_path\s*=\s*''\s*AS (\$\w*\$)([^]*?)\6/g)].map(m => ({name:m[1],args:m[2],result:m[3],language:m[4],volatility:m[5]?'s':'v',body:m[7]}));
assert.equal(expected.length,11);
const {compose,assertFinalInstalled}=require('./final_movement_regression_catalog.cjs');
const finalExpected=compose(expected,81);
const normalize = require('./final_movement_regression_catalog.cjs').normalizeSignature;
const catalogSql = `SET search_path=''; SELECT coalesce(jsonb_agg(jsonb_build_object('name',n.nspname||'.'||p.proname,'args',pg_get_function_arguments(p.oid),'result',pg_get_function_result(p.oid),'body',p.prosrc,'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'language',l.lanname,'config',p.proconfig,'kind',p.prokind,'volatility',p.provolatile,'strict',p.proisstrict,'parallel',p.proparallel,'acl',(SELECT jsonb_agg(CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END ORDER BY a.grantee) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type='EXECUTE' AND a.grantee<>p.proowner),'grantable',(SELECT count(*) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.is_grantable)) ORDER BY n.nspname,p.proname),'[]'::jsonb) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname||'.'||p.proname IN (${expected.map(e=>"'"+e.name+"'").join(',')});`;
function verifyDefinitions(rows,{historicalBoundary=false}={}) {
 const owning=historicalBoundary?expected:finalExpected;
 assert.equal(rows.length,expected.length,'Installed 0081/source mismatch: function count; no definitions overwritten');
 for(const e of owning) {
  const r=rows.find(r=>r.name===e.name);assert(r,'Installed 0081/source mismatch: '+e.name);
  for(const field of ['args','result'])assert.equal(normalize(r[field]),normalize(e[field]),'Installed 0081/source mismatch: '+e.name+' '+field);
  assert.equal(r.body.replace(/\r\n/g,'\n'),e.body,'Installed 0081/source mismatch: '+e.name+' body');
  assert.deepEqual([r.owner,r.definer,r.language,r.config,r.kind,r.volatility,r.strict,r.parallel,r.grantable],['postgres',true,e.language,['search_path=""'],'f',e.volatility,false,'u',0],'Installed 0081/source mismatch: '+e.name+' attributes');
  assert.deepEqual(r.acl,['public.get_my_movement_start_status','public.request_my_funded_movement_start','public.confirm_my_funded_movement_start'].includes(e.name)?['authenticated']:e.name.startsWith('private.')?null:e.name.includes('journey_completion')?['service_role']:['authenticated','service_role'],'Installed 0081/source mismatch: '+e.name+' ACL');
 }
}
function selectMode(history,rows,receipt) {
 if(history===0&&!rows.some(r=>expected.filter(e=>['private.require_funded_start_actor','private.validate_funded_start_graph','private.protect_funded_start_meeting_point','public.get_my_movement_start_status','public.request_my_funded_movement_start','public.confirm_my_funded_movement_start'].includes(e.name)).some(e=>e.name===r.name))&&!receipt)return 'source';
 assert.equal(history,1,'Incomplete 0081 installation/history; no automatic replacement');
 assert(receipt,'Incomplete 0081 installation: receipt table');
 verifyDefinitions(rows);return 'installed';
}
function inspect(query,database='postgres') {
 const rows=JSON.parse(query(database,catalogSql));
 const history=Number(query(database,"SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='0081';"));
 const receipt=query(database,"SELECT to_regclass('private.funded_movement_start_requests') IS NOT NULL OR to_regclass('private.funded_movement_starts') IS NOT NULL;")==='t';
 if(history===1)assert.equal(query(database,"SELECT to_regclass('private.funded_movement_start_requests') IS NOT NULL AND to_regclass('private.funded_movement_starts') IS NOT NULL;"),'t','Incomplete 0081 installation: both receipts required');
 const mode=selectMode(history,rows,receipt);if(mode==='installed')assertFinalInstalled(query,database,81);return mode;
}
function verify(query,database) {verifyDefinitions(JSON.parse(query(database,catalogSql)));}
module.exports={inspect,verify,verifyDefinitions,selectMode,expected,finalExpected,catalogSql};
