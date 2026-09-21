'use strict';

const fs = require('fs');
const path = require('path');

const migrationPath = path.join(
  process.cwd(),
  'supabase',
  'migrations',
  '0038_trusted_route_match_evidence_writer.sql'
);

const behavioralTestPath = path.join(
  process.cwd(),
  'supabase',
  'tests',
  '0038_trusted_route_match_evidence_writer_test.sql'
);

const raw = fs
  .readFileSync(migrationPath, 'utf8')
  .replace(/\r\n/g, '\n');

const stripComments = (value) =>
  value.replace(
    /'(?:''|[^'])*'|--[^\r\n]*|\/\*[\s\S]*?\*\//g,
    (token) => (token.startsWith("'") ? token : ' ')
  );

const sql = stripComments(raw);

const live = stripComments(
  fs.readFileSync(
    behavioralTestPath,
    'utf8'
  )
);

const writerStart =
  sql.indexOf(
    'CREATE FUNCTION\npublic.record_trusted_route_match_evidence_for_server'
  );

const writer =
  writerStart >= 0
    ? sql.slice(writerStart)
    : '';

const checks = [];

const check = (name, passed) => {
  checks.push({
    name,
    passed: Boolean(passed),
  });
};

check(
  'transaction wrapper',
  /^\s*BEGIN;/i.test(sql)
    && /COMMIT;\s*$/i.test(sql)
);

check(
  'one trusted route-match writer',
  (
    sql.match(
      /CREATE\s+FUNCTION\s+public\.record_trusted_route_match_evidence_for_server/gi
    ) || []
  ).length === 1
);

check(
  'security definer',
  /SECURITY\s+DEFINER/i.test(writer)
);

check(
  'empty search path',
  /SET\s+search_path\s*=\s*''/i.test(writer)
);

check(
  'read committed required',
  /current_setting\('transaction_isolation'\)[\s\S]*?IS\s+DISTINCT\s+FROM\s+'read committed'/i.test(
    writer
  )
);

check(
  'service-only execute',
  /GRANT\s+EXECUTE[\s\S]*?TO\s+service_role\s*;/i.test(
    writer
  )
    && /REVOKE\s+ALL[\s\S]*?FROM\s+PUBLIC,\s*anon,\s*authenticated,\s*service_role\s*;/i.test(
      writer
    )
);

check(
  'no direct table mutation grant',
  !/GRANT\s+(?:ALL|INSERT|UPDATE|DELETE)[\s\S]*?private\.trusted_route_match_evidence/i.test(
    sql
  )
);

check(
  'expected route evidence id required',
  /p_expected_route_evidence_id\s+uuid/i.test(
    writer
  )
);

check(
  'expected route evidence version required',
  /p_expected_route_evidence_version\s+integer/i.test(
    writer
  )
);

check(
  'expected route inputs cannot be null',
  /p_expected_route_evidence_id\s+IS\s+NULL[\s\S]*?p_expected_route_evidence_version\s+IS\s+NULL/i.test(
    writer
  )
);

check(
  'caller cannot submit requesting member',
  !/p_requesting_member_id/i.test(writer)
);

check(
  'caller cannot submit offering member',
  !/p_offering_member_id/i.test(writer)
);

check(
  'caller cannot submit requester origin binding',
  !/p_requester_origin_location_reference_id/i.test(
    writer
  )
);

check(
  'caller cannot submit requester destination binding',
  !/p_requester_destination_location_reference_id/i.test(
    writer
  )
);

check(
  'caller cannot submit route order',
  !/p_route_order/i.test(writer)
);

check(
  'database derives forward route order',
  /v_route_order\s*:=\s*'forward'/i.test(
    writer
  )
);

check(
  'database derives same-position route order',
  /v_route_order\s*:=\s*'same_position'/i.test(
    writer
  )
);

check(
  'database derives reverse route order',
  /v_route_order\s*:=\s*'reverse'/i.test(
    writer
  )
);

check(
  'no maximum-detour threshold input',
  !/p_maximum_detour|p_maximum_pickup|p_maximum_dropoff/i.test(
    writer
  )
);

check(
  'large distance facts only reject negative values',
  /p_requester_origin_distance_to_route_meters\s*<\s*0[\s\S]*?p_requester_destination_distance_to_route_meters\s*<\s*0/i.test(
    writer
  )
);

check(
  'trusted matching context reused',
  /public\.get_trusted_matching_context_for_server\s*\(/i.test(
    writer
  )
);

check(
  'current route id must equal calculation route id',
  /v_context\.route_evidence_id[\s\S]*?IS\s+DISTINCT\s+FROM\s+p_expected_route_evidence_id/i.test(
    writer
  )
);

check(
  'current route version must equal calculation route version',
  /v_context\.route_evidence_version[\s\S]*?IS\s+DISTINCT\s+FROM\s+p_expected_route_evidence_version/i.test(
    writer
  )
);

check(
  'stale route calculation fails closed',
  /Trusted route-match calculation route is no longer current/i.test(
    writer
  )
);

check(
  'database supplies route evidence id on insert',
  /VALUES\s*\([\s\S]*?v_context\.route_evidence_id[\s\S]*?v_context\.route_evidence_version/i.test(
    writer
  )
);

check(
  'database derives route-match version',
  /COALESCE\(MAX\(e\.version\),\s*0\)\s*\+\s*1/i.test(
    writer
  )
);

check(
  'current history is superseded',
  /SET\s+status\s*=\s*'superseded'/i.test(
    writer
  )
);

check(
  'replay bound to exact route evidence and algorithm',
  /e\.route_evidence_id\s*=\s*v_context\.route_evidence_id[\s\S]*?e\.algorithm_version\s*=\s*'route_match_geometry_v1'/i.test(
    writer
  )
);

check(
  'replay mismatch fails closed',
  /Trusted route-match replay does not match recorded evidence/i.test(
    writer
  )
);

check(
  'derived route order stored',
  /v_route_order[\s\S]*?p_calculated_at[\s\S]*?v_effective_expires_at[\s\S]*?'current'/i.test(
    writer
  )
);

check(
  'full evidence validator reused',
  /private\.assert_trusted_route_match_evidence\s*\(\s*v_new_id\s*\)/i.test(
    writer
  )
);

check(
  'existing replay revalidated before return',
  /private\.assert_trusted_route_match_evidence\s*\(\s*v_existing\.id\s*\)[\s\S]*?RETURN\s+QUERY/i.test(
    writer
  )
);

check(
  'specific deferred constraint flushed',
  /SET\s+CONSTRAINTS\s+private\.trusted_route_match_evidence_complete\s+IMMEDIATE[\s\S]*?SET\s+CONSTRAINTS\s+private\.trusted_route_match_evidence_complete\s+DEFERRED/i.test(
    writer
  )
);

check(
  'no global constraint or trigger bypass',
  !/SET\s+CONSTRAINTS\s+ALL|DISABLE\s+TRIGGER|DROP\s+TRIGGER|TRUNCATE/i.test(
    writer
  )
);

check(
  'writer creates no alignment',
  !/INSERT\s+INTO\s+public\.alignments/i.test(
    writer
  )
);

check(
  'writer creates no journey',
  !/INSERT\s+INTO\s+public\.journeys/i.test(
    writer
  )
);

check(
  'behavioral test covers large distances',
  live.includes(
    '08 service writer records large objective distances without a maximum-detour rule'
  )
);

check(
  'behavioral test covers exact replay',
  live.includes(
    '11 exact replay returns original route-match evidence'
  )
);

check(
  'behavioral test covers replay mismatch',
  live.includes(
    '12 mismatched replay payload fails closed'
  )
);

check(
  'behavioral test covers stale expected route identity',
  live.includes(
    '13 writer rejects stale or mismatched expected route identity'
  )
);

check(
  'behavioral test covers route supersession',
  live.includes(
    '15 new trusted route creates route-match version two and supersedes version one'
  )
);

check(
  'behavioral test covers no operational movement creation',
  live.includes(
    '16 route-match writer creates no alignment or journey'
  )
);

const failed =
  checks.filter((item) => !item.passed);

for (const item of checks) {
  console.log(
    `${item.passed ? 'PASS' : 'FAIL'}  ${item.name}`
  );
}

console.log(
  `\n${checks.length} tests, `
  + `${checks.length - failed.length} passed, `
  + `${failed.length} failed`
);

if (failed.length) {
  process.exit(1);
}