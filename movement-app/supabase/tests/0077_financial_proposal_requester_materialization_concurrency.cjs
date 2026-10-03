'use strict';

// Explicit integration runner; never imported by portable node:test discovery.
// Requires separately authorized 0077 installation. All writes use a disposable
// schema-only clone, never the application database. No migration is applied here.
const cp = require('node:child_process');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { container, snapshot, command, query } = require('./0074_trusted_financial_proposal_issuer_behavior.cjs');
const { fixtures, sourceDefinitions } = require('./0077_financial_proposal_requester_materialization_behavior.cjs');
const database = 'materialize0077_race_' + crypto.randomBytes(6).toString('hex');
const archive = '/tmp/' + database + '.dump';
const restoreList = '/tmp/' + database + '.list';
const sessions = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let created = false;
let fixtureNumber = 0;
let sourceFingerprint;
const functionFingerprint = "SELECT md5(string_agg(pg_get_functiondef(p.oid), E'\\n' ORDER BY n.nspname,p.proname)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE (n.nspname='private' AND p.proname='assert_financial_proposal_materialization') OR (n.nspname='public' AND p.proname='accept_my_financial_proposal_as_requester');";

function filterDefaultAcls(toc) {
  // Match the archive type after its dump ID and catalog OIDs, not object names.
  // Ordinary ACL entries (including column ACLs) pass through unchanged.
  return toc.split('\n').filter(line => !/^\d+;\s+\d+\s+\d+\s+DEFAULT ACL\s/.test(line)).join('\n') + '\n';
}

function target(input) {
  assert(/^materialize0077_race_[a-f0-9]{12}$/.test(database));
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
    if (sourceFingerprint) {
      await this.send(functionFingerprint);
      assert(this.out.split('\n').includes(sourceFingerprint), 'Concurrent session sees corrected committed 0077 definitions');
    }
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
function fresh(expiring=false) {
  const schema='race0077_'+(++fixtureNumber);
  const sql=fixtures().replace('BEGIN;',`BEGIN; CREATE SCHEMA ${schema};`)
    .replaceAll('pg_temp.',schema+'.').replaceAll('CREATE TEMP TABLE','CREATE TABLE').replaceAll(' ON COMMIT DROP','');
  target(sql+' COMMIT;');
  if(expiring) target(`BEGIN; UPDATE private.financial_proposals SET status='superseded' WHERE id=(SELECT proposal FROM ${schema}.consent_fixture);
    SELECT ${schema}.bind_offer(${schema}.expiring_offer()); UPDATE ${schema}.consent_fixture SET proposal=${schema}.issue_id(); COMMIT;`);
  const f=refreshSources({schema});
  f.proposal=JSON.parse(target(`SELECT jsonb_build_object('id',p.id,'version',p.version) FROM private.financial_proposals p JOIN ${schema}.consent_fixture c ON c.proposal=p.id;`));
  target('BEGIN; '+offererConsent(f)+' COMMIT;');
  return f;
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

// REQUESTER_0077_SCENARIOS
function offererConsent(f) {
  return `SELECT set_config('request.jwt.claim.sub','${f.offerer}',true); SET LOCAL ROLE authenticated;
    SELECT * FROM public.accept_my_financial_proposal_as_offerer('${f.proposal.id}',${f.proposal.version},'${f.movement_offer}'); RESET ROLE;`;
}
function accept(f) {
  return `SELECT set_config('request.jwt.claim.sub','${f.requester}',true); SET LOCAL ROLE authenticated;
    SELECT * FROM public.accept_my_financial_proposal_as_requester('${f.proposal.id}',${f.proposal.version}); RESET ROLE;`;
}
function legacy(f) {
  return `SELECT set_config('request.jwt.claim.sub','${f.requester}',true); SET LOCAL ROLE authenticated;
    SELECT * FROM public.accept_movement_offer('${f.movement_offer}'); RESET ROLE;`;
}
function outcome(promise) { return promise.then(()=>({ok:true}),e=>({ok:false,error:e.message})); }
function check(result, succeeds) {
  assert.equal(result.ok,succeeds,JSON.stringify(result));
  if(!succeeds) assert.match(result.error,/23514/);
}
function state(f) { return JSON.parse(target(`SELECT to_jsonb(p) FROM private.financial_proposals p WHERE p.id='${f.proposal.id}';`)); }
function graphCounts(f, materialized) {
  const count=materialized?'1':'0';
  assert.equal(target(`SELECT count(*) FROM public.alignments WHERE movement_need_id='${f.need}';`),count);
  assert.equal(target(`SELECT count(*) FROM private.financial_agreements g JOIN public.alignments a ON a.id=g.alignment_id WHERE a.movement_need_id='${f.need}';`),count);
  assert.equal(target(`SELECT count(*) FROM private.financial_components c JOIN private.financial_agreements g ON g.id=c.agreement_id
    JOIN public.alignments a ON a.id=g.alignment_id WHERE a.movement_need_id='${f.need}';`),materialized?'3':'0');
  assert.equal(!!state(f).materialized_at,materialized);
  assert.equal(target(`SELECT count(*) FROM public.journeys j JOIN public.alignments a ON a.id=j.alignment_id WHERE a.movement_need_id='${f.need}';`),'0');
  assert.equal(target(`SELECT remaining_places FROM private.offering_movement_availability WHERE id='${f.availability}';`),materialized?'1':'3');
  if(materialized) {
    assert.equal(target(`SELECT status FROM public.movement_offers WHERE id='${f.movement_offer}';`),'accepted');
    assert.equal(target(`SELECT status FROM public.movement_needs WHERE id='${f.need}';`),'closed');
    target(`SELECT private.assert_financial_proposal_materialization(p) FROM private.financial_proposals p WHERE p.id='${f.proposal.id}';`);
  }
}
async function duplicateRace(rollback) {
  const f=fresh(),a=new Session(),b=new Session();await a.begin();await b.begin();await a.send(accept(f));
  const pending=outcome(b.send(accept(f)));await blocked(a,b);await a.send(rollback?'ROLLBACK;':'COMMIT;');check(await pending,true);await b.send('COMMIT;');
  const rows=[a,b].map(s=>s.out.split('\n').find(line=>line.startsWith(f.proposal.id+'|')));
  assert(rows.every(Boolean),'Both requester RPCs returned evidence');if(!rollback) assert.equal(rows[0],rows[1],'Duplicate returns exact graph/timestamps');
  graphCounts(f,true);noDeadlock(a,b);a.close();b.close();console.log('PASS duplicate requester materialization, rollback='+rollback+', real blocking');
}
async function supersessionRace() {
  const f=fresh(),a=new Session(),b=new Session();await a.begin();await b.begin();
  // Supported history mutation order: all strong dependencies then proposal.
  await a.send(`SELECT private.assert_movement_offer_availability_binding('${f.movement_offer}'); SELECT private.assert_pricing_quote('${f.quote_id}');
    SELECT private.assert_movement_context_snapshot('${f.snapshot_id}'); UPDATE private.financial_proposals SET status='superseded' WHERE id='${f.proposal.id}';`);
  const pending=outcome(b.send(accept(f)));await blocked(a,b);await a.send('COMMIT;');check(await pending,false);
  graphCounts(f,false);noDeadlock(a,b);a.close();b.close();console.log('PASS supersession wins, fresh requester validation rejects');
}
async function issuanceRace() {
  const f=fresh(),a=new Session(),b=new Session();await a.begin();await b.begin();await a.send(accept(f));
  const pending=outcome(b.send(`SELECT ${f.schema}.next_quote(); SELECT ${f.schema}.issue_id();`));await blocked(a,b);await a.send('COMMIT;');check(await pending,false);
  graphCounts(f,true);noDeadlock(a,b);a.close();b.close();console.log('PASS materialization vs new issuance cannot supersede graph');
}
async function invalidationRace(kind) {
  const f=fresh(),a=new Session(),b=new Session();await a.begin();await b.begin();
  const sql={
    withdrawal:`UPDATE public.movement_offers SET status='withdrawn' WHERE id='${f.movement_offer}';`,
    need:`UPDATE public.movement_needs SET status='paused' WHERE id='${f.need}';`,
    access:`UPDATE public.member_vehicle_access SET active=false WHERE vehicle_id='${f.vehicle}' AND member_id='${f.offerer}';`,
    capacity:`UPDATE public.vehicles SET seat_capacity=3 WHERE id='${f.vehicle}';`,
    roster:`SELECT id FROM public.movement_needs WHERE id='${f.need}' FOR UPDATE;
      UPDATE public.movement_participants SET status='invited' WHERE movement_need_id='${f.need}' AND role='invited_participant';`,
  }[kind];
  await a.send(sql);const pending=outcome(b.send(accept(f)));await blocked(a,b);await a.send('COMMIT;');check(await pending,false);
  graphCounts(f,false);noDeadlock(a,b);a.close();b.close();console.log('PASS '+kind+' wins, real blocking and no partial graph');
}
async function legacyRace() {
  const f=fresh(),a=new Session(),b=new Session();await a.begin();await b.begin();await a.send(accept(f));
  const pending=outcome(b.send(legacy(f)));await blocked(a,b);await a.send('COMMIT;');check(await pending,false);
  assert.match((await pending).error,/financial requester materialization/);graphCounts(f,true);
  noDeadlock(a,b);a.close();b.close();console.log('PASS legacy acceptance blocked then denied, no bypass');
}
async function offererReplayRace() {
  const f=fresh(),a=new Session(),b=new Session();await a.begin();await b.begin();await a.send(offererConsent(f));
  const pending=outcome(b.send(accept(f)));await blocked(a,b);await a.send('COMMIT;');check(await pending,true);await b.send('COMMIT;');
  graphCounts(f,true);noDeadlock(a,b);a.close();b.close();console.log('PASS offerer consent replay serializes requester acceptance');
}
async function committedReplayRace() {
  const f=fresh();target('BEGIN; '+accept(f)+' COMMIT;');const before=JSON.stringify(state(f));
  const a=new Session(),b=new Session();await a.begin();await b.begin();await a.send(accept(f));
  const pending=outcome(b.send(accept(f)));await blocked(a,b);await a.send('COMMIT;');check(await pending,true);await b.send('COMMIT;');
  assert.equal(JSON.stringify(state(f)),before);graphCounts(f,true);noDeadlock(a,b);a.close();b.close();console.log('PASS committed graph replay, zero reconstruction');
}
async function expiryRace() {
  const f=fresh(true),a=new Session(),b=new Session();await a.begin();await b.begin();
  await a.send(`SELECT id FROM public.movement_needs WHERE id='${f.need}' FOR UPDATE;`);
  const pending=outcome(b.send(accept(f)));await blocked(a,b);
  assert.equal(target(`SELECT expires_at>clock_timestamp() FROM private.financial_proposals WHERE id='${f.proposal.id}';`),'t');
  await delay(8200);await a.send('COMMIT;');check(await pending,false);graphCounts(f,false);
  noDeadlock(a,b);a.close();b.close();console.log('PASS natural proposal expiry during observed wait');
}
async function competingFinancialRace() {
  const first=fresh();
  // New genuine offer/context/quote and proposal for another offerer on SAME need.
  // Use the reviewed normal producer helper; change fixture bindings only.
  target(`BEGIN; DO $$ DECLARE o uuid; s uuid; m uuid; g uuid; q uuid; p uuid; r jsonb; BEGIN
    o:=${first.schema}.foreign_offer(true);
    SELECT offering_member_id INTO m FROM public.movement_offers WHERE id=o;
    SET CONSTRAINTS private.movement_context_snapshot_complete,private.movement_context_travellers_complete DEFERRED;
    SELECT snapshot_id INTO s FROM public.record_movement_context_snapshot_for_server(o);
    SET CONSTRAINTS private.movement_context_snapshot_complete,private.movement_context_travellers_complete IMMEDIATE;
    SELECT ${first.schema}.record_result(route_match_evidence_id) INTO g FROM private.movement_offer_route_match_bindings WHERE movement_offer_id=o;
    SELECT quote_id INTO q FROM public.record_pricing_quote_for_server(g,1,'trusted_server_result_infrastructure_v1',12345);
    SELECT proposal_id INTO p FROM public.issue_financial_proposal_for_server(q,1,s,1);
    r:=${first.schema}.snapshot_select_as('authenticated',m,format('SELECT * FROM public.accept_my_financial_proposal_as_offerer(%L,1,%L)',p,o));
    IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Competing consent fixture failed: %',r; END IF;
  END $$; COMMIT;`);
  const second={...first,proposal:JSON.parse(target(`SELECT jsonb_build_object('id',id,'version',version) FROM private.financial_proposals
    WHERE movement_need_id='${first.need}' AND id<>'${first.proposal.id}';`))};
  const a=new Session(),b=new Session();await a.begin();await b.begin();await a.send(accept(first));
  const pending=outcome(b.send(accept(second)));await blocked(a,b);await a.send('COMMIT;');check(await pending,false);
  graphCounts(first,true);assert.equal(state(second).materialized_at,null);noDeadlock(a,b);a.close();b.close();console.log('PASS competing financial proposals, one graph only');
}
async function activationLockOrderRace() {
  const f=fresh();target('BEGIN; '+accept(f)+' COMMIT;');
  const alignment=state(f).alignment_id,a=new Session(),b=new Session();await a.begin();await b.begin();
  // Exercise payment readiness/activation's actual lock order without making
  // downstream writes: alignment UPDATE -> need UPDATE -> offer SHARE.
  await a.send(`SELECT id FROM public.alignments WHERE id='${alignment}' FOR UPDATE;`);
  const pending=outcome(b.send(accept(f)));await blocked(a,b);
  await a.send(`SELECT id FROM public.movement_needs WHERE id='${f.need}' FOR UPDATE;
    SELECT id FROM public.movement_offers WHERE id='${f.movement_offer}' FOR SHARE; COMMIT;`);
  check(await pending,true);await b.send('COMMIT;');graphCounts(f,true);
  noDeadlock(a,b);a.close();b.close();console.log('PASS replay respects alignment-before-offer activation locks');
}
async function main() {
  let before;
  const failures = [];
  try {
    assert.equal(query('postgres', "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='0077';"), '1', '0077 local installation required; this runner never applies it');
    before = query('postgres', snapshot);
    // Preserve ordinary ACLs. Only DEFAULT ACL archive entries are excluded:
    // postgres cannot change defaults belonging to the Supabase admin roles.
    command(['pg_dump', '-U', 'postgres', '-d', 'postgres', '--schema-only', '--no-owner', '--format=custom', '--file=' + archive,
      '--schema=public', '--schema=private', '--schema=auth', '--schema=extensions']);
    const toc = command(['pg_restore', '--list', archive]);
    command(['tee', restoreList], filterDefaultAcls(toc));
    query('postgres', `CREATE DATABASE ${database} TEMPLATE template0;`); created = true;
    target('DROP SCHEMA public;');
    assert(/^materialize0077_race_[a-f0-9]{12}$/.test(database));
    command(['pg_restore', '-U', 'postgres', '--dbname=' + database, '--no-owner', '--exit-on-error', '--use-list=' + restoreList, archive]);
    if (process.argv.includes('--verify-source')) {
      // Committed ONLY in the disposable clone: every race connection sees it.
      // No application catalog/history changes, and cleanup drops this clone.
      target('BEGIN; '+sourceDefinitions()+' COMMIT;');
      assert(target("SELECT pg_get_functiondef('public.accept_my_financial_proposal_as_requester(uuid,integer)'::regprocedure);").includes('replay_need.id=p.movement_need_id'));
      sourceFingerprint=target(functionFingerprint);
      console.log('PASS corrected 0077 source committed in disposable clone');
    }
    await duplicateRace(false); await duplicateRace(true);
    await supersessionRace(); await issuanceRace();
    for(const kind of ['withdrawal','need','access','capacity','roster']) await invalidationRace(kind);
    await legacyRace(); await offererReplayRace();
    await committedReplayRace(); await expiryRace(); await competingFinancialRace(); await activationLockOrderRace();
    console.log('PASS 15 concurrency scenarios; actual blocking observed; no deadlock');
  } catch (error) {
    failures.push(error);
  } finally {
    try {
      for (const s of sessions) s.close();
      if (created) {
        assert(/^materialize0077_race_[a-f0-9]{12}$/.test(database));
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
