'use strict';

// Explicit integration runner; never imported by portable node:test discovery.
// Requires separately authorized 0076 installation. All writes use a disposable
// schema-only clone, never the application database. No migration is applied here.
const cp = require('node:child_process');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { container, snapshot, command, query, fixtures } = require('./0074_trusted_financial_proposal_issuer_behavior.cjs');
const database = 'consent0076_race_' + crypto.randomBytes(6).toString('hex');
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
  assert(/^consent0076_race_[a-f0-9]{12}$/.test(database));
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
function fresh(issue = true) {
  const schema = 'race0076_' + (++fixtureNumber);
  let sql = fixtures().replace('BEGIN;', `BEGIN; CREATE SCHEMA ${schema};`)
    .replaceAll('pg_temp.', schema + '.').replaceAll('CREATE TEMP TABLE', 'CREATE TABLE').replaceAll(' ON COMMIT DROP', '');
  target(sql + '\nCOMMIT;');
  const f = JSON.parse(target(`SELECT to_jsonb(f)||to_jsonb(b) FROM ${schema}.snapshot_fixture f CROSS JOIN ${schema}.binding_fixture b;`));
  const current = refreshSources({ ...f, schema });
  if (issue) {
    target('BEGIN; ' + construct(current) + ' COMMIT;');
    current.proposal = JSON.parse(target(`SELECT jsonb_build_object('id',p.id,'version',p.version) FROM private.financial_proposals p WHERE p.movement_context_snapshot_id='${current.snapshot_id}' AND p.status='current';`));
  }
  return current;
}
function refreshSources(f) {
  Object.assign(f, JSON.parse(target(`SELECT jsonb_build_object(
    'quote_id',q.id,'quote_version',q.version,'snapshot_id',s.id,'snapshot_version',s.version,
    'movement_offer',s.movement_offer_id,'need',s.movement_need_id,'requester',s.requesting_member_id,
    'offerer',s.offering_member_id,'intent',s.offering_movement_intent_id,'vehicle',s.vehicle_id,
    'match_evidence',m.id,'route',m.route_evidence_id,'availability',ab.availability_id)
    FROM ${f.schema}.binding_fixture b
    JOIN private.pricing_quotes q ON q.id=b.quote_id
    JOIN private.movement_context_snapshots s ON s.id=b.snapshot_id
    JOIN private.movement_offer_route_match_bindings rb ON rb.movement_offer_id=s.movement_offer_id
    JOIN private.trusted_route_match_evidence m ON m.id=rb.route_match_evidence_id
    JOIN private.movement_offer_availability_bindings ab ON ab.movement_offer_id=s.movement_offer_id;`)));
  return f;
}
function construct(f) {
  // Resolve the scenario binding inside the issuing transaction, including
  // changes made by that transaction. Never embed IDs cached by fresh().
  return `SELECT issued.* FROM ${f.schema}.binding_fixture b
    JOIN private.pricing_quotes q ON q.id=b.quote_id
    JOIN private.movement_context_snapshots s ON s.id=b.snapshot_id
    CROSS JOIN LATERAL public.issue_financial_proposal_for_server(q.id,q.version,s.id,s.version) issued;`;
}
function consent(f) {
  return `SELECT set_config('request.jwt.claim.sub','${f.offerer}',true); SET LOCAL ROLE authenticated;
    SELECT * FROM public.accept_my_financial_proposal_as_offerer('${f.proposal.id}',${f.proposal.version},'${f.movement_offer}'); RESET ROLE;`;
}
function legacy(f) {
  return `SELECT set_config('request.jwt.claim.sub','${f.requester}',true); SET LOCAL ROLE authenticated;
    SELECT * FROM public.accept_movement_offer('${f.movement_offer}'); RESET ROLE;`;
}
function outcome(promise) { return promise.then(() => ({ok:true}), e => ({ok:false,error:e.message})); }
function check(result, succeeds) {
  assert.equal(result.ok,succeeds,JSON.stringify(result));
  if (!succeeds) assert.match(result.error,/23514/);
}
function state(f) { return JSON.parse(target(`SELECT to_jsonb(p) FROM private.financial_proposals p WHERE p.id='${f.proposal.id}';`)); }
function pendingOnly(f) {
  assert.equal(target(`SELECT status FROM public.movement_offers WHERE id='${f.movement_offer}';`),'pending');
  assert.equal(target(`SELECT status FROM public.movement_needs WHERE id='${f.need}';`),'discoverable');
  assert.equal(target(`SELECT count(*) FROM public.alignments WHERE movement_need_id='${f.need}';`),'0');
  assert.equal(target(`SELECT remaining_places FROM private.offering_movement_availability WHERE id='${f.availability}';`),'3');
}
async function duplicateRace(rollback) {
  const f=fresh(),a=new Session(),b=new Session();await a.begin();await b.begin();
  await a.send(consent(f));
  const pending=outcome(b.send(consent(f)));await blocked(a,b);
  await a.send(rollback?'ROLLBACK;':'COMMIT;');check(await pending,true);await b.send('COMMIT;');
  const p=state(f);assert.equal(p.movement_offer_id,f.movement_offer);assert(p.offering_accepted_at);
  const returned = [a,b].map(s=>s.out.split('\n').find(line=>line.startsWith(f.proposal.id+'|')));
  assert(returned.every(Boolean),'Both RPCs returned consent evidence');
  if(!rollback) assert.equal(returned[0],returned[1],'Duplicate retry preserves exact timestamp');
  const before=JSON.stringify(p);target('BEGIN; '+consent(f)+' COMMIT;');assert.equal(JSON.stringify(state(f)),before);
  pendingOnly(f);noDeadlock(a,b);a.close();b.close();console.log('PASS duplicate consent, rollback='+rollback+', actual blocking observed');
}
async function issuanceRace(consentFirst) {
  const f=fresh(),a=new Session(),b=new Session();await a.begin();await b.begin();
  const issue=`SELECT ${f.schema}.next_quote(); SELECT ${f.schema}.issue_id();`;
  await a.send(consentFirst?consent(f):issue);
  const pending=outcome(b.send(consentFirst?issue:consent(f)));await blocked(a,b);await a.send('COMMIT;');check(await pending,false);
  const p=state(f);assert.equal(p.status,consentFirst?'current':'superseded');assert.equal(!!p.offering_accepted_at,consentFirst);
  assert.equal(target(`SELECT count(*) FROM private.financial_proposals WHERE movement_need_id='${f.need}';`),consentFirst?'1':'2');
  pendingOnly(f);noDeadlock(a,b);a.close();b.close();console.log('PASS consent vs new issuance, consentFirst='+consentFirst+', actual blocking observed');
}
async function withdrawalRace(withdrawalFirst) {
  const f=fresh(),a=new Session(),b=new Session();await a.begin();await b.begin();
  const withdraw=`UPDATE public.movement_offers SET status='withdrawn' WHERE id='${f.movement_offer}';`;
  await a.send(withdrawalFirst?withdraw:consent(f));
  const pending=outcome(b.send(withdrawalFirst?consent(f):withdraw));await blocked(a,b);await a.send('COMMIT;');check(await pending,!withdrawalFirst);
  if(!withdrawalFirst) await b.send('COMMIT;');
  assert.equal(!!state(f).offering_accepted_at,!withdrawalFirst);
  assert.equal(target(`SELECT status FROM public.movement_offers WHERE id='${f.movement_offer}';`),'withdrawn');
  // Historical consent is never erased by withdrawal; replay now fails live validation.
  assert.throws(()=>target('BEGIN; '+consent(f)+' COMMIT;'),/23514/);
  noDeadlock(a,b);a.close();b.close();console.log('PASS consent vs withdrawal, withdrawalFirst='+withdrawalFirst+', actual blocking observed');
}
async function legacyRace() {
  const f=fresh(),a=new Session(),b=new Session();await a.begin();await b.begin();await a.send(consent(f));
  const pending=outcome(b.send(legacy(f)));await blocked(a,b);await a.send('COMMIT;');check(await pending,false);
  assert.match((await pending).error,/financial requester materialization/);pendingOnly(f);noDeadlock(a,b);a.close();b.close();
  console.log('PASS legacy acceptance waits for consent then fails cutover guard');
}
async function issuanceBeforeLegacy() {
  // No history when the legacy statement starts: it must discover history
  // committed after its need-lock wait, rather than trust an earlier snapshot.
  const f=fresh(false),a=new Session(),b=new Session();await a.begin();await b.begin();
  await a.send(construct(f));
  const pending=outcome(b.send(legacy(f)));await blocked(a,b);await a.send('COMMIT;');check(await pending,false);
  assert.match((await pending).error,/financial requester materialization/);pendingOnly(f);noDeadlock(a,b);a.close();b.close();
  console.log('PASS legacy acceptance vs issuance, actual blocking observed and no bypass');
}
async function main() {
  let before;
  const failures = [];
  try {
    assert.equal(query('postgres', "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='0076';"), '1', '0076 local installation required; this runner never applies it');
    before = query('postgres', snapshot);
    // Preserve ordinary ACLs. Only DEFAULT ACL archive entries are excluded:
    // postgres cannot change defaults belonging to the Supabase admin roles.
    command(['pg_dump', '-U', 'postgres', '-d', 'postgres', '--schema-only', '--no-owner', '--format=custom', '--file=' + archive,
      '--schema=public', '--schema=private', '--schema=auth', '--schema=extensions']);
    const toc = command(['pg_restore', '--list', archive]);
    command(['tee', restoreList], filterDefaultAcls(toc));
    query('postgres', `CREATE DATABASE ${database} TEMPLATE template0;`); created = true;
    target('DROP SCHEMA public;');
    assert(/^consent0076_race_[a-f0-9]{12}$/.test(database));
    command(['pg_restore', '-U', 'postgres', '--dbname=' + database, '--no-owner', '--exit-on-error', '--use-list=' + restoreList, archive]);
    for (const rollback of [false,true]) await duplicateRace(rollback);
    await issuanceRace(true); await issuanceRace(false);
    await withdrawalRace(true); await withdrawalRace(false);
    await legacyRace(); await issuanceBeforeLegacy();
    console.log('PASS 8 concurrency scenarios; every required blocking relationship observed; no deadlock');
  } catch (error) {
    failures.push(error);
  } finally {
    try {
      for (const s of sessions) s.close();
      if (created) {
        assert(/^consent0076_race_[a-f0-9]{12}$/.test(database));
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
