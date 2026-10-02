'use strict';
// Explicit local integration runner. Copies schema only; never application data.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const container = 'supabase_db_movement-app';
const database = 'pricing0069_race_' + crypto.randomBytes(6).toString('hex');
const {snapshot,fixtures}=require('./0069_trusted_pricing_quote_producer_behavior.cjs');
const sessions = [];
let created = false;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function command(args, input) {
  const r = cp.spawnSync('docker', ['exec', '-i', container, ...args], {
    input, encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024, windowsHide: true,
  });
  if (r.error || r.status !== 0) throw new Error(String(r.error || '') + r.stderr + r.stdout);
  return r.stdout.trim();
}
function sql(db, input) {
  return command(['psql', '-X', '-qAt', '-U', 'postgres', '-d', db,
    '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], input);
}
function target(input) {
  assert(/^pricing0069_race_[a-f0-9]{12}$/.test(database));
  return sql(database, input);
}
class Session {
  constructor() {
    this.out = ''; this.err = ''; this.closed = false;
    this.child = cp.spawn('docker', ['exec', '-i', container, 'psql', '-X', '-qAt',
      '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], { windowsHide: true });
    this.child.stdout.on('data', b => { this.out += b; });
    this.child.stderr.on('data', b => { this.err += b; });
    this.child.stdin.on('error', e => { this.err += e.message; });
    this.child.on('error', e => { this.err += e.message; this.closed = true; });
    this.child.on('close', () => { this.closed = true; });
    sessions.push(this);
  }
  async send(input) {
    const marker = 'done_' + crypto.randomBytes(6).toString('hex');
    this.child.stdin.write(input + '\n\\echo ' + marker + '\n');
    const end = Date.now() + 20000;
    while (!this.out.includes(marker)) {
      if (this.closed) throw new Error(this.err);
      if (Date.now() > end) throw new Error('Session barrier timed out');
      await delay(25);
    }
  }
  async begin() {
    await this.send("SELECT 'PID='||pg_backend_pid(); BEGIN ISOLATION LEVEL READ COMMITTED; SET LOCAL lock_timeout='25s'; SET LOCAL statement_timeout='30s'; SET LOCAL idle_in_transaction_session_timeout='35s';");
    this.pid = Number(this.out.match(/PID=(\d+)/)[1]);
  }
  result() { return JSON.parse(this.out.match(/RESULT=(.*)/)?.[1] || 'null'); }
}
const policy='trusted_server_result_infrastructure_v1';
function publish(e,amount=12345) {
  return `SET LOCAL ROLE service_role; SELECT 'RESULT='||to_jsonb(q)::text FROM public.record_pricing_quote_for_server('${e.id}',${e.version},'${policy}',${amount}) q; RESET ROLE;`;
}
async function race(label,kind) {
  let e=JSON.parse(target(`SELECT to_jsonb(e) FROM private.pricing_geography_evidence e JOIN race0069.geography g ON g.id=e.id WHERE g.label='${label}';`));
  const expiry=['expiry','history-expiry'].includes(kind);
  if(expiry) {
    // A genuinely short-lived source, constructed with all normal triggers.
    target(`DO $x$ DECLARE e private.pricing_geography_evidence%ROWTYPE; BEGIN
      SELECT * INTO STRICT e FROM private.pricing_geography_evidence WHERE id='${e.id}';
      UPDATE private.pricing_geography_evidence SET status='superseded' WHERE id=e.id;
      e.id:=gen_random_uuid();e.version:=e.version+1;e.generated_at:=clock_timestamp();e.created_at:=e.generated_at;
      e.expires_at:=e.created_at+interval '10 seconds';
      INSERT INTO private.pricing_geography_evidence SELECT e.*;
      UPDATE race0069.geography SET id=e.id WHERE label='${label}'; END $x$;`);
    e=JSON.parse(target(`SELECT to_jsonb(e) FROM private.pricing_geography_evidence e JOIN race0069.geography g ON g.id=e.id WHERE g.label='${label}';`));
  }
  let seed;
  if(kind==='history-expiry') seed=JSON.parse(target(`BEGIN; SET LOCAL ROLE service_role; SELECT to_jsonb(q) FROM public.record_pricing_quote_for_server('${e.id}',${e.version},'${policy}',12345) q; COMMIT;`));
  const a=new Session(),b=new Session();
  await a.begin();await b.begin();
  if(kind==='need') await a.send(`UPDATE public.movement_needs SET status='closed' WHERE id='${e.movement_need_id}';`);
  else if(kind==='expiry') await a.send(`SELECT id FROM public.movement_needs WHERE id='${e.movement_need_id}' FOR UPDATE;`);
  else if(kind==='history-expiry') await a.send(`SELECT id FROM private.pricing_quotes WHERE id='${seed.quote_id}' FOR UPDATE;`);
  else await a.send(publish(e));
  let second=publish(e,kind==='conflict'?12346:12345);
  if(kind==='versions') {
    const m=JSON.parse(target(`SELECT to_jsonb(m) FROM private.trusted_route_match_evidence m WHERE id='${e.route_match_evidence_id}';`));
    // A new source cannot be current alongside the old one. The second trusted
    // transaction replaces the source under the same need lock before quoting.
    second=`SET LOCAL ROLE service_role; SELECT 'RESULT='||to_jsonb(q)::text
      FROM public.record_pricing_geography_evidence_for_server('${m.id}',${m.version},'${m.route_evidence_id}',${m.route_evidence_version},12000,'[]','test-classifier','v2','test-v1') g
      CROSS JOIN LATERAL public.record_pricing_quote_for_server(g.pricing_geography_evidence_id,g.pricing_geography_evidence_version,'${policy}',23456) q; RESET ROLE;`;
  }
  const pending=b.send(second).then(()=>({ok:true}),error=>({ok:false,error:error.message}));
  let blocked=false;
  const deadline=Date.now()+8000;
  while(Date.now()<deadline&&!blocked) {
    blocked=target(`SELECT ${a.pid}=ANY(pg_blocking_pids(${b.pid}));`)==='t';
    if(!blocked)await delay(50);
  }
  assert(blocked,kind+': expected actual PostgreSQL lock wait');
  if(expiry) {
    const end=Date.now()+12000;
    while(target(`SELECT clock_timestamp()>expires_at FROM private.pricing_geography_evidence WHERE id='${e.id}';`)!=='t') {
      assert(Date.now()<end,'expiry deadline');await delay(100);
    }
  }
  await a.send(kind==='rollback'?'ROLLBACK;':'COMMIT;');
  const result=await pending;
  const rejects=['conflict','need','expiry','history-expiry'].includes(kind);
  assert.equal(result.ok,!rejects,JSON.stringify(result));
  if(rejects)assert(/23514/.test(result.error),result.error);
  else await b.send('SET CONSTRAINTS ALL IMMEDIATE; COMMIT;');
  assert(!/40P01|55P03|57014|25P03|deadlock detected|timeout/i.test(a.err+b.err),a.err+b.err);
  const rows=JSON.parse(target(`SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY version),'[]') FROM private.pricing_quotes q WHERE movement_need_id='${e.movement_need_id}';`));
  const count=['need','expiry'].includes(kind)?0:kind==='versions'?2:1;
  assert.equal(rows.length,count);
  assert.equal(rows.filter(q=>q.status==='current').length,count?1:0);
  assert(rows.every((q,i)=>q.version===i+1));
  if(kind==='identical')assert.deepEqual(a.result(),b.result());
  if(kind==='conflict')assert.equal(rows[0].seat_price_minor,12345);
  if(kind==='rollback')assert.notEqual(a.result().quote_id,b.result().quote_id);
  if(kind==='versions') {
    assert.equal(rows[0].status,'superseded');assert.equal(rows[1].seat_price_minor,23456);
    assert.equal(b.result().quote_version,2);
  }
  console.log(`PASS ${kind}: observed lock wait, expected result, exact canonical history, no deadlock/timeout`);
  for(const s of [a,b])if(!s.closed)s.child.stdin.end('\\q\n');
}
(async()=>{
  let before;
  try {
    assert.equal(sql('postgres',"SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='0069';"),'1');
    before=sql('postgres',snapshot+';');
    const schema=command(['pg_dump','-U','postgres','-d','postgres','--schema-only','--no-owner','--no-acl',
      '--schema=public','--schema=private','--schema=auth','--schema=extensions']);
    sql('postgres',`CREATE DATABASE ${database} TEMPLATE template0;`);created=true;
    target('DROP SCHEMA public;');target(schema);
    target('GRANT USAGE ON SCHEMA public TO service_role;');
    const migration=fs.readFileSync(path.join(__dirname,'../migrations/0069_trusted_pricing_quote_producer_boundary.sql'),'utf8');
    target(migration.slice(migration.indexOf('REVOKE ALL ON FUNCTION')).replace(/COMMIT;\s*$/,''));
    // Fixture helpers are cross-session visible only in the disposable DB.
    let setup=fixtures().replace('BEGIN;','BEGIN;\nCREATE SCHEMA race0069;')
      .replaceAll('pg_temp.','race0069.').replaceAll('CREATE TEMP TABLE','CREATE TABLE').replaceAll(' ON COMMIT DROP','');
    for(const table of ['fixture','geography','source_before'])setup=setup.replace(new RegExp('\\b'+table+'\\b','g'),'race0069.'+table);
    target(setup+'\nCOMMIT;');
    for(const [label,kind] of [[1,'identical'],[2,'conflict'],[4,'versions'],[5,'rollback'],[6,'need'],[7,'expiry'],[8,'history-expiry']])await race(label,kind);
  } finally {
    for(const s of sessions)if(!s.closed)s.child.stdin.end('ROLLBACK;\n\\q\n');
    if(created) {
      assert(/^pricing0069_race_[a-f0-9]{12}$/.test(database));
      sql('postgres',`DROP DATABASE ${database} WITH (FORCE);`);
      console.log('PASS disposable concurrency database removed');
    }
    if(before) {
      assert.equal(sql('postgres',snapshot+';'),before,'Application database must remain unchanged');
      console.log('PASS full application database snapshot unchanged');
    }
  }
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
