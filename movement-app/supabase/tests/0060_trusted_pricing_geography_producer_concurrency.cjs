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
const database = 'pricing0060_race_' + crypto.randomBytes(6).toString('hex');
const report = {started:new Date().toISOString(),container,database,events:[],checks:[],races:[]};
function log(event,details={}) { const row={at:new Date().toISOString(),event,...details};report.events.push(row);console.log(JSON.stringify(row)); }
function check(name,condition,details) {report.checks.push({name,pass:!!condition,details});log(condition?'PASS':'FAIL',{name,details});assert(condition,name);}
function command(args,input,timeout=60000) {
 const r=cp.spawnSync('docker',args,{input,encoding:'utf8',timeout,maxBuffer:64*1024*1024});
 if(r.error || r.status!==0) throw new Error('docker '+args.join(' ')+'\n'+(r.error||'')+'\n'+r.stderr+'\n'+r.stdout);
 return r.stdout.trim();
}
function sql(db,text,user='postgres',timeout=60000) {return command(['exec','-i',container,'psql','-X','-qAt','-U',user,'-d',db,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],text+'\n',timeout);}
function target(text) {assert(/^pricing0060_race_[a-f0-9]{12}$/.test(database));return sql(database,text);}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const sessions=[];
class Session {
 constructor(name) {
  this.name=name; this.out='';this.err='';this.closed=false;
  this.child=cp.spawn('docker',['exec','-i',container,'psql','-X','-qAt','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],{stdio:['pipe','pipe','pipe']});
  this.child.stdout.on('data',b=>{this.out+=b;});
  this.child.stderr.on('data',b=>{this.err+=b;});
  this.child.stdin.on('error',e=>{this.err+=e.message;});
  this.child.on('error',e=>{this.err+=e.message;this.closed=true;});
  this.child.on('close',code=>{this.closed=true;this.code=code;log('session exit',{session:name,code,stdout:this.out,stderr:this.err});});
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
 async close() {if(!this.closed){this.child.stdin.end('\\q\n');const end=Date.now()+3000;while(!this.closed&&Date.now()<end)await delay(25);}}
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
const live=read('supabase/tests/0060_trusted_pricing_geography_producer_test.sql');
const migration=read('supabase/migrations/0060_trusted_pricing_geography_producer_boundary.sql');
const migrationHash=crypto.createHash('sha256').update(migration).digest('hex');
report.migrationSha256=migrationHash;
// Reuse actual rollback fixtures, with test helpers made cross-session visible ONLY
// in this disposable DB. No production trigger/constraint or lock order is changed.
function fixtures() {
 let s=live.slice(0,live.indexOf('-- Fingerprint ALL existing application/auth rows'));
 s=s.replace('BEGIN;','BEGIN;\nCREATE SCHEMA race0060;').replaceAll('pg_temp.','race0060.')
 .replaceAll('CREATE TEMP TABLE','CREATE TABLE').replaceAll(' ON COMMIT DROP','')
 .replace('CREATE TABLE fixture','CREATE TABLE race0060.fixture').replace('INSERT INTO fixture','INSERT INTO race0060.fixture').replace('1..2 LOOP','1..11 LOOP');
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

const literal=value=>"'"+String(value).replaceAll("'","''")+"'";
const stable=e=>{const {status,...facts}=e;return JSON.stringify(facts);};
function rowsFor(m){return "SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY version),'[]') FROM private.pricing_geography_evidence e WHERE movement_need_id="+literal(m.movement_need_id)+';';}
function producer(m,version='v1',events='[]') {
 return "SET LOCAL ROLE service_role; SELECT 'RESULT='||row_to_json(r)::text FROM public.record_pricing_geography_evidence_for_server("+
 [literal(m.id),m.version,literal(m.route_evidence_id),m.route_evidence_version,12000,literal(events)+'::jsonb',"'test-classifier'",literal(version),"'test-v1'"].join(',')+
 ') r; RESET ROLE;';
}
function returned(s){return [...s.out.matchAll(/^RESULT=(.*)$/gm)].map(x=>JSON.parse(x[1]));}
async function capture(session,m){
 const r=returned(session).at(-1);
 await session.send("SELECT private.assert_pricing_geography_evidence("+literal(r.pricing_geography_evidence_id)+"); SELECT 'FACTS='||coalesce(jsonb_agg(to_jsonb(e) ORDER BY version),'[]')::text FROM private.pricing_geography_evidence e WHERE movement_need_id="+literal(m.movement_need_id)+';','live return verified; capture immutable history');
 return JSON.parse([...session.out.matchAll(/^FACTS=(.*)$/gm)].at(-1)[1]);
}
async function race(index,kind,winner='A') {
 const name='R'+index+'_'+kind+'_'+winner;
 const m=JSON.parse(target("SELECT to_jsonb(m) FROM private.trusted_route_match_evidence m JOIN race0060.fixture f ON f.match_id=m.id WHERE f.label='"+index+"';"));
 const initial=target(unchanged);
 const source=['match','route','need'].includes(kind);
 const seeded=['versions','retry'].includes(kind);
 if(seeded)target('BEGIN ISOLATION LEVEL READ COMMITTED; '+producer(m)+' COMMIT;');
 const baseline=JSON.parse(target(rowsFor(m)));
 const beforeFacts=[...baseline];
 const a=new Session(name+'_A'),b=new Session(name+'_B');
 await a.begin();await b.begin();
 const aSql=producer(m,kind==='versions'?'v2':'v1');
 const bSql=source?sourceChange(m,kind):producer(m,kind==='versions'?'v3':kind==='retry'?'v2':'v1',kind==='conflict'?'[{"event_type":"core_stage_entry","position_meters":0}]':'[]');
 const first=winner==='A'?a:b,second=winner==='A'?b:a;
 await first.send(first===a?aSql:bSql,'first operation finished; transaction held');
 if(first===a||!source)beforeFacts.push(...await capture(first,m));
 const pending=second.send(second===a?aSql:bSql,'second operation finished').then(()=>({ok:true}),error=>({ok:false,error:error.message}));
 const wait=await blocked(second,first);
 check(name+' PostgreSQL confirms real dependency lock wait',wait.blocked&&wait.wait_event_type==='Lock'&&['transactionid','tuple'].includes(wait.wait_event),wait);
 await first.send('COMMIT;','first committed; waiter released');
 const result=await pending;
 const rejects=(source&&winner==='B')||kind==='conflict'||(kind==='retry'&&winner==='B');
 if(result.ok){if(second===a||!source)beforeFacts.push(...await capture(second,m));await second.send('COMMIT;','second committed');}
 const rows=JSON.parse(target(rowsFor(m)));
 const final=JSON.parse(target("SELECT jsonb_build_object('need',(SELECT status FROM public.movement_needs WHERE id="+literal(m.movement_need_id)+"),'matches',(SELECT jsonb_agg(to_jsonb(x) ORDER BY version) FROM private.trusted_route_match_evidence x WHERE movement_need_id="+literal(m.movement_need_id)+"),'routes',(SELECT jsonb_agg(to_jsonb(x) ORDER BY version) FROM private.offering_route_evidence x WHERE offering_movement_intent_id="+literal(m.offering_movement_intent_id)+"));"));
 // Save final state before assertions so any genuine defect remains reviewable.
 const record={name,kind,winner,blocking:wait,secondResult:result,returnedA:returned(a),returnedB:returned(b),pricing:rows,final};report.races.push(record);
 check(name+' documented success or rejection',result.ok!==rejects,result);
 if(rejects)check(name+' rejection SQLSTATE 23514',second.err.includes('23514'),second.err);
 check(name+' no deadlock',![a,b].some(s=>/40P01|deadlock detected/.test(s.err)));
 check(name+' no timeout',![a,b].some(s=>/55P03|57014|25P03|timeout/.test(s.err)));
 const count=source&&winner==='B'?0:kind==='versions'?3:kind==='retry'?2:1;
 check(name+' exact history row count',rows.length===count,rows.length);
 check(name+' at most one current',rows.filter(e=>e.status==='current').length===(count?1:0));
 check(name+' unique monotonic versions',rows.every((e,i)=>e.version===i+1));
 check(name+' terminal history and current latest version',rows.every((e,i)=>e.status===(i===rows.length-1?'current':'superseded')));
 check(name+' immutable recorded history unchanged',beforeFacts.every(old=>rows.some(e=>e.id===old.id&&stable(old)===stable(e))));
 check(name+' exact match id version retained',rows.every(e=>e.route_match_evidence_id===m.id&&e.route_match_evidence_version===m.version));
 check(name+' exact route id version retained',rows.every(e=>e.route_evidence_id===m.route_evidence_id&&e.route_evidence_version===m.route_evidence_version));
 check(name+' requester offerer need intent and state bindings retained',rows.every(e=>e.movement_need_id===m.movement_need_id&&e.requesting_member_id===m.requesting_member_id&&e.offering_member_id===m.offering_member_id&&e.offering_movement_intent_id===m.offering_movement_intent_id&&e.offering_intent_version===m.offering_intent_version&&e.state_location_reference_id===m.requester_origin_location_reference_id));
 check(name+' provider route stays 15000; corridor stays 12000',final.routes.every(r=>r.route_distance_meters===15000)&&rows.every(e=>e.pricing_corridor_distance_meters===12000));
 if(kind==='identical')check(name+' identical callers return same ID version status expiry',JSON.stringify(returned(a)[0])===JSON.stringify(returned(b)[0])&&returned(a)[0].pricing_geography_evidence_version===1);
 if(kind==='conflict')check(name+' mismatch cannot masquerade as replay',returned(b).length===0&&b.err.includes('Pricing geography replay payload mismatch')&&JSON.stringify(rows[0].geographic_events)==='[]');
 if(kind==='versions')check(name+' new provenance serializes v2 then v3',returned(a)[0].pricing_geography_evidence_version===2&&returned(b)[0].pricing_geography_evidence_version===3&&rows[1].classifier_version==='v2'&&rows[2].classifier_version==='v3');
 if(kind==='retry')check(name+' retry never resurrects v1',rows[0].id===baseline[0].id&&rows[0].status==='superseded'&&rows[1].classifier_version==='v2'&&(winner==='A'?returned(a)[0].pricing_geography_evidence_id===baseline[0].id:returned(a).length===0));
 if(kind==='match')check(name+' supported match replacement created v2',final.matches.length===2&&final.matches[0].id===m.id&&final.matches[0].status==='superseded'&&final.matches[1].version===2&&final.matches[1].status==='current');
 if(kind==='match'||kind==='route')check(name+' supported route replacement created v2',final.routes.length===2&&final.routes[0].id===m.route_evidence_id&&final.routes[0].status==='superseded'&&final.routes[1].version===2&&final.routes[1].status==='current');
 if(kind==='need')check(name+' mutable need legitimately closed',final.need==='closed');
 for(const e of rows){let error=null;try{target('BEGIN ISOLATION LEVEL READ COMMITTED; SELECT private.assert_pricing_geography_evidence('+literal(e.id)+'); ROLLBACK;');}catch(x){error=x.message;}
  const stale=source||e.status!=='current';
  check(name+' live validation v'+e.version+(stale?' rejects stale':' accepts current'),stale?!!error?.includes('23514'):error===null,error);
 }
 const after=target(unchanged);
 check(name+' no unrelated financial agreements proposals alignments activation payments settlements or auth writes',initial===after);
 await a.close();await b.close();
 record.pass=true;
}
async function main(){
 if(!process.argv.includes('--run-disposable'))throw new Error('Requires explicit --run-disposable');
 let created=false,before;
 try {
  check('normal database through 0059 and no 0060',sql('postgres',"SELECT max(version)='0059' AND to_regclass('private.pricing_geography_evidence') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='record_pricing_geography_evidence_for_server') FROM supabase_migrations.schema_migrations;")==='t');
  before=sql('postgres',snapshot+';');
  const dump=command(['exec',container,'pg_dump','-U','postgres','-d','postgres','--schema-only','--no-publications','--no-subscriptions']);
  sql('postgres','CREATE DATABASE '+database+' TEMPLATE template0;');created=true;log('disposable database created');
  sql(database,"SET statement_timeout='300s';\n"+dump,'supabase_admin',360000);log('restored schema-only local 0059 baseline; no development data copied');
  target(migration);log('installed unchanged 0060 in disposable database via psql');
  target(fixtures());log('committed eleven isolated fixture chains');
  let i=1;
  for(const kind of ['match','route'])for(const winner of ['A','B'])await race(i++,kind,winner);
  for(const kind of ['identical','conflict','versions'])await race(i++,kind);
  for(const winner of ['A','B'])await race(i++,'retry',winner);
  for(const winner of ['A','B'])await race(i++,'need',winner);
 } catch(error) { report.primaryError=error.stack; throw error; } finally {
  for(const s of sessions)await s.close();

  if(created){
    assert(/^pricing0060_race_[a-f0-9]{12}$/.test(database));
    sql('postgres','DROP DATABASE '+database+' WITH (FORCE);','postgres');
    check(
      'disposable database destroyed',
      sql(
        'postgres',
        "SELECT NOT EXISTS(SELECT 1 FROM pg_database WHERE datname='"+database+"');"
      )==='t'
    );
  }

  if(before)check(
    'normal development database full snapshot unchanged',
    before===sql('postgres',snapshot+';')
  );
 }
}
main().then(()=>{report.passed=true;}).catch(e=>{report.passed=false;report.error=e.stack;console.error(e.stack);process.exitCode=1;}).finally(()=>{report.finished=new Date().toISOString();fs.writeFileSync(path.join(root,'docs/0060-pricing-geography-concurrency-results.json'),JSON.stringify(report,null,2)+'\n');});
