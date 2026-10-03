'use strict';

// Explicit integration runner; never imported by portable node:test discovery.
// Tests installed 0079 in a schema-only clone, or loads source in that clone
// before installation. Never replaces application definitions or migration history.
const cp = require('node:child_process');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { container, snapshot, command, query } = require('./0074_trusted_financial_proposal_issuer_behavior.cjs');
const { inspect, verify } = require('./0079_funded_movement_activation_harness.cjs');
const { fixtures: precutoverFixtures } = require('./0078_requester_movement_funding_hold_behavior.cjs');
const { fixtures, migrationBody } = require('./0079_funded_movement_activation_behavior.cjs');
const database = 'activation0079_race_' + crypto.randomBytes(6).toString('hex');
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
  assert(/^activation0079_race_[a-f0-9]{12}$/.test(database));
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

// ACTIVATION_0079_SCENARIOS
function fresh(funded=true) {
 const schema='activation_fixture_'+(++fixtureNumber);
 const setup=fixtures().replace('BEGIN;', 'BEGIN; CREATE SCHEMA '+schema+';').replaceAll('pg_temp.',schema+'.').replaceAll('CREATE TEMP TABLE','CREATE TABLE').replaceAll(' ON COMMIT DROP','');
 target(setup+' COMMIT;');
 const f=JSON.parse(target(`SELECT jsonb_build_object('schema','${schema}','agreement',g.id,'version',g.version,'alignment',g.alignment_id,'requester',g.member_needing_movement_id,'offerer',g.offering_member_id,'need',a.movement_need_id,'required',(SELECT sum(amount_minor::numeric) FROM private.financial_components WHERE agreement_id=g.id AND component_key IN ('requester_platform_share','movement_contribution'))) FROM private.financial_agreements g JOIN ${schema}.funding_fixture b ON b.agreement=g.id JOIN public.alignments a ON a.id=g.alignment_id;`));
 target('BEGIN; SET CONSTRAINTS private.wallet_transaction_balanced_after_transaction,private.wallet_transaction_balanced_after_posting DEFERRED; '+topUp(f)+' SELECT '+schema+'.prepare_activation_faces(); COMMIT;');
 if(funded)target('BEGIN; '+hold(f)+' COMMIT;');return f;
}
function asRequester(f,sql){return `SELECT set_config('request.jwt.claim.sub','${f.requester}',true); SET LOCAL ROLE authenticated; ${sql} RESET ROLE;`;}
function activate(f){return asRequester(f,`SELECT * FROM public.activate_my_funded_movement('${f.agreement}',${f.version});`);}
function hold(f){return asRequester(f,`SELECT * FROM public.hold_my_movement_funds('${f.agreement}',${f.version});`);}
function topUp(f){return `SET LOCAL ROLE service_role; SELECT public.record_wallet_top_up_for_server('${f.requester}',${f.required+100},'NGN','test-0079','race-'||gen_random_uuid()); RESET ROLE;`;}
function outcome(p){return p.then(()=>({ok:true}),e=>({ok:false,error:e.message}));}
function check(r,ok,state){assert.equal(r.ok,ok,JSON.stringify(r));if(!ok)assert.match(r.error,new RegExp(state));}
function facts(f,activated,funded=true,payments=0){
 const x=JSON.parse(target(`SELECT jsonb_build_object('activations',(SELECT count(*) FROM private.funded_movement_activations WHERE financial_agreement_id='${f.agreement}'),'faces',(SELECT count(*) FROM private.funded_movement_activation_faces WHERE financial_agreement_id='${f.agreement}'),'journeys',(SELECT count(*) FROM public.journeys WHERE alignment_id='${f.alignment}'),'payments',(SELECT count(*) FROM private.alignment_activation_payments WHERE alignment_id='${f.alignment}'),'settlements',(SELECT count(*) FROM private.movement_settlements WHERE alignment_id='${f.alignment}'),'holds',(SELECT count(*) FROM private.wallet_transactions t JOIN private.financial_components c ON c.id=t.financial_component_id WHERE c.agreement_id='${f.agreement}' AND t.transaction_kind='movement_hold'),'components',(SELECT count(*) FROM private.financial_components WHERE agreement_id='${f.agreement}'),'held',(SELECT coalesce(sum(CASE WHEN p.direction='credit' THEN p.amount_minor::numeric ELSE -p.amount_minor::numeric END),0) FROM private.wallet_postings p JOIN private.wallet_accounts a ON a.id=p.account_id WHERE a.member_id='${f.requester}' AND a.account_kind='member_held'));`));
 assert.deepEqual(x,{activations:activated?1:0,faces:activated?3:0,journeys:0,payments,settlements:0,holds:funded?2:0,components:3,held:funded?f.required:0});
 if(activated){const before=target(`SELECT row_to_json(r) FROM private.funded_movement_activations r WHERE financial_agreement_id='${f.agreement}';`);target('BEGIN; '+activate(f)+' COMMIT;');assert.equal(target(`SELECT row_to_json(r) FROM private.funded_movement_activations r WHERE financial_agreement_id='${f.agreement}';`),before);}
}
function finish(a,b,name){noDeadlock(a,b);a.close();b.close();console.log('PASS '+name+', actual blocking; exact activation/funding graph');}
async function duplicateRace(rollback){const f=fresh(),a=new Session(),b=new Session();await a.begin();await b.begin();await a.send(activate(f));const pending=outcome(b.send(activate(f)));await blocked(a,b);await a.send(rollback?'ROLLBACK;':'COMMIT;');check(await pending,true);await b.send('COMMIT;');const rows=[a,b].map(x=>x.out.split('\n').find(line=>line.startsWith(f.agreement+'|')));if(!rollback)assert.equal(rows[0],rows[1]);facts(f,true);finish(a,b,'duplicate rollback='+rollback);}
async function fundingRace(rollback){const f=fresh(false),a=new Session(),b=new Session();await a.begin();await b.begin();await a.send(hold(f));const pending=outcome(b.send(activate(f)));await blocked(a,b);await a.send(rollback?'ROLLBACK;':'COMMIT;');check(await pending,!rollback,'23514');if(!rollback)await b.send('COMMIT;');facts(f,!rollback,!rollback);finish(a,b,'activation vs first funding rollback='+rollback);}
async function fundingReplayRace(){const f=fresh(),a=new Session(),b=new Session();await a.begin();await b.begin();await a.send(activate(f));const pending=outcome(b.send(hold(f)));await blocked(a,b);await a.send('COMMIT;');check(await pending,true);await b.send('COMMIT;');facts(f,true);finish(a,b,'activation vs hold replay');}
async function mutationRace(kind,activationFirst){
 const f=fresh(),a=new Session(),b=new Session();await a.begin();await b.begin();
 const mutation=kind==='face'?`SELECT public.start_alignment_face_verification_for_server('${f.alignment}','${f.requester}','race-0079',gen_random_uuid()::text);`:kind==='photo'?`SELECT public.revoke_current_profile_photo_for_server('${f.requester}');`:`UPDATE private.financial_agreements SET status='superseded' WHERE id='${f.agreement}';`;
 await a.send(activationFirst?activate(f):mutation);const pending=outcome(b.send(activationFirst?mutation:activate(f)));await blocked(a,b);await a.send('COMMIT;');
 const ok=activationFirst&&kind!=='face';check(await pending,ok,kind==='agreement'?'23514':'P0001');if(ok)await b.send('COMMIT;');facts(f,activationFirst);finish(a,b,kind+' vs activation activationFirst='+activationFirst);
}
async function projectionRace(){const f=fresh(),a=new Session(),b=new Session();await a.begin();await b.begin();await a.send(activate(f));const pending=outcome(b.send(asRequester(f,`SELECT * FROM public.get_my_movement_activation_status('${f.agreement}',${f.version});`)));await blocked(a,b);await a.send('COMMIT;');check(await pending,true);await b.send('COMMIT;');assert(b.out.includes('|activated|activated|'));facts(f,true);finish(a,b,'projection waits across activation commit');}
async function legacyAndStartRace(){
 const f=fresh(),a=new Session(),b=new Session();await a.begin();await b.begin();await a.send(activate(f));
 // These paths fail BEFORE lock acquisition: no payment authority and no journey.
 const r=await outcome(b.send(`SET LOCAL ROLE service_role; SELECT public.create_alignment_activation_payment('${f.alignment}',1,'NGN','arbitrary-provider');`));check(r,false,'23514');
 const c=new Session();await c.begin();const start=await outcome(c.send(`SELECT set_config('request.jwt.claim.sub','${f.offerer}',true); SET LOCAL ROLE authenticated; SELECT * FROM public.request_my_movement_start('${f.need}');`));check(start,false,'42501');
 await a.send('COMMIT;');facts(f,true);noDeadlock(a,b,c);a.close();b.close();c.close();console.log('PASS legacy payment and start attempts fail closed concurrently before locks');
}
function legacyPendingSeed(){
 const schema='activation_legacy_seed';
 const setup=precutoverFixtures().replace('BEGIN;','BEGIN; CREATE SCHEMA '+schema+';').replaceAll('pg_temp.',schema+'.').replaceAll('CREATE TEMP TABLE','CREATE TABLE').replaceAll(' ON COMMIT DROP','');
 target(setup+' COMMIT;');
 const f=JSON.parse(target(`SELECT jsonb_build_object('schema','${schema}','agreement',g.id,'version',g.version,'alignment',g.alignment_id,'requester',g.member_needing_movement_id,'offerer',g.offering_member_id,'required',(SELECT sum(amount_minor::numeric) FROM private.financial_components WHERE agreement_id=g.id AND component_key IN ('requester_platform_share','movement_contribution'))) FROM private.financial_agreements g JOIN ${schema}.funding_fixture b ON b.agreement=g.id;`));
 f.payment=target('BEGIN; SELECT '+schema+'.prepare_funding_activation(); COMMIT;');
 target('BEGIN; SET CONSTRAINTS private.wallet_transaction_balanced_after_transaction,private.wallet_transaction_balanced_after_posting DEFERRED; '+topUp(f)+hold(f)+' COMMIT;');return f;
}
async function legacySuccessRace(f){
 const a=new Session(),b=new Session();await a.begin();await b.begin();await a.send(activate(f));
 const r=await outcome(b.send(`SET LOCAL ROLE service_role; SELECT * FROM public.mark_alignment_activation_payment_succeeded('${f.payment}','arbitrary-provider-reference');`));check(r,false,'23514');
 await a.send('COMMIT;');assert.equal(target(`SELECT status||'|'||coalesce(provider_reference,'NULL') FROM private.alignment_activation_payments WHERE id='${f.payment}';`),'pending|NULL');
 facts(f,true,true,1);noDeadlock(a,b);a.close();b.close();console.log('PASS funded activation vs genuine pre-cutover pending payment success; service call rejects before locks; payment unchanged');
}
async function expiryWaitRace(){
 const f=fresh(),a=new Session(),b=new Session();await a.begin();await b.begin();
 await a.send(`SELECT id FROM public.members WHERE id='${f.requester}' FOR UPDATE; UPDATE private.alignment_face_verifications SET expires_at=clock_timestamp()+interval '300 milliseconds' WHERE alignment_id='${f.alignment}';`);
 const pending=outcome(b.send(activate(f)));await blocked(a,b);await delay(400);await a.send('COMMIT;');check(await pending,false,'P0001');facts(f,false);finish(a,b,'face expiry while activation waits uses fresh post-lock clock');
}

async function main() {
  let before;
  const failures = [];
  try {
    assert.equal(query('postgres', "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='0078';"), '1', '0078 local installation required; this runner never applies it');
    const mode = inspect(query);
    console.log('0079 concurrency mode: '+mode+'; installed definitions checked against source');
    before = query('postgres', snapshot);
    // Preserve ordinary ACLs. Only DEFAULT ACL archive entries are excluded:
    // postgres cannot change defaults belonging to the Supabase admin roles.
    command(['pg_dump', '-U', 'postgres', '-d', 'postgres', '--schema-only', '--no-owner', '--format=custom', '--file=' + archive,
      '--schema=public', '--schema=private', '--schema=auth', '--schema=extensions']);
    const toc = command(['pg_restore', '--list', archive]);
    command(['tee', restoreList], filterDefaultAcls(toc));
    query('postgres', `CREATE DATABASE ${database} TEMPLATE template0;`); created = true;
    target('DROP SCHEMA public;');
    assert(/^activation0079_race_[a-f0-9]{12}$/.test(database));
    command(['pg_restore', '-U', 'postgres', '--dbname=' + database, '--no-owner', '--exit-on-error', '--use-list=' + restoreList, archive]);
    const legacy = mode === 'source' ? legacyPendingSeed() : null;
    if (mode === 'source') target('BEGIN; '+migrationBody+' COMMIT;');
    verify(query, database); // All sessions use the verified committed clone definitions.
    await duplicateRace(false); await duplicateRace(true);
    await fundingRace(false); await fundingRace(true); await fundingReplayRace();
    for(const kind of ['face','photo','agreement']) {await mutationRace(kind,false);await mutationRace(kind,true);}
    await projectionRace();await expiryWaitRace();await legacyAndStartRace();
    if (legacy) await legacySuccessRace(legacy);
    console.log('PASS '+(legacy?15:14)+' funded activation concurrency scenarios; 13 actual blocking proofs; no deadlock');
  } catch (error) {
    failures.push(error);
  } finally {
    try {
      for (const s of sessions) s.close();
      if (created) {
        assert(/^activation0079_race_[a-f0-9]{12}$/.test(database));
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
