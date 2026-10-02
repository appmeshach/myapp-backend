'use strict';

const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

const container = 'supabase_db_movement-app';
const database = 'wallet0068_race_' + crypto.randomBytes(6).toString('hex');
const sessions = [];
let created = false;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function command(args, input) {
  const r = cp.spawnSync('docker', ['exec', '-i', container, ...args], {
    input,
    encoding: 'utf8',
    timeout: 60000,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });

  if (r.error || r.status !== 0) {
    throw new Error(String(r.error || '') + r.stderr + r.stdout);
  }

  return r.stdout.trim();
}

function sql(db, input) {
  return command([
    'psql', '-X', '-qAt',
    '-U', 'postgres',
    '-d', db,
    '-v', 'ON_ERROR_STOP=1',
    '-v', 'VERBOSITY=verbose'
  ], input);
}

function target(input) {
  assert(/^wallet0068_race_[a-f0-9]{12}$/.test(database));
  return sql(database, input);
}

class Session {
  constructor() {
    this.out = '';
    this.err = '';
    this.closed = false;

    this.child = cp.spawn(
      'docker',
      [
        'exec', '-i', container,
        'psql', '-X', '-qAt',
        '-U', 'postgres',
        '-d', database,
        '-v', 'ON_ERROR_STOP=1',
        '-v', 'VERBOSITY=verbose'
      ],
      { windowsHide: true }
    );

    this.child.stdout.on('data', b => { this.out += b; });
    this.child.stderr.on('data', b => { this.err += b; });
    this.child.stdin.on('error', e => { this.err += e.message; });
    this.child.on('error', e => {
      this.err += e.message;
      this.closed = true;
    });
    this.child.on('close', () => {
      this.closed = true;
    });

    sessions.push(this);
  }

  async send(input) {
    const marker = 'done_' + crypto.randomBytes(6).toString('hex');

    this.child.stdin.write(input + '\n\\echo ' + marker + '\n');

    const end = Date.now() + 20000;

    while (!this.out.includes(marker)) {
      if (this.closed) {
        throw new Error(this.err);
      }

      if (Date.now() > end) {
        throw new Error('Session barrier timed out');
      }

      await delay(25);
    }
  }

  async begin() {
    await this.send(
      "SELECT 'PID='||pg_backend_pid(); " +
      "BEGIN ISOLATION LEVEL READ COMMITTED; " +
      "SET LOCAL lock_timeout='12s'; " +
      "SET LOCAL statement_timeout='15s'; " +
      "SET LOCAL idle_in_transaction_session_timeout='25s';"
    );

    this.pid = Number(this.out.match(/PID=(\d+)/)[1]);
  }
}

function createMemberWallet() {
  const member = crypto.randomUUID();

  target(`
    INSERT INTO auth.users(
      id,aud,role,email,
      raw_app_meta_data,raw_user_meta_data,
      created_at,updated_at
    )
    VALUES (
      '${member}',
      'authenticated',
      'authenticated',
      '${member}@wallet0068.invalid',
      '{}','{}',now(),now()
    );
  `);

  const result = target(`
    SELECT
      available_account_id::text || '|' ||
      held_account_id::text || '|' ||
      withdrawable_account_id::text
    FROM public.ensure_ngn_wallet_accounts_for_server('${member}');
  `);

  const [available, held, withdrawable] = result.split('|');

  return { member, available, held, withdrawable };
}

async function postingFirstRace() {
  const wallet = createMemberWallet();
  const tx = crypto.randomUUID();
  const key = '0068-race-post-' + crypto.randomBytes(8).toString('hex');

  const posting = new Session();
  const closing = new Session();

  await posting.begin();
  await closing.begin();

  await posting.send(`
    INSERT INTO private.wallet_transactions(
      id,transaction_kind,currency,idempotency_key
    )
    VALUES (
      '${tx}',
      'internal_transfer',
      'NGN',
      '${key}'
    );

    INSERT INTO private.wallet_postings(
      transaction_id,account_id,direction,amount_minor
    )
    VALUES
      ('${tx}','${wallet.held}','debit',100),
      ('${tx}','${wallet.available}','credit',100);
  `);

  const pendingClose = closing.send(`
    UPDATE private.wallet_accounts
    SET status='closed'
    WHERE id='${wallet.available}';
  `).then(
    () => ({ ok: true }),
    e => ({ ok: false, error: e.message })
  );

  let blocked = false;
  const end = Date.now() + 8000;

  while (Date.now() < end && !blocked) {
    blocked =
      target(`SELECT ${posting.pid}=ANY(pg_blocking_pids(${closing.pid}));`) === 't';

    if (!blocked) await delay(50);
  }

  assert(blocked, 'closure must actually wait for posting account lock');

  await posting.send('SET CONSTRAINTS ALL IMMEDIATE; COMMIT;');

  const closeResult = await pendingClose;

  assert(
    !closeResult.ok && /23514/.test(closeResult.error),
    'waiting closure must fail after committed nonzero posting'
  );

  const facts = JSON.parse(target(`
    SELECT json_build_object(
      'status',(
        SELECT status
        FROM private.wallet_accounts
        WHERE id='${wallet.available}'
      ),
      'balance',(
        SELECT coalesce(sum(
          CASE
            WHEN direction='credit' THEN amount_minor::numeric
            ELSE -amount_minor::numeric
          END
        ),0)
        FROM private.wallet_postings
        WHERE account_id='${wallet.available}'
      )
    );
  `));

  assert.deepEqual(facts, {
    status: 'active',
    balance: 100
  });

  console.log(
    'PASS posting first: closure waited, then failed because committed balance was nonzero'
  );
}

async function closureFirstRace() {
  const wallet = createMemberWallet();
  const tx = crypto.randomUUID();
  const key = '0068-race-close-' + crypto.randomBytes(8).toString('hex');

  const closing = new Session();
  const posting = new Session();

  await closing.begin();
  await posting.begin();

  await closing.send(`
    UPDATE private.wallet_accounts
    SET status='closed'
    WHERE id='${wallet.available}';
  `);

  const pendingPosting = posting.send(`
    INSERT INTO private.wallet_transactions(
      id,transaction_kind,currency,idempotency_key
    )
    VALUES (
      '${tx}',
      'internal_transfer',
      'NGN',
      '${key}'
    );

    INSERT INTO private.wallet_postings(
      transaction_id,account_id,direction,amount_minor
    )
    VALUES (
      '${tx}',
      '${wallet.available}',
      'credit',
      100
    );
  `).then(
    () => ({ ok: true }),
    e => ({ ok: false, error: e.message })
  );

  let blocked = false;
  const end = Date.now() + 8000;

  while (Date.now() < end && !blocked) {
    blocked =
      target(`SELECT ${closing.pid}=ANY(pg_blocking_pids(${posting.pid}));`) === 't';

    if (!blocked) await delay(50);
  }

  assert(blocked, 'posting must actually wait for closure account lock');

  await closing.send('COMMIT;');

  const postingResult = await pendingPosting;

  assert(
    !postingResult.ok && /23514/.test(postingResult.error),
    'waiting posting must fail after account becomes closed'
  );

  const facts = JSON.parse(target(`
    SELECT json_build_object(
      'status',(
        SELECT status
        FROM private.wallet_accounts
        WHERE id='${wallet.available}'
      ),
      'transactions',(
        SELECT count(*)
        FROM private.wallet_transactions
        WHERE id='${tx}'
      ),
      'postings',(
        SELECT count(*)
        FROM private.wallet_postings
        WHERE transaction_id='${tx}'
      )
    );
  `));

  assert.deepEqual(facts, {
    status: 'closed',
    transactions: 0,
    postings: 0
  });

  console.log(
    'PASS closure first: posting waited, then failed because account was closed'
  );
}

(async () => {
  try {
    assert.equal(
      sql(
        'postgres',
        "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='0068';"
      ),
      '1',
      'Local database must be migrated through 0068 first'
    );

    const schema = command([
      'pg_dump',
      '-U', 'postgres',
      '-d', 'postgres',
      '--schema-only',
      '--no-owner',
      '--no-acl',
      '--schema=public',
      '--schema=private',
      '--schema=auth',
      '--schema=extensions'
    ]);

    sql(
      'postgres',
      `CREATE DATABASE ${database} TEMPLATE template0;`
    );

    created = true;

    target('DROP SCHEMA public;');
    target(schema);

    await postingFirstRace();
    await closureFirstRace();

  } finally {
    for (const s of sessions) {
      if (!s.closed) {
        s.child.stdin.end('ROLLBACK;\n\\q\n');
      }
    }

    if (created) {
      assert(/^wallet0068_race_[a-f0-9]{12}$/.test(database));

      sql(
        'postgres',
        `DROP DATABASE ${database} WITH (FORCE);`
      );

      console.log('Disposable concurrency database removed');
    }
  }
})().catch(e => {
  console.error(e.message);
  process.exitCode = 1;
});
