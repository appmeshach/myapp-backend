'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const migrationPath =
  'supabase/migrations/0027_trusted_selected_location_intake.sql';

const raw = fs.readFileSync(migrationPath, 'utf8');

const livePath =
  'supabase/tests/0027_trusted_selected_location_intake_test.sql';

const liveRaw = fs.readFileSync(livePath, 'utf8');

const compact = raw
  .replace(/--[^\r\n]*/g, ' ')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const must = (re, message) => {
  assert.match(compact, re, message);
};

const mustNot = (re, message) => {
  assert.doesNotMatch(compact, re, message);
};

const functionBody = (name) => {
  const escaped = name.replaceAll('.', '\\.');
  const re = new RegExp(
    `CREATE OR REPLACE FUNCTION ${escaped}\\([^]*?AS \\$function\\$([^]*?)\\$function\\$;`
  );
  const match = raw.match(re);
  assert.ok(match, `Missing function ${name}`);
  return match[1];
};

const writer = functionBody(
  'public.record_selected_location_for_member'
);

test('0027 is transaction wrapped', () => {
  assert.match(raw, /^\uFEFF?BEGIN;/);
  assert.match(raw, /COMMIT;\s*$/);
});

test('0027 creates exactly one new private table', () => {
  const tables = [...compact.matchAll(/CREATE TABLE ([\w.]+)/g)]
    .map(m => m[1]);

  assert.deepEqual(
    tables,
    ['private.movement_location_selection_receipts']
  );
});

test('0027 creates exact public writer and three private helpers', () => {
  const funcs = [...compact.matchAll(
    /CREATE OR REPLACE FUNCTION ([\w.]+)\(/g
  )].map(m => m[1]);

  assert.deepEqual(funcs, [
    'private.protect_movement_location_selection_receipt',
    'private.assert_movement_location_selection_receipt',
    'private.validate_movement_location_selection_receipt',
    'public.record_selected_location_for_member'
  ]);
});

test('every new function is SECURITY DEFINER with empty search path', () => {
  const defs = raw.match(
    /CREATE OR REPLACE FUNCTION[\s\S]*?\$function\$;/g
  ) || [];

  assert.equal(defs.length, 4);

  for (const def of defs) {
    assert.match(def, /SECURITY DEFINER/);
    assert.match(def, /SET search_path = ''/);
  }
});

test('public writer exposes only selected-result inputs', () => {
  must(
    /record_selected_location_for_member\s*\(\s*p_request_id uuid,\s*p_declared_label text,\s*p_provider_namespace text,\s*p_provider_place_reference text\s*\)/,
    'Unexpected writer signature'
  );

  mustNot(
    /record_selected_location_for_member\s*\([^)]*(owner_member_id|member_id|latitude|longitude|resolved_at|resolution_version)/,
    'Writer must not accept trusted/internal fields'
  );
});

test('writer returns only location id and selected label', () => {
  must(
    /RETURNS TABLE\s*\(\s*location_reference_id uuid,\s*declared_label text\s*\)/,
    'Unexpected return shape'
  );
});

test('writer execution is authenticated-only', () => {
  must(
    /REVOKE ALL ON FUNCTION public\.record_selected_location_for_member\(uuid,\s*text,\s*text,\s*text\) FROM PUBLIC,\s*anon,\s*authenticated,\s*service_role;/,
    'Missing explicit writer revoke'
  );

  must(
    /GRANT EXECUTE ON FUNCTION public\.record_selected_location_for_member\(uuid,\s*text,\s*text,\s*text\) TO authenticated;/,
    'Authenticated execution grant missing'
  );

  mustNot(
    /GRANT EXECUTE ON FUNCTION public\.record_selected_location_for_member[^;]+TO (anon|service_role|PUBLIC)/,
    'Writer execution widened unexpectedly'
  );
});

test('authenticated member identity comes only from auth.uid', () => {
  assert.match(writer, /v_member_id\s*:=\s*auth\.uid\(\)/);

  assert.doesNotMatch(
    writer,
    /p_(owner_)?member_id/
  );

  assert.match(
    writer,
    /FROM public\.members\s+WHERE id = v_member_id/
  );
});

test('writer rejects missing authentication and missing member row', () => {
  assert.match(writer, /IF v_member_id IS NULL THEN/);
  assert.match(writer, /ERRCODE\s*=\s*'42501'/);
  assert.match(
    writer,
    /Member record not found for the authenticated user/
  );
});

test('writer explicitly requires READ COMMITTED', () => {
  assert.match(
    writer,
    /current_setting\('transaction_isolation'\)\s*<>\s*'read committed'/
  );
  assert.match(writer, /ERRCODE\s*=\s*'25000'/);
});

test('receipt table uses request identity and one location identity', () => {
  must(
    /CREATE TABLE private\.movement_location_selection_receipts\s*\(\s*request_id uuid PRIMARY KEY,\s*location_reference_id uuid NOT NULL UNIQUE/,
    'Receipt identity shape changed'
  );

  must(
    /REFERENCES private\.movement_location_references\(id\)\s*ON DELETE RESTRICT/,
    'Receipt foreign key must restrict deletion'
  );
});

test('receipt table is private RLS with no client policies', () => {
  must(
    /ALTER TABLE private\.movement_location_selection_receipts ENABLE ROW LEVEL SECURITY;/,
    'RLS missing'
  );

  mustNot(
    /CREATE POLICY[^;]*movement_location_selection_receipts/i,
    'Receipt table must have no client RLS policy'
  );
});

test('receipt table has explicit revoke and service SELECT only', () => {
  must(
    /REVOKE ALL ON TABLE private\.movement_location_selection_receipts FROM PUBLIC,\s*anon,\s*authenticated,\s*service_role;/,
    'Receipt table revoke missing'
  );

  must(
    /GRANT SELECT ON TABLE private\.movement_location_selection_receipts TO service_role;/,
    'Expected service SELECT-only grant missing'
  );

  mustNot(
    /GRANT (INSERT|UPDATE|DELETE|TRUNCATE)[^;]*movement_location_selection_receipts/i,
    'Receipt mutation privilege widened'
  );
});

test('receipt history rejects UPDATE and DELETE including no-op update', () => {
  const body = functionBody(
    'private.protect_movement_location_selection_receipt'
  );

  assert.match(body, /IF TG_OP = 'UPDATE'/);
  assert.match(body, /IF TG_OP = 'DELETE'/);
  assert.match(body, /ERRCODE\s*=\s*'23514'/);

  must(
    /BEFORE UPDATE OR DELETE ON private\.movement_location_selection_receipts/,
    'Receipt protection trigger missing'
  );
});

test('all private helpers revoke application execution', () => {
  const names = [
    'private.protect_movement_location_selection_receipt',
    'private.assert_movement_location_selection_receipt',
    'private.validate_movement_location_selection_receipt'
  ];

  for (const name of names) {
    const escaped = name.replaceAll('.', '\\.');
    const re = new RegExp(
      `REVOKE ALL ON FUNCTION ${escaped}\\([^)]*\\) FROM PUBLIC,\\s*anon,\\s*authenticated,\\s*service_role;`
    );
    assert.match(compact, re, `${name} execution was not revoked`);
  }
});

test('created location is member_selected and unresolved', () => {
  assert.match(
    writer,
    /'member_selected'\s*,\s*'unresolved'/
  );
});

test('created location forces all resolution fields empty', () => {
  assert.match(
    writer,
    /'member_selected'\s*,\s*'unresolved'\s*,\s*NULL\s*,\s*NULL\s*,\s*p_provider_namespace\s*,\s*p_provider_place_reference\s*,\s*NULL\s*,\s*v_now\s*,\s*NULL\s*,\s*NULL/
  );
});

test('coordinates cannot be supplied by caller', () => {
  assert.doesNotMatch(
    compact,
    /record_selected_location_for_member\s*\([^)]*p_latitude/
  );

  assert.doesNotMatch(
    compact,
    /record_selected_location_for_member\s*\([^)]*p_longitude/
  );
});

test('provider namespace and place reference are stored only as hints', () => {
  assert.match(writer, /p_provider_namespace/);
  assert.match(writer, /p_provider_place_reference/);

  assert.match(
    functionBody('private.assert_movement_location_selection_receipt'),
    /resolution_status IS DISTINCT FROM 'unresolved'/
  );

  assert.match(
    functionBody('private.assert_movement_location_selection_receipt'),
    /source_kind IS DISTINCT FROM 'member_selected'/
  );
});

test('required input validation rejects null blank untrimmed and overlong values', () => {
  assert.match(writer, /p_request_id IS NULL/);

  for (const field of [
    'p_declared_label',
    'p_provider_namespace',
    'p_provider_place_reference'
  ]) {
    assert.match(writer, new RegExp(`${field} IS NULL`));
    assert.match(writer, new RegExp(`${field} <> btrim\\(${field}\\)`));
    assert.match(writer, new RegExp(`${field} = ''`));
    assert.match(writer, new RegExp(`${field} !~ '\\[\\^\\[:space:\\]\\]'`));
  }

  assert.match(writer, /length\(p_declared_label\) > 300/);
  assert.match(writer, /length\(p_provider_namespace\) > 100/);
  assert.match(writer, /length\(p_provider_place_reference\) > 500/);
});

test('exact replay checks member label namespace and place reference', () => {
  for (const check of [
    /owner_member_id IS DISTINCT FROM v_member_id/,
    /declared_label IS DISTINCT FROM p_declared_label/,
    /provider_namespace IS DISTINCT FROM p_provider_namespace/,
    /provider_place_reference IS DISTINCT FROM p_provider_place_reference/
  ]) {
    assert.match(writer, check);
  }
});

test('exact replay returns the previously created location', () => {
  assert.match(
    writer,
    /WHERE request_id = p_request_id/
  );

  assert.match(
    writer,
    /v_existing_location\.id/
  );

  assert.match(
    writer,
    /v_existing_location\.declared_label/
  );
});

test('concurrent retry uses a subtransaction and unique violation recovery', () => {
  assert.match(
    writer,
    /BEGIN[\s\S]*INSERT INTO private\.movement_location_references[\s\S]*INSERT INTO private\.movement_location_selection_receipts[\s\S]*EXCEPTION[\s\S]*WHEN unique_violation THEN/
  );

  assert.match(
    writer,
    /SELECT \*[\s\S]*FROM private\.movement_location_selection_receipts[\s\S]*WHERE request_id = p_request_id/
  );
});

test('writer never updates or deletes existing location references', () => {
  assert.doesNotMatch(
    writer,
    /UPDATE\s+private\.movement_location_references/i
  );

  assert.doesNotMatch(
    writer,
    /DELETE\s+FROM\s+private\.movement_location_references/i
  );
});

test('writer never rebinds existing intent endpoints', () => {
  assert.doesNotMatch(
    writer,
    /offering_movement_intent_locations/
  );

  assert.doesNotMatch(
    writer,
    /offering_movement_intents/
  );
});

test('0027 does not create routing resolution matching or financial objects', () => {
  mustNot(
    /INSERT INTO private\.movement_location_resolution_evidence/,
    '0027 must not create trusted resolution evidence'
  );

  mustNot(
    /INSERT INTO private\.offering_route_evidence/,
    '0027 must not create route evidence'
  );

  mustNot(
    /INSERT INTO public\.(alignments|journeys)/,
    '0027 must not create operational movement rows'
  );

  mustNot(
    /\b(price|payment|settlement|wallet|detour)\b/i,
    'Unexpected financial/matching scope'
  );
});

test('no provider vendor is hardwired', () => {
  mustNot(
    /\b(Google|Mapbox|HERE|Valhalla|OSRM|Nominatim)\b/i,
    'Provider vendor was hardwired'
  );
});

test('no network calls or secrets are introduced', () => {
  mustNot(
    /\b(http:\/\/|https:\/\/|fetch\s*\(|curl\b|api[_-]?key|secret[_-]?key)\b/i,
    'Unexpected network/provider-secret behavior'
  );
});

test('no existing movement-context protection helper is replaced', () => {
  mustNot(
    /CREATE OR REPLACE FUNCTION private\.protect_movement_context_record/,
    '0022 movement-location protection must remain unchanged'
  );

  mustNot(
    /CREATE OR REPLACE FUNCTION private\.protect_movement_context_child/,
    '0022 relationship protection must remain unchanged'
  );
});
test('rollback behavioral harness has one outer transaction and never commits', () => {
  const stripped = liveRaw
    .replace(/'(?:''|[^'])*'/g, "''")
    .replace(/--[^\r\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');

  assert.equal(
    (stripped.match(/^\s*BEGIN\s*;/gm) || []).length,
    1
  );

  assert.equal(
    (stripped.match(/^\s*ROLLBACK\s*;/gm) || []).length,
    1
  );

  assert.equal(
    (stripped.match(/^\s*COMMIT\s*;/gm) || []).length,
    0
  );

  assert.match(stripped, /ROLLBACK\s*;\s*$/);
});

test('rollback harness does not weaken database enforcement', () => {
  assert.doesNotMatch(
    liveRaw,
    /\bDISABLE\s+TRIGGER\b/i
  );

  assert.doesNotMatch(
    liveRaw,
    /\bALTER\s+TABLE\b[^;]*\bDISABLE\s+ROW\s+LEVEL\s+SECURITY\b/i
  );

  assert.doesNotMatch(
    liveRaw,
    /\bDROP\s+(TABLE|FUNCTION|TRIGGER|POLICY)\b/i
  );

  assert.doesNotMatch(
    liveRaw,
    /\bTRUNCATE\b/i
  );

  assert.doesNotMatch(
    liveRaw,
    /\bGRANT\b[^;]*\bTO\s+(authenticated|anon|service_role)\b/i
  );
});

test('rollback harness exercises real authenticated JWT identity', () => {
  assert.match(
    liveRaw,
    /set_config\(\s*'request\.jwt\.claim\.sub'/
  );

  assert.match(
    liveRaw,
    /set_config\(\s*'request\.jwt\.claims'/
  );

  assert.match(
    liveRaw,
    /set_config\(\s*'role'\s*,\s*p_role/
  );

  assert.match(
    liveRaw,
    /jsonb_build_object\(\s*'sub'\s*,\s*p_member\s*,\s*'role'\s*,\s*p_role/
  );
});

test('rollback harness uses the real 0027 RPC rather than duplicating its logic', () => {
  const calls =
    liveRaw.match(
      /public\.record_selected_location_for_member\s*\(/g
    ) || [];

  assert.ok(
    calls.length >= 8,
    `Expected many real RPC calls, found ${calls.length}`
  );

  assert.doesNotMatch(
    liveRaw,
    /CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+public\.record_selected_location_for_member/i
  );
});

test('behavioral matrix covers success replay rejection ACL and immutability', () => {
  const requiredNames = [
    'authenticated member can record a selected provider result',
    'selected location owner is derived from auth uid',
    'selected location contains no trusted coordinates or resolution result',
    'exact retry returns the original location identity',
    'changed label replay is rejected',
    'changed provider reference replay is rejected',
    'another member cannot reuse the first member request identity',
    'second member can create an independent selection',
    'blank selected label is rejected',
    'untrimmed selected label is rejected',
    'anonymous role cannot execute selected-location writer',
    'service role cannot execute member selected-location writer',
    'authenticated client cannot directly read private selection receipts',
    'authenticated client cannot directly insert private selection receipts',
    'receipt no-op update is rejected',
    'receipt deletion is rejected',
    'selected-location intake creates no offering intent',
    'selected-location intake creates no route evidence',
    'selected-location intake creates no trusted resolution evidence',
    'selected locations have no resolution evidence'
  ];

  for (const name of requiredNames) {
    assert.ok(
      liveRaw.includes(`'${name}'`),
      `Missing behavioral check: ${name}`
    );
  }
});

test('behavioral harness leaves later-stage location resolution untouched', () => {
  assert.match(
    liveRaw,
    /before_resolutions/
  );

  assert.match(
    liveRaw,
    /after_resolutions/
  );

  assert.match(
    liveRaw,
    /private\.movement_location_resolution_evidence/
  );

  assert.match(
    liveRaw,
    /resolution_status\s*=\s*'unresolved'/
  );

  assert.match(
    liveRaw,
    /latitude\s+IS\s+NULL/
  );

  assert.match(
    liveRaw,
    /longitude\s+IS\s+NULL/
  );
});

test('behavioral harness prints named results and a failed-count summary', () => {
  assert.match(
    liveRaw,
    /SELECT\s+check_number,\s*test_name,\s*passed\s+FROM pg_temp\.selected_location_test_results/i
  );

  assert.match(
    liveRaw,
    /count\(\*\)\s+FILTER\s*\(WHERE NOT passed\)\s+AS failed/i
  );
});