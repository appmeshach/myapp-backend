'use strict';
// Explicit local integration command, not part of node --test discovery.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const migration = fs.readFileSync(path.join(__dirname, '../migrations/0066_wallet_top_up_foundation.sql'), 'utf8');
const harness = fs.readFileSync(path.join(__dirname, '0066_wallet_top_up_foundation_test.sql'), 'utf8');
// Install 0066 only inside the harness transaction: its final ROLLBACK removes
// the function as well as all fixtures. Never execute migration COMMIT here.
const body = migration.replace(/^BEGIN;\s*/, '').replace(/COMMIT;\s*$/, '');
const input = harness.replace('SET LOCAL statement_timeout', () => body + '\nSET LOCAL statement_timeout');
const result = spawnSync('docker', ['exec', '-i', 'supabase_db_movement-app', 'psql',
  '-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], {
  input, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) console.error(result.error.message);
process.exitCode = result.error ? 1 : (result.status ?? 1);
