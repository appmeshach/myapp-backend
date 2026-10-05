'use strict';
// Source verification only, in a schema-only disposable database. No app DDL.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {query,command,snapshot,container}=require('./0074_trusted_financial_proposal_issuer_behavior.cjs');
const read=p=>fs.readFileSync(path.join(__dirname,p),'utf8').replace(/\r\n/g,'\n');
const source=read('../migrations/0082_trusted_temporal_evidence_hardening.sql');
const migrationBody=source.replace(/^BEGIN;\s*/,'').replace(/COMMIT;\s*$/,'');
const names=[...source.matchAll(/CREATE(?: OR REPLACE)? FUNCTION ((?:private|public)\.\w+)/g)].map(m=>m[1]);
function verify(query,database){
 const rows=JSON.parse(query(database,`SELECT jsonb_agg(jsonb_build_object('name',n.nspname||'.'||p.proname,'body',p.prosrc,'definer',p.prosecdef,'config',p.proconfig)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname||'.'||p.proname IN (${names.map(n=>"'"+n+"'").join(',')});`));
 const expected=[...source.matchAll(/CREATE(?: OR REPLACE)? FUNCTION ((?:private|public)\.\w+)\([^]*?AS \$function\$([^]*?)\$function\$;/g)];assert.equal(rows.length,33);
 for(const m of expected){const r=rows.find(r=>r.name===m[1]);assert.equal(r.body.replace(/\r\n/g,'\n'),m[2],m[1]+' source body');assert(r.definer);assert.deepEqual(r.config,['search_path=""']);}
}
function inspectThrough0081(query){
 assert.equal(query('postgres',"SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='0081';"),'1');
 const wanted=require('./0080_funded_movement_coordination_entry_harness.cjs').expected.map(e=>e.name);
 const expected=require('../../docs/0082-temporal-audit-catalog.json').functions.filter(f=>wanted.includes(f.schema+'.'+f.name));
 const rows=JSON.parse(query('postgres',`SELECT jsonb_agg(jsonb_build_object('name',n.nspname||'.'||p.proname,'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname||'.'||p.proname IN (${wanted.map(n=>"'"+n+"'").join(',')});`));
 assert.equal(rows.length,expected.length);
 for(const f of expected){const r=rows.find(r=>r.name===f.schema+'.'+f.name);assert.equal(r.definition.replace(/\r\n/g,'\n'),f.definition.replace(/\r\n/g,'\n'));assert.equal(r.owner,f.owner);assert.deepEqual(r.acl,f.acl);}
 return 'installed';
}
function filterDefaultAcls(toc){return toc.split('\n').filter(l=>!/^\d+;\s+\d+\s+\d+\s+DEFAULT ACL\s/.test(l)).join('\n')+'\n';}
async function disposable(run,{extraSchemas=[]}={}){
 assert.deepEqual(extraSchemas.filter(s=>s!=='storage'),[],'Only source reconstruction may add storage schema');
 const database='temporal0082_'+crypto.randomBytes(6).toString('hex');
 const archive='/tmp/'+database+'.dump',list='/tmp/'+database+'.list';
 const failures=[];let before,created=false;const sessions=[];
 const target=sql=>{assert(/^temporal0082_[a-f0-9]{12}$/.test(database));return query(database,sql);};
 try {
  before=query('postgres',snapshot);
  assert.equal(query('postgres',"SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='0081';"),'1');
  command(['pg_dump','-U','postgres','-d','postgres','--schema-only','--no-owner','--format=custom','--file='+archive,
   '--schema=public','--schema=private','--schema=auth','--schema=extensions',...extraSchemas.map(s=>'--schema='+s)]);
  command(['tee',list],filterDefaultAcls(command(['pg_restore','--list',archive])));
  query('postgres',`CREATE DATABASE ${database} TEMPLATE template0;`);created=true;
  target('DROP SCHEMA public;');
  command(['pg_restore','-U','postgres','--dbname='+database,'--no-owner','--exit-on-error','--use-list='+list,archive]);
  // Record exact function attributes/ACLs in clone before CREATE OR REPLACE.
  const aclSql=`SELECT jsonb_agg(jsonb_build_array(n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),p.proowner,p.proacl,p.prosecdef,p.proconfig,p.provolatile,p.proisstrict,p.proparallel) ORDER BY p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname||'.'||p.proname IN (${names.filter(n=>n!=='private.protect_alignment_face_attempt_ordinal').map(n=>"'"+n+"'").join(',')});`;
  const aclBefore=target(aclSql);
  await run({database,target,sessions,install(){target(source);verify(query,database);assert.equal(target(aclSql),aclBefore,'Replaced function owners/ACLs/security/config unchanged');}});
 } catch(e){failures.push(e);} finally {
  try{for(const s of sessions)s.close();if(created){assert(/^temporal0082_[a-f0-9]{12}$/.test(database));query('postgres',`DROP DATABASE ${database} WITH (FORCE);`);console.log('PASS disposable database cleanup');}}catch(e){failures.push(e);}
  try{if(before){assert.equal(query('postgres',snapshot),before,'Application data/catalog/ACL/RLS/history unchanged');console.log('PASS application fingerprint unchanged');}}catch(e){failures.push(e);}
  finally{try{command(['rm','-f','--',archive,list]);}catch(e){failures.push(e);}}
 }
 if(failures.length)throw new AggregateError(failures,failures.map(e=>e.stack).join('\n'),{cause:failures[0]});
}
module.exports={disposable,source,migrationBody,read,container,filterDefaultAcls,verify,inspectThrough0081};
