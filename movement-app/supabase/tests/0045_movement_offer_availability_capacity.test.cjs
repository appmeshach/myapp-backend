const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const test = require('node:test');
const name = '0045_movement_offer_availability_capacity';
const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/\r\n/g, '\n');
const raw = read(`../migrations/${name}.sql`);
const sql = raw.replace(/--[^\n]*/g, '');
const live = read(`${name}_test.sql`);
const prior = read('../migrations/0042_trusted_movement_offer_authorization.sql').replace(/--[^\n]*/g, '');
const availability = read('../migrations/0044_offering_movement_availability_foundation.sql');
const create = sql.slice(sql.indexOf('CREATE FUNCTION public.create_movement_offer('), sql.indexOf('$create_trusted_movement_offer$;'));
const accept = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.accept_movement_offer('));
const binding = sql.slice(sql.indexOf('CREATE FUNCTION private.assert_movement_offer_availability_binding'), sql.indexOf('$assert$;'));
const normalized = s => s.replace(/\s+/g, ' ').trim();

if (process.argv.includes('--print-rollback')) {
  process.stdout.write(raw.replace(/COMMIT;\s*$/, '') +
    live.replace(/^BEGIN;[\s\S]*?SET TRANSACTION ISOLATION LEVEL READ COMMITTED;/, '') +
    "\nDO $restored$ BEGIN IF to_regclass('private.movement_offer_availability_bindings') IS NOT NULL THEN RAISE EXCEPTION '0045 survived rollback'; END IF; IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.create_movement_offer(uuid,uuid,uuid,integer,text,text,integer)'::regprocedure AND 'p_vehicle_id'=ANY(proargnames)) THEN RAISE EXCEPTION 'Original RPC not restored'; END IF; END; $restored$;\n");
  process.exit(0);
}

test('0042 and 0044 remain byte-identical modulo line endings', () => {
  for (const [file, hash] of Object.entries({
    '0042_trusted_movement_offer_authorization': 'c41da59fc4051e4cdb805e77337627fc7789460834f64530ee0f4897756f18ab',
    '0044_offering_movement_availability_foundation': '9bd7080c7023401afd622352e111a89d5c08f19c6c153202d9ec71462529149c',
  })) assert.equal(crypto.createHash('sha256').update(read(`../migrations/${file}.sql`)).digest('hex'), hash);
});

test('one outer transaction and one private immutable history table', () => {
  assert.equal((sql.match(/^BEGIN;/gm) || []).length, 1);
  assert.equal((sql.match(/^COMMIT;/gm) || []).length, 1);
  assert.deepEqual([...sql.matchAll(/CREATE TABLE ([\w.]+)/g)].map(m => m[1]), ['private.movement_offer_availability_bindings']);
  assert.match(sql, /movement_offer_id uuid PRIMARY KEY,\s+movement_need_id uuid NOT NULL,/);
  assert.match(sql, /availability_id uuid NOT NULL REFERENCES private.offering_movement_availability\(id\)/);
  assert.match(sql, /BEFORE UPDATE OR DELETE ON private.movement_offer_availability_bindings/);
  assert.match(sql, /MESSAGE='Movement offer availability binding is immutable'/);
});

test('private RLS, ACL and all definer search paths are explicit', () => {
  assert.match(sql, /ALTER TABLE private.movement_offer_availability_bindings ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(sql, /CREATE POLICY|DISABLE|CASCADE/);
  assert.equal((sql.match(/SECURITY DEFINER/g) || []).length, 6);
  assert.equal((sql.match(/SET search_path = ''/g) || []).length, 6);
  for (const helper of ['protect_movement_offer_availability_binding()', 'lock_offer_availability_intent(uuid,uuid)',
    'assert_movement_offer_availability_binding(uuid)', 'validate_movement_offer_availability_binding()']) {
    assert.ok(sql.includes(`REVOKE ALL ON FUNCTION private.${helper}\nFROM PUBLIC,anon,authenticated,service_role;`));
  }
  assert.equal((sql.match(/GRANT /g) || []).length, 3);
  assert.match(sql, /GRANT SELECT ON private.movement_offer_availability_bindings TO service_role/);
});

test('old named vehicle overload is dropped and new creation derives vehicle from availability', () => {
  assert.match(sql, /REVOKE ALL ON FUNCTION public.create_movement_offer\(uuid,uuid,uuid,integer,text,text,integer\)\s+FROM PUBLIC,anon,authenticated,service_role;\s+DROP FUNCTION public.create_movement_offer\(uuid,uuid,uuid,integer,text,text,integer\)/);
  assert.match(create, /p_movement_need_id uuid,\s+p_route_match_evidence_id uuid,\s+p_availability_id uuid,\s+p_seats_offered integer/);
  assert.doesNotMatch(create, /p_vehicle_id/);
  assert.match(create, /v_availability.vehicle_id/);
  assert.match(create, /v_member_id := auth.uid\(\)/);
  assert.match(create, /SELECT 1 FROM public.members m WHERE m.id=v_member_id/);
});

test('creation preserves every prior explicit rejection and both route authorization checks', () => {
  const original = prior.slice(prior.indexOf('CREATE FUNCTION public.create_movement_offer('), prior.indexOf('$create_trusted_movement_offer$;'));
  for (const match of original.matchAll(/RAISE EXCEPTION[\s\S]*?;/g)) {
    const rejection = normalized(match[0]).replace('Vehicle is required', 'Availability is required');
    assert.ok(normalized(create).includes(rejection), rejection);
  }
  assert.match(create, /private.assert_trusted_route_match_evidence\(\s+v_evidence.id/);
  assert.match(create, /private.assert_movement_offer_route_match_binding\(\s+v_offer_id/);
  assert.match(create, /private.assert_offering_movement_availability\(v_availability.id\)/);
  assert.match(create, /v_need_record.people_count>v_availability.remaining_places/);
  assert.match(create, /p_seats_offered>v_availability.total_places/);
  assert.match(create, /INSERT INTO private.movement_offer_availability_bindings/);
  assert.doesNotMatch(create, /UPDATE private.offering_movement_availability/);
});

test('binding proves same need member intent vehicle and exact route/version', () => {
  for (const fact of ['o.movement_need_id IS DISTINCT FROM n.id', 'o.offering_member_id IS DISTINCT FROM b.offering_member_id',
    'rb.offering_movement_intent_id IS DISTINCT FROM b.offering_movement_intent_id',
    'a.offering_movement_intent_id IS DISTINCT FROM b.offering_movement_intent_id',
    'a.offering_member_id IS DISTINCT FROM b.offering_member_id', 'a.vehicle_id IS DISTINCT FROM o.vehicle_id',
    'a.route_evidence_id IS DISTINCT FROM e.route_evidence_id', 'a.route_evidence_version IS DISTINCT FROM e.route_evidence_version']) {
    assert.ok(binding.includes(fact), fact);
  }
  assert.match(binding, /private.assert_movement_offer_route_match_binding\(o.id\)/);
  assert.match(binding, /private.assert_offering_movement_availability\(a.id\)/);
});

test('locks retain need then offer, prelock intent before shared route validation, and lock availability FOR UPDATE', () => {
  assert.ok(accept.indexOf('WHERE mn.id = v_need_id;') < 0);
  assert.match(accept, /WHERE mn.id = v_need_id\s+FOR UPDATE/);
  assert.match(accept, /mo.movement_need_id = v_need_record.id\s+FOR UPDATE/);
  assert.ok(binding.indexOf('private.lock_offer_availability_intent') < binding.indexOf('private.assert_movement_offer_route_match_binding'));
  assert.ok(create.indexOf('private.lock_offer_availability_intent') < create.indexOf('private.assert_trusted_route_match_evidence'));
  assert.match(sql, /WHERE nl.movement_need_id=p_need_id ORDER BY lr.id FOR SHARE OF lr;\s+PERFORM 1 FROM private.offering_movement_intents i WHERE i.id=p_intent_id FOR UPDATE/);
  assert.match(availability, /WHERE x.id=p_availability_id FOR UPDATE/);
  assert.match(binding, /SELECT x\.\* INTO STRICT a FROM private.offering_movement_availability x WHERE x.id=b.availability_id;\s+IF o.status/);
});

test('acceptance keeps every 0042 rejection and operational write unchanged', () => {
  const oldAccept = prior.slice(prior.indexOf('CREATE OR REPLACE FUNCTION public.accept_movement_offer('));
  for (const m of oldAccept.matchAll(/RAISE EXCEPTION[\s\S]*?;/g)) assert.ok(normalized(accept).includes(normalized(m[0])), m[0]);
  assert.equal(normalized(accept.slice(accept.indexOf('INSERT INTO public.alignments'))),
    normalized(oldAccept.slice(oldAccept.indexOf('INSERT INTO public.alignments'))));
  assert.equal((accept.match(/private.assert_movement_offer_availability_binding/g) || []).length, 2);
  assert.match(accept, /mp.role='primary_requester' AND mp.status='confirmed'/);
  assert.match(accept, /mp.member_id=v_offer_record.offering_member_id/);
});

test('only acceptance consumes full people_count with guarded atomic open/full transition', () => {
  assert.equal((sql.match(/UPDATE private.offering_movement_availability/g) || []).length, 1);
  assert.match(accept, /SET remaining_places=a.remaining_places-v_need_record.people_count,\s+status=CASE WHEN a.remaining_places=v_need_record.people_count THEN 'full' ELSE 'open' END/);
  assert.match(accept, /WHERE a.id=v_availability_id AND a.status='open'\s+AND a.remaining_places>=v_need_record.people_count;\s+IF NOT FOUND THEN/);
  assert.ok(accept.indexOf('UPDATE private.offering_movement_availability') < accept.indexOf('INSERT INTO public.alignments'));
  assert.doesNotMatch(accept, /EXCEPTION\s+WHEN|remaining_places\s*[-+]\s*(?:1|p_|v_offer_record.seats_offered)/);
});

test('public return shapes remain identical without added private evidence', () => {
  const tables = s => [...s.matchAll(/RETURNS TABLE \([\s\S]*?\)/g)].map(m => normalized(m[0]));
  assert.deepEqual(tables(sql), tables(prior).slice(-2));
  assert.doesNotMatch(sql, /max_detour|INSERT INTO public.journeys|INSERT INTO.*interest/i);
});

test('rollback harness covers sequential contention, group atomicity and post-decrement failure', () => {
  assert.match(live, /NOT a simultaneous-session concurrency test/);
  assert.match(live, /ROLLBACK;\s*$/);
  assert.match(live, /WHERE NOT passed/);
  assert.doesNotMatch(live, /DISABLE TRIGGER|COMMIT;/);
  for (const label of ['old named overload absent', 'same member mismatched availability intent rejected',
    'multiple pending offers coexist without reserving capacity', 'later alignment failure rolls back capacity and offer transitions',
    'two person group cannot partially consume final one place', 'next valid acceptance exhausts capacity and marks full',
    'later competing pending offer cannot overbook full availability', 'expired availability cannot authorize offer creation']) assert.ok(live.includes(label), label);
});
