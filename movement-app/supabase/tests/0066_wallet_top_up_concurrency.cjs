'use strict';
// Explicit local integration runner. Copies schema only; never application data.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const container = 'supabase_db_movement-app';
const database = 'wallet0066_race_' + crypto.randomBytes(6).toString('hex');
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
  assert(/^wallet0066_race_[a-f0-9]{12}$/.test(database));
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
  result() { return this.out.match(/RESULT=([a-f0-9-]{36})/)?.[1]; }
}
async function race(kind) {
  const member = crypto.randomUUID();
  const event = crypto.randomUUID();
  target(`INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    VALUES ('${member}','authenticated','authenticated','${member}@wallet-test.invalid','{}','{}',now(),now());`);
  const a = new Session(), b = new Session();
  await a.begin(); await b.begin();
  const call = amount => `SET LOCAL ROLE service_role; SELECT 'RESULT='||public.record_wallet_top_up_for_server('${member}',${amount},'NGN','race-test','${event}'); RESET ROLE;`;
  await a.send(call(100));
  const pending = b.send(call(kind === 'mismatch' ? 101 : 100)).then(() => ({ ok: true }), e => ({ ok: false, error: e.message }));
  let blocked = false;
  const end = Date.now() + 8000;
  while (Date.now() < end && !blocked) {
    blocked = target(`SELECT ${a.pid}=ANY(pg_blocking_pids(${b.pid}));`) === 't';
    if (!blocked) await delay(50);
  }
  assert(blocked, kind + ': PostgreSQL must observe an actual lock wait');
  await a.send(kind === 'rollback' ? 'ROLLBACK;' : 'COMMIT;');
  const result = await pending;
  if (kind === 'mismatch') {
    assert(!result.ok && /23514/.test(result.error), 'mismatch must fail closed');
    assert.equal(b.result(), undefined);
  } else {
    assert(result.ok, result.error);
    await b.send('COMMIT;');
    if (kind === 'identical') assert.equal(a.result(), b.result());
    else assert.notEqual(a.result(), b.result());
  }
  assert(!/deadlock|timeout|40P01|55P03|57014/.test(a.err + b.err));
  const facts = JSON.parse(target(`SELECT json_build_object(
    'transactions',(SELECT count(*) FROM private.wallet_transactions WHERE provider_reference='${event}'),
    'postings',(SELECT count(*) FROM private.wallet_postings p JOIN private.wallet_transactions t ON t.id=p.transaction_id WHERE t.provider_reference='${event}'),
    'available',(SELECT sum(CASE WHEN p.direction='credit' THEN p.amount_minor ELSE -p.amount_minor END) FROM private.wallet_postings p JOIN private.wallet_accounts a ON a.id=p.account_id WHERE a.member_id='${member}' AND a.account_kind='member_available'),
    'clearing',(SELECT count(*) FROM private.wallet_accounts WHERE member_id IS NULL AND currency='NGN' AND account_kind='provider_clearing'));`));
  assert.deepEqual(facts, { transactions: 1, postings: 2, available: 100, clearing: 1 });
  console.log(`PASS ${kind}: observed blocking, expected outcome, one credit, balanced committed ledger`);
  for (const s of [a, b]) if (!s.closed) s.child.stdin.end('\\q\n');
}
(async () => {
  try {
    // Fail before creating anything if the baseline already contains this RPC.
    assert.equal(sql('postgres', "SELECT to_regprocedure('public.record_wallet_top_up_for_server(uuid,bigint,text,text,text)') IS NULL;"), 't');
    // Supabase's postgres role cannot replay auth-admin default ACLs. ACLs are
    // tested against the original database by the rollback-only harness instead.
    const schema = command(['pg_dump', '-U', 'postgres', '-d', 'postgres', '--schema-only', '--no-owner', '--no-acl',
      '--schema=public', '--schema=private', '--schema=auth', '--schema=extensions']);
    sql('postgres', `CREATE DATABASE ${database} TEMPLATE template0;`);
    created = true;
    // template0 supplies an empty public schema; the dump recreates it.
    target('DROP SCHEMA public;');
    target(schema);
    // Minimum schema access needed to exercise 0066's service-only RPC.
    target('GRANT USAGE ON SCHEMA public TO service_role;');
    target(fs.readFileSync(path.join(__dirname, '../migrations/0066_wallet_top_up_foundation.sql'), 'utf8'));
    for (const kind of ['identical', 'mismatch', 'rollback']) await race(kind);
  } finally {
    for (const s of sessions) if (!s.closed) s.child.stdin.end('ROLLBACK;\n\\q\n');
    if (created) {
      assert(/^wallet0066_race_[a-f0-9]{12}$/.test(database));
      sql('postgres', `DROP DATABASE ${database} WITH (FORCE);`);
      console.log('Disposable concurrency database removed');
    }
  }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
