'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),cp=require('node:child_process'),crypto=require('node:crypto');
const {disposable,container}=require('./0082_trusted_temporal_evidence_hardening_harness.cjs');
const {fixtures}=require('./0082_financial_movement_completion_behavior.cjs');
const source=fs.readFileSync(path.join(__dirname,'../migrations/0088_funded_activation_fee_finalization.sql'),'utf8');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function run(callback,{beforeInstall}={}){await disposable(async c=>{
 assert.equal(c.target("SELECT to_regclass('private.completed_movement_principals') IS NOT NULL;"),'t','Requires installed exact 0084 schema');
 assert.equal(c.target("SELECT to_regclass('private.funded_no_travel_closures') IS NOT NULL;"),'t','Requires installed exact 0085 schema');
 assert.equal(c.target("SELECT to_regclass('private.funded_movement_disputes') IS NOT NULL;"),'t','Requires installed 0086');
 assert.equal(c.target("SELECT to_regclass('private.funded_completion_response_windows') IS NOT NULL AND to_regclass('private.funded_activation_fee_finalizations') IS NULL;"),'t','Requires exact installed 0087; never overwrite 0088');
 const baseline=require('../../docs/0088-installed-baseline-audit.json');
 const installed=JSON.parse(c.target("SELECT jsonb_agg(jsonb_build_object('name',n.nspname||'.'||p.proname,'body',p.prosrc,'acl',p.proacl,'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'config',p.proconfig)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname||'.'||p.proname IN ("+baseline.functions.map(f=>"'"+f.name+"'").join(',')+");"));
 for(const f of baseline.functions){const found=installed.find(x=>x.name===f.name);assert(found,f.name);for(const key of ['body','acl','owner','definer','config'])assert.deepEqual(found[key],f[key],f.name+' audited '+key);}
 let ordinal=0,proofs=[];
 const as=(f,actor,sql)=>`SELECT set_config('request.jwt.claim.sub','${actor}',true); SET LOCAL ROLE authenticated; ${sql} RESET ROLE;`;
 function fresh({zero=false,started=false,pendingStart=false,stage='coordination',offerer,requester}={}){
  const schema='no_travel_fixture_'+(++ordinal);
  let setup=fixtures(zero).replace('BEGIN;',`BEGIN; SELECT set_config('movement.fixture_scenario','${schema}',true); CREATE SCHEMA ${schema};`)
   .replaceAll('pg_temp.',schema+'.').replaceAll('CREATE TEMP TABLE','CREATE TABLE').replaceAll(' ON COMMIT DROP','');
  for(const [name,member] of [['offerer',offerer],['requester',requester]])if(member){
   assert(/^[0-9a-f-]{36}$/.test(member));assert(setup.includes(name+' uuid := gen_random_uuid();'));
   setup=setup.replace(name+' uuid := gen_random_uuid();',name+" uuid := '"+member+"';");
  }
  if(offerer||requester){assert(setup.includes(']) ids(id);'));setup=setup.replace(']) ids(id);',']) ids(id) ON CONFLICT(id) DO NOTHING;');}
  if(!started){
   setup=setup.replace(` PERFORM ${schema}.funding_succeed(${schema}.start_result());`,'');
   setup=setup.replace(` PERFORM ${schema}.funding_succeed(${schema}.start_result(true));`,'');
  }
  const stages=['agreement','hold','activation','coordination'];assert(stages.includes(stage));
  for(const [step,call] of [['hold','hold_result'],['activation','activation_result'],['coordination','coordination_result']]){
   if(stages.indexOf(step)>stages.indexOf(stage))setup=setup.replace(` PERFORM ${schema}.funding_succeed(${schema}.${call}());`,'');
  }
  if(stage!=='coordination')setup=setup.replace(` PERFORM ${schema}.funding_succeed(${schema}.coordination_as(f.offerer,format('SELECT * FROM public.set_my_movement_meeting_point(%L,''Station entrance'',NULL)',f.need)));`,'');
  c.target(setup+` SELECT ${schema}.prepare_completion(); COMMIT;`);
  const f=JSON.parse(c.target(`SELECT jsonb_build_object('schema','${schema}','need',a.movement_need_id,'alignment',a.id,'offerer',a.offering_member_id,'requester',a.member_needing_movement_id,'traveller',s.traveller,'journey',j.id,'agreement',g.id) FROM public.alignments a JOIN ${schema}.snapshot_fixture s ON s.need=a.movement_need_id LEFT JOIN public.journeys j ON j.alignment_id=a.id JOIN private.financial_agreements g ON g.alignment_id=a.id;`));
  if(pendingStart)c.target('BEGIN; '+as(f,f.offerer,`SELECT * FROM public.request_my_funded_movement_start('${f.need}');`)+' COMMIT;');
  return f;
 }
 class Session{
  constructor(){this.out='';this.err='';this.closed=false;this.child=cp.spawn('docker',['exec','-i',container,'psql','-X','-qAt','-U','postgres','-d',c.database,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],{windowsHide:true});
   this.child.stdout.on('data',b=>this.out+=b);this.child.stderr.on('data',b=>this.err+=b);this.child.on('close',()=>this.closed=true);this.child.on('error',e=>{this.err+=e.message;this.closed=true;});this.child.stdin.on('error',e=>this.err+=e.message);c.sessions.push(this);}
  async send(sql){const marker='done_'+crypto.randomBytes(6).toString('hex');this.child.stdin.write(sql+'\n\\echo '+marker+'\n');const end=Date.now()+20000;while(!this.out.includes(marker)){if(this.closed||Date.now()>end)throw Error(this.err||'Session barrier timed out');await delay(25);}}
  async begin(){await this.send("SELECT 'PID='||pg_backend_pid(); BEGIN; SET LOCAL lock_timeout='25s'; SET LOCAL statement_timeout='30s'; SET LOCAL idle_in_transaction_session_timeout='35s';");this.pid=Number(this.out.match(/PID=(\d+)/)[1]);}
  close(){if(!this.closed)this.child.stdin.end('ROLLBACK;\n\\q\n');}
 }
 async function blocked(a,b,label){const end=Date.now()+8000;while(Date.now()<end){if(c.target(`SELECT ${a.pid}=ANY(pg_blocking_pids(${b.pid}));`)==='t'){proofs.push({label,blocker:a.pid,blocked:b.pid});return;}if(b.closed)throw Error(b.err);await delay(40);}throw Error('Expected pg_blocking_pids relationship');}
 const action=(f,key,actor=f.offerer,reason)=>as(f,actor,`SELECT * FROM public.${key}('${f.need}'${reason===undefined?'':",'"+reason+"'"});`);
 const result=(f,key,actor=f.offerer,reason)=>JSON.parse(c.target(`BEGIN; SELECT ${f.schema}.snapshot_select_as('authenticated','${actor}',${"'"+`SELECT * FROM public.${key}('${f.need}'${reason===undefined?'':",'"+reason+"'"})`.replaceAll("'","''")+"'"}); COMMIT;`).split('\n').filter(Boolean).at(-1));
 const fingerprint=()=>c.target('SELECT no_travel_fixture_1.materialization_sources();');
 const context={...c,fresh,as,Session,blocked,action,result,fingerprint,proofs};
 if(beforeInstall)await beforeInstall(context);
 c.target(source);
 const after=JSON.parse(c.target("SELECT jsonb_agg(jsonb_build_object('name',n.nspname||'.'||p.proname,'body',p.prosrc,'acl',p.proacl,'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'config',p.proconfig)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname||'.'||p.proname IN ("+baseline.functions.map(f=>"'"+f.name+"'").join(',')+");"));
 for(const f of baseline.functions){const found=after.find(x=>x.name===f.name);assert(found,f.name);for(const key of ['acl','owner','definer','config'])assert.deepEqual(found[key],f[key],f.name+' replacement preserves '+key);}
 const replacements=[...source.replace(/\r\n/g,'\n').matchAll(/CREATE(?: OR REPLACE)? FUNCTION ((?:public|private)\.\w+)\s*\([^]*?AS (\$\w*\$)([^]*?)\2;/g)];assert.equal(replacements.length,21);
 for(const m of replacements){const actual=c.target("SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname||'.'||p.proname='"+m[1]+"';");assert.equal(actual.trim(),m[3].trim(),m[1]+' exact applied source body');}
 await callback(context);
 });}
module.exports={run,source};
