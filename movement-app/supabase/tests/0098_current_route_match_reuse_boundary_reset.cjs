'use strict';
// Reset only a disposable LOCAL clone. No linked project or original database is reset.
const cp=require('node:child_process'),path=require('node:path'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os');
const base=require('./0095_requester_deadline_matching_context_repair_harness.cjs');
const {verify:verify0096}=require('./0096_trusted_shared_segment_geographic_assessment_harness.cjs');
const {verify:verify0097}=require('./0097_shared_segment_assessment_reuse_boundary_harness.cjs');
const {verify:verify0098}=require('./0098_current_route_match_reuse_boundary_harness.cjs');
async function main(){await base.run(async c=>{
 assert(/^requester0093_[a-f0-9]{12}$/.test(c.db));
 const dumped=cp.spawnSync('docker',['exec','supabase_db_movement-app','pg_dump','-U','postgres','-d','postgres','--schema-only','--no-owner','--schema=auth','--schema=storage'],{encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024});
 assert.equal(dumped.status,0);const platform=dumped.stdout.replace(/^\\(?:un)?restrict .*$/gm,'').replace(/CREATE TRIGGER[^]*?;/g,m=>m.includes('public.')?'':m).replace(/ALTER DEFAULT PRIVILEGES[^]*?;/g,'').replace(/CREATE POLICY[^]*?;/g,'');
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'movement-0098-reset-'));fs.mkdirSync(path.join(temp,'supabase','migrations'),{recursive:true});
 fs.writeFileSync(path.join(temp,'supabase','config.toml'),'project_id = "movement-app"\n');
 fs.writeFileSync(path.join(temp,'supabase','migrations','0000_local_platform_bootstrap.sql'),'CREATE SCHEMA IF NOT EXISTS extensions;\nCREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;\n'+platform);
 for(const file of fs.readdirSync('supabase/migrations').filter(f=>/^\d{4}_.*\.sql$/.test(f)))fs.copyFileSync(path.join('supabase/migrations',file),path.join(temp,'supabase','migrations',file));
 const cli=path.resolve('node_modules/supabase/dist/supabase.js');let r;
 try{r=cp.spawnSync(process.execPath,[cli,'--workdir',temp,'db','reset','--db-url',`postgresql://postgres:postgres@127.0.0.1:55432/${c.db}?sslmode=disable`,'--no-seed','--yes'],{encoding:'utf8',timeout:240000,windowsHide:true,maxBuffer:16*1024*1024});}
 finally{assert(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(temp,{recursive:true,force:true});}
 console.log(r.stdout);console.log(r.stderr);if(r.error||r.status!==0)throw Error('Isolated local reset failed: '+r.error+' / '+r.status);
 assert.equal(c.target("SELECT count(*)||'/'||min(version)||'/'||max(version) FROM supabase_migrations.schema_migrations WHERE version<>'0000';"),'98/0001/0098');
 verify0096(c);verify0097(c);verify0098(c);console.log('PASS fresh installed reset 0001 through 0098 in disposable local database');
 });}
module.exports={main};if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
