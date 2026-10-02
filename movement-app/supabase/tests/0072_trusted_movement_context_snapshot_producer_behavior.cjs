'use strict';

// Explicit local PostgreSQL runner.
// Merely importing this file performs no database work.

const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const assert = require('node:assert/strict');

const read = p =>
  fs.readFileSync(
    path.join(__dirname, p),
    'utf8'
  ).replace(/\r\n/g, '\n');

const container = 'supabase_db_movement-app';

const live = read(
  '0072_trusted_movement_context_snapshot_producer_test.sql'
);

function psql(database, input) {
  return cp.spawnSync(
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
      input,
      encoding: 'utf8',
      timeout: 60000,
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true
    }
  );
}

function query(database, input) {
  const result = psql(database, input);

  if (result.error || result.status !== 0) {
    throw new Error(
      String(result.error || '') +
      result.stderr +
      result.stdout
    );
  }

  return result.stdout.trim();
}

function databaseFingerprint() {
  return `
    SELECT md5(
      coalesce(
        string_agg(
          n.nspname || '.' || c.relname || ':' ||
          query_to_xml(
            format(
              'SELECT md5(coalesce(string_agg(to_jsonb(t)::text, '''' ORDER BY to_jsonb(t)::text), '''')) FROM %I.%I t',
              n.nspname,
              c.relname
            ),
            false,
            true,
            ''
          )::text,
          E'\\n'
          ORDER BY n.nspname,c.relname
        ),
        ''
      )
    )
    FROM pg_class c
    JOIN pg_namespace n
      ON n.oid=c.relnamespace
    WHERE c.relkind='r'
      AND n.nspname IN (
        'public',
        'private',
        'auth',
        'supabase_migrations'
      );
  `;
}

function main() {
  assert.equal(
    query(
      'postgres',
      "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='0072';"
    ),
    '1',
    'Apply 0072 locally first'
  );

  const before =
    query('postgres', databaseFingerprint());

  const result =
    psql('postgres', live);

  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');

  const after =
    query('postgres', databaseFingerprint());

  assert.equal(
    after,
    before,
    '0072 behavioral test must roll back every fixture and mutation'
  );

  if (result.error || result.status !== 0) {
    throw new Error(
      String(result.error || '') +
      result.stderr +
      result.stdout
    );
  }

  console.log(
    'PASS full external rollback snapshot'
  );

  process.exitCode = 0;
}

module.exports = {
  read,
  container,
  live,
  psql,
  query,
  databaseFingerprint
};

if (require.main === module) {
  main();
}