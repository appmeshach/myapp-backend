'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../migrations/0083_financial_movement_completion.sql'), 'utf8').replace(/\r\n/g, '\n');
const expected = [...source.matchAll(/CREATE(?: OR REPLACE)? FUNCTION (\w+\.\w+)\(([^]*?)\)\s*RETURNS ([^]*?)\s*LANGUAGE (sql|plpgsql)\s*(STABLE\s*)?SECURITY\s+DEFINER\s+SET\s+search_path\s*=\s*''\s*AS (\$\w*\$)([^]*?)\6/g)].map(m => ({name:m[1],args:m[2],result:m[3],language:m[4],volatility:m[5]?'s':'v',body:m[7]}));
assert.equal(expected.length,12);
const normalize = value => value.toLowerCase().replace(/timestamp with time zone/g,'timestamptz').replace(/::(?:integer|bigint|text|boolean)/g,'').replace(/\s+/g,'').trim();
const catalogSql = `SET search_path=''; SELECT coalesce(jsonb_agg(jsonb_build_object('name',n.nspname||'.'||p.proname,'args',pg_get_function_arguments(p.oid),'result',pg_get_function_result(p.oid),'body',p.prosrc,'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'language',l.lanname,'config',p.proconfig,'kind',p.prokind,'volatility',p.provolatile,'strict',p.proisstrict,'parallel',p.proparallel,'acl',(SELECT jsonb_agg(CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END ORDER BY a.grantee) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type='EXECUTE' AND a.grantee<>p.proowner),'grantable',(SELECT count(*) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.is_grantable)) ORDER BY n.nspname,p.proname),'[]'::jsonb) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname||'.'||p.proname IN (${expected.map(e=>"'"+e.name+"'").join(',')});`;
function verifyDefinitions(rows) {
 assert.equal(rows.length,expected.length,'Installed 0083/source mismatch: function count; no definitions overwritten');
 for(const e of expected) {
  const r=rows.find(r=>r.name===e.name);assert(r,'Installed 0083/source mismatch: '+e.name);
  for(const field of ['args','result'])assert.equal(normalize(r[field]),normalize(e[field]),'Installed 0083/source mismatch: '+e.name+' '+field);
  assert.equal(r.body.replace(/\r\n/g,'\n'),e.body,'Installed 0083/source mismatch: '+e.name+' body');
  assert.deepEqual([r.owner,r.definer,r.language,r.config,r.kind,r.volatility,r.strict,r.parallel,r.grantable],['postgres',true,e.language,['search_path=""'],'f',e.volatility,false,'u',0],'Installed 0083/source mismatch: '+e.name+' attributes');
  assert.deepEqual(r.acl,['public.get_my_funded_movement_completion_status','public.request_my_funded_movement_completion','public.confirm_my_funded_movement_completion','public.list_my_completed_movement_recoveries'].includes(e.name)?['authenticated']:e.name.startsWith('private.')?null:e.name.includes('journey_completion')?['service_role']:['authenticated','service_role'],'Installed 0083/source mismatch: '+e.name+' ACL');
 }
}
function selectMode(history,rows,receipt) {
 if(history===0&&!rows.some(r=>expected.filter(e=>['private.assert_funded_completion','private.require_funded_completion_actor','private.validate_funded_completion_graph','private.require_funded_settlement_transaction','public.get_my_funded_movement_completion_status','public.request_my_funded_movement_completion','public.confirm_my_funded_movement_completion'].includes(e.name)).some(e=>e.name===r.name))&&!receipt)return 'source';
 assert.equal(history,1,'Incomplete 0083 installation/history; no automatic replacement');
 assert(receipt,'Incomplete 0083 installation: receipt table');
 verifyDefinitions(rows);return 'installed';
}
function inspect(query,database='postgres') {
 const rows=JSON.parse(query(database,catalogSql));
 const history=Number(query(database,"SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='0083';"));
 const receipt=query(database,"SELECT to_regclass('private.funded_movement_completion_requests') IS NOT NULL OR to_regclass('private.funded_movement_completions') IS NOT NULL;")==='t';
 if(history===1)assert.equal(query(database,"SELECT to_regclass('private.funded_movement_completion_requests') IS NOT NULL AND to_regclass('private.funded_movement_completions') IS NOT NULL;"),'t','Incomplete 0083 installation: both receipts required');
 return selectMode(history,rows,receipt);
}
const temporalSource=fs.readFileSync(path.join(__dirname,'../migrations/0082_trusted_temporal_evidence_hardening.sql'),'utf8').replace(/\r\n/g,'\n');
const overlap='private.assert_funded_coordination_entry';
const temporalExpected=[...temporalSource.matchAll(/CREATE(?: OR REPLACE)? FUNCTION ((?:private|public)\.\w+)\([^]*?AS \$function\$([^]*?)\$function\$;/g)].map(m=>({name:m[1],body:m[2]})).filter(e=>e.name!==overlap);
assert.equal(temporalExpected.length,32,'Final composition: 32 temporal-only functions and 12 completion functions');
const temporalCatalogSql=catalogSql.replace(/ IN \([^]*?\);$/,' IN ('+temporalExpected.map(e=>"'"+e.name+"'").join(',')+');');
function verifyTemporal(query,database,temporalAcls){
 const rows=JSON.parse(query(database,temporalCatalogSql));assert.equal(rows.length,32);
 const captured=require('../../docs/0082-temporal-audit-catalog.json').functions;
 for(const e of temporalExpected){const r=rows.find(r=>r.name===e.name);assert(r,e.name);assert.equal(r.body.replace(/\r\n/g,'\n'),e.body,e.name+' hardened source');
  assert.equal(r.owner,'postgres');assert(r.definer);assert.deepEqual(r.config,['search_path=""']);assert.equal(r.grantable,0);
  const header=temporalSource.slice(temporalSource.indexOf('FUNCTION '+e.name+'('),temporalSource.indexOf(e.body));
  assert.equal(r.language,/LANGUAGE\s+(sql|plpgsql)/i.exec(header)[1].toLowerCase());
  assert.equal(r.volatility,/\bSTABLE\b/i.test(header)?'s':/\bIMMUTABLE\b/i.test(header)?'i':'v');
  assert.equal(r.kind,'f');assert.equal(r.strict,false);assert.equal(r.parallel,'u');
  const originals=captured.filter(f=>f.schema+'.'+f.name===e.name);
  const original=originals.find(f=>normalize(f.arguments)===normalize(r.args));
  const acl=original?original.acl:['postgres=X/postgres'];
  const roles=(acl||['=X/postgres','postgres=X/postgres']).filter(x=>!x.startsWith('postgres=')).map(x=>x.split('=')[0]||'PUBLIC');
  assert.deepEqual(r.acl,temporalAcls?(temporalAcls[e.name]??null):(roles.length?roles:null),e.name+' ACL');
 }
}
const prerequisiteSql="SELECT to_regclass('private.alignment_face_attempt_ordinal_seq') IS NOT NULL AND EXISTS(SELECT 1 FROM pg_sequence WHERE seqrelid=to_regclass('private.alignment_face_attempt_ordinal_seq') AND seqtypid='bigint'::regtype AND seqcache=1 AND seqincrement=1 AND NOT seqcycle) AND EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='private.alignment_face_verifications'::regclass AND attname='attempt_ordinal' AND atttypid='bigint'::regtype AND attnotnull AND NOT attisdropped) AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='private.alignment_face_verifications'::regclass AND tgfoid=to_regprocedure('private.protect_alignment_face_attempt_ordinal()') AND tgenabled='O') AND (SELECT count(*) FROM pg_constraint WHERE conrelid='private.alignment_face_verifications'::regclass AND conname IN('alignment_face_attempt_ordinal_positive','alignment_face_attempt_ordinal_unique') AND convalidated)=2 AND to_regclass('private.alignment_face_latest_attempt') IS NOT NULL;";
const oldInspect=inspect;
function inspectComposed(query,database='postgres'){
 const temporalHistory=Number(query(database,"SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='0082';"));
 const mode=oldInspect(query,database);
 if(mode==='installed')assert.equal(temporalHistory,1,'0083 requires installed 0082 prerequisite');
 if(temporalHistory===1){assert.equal(query(database,prerequisiteSql),'t','Incomplete 0082 prerequisite structures');verifyTemporal(query,database);}
 else {assert.equal(temporalHistory,0);assert.equal(query(database,"SELECT to_regclass('private.alignment_face_attempt_ordinal_seq') IS NULL;"),'t','Partial 0082 installation; no automatic repair');}
 return mode;
}
function sourceBody(query,database='postgres'){
 assert.equal(inspectComposed(query,database),'source');
 const completion=source.replace(/^BEGIN;\s*/,'').replace(/COMMIT;\s*$/,'');
 return query(database,"SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='0082';")==='1'?completion:temporalSource.replace(/^BEGIN;\s*/,'').replace(/COMMIT;\s*$/,'')+'\n'+completion;
}
function captureTemporalAcls(query,database){
 const rows=JSON.parse(query(database,temporalCatalogSql));
 for(const r of rows)assert(!(r.acl||[]).includes('PUBLIC'),'Source prerequisite function must not expose PUBLIC execution: '+r.name);
 return Object.fromEntries(rows.map(r=>[r.name,r.acl]));
}
function verify(query,database,temporalAcls) {assert.equal(query(database,prerequisiteSql),'t');verifyTemporal(query,database,temporalAcls);verifyDefinitions(JSON.parse(query(database,catalogSql)));}
module.exports={inspect:inspectComposed,verify,verifyDefinitions,selectMode,expected,catalogSql,temporalExpected,sourceBody,prerequisiteSql,captureTemporalAcls};
