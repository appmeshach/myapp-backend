'use strict';

// Explicit integration runner; never imported by portable node:test discovery.
// Tests installed 0078 in a schema-only clone, or loads source in that clone
// before installation. Never replaces application definitions or migration history.
const cp = require('node:child_process');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { container, snapshot, command, query } = require('./0074_trusted_financial_proposal_issuer_behavior.cjs');
const { inspect, verify } = require('./0078_requester_movement_funding_hold_harness.cjs');
const { fixtures, migrationBody } = require('./0078_requester_movement_funding_hold_behavior.cjs');
const database = 'funding0078_race_' + crypto.randomBytes(6).toString('hex');
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
  assert(/^funding0078_race_[a-f0-9]{12}$/.test(database));
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

// FUNDING_0078_SCENARIOS
function fresh() {
 const schema='funding_fixture_'+(++fixtureNumber);
 const setup=fixtures().replace('BEGIN;', 'BEGIN; CREATE SCHEMA '+schema+';').replaceAll('pg_temp.',schema+'.').replaceAll('CREATE TEMP TABLE','CREATE TABLE').replaceAll(' ON COMMIT DROP','');
 target(setup+' COMMIT;');
 const f=JSON.parse(target(`SELECT jsonb_build_object('schema','${schema}','agreement',g.id,'version',g.version,'alignment',g.alignment_id,
 'requester',g.member_needing_movement_id,'offerer',g.offering_member_id,'required',(SELECT sum(amount_minor::numeric) FROM private.financial_components WHERE agreement_id=g.id AND component_key IN ('requester_platform_share','movement_contribution')))
 FROM private.financial_agreements g JOIN ${schema}.funding_fixture b ON b.agreement=g.id;`));
 target('BEGIN; SET CONSTRAINTS private.wallet_transaction_balanced_after_transaction,private.wallet_transaction_balanced_after_posting DEFERRED; '+topUp(f,f.required+100)+' COMMIT;');return f;
}
function hold(f) {return `SELECT set_config('request.jwt.claim.sub','${f.requester}',true); SET LOCAL ROLE authenticated; SELECT * FROM public.hold_my_movement_funds('${f.agreement}',${f.version}); RESET ROLE;`;}
function topUp(f,amount) {return `SET LOCAL ROLE service_role; SELECT public.record_wallet_top_up_for_server('${f.requester}',${amount},'NGN','test-0078','race-'||gen_random_uuid()); RESET ROLE;`;}
function outcome(p){return p.then(()=>({ok:true}),e=>({ok:false,error:e.message}));}
function check(r,ok){assert.equal(r.ok,ok,JSON.stringify(r));if(!ok)assert.match(r.error,/23514/);}
function facts(f,held,extra=0) {
 const x=JSON.parse(target(`SELECT jsonb_build_object('holds',(SELECT count(*) FROM private.wallet_transactions t JOIN private.financial_components c ON c.id=t.financial_component_id WHERE c.agreement_id='${f.agreement}' AND t.transaction_kind='movement_hold'),
 'postings',(SELECT count(*) FROM private.wallet_postings p JOIN private.wallet_transactions t ON t.id=p.transaction_id JOIN private.financial_components c ON c.id=t.financial_component_id WHERE c.agreement_id='${f.agreement}' AND t.transaction_kind='movement_hold'),
 'receipts',(SELECT count(*) FROM private.movement_funding_holds WHERE financial_agreement_id='${f.agreement}'),
 'agreements',(SELECT count(*) FROM private.financial_agreements WHERE alignment_id='${f.alignment}'),
 'components',(SELECT count(*) FROM private.financial_components WHERE agreement_id='${f.agreement}'),
 'available',(SELECT coalesce(sum(CASE WHEN p.direction='credit' THEN p.amount_minor::numeric ELSE -p.amount_minor::numeric END),0) FROM private.wallet_postings p JOIN private.wallet_accounts a ON a.id=p.account_id WHERE a.member_id='${f.requester}' AND a.account_kind='member_available'),
 'held',(SELECT coalesce(sum(CASE WHEN p.direction='credit' THEN p.amount_minor::numeric ELSE -p.amount_minor::numeric END),0) FROM private.wallet_postings p JOIN private.wallet_accounts a ON a.id=p.account_id WHERE a.member_id='${f.requester}' AND a.account_kind='member_held'));`));
 assert.deepEqual(x,{holds:held?2:0,postings:held?4:0,receipts:held?1:0,agreements:1,components:3,available:(held?100:f.required+100)+extra,held:held?f.required:0});
 if(held)target(`SELECT * FROM private.movement_funding_evidence(g) FROM private.financial_agreements g WHERE g.id='${f.agreement}';`.replace('SELECT * FROM private.movement_funding_evidence(g) FROM','SELECT (private.movement_funding_evidence(g)).* FROM'));
 assert.equal(target(`SELECT count(*) FROM private.wallet_postings p JOIN private.wallet_accounts a ON a.id=p.account_id WHERE a.account_kind IN ('platform_revenue','member_withdrawable');`),'0');
}
function finish(a,b,name){noDeadlock(a,b);a.close();b.close();console.log('PASS '+name+', actual blocking and exact ledger graph');}
async function duplicateRace(rollback) {
 const f=fresh(),a=new Session(),b=new Session();await a.begin();await b.begin();await a.send(hold(f));const pending=outcome(b.send(hold(f)));await blocked(a,b);await a.send(rollback?'ROLLBACK;':'COMMIT;');check(await pending,true);await b.send('COMMIT;');
 const rows=[a,b].map(x=>x.out.split('\n').find(line=>line.startsWith(f.agreement+'|')));assert(rows.every(Boolean));if(!rollback)assert.equal(rows[0],rows[1]);facts(f,true);finish(a,b,'duplicate rollback='+rollback);
}
async function topUpRace(holdFirst) {
 const f=fresh(),a=new Session(),b=new Session();await a.begin();await b.begin();await a.send(holdFirst?hold(f):topUp(f,1000));const pending=outcome(b.send(holdFirst?topUp(f,1000):hold(f)));await blocked(a,b);await a.send('COMMIT;');check(await pending,true);await b.send('COMMIT;');facts(f,true,1000);finish(a,b,'hold vs top-up holdFirst='+holdFirst);
}
async function closureRace(holdFirst) {
 const f=fresh(),a=new Session(),b=new Session();await a.begin();await b.begin();
 const close=`UPDATE private.wallet_accounts SET status='closed' WHERE member_id='${f.requester}' AND account_kind='${holdFirst?'member_held':'member_withdrawable'}';`;
 await a.send(holdFirst?hold(f):close);const pending=outcome(b.send(holdFirst?close:hold(f)));await blocked(a,b);await a.send('COMMIT;');check(await pending,false);facts(f,holdFirst);finish(a,b,'hold vs reachable closure holdFirst='+holdFirst);
}
async function supersessionRace(holdFirst) {
 const f=fresh(),a=new Session(),b=new Session();await a.begin();await b.begin();const supersede=`UPDATE private.financial_agreements SET status='superseded' WHERE id='${f.agreement}';`;
 await a.send(holdFirst?hold(f):supersede);const pending=outcome(b.send(holdFirst?supersede:hold(f)));await blocked(a,b);await a.send('COMMIT;');check(await pending,holdFirst);if(holdFirst){await b.send('COMMIT;');target('BEGIN; '+hold(f)+' COMMIT;');}facts(f,holdFirst);finish(a,b,'hold vs agreement supersession holdFirst='+holdFirst);
}
function prepare(f) {f.payment=target('BEGIN; SELECT '+f.schema+'.prepare_funding_activation(); COMMIT;');}
function activate(f) {return `SET LOCAL ROLE service_role; SELECT * FROM public.mark_alignment_activation_payment_succeeded('${f.payment}','race-activation'); RESET ROLE;`;}
async function lifecycleRace(holdFirst) {
 const f=fresh();prepare(f);const a=new Session(),b=new Session();await a.begin();await b.begin();await a.send(holdFirst?hold(f):activate(f));const pending=outcome(b.send(holdFirst?activate(f):hold(f)));await blocked(a,b);await a.send('COMMIT;');check(await pending,holdFirst);if(holdFirst){await b.send('COMMIT;');target('BEGIN; '+hold(f)+' COMMIT;');}facts(f,holdFirst);assert.equal(target(`SELECT status FROM public.alignments WHERE id='${f.alignment}';`),'activated');finish(a,b,'hold vs legitimate activation holdFirst='+holdFirst);
}
async function activationLockRace() {
 const f=fresh();prepare(f);const a=new Session(),b=new Session();await a.begin();await b.begin();await a.send(`SELECT private.assert_alignment_face_ready('${f.alignment}');`);const pending=outcome(b.send(hold(f)));await blocked(a,b);await a.send(`SELECT id FROM private.financial_agreements WHERE id='${f.agreement}' FOR UPDATE; COMMIT;`);check(await pending,true);await b.send('COMMIT;');facts(f,true);finish(a,b,'activation alignment/need/member ordering');
}
async function projectionRace() {
 const f=fresh(),a=new Session(),b=new Session();await a.begin();await b.begin();await a.send(hold(f));const pending=outcome(b.send(`SELECT set_config('request.jwt.claim.sub','${f.requester}',true); SET LOCAL ROLE authenticated; SELECT * FROM public.get_my_movement_funding_status('${f.agreement}'); RESET ROLE;`));await blocked(a,b);await a.send('COMMIT;');check(await pending,true);await b.send('COMMIT;');facts(f,true);assert(b.out.includes('|held|'));finish(a,b,'status waits for complete committed hold');
}
async function main() {
  let before;
  const failures = [];
  try {
    assert.equal(query('postgres', "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='0077';"), '1', '0077 local installation required; this runner never applies it');
    const mode = inspect(query);
    console.log('0078 concurrency mode: '+mode+'; installed definitions checked against source');
    before = query('postgres', snapshot);
    // Preserve ordinary ACLs. Only DEFAULT ACL archive entries are excluded:
    // postgres cannot change defaults belonging to the Supabase admin roles.
    command(['pg_dump', '-U', 'postgres', '-d', 'postgres', '--schema-only', '--no-owner', '--format=custom', '--file=' + archive,
      '--schema=public', '--schema=private', '--schema=auth', '--schema=extensions']);
    const toc = command(['pg_restore', '--list', archive]);
    command(['tee', restoreList], filterDefaultAcls(toc));
    query('postgres', `CREATE DATABASE ${database} TEMPLATE template0;`); created = true;
    target('DROP SCHEMA public;');
    assert(/^funding0078_race_[a-f0-9]{12}$/.test(database));
    command(['pg_restore', '-U', 'postgres', '--dbname=' + database, '--no-owner', '--exit-on-error', '--use-list=' + restoreList, archive]);
    if (mode === 'source') target('BEGIN; '+migrationBody+' COMMIT;');
    verify(query, database); // All sessions use the verified committed clone definitions.
    await duplicateRace(false); await duplicateRace(true);
    await topUpRace(false); await topUpRace(true);
    await closureRace(false); await closureRace(true);
    await supersessionRace(false); await supersessionRace(true);
    await lifecycleRace(false); await lifecycleRace(true);
    await activationLockRace(); await projectionRace();
    console.log('PASS 12 funding concurrency scenarios; actual blocking observed; no deadlock');
  } catch (error) {
    failures.push(error);
  } finally {
    try {
      for (const s of sessions) s.close();
      if (created) {
        assert(/^funding0078_race_[a-f0-9]{12}$/.test(database));
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
