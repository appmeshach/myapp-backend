'use strict';
// Explicit local integration runner. Copies schema only; never application data.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const container = 'supabase_db_movement-app';
const database = 'proposal0070_race_' + crypto.randomBytes(6).toString('hex');
const {snapshot,fixtures}=require('./0070_financial_proposal_quote_binding_behavior.cjs');
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
  assert(/^proposal0070_race_[a-f0-9]{12}$/.test(database));
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
function fixture(label) {
 return JSON.parse(target(`SELECT to_jsonb(q)||jsonb_build_object('vehicle_id',f.vehicle_id) FROM private.pricing_quotes q JOIN race0070.proposal_fixture f ON f.quote_id=q.id WHERE f.label='${label}';`));
}
function construct(q) {return `SELECT race0070.construct('${q.id}');`;}
async function blocked(a,b) {
 const end=Date.now()+8000;
 while(Date.now()<end) {
  if(target(`SELECT ${a.pid}=ANY(pg_blocking_pids(${b.pid}));`)==='t')return;
  if(b.closed)throw new Error(b.err);
  await delay(50);
 }
 throw new Error('Expected actual PostgreSQL blocking relationship');
}
function noTimeout(a,b) {assert(!/40P01|55P03|57014|25P03|deadlock detected|timeout/i.test(a.err+b.err),a.err+b.err);}
async function rejectionRace(label,kind) {
 let q=fixture(label);
 if(kind==='expiry') {
  target(`DO $$ DECLARE new_quote_id uuid; BEGIN UPDATE private.pricing_quotes SET status='superseded' WHERE id='${q.id}';
    new_quote_id:=race0070.add_quote('${q.pricing_geography_evidence_id}',jsonb_build_object('version',2,'expires_at',clock_timestamp()+interval '10 seconds'));
    UPDATE race0070.proposal_fixture SET quote_id=new_quote_id WHERE label='${label}'; END $$;`);
  q=fixture(label);
 }
 let offer;
 if(kind==='acceptance')offer=makeOffer(q);
 const a=new Session(),b=new Session();await a.begin();await b.begin();
 if(kind==='supersession')await a.send(`UPDATE private.pricing_quotes SET status='superseded' WHERE id='${q.id}';`);
 if(kind==='expiry')await a.send(`SELECT id FROM private.pricing_quotes WHERE id='${q.id}' FOR UPDATE;`);
 if(kind==='roster')await a.send(`DELETE FROM public.movement_participants WHERE movement_need_id='${q.movement_need_id}';`);
 if(kind==='acceptance')await a.send(`SELECT set_config('request.jwt.claim.sub','${q.requesting_member_id}',true); SET LOCAL ROLE authenticated; SELECT * FROM public.accept_movement_offer('${offer}'); RESET ROLE;`);
 const pending=b.send(construct(q)).then(()=>({ok:true}),e=>({ok:false,error:e.message}));
 await blocked(a,b);
 if(kind==='expiry') {
  const end=Date.now()+12000;
  while(target(`SELECT expires_at<clock_timestamp() FROM private.pricing_quotes WHERE id='${q.id}';`)!=='t') {
   assert(Date.now()<end);await delay(100);
  }
 }
 await a.send('COMMIT;');
 const r=await pending;assert.equal(r.ok,false,JSON.stringify(r));assert.match(r.error,/23514/);
 noTimeout(a,b);
 assert.equal(target(`SELECT count(*) FROM private.financial_proposals WHERE movement_need_id='${q.movement_need_id}';`),'0');
 if(kind==='acceptance')assert.equal(target(`SELECT count(*) FROM public.alignments WHERE movement_need_id='${q.movement_need_id}' AND status='awaiting_activation_payment';`),'1');
 console.log(`PASS ${kind}: observed wait, rejected stale constructor, zero proposal rows, no deadlock/timeout`);
 if(!a.closed)a.child.stdin.end('\\q\n');
}
function makeOffer(q) {
 return target(`BEGIN;
 SELECT set_config('request.jwt.claim.sub','${q.offering_member_id}',true);
 DO $$ DECLARE a uuid; o uuid; BEGIN
 SELECT availability_id INTO a FROM public.open_offering_movement_availability(gen_random_uuid(),'${q.offering_movement_intent_id}','${q.vehicle_id}',4);
 SELECT movement_offer_id INTO o FROM public.create_movement_offer('${q.movement_need_id}',
  (SELECT route_match_evidence_id FROM private.pricing_geography_evidence WHERE id='${q.pricing_geography_evidence_id}'),a,1);
 END $$; COMMIT;
 SELECT id FROM public.movement_offers WHERE movement_need_id='${q.movement_need_id}';`).split('\n').at(-1);
}
async function sharedIntentRace() {
 const q=fixture(6), old=fixture(7);
 // A second real requester need with the SAME independent offering intent.
 target(`DO $$ DECLARE m uuid; g uuid; result uuid; e private.pricing_geography_evidence%ROWTYPE; BEGIN
 SELECT * INTO e FROM private.pricing_geography_evidence WHERE id='${q.pricing_geography_evidence_id}';
 SELECT route_match_evidence_id INTO m FROM public.record_trusted_route_match_evidence_for_server(
  '${old.movement_need_id}',e.offering_movement_intent_id,e.route_evidence_id,e.route_evidence_version,
  10,20,10000,100,9000,6.43,3.52,6.60,3.35,clock_timestamp(),NULL);
 g:=race0070.record_result(m);
 SELECT quote_id INTO result FROM public.record_pricing_quote_for_server(g,1,'trusted_server_result_infrastructure_v1',12345);
 UPDATE race0070.proposal_fixture SET quote_id=result,vehicle_id='${q.vehicle_id}' WHERE label='7'; END $$;`);
 const second=fixture(7), offer=makeOffer(second);
 const a=new Session(),b=new Session();await a.begin();await b.begin();
 await a.send(construct(q));
 const pending=b.send(`SELECT set_config('request.jwt.claim.sub','${second.requesting_member_id}',true); SET LOCAL ROLE authenticated; SELECT * FROM public.accept_movement_offer('${offer}'); RESET ROLE;`).then(()=>({ok:true}),e=>({ok:false,error:e.message}));
 await blocked(a,b);await a.send('COMMIT;');const r=await pending;assert(r.ok,r.error);
 await b.send('SET CONSTRAINTS ALL IMMEDIATE; COMMIT;');noTimeout(a,b);
 assert.equal(target(`SELECT count(*) FROM private.financial_proposals WHERE pricing_quote_id='${q.id}';`),'1');
 assert.equal(target(`SELECT count(*) FROM public.alignments WHERE movement_need_id='${second.movement_need_id}';`),'1');
 console.log('PASS shared intent: constructor SHARE blocks operational UPDATE, both finish without upgrade deadlock');
 for(const s of [a,b])s.child.stdin.end('\\q\n');
}
async function constructorFirst() {
 const q=fixture(8),a=new Session(),b=new Session();await a.begin();await b.begin();
 await a.send(construct(q));
 const pending=b.send(`UPDATE private.pricing_quotes SET status='superseded' WHERE id='${q.id}';`).then(()=>({ok:true}),e=>({ok:false,error:e.message}));
 await blocked(a,b);await a.send('COMMIT;');const r=await pending;assert(r.ok,r.error);await b.send('COMMIT;');noTimeout(a,b);
 target(`SELECT private.assert_financial_proposal_quote_binding(p) FROM private.financial_proposals p WHERE pricing_quote_id='${q.id}';`);
 assert.equal(target(`SELECT count(*) FROM private.financial_proposals WHERE pricing_quote_id='${q.id}';`),'1');
 console.log('PASS constructor first: later supersession preserves exact historical provenance');
 for(const s of [a,b])s.child.stdin.end('\\q\n');
}
(async()=>{
 let before;
 try {
  assert.equal(sql('postgres',"SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='0070';"),'1');
  before=sql('postgres',snapshot+';');
  const schema=command(['pg_dump','-U','postgres','-d','postgres','--schema-only','--no-owner','--no-acl','--schema=public','--schema=private','--schema=auth','--schema=extensions']);
  sql('postgres',`CREATE DATABASE ${database} TEMPLATE template0;`);created=true;
  target('DROP SCHEMA public;');target(schema);
  target('GRANT USAGE ON SCHEMA public TO authenticated,service_role;');
  // Apply exact relevant function ACLs lost by the no-ACL schema clone.
  target(`REVOKE ALL ON FUNCTION public.accept_movement_offer(uuid) FROM PUBLIC,anon,authenticated,service_role;
   GRANT EXECUTE ON FUNCTION public.accept_movement_offer(uuid) TO authenticated;`);
  let setup=fixtures().replace('BEGIN;','BEGIN;\nCREATE SCHEMA race0070;').replaceAll('pg_temp.','race0070.')
    .replaceAll('CREATE TEMP TABLE','CREATE TABLE').replaceAll(' ON COMMIT DROP','');
  for(const table of ['fixture','geography','source_before','proposal_fixture'])setup=setup.replace(new RegExp('\\b'+table+'\\b','g'),'race0070.'+table);
  target(setup+'\nCOMMIT;');
  for(const [label,kind] of [[1,'supersession'],[2,'expiry'],[4,'roster'],[5,'acceptance']])await rejectionRace(label,kind);
  await sharedIntentRace();await constructorFirst();
 }finally {
  for(const s of sessions)if(!s.closed)s.child.stdin.end('ROLLBACK;\n\\q\n');
  if(created){assert(/^proposal0070_race_[a-f0-9]{12}$/.test(database));sql('postgres',`DROP DATABASE ${database} WITH (FORCE);`);console.log('PASS disposable concurrency database removed');}
  if(before){assert.equal(sql('postgres',snapshot+';'),before);console.log('PASS application database snapshot unchanged');}
 }
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
