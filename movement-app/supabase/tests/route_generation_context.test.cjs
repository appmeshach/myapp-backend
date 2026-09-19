'use strict';

const fs = require('fs');
const path = require('path');

const migrationPath = path.join(
  process.cwd(),
  'supabase',
  'migrations',
  '0031_route_generation_context.sql'
);

const raw = fs.readFileSync(migrationPath, 'utf8');

const stripComments = (source) =>
  source.replace(
    /'(?:''|[^'])*'|--[^\r\n]*|\/\*[\s\S]*?\*\//g,
    (token) => token.startsWith("'") ? token : ' '
  );

const sql = stripComments(raw);

const checks = [];
const check = (name, passed) => {
  checks.push({ name, passed: Boolean(passed) });
};

check(
  'transaction wrapper',
  /^\s*BEGIN;/i.test(sql) &&
  /COMMIT;\s*$/i.test(sql)
);

check(
  'creates exactly one route-generation context RPC',
  (
    sql.match(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.get_offering_route_generation_context_for_server/gi
    ) || []
  ).length === 1
);

check(
  'security definer',
  /SECURITY\s+DEFINER/i.test(sql)
);

check(
  'empty search path',
  /SET\s+search_path\s*=\s*''/i.test(sql)
);

check(
  'service-role-only execution',
  /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.get_offering_route_generation_context_for_server[\s\S]*?FROM\s+PUBLIC,\s*anon,\s*authenticated,\s*service_role\s*;/i.test(sql) &&
  /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.get_offering_route_generation_context_for_server[\s\S]*?TO\s+service_role\s*;/i.test(sql)
);

check(
  'requires explicit member ownership',
  /p_offering_member_id\s+uuid/i.test(sql) &&
  /v_intent\.offering_member_id\s*<>\s*p_offering_member_id/i.test(sql)
);

check(
  'loads offering intent by id',
  /FROM\s+private\.offering_movement_intents/i.test(sql) &&
  /WHERE\s+i\.id\s*=\s*p_offering_movement_intent_id/i.test(sql)
);

check(
  'requires current unexpired intent',
  /v_intent\.status\s*<>\s*'current'/i.test(sql) &&
  /v_intent\.expires_at/i.test(sql)
);

check(
  'reuses offering-intent validator',
  /private\.assert_offering_movement_intent\(v_intent\.id\)/i.test(sql)
);

check(
  'derives origin from intent binding',
  /role\s*=\s*'origin'/i.test(sql)
);

check(
  'derives destination from intent binding',
  /role\s*=\s*'destination'/i.test(sql)
);

check(
  'caller cannot submit origin coordinates',
  !/p_origin_(?:latitude|longitude)/i.test(sql)
);

check(
  'caller cannot submit destination coordinates',
  !/p_destination_(?:latitude|longitude)/i.test(sql)
);

check(
  'coordinates come from private trusted location rows',
  /FROM\s+private\.movement_location_references/i.test(sql)
);

check(
  'requires resolved endpoints',
  /resolution_status\s*<>\s*'resolved'/i.test(sql)
);

check(
  'requires provider-resolved endpoints',
  /source_kind\s*<>\s*'provider_resolved'/i.test(sql)
);

check(
  'checks endpoint ownership',
  /v_origin\.owner_member_id\s*<>\s*v_intent\.offering_member_id/i.test(sql) &&
  /v_destination\.owner_member_id\s*<>\s*v_intent\.offering_member_id/i.test(sql)
);

check(
  'requires distinct endpoints',
  /v_origin_id\s*=\s*v_destination_id/i.test(sql)
);

check(
  'validates coordinate bounds',
  /BETWEEN\s+-90\s+AND\s+90/i.test(sql) &&
  /BETWEEN\s+-180\s+AND\s+180/i.test(sql)
);

check(
  'rejects non-finite coordinate text forms',
  /NaN/.test(sql) &&
  /Infinity/.test(sql)
);

check(
  'rejects expired endpoints',
  /v_origin\.expires_at/i.test(sql) &&
  /v_destination\.expires_at/i.test(sql)
);

check(
  'returns only route-generation context',
  /RETURNS\s+TABLE\s*\([\s\S]*origin_latitude[\s\S]*origin_longitude[\s\S]*destination_latitude[\s\S]*destination_longitude/i.test(sql)
);

check(
  'does not create route evidence',
  !/INSERT\s+INTO\s+private\.offering_route_evidence/i.test(sql)
);

check(
  'does not create journeys or matching rows',
  !/INSERT\s+INTO\s+(?:public\.)?(?:journeys|alignments|movement_offers)/i.test(sql)
);

check(
  'no routing vendor hardwired',
  !/\b(?:mapbox|google|here|tomtom|osrm|valhalla|graphhopper)\b/i.test(sql)
);

const behavioralTestPath = path.join(
  process.cwd(),
  'supabase',
  'tests',
  '0031_route_generation_context_test.sql'
);

const behavioralRaw = fs.readFileSync(behavioralTestPath, 'utf8');
const behavioral = stripComments(behavioralRaw);

check(
  'behavioral harness is transactional and rollback-only',
  /^\s*BEGIN;/i.test(behavioral) &&
  /ROLLBACK;\s*$/i.test(behavioral) &&
  !/\bCOMMIT\s*;/i.test(behavioral)
);

check(
  'behavioral harness checks service-only execution',
  behavioral.includes('01 RPC execute is service-only') &&
  behavioral.includes('02 authenticated cannot execute') &&
  behavioral.includes('03 anon cannot execute')
);

check(
  'behavioral harness checks trusted returned coordinates',
  behavioral.includes('07 trusted origin coordinates returned') &&
  behavioral.includes('08 trusted destination coordinates returned')
);

check(
  'behavioral harness checks ownership and missing intent',
  behavioral.includes('11 wrong member is rejected') &&
  behavioral.includes('12 unknown intent is rejected')
);

check(
  'behavioral harness checks unresolved and expired endpoints',
  behavioral.includes('13 unresolved endpoint is rejected') &&
  behavioral.includes('14 expired endpoint is rejected')
);

check(
  'behavioral harness verifies no operational row creation',
  behavioral.includes('09 RPC creates no route evidence') &&
  behavioral.includes('10 RPC creates no journey or alignment rows')
);

const failed = checks.filter((item) => !item.passed);

for (const item of checks) {
  console.log(`${item.passed ? 'PASS' : 'FAIL'}  ${item.name}`);
}

console.log(
  `\n${checks.length} tests, ${checks.length - failed.length} passed, ${failed.length} failed`
);

if (failed.length) {
  process.exit(1);
}