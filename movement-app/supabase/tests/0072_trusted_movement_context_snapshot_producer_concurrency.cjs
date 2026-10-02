'use strict';

// Real simultaneous-session integration test.
// All concurrency work happens in a disposable PostgreSQL database.
// The normal local application database must remain unchanged.

const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

const container = 'supabase_db_movement-app';

const database =
  'snapshot0072_race_' +
  crypto.randomBytes(6).toString('hex');

const {
  databaseFingerprint
} = require(
  './0072_trusted_movement_context_snapshot_producer_behavior.cjs'
);

const behavioralSql =
  fs.readFileSync(
    path.join(
      __dirname,
      '0072_trusted_movement_context_snapshot_producer_test.sql'
    ),
    'utf8'
  ).replace(/\r\n/g, '\n');

const sessions = [];

let created = false;

const delay =
  ms => new Promise(resolve => setTimeout(resolve, ms));


function command(args, input) {
  const result = cp.spawnSync(
    'docker',
    [
      'exec',
      '-i',
      container,
      ...args
    ],
    {
      input,
      encoding: 'utf8',
      timeout: 60000,
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true
    }
  );

  if (
    result.error ||
    result.status !== 0
  ) {
    throw new Error(
      String(result.error || '') +
      result.stderr +
      result.stdout
    );
  }

  return result.stdout.trim();
}


function sql(db, input) {
  return command(
    [
      'psql',
      '-X',
      '-qAt',
      '-U',
      'postgres',
      '-d',
      db,
      '-v',
      'ON_ERROR_STOP=1',
      '-v',
      'VERBOSITY=verbose'
    ],
    input
  );
}


function target(input) {
  assert(
    /^snapshot0072_race_[a-f0-9]{12}$/
      .test(database)
  );

  return sql(database, input);
}


function fixtures() {
  const marker =
    '-- Snapshot production itself starts here.';

  assert(
    behavioralSql.includes(marker),
    '0072 behavioral fixture marker missing'
  );

  return behavioralSql.slice(
    0,
    behavioralSql.indexOf(marker)
  );
}


class Session {
  constructor() {
    this.out = '';
    this.err = '';
    this.closed = false;

    this.child = cp.spawn(
      'docker',
      [
        'exec',
        '-i',
        container,
        'psql',
        '-X',
        '-qAt',
        '-U',
        'postgres',
        '-d',
        database,
        '-v',
        'ON_ERROR_STOP=1',
        '-v',
        'VERBOSITY=verbose'
      ],
      {
        windowsHide: true
      }
    );

    this.child.stdout.on(
      'data',
      buffer => {
        this.out += buffer;
      }
    );

    this.child.stderr.on(
      'data',
      buffer => {
        this.err += buffer;
      }
    );

    this.child.stdin.on(
      'error',
      error => {
        this.err += error.message;
      }
    );

    this.child.on(
      'error',
      error => {
        this.err += error.message;
        this.closed = true;
      }
    );

    this.child.on(
      'close',
      () => {
        this.closed = true;
      }
    );

    sessions.push(this);
  }


  async send(input) {
    const marker =
      'done_' +
      crypto.randomBytes(6).toString('hex');

    this.child.stdin.write(
      input +
      '\n\\echo ' +
      marker +
      '\n'
    );

    const end =
      Date.now() + 20000;

    while (
      !this.out.includes(marker)
    ) {
      if (this.closed) {
        throw new Error(this.err);
      }

      if (Date.now() > end) {
        throw new Error(
          'Session barrier timed out'
        );
      }

      await delay(25);
    }
  }


  async begin() {
    await this.send(
      "SELECT 'PID='||pg_backend_pid();" +
      " BEGIN ISOLATION LEVEL READ COMMITTED;" +
      " SET LOCAL lock_timeout='25s';" +
      " SET LOCAL statement_timeout='30s';" +
      " SET LOCAL idle_in_transaction_session_timeout='35s';"
    );

    this.pid =
      Number(
        this.out.match(/PID=(\d+)/)[1]
      );
  }


  result() {
    return JSON.parse(
      this.out.match(
        /RESULT=(.*)/
      )?.[1] || 'null'
    );
  }
}


function fixture() {
  return JSON.parse(
    target(
      `SELECT to_jsonb(f)
       FROM race0072.snapshot_fixture f;`
    )
  );
}


function publish(offerId) {
  return `
    SET LOCAL ROLE service_role;

    SELECT
      'RESULT=' || to_jsonb(q)::text
    FROM public.record_movement_context_snapshot_for_server(
      '${offerId}'::uuid
    ) q;

    RESET ROLE;
  `;
}


async function waitForBlock(blocker, blocked) {
  const end =
    Date.now() + 8000;

  while (Date.now() < end) {
    const observed =
      target(
        `SELECT ${blocker.pid}
           = ANY(
               pg_blocking_pids(
                 ${blocked.pid}
               )
             );`
      );

    if (observed === 't') {
      return;
    }

    if (blocked.closed) {
      throw new Error(
        blocked.err
      );
    }

    await delay(50);
  }

  throw new Error(
    'Expected actual PostgreSQL blocking relationship'
  );
}


function assertNoTimeoutOrDeadlock(
  first,
  second
) {
  assert.doesNotMatch(
    first.err + second.err,
    /40P01|55P03|57014|25P03|deadlock detected|timeout/i
  );
}


async function identicalProducerRace() {
  const f = fixture();

  const a = new Session();
  const b = new Session();

  await a.begin();
  await b.begin();

  // Session A creates the snapshot but deliberately keeps
  // its transaction open, retaining the authoritative locks.
  await a.send(
    publish(f.movement_offer)
  );

  // Session B attempts the exact same producer call.
  // It must wait on A rather than racing a second version.
  const pending =
    b.send(
      publish(f.movement_offer)
    )
    .then(
      () => ({
        ok: true
      }),
      error => ({
        ok: false,
        error: error.message
      })
    );

  await waitForBlock(a, b);

  await a.send('COMMIT;');

  const second =
    await pending;

  assert(
    second.ok,
    second.error
  );

  await b.send(
    'SET CONSTRAINTS ALL IMMEDIATE; COMMIT;'
  );

  assertNoTimeoutOrDeadlock(
    a,
    b
  );

  const firstResult =
    a.result();

  const secondResult =
    b.result();

  assert.deepEqual(
    secondResult,
    firstResult,
    'Concurrent identical calls must replay the exact same snapshot'
  );

  const rows =
    JSON.parse(
      target(
        `SELECT coalesce(
           jsonb_agg(
             to_jsonb(s)
             ORDER BY s.version
           ),
           '[]'::jsonb
         )
         FROM private.movement_context_snapshots s
         WHERE s.movement_need_id='${f.need}'::uuid
           AND s.offering_member_id='${f.offerer}'::uuid;`
      )
    );

  assert.equal(
    rows.length,
    1,
    'Exactly one snapshot history row must exist'
  );

  assert.equal(
    rows[0].version,
    1
  );

  assert.equal(
    rows[0].status,
    'current'
  );

  assert.equal(
    rows[0].id,
    firstResult.snapshot_id
  );

  assert.equal(
    target(
      `SELECT count(*)
       FROM private.movement_context_snapshot_travellers
       WHERE snapshot_id='${firstResult.snapshot_id}'::uuid;`
    ),
    '2'
  );

  assert.equal(
    target(
      `SELECT remaining_places
       FROM private.offering_movement_availability
       WHERE id='${f.availability}'::uuid;`
    ),
    '3',
    'Concurrent snapshot production must not consume availability'
  );

  assert.equal(
    target(
      `SELECT status
       FROM public.movement_offers
       WHERE id='${f.movement_offer}'::uuid;`
    ),
    'pending'
  );

  console.log(
    'PASS identical producer race: observed lock wait, exact replay, one canonical version, no capacity consumption, no deadlock/timeout'
  );

  for (
    const session of [a, b]
  ) {
    if (!session.closed) {
      session.child.stdin.end(
        '\\q\n'
      );
    }
  }
}


async function acceptanceWinsRace() {
  const f = fixture();

  const beforeSnapshots =
    target(
      `SELECT count(*)
       FROM private.movement_context_snapshots
       WHERE movement_need_id='${f.need}'::uuid
         AND offering_member_id='${f.offerer}'::uuid;`
    );

  assert.equal(
    beforeSnapshots,
    '1',
    'Identical producer race must leave one snapshot before acceptance race'
  );

  const a = new Session();
  const b = new Session();

  await a.begin();
  await b.begin();

  // Session A accepts the movement offer first and holds the
  // need/offer lifecycle locks open.
  await a.send(`
    SELECT set_config(
      'request.jwt.claim.sub',
      '${f.requester}',
      true
    );

    SET LOCAL ROLE authenticated;

    SELECT *
    FROM public.accept_movement_offer(
      '${f.movement_offer}'::uuid
    );

    RESET ROLE;
  `);

  // Session B started while acceptance is still uncommitted.
  // The snapshot producer must wait for the lifecycle lock.
  const pending =
    b.send(
      publish(f.movement_offer)
    )
    .then(
      () => ({
        ok: true
      }),
      error => ({
        ok: false,
        error: error.message
      })
    );

  await waitForBlock(a, b);

  await a.send('COMMIT;');

  const result =
    await pending;

  assert.equal(
    result.ok,
    false,
    JSON.stringify(result)
  );

  assert.match(
    result.error,
    /23514/
  );

  assertNoTimeoutOrDeadlock(
    a,
    b
  );

  assert.equal(
    target(
      `SELECT status
       FROM public.movement_offers
       WHERE id='${f.movement_offer}'::uuid;`
    ),
    'accepted'
  );

  assert.equal(
    target(
      `SELECT status
       FROM public.movement_needs
       WHERE id='${f.need}'::uuid;`
    ),
    'closed'
  );

  assert.equal(
    target(
      `SELECT count(*)
       FROM public.alignments
       WHERE movement_need_id='${f.need}'::uuid
         AND movement_offer_id='${f.movement_offer}'::uuid
         AND status='awaiting_activation_payment';`
    ),
    '1'
  );

  assert.equal(
    target(
      `SELECT count(*)
       FROM private.movement_context_snapshots
       WHERE movement_need_id='${f.need}'::uuid
         AND offering_member_id='${f.offerer}'::uuid;`
    ),
    '1',
    'Acceptance must not allow a stale second snapshot/version'
  );

  assert.equal(
    target(
      `SELECT max(version)
       FROM private.movement_context_snapshots
       WHERE movement_need_id='${f.need}'::uuid
         AND offering_member_id='${f.offerer}'::uuid;`
    ),
    '1'
  );

  console.log(
    'PASS acceptance-wins race: producer waited, rejected stale accepted offer, preserved canonical snapshot history, no deadlock/timeout'
  );

  if (!a.closed) {
    a.child.stdin.end(
      '\\q\n'
    );
  }

  if (!b.closed) {
    b.child.stdin.end(
      'ROLLBACK;\n\\q\n'
    );
  }
}


(async () => {
  let before;

  try {
    assert.equal(
      sql(
        'postgres',
        "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='0072';"
      ),
      '1',
      'Apply 0072 locally first'
    );

    before =
      sql(
        'postgres',
        databaseFingerprint()
      );

    const schema =
      command(
        [
          'pg_dump',
          '-U',
          'postgres',
          '-d',
          'postgres',
          '--schema-only',
          '--no-owner',
          '--no-acl',
          '--schema=public',
          '--schema=private',
          '--schema=auth',
          '--schema=extensions'
        ]
      );

    sql(
      'postgres',
      `CREATE DATABASE ${database} TEMPLATE template0;`
    );

    created = true;

    target(
      'DROP SCHEMA public;'
    );

    target(schema);

    target(`
      GRANT USAGE
      ON SCHEMA public
      TO authenticated, service_role;

      REVOKE ALL
      ON FUNCTION public.record_movement_context_snapshot_for_server(uuid)
      FROM PUBLIC, anon, authenticated, service_role;

      GRANT EXECUTE
      ON FUNCTION public.record_movement_context_snapshot_for_server(uuid)
      TO service_role;

      REVOKE ALL
      ON FUNCTION public.accept_movement_offer(uuid)
      FROM PUBLIC, anon, authenticated, service_role;

      GRANT EXECUTE
      ON FUNCTION public.accept_movement_offer(uuid)
      TO authenticated;
    `);

    let setup =
      fixtures()
        .replace(
          'BEGIN;',
          'BEGIN;\nCREATE SCHEMA race0072;'
        )
        .replaceAll(
          'pg_temp.',
          'race0072.'
        )
        .replaceAll(
          'CREATE TEMP TABLE',
          'CREATE TABLE'
        )
        .replaceAll(
          ' ON COMMIT DROP',
          ''
        );

    target(
      setup +
      '\nCOMMIT;'
    );

    await identicalProducerRace();

    await acceptanceWinsRace();

  } finally {
    for (
      const session of sessions
    ) {
      if (!session.closed) {
        session.child.stdin.end(
          'ROLLBACK;\n\\q\n'
        );
      }
    }

    if (created) {
      assert(
        /^snapshot0072_race_[a-f0-9]{12}$/
          .test(database)
      );

      sql(
        'postgres',
        `DROP DATABASE ${database} WITH (FORCE);`
      );

      console.log(
        'PASS disposable concurrency database removed'
      );
    }

    if (before) {
      assert.equal(
        sql(
          'postgres',
          databaseFingerprint()
        ),
        before,
        'Application database must remain unchanged'
      );

      console.log(
        'PASS full application database snapshot unchanged'
      );
    }
  }
})()
.catch(error => {
  console.error(
    error.stack
  );

  process.exitCode = 1;
});