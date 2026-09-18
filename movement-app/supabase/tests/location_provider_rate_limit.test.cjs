'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const migrationPath =
  'supabase/migrations/0029_location_provider_rate_limit.sql';

const behavioralPath =
  'supabase/tests/0029_location_provider_rate_limit_test.sql';

const raw =
  fs.readFileSync(migrationPath, 'utf8')
    .replace(/\r\n/g, '\n');

const behavioral =
  fs.readFileSync(behavioralPath, 'utf8')
    .replace(/\r\n/g, '\n');

const compact =
  raw.replace(/\s+/g, ' ').trim();

function occurrences(text, pattern) {
  return [...text.matchAll(pattern)].length;
}

test('0029 migration has one outer transaction', () => {
  assert.match(raw, /^\s*BEGIN;/);
  assert.match(raw, /COMMIT;\s*$/);

  assert.equal(
    occurrences(
      raw,
      /^\s*BEGIN;\s*$/gm,
    ),
    1,
  );

  assert.equal(
    occurrences(
      raw,
      /^\s*COMMIT;\s*$/gm,
    ),
    1,
  );

  assert.doesNotMatch(
    raw,
    /^\s*ROLLBACK;\s*$/gm,
  );
});

test('0029 creates only the private quota bucket table', () => {
  const creates =
    [...raw.matchAll(
      /CREATE TABLE\s+([A-Za-z0-9_.]+)/gi,
    )].map(match => match[1]);

  assert.deepEqual(
    creates,
    [
      'private.location_provider_quota_buckets',
    ],
  );
});

test('quota bucket table stores only minimal operational fields', () => {
  const requiredColumns = [
    'member_id uuid',
    'operation text',
    'window_kind text',
    'window_start timestamptz',
    'request_count integer',
    'updated_at timestamptz',
  ];

  for (const column of requiredColumns) {
    assert.ok(
      compact.includes(column),
      `missing ${column}`,
    );
  }

  for (const forbidden of [
    'search_query',
    'query_text',
    'latitude',
    'longitude',
    'provider_place_reference',
    'provider_reference',
    'access_token',
    'jwt',
    'selection_proof',
    'ip_address',
    'provider_response',
  ]) {
    assert.doesNotMatch(
      compact,
      new RegExp(
        `\\b${forbidden}\\b`,
        'i',
      ),
    );
  }
});

test('quota bucket identity is exact member operation window key', () => {
  assert.match(
    compact,
    /PRIMARY KEY \(member_id,operation,window_kind,window_start\)/,
  );

  assert.match(
    compact,
    /operation IN \('location_search','location_resolution'\)/,
  );

  assert.match(
    compact,
    /window_kind IN \('minute','day'\)/,
  );
});

test('quota table has RLS, no policies, and no application table privileges', () => {
  assert.match(
    compact,
    /ALTER TABLE private\.location_provider_quota_buckets ENABLE ROW LEVEL SECURITY;/,
  );

  assert.match(
    compact,
    /REVOKE ALL ON private\.location_provider_quota_buckets FROM PUBLIC,anon,authenticated,service_role;/,
  );

  assert.doesNotMatch(
    compact,
    /\bCREATE POLICY\b/i,
  );

  assert.doesNotMatch(
    compact,
    /\bGRANT\b[^;]*\bON\s+(?:TABLE\s+)?private\.location_provider_quota_buckets\b/i,
  );
});

test('private deterministic clock helper is fully revoked', () => {
  assert.match(
    compact,
    /CREATE FUNCTION private\.consume_location_provider_quota_at\( p_verified_member_id uuid,p_operation text,p_server_time timestamptz \)/,
  );

  assert.match(
    compact,
    /LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS \$quota\$/,
  );

  assert.match(
    compact,
    /REVOKE ALL ON FUNCTION private\.consume_location_provider_quota_at\(uuid,text,timestamptz\) FROM PUBLIC,anon,authenticated,service_role;/,
  );

  assert.doesNotMatch(
    compact,
    /GRANT EXECUTE ON FUNCTION private\.consume_location_provider_quota_at/i,
  );
});

test('public quota RPC is service-role only with empty search path', () => {
  assert.match(
    compact,
    /CREATE FUNCTION public\.consume_location_provider_quota_for_server\( p_verified_member_id uuid,p_operation text \)/,
  );

  assert.match(
    compact,
    /LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS \$server\$/,
  );

  assert.match(
    compact,
    /REVOKE ALL ON FUNCTION public\.consume_location_provider_quota_for_server\(uuid,text\) FROM PUBLIC,anon,authenticated,service_role;/,
  );

  assert.match(
    compact,
    /GRANT EXECUTE ON FUNCTION public\.consume_location_provider_quota_for_server\(uuid,text\) TO service_role;/,
  );

  assert.equal(
    occurrences(
      compact,
      /GRANT EXECUTE ON FUNCTION public\.consume_location_provider_quota_for_server\(uuid,text\) TO service_role;/g,
    ),
    1,
  );
});

test('public RPC accepts no caller-controlled time or limit', () => {
  const signature =
    compact.match(
      /CREATE FUNCTION public\.consume_location_provider_quota_for_server\(([^)]*)\)/,
    );

  assert.ok(signature);

  assert.equal(
    signature[1].replace(/\s+/g, ' ').trim(),
    'p_verified_member_id uuid,p_operation text',
  );

  assert.doesNotMatch(
    signature[1],
    /\b(?:time|timestamp|limit|count|window|retry)\b/i,
  );
});

test('quota operations and limits are fixed server policy', () => {
  assert.match(
    compact,
    /p_operation NOT IN \('location_search','location_resolution'\)/,
  );

  assert.match(
    compact,
    /v_minute_limit := 30; v_day_limit := 300;/,
  );

  assert.match(
    compact,
    /v_minute_limit := 10; v_day_limit := 100;/,
  );
});

test('server clock and UTC windows are explicit', () => {
  assert.match(
    compact,
    /v_now := coalesce\(p_server_time,clock_timestamp\(\)\);/,
  );

  assert.match(
    compact,
    /date_trunc\('minute',v_now AT TIME ZONE 'UTC'\) AT TIME ZONE 'UTC'/,
  );

  assert.match(
    compact,
    /date_trunc\('day',v_now AT TIME ZONE 'UTC'\) AT TIME ZONE 'UTC'/,
  );

  assert.doesNotMatch(
    compact,
    /\bnow\(\)/i,
  );
});

test('member row lock serializes first-bucket creation races', () => {
  assert.match(
    compact,
    /FROM public\.members m WHERE m\.id=p_verified_member_id FOR NO KEY UPDATE;/,
  );

  assert.match(
    compact,
    /current_setting\('transaction_isolation'\) <> 'read committed'/,
  );

  const lockIndex =
    compact.indexOf(
      'FROM public.members m WHERE m.id=p_verified_member_id FOR NO KEY UPDATE;',
    );

  const firstBucketRead =
    compact.indexOf(
      'SELECT b.request_count INTO v_minute_count',
    );

  assert.ok(lockIndex >= 0);
  assert.ok(firstBucketRead >= 0);
  assert.ok(lockIndex < firstBucketRead);
});

test('denial occurs before the atomic two-window increment', () => {
  const denial =
    compact.indexOf(
      'IF v_retry>0 THEN',
    );

  const insert =
    compact.indexOf(
      'INSERT INTO private.location_provider_quota_buckets AS b',
    );

  assert.ok(denial >= 0);
  assert.ok(insert >= 0);
  assert.ok(denial < insert);

  assert.match(
    compact,
    /VALUES \(p_verified_member_id,p_operation,'minute',v_minute,1,v_now\), \(p_verified_member_id,p_operation,'day',v_day,1,v_now\)/,
  );

  assert.match(
    compact,
    /ON CONFLICT \(member_id,operation,window_kind,window_start\) DO UPDATE SET request_count=b\.request_count\+1,updated_at=EXCLUDED\.updated_at;/,
  );
});

test('retry-after is positive and bounded', () => {
  assert.match(
    compact,
    /greatest\(1,ceil\(extract\(epoch FROM \(v_minute\+interval '1 minute'-v_now\)\)\)::integer\)/,
  );

  assert.match(
    compact,
    /RETURN QUERY SELECT false,least\(86400,greatest\(1,v_retry\)\);/,
  );
});

test('0029 contains no provider vendor network or secret configuration', () => {
  assert.doesNotMatch(
    raw,
    /\b(?:MAPBOX|GOOGLE|HERE|TOMTOM|NOMINATIM)\b/i,
  );

  assert.doesNotMatch(
    raw,
    /https?:\/\//i,
  );

  assert.doesNotMatch(
    raw,
    /\b(?:ACCESS_TOKEN|API_KEY|SECRET|Authorization|Bearer)\b/i,
  );
});

test('0029 does not alter unrelated operational tables or functions', () => {
  assert.doesNotMatch(
    compact,
    /\bALTER TABLE public\./i,
  );

  assert.doesNotMatch(
    compact,
    /\bDROP\s+(?:TABLE|FUNCTION|TRIGGER|POLICY)\b/i,
  );

  assert.doesNotMatch(
    compact,
    /\bCREATE OR REPLACE FUNCTION\b/i,
  );

  assert.doesNotMatch(
    compact,
    /\b(?:journeys|alignments|movement_offers|movement_needs|payments|wallet|settlement)\b/i,
  );
});

test('behavioral harness is rollback-only and explicitly not a concurrency proof', () => {
  assert.match(
    behavioral,
    /^\s*BEGIN;/,
  );

  assert.match(
    behavioral,
    /ROLLBACK;\s*$/,
  );

  assert.doesNotMatch(
    behavioral,
    /^\s*COMMIT;\s*$/gm,
  );

  assert.match(
    behavioral,
    /NOT a\s*(?:--\s*)?simultaneous-session concurrency test/i,
  );
});

test('behavioral harness asserts exactly 74 checks and zero failures', () => {
  assert.match(
    behavioral,
    /count\(\*\)\s+FROM\s+pg_temp\.quota_results\)\s*<>\s*74/i,
  );

  assert.match(
    behavioral,
    /EXISTS\(SELECT 1 FROM pg_temp\.quota_results WHERE NOT passed\)/,
  );

  assert.match(
    behavioral,
    /0029 behavioral checks failed/,
  );
});

test('behavioral harness covers ACL limits resets independence and rollback', () => {
  for (const phrase of [
    'service execute allowed',
    'PUBLIC execute absent',
    'RLS enabled',
    'no policies',
    'null member rejected',
    'missing member rejected',
    'exact minute admitted',
    'minute next denied',
    'minute denial preserves daily',
    'other member independent',
    'UTC midnight bucket',
    'exact day across minutes admitted',
    'day next denied UTC retry',
    'day denial creates no minute',
    'both blocked waits for day',
    'next day admits',
    'operations independent',
    'unrelated unique violation escapes',
    'late failure rolls back both increments',
    'rollback restores all quota state',
  ]) {
    assert.ok(
      behavioral.includes(phrase),
      `missing behavioral coverage: ${phrase}`,
    );
  }
});

