'use strict';
// Explicit opt-in integration harness; never loaded by the ordinary Node suite.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const read = p => fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');
const container = 'supabase_db_movement-app';
const database = 'pricing0059_race_' + crypto.randomBytes(6).toString('hex');
const report = {started:new Date().toISOString(),container,database,events:[],checks:[],races:[]};
function log(event,details={}) { const row={at:new Date().toISOString(),event,...details};report.events.push(row);console.log(JSON.stringify(row)); }
function check(name,condition,details) {report.checks.push({name,pass:!!condition,details});log(condition?'PASS':'FAIL',{name,details});assert(condition,name);}
function command(args,input,timeout=30000) {
 const r=cp.spawnSync('docker',args,{input,encoding:'utf8',timeout,maxBuffer:64*1024*1024});
 if(r.error || r.status!==0) throw new Error('docker '+args.join(' ')+'\n'+(r.error||'')+'\n'+r.stderr+'\n'+r.stdout);
 return r.stdout.trim();
}
function sql(db,text,user='postgres') {return command(['exec','-i',container,'psql','-X','-qAt','-U',user,'-d',db,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],text+'\n');}
function target(text) {assert(/^pricing0059_race_[a-f0-9]{12}$/.test(database));return sql(database,text);}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const sessions=[];
class Session {
 constructor(name) {
  this.name=name; this.out='';this.err='';this.closed=false;
  this.child=cp.spawn('docker',['exec','-i',container,'psql','-X','-qAt','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],{stdio:['pipe','pipe','pipe']});
  this.child.stdout.on('data',b=>{this.out+=b;});
  this.child.stderr.on('data',b=>{this.err+=b;});
  this.child.on('error',e=>{this.err+=e.message;this.closed=true;});
  this.child.on('close',code=>{this.closed=true;this.code=code;log('session exit',{session:name,code,stderr:this.err});});
  sessions.push(this);
 }
 async send(text,label) {
  const marker='barrier_'+crypto.randomBytes(6).toString('hex');
  log('send',{session:this.name,label,sql:text});
  this.child.stdin.write(text+'\n\\echo '+marker+'\n');
  const end=Date.now()+20000;
  while(!this.out.includes(marker)) {
   if(this.closed) throw new Error(this.name+' exited '+this.code+' '+this.err);
   if(Date.now()>end) throw new Error(this.name+' barrier timeout '+label);
   await delay(25);
  }
  log('milestone',{session:this.name,label});
 }
 async begin() {await this.send("SET application_name='"+this.name+"'; SELECT 'PID='||pg_backend_pid(); BEGIN ISOLATION LEVEL READ COMMITTED; SET LOCAL lock_timeout='12s'; SET LOCAL statement_timeout='15s'; SET LOCAL idle_in_transaction_session_timeout='25s';",'transaction ready');this.pid=Number(this.out.match(/PID=(\d+)/)[1]);}
 async close() {if(!this.closed){this.child.stdin.end('ROLLBACK;\n\\q\n');const end=Date.now()+3000;while(!this.closed&&Date.now()<end)await delay(25);}}
}
async function blocked(waiter,holder) {
 const end=Date.now()+8000;
 while(Date.now()<end) {
  const data=JSON.parse(target('SELECT json_build_object(\'blocked\','+holder.pid+'=ANY(pg_blocking_pids('+waiter.pid+')),\'state\',state,\'wait_event_type\',wait_event_type,\'wait_event\',wait_event) FROM pg_stat_activity WHERE pid='+waiter.pid+';')||'null');
  if(data?.blocked){log('observed blocking',{waiter:waiter.name,holder:holder.name,...data});return data;}
  if(waiter.closed)throw new Error('Waiter exited before observed blocking: '+waiter.err);
  await delay(50);
 }
 throw new Error('Did not observe expected blocking');
}
const runner=read('supabase/tests/pricing_geography_evidence_foundation.test.cjs');
const snapshot=runner.match(/const snapshot = \x60([\s\S]*?)\x60;/)[1];
const live=read('supabase/tests/0059_pricing_geography_evidence_foundation_test.sql');
const migration=read('supabase/migrations/0059_pricing_geography_evidence_foundation.sql');
// Reuse actual rollback fixtures, with test helpers made cross-session visible ONLY
// in this disposable DB. No production trigger/constraint or lock order is changed.
function fixtures() {
 let s=live.slice(0,live.indexOf('-- Fingerprint ALL existing application/auth rows'));
 s=s.replace('BEGIN;','BEGIN;\nCREATE SCHEMA race0059;').replaceAll('pg_temp.','race0059.')
 .replaceAll('CREATE TEMP TABLE','CREATE TABLE').replaceAll(' ON COMMIT DROP','')
 .replace('CREATE TABLE fixture','CREATE TABLE race0059.fixture').replace('INSERT INTO fixture','INSERT INTO race0059.fixture').replace('1..2 LOOP','1..7 LOOP');
 return s+'\nCOMMIT;';
}
function sourceChange(m,kind) {
 if(kind==='need')return "UPDATE public.movement_needs SET status='closed' WHERE id='"+m.movement_need_id+"';";
 // Batch route then match writers under their shared need/endpoints/intent order.
 const lock=kind==='match'?"PERFORM private.lock_offer_availability_intent('"+m.movement_need_id+"','"+m.offering_movement_intent_id+"');":'';
 const writeMatch=kind==='match'?"PERFORM public.record_trusted_route_match_evidence_for_server('"+m.movement_need_id+"','"+m.offering_movement_intent_id+"',v.route_evidence_id,v.route_evidence_version,10,20,10000,100,9000,6.43,3.52,6.60,3.35,clock_timestamp(),NULL);":'';
 return "DO $change$ DECLARE r private.offering_route_evidence%ROWTYPE; v record; BEGIN "+lock+" SELECT * INTO STRICT r FROM private.offering_route_evidence WHERE id='"+m.route_evidence_id+"'; SELECT * INTO STRICT v FROM public.record_offering_route_evidence_for_server(r.offering_movement_intent_id,r.provider_namespace,r.provider_product,r.provider_version,'race-'||gen_random_uuid()::text,r.route_shape,r.route_distance_meters,r.route_duration_seconds,clock_timestamp(),r.expires_at); "+writeMatch+" END $change$;";
}
const unchanged = "SELECT jsonb_object_agg(n.nspname||'.'||c.relname,query_to_xml(format('SELECT count(*) AS rows, md5(coalesce(string_agg(to_jsonb(t)::text, '''' ORDER BY to_jsonb(t)::text), '''')) AS hash FROM %I.%I t',n.nspname,c.relname),false,true,'')::text) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname IN ('public','private','auth') AND c.relname NOT IN ('pricing_geography_evidence','offering_route_evidence','trusted_route_match_evidence','movement_needs');";
async function race(index,kind,winner) {
 const name=kind+'_'+winner;
 const m=JSON.parse(target("SELECT to_jsonb(m) FROM private.trusted_route_match_evidence m JOIN race0059.fixture f ON f.match_id=m.id WHERE f.label='"+index+"';"));
 const initial=target(unchanged);
 const insert=version=>"SELECT race0059.add_pricing('"+m.id+"','{\"version\":"+version+"}');";
 const a=new Session(name+'_A'),b=new Session(name+'_B');
 await a.begin();await b.begin();
 const aSql=insert(1), bSql=kind==='competing'?insert(2):sourceChange(m,kind);
 const first=winner==='pricing'?a:b,second=winner==='pricing'?b:a;
 await first.send(first===a?aSql:bSql,'first operation complete; holding transaction');
 const saved=kind!=='competing'&&winner==='pricing'?target("SELECT to_jsonb(e) FROM private.pricing_geography_evidence e WHERE false;"):null;
 // Capture uncommitted pricing facts through the owning session, then compare after.
 if(winner==='pricing')await a.send("SELECT 'FACTS='||to_jsonb(e)::text FROM private.pricing_geography_evidence e WHERE movement_need_id='"+m.movement_need_id+"';",'capture immutable pricing facts');
 const pending=second.send(second===a?aSql:bSql,'second operation complete').then(()=>({ok:true}),error=>({ok:false,error:error.message}));
 const wait=await blocked(second,first);
 await first.send('COMMIT;','first committed');
 const result=await pending;
 const expectsReject=winner==='source'||kind==='competing';
 if(result.ok)await second.send('COMMIT;','second committed');
 check(name+' expected serialization outcome',result.ok!==expectsReject,result);
 if(expectsReject)check(name+' expected SQLSTATE',second.err.includes(kind==='competing'?'23505':'23514'),second.err);
 check(name+' no deadlock or timeout',![a,b].some(s=>/40P01|55P03|57014|deadlock detected/.test(s.err)),{a:a.err,b:b.err});
 const rows=JSON.parse(target("SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY version),'[]') FROM private.pricing_geography_evidence e WHERE movement_need_id='"+m.movement_need_id+"';"));
 check(name+' at most one current',rows.filter(e=>e.status==='current').length<=1,rows.length);
 check(name+' exact final row count',rows.length===(winner==='source'?0:1));
 for(const e of rows){check(name+' exact immutable dependency identities',e.route_match_evidence_id===m.id&&e.route_match_evidence_version===m.version&&e.route_evidence_id===m.route_evidence_id&&e.route_evidence_version===m.route_evidence_version&&e.movement_need_id===m.movement_need_id&&e.offering_movement_intent_id===m.offering_movement_intent_id&&e.requesting_member_id===m.requesting_member_id&&e.offering_member_id===m.offering_member_id);check(name+' version winner deterministic',e.version===1);}
 if(rows.length){const before=JSON.parse(a.out.match(/FACTS=(.*)/)[1]);check(name+' historical facts preserved no substitution',JSON.stringify(before)===JSON.stringify(rows[0]));}
 const final=JSON.parse(target("SELECT jsonb_build_object('need',(SELECT status FROM public.movement_needs WHERE id='"+m.movement_need_id+"'),'matches',(SELECT jsonb_agg(jsonb_build_object('id',id,'version',version,'status',status,'route',route_evidence_id) ORDER BY version) FROM private.trusted_route_match_evidence WHERE movement_need_id='"+m.movement_need_id+"'),'routes',(SELECT jsonb_agg(jsonb_build_object('id',id,'version',version,'status',status) ORDER BY version) FROM private.offering_route_evidence WHERE offering_movement_intent_id='"+m.offering_movement_intent_id+"'));"));
 if(kind==='match')check(name+' legitimate match version 2 superseded exact old match',final.matches.length===2&&final.matches[0].id===m.id&&final.matches[0].status==='superseded'&&final.matches[1].version===2&&final.matches[1].status==='current');
 if(kind==='match'||kind==='route')check(name+' legitimate route version 2 superseded exact old route',final.routes.length===2&&final.routes[0].id===m.route_evidence_id&&final.routes[0].status==='superseded'&&final.routes[1].version===2&&final.routes[1].status==='current');
 if(kind==='need')check(name+' need closed',final.need==='closed');
 if(rows.length){
  let error=null;try{target("BEGIN ISOLATION LEVEL READ COMMITTED; SELECT private.assert_pricing_geography_evidence('"+rows[0].id+"'); ROLLBACK;");}catch(e){error=e.message;}
  check(name+(kind==='competing'?' winner is live-valid':' stale dependency rejected by live assertion'),kind==='competing'?error===null:!!error?.includes('23514'),error);
 }
 check(name+' no unrelated financial alignment payment or source writes',initial===target(unchanged));
 report.races.push({name,blocking:wait,secondResult:result,pricing:rows,final,staleCheck:rows.length?kind==='competing'?'live-valid':'rejected 23514':'creation rejected; no pricing history exists'});
 await a.close();await b.close();
}
async function main(){
 if(!process.argv.includes('--run-disposable'))throw new Error('Requires explicit --run-disposable');
 let created=false,before;
 try {
  check('normal database through 0058 and no 0059',sql('postgres',"SELECT max(version)='0058' AND to_regclass('private.pricing_geography_evidence') IS NULL FROM supabase_migrations.schema_migrations;")==='t');
  before=sql('postgres',snapshot+';');
  const dump=command(['exec',container,'pg_dump','-U','postgres','-d','postgres','--schema-only','--no-publications','--no-subscriptions']);
  sql('postgres','CREATE DATABASE '+database+' TEMPLATE template0;');created=true;log('disposable database created');
  sql(database,dump,'supabase_admin');log('restored schema-only local 0058 baseline; no development data copied');
  target(migration);log('installed unchanged 0059 in disposable database via psql');
  target(fixtures());log('committed seven isolated fixture chains');
  let i=1;for(const kind of ['match','route'])for(const winner of ['pricing','source'])await race(i++,kind,winner);
  await race(i++,'competing','pricing');
  for(const winner of ['pricing','source'])await race(i++,'need',winner);
 } finally {
  for(const s of sessions)await s.close();
  if(created){assert(/^pricing0059_race_[a-f0-9]{12}$/.test(database));sql('postgres','DROP DATABASE '+database+' WITH (FORCE);');check('disposable database destroyed',sql('postgres',"SELECT NOT EXISTS(SELECT 1 FROM pg_database WHERE datname='"+database+"');")==='t');}
  if(before)check('normal development database full snapshot unchanged',before===sql('postgres',snapshot+';'));
 }
}
main().then(()=>{report.passed=true;}).catch(e=>{report.passed=false;report.error=e.stack;console.error(e.stack);process.exitCode=1;}).finally(()=>{report.finished=new Date().toISOString();fs.writeFileSync(path.join(root,'docs/0059-pricing-geography-concurrency-results.json'),JSON.stringify(report,null,2)+'\n');});
