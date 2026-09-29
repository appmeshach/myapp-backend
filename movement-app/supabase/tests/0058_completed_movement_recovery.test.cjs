const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const name = '0058_completed_movement_recovery';
const read = file =>
  fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/\r\n/g, '\n');

const raw = read('../migrations/' + name + '.sql');
const sql = raw.replace(/--[^\n]*/g, '');
const live = read(name + '_test.sql');

const rpc = 'public.list_my_completed_movement_recoveries';

const snapshot = `SELECT jsonb_build_object(
  'tables', (SELECT jsonb_object_agg(n.nspname||'.'||c.relname,
    query_to_xml(format('SELECT count(*) AS rows, md5(coalesce(string_agg(to_jsonb(t)::text, '''' ORDER BY to_jsonb(t)::text), '''')) AS hash FROM %I.%I t',n.nspname,c.relname),false,true,'')::text)
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind='r' AND n.nspname IN ('public','private','auth','supabase_migrations')),
  'functions', (SELECT jsonb_agg(jsonb_build_object('oid',p.oid,'def',md5(pg_get_functiondef(p.oid)),'acl',p.proacl,'owner',p.proowner) ORDER BY p.oid)
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('public','private') AND p.prokind='f')
) AS state`;

function rollbackBatch() {
  assert.match(raw.trim(), /^BEGIN;[\s\S]*COMMIT;$/);
  assert.match(live.trim(), /^BEGIN;[\s\S]*ROLLBACK;$/);

  const batch =
    raw.trim().replace(/COMMIT;$/, '') +
    '\n' +
    live.replace(
      /^BEGIN;\s*SET TRANSACTION ISOLATION LEVEL READ COMMITTED;/,
      '',
    );

  assert.doesNotMatch(
    batch.replace(/--[^\n]*/g, ''),
    /\bCOMMIT\s*;/i,
  );

  return [
    '\\set ON_ERROR_STOP on',
    snapshot,
    '\\gset before_',
    batch,
    snapshot,
    '\\gset after_',
    "SELECT :'before_state'::jsonb = :'after_state'::jsonb AS restored",
    '\\gset',
    '\\if :restored',
    "SELECT '0058 complete rollback verified' AS result;",
    '\\else',
    '\\quit 1',
    '\\endif',
    '',
  ].join('\n');
}

if (process.argv.includes('--print-rollback')) {
  process.stdout.write(rollbackBatch());
  process.exit(0);
}

test('0058 defines one transactional authenticated-only read RPC', () => {
  assert.equal((sql.match(/^BEGIN;/gm) || []).length, 1);
  assert.equal((sql.match(/^COMMIT;/gm) || []).length, 1);

  assert.deepEqual(
    [...sql.matchAll(/CREATE FUNCTION ([\w.]+)/g)].map(match => match[1]),
    [rpc],
  );

  assert.match(
    sql,
    /list_my_completed_movement_recoveries\(p_limit integer DEFAULT 20\)/,
  );

  assert.match(
    sql,
    /LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''/,
  );

  assert.match(
    sql,
    /caller uuid := auth\.uid\(\)/,
  );

  assert.match(
    sql,
    /FROM public\.members m WHERE m\.id=caller/,
  );

  assert.match(
    sql,
    /p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50/,
  );

  assert.match(
    sql,
    /FROM PUBLIC, anon, authenticated, service_role/,
  );

  assert.deepEqual(
    [...sql.matchAll(/GRANT[^;]+;/g)].map(match => match[0]),
    [
      `GRANT EXECUTE ON FUNCTION ${rpc}(integer) TO authenticated;`,
    ],
  );

  assert.doesNotMatch(
    sql,
    /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE TABLE|CREATE TRIGGER)\b/i,
  );
});

test('0058 requires genuine completed travelled movement and settlement evidence', () => {
  assert.match(
    sql,
    /caller IN \(a\.offering_member_id,a\.member_needing_movement_id\)/,
  );

  assert.match(
    sql,
    /a\.status='completed' AND j\.status='completed'/,
  );

  assert.match(
    sql,
    /j\.started_at IS NOT NULL AND isfinite\(j\.started_at\)/,
  );

  assert.match(
    sql,
    /j\.completed_at IS NOT NULL AND isfinite\(j\.completed_at\)/,
  );

  assert.match(
    sql,
    /j\.started_at<=j\.completed_at/,
  );

  assert.match(
    sql,
    /j\.end_method='mutual_user_end'/,
  );

  assert.match(
    sql,
    /j\.end_requested_by_member_id<>j\.end_confirmed_by_member_id/,
  );

  assert.match(
    sql,
    /private\.mutual_no_travel_closures/,
  );

  assert.match(
    sql,
    /JOIN private\.movement_settlements s ON s\.journey_id=j\.id AND s\.alignment_id=a\.id/,
  );

  assert.match(
    sql,
    /s\.beneficiary_member_id=a\.offering_member_id/,
  );

  assert.match(
    sql,
    /s\.status IN \('pending_amount','pending_settlement','settled','failed'\)/,
  );

  assert.match(
    sql,
    /s\.status='settled' AND s\.settled_at IS NOT NULL/,
  );

  assert.match(
    sql,
    /s\.status<>'settled' AND s\.settled_at IS NULL/,
  );

  assert.match(
    sql,
    /ORDER BY j\.completed_at DESC, a\.movement_need_id DESC\s+LIMIT p_limit/,
  );
});

test('0058 returns only movementNeedId-safe fields and trusted broad labels', () => {
  const shape =
    sql.match(/RETURNS TABLE \(([^)]+)\)/);

  assert(shape);

  assert.deepEqual(
    shape[1]
      .split(',')
      .map(value => value.replace(/\s+/g, ' ').trim()),
    [
      'movement_need_id uuid',
      'origin_area text',
      'destination_area text',
      'completed_at timestamptz',
      'settlement_status text',
      'settlement_is_for_me boolean',
      'settled_at timestamptz',
    ],
  );

  assert.equal(
    (sql.match(/JOIN private\.trusted_location_discovery_areas/g) || [])
      .length,
    2,
  );

  assert.match(
    sql,
    /private\.post_activation_reveal_subjects\(a\.movement_need_id,caller\)/,
  );

  assert.doesNotMatch(
    sql,
    /\bjourney_id uuid\b|\balignment_id uuid\b|\bsettlement_id\b|\bbeneficiary_member_id uuid\b|\blatitude\b|\blongitude\b|\broute_shape\b/,
  );
});

test('0058 rollback batch guarantees complete restoration', () => {
  const batch = rollbackBatch();

  assert.equal(
    (batch.match(/^BEGIN;/gm) || []).length,
    1,
  );

  assert.equal(
    (batch.match(/^ROLLBACK;/gm) || []).length,
    1,
  );

  assert.doesNotMatch(
    batch,
    /DISABLE TRIGGER|session_replication_role|\bCOMMIT;/,
  );

  assert.match(
    batch,
    /before_state.*after_state/,
  );

  assert.match(
    snapshot,
    /public','private','auth','supabase_migrations/,
  );
});
