const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const migrationPath = 'supabase/migrations/0021_financial_proposal_foundation.sql';
// Preserve quoted strings, but remove comments before inspecting executable SQL.
function withoutComments(source) {
  return source.replace(/'(?:''|[^'])*'|--[^\r\n]*|\/\*[\s\S]*?\*\//g,
    token => token.startsWith("'") ? token : ' ');
}
const sql = withoutComments(fs.readFileSync(migrationPath, 'utf8'));
const live = withoutComments(fs.readFileSync('supabase/tests/0021_financial_proposal_foundation_test.sql', 'utf8'));

function mustMatch(re, message) {
  assert.match(sql, re, message);
}

function mustNotMatch(re, message) {
  assert.doesNotMatch(sql, re, message);
}

test('0021 creates only the intended private proposal foundation tables', () => {
  const creates = [...sql.matchAll(/CREATE\s+TABLE\s+([A-Za-z0-9_."]+)/gi)]
    .map(m => m[1].replaceAll('"', '').toLowerCase());

  assert.deepEqual(
    creates,
    [
      'private.financial_proposals',
      'private.financial_proposal_travellers',
    ],
  );
});

test('0021 does not redefine existing operational functions', () => {
  const forbidden = [
    'create_movement_offer',
    'accept_movement_offer',
    'create_alignment_activation_payment',
    'get_my_activation_payment_status',
    'mark_alignment_activation_payment_succeeded',
    'assert_alignment_face_ready',
    'has_current_alignment_face_check',
    'require_alignment_face_verification',
    'get_post_activation_people',
    'get_post_activation_vehicle',
    'resolve_post_activation_photo_for_server',
    'request_journey_start',
    'confirm_journey_start',
    'request_my_movement_start',
    'confirm_my_movement_start',
    'request_movement_end',
    'confirm_movement_end',
    'decline_movement_end',
    'close_mutual_no_travel',
    'get_my_movement_settlement_status',
  ];

  for (const name of forbidden) {
    assert.doesNotMatch(
      sql,
      new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:public\\.|private\\.)?${name}\\b`, 'i'),
      `${name} must not be redefined by 0021`,
    );
  }
});

test('0021 does not attach triggers to existing operational tables', () => {
  const triggerOns = [...sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?TRIGGER\b[^;]*?\bON\s+([A-Za-z0-9_."]+)/gi)]
    .map(m => m[1].replaceAll('"', '').toLowerCase());

  assert.equal(triggerOns.length, 4, 'expected exactly four proposal triggers');
  assert.ok(
    triggerOns.every(name =>
      name === 'private.financial_proposals' ||
      name === 'private.financial_proposal_travellers'),
    `unexpected trigger target(s): ${triggerOns.join(', ')}`,
  );
});

test('0021 introduces no public or client proposal RPC', () => {
  mustNotMatch(
    /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.[^(]*proposal/i,
    'no public proposal function may be created',
  );
  mustNotMatch(
    /\bGRANT\s+EXECUTE\b[\s\S]*\bTO\s+(?:PUBLIC|anon|authenticated)\b/i,
    'no proposal helper may be granted to app roles',
  );
});

test('proposal foundation remains private with RLS and restricted privileges', () => {
  mustMatch(/ALTER\s+TABLE\s+private\.financial_proposals\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
  mustMatch(/ALTER\s+TABLE\s+private\.financial_proposal_travellers\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
  mustMatch(
    /REVOKE\s+ALL\s+ON\s+private\.financial_proposals\s*,\s*private\.financial_proposal_travellers[\s\S]*FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i,
  );
  mustMatch(
    /GRANT\s+SELECT\s+ON\s+private\.financial_proposals\s*,\s*private\.financial_proposal_travellers\s+TO\s+service_role/i,
  );
});

test('proposal helpers are private, definer-isolated, and not executable by app/service roles', () => {
  for (const fn of [
    'assert_financial_proposal_context',
    'protect_financial_proposal',
    'protect_financial_proposal_traveller',
    'validate_financial_proposal',
  ]) {
    const definition = sql.match(new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+private\\.${fn}\\b[\\s\\S]*?\\$\\$;`, 'i'))?.[0];
    assert.ok(definition, fn);
    assert.match(definition, /SECURITY\s+DEFINER\s+SET\s+search_path\s*=\s*''/i);
    mustMatch(
      new RegExp(`REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+private\\.${fn}\\([^;]*\\)\\s+FROM\\s+PUBLIC\\s*,\\s*anon\\s*,\\s*authenticated\\s*,\\s*service_role`, 'i'),
      `${fn} must not be executable by PUBLIC/anon/authenticated/service_role`,
    );
  }
});

test('money uses integer minor units and no floating-point monetary columns', () => {
  mustMatch(/quoted_platform_fee_total_minor\s+bigint\s+NOT\s+NULL/i);
  mustMatch(/quoted_movement_contribution_minor\s+bigint\s+NOT\s+NULL/i);
  mustNotMatch(
    /quoted_(?:platform_fee_total|movement_contribution)_minor\s+(?:real|double\s+precision|numeric|decimal)\b/i,
  );
});

test('zero is explicit and unknown amounts cannot be null', () => {
  mustMatch(/quoted_platform_fee_total_minor\s+bigint\s+NOT\s+NULL\s+CHECK\s*\(\s*quoted_platform_fee_total_minor\s*>=\s*0\s*\)/i);
  mustMatch(/quoted_movement_contribution_minor\s+bigint\s+NOT\s+NULL\s+CHECK\s*\(\s*quoted_movement_contribution_minor\s*>=\s*0\s*\)/i);
});

test('0021 does not invent route, distance, overlap, detour, or cost measurements', () => {
  mustNotMatch(/\b(?:distance|overlap|detour)_(?:km|meters?|metres?|miles?)\b/i);
  mustNotMatch(/\b(?:fuel|energy|toll|route)_cost(?:_minor)?\b/i);
  mustNotMatch(/\broute_duration(?:_minutes|_seconds)?\b/i);
  mustMatch(/route_evidence_id\s+uuid\s+CHECK\s*\(\s*route_evidence_id\s+IS\s+NULL\s*\)/i);
});

test('no maps or routing vendor is hard-coded', () => {
  mustNotMatch(/\b(?:google\s*maps|mapbox|here\s+maps|tomtom|openrouteservice|graphhopper|valhalla)\b/i);
});

test('proposal versions are unique and only one current context is allowed', () => {
  mustMatch(/UNIQUE\s*\(\s*movement_need_id\s*,\s*offering_member_id\s*,\s*version\s*\)/i);
  mustMatch(
    /CREATE\s+UNIQUE\s+INDEX\s+financial_proposals_one_current[\s\S]*ON\s+private\.financial_proposals\s*\(\s*movement_need_id\s*,\s*offering_member_id\s*\)\s+WHERE\s+status\s*=\s*'current'/i,
  );
});

test('proposal history and roster history are protected from deletion', () => {
  mustMatch(/Proposal history cannot be deleted/i);
  mustMatch(/Proposal roster history is immutable/i);
  mustNotMatch(/ON\s+DELETE\s+CASCADE/i);
});

test('proposal economics and input snapshots are immutable after insert', () => {
  mustMatch(/Proposal economics and snapshots are immutable/i);
  mustMatch(/Superseded proposal is immutable/i);
  mustMatch(/Materialized proposal is immutable/i);
});

test('acceptance and links are write-once and requester acceptance cannot stand alone', () => {
  mustMatch(/Proposal consent and links are write-once/i);
  mustMatch(/Proposal consent requires its bound movement offer/i);
  mustMatch(/Bound movement offer requires offering-member acceptance/i);
  mustMatch(/Requester acceptance must materialize in the same transaction/i);
});

test('exact confirmed roster is required and pending invite blocks proposal validity', () => {
  mustMatch(/Proposal requires the exact complete confirmed roster/i);
  mustMatch(/mp\.status\s*=\s*'confirmed'/i);
  mustMatch(/mp\.status\s*=\s*'invited'/i);
  mustMatch(/financial_proposal_travellers/i);
});

test('offer binding must match proposal snapshot', () => {
  mustMatch(/Proposal offer binding does not match/i);
  mustMatch(/Unmaterialized proposal requires a pending bound offer/i);
  mustMatch(/Materialized proposal requires an accepted bound offer/i);
});

test('materialization validates matching alignment and 0020 agreement', () => {
  mustMatch(/private\.financial_agreements/i);
  mustMatch(/private\.financial_components/i);
  mustMatch(/Proposal materialization does not match/i);
  mustMatch(/component_key\s*=\s*'movement_contribution'/i);
});

test('0021 does not automatically create alignments, agreements, payments, or settlements', () => {
  mustNotMatch(/\bINSERT\s+INTO\s+public\.alignments\b/i);
  mustNotMatch(/\bINSERT\s+INTO\s+private\.financial_agreements\b/i);
  mustNotMatch(/\bINSERT\s+INTO\s+private\.financial_components\b/i);
  mustNotMatch(/\bINSERT\s+INTO\s+private\.alignment_activation_payments\b/i);
  mustNotMatch(/\bINSERT\s+INTO\s+private\.movement_settlements\b/i);
});

test('0021 contains no proposal issuer or pricing engine', () => {
  mustNotMatch(/\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b[\s\S]*\b(?:issue|publish|price|calculate|compute)_financial_proposal\b/i);
  mustNotMatch(/\bprice_per_(?:km|mile|minute)\b/i);
  mustNotMatch(/\bsurge\b/i);
  mustNotMatch(/\bdemand_multiplier\b/i);
});

test('0021 is transactional', () => {
  const trimmed = sql.trim();
  assert.match(trimmed, /^BEGIN;/i);
  assert.match(trimmed, /COMMIT;\s*$/i);
});

test('migration delimiters balance outside quoted text', () => {
  // A structural regression guard, not a substitute for PostgreSQL execution.
  const code = sql.replace(/'(?:''|[^'])*'/g, "''");
  let depth = 0;
  for (const char of code) {
    if (char === '(') depth++;
    if (char === ')') depth--;
    assert.ok(depth >= 0, 'unmatched closing parenthesis');
  }
  assert.equal(depth, 0);
  assert.equal((code.match(/\$\$/g) || []).length, 8);
});

test('exact helper inventory and no operational mutations or policies', () => {
  assert.deepEqual([...sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w."]+)/gi)]
    .map(m => m[1].replaceAll('"', '').toLowerCase()), [
      'private.assert_financial_proposal_context', 'private.protect_financial_proposal',
      'private.protect_financial_proposal_traveller', 'private.validate_financial_proposal',
    ]);
  mustNotMatch(/\b(?:INSERT\s+INTO|DELETE\s+FROM|UPDATE)\s+(?:public|private)\./i);
  mustNotMatch(/\b(?:CREATE\s+POLICY|ALTER\s+FUNCTION|DROP\s+|TRUNCATE\s+|EXECUTE\s+(?:format\s*\(|'))/i);
  mustNotMatch(/\bGRANT\s+(?!SELECT\b)/i);
  assert.deepEqual([...sql.matchAll(/ALTER\s+TABLE\s+([\w.]+)/gi)].map(m => m[1]),
    ['private.financial_proposals', 'private.financial_proposal_travellers']);
});

test('operational callers and other migrations do not consume proposal tables', () => {
  function walk(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
      e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]);
  }
  for (const file of [...walk('supabase/migrations'), ...walk('src'), ...walk('supabase/functions')]) {
    if (file === migrationPath || !/\.(sql|ts|tsx)$/.test(file)) continue;
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /\bfinancial_proposals\b|\bfinancial_proposal_travellers\b/, file);
  }
});

test('time guards, historical supersession and final-state consent checks remain present', () => {
  mustMatch(/NEW\.created_at > clock_timestamp\(\)/);
  mustMatch(/NEW\.expires_at <= clock_timestamp\(\)/);
  mustMatch(/NEW\.offering_accepted_at>clock_timestamp\(\) OR NEW\.requester_accepted_at>clock_timestamp\(\)/);
  mustMatch(/NEW\.materialized_at>clock_timestamp\(\)/);
  mustMatch(/to_jsonb\(NEW\)-'status'\) IS NOT DISTINCT FROM \(to_jsonb\(OLD\)-'status'\) THEN RETURN NULL/);
  assert.equal((sql.match(/DEFERRABLE INITIALLY DEFERRED/g) || []).length, 2);
  mustMatch(/p\.requester_accepted_at IS NOT NULL AND p\.alignment_id IS NULL/);
  mustMatch(/SELECT \* INTO STRICT p FROM private\.financial_proposals WHERE id=proposal_to_check/);
});

test('rollback harness checks clean baseline, exact errors and durable retry evidence', () => {
  assert.match(live, /^BEGIN;/);
  assert.match(live, /ROLLBACK;\s*$/);
  assert.doesNotMatch(live, /^COMMIT;/m);
  assert.match(live, /SET CONSTRAINTS ALL IMMEDIATE;\s*SET CONSTRAINTS ALL DEFERRED;\s*BEGIN\s*EXECUTE p_sql/);
  assert.match(live, /observed=p_state/);
  assert.match(live, /observed_message=p_message/);
  assert.match(live, /to_jsonb\(p\)=materialized_snapshot/);
  assert.match(live, /count\(\*\)=13 AND bool_and\(value::boolean\)/);
  assert.match(live, /test_name text NOT NULL UNIQUE/);
});
