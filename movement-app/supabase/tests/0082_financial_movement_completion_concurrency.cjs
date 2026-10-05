'use strict';

// Explicit integration runner; never imported by portable node:test discovery.
// Tests installed 0082 in a schema-only clone, or loads source in that clone
// before installation. Never replaces application definitions or migration history.
const cp = require('node:child_process');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { container, snapshot, command, query } = require('./0074_trusted_financial_proposal_issuer_behavior.cjs');
const { inspect, verify, sourceBody, captureTemporalAcls } = require('./0082_financial_movement_completion_harness.cjs');
const { fixtures, migrationBody } = require('./0082_financial_movement_completion_behavior.cjs');
const { constraints } = require('./0082_financial_movement_completion_constraint_mode_probe.cjs');
const database = 'start0082_race_' + crypto.randomBytes(6).toString('hex');
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
  assert(/^start0082_race_[a-f0-9]{12}$/.test(database));
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


// COMPLETION_SCENARIOS
let scenarioCount=0,blockingCount=0;
function as(f,member,sql){return `SELECT set_config('request.jwt.claim.sub','${member}',true); SET LOCAL ROLE authenticated; ${sql} RESET ROLE;`;}
function request(f,actor=f.offerer){return as(f,actor,`SELECT * FROM public.request_my_funded_movement_completion('${f.need}');`);}
function confirm(f,actor=f.requester){return as(f,actor,`SELECT * FROM public.confirm_my_funded_movement_completion('${f.need}');`);}
function fresh(){
 const schema='completion_fixture_'+(++fixtureNumber);
 target(fixtures().replace('BEGIN;',"BEGIN; SELECT set_config('movement.fixture_scenario','"+schema+"',true); CREATE SCHEMA "+schema+';').replaceAll('pg_temp.',schema+'.').replaceAll('CREATE TEMP TABLE','CREATE TABLE').replaceAll(' ON COMMIT DROP','')+' COMMIT;');
 target(`BEGIN; SELECT ${schema}.prepare_completion(); COMMIT;`);
 const f=JSON.parse(target(`SELECT jsonb_build_object('schema','${schema}','agreement',g.id,'alignment',g.alignment_id,'need',a.movement_need_id,'requester',g.member_needing_movement_id,'offerer',g.offering_member_id,'offer',a.movement_offer_id,'journey',(SELECT id FROM public.journeys WHERE alignment_id=a.id)) FROM private.financial_agreements g JOIN ${schema}.funding_fixture b ON b.agreement=g.id JOIN public.alignments a ON a.id=g.alignment_id;`));
 f.before=balances(f);f.other=target(`SELECT ${schema}.completion_other_sources();`);return f;
}
function requested(f){target('BEGIN; '+request(f)+' COMMIT;');return f;}
function balances(f){return JSON.parse(target(`SELECT jsonb_build_object('held',coalesce((SELECT sum(CASE WHEN p.direction='credit' THEN p.amount_minor::numeric ELSE -p.amount_minor::numeric END) FROM private.wallet_postings p JOIN private.wallet_accounts w ON w.id=p.account_id WHERE w.member_id='${f.requester}' AND w.account_kind='member_held'),0),'withdrawable',coalesce((SELECT sum(CASE WHEN p.direction='credit' THEN p.amount_minor::numeric ELSE -p.amount_minor::numeric END) FROM private.wallet_postings p JOIN private.wallet_accounts w ON w.id=p.account_id WHERE w.member_id='${f.offerer}' AND w.account_kind='member_withdrawable'),0),'revenue',coalesce((SELECT sum(CASE WHEN p.direction='credit' THEN p.amount_minor::numeric ELSE -p.amount_minor::numeric END) FROM private.wallet_postings p JOIN private.wallet_accounts w ON w.id=p.account_id WHERE w.member_id IS NULL AND w.account_kind='platform_revenue' AND w.currency='NGN'),0));`));}
function facts(f,completed){
 const x=JSON.parse(target(`SELECT jsonb_build_object('requests',(SELECT count(*) FROM private.funded_movement_completion_requests WHERE alignment_id='${f.alignment}'),'completions',(SELECT count(*) FROM private.funded_movement_completions WHERE alignment_id='${f.alignment}'),'journeys',(SELECT count(*) FROM public.journeys WHERE alignment_id='${f.alignment}'),'journey',(SELECT status FROM public.journeys WHERE id='${f.journey}'),'alignment',(SELECT status FROM public.alignments WHERE id='${f.alignment}'),'legacy',(SELECT count(*) FROM private.movement_settlements WHERE alignment_id='${f.alignment}'),'payments',(SELECT count(*) FROM private.alignment_activation_payments WHERE alignment_id='${f.alignment}'));`));
 assert.deepEqual(x,{requests:1,completions:completed?1:0,journeys:1,journey:completed?'completed':'in_progress',alignment:completed?'completed':'in_progress',legacy:0,payments:0});
 target(`BEGIN; SELECT private.assert_funded_coordination_entry('${f.alignment}'); COMMIT;`);
 const amounts=JSON.parse(target(`SELECT jsonb_object_agg(component_key,amount_minor) FROM private.financial_components WHERE agreement_id='${f.agreement}';`));
 const b=balances(f);assert.deepEqual(b,completed?{held:f.before.held-amounts.requester_platform_share-amounts.movement_contribution,withdrawable:f.before.withdrawable+amounts.movement_contribution-amounts.offering_platform_share,revenue:f.before.revenue+amounts.requester_platform_share+amounts.offering_platform_share}:f.before);
 if(f.superseded)assert.equal(target(`SELECT status FROM private.financial_agreements WHERE id='${f.agreement}';`),'superseded');
 if(f.touchedOffer)assert.equal(target(`SELECT updated_at='${f.offerTimestamp}'::timestamptz FROM public.movement_offers WHERE id='${f.offer}';`),'t');
 assert.equal(target(`SELECT ${f.schema}.completion_other_sources(${f.superseded?"'"+f.agreement+"'::uuid":'NULL'},${f.touchedOffer?"'"+f.offer+"'::uuid":'NULL'});`),f.other);
 const before=target(`SELECT ${f.schema}.materialization_sources();`);
 target('BEGIN; '+request(f)+(completed?confirm(f):'')+as(f,f.requester,`SELECT * FROM public.confirm_my_funded_movement_start('${f.need}');`)+' COMMIT;');
 assert.equal(target(`SELECT ${f.schema}.materialization_sources();`),before,'Replay all-table zero writes');
}
function outcome(p){return p.then(()=>({ok:true}),e=>({ok:false,error:e.message}));}
function check(r,ok,state){assert.equal(r.ok,ok,JSON.stringify(r));if(!ok)assert.match(r.error,new RegExp(state));}
function finish(ss,f,name,completed){noDeadlock(...ss);for(const s of ss)s.close();facts(f,completed);scenarioCount++;console.log('PASS '+name+'; exact graph and settlement');}
async function duplicateRace(kind,rollback=false){
 const f=kind==='confirm'?requested(fresh()):fresh(),a=new Session(),b=new Session();await a.begin();await b.begin();const action=kind==='confirm'?confirm:request;
 const mode=rollback?'IMMEDIATE':'DEFERRED';
 if(kind==='confirm')for(const s of [a,b])await s.send('SET CONSTRAINTS '+constraints.join(',')+' '+mode+';');
 await a.send(action(f));
 if(kind==='confirm'&&!rollback){
  // A real normal producer after confirmation in this same transaction. Its
  // isolated savepoint rolls back only the top-up so settlement facts stay exact.
  await a.send(`SAVEPOINT after_completion; SELECT public.record_wallet_top_up_for_server('${f.offerer}',1,'NGN','test-0082','same-transaction-${f.journey}'); ROLLBACK TO after_completion; RELEASE after_completion;`);
 }
 const p=outcome(b.send(action(f)));await blocked(a,b);await a.send(rollback?'ROLLBACK;':'COMMIT;');check(await p,true);await b.send('COMMIT;');finish([a,b],f,'duplicate '+kind+' rollback='+rollback+(kind==='confirm'?' caller_mode='+mode+(!rollback?' same-transaction topup':''):''),kind==='confirm');
}
async function prematureRace(){
 const f=fresh(),a=new Session(),b=new Session();await a.begin();await b.begin();check(await outcome(a.send(confirm(f))),false,'23514');await b.send(request(f));await b.send('COMMIT;');finish([a,b],f,'premature requester confirmation',false);
}
async function wrongRace(confirming){
 const f=confirming?requested(fresh()):fresh(),a=new Session(),b=new Session();await a.begin();await b.begin();const action=confirming?confirm:request;
 await a.send(action(f));const p=outcome(b.send(action(f,confirming?f.offerer:f.requester)));await blocked(a,b);await a.send('COMMIT;');check(await p,false,'42501');finish([a,b],f,'wrong principal confirming='+confirming,confirming);
}
async function mutationRace(kind){
 const f=kind==='requestJourney'?fresh():requested(fresh()),a=new Session(),b=new Session();await a.begin();await b.begin();await a.send(kind==='requestJourney'?request(f):confirm(f));
 const sql={requestJourney:`UPDATE public.journeys SET completion_requested_at=clock_timestamp() WHERE id='${f.journey}';`,journey:`UPDATE public.journeys SET completed_at=clock_timestamp() WHERE id='${f.journey}';`,alignment:`UPDATE public.alignments SET status='cancelled' WHERE id='${f.alignment}';`,agreement:`UPDATE private.financial_agreements SET status='superseded' WHERE id='${f.agreement}'; SET CONSTRAINTS ALL IMMEDIATE;`,requesterTopUp:`SELECT public.record_wallet_top_up_for_server('${f.requester}',1,'NGN','test-0082','requester-${f.journey}');`,offererTopUp:`SELECT public.record_wallet_top_up_for_server('${f.offerer}',1,'NGN','test-0082','offerer-${f.journey}');`,provision:`SELECT public.ensure_ngn_wallet_accounts_for_server('${f.offerer}');`,recovery:as(f,f.requester,'SELECT * FROM public.list_my_active_movement_continuations();'),legacy:`SELECT public.confirm_journey_completion('${f.journey}');`,startReplay:as(f,f.requester,`SELECT * FROM public.confirm_my_funded_movement_start('${f.need}');`)}[kind];
 const p=outcome(b.send(sql));
 // Legacy guards reject financial movement before taking operational locks.
 if(kind!=='legacy')await blocked(a,b);
 await a.send('COMMIT;');check(await p,!['requestJourney','journey','alignment','legacy'].includes(kind),'23514');
 if(!['requestJourney','journey','alignment','legacy'].includes(kind))await b.send('COMMIT;');
 f.superseded=kind==='agreement';finish([a,b],f,'completion vs '+kind,kind!=='requestJourney');
}
async function queuedRace(){
 const f=requested(fresh()),wallet=new Session(),completion=new Session(),replay=new Session(),agreement=new Session();for(const s of [wallet,completion,replay,agreement])await s.begin();
 await wallet.send(`SELECT id FROM public.members WHERE id='${f.requester}' FOR UPDATE;`);
 const cp=outcome(completion.send(confirm(f)));await blocked(wallet,completion);
 const rp=outcome(replay.send(as(f,f.requester,`SELECT * FROM public.confirm_my_funded_movement_start('${f.need}');`)));await blocked(completion,replay);
 const gp=outcome(agreement.send(`UPDATE private.financial_agreements SET status='superseded' WHERE id='${f.agreement}'; SET CONSTRAINTS ALL IMMEDIATE;`));await blocked(completion,agreement);
 await wallet.send('COMMIT;');check(await cp,true);await completion.send('COMMIT;');check(await rp,true);await replay.send('COMMIT;');check(await gp,true);await agreement.send('COMMIT;');f.superseded=true;finish([wallet,completion,replay,agreement],f,'queued member/completion/start replay/agreement no deadlock',true);
}
async function sourceFirstRace(kind){
 const f=requested(fresh()),a=new Session(),b=new Session();await a.begin();await b.begin();
 const sql={requesterTopUp:`SELECT public.record_wallet_top_up_for_server('${f.requester}',1,'NGN','test-0082','first-requester-${f.journey}');`,offererTopUp:`SELECT public.record_wallet_top_up_for_server('${f.offerer}',1,'NGN','test-0082','first-offerer-${f.journey}');`,provision:`SELECT public.ensure_ngn_wallet_accounts_for_server('${f.offerer}');`,agreement:`UPDATE private.financial_agreements SET status='superseded' WHERE id='${f.agreement}'; SET CONSTRAINTS ALL IMMEDIATE;`,startReplay:as(f,f.requester,`SELECT * FROM public.confirm_my_funded_movement_start('${f.need}');`),recovery:as(f,f.requester,'SELECT * FROM public.list_my_active_movement_continuations();')}[kind];
 await a.send(sql);const p=outcome(b.send(confirm(f)));await blocked(a,b);const boundary=target('SELECT clock_timestamp();');await a.send('COMMIT;');check(await p,true);await b.send('COMMIT;');
 assert.equal(target(`SELECT completed_at>='${boundary}'::timestamptz FROM private.funded_movement_completions WHERE alignment_id='${f.alignment}';`),'t','Completion instant follows all source lock waits');
 f.superseded=kind==='agreement';finish([a,b],f,'source first '+kind+'; completion clock after wait',true);
}
async function offerRevealRace(){
 const f=requested(fresh()),offer=new Session(),reveal=new Session(),completion=new Session(),agreement=new Session();for(const s of [offer,reveal,completion,agreement])await s.begin();
 f.other=target(`SELECT ${f.schema}.completion_other_sources(NULL,'${f.offer}');`);f.touchedOffer=true;
 await offer.send(`UPDATE public.movement_offers SET updated_at=updated_at WHERE id='${f.offer}'; SELECT 'OFFER_TIME='||updated_at FROM public.movement_offers WHERE id='${f.offer}';`);
 f.offerTimestamp=offer.out.match(/OFFER_TIME=([^\r\n]+)/)[1];
 // Vehicle reveal shares the real historical authorization/offer locks without
 // the people RPC's unrelated, intentional profile-photo token issuance.
 const rp=outcome(reveal.send(as(f,f.requester,`SELECT * FROM public.get_post_activation_vehicle('${f.need}');`)));await blocked(offer,reveal);
 const cp=outcome(completion.send(confirm(f)));await blocked(reveal,completion);
 const gp=outcome(agreement.send(`UPDATE private.financial_agreements SET status='superseded' WHERE id='${f.agreement}'; SET CONSTRAINTS ALL IMMEDIATE;`));await blocked(completion,agreement);
 await offer.send('COMMIT;');check(await rp,true);await reveal.send('COMMIT;');check(await cp,true);await completion.send('COMMIT;');check(await gp,true);await agreement.send('COMMIT;');
 f.superseded=true;finish([offer,reveal,completion,agreement],f,'queued offer/reveal/completion/agreement no deadlock',true);
}
async function main() {
  let before;
  const failures = [];
  try {
    assert.equal(query('postgres', "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='0081';"), '1', '0081 local installation required; this runner never applies it');
    const mode = inspect(query);
    console.log('0082 concurrency mode: '+mode+'; installed definitions checked against source');
    before = query('postgres', snapshot);
    // Preserve ordinary ACLs. Only DEFAULT ACL archive entries are excluded:
    // postgres cannot change defaults belonging to the Supabase admin roles.
    command(['pg_dump', '-U', 'postgres', '-d', 'postgres', '--schema-only', '--no-owner', '--format=custom', '--file=' + archive,
      '--schema=public', '--schema=private', '--schema=auth', '--schema=extensions']);
    const toc = command(['pg_restore', '--list', archive]);
    command(['tee', restoreList], filterDefaultAcls(toc));
    query('postgres', `CREATE DATABASE ${database} TEMPLATE template0;`); created = true;
    target('DROP SCHEMA public;');
    assert(/^start0082_race_[a-f0-9]{12}$/.test(database));
    command(['pg_restore', '-U', 'postgres', '--dbname=' + database, '--no-owner', '--exit-on-error', '--use-list=' + restoreList, archive]);
    const temporalAcls=mode==='source'?captureTemporalAcls(query,database):undefined;
    if (mode === 'source') target('BEGIN; '+sourceBody(query)+' COMMIT;');
    if(mode==='installed')verify(query, database);
    else verify(query,database,temporalAcls); // All sessions use the verified committed clone definitions.
    await duplicateRace('request');await duplicateRace('request',true);
    await duplicateRace('confirm');await duplicateRace('confirm',true);
    await prematureRace();await wrongRace(false);await wrongRace(true);
    await mutationRace('requestJourney');
    for(const kind of ['journey','alignment','agreement','requesterTopUp','offererTopUp','provision','recovery','legacy','startReplay'])await mutationRace(kind);
    await queuedRace();
    for(const kind of ['requesterTopUp','offererTopUp','provision','agreement','startReplay','recovery'])await sourceFirstRace(kind);
    await offerRevealRace();
    assert.equal(scenarioCount,25);console.log('PASS '+scenarioCount+' financial completion scenarios; '+blockingCount+' actual blocking proofs; no deadlock');
  } catch (error) {
    failures.push(error);
  } finally {
    try {
      for (const s of sessions) s.close();
      if (created) {
        assert(/^start0082_race_[a-f0-9]{12}$/.test(database));
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
if (require.main === module) {
 if(process.argv.includes('--runs=3')){
  // Each child creates and cleans an independent fresh disposable clone. Stop
  // on the first failure; never retry a failed run.
  for(let run=1;run<=3;run++){
   console.log('0082 CONCURRENCY RUN '+run+'/3');
   const result=cp.spawnSync(process.execPath,[__filename],{stdio:'inherit',windowsHide:true});
   if(result.error||result.status!==0){console.error(result.error||'Concurrency run '+run+' failed');process.exitCode=1;break;}
  }
 }else main().catch(e => { console.error(e.stack); process.exitCode = 1; });
}
