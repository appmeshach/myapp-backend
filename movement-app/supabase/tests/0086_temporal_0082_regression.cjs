'use strict';
// Run unchanged original 0082 behavior/concurrency with its required source
// baseline reconstructed ONLY in a regex-validated disposable database.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const harness=require('./0082_trusted_temporal_evidence_hardening_harness.cjs');
async function reconstruct(callback){await harness.disposable(async c=>{
 assert(/^temporal0082_[a-f0-9]{12}$/.test(c.database));
 c.target('DROP SCHEMA public CASCADE; DROP SCHEMA private CASCADE; CREATE SCHEMA public; GRANT USAGE ON SCHEMA public TO PUBLIC;');
 const files=require('../../docs/0082-temporal-audit-inventory.json').migrations;
 const policies=files.flatMap(f=>[...fs.readFileSync(path.join(__dirname,'../migrations',f.name),'utf8').matchAll(/CREATE POLICY (\w+)\s+ON storage\.(\w+)/g)]);
 assert(policies.length>0);c.target(policies.map(m=>'DROP POLICY IF EXISTS '+m[1]+' ON storage.'+m[2]+';').join('\n'));
 for(const f of files)c.target(fs.readFileSync(path.join(__dirname,'../migrations',f.name),'utf8'));
 // The archive intentionally excludes platform DEFAULT ACLs. Restore the
 // exact audited through-0081 ordinary ACLs, only in this disposable schema.
 const catalog=require('../../docs/0082-temporal-audit-catalog.json');
 const permissions={a:'INSERT',r:'SELECT',w:'UPDATE',d:'DELETE',D:'TRUNCATE',x:'REFERENCES',t:'TRIGGER',m:'MAINTAIN',X:'EXECUTE'};
 const grants=[];
 for(const [kind,rows] of [['TABLE',catalog.tables],['FUNCTION',catalog.functions]])for(const row of rows){
  const identity=kind==='FUNCTION'?row.signature:row.schema+'.'+row.name;
  grants.push('REVOKE ALL ON '+kind+' '+identity+' FROM PUBLIC,anon,authenticated,service_role;');
  for(const acl of row.acl||[]){const match=/^([^=]*)=([^/]+)\//.exec(acl);assert(match&&!match[2].includes('*'),'audited nongrantable ACL');const role=match[1]||'PUBLIC';if(role==='postgres')continue;assert(['PUBLIC','anon','authenticated','service_role'].includes(role));grants.push('GRANT '+[...match[2]].map(p=>{assert(permissions[p]);return permissions[p];}).join(',')+' ON '+kind+' '+identity+' TO '+role+';');}
 }
 c.target(grants.join('\n'));
 assert.equal(c.target("SELECT to_regclass('private.alignment_face_attempt_ordinal_seq') IS NULL AND to_regclass('private.funded_movement_disputes') IS NULL;"),'t');
 await callback({...c,install(){
  const attributes="SELECT jsonb_agg(jsonb_build_array(n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),p.proowner,p.proacl,p.prosecdef,p.proconfig,p.provolatile,p.proisstrict,p.proparallel) ORDER BY p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname||'.'||p.proname IN ("+[...harness.source.matchAll(/CREATE OR REPLACE FUNCTION ((?:private|public)\.\w+)/g)].map(m=>"'"+m[1]+"'").join(',')+");";
  const before=c.target(attributes);c.target(harness.source);harness.verify(require('./0074_trusted_financial_proposal_issuer_behavior.cjs').query,c.database);assert.equal(c.target(attributes),before,'0082 replacement owners/ACLs/security/config unchanged on source reconstruction');
 }});
 },{extraSchemas:['storage']});}
async function main({concurrencyOnly=false}={}){
 for(const name of (concurrencyOnly?['0082_trusted_temporal_evidence_hardening_concurrency.cjs']:['0082_trusted_temporal_evidence_hardening_behavior.cjs','0082_trusted_temporal_evidence_hardening_concurrency.cjs'])){
  const module={exports:{}},filename=path.join(__dirname,name);
  const localRequire=n=>n==='./0082_trusted_temporal_evidence_hardening_harness.cjs'?{...harness,disposable:reconstruct}:n==='node:fs'?new Proxy(fs,{get(target,key){if(key==='writeFileSync')return (file,...args)=>{assert(/^docs\/0082-temporal-(?:behavior|concurrency)-results\.json$/.test(file));return target.writeFileSync(file.replace('0082-temporal-','0086-0082-temporal-'),...args);};return target[key];}}):require(n.startsWith('.')?path.resolve(__dirname,n):n);
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{require:localRequire,module,exports:module.exports,__dirname,console,process,Buffer,setTimeout,clearTimeout},{filename});
  await module.exports.main();console.log('PASS unchanged '+name+' with reconstructed through-0081 baseline');
 }
}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
module.exports={main};
