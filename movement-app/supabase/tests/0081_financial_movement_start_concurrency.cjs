'use strict';

// Explicit integration runner; never imported by portable node:test discovery.
// Tests installed 0081 in a schema-only clone, or loads source in that clone
// before installation. Never replaces application definitions or migration history.
const cp = require('node:child_process');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { container, snapshot, command, query } = require('./0074_trusted_financial_proposal_issuer_behavior.cjs');
const { inspect, verify } = require('./0081_financial_movement_start_harness.cjs');
const { fixtures, migrationBody } = require('./0081_financial_movement_start_behavior.cjs');
const database = 'start0081_race_' + crypto.randomBytes(6).toString('hex');
const archive = '/tmp/' + database + '.dump';
const restoreList = '/tmp/' + database + '.list';
const sessions = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let created = false;
let fixtureNumber = 0;


function filterDefaultAcls(toc) {
  // Match the archive type after its dump ID and catalog OIDs, not object names.
  // Ordinary ACL entries (including column ACLs) pass through unchanged.
  return toc.split('\n').filter(line => !/^\d+;\s+\d+\s+\d+\s+DEFAULT ACL\s/.test(line)).join('\n') + '\n';
}

function target(input) {
  assert(/^start0081_race_[a-f0-9]{12}$/.test(database));
  return query(database, input);
}
class Session {
  constructor() {
    this.out = ''; this.err = ''; this.closed = false;
    this.child = cp.spawn('docker', ['exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', database,
      '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], { windowsHide: true });
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
    const deadline = Date.now() + 20000;
    while (!this.out.includes(marker)) {
      if (this.closed) throw new Error(this.err);
      if (Date.now() > deadline) throw new Error('Session barrier timed out');
      await delay(25);
    }
  }
  async begin() {
    await this.send("SELECT 'PID='||pg_backend_pid(); BEGIN ISOLATION LEVEL READ COMMITTED; SET LOCAL lock_timeout='25s'; SET LOCAL statement_timeout='30s'; SET LOCAL idle_in_transaction_session_timeout='35s';");
    this.pid = Number(this.out.match(/PID=(\d+)/)[1]);

  }
  close() { if (!this.closed) this.child.stdin.end('ROLLBACK;\n\\q\n'); }
}
async function blocked(blocker, waiter) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (target(`SELECT ${blocker.pid}=ANY(pg_blocking_pids(${waiter.pid}));`) === 't') {blockingCount++;return;}
    if (waiter.closed) throw new Error('Expected a real lock wait: ' + waiter.err);
    await delay(40);
  }
  throw new Error('Expected actual PostgreSQL blocking relationship');
}
function noDeadlock(...ss) {
  assert.doesNotMatch(ss.map(s => s.err).join('\n'), /40P01|55P03|57014|25P03|deadlock detected|timeout/i);
}

function fresh() {
 const schema='start_fixture_'+(++fixtureNumber);
 const setup=fixtures().replace('BEGIN;','BEGIN; CREATE SCHEMA '+schema+';').replaceAll('pg_temp.',schema+'.').replaceAll('CREATE TEMP TABLE','CREATE TABLE').replaceAll(' ON COMMIT DROP','');
 target(setup+' COMMIT;');
 const f=JSON.parse(target(`SELECT jsonb_build_object('schema','${schema}','agreement',g.id,'version',g.version,'alignment',g.alignment_id,'requester',g.member_needing_movement_id,'offerer',g.offering_member_id,'need',a.movement_need_id,'offer',a.movement_offer_id,'required',(SELECT sum(amount_minor::numeric) FROM private.financial_components WHERE agreement_id=g.id AND component_key IN ('requester_platform_share','movement_contribution'))) FROM private.financial_agreements g JOIN ${schema}.funding_fixture b ON b.agreement=g.id JOIN public.alignments a ON a.id=g.alignment_id;`));
 target(`BEGIN; SET CONSTRAINTS private.wallet_transaction_balanced_after_transaction,private.wallet_transaction_balanced_after_posting DEFERRED;
 SELECT public.record_wallet_top_up_for_server('${f.requester}',${f.required+100},'NGN','test-0081','race-'||gen_random_uuid());
 SELECT ${schema}.prepare_activation_faces(); ${as(f,f.requester,`SELECT * FROM public.hold_my_movement_funds('${f.agreement}',${f.version});`)} ${activate(f)} COMMIT;`);
 f.before=JSON.parse(target(`SELECT jsonb_build_object('wallet',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM private.wallet_transactions t),'postings',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM private.wallet_postings t),'funding',(SELECT jsonb_agg(to_jsonb(t)) FROM private.movement_funding_holds t));`));
 target('BEGIN; '+open(f)+as(f,f.offerer,`SELECT * FROM public.set_my_movement_meeting_point('${f.need}','Station entrance',NULL);`)+' COMMIT;');
 f.journey=target(`SELECT id FROM public.journeys WHERE alignment_id='${f.alignment}';`);
 return f;
}
function as(f,member,sql){return `SELECT set_config('request.jwt.claim.sub','${member}',true); SET LOCAL ROLE authenticated; ${sql} RESET ROLE;`;}
function open(f){return as(f,f.requester,`SELECT * FROM public.open_my_funded_movement_coordination('${f.need}');`);}
function activate(f){return as(f,f.requester,`SELECT * FROM public.activate_my_funded_movement('${f.agreement}',${f.version});`);}
function request(f,member=f.offerer){return as(f,member,`SELECT * FROM public.request_my_funded_movement_start('${f.need}');`);}
function confirm(f,member=f.requester){return as(f,member,`SELECT * FROM public.confirm_my_funded_movement_start('${f.need}');`);}
function requested(f){target('BEGIN; '+request(f)+' COMMIT;');return f;}
function outcome(p){return p.then(()=>({ok:true}),e=>({ok:false,error:e.message}));}
function check(r,ok,state){assert.equal(r.ok,ok,JSON.stringify(r));if(!ok)assert.match(r.error,new RegExp(state));}
let scenarioCount=0,blockingCount=0;
function facts(f,started=false){
 const x=JSON.parse(target(`SELECT jsonb_build_object('journeys',(SELECT count(*) FROM public.journeys WHERE alignment_id='${f.alignment}'),'entries',(SELECT count(*) FROM private.funded_movement_coordination_entries WHERE alignment_id='${f.alignment}'),'requests',(SELECT count(*) FROM private.funded_movement_start_requests WHERE alignment_id='${f.alignment}'),'starts',(SELECT count(*) FROM private.funded_movement_starts WHERE alignment_id='${f.alignment}'),'payments',(SELECT count(*) FROM private.alignment_activation_payments WHERE alignment_id='${f.alignment}'),'settlements',(SELECT count(*) FROM private.movement_settlements WHERE alignment_id='${f.alignment}'),'state',(SELECT status FROM public.journeys WHERE alignment_id='${f.alignment}'),'alignment',(SELECT status FROM public.alignments WHERE id='${f.alignment}'));`));
 assert.deepEqual(x,{journeys:1,entries:1,requests:1,starts:started?1:0,payments:0,settlements:0,state:started?'in_progress':'not_started',alignment:started?'in_progress':'activated'});
 assert.deepEqual(JSON.parse(target(`SELECT jsonb_build_object('wallet',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM private.wallet_transactions t),'postings',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM private.wallet_postings t),'funding',(SELECT jsonb_agg(to_jsonb(t)) FROM private.movement_funding_holds t));`)),f.before);
 target(`BEGIN; SELECT private.assert_funded_coordination_entry('${f.alignment}'); COMMIT;`);
 const before=target(`SELECT ${f.schema}.materialization_sources();`);
 target('BEGIN; '+request(f)+(started?confirm(f):'')+open(f)+' COMMIT;');
 assert.equal(target(`SELECT ${f.schema}.materialization_sources();`),before,'All-table historical replay zero writes');
}
function finish(ss,f,name,started=false){noDeadlock(...ss);for(const s of ss)s.close();facts(f,started);scenarioCount++;console.log('PASS '+name+'; exact graph, held funds unchanged');}
async function duplicateRace(kind,rollback=false){
 const f=kind==='confirm'?requested(fresh()):fresh(),a=new Session(),b=new Session();await a.begin();await b.begin();const action=kind==='confirm'?confirm:request;await a.send(action(f));
 const pending=outcome(b.send(action(f)));await blocked(a,b);await a.send(rollback?'ROLLBACK;':'COMMIT;');check(await pending,true);await b.send('COMMIT;');finish([a,b],f,'duplicate '+kind+' rollback='+rollback,kind==='confirm');
}
async function requestConfirmRace(){
 const f=fresh(),a=new Session(),b=new Session();await a.begin();await b.begin();await a.send(request(f));const p=outcome(b.send(confirm(f)));await blocked(a,b);await a.send('COMMIT;');check(await p,true);await b.send('COMMIT;');finish([a,b],f,'request commit followed by waiting requester confirmation',true);
}
async function prematureRace(){
 const f=fresh(),a=new Session(),b=new Session();await a.begin();await b.begin();check(await outcome(a.send(confirm(f))),false,'23514');await b.send(request(f));await b.send('COMMIT;');finish([a,b],f,'premature confirm fails; offerer request remains valid');
}
async function wrongPrincipalRace(){
 const f=requested(fresh()),a=new Session(),b=new Session();await a.begin();await b.begin();await a.send(confirm(f));const p=outcome(b.send(confirm(f,f.offerer)));await blocked(a,b);await a.send('COMMIT;');check(await p,false,'42501');finish([a,b],f,'requester winner; offerer confirm forbidden; exact replay',true);
}
async function meetingRace(editFirst){
 const f=fresh(),a=new Session(),b=new Session();await a.begin();await b.begin();
 // A direct normal meeting-point UPDATE holds only the point; request must see
 // its committed canonical revision after its final point lock wait.
 const edit=editFirst?`UPDATE private.journey_meeting_points SET place_text='Final entrance',revision=revision+1 WHERE journey_id='${f.journey}';`:as(f,f.requester,`SELECT * FROM public.set_my_movement_meeting_point('${f.need}','Too late',1);`);
 await a.send(editFirst?edit:request(f));const p=outcome(b.send(editFirst?request(f):edit));await blocked(a,b);
 const boundary=target('SELECT clock_timestamp();');await a.send('COMMIT;');check(await p,editFirst,editFirst?undefined:'42501');if(editFirst)await b.send('COMMIT;');
 if(editFirst){assert.equal(target(`SELECT meeting_point_revision=2 AND requested_at>='${boundary}'::timestamptz FROM private.funded_movement_start_requests WHERE journey_id='${f.journey}';`),'t');}
 finish([a,b],f,'meeting edit first='+editFirst);
}
async function entryRace(confirming,entryFirst){
 const f=confirming?requested(fresh()):fresh(),a=new Session(),b=new Session();await a.begin();await b.begin();const action=confirming?confirm:request;
 await a.send(entryFirst?open(f):action(f));const p=outcome(b.send(entryFirst?action(f):open(f)));await blocked(a,b);await a.send('COMMIT;');check(await p,true);await b.send('COMMIT;');finish([a,b],f,'entry replay vs '+(confirming?'confirm':'request')+' entryFirst='+entryFirst,confirming);
}
async function agreementRace(confirmFirst){
 const f=requested(fresh()),a=new Session(),b=new Session();await a.begin();await b.begin();const supersede=`UPDATE private.financial_agreements SET status='superseded' WHERE id='${f.agreement}'; SET CONSTRAINTS ALL IMMEDIATE;`;
 await a.send(confirmFirst?confirm(f):supersede);const p=outcome(b.send(confirmFirst?supersede:confirm(f)));await blocked(a,b);await a.send('COMMIT;');check(await p,true);await b.send('COMMIT;');finish([a,b],f,'consent preserving supersession confirmFirst='+confirmFirst,true);
}
async function mutationRace(kind){
 const f=requested(fresh()),a=new Session(),b=new Session();await a.begin();await b.begin();await a.send(confirm(f));
 const sql=kind==='offer'?`UPDATE public.movement_offers SET status='withdrawn' WHERE id='${f.offer}';`:kind==='journey'?`UPDATE public.journeys SET started_at=clock_timestamp() WHERE id='${f.journey}';`:`UPDATE public.alignments SET status='completed' WHERE id='${f.alignment}';`;
 const p=outcome(b.send(sql));await blocked(a,b);await a.send('COMMIT;');check(await p,false,'23514');finish([a,b],f,'confirm vs direct '+kind+' rejected',true);
}
async function recoveryRace(){
 const f=requested(fresh()),a=new Session(),b=new Session();await a.begin();await b.begin();await a.send(confirm(f));
 // 0056 filters the outer alignment snapshot first. Before the first commit it
 // sees activated, excludes it, and legitimately acquires no context row lock.
 await b.send(as(f,f.requester,'SELECT * FROM public.list_my_active_movement_continuations();'));
 assert(!b.out.includes(f.need),'Uncommitted start is not recovered');
 await b.send('COMMIT;');await a.send('COMMIT;');
 assert(target('BEGIN; '+as(f,f.requester,'SELECT * FROM public.list_my_active_movement_continuations();')+' COMMIT;').includes(f.need));
 // A genuinely started row does enter the canonical context. Its recovery read
 // must wait for the same alignment locked by an exact confirmation replay.
 await a.begin();await b.begin();await a.send(confirm(f));
 const p=outcome(b.send(as(f,f.requester,'SELECT * FROM public.list_my_active_movement_continuations();')));
 await blocked(a,b);await a.send('COMMIT;');check(await p,true);await b.send('COMMIT;');
 assert(b.out.includes(f.need));finish([a,b],f,'recovery excludes uncommitted start; started replay/read actually blocks',true);
}
async function timestampRace(){
 const f=requested(fresh()),a=new Session(),b=new Session();await a.begin();await b.begin();await a.send(`SELECT id FROM public.journeys WHERE id='${f.journey}' FOR UPDATE;`);
 const p=outcome(b.send(confirm(f)));await blocked(a,b);const boundary=target('SELECT clock_timestamp();');await a.send('COMMIT;');check(await p,true);await b.send('COMMIT;');
 assert.equal(target(`SELECT started_at>='${boundary}'::timestamptz FROM private.funded_movement_starts WHERE journey_id='${f.journey}';`),'t');finish([a,b],f,'start clock after journey wait',true);
}
async function queuedRace(){
 const f=requested(fresh()),offer=new Session(),reveal=new Session(),start=new Session(),agreement=new Session();for(const s of [offer,reveal,start,agreement])await s.begin();
 await offer.send(`UPDATE public.movement_offers SET updated_at=updated_at WHERE id='${f.offer}';`);
 const rp=outcome(reveal.send(as(f,f.requester,`SELECT * FROM public.get_post_activation_people('${f.need}');`)));await blocked(offer,reveal);
 const sp=outcome(start.send(confirm(f)));await blocked(reveal,start);
 const gp=outcome(agreement.send(`UPDATE private.financial_agreements SET status='superseded' WHERE id='${f.agreement}'; SET CONSTRAINTS ALL IMMEDIATE;`));await blocked(start,agreement);
 await offer.send('COMMIT;');check(await rp,true);await reveal.send('COMMIT;');check(await sp,true);await start.send('COMMIT;');check(await gp,true);await agreement.send('COMMIT;');finish([offer,reveal,start,agreement],f,'queued offer/reveal/start/agreement; no deadlock',true);
}
async function main() {
  let before;
  const failures = [];
  try {
    assert.equal(query('postgres', "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='0080';"), '1', '0080 local installation required; this runner never applies it');
    const mode = inspect(query);
    console.log('0081 concurrency mode: '+mode+'; installed definitions checked against source');
    before = query('postgres', snapshot);
    // Preserve ordinary ACLs. Only DEFAULT ACL archive entries are excluded:
    // postgres cannot change defaults belonging to the Supabase admin roles.
    command(['pg_dump', '-U', 'postgres', '-d', 'postgres', '--schema-only', '--no-owner', '--format=custom', '--file=' + archive,
      '--schema=public', '--schema=private', '--schema=auth', '--schema=extensions']);
    const toc = command(['pg_restore', '--list', archive]);
    command(['tee', restoreList], filterDefaultAcls(toc));
    query('postgres', `CREATE DATABASE ${database} TEMPLATE template0;`); created = true;
    target('DROP SCHEMA public;');
    assert(/^start0081_race_[a-f0-9]{12}$/.test(database));
    command(['pg_restore', '-U', 'postgres', '--dbname=' + database, '--no-owner', '--exit-on-error', '--use-list=' + restoreList, archive]);
    if (mode === 'source') target('BEGIN; '+migrationBody+' COMMIT;');
    verify(query, database); // All sessions use the verified committed clone definitions.
    await duplicateRace('request'); await duplicateRace('request',true);
    await prematureRace(); await requestConfirmRace();
    await duplicateRace('confirm'); await duplicateRace('confirm',true); await wrongPrincipalRace();
    await meetingRace(true); await meetingRace(false);
    for(const confirming of [false,true])for(const entryFirst of [false,true])await entryRace(confirming,entryFirst);
    await agreementRace(false); await agreementRace(true);
    for(const kind of ['offer','journey','alignment'])await mutationRace(kind);
    await recoveryRace(); await timestampRace(); await queuedRace();
    assert.equal(scenarioCount,21); console.log('PASS '+scenarioCount+' financial start scenarios; '+blockingCount+' actual blocking proofs; no deadlock');
  } catch (error) {
    failures.push(error);
  } finally {
    try {
      for (const s of sessions) s.close();
      if (created) {
        assert(/^start0081_race_[a-f0-9]{12}$/.test(database));
        query('postgres', `DROP DATABASE ${database} WITH (FORCE);`);
        console.log('PASS disposable database cleanup');
      }
    } catch (error) {
      failures.push(error);
    }
    try {
      if (before) {
        assert.equal(query('postgres', snapshot), before, 'Application DB data/catalog/ACL/RLS/history fingerprint unchanged');
        console.log('PASS application database fingerprint unchanged');
      }
    } catch (error) {
      failures.push(error);
    } finally {
      // Always attempt file cleanup, even if database cleanup or verification fails.
      try {
        command(['rm', '-f', '--', archive, restoreList]);
      } catch (error) {
        failures.push(error);
      }
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures,
    failures.map(error => error.stack || String(error)).join('\nAdditional failure:\n'), { cause: failures[0] });
}
module.exports = { filterDefaultAcls };
if (require.main === module) main().catch(e => { console.error(e.stack); process.exitCode = 1; });
