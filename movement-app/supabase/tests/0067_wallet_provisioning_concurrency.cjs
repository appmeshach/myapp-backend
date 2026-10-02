'use strict';
// Explicit local integration runner. Copies schema only; never application data.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const container = 'supabase_db_movement-app';
const database = 'wallet0067_race_' + crypto.randomBytes(6).toString('hex');
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
  assert(/^wallet0067_race_[a-f0-9]{12}$/.test(database));
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
    await this.send("SELECT 'PID='||pg_backend_pid(); BEGIN ISOLATION LEVEL READ COMMITTED; SET LOCAL lock_timeout='12s'; SET LOCAL statement_timeout='15s'; SET LOCAL idle_in_transaction_session_timeout='25s';");
    this.pid = Number(this.out.match(/PID=(\d+)/)[1]);
  }
  result() { return JSON.parse(this.out.match(/RESULT=(.*)/)?.[1] || 'null'); }
}
async function race(kind) {
  const member = crypto.randomUUID();
  target(`INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    VALUES ('${member}','authenticated','authenticated','${member}@wallet-test.invalid','{}','{}',now(),now());`);
  const a = new Session(), b = new Session();
  await a.begin(); await b.begin();
  const call = `SET LOCAL ROLE service_role; SELECT 'RESULT='||to_jsonb(r)::text FROM public.ensure_ngn_wallet_accounts_for_server('${member}') r; RESET ROLE;`;
  await a.send(call);
  const pending = b.send(call).then(() => ({ ok: true }), e => ({ ok: false, error: e.message }));
  let blocked = false;
  const end = Date.now() + 8000;
  while (Date.now() < end && !blocked) {
    blocked = target(`SELECT ${a.pid}=ANY(pg_blocking_pids(${b.pid}));`) === 't';
    if (!blocked) await delay(50);
  }
  assert(blocked, 'PostgreSQL must observe an actual member-lock wait');
  await a.send(kind === 'rollback' ? 'ROLLBACK;' : 'COMMIT;');
  const result = await pending;
  assert(result.ok, result.error);
  await b.send('SET CONSTRAINTS ALL IMMEDIATE; COMMIT;');
  if (kind === 'commit') assert.deepEqual(a.result(), b.result());
  else assert.notEqual(a.result().available_account_id, b.result().available_account_id);
  assert(!/deadlock|timeout|40P01|55P03|57014/.test(a.err + b.err));
  const facts = JSON.parse(target(`SELECT json_build_object('n',count(*),'kinds',count(DISTINCT account_kind),'active',bool_and(status='active'),'currency',bool_and(currency='NGN')) FROM private.wallet_accounts WHERE member_id='${member}';`));
  assert.deepEqual(facts, { n: 3, kinds: 3, active: true, currency: true });
  console.log(`PASS first writer ${kind}: real blocking, successful waiter, exactly three active accounts`);
  for (const s of [a,b]) if (!s.closed) s.child.stdin.end('\\q\n');
}
(async () => {
  try {
    assert.equal(sql('postgres', "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version IN ('0066','0067');"), '2', 'Migrate the local database through 0067 first');
    // Clone only schema from the normally migrated local DB. No user data.
    // Original ACLs are tested in the rollback-only behavioral harness.
    const schema = command(['pg_dump','-U','postgres','-d','postgres','--schema-only','--no-owner','--no-acl',
      '--schema=public','--schema=private','--schema=auth','--schema=extensions']);
    sql('postgres', `CREATE DATABASE ${database} TEMPLATE template0;`);
    created=true;
    target('DROP SCHEMA public;');
    target(schema);
    target('GRANT USAGE ON SCHEMA public TO service_role;');
    target(fs.readFileSync(path.join(__dirname,'../migrations/0067_wallet_provisioning_fail_closed.sql'),'utf8'));
    for (const kind of ['commit','rollback']) await race(kind);
  } finally {
    for (const s of sessions) if (!s.closed) s.child.stdin.end('ROLLBACK;\n\\q\n');
    if (created) {
      assert(/^wallet0067_race_[a-f0-9]{12}$/.test(database));
      sql('postgres', `DROP DATABASE ${database} WITH (FORCE);`);
      console.log('Disposable concurrency database removed');
    }
  }
})().catch(e=>{console.error(e.message);process.exitCode=1;});
