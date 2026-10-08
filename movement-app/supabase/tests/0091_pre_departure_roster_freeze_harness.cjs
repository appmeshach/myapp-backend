'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),cp=require('node:child_process'),crypto=require('node:crypto');
// Reuse the audited schema-only clone/fingerprint/cleanup protocol. Restore its
// DDL in one transaction to avoid thousands of WAL fsyncs on Windows Docker.
// The command adaptation applies only to pg_restore into temporal0082 clones.
const Module=require('node:module'),cloneFile=path.join(__dirname,'0082_trusted_temporal_evidence_hardening_harness.cjs');
const cloneModule=new Module(cloneFile,module);cloneModule.filename=cloneFile;cloneModule.paths=Module._nodeModulePaths(__dirname);
cloneModule.require=n=>{
 if(n==='./0074_trusted_financial_proposal_issuer_behavior.cjs'){
  const original=require(n);return {...original,command(args,input){
   if(args[0]==='pg_restore'&&args.some(a=>/^--dbname=temporal0082_[a-f0-9]{12}$/.test(a)))args=[...args,'--single-transaction'];
   return original.command(args,input);
  }};
 }
 return require(n.startsWith('.')?path.resolve(__dirname,n):n);
};
cloneModule._compile(fs.readFileSync(cloneFile,'utf8'),cloneFile);
const {disposable,container}=cloneModule.exports;
const {fixtures}=require('./0082_financial_movement_completion_behavior.cjs');
const source=fs.readFileSync(path.join(__dirname,'../migrations/0090_trusted_requester_movement_priority_integration.sql'),'utf8');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function run(callback,{beforeInstall,beforeRosterInstall}={}){await disposable(async c=>{
 assert.equal(cp.execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),'9308aa06b09a7af83ada68bc111b98254b896854','Exact 0091 baseline required');
 assert.equal(cp.execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim(),'feature/0091-cascading-route-segments');
 const historical=fs.readdirSync(path.join(__dirname,'../migrations')).filter(f=>/^\d{4}_.*\.sql$/.test(f)&&Number(f.slice(0,4))<=89).sort();assert.equal(historical.length,89);
 assert.equal(crypto.createHash('sha256').update(historical.map(f=>f+'\n'+fs.readFileSync(path.join(__dirname,'../migrations/'+f),'utf8').replace(/\r\n/g,'\n')).join('\n')).digest('hex'),'3dd58427153adb41409ab6680a6f171730ac27b94bb28744633392287565e7e1');
 const catalog="SELECT jsonb_agg(jsonb_build_object('identity',n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')','name',n.nspname||'.'||p.proname,'body',p.prosrc,'owner',pg_get_userbyid(p.proowner),'acl',p.proacl,'definer',p.prosecdef,'config',p.proconfig,'volatility',p.provolatile) ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('public','private');";
 const baseline={catalog,functions:JSON.parse(c.target(catalog))};
 assert.equal(baseline.functions.length,277);assert.equal(crypto.createHash('sha256').update(JSON.stringify(baseline.functions)).digest('hex'),'9dab8f4f3cee97d0ca4813f9c89e65dedd4eda73311e4c8dc8290ffda2cc4690','Exact installed 0090 source/ACL/security catalog');
 const requesterBody=source.match(/AS \$requester_priority\$([^]*?)\$requester_priority\$;/)[1];
 assert.equal(baseline.functions.find(f=>f.name==='public.discover_masked_offers_for_my_need').body.replace(/\r\n/g,'\n').trim(),requesterBody.replace(/\r\n/g,'\n').trim(),'Installed 0090 body matches corrected committed source');
 let ordinal=0,proofs=[];
 const as=(f,actor,sql)=>`SELECT set_config('request.jwt.claim.sub','${actor}',true); SET LOCAL ROLE authenticated; ${sql} RESET ROLE;`;
 function fresh({zero=false,started=false,pendingStart=false,stage='coordination',offerer,requester,parent,solo=false}={}){
  const schema='no_travel_fixture_'+(++ordinal);
  let setup=fixtures(zero).replace('BEGIN;',`BEGIN; SELECT set_config('movement.fixture_scenario','${schema}',true); CREATE SCHEMA ${schema};`)
   .replaceAll('pg_temp.',schema+'.').replaceAll('CREATE TEMP TABLE','CREATE TABLE').replaceAll(' ON COMMIT DROP','');
  if(solo){
   setup=setup.replace('SET people_count=2','SET people_count=1');
   const first=setup.indexOf('  INSERT INTO public.movement_participants('),end=setup.indexOf('  r :=',first);
   assert(first>=0&&end>first);setup=setup.slice(0,first)+setup.slice(end);
  }
  if(parent){
   offerer=parent.offerer;
   const info=JSON.parse(c.target(`SELECT to_jsonb(x) FROM ${parent.schema}.snapshot_fixture x;`));
   const begin=setup.indexOf('  r :=',setup.indexOf('-- Make this a two-person'));
   const intentEnd=setup.indexOf('  r := '+schema+'.snapshot_match(',begin);
   assert(begin>0&&intentEnd>begin);
   setup=setup.slice(0,begin)+`  intent:='${info.intent}'; route:='${info.route}';\n`+setup.slice(intentEnd);
   const vehicles=setup.indexOf('  INSERT INTO public.vehicles('),offerStart=setup.indexOf('  r :=',setup.indexOf("'0072 availability fixture failed",vehicles));
   assert(vehicles>0&&offerStart>vehicles);
   setup=setup.slice(0,vehicles)+`  vehicle:='${info.vehicle}'; availability:='${info.availability}';\n`+setup.slice(offerStart);
  }
  for(const [name,member] of [['offerer',offerer],['requester',requester]])if(member){
   assert(/^[0-9a-f-]{36}$/.test(member));assert(setup.includes(name+' uuid := gen_random_uuid();'));
   setup=setup.replace(name+' uuid := gen_random_uuid();',name+" uuid := '"+member+"';");
  }
  if(offerer||requester){assert(setup.includes(']) ids(id);'));setup=setup.replace(']) ids(id);',']) ids(id) ON CONFLICT(id) DO NOTHING;');}
  if(!started){
   setup=setup.replace(` PERFORM ${schema}.funding_succeed(${schema}.start_result());`,'');
   setup=setup.replace(` PERFORM ${schema}.funding_succeed(${schema}.start_result(true));`,'');
  }
  if(stage==='proposal'){
   const consent=`r:=${schema}.consent();`,start=setup.indexOf('DO $$ DECLARE r jsonb; BEGIN',setup.indexOf(`CREATE TABLE ${schema}.funding_fixture`)),end=setup.indexOf('END $$;',start)+'END $$;'.length;
   assert(start>0&&end>start&&setup.slice(start,end).includes(consent),'Exact pre-materialization fixture block');setup=setup.slice(0,start)+setup.slice(end);
  }
  const stages=['proposal','agreement','hold','activation','coordination'];assert(stages.includes(stage));
  for(const [step,call] of [['hold','hold_result'],['activation','activation_result'],['coordination','coordination_result']]){
   if(stages.indexOf(step)>stages.indexOf(stage))setup=setup.replace(` PERFORM ${schema}.funding_succeed(${schema}.${call}());`,'');
  }
  if(stage!=='coordination')setup=setup.replace(` PERFORM ${schema}.funding_succeed(${schema}.coordination_as(f.offerer,format('SELECT * FROM public.set_my_movement_meeting_point(%L,''Station entrance'',NULL)',f.need)));`,'');
  c.target(setup+(stage==='proposal'?'':` SELECT ${schema}.prepare_completion();`)+' COMMIT;');
  if(stage==='proposal')return JSON.parse(c.target(`SELECT jsonb_build_object('schema','${schema}','need',s.need,'offerer',s.offerer,'requester',s.requester,'offer',s.movement_offer,'proposal',(SELECT proposal FROM ${schema}.consent_fixture)) FROM ${schema}.snapshot_fixture s;`));
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
 const after=JSON.parse(c.target(baseline.catalog));
 for(const f of baseline.functions){const actual=after.find(x=>x.identity===f.identity);assert(actual);for(const key of Object.keys(f))if(!(['body','acl'].includes(key)&&f.name==='public.discover_masked_offers_for_my_need'))assert.deepEqual(actual[key],f[key],f.identity+' preserves '+key);}
 assert.deepEqual(after.find(f=>f.name==='public.discover_masked_offers_for_my_need').acl,['postgres=X/postgres','authenticated=X/postgres'],'Exact authenticated-only RPC ACL');
 const replacements=[...source.matchAll(/CREATE(?: OR REPLACE)? FUNCTION ((?:public|private)\.\w+)\s*\([^]*?AS (\$\w*\$)([^]*?)\2;/g)];assert.equal(replacements.length,1);
 for(const m of replacements)assert.equal(after.find(x=>x.name===m[1]).body.trim(),m[3].trim(),'Exact candidate source '+m[1]);
 const inboxSchema='priority_inbox_fixture';
 const inbox=fs.readFileSync(path.join(__dirname,'0048_offerer_interest_inbox_test.sql'),'utf8').replace(/\r\n/g,'\n');
 // Use the same provider namespace as the funded fixture when composing a
 // genuine shared parent. Both endpoint producers and every state guard run.
 const setup=inbox.slice(0,inbox.indexOf('DO $test$')).replace(/^BEGIN;/,'').replace('SET TRANSACTION ISOLATION LEVEL READ COMMITTED;','').replaceAll('pg_temp.',inboxSchema+'.').replaceAll('CREATE TEMP TABLE','CREATE TABLE').replaceAll(' ON COMMIT DROP','').replaceAll("'test_provider'","'test-provider'");
 c.target('BEGIN; CREATE SCHEMA '+inboxSchema+'; '+setup+' COMMIT;');
 context.inboxSchema=inboxSchema;
 if(beforeRosterInstall)await beforeRosterInstall(context);
 const rosterSource=fs.readFileSync(path.join(__dirname,'../migrations/0091_pre_departure_roster_freeze.sql'),'utf8').replace(/\r\n/g,'\n');
 c.target(rosterSource);
 const final=JSON.parse(c.target(catalog)),rosterFunctions=[...rosterSource.matchAll(/CREATE(?: OR REPLACE)? FUNCTION\s+((?:public|private)\.\w+)\s*\([^]*?AS (\$\w*\$)([^]*?)\2;/g)];
 assert.equal(rosterFunctions.length,11);assert.equal(final.length,283);
 for(const original of after){const changed=rosterFunctions.some(f=>f[1]===original.name),actual=final.find(f=>f.identity===original.identity);assert(actual);for(const key of Object.keys(original))if(!(changed&&key==='body'))assert.deepEqual(actual[key],original[key],original.identity+' 0091 preserves '+key);}
 for(const f of rosterFunctions){const actual=final.find(x=>x.name===f[1]);assert.equal(actual.body.replace(/\r\n/g,'\n').trim(),f[3].trim(),'Exact 0091 installed source '+f[1]);assert(actual.definer);assert.deepEqual(actual.config,['search_path=""']);if(!f[0].startsWith('CREATE OR REPLACE'))assert.deepEqual(actual.acl,['postgres=X/postgres'],'New private helper owner-only ACL');}
 assert.equal(c.target("SELECT relrowsecurity AND NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid=c.oid) FROM pg_class c WHERE c.oid='private.offering_movement_roster_freezes'::regclass;"),'t');
 await callback(context);
 });}
module.exports={run,source};
