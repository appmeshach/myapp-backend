'use strict';

// Explicit integration runner; never imported by portable node:test discovery.
// Requires separately authorized 0074 installation. All writes use a disposable
// schema-only clone, never the application database. No migration is applied here.
const cp = require('node:child_process');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { container, snapshot, command, query, fixtures } = require('./0074_trusted_financial_proposal_issuer_behavior.cjs');
const database = 'binding0074_race_' + crypto.randomBytes(6).toString('hex');
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
  assert(/^binding0074_race_[a-f0-9]{12}$/.test(database));
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
function fresh() {
  const schema = 'race0074_' + (++fixtureNumber);
  let sql = fixtures().replace('BEGIN;', `BEGIN; CREATE SCHEMA ${schema};`)
    .replaceAll('pg_temp.', schema + '.').replaceAll('CREATE TEMP TABLE', 'CREATE TABLE').replaceAll(' ON COMMIT DROP', '');
  target(sql + '\nCOMMIT;');
  const f = JSON.parse(target(`SELECT to_jsonb(f)||to_jsonb(b) FROM ${schema}.snapshot_fixture f CROSS JOIN ${schema}.binding_fixture b;`));
  return refreshSources({ ...f, schema });
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
function supersede(f) { return `UPDATE private.movement_context_snapshots SET status='superseded' WHERE id='${f.snapshot_id}';`; }
function prelock(f) {
  return `SELECT private.assert_movement_offer_availability_binding('${f.movement_offer}'); SELECT private.assert_pricing_quote('${f.quote_id}'); SELECT private.assert_movement_context_snapshot('${f.snapshot_id}');`;
}
function accept(f) {
  return `SELECT set_config('request.jwt.claim.sub','${f.requester}',true); SET LOCAL ROLE authenticated; SELECT * FROM public.accept_movement_offer('${f.movement_offer}'); RESET ROLE;`;
}
function outcome(promise) { return promise.then(() => ({ ok: true }), e => ({ ok: false, error: e.message })); }
function checkResult(result, succeeds) {
  assert.equal(result.ok, succeeds, JSON.stringify(result));
  if (!succeeds) assert.match(result.error, /23514/);
}
function proposalCount(f) { return target(`SELECT count(*) FROM private.financial_proposals WHERE movement_context_snapshot_id='${f.snapshot_id}';`); }

async function snapshotRace(kind) {
  const f = fresh(), a = new Session(), b = new Session();
  await a.begin(); await b.begin();
  if (kind === 'superseder-first') await a.send(supersede(f));
  else await a.send(construct(f));
  const pending = outcome(b.send(kind === 'superseder-first' ? construct(f) : supersede(f)));
  await blocked(a, b);
  await a.send(kind === 'constructor-rollback' ? 'ROLLBACK;' : 'COMMIT;');
  checkResult(await pending, kind === 'constructor-rollback');
  if (kind === 'constructor-rollback') await b.send('COMMIT;');
  assert.equal(proposalCount(f), kind === 'constructor-first' ? '1' : '0');
  assert.equal(target(`SELECT status FROM private.movement_context_snapshots WHERE id='${f.snapshot_id}';`), kind === 'constructor-first' ? 'current' : 'superseded');
  noDeadlock(a, b); a.close(); b.close();
  console.log('PASS snapshot race: ' + kind + ', actual blocking observed');
}
async function proposalSupersessionRace(commit) {
  const f = fresh(); target('BEGIN; ' + construct(f) + ' COMMIT;');
  const a = new Session(), b = new Session(); await a.begin(); await b.begin();
  // Supported future writer order: dependencies (including snapshot SHARE),
  // then proposal history. The guard itself never locks proposal rows.
  await a.send(prelock(f) + `UPDATE private.financial_proposals SET status='superseded' WHERE movement_context_snapshot_id='${f.snapshot_id}'; SET CONSTRAINTS ALL IMMEDIATE;`);
  const pending = outcome(b.send(supersede(f))); await blocked(a, b);
  await a.send(commit ? 'COMMIT;' : 'ROLLBACK;'); checkResult(await pending, commit);
  if (commit) await b.send('COMMIT;');
  assert.equal(target(`SELECT status FROM private.movement_context_snapshots WHERE id='${f.snapshot_id}';`), commit ? 'superseded' : 'current');
  target(`SELECT private.assert_financial_proposal_snapshot_roster(id) FROM private.financial_proposals WHERE movement_context_snapshot_id='${f.snapshot_id}';`);
  noDeadlock(a, b); a.close(); b.close();
  console.log('PASS proposal supersession ' + (commit ? 'commit releases pin' : 'rollback retains pin') + ', actual blocking observed');
}
async function eligibilityRace(kind) {
  const f = fresh(), a = new Session(), b = new Session(); await a.begin(); await b.begin();
  if (kind === 'roster') {
    await a.send(`SELECT id FROM public.movement_needs WHERE id='${f.need}' FOR UPDATE; UPDATE public.movement_participants SET status='invited' WHERE movement_need_id='${f.need}' AND role='invited_participant';`);
  } else await a.send(accept(f));
  const pending = outcome(b.send(construct(f))); await blocked(a, b); await a.send('COMMIT;');
  checkResult(await pending, false); assert.equal(proposalCount(f), '0');
  noDeadlock(a, b); a.close(); b.close(); console.log('PASS ' + kind + ' wins: constructor waits and rejects stale context');
}
async function constructorBeforeEligibility(kind) {
  const f = fresh(), a = new Session(), b = new Session(); await a.begin(); await b.begin();
  await a.send(construct(f));
  const mutation = kind === 'acceptance' ? accept(f) :
    `SELECT id FROM public.movement_needs WHERE id='${f.need}' FOR UPDATE; UPDATE public.movement_participants SET status='invited' WHERE movement_need_id='${f.need}' AND role='invited_participant';`;
  const pending = outcome(b.send(mutation)); await blocked(a, b); await a.send('COMMIT;');
  checkResult(await pending, true); await b.send('COMMIT;');
  target(`SELECT private.assert_financial_proposal_snapshot_roster(id) FROM private.financial_proposals WHERE movement_context_snapshot_id='${f.snapshot_id}';`);
  assert.equal(proposalCount(f), '1'); noDeadlock(a, b); a.close(); b.close();
  console.log('PASS constructor before ' + kind + ': actual need lock wait, historical binding survives');
}
async function expiryDuringWait() {
  const f = fresh();
  target(`BEGIN; SELECT ${f.schema}.bind_offer(${f.schema}.expiring_offer()); COMMIT;`);
  refreshSources(f);
  const a = new Session(), b = new Session(); await a.begin(); await b.begin();
  await a.send(`SELECT id FROM public.movement_needs WHERE id='${f.need}' FOR UPDATE;`);
  const pending = outcome(b.send(construct(f))); await blocked(a, b);
  assert.equal(target(`SELECT q.expires_at>clock_timestamp() FROM private.pricing_quotes q JOIN ${f.schema}.binding_fixture f ON f.quote_id=q.id;`), 't', 'Source must still be live when the lock wait is observed');
  await delay(8200); await a.send('COMMIT;'); checkResult(await pending, false);
  assert.equal(proposalCount(f), '0'); noDeadlock(a, b); a.close(); b.close();
  console.log('PASS real source expiry during observed lock wait rejects construction');
}
async function sharedIntentRace() {
  const first = fresh(), second = fresh();
  // Two independent needs share one offering intent, route, vehicle and availability.
  // This exposes SHARE-to-UPDATE upgrade errors that same-need races cannot find.
  target(`BEGIN; DO $$ DECLARE r jsonb; m uuid; g uuid; q uuid; o uuid; s uuid; BEGIN
    r:=${second.schema}.snapshot_match('${second.need}','${first.intent}','${first.route}',1);
    IF r->>'ok'<>'true' THEN RAISE EXCEPTION 'shared match fixture failed: %',r; END IF;
    m:=(r#>>'{rows,0,route_match_evidence_id}')::uuid;
    g:=${second.schema}.record_result(m);
    SELECT x.quote_id INTO q FROM public.record_pricing_quote_for_server(g,1,'trusted_server_result_infrastructure_v1',12345) x;
    PERFORM set_config('request.jwt.claim.sub','${first.offerer}',true);
    SET LOCAL ROLE authenticated;
    SELECT movement_offer_id INTO o FROM public.create_movement_offer('${second.need}',m,'${first.availability}',3,'Shared pickup','Shared dropoff',18);
    RESET ROLE;
    SELECT snapshot_id INTO s FROM public.record_movement_context_snapshot_for_server(o);
    UPDATE ${second.schema}.binding_fixture SET snapshot_id=s,quote_id=q;
  END $$; SET CONSTRAINTS ALL IMMEDIATE; COMMIT;`);
  refreshSources(second);
  assert.equal(second.intent, first.intent);
  assert.equal(second.availability, first.availability);
  const a = new Session(), b = new Session(); await a.begin(); await b.begin();
  await a.send(construct(first));
  const pending = outcome(b.send(construct(second))); await blocked(a, b); await a.send('COMMIT;');
  checkResult(await pending, true); await b.send('COMMIT;');
  assert.equal(target(`SELECT count(*) FROM private.financial_proposals WHERE movement_need_id IN ('${first.need}','${second.need}') AND offering_member_id='${first.offerer}';`), '2');
  assert.equal(target(`SELECT remaining_places FROM private.offering_movement_availability WHERE id='${first.availability}';`), '3');
  noDeadlock(a, b); a.close(); b.close();
  console.log('PASS shared intent/availability: actual contention, both constructors complete without upgrades or capacity consumption');
}
async function issuerReplayRace(rollback) {
  const f = fresh(), a = new Session(), b = new Session();
  await a.begin(); await b.begin();
  await a.send(construct(f));
  const pending = outcome(b.send(construct(f))); await blocked(a, b);
  await a.send(rollback ? 'ROLLBACK;' : 'COMMIT;');
  checkResult(await pending, true); await b.send('COMMIT;');
  assert.equal(proposalCount(f), '1');
  assert.equal(target(`SELECT version FROM private.financial_proposals WHERE movement_context_snapshot_id='${f.snapshot_id}';`), '1');
  target(`SELECT private.assert_financial_proposal_snapshot_roster(id) FROM private.financial_proposals WHERE movement_context_snapshot_id='${f.snapshot_id}';`);
  noDeadlock(a, b); a.close(); b.close();
  console.log('PASS identical issuer/version allocation race, rollback=' + rollback);
}
async function issuerNewVersionRace() {
  const f = fresh(), a = new Session(), b = new Session();
  await a.begin(); await b.begin(); await a.send(construct(f));
  // New trusted quote production must wait for the earlier issuance's need lock.
  const pending = outcome(b.send(`SELECT ${f.schema}.next_quote(); SELECT ${f.schema}.issue_id();`));
  await blocked(a, b); await a.send('COMMIT;'); checkResult(await pending, true); await b.send('COMMIT;');
  assert.equal(proposalCount(f), '2');
  assert.equal(target(`SELECT string_agg(version||':'||status,',' ORDER BY version) FROM private.financial_proposals WHERE movement_context_snapshot_id='${f.snapshot_id}';`), '1:superseded,2:current');
  noDeadlock(a, b); a.close(); b.close();
  // A later issuance rolls back its parent, roster and supersession together.
  const prior = target(`SELECT jsonb_agg(to_jsonb(p) ORDER BY version) FROM private.financial_proposals p WHERE movement_context_snapshot_id='${f.snapshot_id}';`);
  target(`BEGIN; SELECT ${f.schema}.next_quote(); SELECT ${f.schema}.issue_id(); ROLLBACK;`);
  assert.equal(target(`SELECT jsonb_agg(to_jsonb(p) ORDER BY version) FROM private.financial_proposals p WHERE movement_context_snapshot_id='${f.snapshot_id}';`), prior);
  target(`SELECT private.assert_financial_proposal_snapshot_roster(id) FROM private.financial_proposals WHERE movement_context_snapshot_id='${f.snapshot_id}';`);
  console.log('PASS different trusted issuance serialization, next version, and full rollback');
}
async function quoteSupersessionRace() {
  const f = fresh(), a = new Session(), b = new Session();
  await a.begin(); await b.begin();
  await a.send(`UPDATE private.pricing_quotes SET status='superseded' WHERE id='${f.quote_id}';`);
  const pending = outcome(b.send(construct(f))); await blocked(a, b); await a.send('COMMIT;');
  checkResult(await pending, false); assert.equal(proposalCount(f), '0');
  noDeadlock(a, b); a.close(); b.close();
  console.log('PASS quote supersession while issuer waits rejects stale quote');
}
async function main() {
  let before;
  const failures = [];
  try {
    assert.equal(query('postgres', "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='0074';"), '1', 'Apply 0074 only after separate authorization');
    before = query('postgres', snapshot);
    // Preserve ordinary ACLs. Only DEFAULT ACL archive entries are excluded:
    // postgres cannot change defaults belonging to the Supabase admin roles.
    command(['pg_dump', '-U', 'postgres', '-d', 'postgres', '--schema-only', '--no-owner', '--format=custom', '--file=' + archive,
      '--schema=public', '--schema=private', '--schema=auth', '--schema=extensions']);
    const toc = command(['pg_restore', '--list', archive]);
    command(['tee', restoreList], filterDefaultAcls(toc));
    query('postgres', `CREATE DATABASE ${database} TEMPLATE template0;`); created = true;
    target('DROP SCHEMA public;');
    assert(/^binding0074_race_[a-f0-9]{12}$/.test(database));
    command(['pg_restore', '-U', 'postgres', '--dbname=' + database, '--no-owner', '--exit-on-error', '--use-list=' + restoreList, archive]);
    for (const kind of ['constructor-first', 'superseder-first', 'constructor-rollback']) await snapshotRace(kind);
    await proposalSupersessionRace(true); await proposalSupersessionRace(false);
    await eligibilityRace('roster'); await eligibilityRace('acceptance');
    await constructorBeforeEligibility('roster'); await constructorBeforeEligibility('acceptance');
    await expiryDuringWait();
    await sharedIntentRace();
    await issuerReplayRace(false);
    await issuerReplayRace(true);
    await issuerNewVersionRace();
    await quoteSupersessionRace();
  } catch (error) {
    failures.push(error);
  } finally {
    try {
      for (const s of sessions) s.close();
      if (created) {
        assert(/^binding0074_race_[a-f0-9]{12}$/.test(database));
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
