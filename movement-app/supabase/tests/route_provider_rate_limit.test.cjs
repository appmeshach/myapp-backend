'use strict';

const test =
  require('node:test');

const assert =
  require('node:assert/strict');

const fs =
  require('node:fs');

const migrationPath =
  'supabase/migrations/0032_route_provider_rate_limit.sql';

const behavioralPath =
  'supabase/tests/0032_route_provider_rate_limit_test.sql';

const raw =
  fs.readFileSync(
    migrationPath,
    'utf8',
  ).replace(/\r\n/g, '\n');

const behavioral =
  fs.readFileSync(
    behavioralPath,
    'utf8',
  ).replace(/\r\n/g, '\n');

const compact =
  raw.replace(/\s+/g, ' ').trim();

function occurrences(
  text,
  pattern,
) {
  return [
    ...text.matchAll(pattern),
  ].length;
}


test(
  '0032 migration has one outer transaction',
  () => {
    assert.match(
      raw,
      /^\s*BEGIN;/,
    );

    assert.match(
      raw,
      /COMMIT;\s*$/,
    );

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
  },
);


test(
  '0032 creates only the private route quota bucket table',
  () => {
    const creates =
      [
        ...raw.matchAll(
          /CREATE TABLE\s+([A-Za-z0-9_.]+)/gi,
        ),
      ].map(
        match => match[1],
      );

    assert.deepEqual(
      creates,
      [
        'private.route_provider_quota_buckets',
      ],
    );
  },
);


test(
  'route quota bucket stores only minimal operational fields',
  () => {
    for (const column of [
      'member_id uuid',
      'window_kind text',
      'window_start timestamptz',
      'request_count integer',
      'updated_at timestamptz',
    ]) {
      assert.ok(
        compact.includes(column),
        `missing ${column}`,
      );
    }

    for (const forbidden of [
      'origin_latitude',
      'origin_longitude',
      'destination_latitude',
      'destination_longitude',
      'route_shape',
      'provider_route_reference',
      'access_token',
      'jwt',
      'provider_response',
      'offering_movement_intent_id',
    ]) {
      assert.doesNotMatch(
        compact,
        new RegExp(
          `\\b${forbidden}\\b`,
          'i',
        ),
      );
    }
  },
);


test(
  'route quota has no caller-selectable operation dimension',
  () => {
    assert.match(
      compact,
      /PRIMARY KEY \( member_id, window_kind, window_start \)/,
    );

    assert.match(
      compact,
      /window_kind IN \( 'minute', 'day' \)/,
    );

    assert.doesNotMatch(
      compact,
      /\boperation\s+text\b/i,
    );

    assert.doesNotMatch(
      compact,
      /\bp_operation\b/i,
    );
  },
);


test(
  'route quota table has RLS and no application privileges',
  () => {
    assert.match(
      compact,
      /ALTER TABLE private\.route_provider_quota_buckets ENABLE ROW LEVEL SECURITY;/,
    );

    assert.match(
      compact,
      /REVOKE ALL ON private\.route_provider_quota_buckets FROM PUBLIC, anon, authenticated, service_role;/,
    );

    assert.doesNotMatch(
      compact,
      /\bCREATE POLICY\b/i,
    );

    assert.doesNotMatch(
      compact,
      /\bGRANT\b[^;]*\bON\s+(?:TABLE\s+)?private\.route_provider_quota_buckets\b/i,
    );
  },
);


test(
  'private route quota clock helper is fully revoked',
  () => {
    assert.match(
      compact,
      /CREATE FUNCTION private\.consume_route_provider_quota_at\( p_verified_member_id uuid, p_server_time timestamptz \)/,
    );

    assert.match(
      compact,
      /LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS \$quota\$/,
    );

    assert.match(
      compact,
      /REVOKE ALL ON FUNCTION private\.consume_route_provider_quota_at\( uuid, timestamptz \) FROM PUBLIC, anon, authenticated, service_role;/,
    );

    assert.doesNotMatch(
      compact,
      /GRANT EXECUTE ON FUNCTION private\.consume_route_provider_quota_at/i,
    );
  },
);


test(
  'public route quota RPC is service-role only',
  () => {
    assert.match(
      compact,
      /CREATE FUNCTION public\.consume_route_provider_quota_for_server\( p_verified_member_id uuid \)/,
    );

    assert.match(
      compact,
      /LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS \$server\$/,
    );

    assert.match(
      compact,
      /REVOKE ALL ON FUNCTION public\.consume_route_provider_quota_for_server\( uuid \) FROM PUBLIC, anon, authenticated, service_role;/,
    );

    assert.match(
      compact,
      /GRANT EXECUTE ON FUNCTION public\.consume_route_provider_quota_for_server\( uuid \) TO service_role;/,
    );

    assert.equal(
      occurrences(
        compact,
        /GRANT EXECUTE ON FUNCTION public\.consume_route_provider_quota_for_server\( uuid \) TO service_role;/g,
      ),
      1,
    );
  },
);


test(
  'public route quota RPC accepts only member identity',
  () => {
    const signature =
      compact.match(
        /CREATE FUNCTION public\.consume_route_provider_quota_for_server\(([^)]*)\)/,
      );

    assert.ok(signature);

    assert.equal(
      signature[1]
        .replace(/\s+/g, ' ')
        .trim(),
      'p_verified_member_id uuid',
    );

    assert.doesNotMatch(
      signature[1],
      /\b(?:time|timestamp|limit|count|window|retry|operation)\b/i,
    );
  },
);


test(
  'route quota limits are fixed server policy',
  () => {
    assert.match(
      compact,
      /v_minute_limit integer := 10;/,
    );

    assert.match(
      compact,
      /v_day_limit integer := 100;/,
    );
  },
);


test(
  'route quota uses fresh server clock and UTC windows',
  () => {
    assert.match(
      compact,
      /v_now := coalesce\( p_server_time, clock_timestamp\(\) \);/,
    );

    assert.match(
      compact,
      /date_trunc\( 'minute', v_now AT TIME ZONE 'UTC' \) AT TIME ZONE 'UTC'/,
    );

    assert.match(
      compact,
      /date_trunc\( 'day', v_now AT TIME ZONE 'UTC' \) AT TIME ZONE 'UTC'/,
    );

    assert.doesNotMatch(
      compact,
      /\bnow\(\)/i,
    );
  },
);


test(
  'member row lock serializes first route quota bucket creation',
  () => {
    assert.match(
      compact,
      /FROM public\.members m WHERE m\.id = p_verified_member_id FOR NO KEY UPDATE;/,
    );

    assert.match(
      compact,
      /current_setting\( 'transaction_isolation' \) <> 'read committed'/,
    );

    const lockIndex =
      compact.indexOf(
        'FROM public.members m WHERE m.id = p_verified_member_id FOR NO KEY UPDATE;',
      );

    const firstBucketRead =
      compact.indexOf(
        'SELECT b.request_count INTO v_minute_count',
      );

    assert.ok(
      lockIndex >= 0,
    );

    assert.ok(
      firstBucketRead >= 0,
    );

    assert.ok(
      lockIndex < firstBucketRead,
    );
  },
);


test(
  'route quota denial precedes atomic two-window increment',
  () => {
    const denial =
      compact.indexOf(
        'IF v_retry > 0 THEN',
      );

    const insert =
      compact.indexOf(
        'INSERT INTO private.route_provider_quota_buckets AS b',
      );

    assert.ok(
      denial >= 0,
    );

    assert.ok(
      insert >= 0,
    );

    assert.ok(
      denial < insert,
    );

    assert.match(
      compact,
      /ON CONFLICT \( member_id, window_kind, window_start \) DO UPDATE SET request_count = b\.request_count \+ 1, updated_at = EXCLUDED\.updated_at;/,
    );
  },
);


test(
  'route quota retry-after is positive and bounded',
  () => {
    assert.match(
      compact,
      /least\( 86400, greatest\( 1, v_retry \) \)/,
    );

    assert.match(
      compact,
      /interval '1 minute'/,
    );

    assert.match(
      compact,
      /interval '1 day'/,
    );
  },
);


test(
  '0032 contains no routing provider vendor network or secrets',
  () => {
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
  },
);


test(
  '0032 does not alter unrelated operational objects',
  () => {
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
  },
);


test(
  '0032 behavioral harness is rollback-only and not a concurrency proof',
  () => {
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
      /NOT a simultaneous-session concurrency test/i,
    );
  },
);


test(
  '0032 behavioral harness asserts exactly 56 checks and zero failures',
  () => {
    assert.match(
      behavioral,
      /count\(\*\)[\s\S]*<>\s*56/i,
    );

    assert.match(
      behavioral,
      /EXISTS\([\s\S]*FROM pg_temp\.route_quota_results[\s\S]*WHERE NOT passed/i,
    );

    assert.match(
      behavioral,
      /0032 route quota behavioral checks failed/,
    );
  },
);


test(
  '0032 behavioral harness covers ACL limits resets isolation and rollback',
  () => {
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
      'exact daily count',
      'day next denied UTC retry',
      'day denial creates no minute',
      'both blocked waits for day',
      'next day admits',
      'unrelated unique violation escapes',
      'late failure rolls back both increments',
      'rollback restores all quota state',
      'rollback removes users and members',
    ]) {
      assert.ok(
        behavioral.includes(
          phrase,
        ),
        `missing behavioral coverage: ${phrase}`,
      );
    }
  },
);