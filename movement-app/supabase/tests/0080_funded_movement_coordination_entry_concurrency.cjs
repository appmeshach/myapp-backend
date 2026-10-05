'use strict';

// Explicit integration runner; never imported by portable node:test discovery.
// Tests installed 0080 in a schema-only clone, or loads source in that clone
// before installation. Never replaces application definitions or migration history.
const cp = require('node:child_process');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { container, snapshot, command, query } = require('./0074_trusted_financial_proposal_issuer_behavior.cjs');
const { inspect, verify } = require('./0080_funded_movement_coordination_entry_harness.cjs');
const { fixtures, migrationBody } = require('./0080_funded_movement_coordination_entry_behavior.cjs');
const database = 'coordination0080_race_' + crypto.randomBytes(6).toString('hex');
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
  assert(/^coordination0080_race_[a-f0-9]{12}$/.test(database));
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
    if (target(`SELECT ${blocker.pid}=ANY(pg_blocking_pids(${waiter.pid}));`) === 't') return;
    if (waiter.closed) throw new Error('Expected a real lock wait: ' + waiter.err);
    await delay(40);
  }
  throw new Error('Expected actual PostgreSQL blocking relationship');
}
function noDeadlock(...ss) {
  assert.doesNotMatch(ss.map(s => s.err).join('\n'), /40P01|55P03|57014|25P03|deadlock detected|timeout/i);
}

// COORDINATION_0080_SCENARIOS
function fresh() {
 const schema='coordination_fixture_'+(++fixtureNumber);
 const setup=fixtures().replace('BEGIN;','BEGIN; CREATE SCHEMA '+schema+';').replaceAll('pg_temp.',schema+'.').replaceAll('CREATE TEMP TABLE','CREATE TABLE').replaceAll(' ON COMMIT DROP','');
 target(setup+' COMMIT;');
 const f=JSON.parse(target(`SELECT jsonb_build_object('schema','${schema}','agreement',g.id,'version',g.version,'alignment',g.alignment_id,'requester',g.member_needing_movement_id,'offerer',g.offering_member_id,'need',a.movement_need_id,'offer',a.movement_offer_id,'required',(SELECT sum(amount_minor::numeric) FROM private.financial_components WHERE agreement_id=g.id AND component_key IN ('requester_platform_share','movement_contribution'))) FROM private.financial_agreements g JOIN ${schema}.funding_fixture b ON b.agreement=g.id JOIN public.alignments a ON a.id=g.alignment_id;`));
 target(`BEGIN; SET CONSTRAINTS private.wallet_transaction_balanced_after_transaction,private.wallet_transaction_balanced_after_posting DEFERRED;
 SELECT public.record_wallet_top_up_for_server('${f.requester}',${f.required+100},'NGN','test-0080','race-'||gen_random_uuid());
 SELECT ${schema}.prepare_activation_faces(); ${as(f,f.requester,`SELECT * FROM public.hold_my_movement_funds('${f.agreement}',${f.version});`)} ${activate(f)} COMMIT;`);
 f.before=JSON.parse(target(`SELECT jsonb_build_object('wallet',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM private.wallet_transactions t),'postings',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM private.wallet_postings t),'funding',(SELECT jsonb_agg(to_jsonb(t)) FROM private.movement_funding_holds t));`));
 return f;
}
function as(f,member,sql){return `SELECT set_config('request.jwt.claim.sub','${member}',true); SET LOCAL ROLE authenticated; ${sql} RESET ROLE;`;}
function open(f,offerer=false){return as(f,offerer?f.offerer:f.requester,`SELECT * FROM public.open_my_funded_movement_coordination('${f.need}');`);}
function activate(f){return as(f,f.requester,`SELECT * FROM public.activate_my_funded_movement('${f.agreement}',${f.version});`);}
function outcome(p){return p.then(()=>({ok:true}),e=>({ok:false,error:e.message}));}
function check(r,ok,state){assert.equal(r.ok,ok,JSON.stringify(r));if(!ok)assert.match(r.error,new RegExp(state));}
function facts(f){
 const x=JSON.parse(target(`SELECT jsonb_build_object('journeys',(SELECT count(*) FROM public.journeys WHERE alignment_id='${f.alignment}'),'entries',(SELECT count(*) FROM private.funded_movement_coordination_entries WHERE alignment_id='${f.alignment}'),'payments',(SELECT count(*) FROM private.alignment_activation_payments WHERE alignment_id='${f.alignment}'),'settlements',(SELECT count(*) FROM private.movement_settlements WHERE alignment_id='${f.alignment}'),'state',(SELECT status FROM public.journeys WHERE alignment_id='${f.alignment}'),'alignment',(SELECT status FROM public.alignments WHERE id='${f.alignment}'));`));
 assert.deepEqual(x,{journeys:1,entries:1,payments:0,settlements:0,state:'not_started',alignment:'activated'});
 assert.deepEqual(JSON.parse(target(`SELECT jsonb_build_object('wallet',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM private.wallet_transactions t),'postings',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM private.wallet_postings t),'funding',(SELECT jsonb_agg(to_jsonb(t)) FROM private.movement_funding_holds t));`)),f.before);
 const before=target(`SELECT ${f.schema}.materialization_sources();`);
 target('BEGIN; '+open(f)+open(f,true)+' COMMIT;');
 assert.equal(target(`SELECT ${f.schema}.materialization_sources();`),before,'Replay zero writes');
 target(`BEGIN; SELECT private.assert_funded_coordination_entry('${f.alignment}'); COMMIT;`);
}
function finish(a,b,f,name){noDeadlock(a,b);a.close();b.close();facts(f);console.log('PASS '+name+'; actual blocking, one exact graph, unchanged wallet');}
async function duplicateRace(rollback,principals){
 const f=fresh(),a=new Session(),b=new Session();await a.begin();await b.begin();await a.send(open(f));
 const pending=outcome(b.send(open(f,principals)));await blocked(a,b);await a.send(rollback?'ROLLBACK;':'COMMIT;');check(await pending,true);await b.send('COMMIT;');finish(a,b,f,'duplicate rollback='+rollback+' principals='+principals);
}
async function activationRace(activationFirst){
 const f=fresh(),a=new Session(),b=new Session();await a.begin();await b.begin();await a.send(activationFirst?activate(f):open(f));
 const pending=outcome(b.send(activationFirst?open(f):activate(f)));await blocked(a,b);await a.send('COMMIT;');check(await pending,true);await b.send('COMMIT;');finish(a,b,f,'activation replay first='+activationFirst);
}
async function projectionRace(){
 const f=fresh(),a=new Session(),b=new Session();await a.begin();await b.begin();await a.send(open(f));
 const pending=outcome(b.send(as(f,f.requester,`SELECT * FROM public.get_my_movement_coordination_status('${f.need}');`)));
 await blocked(a,b);await a.send('COMMIT;');check(await pending,true);await b.send('COMMIT;');assert(b.out.includes('not_started'));assert(b.out.includes('|t|f|f'));finish(a,b,f,'projection waits creation commit');
}
async function revealRace(){
 const f=fresh(),a=new Session(),b=new Session();await a.begin();await b.begin();await a.send(open(f));
 const pending=outcome(b.send(as(f,f.requester,`SELECT * FROM public.get_post_activation_people('${f.need}');`)));
 await blocked(a,b);await a.send('COMMIT;');check(await pending,true);await b.send('COMMIT;');finish(a,b,f,'authorized reveal waits entry');
}
async function photoRace(){
 const f=fresh(),a=new Session(),b=new Session();await a.begin();await b.begin();await a.send(open(f));
 // Photo revocation takes member locks, not alignment/offer/journey locks.
 await b.send(`SELECT public.revoke_current_profile_photo_for_server('${f.requester}'); COMMIT;`);
 await a.send('COMMIT;');noDeadlock(a,b);a.close();b.close();facts(f);console.log('PASS concurrent profile revocation compatible; historical activation preserved');
}
async function timestampRace(){
 const f=fresh(),a=new Session(),b=new Session();await a.begin();await b.begin();await a.send(`SELECT id FROM public.alignments WHERE id='${f.alignment}' FOR UPDATE;`);
 const pending=outcome(b.send(open(f)));await blocked(a,b);const boundary=target('SELECT clock_timestamp();');await a.send('COMMIT;');check(await pending,true);await b.send('COMMIT;');
 assert.equal(target(`SELECT created_at>='${boundary}'::timestamptz FROM private.funded_movement_coordination_entries WHERE alignment_id='${f.alignment}';`),'t');finish(a,b,f,'trusted timestamp after alignment wait');
}
async function mutationRace(kind){
 const f=fresh(),a=new Session(),b=new Session();await a.begin();await b.begin();await a.send(open(f));
 const mutation=kind==='alignment'?`UPDATE public.alignments SET status='cancelled' WHERE id='${f.alignment}';`:kind==='offer'?`UPDATE public.movement_offers SET vehicle_id=gen_random_uuid() WHERE id='${f.offer}';`:`UPDATE public.journeys SET status='in_progress' WHERE alignment_id='${f.alignment}';`;
 // An uncommitted new journey is invisible to a plain UPDATE. Target the known
 // entry after a committed constructor, holding its lock in the replay transaction.
 if(kind==='journey'){await a.send('COMMIT; BEGIN; '+open(f)+` SELECT id FROM public.journeys WHERE alignment_id='${f.alignment}' FOR UPDATE;`);}
 const pending=outcome(b.send(mutation));await blocked(a,b);await a.send('COMMIT;');check(await pending,false,'23514');finish(a,b,f,kind+' inconsistency rejects after wait');
}
async function guardedRace(){
 const f=fresh(),a=new Session(),b=new Session();target('BEGIN; '+open(f)+' COMMIT;');await a.begin();await b.begin();
 await a.send(`SELECT id FROM public.alignments WHERE id='${f.alignment}' FOR UPDATE;`);
 const r=await outcome(b.send(as(f,f.offerer,`SELECT * FROM public.request_my_movement_start('${f.need}');`)));check(r,false,'23514');
 await a.send('COMMIT;');noDeadlock(a,b);a.close();b.close();facts(f);console.log('PASS financial legacy start rejects before locking a busy alignment');
}
async function readinessRace(){
 const f=fresh(),a=new Session(),b=new Session();await a.begin();await b.begin();await a.send(open(f));
 const pending=outcome(b.send(as(f,f.offerer,`SELECT * FROM public.get_my_funded_movement_coordination_readiness('${f.need}');`)));
 await blocked(a,b);await a.send('COMMIT;');check(await pending,true);await b.send('COMMIT;');assert(b.out.includes(f.need+'|t'));finish(a,b,f,'readiness waits exact entry commit');
}
async function meetingPointRace(){
 const f=fresh(),a=new Session(),b=new Session();await a.begin();await b.begin();await a.send(open(f));
 const pending=outcome(b.send(as(f,f.offerer,`SELECT * FROM public.set_my_movement_meeting_point('${f.need}','Station entrance',NULL);`)));
 await blocked(a,b);await a.send('COMMIT;');check(await pending,true);await b.send('COMMIT;');assert(b.out.includes('Station entrance'));assert(b.out.includes('|t|t|f'));assert.equal(target(`SELECT count(*) FROM private.funded_movement_start_requests WHERE alignment_id='${f.alignment}';`),'0');finish(a,b,f,'meeting point waits construction canonical lock order');
}
async function agreementRace(entryFirst){
 const f=fresh(),a=new Session(),b=new Session();await a.begin();await b.begin();
 const supersede=`UPDATE private.financial_agreements SET status='superseded' WHERE id='${f.agreement}'; SET CONSTRAINTS ALL IMMEDIATE;`;
 await a.send(entryFirst?open(f):supersede);const pending=outcome(b.send(entryFirst?supersede:open(f)));
 await blocked(a,b);await a.send('COMMIT;');check(await pending,true);await b.send('COMMIT;');finish(a,b,f,'consent-preserving agreement supersession entryFirst='+entryFirst);
}
async function queuedRevealRace(){
 const f=fresh(),offer=new Session(),reveal=new Session(),entry=new Session(),agreement=new Session();
 for(const s of [offer,reveal,entry,agreement])await s.begin();
 await offer.send(`UPDATE public.movement_offers SET updated_at=updated_at WHERE id='${f.offer}';`);
 const revealed=outcome(reveal.send(as(f,f.requester,`SELECT * FROM public.get_post_activation_people('${f.need}');`)));
 await blocked(offer,reveal);
 const opened=outcome(entry.send(open(f)));await blocked(reveal,entry);
 const superseded=outcome(agreement.send(`UPDATE private.financial_agreements SET status='superseded' WHERE id='${f.agreement}'; SET CONSTRAINTS ALL IMMEDIATE;`));
 await blocked(entry,agreement);await offer.send('COMMIT;');
 check(await revealed,true);await reveal.send('COMMIT;');check(await opened,true);await entry.send('COMMIT;');check(await superseded,true);await agreement.send('COMMIT;');
 noDeadlock(offer,reveal,entry,agreement);for(const s of [offer,reveal,entry,agreement])s.close();facts(f);console.log('PASS queued reveal/entry/agreement writers; three actual blocking proofs; no deadlock');
}
async function main() {
  let before;
  const failures = [];
  try {
    assert.equal(query('postgres', "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='0079';"), '1', '0079 local installation required; this runner never applies it');
    const mode = inspect(query);
    console.log('0080 concurrency mode: '+mode+'; installed definitions checked against source');
    before = query('postgres', snapshot);
    // Preserve ordinary ACLs. Only DEFAULT ACL archive entries are excluded:
    // postgres cannot change defaults belonging to the Supabase admin roles.
    command(['pg_dump', '-U', 'postgres', '-d', 'postgres', '--schema-only', '--no-owner', '--format=custom', '--file=' + archive,
      '--schema=public', '--schema=private', '--schema=auth', '--schema=extensions']);
    const toc = command(['pg_restore', '--list', archive]);
    command(['tee', restoreList], filterDefaultAcls(toc));
    query('postgres', `CREATE DATABASE ${database} TEMPLATE template0;`); created = true;
    target('DROP SCHEMA public;');
    assert(/^coordination0080_race_[a-f0-9]{12}$/.test(database));
    command(['pg_restore', '-U', 'postgres', '--dbname=' + database, '--no-owner', '--exit-on-error', '--use-list=' + restoreList, archive]);
    if (mode === 'source') target('BEGIN; '+migrationBody+' COMMIT;');
    verify(query, database); // All sessions use the verified committed clone definitions.
    await duplicateRace(false,false); await duplicateRace(false,true); await duplicateRace(true,true);
    await activationRace(false); await activationRace(true);
    await projectionRace(); await revealRace(); await photoRace(); await timestampRace();
    await mutationRace('alignment'); await mutationRace('offer'); await mutationRace('journey');
    await guardedRace();
    await readinessRace(); await meetingPointRace(); await agreementRace(false); await agreementRace(true);
    await queuedRevealRace();
    console.log('PASS 18 coordination concurrency scenarios; 18 actual blocking proofs; no deadlock');
  } catch (error) {
    failures.push(error);
  } finally {
    try {
      for (const s of sessions) s.close();
      if (created) {
        assert(/^coordination0080_race_[a-f0-9]{12}$/.test(database));
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
