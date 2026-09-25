const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const test = require('node:test');
const name = '0047_requester_movement_interest_foundation';
const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/\r\n/g, '\n');
const raw = read(`../migrations/${name}.sql`);
const sql = raw.replace(/--[^\n]*/g, '');
const live = read(`${name}_test.sql`);
function body(name, tag) {
  const start = sql.indexOf(`CREATE FUNCTION ${name}(`);
  const end = sql.indexOf(`\n$${tag}$;`, start);
  assert.ok(start >= 0 && end > start, name);
  return sql.slice(start, end);
}
const create = body('public.create_requester_movement_interest', 'create');
const support = body('private.assert_requester_interest_support', 'support');
const check = body('private.assert_requester_movement_interest', 'assert');
const protect = body('private.protect_requester_movement_interest', 'protect');
const withdraw = body('public.withdraw_requester_movement_interest', 'withdraw');
const safeRead = body('public.get_requester_movement_interest', 'read');

// Local installation and all fixtures are enclosed in one rollback transaction.
if (process.argv.includes('--print-rollback')) {
  process.stdout.write(raw.replace(/COMMIT;\s*$/, '') +
    live.replace(/^BEGIN;\s*SET TRANSACTION ISOLATION LEVEL READ COMMITTED;/, '') +
    `\nDO $restore$ BEGIN
      IF to_regclass('private.requester_movement_interests') IS NOT NULL
        OR to_regprocedure('public.create_requester_movement_interest(uuid,uuid,uuid,uuid)') IS NOT NULL
        OR to_regprocedure('public.withdraw_requester_movement_interest(uuid)') IS NOT NULL
        OR to_regprocedure('public.get_requester_movement_interest(uuid)') IS NOT NULL THEN
        RAISE EXCEPTION '0047 survived rollback';
      END IF;
    END; $restore$;
    SELECT '0047 rollback verified: table and public RPCs absent' AS result;\n`);
  process.exit(0);
}

test('0047 raw SQL preserves critical token and comment boundaries', () => {
  assert.doesNotMatch(raw, /LEVELSECURITY|v_member_idAND|Authenticatedmember/);
  assert.match(raw, /^ALTER TABLE private\.requester_movement_interests ENABLE ROW LEVEL SECURITY;$/m);
  assert.match(raw, /^CREATE FUNCTION private\.assert_requester_interest_support\($/m);
  assert.doesNotMatch(raw, /^\s*--[^\n]*CREATE FUNCTION/m);
  assert.match(safeRead, /x\.offering_member_id=v_member_id AND x\.status='active'/);
  for (const fn of [create, withdraw, safeRead]) {
    assert.match(fn, /MESSAGE='Authenticated member required'/);
  }
});

test('0047 preserves all reviewed trusted matching and availability migrations', () => {
  for (const [file, hash] of Object.entries({
    '0037_trusted_route_match_evidence_foundation': '3bd5eb98b8f63d72cddf0f86831c7703d5d1fda2a5cd0358d0a5b00bbed64b91',
    '0038_trusted_route_match_evidence_writer': 'd309d970d989ac00b633895c661e70765e561e8f0cc6bbd4a624c830db14bfe9',
    '0042_trusted_movement_offer_authorization': 'c41da59fc4051e4cdb805e77337627fc7789460834f64530ee0f4897756f18ab',
    '0044_offering_movement_availability_foundation': '9bd7080c7023401afd622352e111a89d5c08f19c6c153202d9ec71462529149c',
    '0045_movement_offer_availability_capacity': 'e6525b9fa19e5354555ab0c406109d17329df58855b5accb083e12b967e95e27',
    '0046_requester_availability_matching_context': '2cd9a3fa4aa63859f7035e60462e78cb10768fab57a460d299eeb599999bebff',
  })) assert.equal(crypto.createHash('sha256').update(read(`../migrations/${file}.sql`)).digest('hex'), hash, file);
});

test('0047 creates only one private table in one transaction', () => {
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /COMMIT;\s*$/);
  assert.equal((sql.match(/^BEGIN;/gm) || []).length, 1);
  assert.equal((sql.match(/^COMMIT;/gm) || []).length, 1);
  assert.deepEqual([...sql.matchAll(/CREATE TABLE ([\w.]+)/g)].map(m => m[1]), ['private.requester_movement_interests']);
  assert.doesNotMatch(sql, /CREATE OR REPLACE|DROP\s|DISABLE|CREATE POLICY|TRUNCATE/i);
});

test('interest cardinality permits multiple availabilities and preserves history', () => {
  assert.match(sql, /UNIQUE \(requesting_member_id,request_id\)/);
  assert.match(sql, /CREATE UNIQUE INDEX requester_movement_interests_active_pair\s+ON private.requester_movement_interests \(movement_need_id,availability_id\)\s+WHERE status='active'/);
  assert.doesNotMatch(sql, /movement_need_id uuid[^\n]*UNIQUE|UNIQUE\s*\(movement_need_id\)/i);
  assert.match(sql, /movement_need_id uuid NOT NULL,/);
  assert.match(sql, /route_match_evidence_version integer NOT NULL CHECK \(route_match_evidence_version >= 1\)/);
  assert.match(sql, /status IN \('active','withdrawn','expired'\)/);
  for (const c of ['requesting_member_id <> offering_member_id', 'updated_at >= created_at', 'expires_at > created_at']) {
    assert.ok(sql.includes(`CHECK (${c})`));
  }
});

test('all private helpers and authenticated RPCs have explicit definer security', () => {
  const names = [...sql.matchAll(/CREATE FUNCTION ([\w.]+)\(/g)].map(m => m[1]);
  assert.equal(names.length, 7);
  assert.equal((sql.match(/SECURITY DEFINER SET search_path = ''/g) || []).length, names.length);
  for (const name of names) assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION ${name.replaceAll('.', '\\.')}\\([^;]*?FROM PUBLIC,anon,authenticated,service_role;`));
  assert.match(sql, /ALTER TABLE private.requester_movement_interests ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON private.requester_movement_interests FROM PUBLIC,anon,authenticated,service_role/);
  assert.deepEqual([...sql.matchAll(/GRANT[^;]+;/g)].map(m => m[0]), [
    'GRANT SELECT ON private.requester_movement_interests TO service_role;',
    'GRANT EXECUTE ON FUNCTION public.create_requester_movement_interest(uuid,uuid,uuid,uuid) TO authenticated;',
    'GRANT EXECUTE ON FUNCTION public.withdraw_requester_movement_interest(uuid) TO authenticated;',
    'GRANT EXECUTE ON FUNCTION public.get_requester_movement_interest(uuid) TO authenticated;',
  ]);
});

test('create accepts only public ids and derives all immutable bindings', () => {
  assert.match(create, /p_request_id uuid,p_movement_need_id uuid,p_availability_id uuid,p_route_match_evidence_id uuid/);
  assert.match(create, /v_member_id uuid := auth.uid\(\)/);
  for (const id of ['request_id','movement_need_id','availability_id','route_match_evidence_id']) assert.ok(create.includes(`p_${id} IS NULL`));
  assert.match(create, /current_setting\('transaction_isolation'\)<>'read committed'/);
  assert.match(create, /v_member_id IS NULL OR NOT EXISTS/);
  assert.match(create, /a.offering_movement_intent_id,e.id,e.version,LEAST\(a.expires_at,e.expires_at\)/);
  assert.match(create, /RETURNS TABLE \(interest_id uuid,interest_status text,created_at timestamptz\)/);
  assert.doesNotMatch(create, /p_(?:requesting_member_id|offering_member_id|offering_movement_intent_id|vehicle_id|latitude|longitude|route_shape|route_match_evidence_version)\b/);
});

test('support reuses 0046 lock and capacity contract then validates exact evidence', () => {
  const context = support.indexOf('public.get_requester_availability_matching_context_for_server(');
  const availability = support.indexOf('FROM private.offering_movement_availability');
  const evidence = support.indexOf('FROM private.trusted_route_match_evidence');
  const binding = support.indexOf('IF e.movement_need_id');
  const assertion = support.indexOf('private.assert_trusted_route_match_evidence(e.id)');
  assert.ok(context >= 0 && availability > context && evidence > availability && binding > evidence && assertion > binding);
  assert.match(support, /WHERE x.id=p_evidence_id FOR SHARE/);
  for (const [field, expected] of [
    ['movement_need_id','p_movement_need_id'], ['requesting_member_id','p_requesting_member_id'],
    ['offering_member_id','a.offering_member_id'], ['offering_movement_intent_id','a.offering_movement_intent_id'],
    ['route_evidence_id','a.route_evidence_id'], ['route_evidence_version','a.route_evidence_version'],
  ]) assert.ok(support.includes(`e.${field} IS DISTINCT FROM ${expected}`));
  assert.match(support, /p_requesting_member_id=a.offering_member_id/);
});

test('authoritative assertion locks interest last and immediate insertion invokes it', () => {
  assert.ok(check.indexOf('private.assert_requester_interest_support(') < check.indexOf('FOR SHARE'));
  for (const fragment of ["i.status<>'active'", 'i.expires_at<=clock_timestamp()',
    'i.offering_member_id IS DISTINCT FROM a.offering_member_id',
    'i.offering_movement_intent_id IS DISTINCT FROM a.offering_movement_intent_id',
    'i.route_match_evidence_version IS DISTINCT FROM e.version', 'i.expires_at>LEAST(a.expires_at,e.expires_at)']) assert.ok(check.includes(fragment));
  assert.match(sql, /AFTER INSERT ON private.requester_movement_interests\s+FOR EACH ROW EXECUTE FUNCTION private.validate_requester_movement_interest/);
  assert.match(sql, /PERFORM private.assert_requester_movement_interest\(NEW.id\)/);
});

test('request replay serializes by requester and request and never reopens history', () => {
  assert.match(create, /pg_advisory_xact_lock\(hashtextextended\('requester-interest:'\|\|v_member_id::text\|\|':'\|\|p_request_id::text,0\)\)/);
  for (const field of ['movement_need_id','availability_id','route_match_evidence_id']) assert.ok(create.includes(`i.${field} IS DISTINCT FROM p_${field}`));
  assert.match(create, /IF i.status='active' THEN PERFORM private.assert_requester_movement_interest\(i.id\)/);
  assert.doesNotMatch(create, /\bUPDATE\s+private.requester_movement_interests/i);
});

test('history cannot delete mutate core or reopen and expiry cannot be premature', () => {
  assert.match(protect, /TG_OP='DELETE'[\s\S]*?RAISE EXCEPTION/);
  assert.match(protect, /to_jsonb\(NEW\)-'status'-'updated_at'/);
  assert.match(protect, /OLD.status<>'active' AND NEW IS DISTINCT FROM OLD/);
  assert.match(protect, /NEW.status='expired' AND OLD.expires_at>clock_timestamp\(\)/);
  assert.match(protect, /NEW.updated_at := clock_timestamp\(\)/);
});

test('no interest path writes capacity offers alignments needs participants or journeys', () => {
  const mutations = [...sql.matchAll(/\b(?:INSERT INTO|UPDATE|DELETE FROM)\s+((?:public|private)\.\w+)/g)].map(m => m[1]);
  assert.deepEqual(mutations, ['private.requester_movement_interests', 'private.requester_movement_interests']);
  assert.doesNotMatch(sql, /(?:distance|detour)[\w.]*\s*(?:<|>|BETWEEN)|(?:max_distance|max_detour)/i);
  assert.doesNotMatch(sql, /record_trusted_route_match_evidence_for_server|pg_notify/i);
});

test('withdrawal checks owner locks only interest and never reopens', () => {
  assert.match(withdraw, /x.id=p_interest_id AND x.requesting_member_id=v_member_id FOR UPDATE/);
  assert.match(withdraw, /IF i.status='expired' THEN[\s\S]*?RAISE EXCEPTION/);
  assert.match(withdraw, /IF i.status='active' THEN\s+UPDATE private.requester_movement_interests x SET status='withdrawn'/);
  assert.doesNotMatch(withdraw, /assert_requester_interest_support|offering_movement_availability/);
});

test('offerer read exposes only explicit supported interest and trusted broad areas', () => {
  assert.match(safeRead, /x.id=p_interest_id AND x.offering_member_id=v_member_id AND x.status='active'/);
  assert.match(safeRead, /PERFORM private.assert_requester_movement_interest\(i.id\)/);
  assert.match(safeRead, /EXCEPTION WHEN check_violation OR no_data_found OR raise_exception OR insufficient_privilege THEN\s+RETURN/);
  const returns = safeRead.slice(safeRead.indexOf('RETURNS TABLE'), safeRead.indexOf('LANGUAGE'));
  for (const forbidden of ['latitude','longitude','route_shape','evidence_id','intent_id','member_id','location_reference_id']) assert.ok(!returns.includes(forbidden));
  assert.match(safeRead, /od.discovery_area_label,dd.discovery_area_label/);
  assert.equal((safeRead.match(/JOIN private.trusted_location_discovery_areas/g) || []).length, 2);
  assert.doesNotMatch(safeRead, /n.origin_area|n.destination_area|COALESCE/i);
});

test('behavior harness checks roles historical replay support invalidation and rollback', () => {
  assert.match(live, /^BEGIN;\s+SET TRANSACTION ISOLATION LEVEL READ COMMITTED;/);
  assert.match(live, /ROLLBACK;\s*$/);
  assert.match(live, /RAISE EXCEPTION '0047 interest behavior test failed'/);
  for (const name of [
    'exact request replay', 'same need has active interests in two different availabilities',
    'duplicate active same need availability rejected', 'expired route match evidence rejected',
    'no requester exposure before explicit interest', 'offerer receives exactly safe fields',
    'withdrawal leaves all operational rows unchanged', 'new request permits historical reinterest',
    'new current route cannot authorize old availability', 'expired history cannot reopen',
  ]) assert.ok(live.includes(name), name);
  assert.match(live, /pg_sleep\(2.1\)/);
  assert.doesNotMatch(live, /DISABLE TRIGGER|session_replication_role/);
});
