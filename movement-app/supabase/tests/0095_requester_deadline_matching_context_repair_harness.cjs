'use strict';
// Local Docker only. Imports are inert; all fixtures live in schema-only clones.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),Module=require('node:module');
const base=require('./0093_requester_route_generation_claim_boundary_harness.cjs');
const read=name=>fs.readFileSync(path.join(__dirname,name),'utf8').replace(/\r\n/g,'\n');
const source=read('../migrations/0095_requester_deadline_matching_context_repair.sql');
const body=source.match(/AS \$trusted_matching_context\$([^]*?)\$trusted_matching_context\$;/)[1];
const catalog="SELECT json_build_object('oid',p.oid,'body',p.prosrc,'identity',pg_get_function_identity_arguments(p.oid),'result',pg_get_function_result(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl,'definer',p.prosecdef,'config',p.proconfig,'volatility',p.provolatile,'strict',p.proisstrict,'parallel',p.proparallel) FROM pg_proc p WHERE p.oid='public.get_trusted_matching_context_for_server(uuid,uuid,uuid)'::regprocedure;";
function verify(c){
 const installed=JSON.parse(c.target(catalog));assert.equal(installed.body.replace(/\r\n/g,'\n'),body);
 assert.equal(installed.owner,'postgres');assert(installed.definer);assert.deepEqual(installed.config,['search_path=""']);
 assert.deepEqual(installed.acl,['postgres=X/postgres','service_role=X/postgres']);
 console.log('PASS installed final 0095 source, identity, owner, ACL, definer and search_path');
 const expected=new Map();
 for(const file of ['0089_trusted_movement_priority_engine_foundation.sql','0090_trusted_requester_movement_priority_integration.sql','0091_pre_departure_roster_freeze.sql']){
  for(const m of read('../migrations/'+file).matchAll(/CREATE(?: OR REPLACE)? FUNCTION\s+((?:public|private)\.\w+)\s*\([^]*?AS (\$\w*\$)([^]*?)\2;/g))expected.set(m[1],m[3]);
 }
 assert.equal(expected.size,16);expected.set('public.get_trusted_matching_context_for_server',body);
 const rows=JSON.parse(c.target(`SELECT jsonb_object_agg(n.nspname||'.'||p.proname,p.prosrc) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname||'.'||p.proname IN (${[...expected.keys()].map(n=>"'"+n+"'").join(',')});`));
 for(const [name,value] of expected)assert.equal(rows[name].replace(/\r\n/g,'\n'),value,name+' exact installed current source');
 console.log('PASS exact installed 0089/0090 priority and all 0091 functions (context repaired by 0095)');
}
async function run(callback){await base.run(async c=>{verify(c);await callback(c);});console.log('PASS application data/catalog/ACL/RLS/history fingerprint unchanged');}
const fixtures=()=>read('0052_downstream_requester_movement_deadline_test.sql').split('DO $test$')[0];
const context=(f)=>`SELECT row_to_json(x) FROM public.get_trusted_matching_context_for_server('${f.need}','${f.intent}','${f.offerer}') x;`;
function matchingFixture(c){
 const schema='deadline_'+require('node:crypto').randomBytes(6).toString('hex');
 const setup=fixtures().replace(/^BEGIN;/,'').replace('SET TRANSACTION ISOLATION LEVEL READ COMMITTED;','').replaceAll('pg_temp.',schema+'.').replaceAll('CREATE TEMP TABLE','CREATE TABLE').replaceAll(' ON COMMIT DROP','');
 c.target('BEGIN; CREATE SCHEMA '+schema+'; '+setup+' COMMIT;');
 return JSON.parse(c.target(`SELECT json_build_object('schema','${schema}','need',n.movement_need_id,'requester',n.member_id,'intent',a.intent_id,'offerer',a.member_id,'route',a.route_id,'availability',a.availability_id) FROM ${schema}.interest_offering_fixture('0095-lock',3) a CROSS JOIN ${schema}.interest_requester_fixture('0095-lock',1) n;`));
}
// Reuse the current-policy 0091 fixtures and test assertions. Historical upgrade
// catalog checks/installations are excluded explicitly: the clone already has
// final 0095. No production body, trigger or test assertion is weakened.
async function legacyRun(callback){await run(async c=>{
 const file=path.join(__dirname,'0091_pre_departure_roster_freeze_harness.cjs'),old=read(path.basename(file));
 const start=old.indexOf(' let ordinal=0,proofs=[];'),end=old.indexOf(' if(beforeInstall)await beforeInstall(context);',start);
 const inboxStart=old.indexOf(" const inboxSchema='priority_inbox_fixture';",end),inboxEnd=old.indexOf(' if(beforeRosterInstall)',inboxStart);
 assert(start>0&&end>start&&inboxStart>end&&inboxEnd>inboxStart);
 const sessions=[];
 const m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(__dirname);
 const code=`const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'); const {fixtures}=require('./0082_financial_movement_completion_behavior.cjs');const container='supabase_db_movement-app',delay=ms=>new Promise(r=>setTimeout(r,ms));exports.run=async(c,callback)=>{\n${old.slice(start,end)}\n${old.slice(inboxStart,inboxEnd)}\nawait callback(context);};`;
 m._compile(code,file);
 try{await m.exports.run({...c,database:c.db,sessions},callback);}finally{for(const s of sessions)s.close();}
});}
function loaded(name,code=read(name)){
 const file=path.join(__dirname,name),m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(__dirname);
 m.require=n=>n==='./0091_pre_departure_roster_freeze_harness.cjs'?{run:legacyRun}:require(n.startsWith('.')?path.resolve(__dirname,n):n);
 m._compile(code,file);return m.exports;
}
async function main(){
 const group=process.argv[2]||'sql';
 if(group==='sql')await run(async c=>{
  const old=read('../migrations/0091_pre_departure_roster_freeze.sql').match(/CREATE OR REPLACE FUNCTION\s+public\.get_trusted_matching_context_for_server\([^]*?\$trusted_matching_context\$;/)[0];
  c.target(old);const before=JSON.parse(c.target(catalog));c.target(source);const after=JSON.parse(c.target(catalog));
  delete before.body;delete after.body;assert.deepEqual(after,before);verify(c);console.log('PASS forward replacement preserves OID, signature, result and all function attributes');
  for(const file of ['0095_requester_deadline_matching_context_repair_test.sql','0052_downstream_requester_movement_deadline_test.sql']){
  // The 0052 fixture family uses mapbox-region-lagos; match that exact trusted
  // provider state identity when composing the normal roster-start producer.
  const roster=read('0091_roster_regression_support.sql').replaceAll("'region-lagos'","'mapbox-region-lagos'");
  const sql=file.startsWith('0095')?fixtures()+roster+read(file):read(file);const result=c.target(sql);assert.doesNotMatch(result,/\|f(?:\||$)/m);console.log(file+'\n'+result);
 }});
 else if(group==='0082')await run(async c=>{
  const setup=require('./0074_trusted_financial_proposal_issuer_behavior.cjs').fixtures();
  const normal=require('./0081_financial_movement_start_behavior.cjs').fixtures().match(/CREATE FUNCTION pg_temp.snapshot_state_endpoint\([^]*?\n END; \$\$;/);assert(normal);
  const sql=setup.replace(/CREATE FUNCTION pg_temp.snapshot_state_endpoint\([^]*?\n\$\$;/,()=>normal[0])+read('0082_trusted_temporal_ingestion_test.sql');
  const result=c.target(sql);assert.doesNotMatch(result,/\|f(?:\||$)/m);console.log(result);console.log('0082 temporal ingestion assertions: '+result.split('\n').filter(l=>/\|t(?:\||$)/.test(l)).length);
 });
 else if(['admission','priority','state'].includes(group))await loaded('0091_pre_departure_roster_freeze_regression.cjs').main();
 else if(group==='roster-concurrency')await loaded('0091_pre_departure_roster_freeze_concurrency.cjs').main();
 else if(group==='roster-temporal')await loaded('0091_pre_departure_roster_freeze_temporal.cjs').main();
 else if(group==='roster-behavior'){
  const name='0091_pre_departure_roster_freeze_behavior.cjs';let code=read(name);
  // Three pre-existing terminal-parent checks and the upgrade preflight hook
  // require the old pre-0091 catalog. Keep them in the historical suite; run
  // every current-policy behavior assertion here without forging old rows.
  const begin=code.indexOf(' },{beforeRosterInstall(c){'),end=code.indexOf('if(require.main',begin);assert(begin>0&&end>begin);
  code=code.slice(0,begin)+' });}\n'+code.slice(end);
  code=code.replace(/^.*check\(c.result\(existingUnavailable[^\n]*\n/m,'');
  assert(!code.includes('check(c.result(existingUnavailable'));
  await loaded(name,code).main();
 }
 else throw Error('Unknown validation group '+group);
}
module.exports={run,legacyRun,loaded,fixtures,matchingFixture,context,verify,main};
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
