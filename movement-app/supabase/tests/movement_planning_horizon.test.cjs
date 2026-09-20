const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const migrationPath = 'supabase/migrations/0024_movement_planning_horizon.sql';
const livePath = 'supabase/tests/0024_movement_planning_horizon_test.sql';
const sqlRaw = fs.readFileSync(migrationPath, 'utf8');
const liveRaw = fs.readFileSync(livePath, 'utf8');
function withoutComments(source) {
  return source.replace(/'(?:''|[^'])*'|--[^\r\n]*|\/\*[\s\S]*?\*\//g,
    token => token.startsWith("'") ? token : ' ');
}
const sql = withoutComments(sqlRaw);
const live = withoutComments(liveRaw);

function must(re, msg) { assert.match(sql, re, msg); }
function mustNot(re, msg) { assert.doesNotMatch(sql, re, msg); }

test('0024 is transactional and creates no tables or columns', () => {
  assert.match(sql.trim(), /^BEGIN;/i);
  assert.match(sql.trim(), /COMMIT;\s*$/i);
  mustNot(/CREATE\s+TABLE|ALTER\s+TABLE[\s\S]*ADD\s+COLUMN/i);
});

test('0024 creates exactly one private enforcement helper', () => {
  const names = [...sql.matchAll(/CREATE\s+FUNCTION\s+private\.([A-Za-z0-9_]+)/gi)].map(m => m[1]);
  assert.deepEqual(names, ['enforce_movement_planning_horizon']);
  must(/CREATE\s+FUNCTION\s+private\.enforce_movement_planning_horizon\(\)/i);
  must(/SECURITY\s+DEFINER[\s\S]*SET\s+search_path\s*=\s*''/i);
  must(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+private\.enforce_movement_planning_horizon\(\)[\s\S]*FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i);
});

test('server statement time defines one stable 24-hour planning instant', () => {
  must(/v_now\s+timestamptz\s*:=\s*statement_timestamp\(\)/i);
  must(/v_deadline\s+timestamptz\s*:=\s*statement_timestamp\(\)\s*\+\s*interval\s*'24 hours'/i);
  mustNot(/NEW\.created_at\s*\+/i);
});

test('earliest departure cannot be past or beyond 24 hours', () => {
  must(/NEW\.earliest_departure_at\s*<\s*v_now/i);
  must(/Earliest departure cannot be in the past/i);
  must(/NEW\.earliest_departure_at\s*>\s*v_deadline/i);
  must(/Earliest departure must be within the next 24 hours/i);
});

test('latest departure stays ordered and within the same 24-hour horizon', () => {
  must(/NEW\.latest_departure_at\s*<\s*NEW\.earliest_departure_at/i);
  must(/Latest departure cannot be before earliest departure/i);
  must(/NEW\.latest_departure_at\s*>\s*v_deadline/i);
  must(/Latest departure must be within the next 24 hours/i);
});

test('finite timestamps are explicitly required', () => {
  must(/NOT\s+isfinite\(NEW\.earliest_departure_at\)/i);
  must(/NEW\.latest_departure_at\s+IS\s+NOT\s+NULL\s+AND\s+NOT\s+isfinite\(NEW\.latest_departure_at\)/i);
});

test('requester need trigger covers insert and departure edits only', () => {
  must(/CREATE\s+TRIGGER\s+enforce_movement_need_planning_horizon[\s\S]*BEFORE\s+INSERT\s+OR\s+UPDATE\s+OF\s+earliest_departure_at\s*,\s*latest_departure_at[\s\S]*ON\s+public\.movement_needs/i);
  mustNot(/BEFORE\s+UPDATE\s+ON\s+public\.movement_needs/i);
});

test('offering intent trigger is insert-only because 0022 makes fields immutable', () => {
  must(/CREATE\s+TRIGGER\s+enforce_offering_intent_planning_horizon[\s\S]*BEFORE\s+INSERT[\s\S]*ON\s+private\.offering_movement_intents/i);
  const trigger = sql.match(/CREATE\s+TRIGGER\s+enforce_offering_intent_planning_horizon[\s\S]*?EXECUTE\s+FUNCTION[^;]*;/i)?.[0] ?? '';
  assert.doesNotMatch(trigger, /UPDATE|DELETE/i);
});

test('0024 does not change authenticated privileges or RLS', () => {
  mustNot(/\bGRANT\b|\bCREATE\s+POLICY\b|\bDROP\s+POLICY\b|ALTER\s+TABLE[\s\S]*ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
});

test('0024 does not redefine operational or movement-context functions', () => {
  mustNot(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?(?:create_movement_offer|accept_movement_offer|discover_masked_movement_needs|create_alignment_activation_payment|request_journey_start|confirm_journey_start|request_movement_end|confirm_movement_end)\b/i);
  mustNot(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+private\.(?:protect_movement_context_record|assert_offering_movement_intent|assert_movement_context_snapshot|assert_offering_route_evidence)\b/i);
});

test('0024 does not introduce routing, pricing, payments, negotiation or scheduling jobs', () => {
  mustNot(/\b(?:postgis|geometry|geography|mapbox|google\s*maps|route_shape|route_distance|pricing|fare|surge|wallet|refund|payout|counterproposal|come_to_route)\b/i);
  mustNot(/pg_cron|cron\.schedule|CREATE\s+EXTENSION/i);
});

test('0024 does not limit physical journey duration', () => {
  mustNot(/public\.journeys|started_at|completed_at|journey_duration/i);
});

test('behavioral harness covers requester and offerer boundaries and lifecycle noninterference', () => {
  for (const phrase of [
    'requester valid near-term need accepted',
    'requester past earliest rejected',
    'requester earliest beyond 24h rejected',
    'requester latest beyond 24h rejected',
    'authenticated requester cannot bypass trusted movement-need intake',
    'status-only need update remains allowed',
    'departure edit into invalid horizon rejected',
    'offering valid near-term intent accepted',
    'offering past earliest rejected',
    'offering earliest beyond 24h rejected',
    'offering latest beyond 24h rejected',
    'offering lifecycle transition remains allowed',
  ]) assert.match(live, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), 'i'));
});

test('behavioral test is rollback-only', () => {
  assert.match(live.trim(), /^BEGIN;/i);
  assert.match(live.trim(), /ROLLBACK;\s*$/i);
  assert.doesNotMatch(live, /\bCOMMIT\s*;/i);
});
