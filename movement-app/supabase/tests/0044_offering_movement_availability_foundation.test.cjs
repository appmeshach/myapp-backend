const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const test = require('node:test');

const name = '0044_offering_movement_availability_foundation';
const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/\r\n/g, '\n');
const raw = read(`../migrations/${name}.sql`);
const sql = raw.replace(/--[^\n]*/g, '');
const live = read(`${name}_test.sql`);
const fn = (name, tag) => sql.slice(sql.indexOf(`CREATE FUNCTION ${name}`), sql.indexOf(`\n$${tag}$;`) + tag.length + 5);
const open = fn('public.open_offering_movement_availability', 'open');
const discover = fn('public.discover_offering_movement_availability', 'discover');
const check = fn('private.assert_offering_movement_availability', 'assert');
const protect = fn('private.protect_offering_movement_availability', 'protect');

// Local review only: one transaction contains both installation and fixtures.
// psql ON_ERROR_STOP closes the connection and rolls back on any failure.
if (process.argv.includes('--print-rollback')) {
  process.stdout.write(raw.replace(/COMMIT;\s*$/, '') +
    live.replace(/^BEGIN;\s*SET TRANSACTION ISOLATION LEVEL READ COMMITTED;/, '') +
    "\nDO $restore$ BEGIN IF to_regclass('private.offering_movement_availability') IS NOT NULL THEN RAISE EXCEPTION '0044 survived rollback'; END IF; END; $restore$;\n");
  process.exit(0);
}

test('0044 contains one transaction and only one private operational table', () => {
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /COMMIT;\s*$/);
  assert.equal((sql.match(/^BEGIN;/gm) || []).length, 1);
  assert.equal((sql.match(/^COMMIT;/gm) || []).length, 1);
  assert.deepEqual([...sql.matchAll(/CREATE TABLE ([\w.]+)/g)].map(m => m[1]), ['private.offering_movement_availability']);
  assert.doesNotMatch(sql, /CREATE OR REPLACE|DROP\s|DISABLE|CREATE POLICY|TRUNCATE/i);
});

test('exact private bindings, bounded integer capacity and one availability lifetime', () => {
  for (const fragment of [
    'offering_movement_intent_id uuid NOT NULL UNIQUE', 'offering_member_id uuid NOT NULL REFERENCES public.members(id)',
    'route_evidence_id uuid NOT NULL REFERENCES private.offering_route_evidence(id)',
    'route_evidence_version integer NOT NULL CHECK (route_evidence_version >= 1)',
    'vehicle_id uuid NOT NULL REFERENCES public.vehicles(id)',
    'total_places integer NOT NULL CHECK (total_places >= 1)',
    'remaining_places integer NOT NULL CHECK (remaining_places BETWEEN 0 AND total_places)',
    'UNIQUE (offering_member_id,request_id)', "status IN ('open','full','withdrawn','expired','unavailable')",
  ]) assert.ok(sql.includes(fragment), fragment);
});

test('all definer functions pin search_path and all grants are narrow', () => {
  const functions = [...sql.matchAll(/CREATE FUNCTION ([\w.]+)\(/g)].map(m => m[1]);
  assert.equal(functions.length, 5);
  assert.equal((sql.match(/SECURITY DEFINER SET search_path = ''/g) || []).length, 5);
  for (const name of functions) assert.ok(sql.includes(`REVOKE ALL ON FUNCTION ${name}(`));
  assert.equal((sql.match(/FROM PUBLIC,anon,authenticated,service_role;/g) || []).length, 6);
  assert.deepEqual([...sql.matchAll(/GRANT[^;]+;/g)].map(m => m[0]), [
    'GRANT SELECT ON private.offering_movement_availability TO service_role;',
    'GRANT EXECUTE ON FUNCTION public.open_offering_movement_availability(uuid,uuid,uuid,integer) TO authenticated;',
    'GRANT EXECUTE ON FUNCTION public.discover_offering_movement_availability(integer) TO authenticated;',
  ]);
  assert.match(sql, /ALTER TABLE private.offering_movement_availability ENABLE ROW LEVEL SECURITY/);
});

test('opening derives auth, own intent and route, never accepts client geographic facts', () => {
  assert.match(open, /v_member_id uuid := auth.uid\(\)/);
  assert.match(open, /SELECT 1 FROM public.members m WHERE m.id=v_member_id/);
  assert.match(open, /x.id=p_offering_movement_intent_id AND x.offering_member_id=v_member_id FOR UPDATE/);
  assert.match(open, /x.offering_movement_intent_id=i.id AND x.offering_member_id=v_member_id AND x.status='current' FOR UPDATE/);
  assert.match(open, /private.assert_offering_movement_intent\(i.id\)/);
  assert.match(open, /private.assert_offering_route_evidence\(e.id\)/);
  assert.doesNotMatch(open, /p_member_id|p_route|p_provider|p_latitude|p_longitude|p_origin|p_destination/);
  assert.match(sql, /AFTER INSERT ON private.offering_movement_availability/);
  assert.match(sql, /private.assert_offering_movement_availability\(NEW.id\)/);
});

test('retries serialize and reject different facts without rebinding or resetting capacity', () => {
  assert.match(open, /pg_advisory_xact_lock\(hashtextextended\('availability:'/);
  assert.match(open, /a.offering_movement_intent_id IS DISTINCT FROM i.id/);
  assert.match(open, /a.vehicle_id IS DISTINCT FROM p_vehicle_id OR a.total_places IS DISTINCT FROM p_total_places/);
  assert.match(open, /private.assert_offering_movement_availability\(a.id\);\s+RETURN QUERY SELECT a.id/);
  assert.doesNotMatch(open, /\bUPDATE\s+private\./);
});

test('private assertion revalidates locked authoritative dependencies and capacity', () => {
  for (const fragment of [
    "current_setting('transaction_isolation')<>'read committed'", 'private.assert_offering_movement_intent(i.id)',
    'private.assert_offering_route_evidence(e.id)', 'e.offering_movement_intent_id IS DISTINCT FROM i.id',
    'a.offering_member_id IS DISTINCT FROM i.offering_member_id', 'e.offering_member_id IS DISTINCT FROM a.offering_member_id',
    'e.version IS DISTINCT FROM a.route_evidence_version', 'WHERE x.id=p_availability_id FOR UPDATE',
    'WHERE v.id=a.vehicle_id FOR SHARE', 'mva.member_id=a.offering_member_id AND mva.active FOR SHARE',
    'a.total_places>v_capacity', "a.status<>'open'", 'a.remaining_places<1', 'a.expires_at<=clock_timestamp()',
    'i.earliest_departure_at<=clock_timestamp()',
  ]) assert.ok(check.includes(fragment), fragment);
});

test('history and bindings immutable, terminal rows cannot reopen, capacity cannot increase', () => {
  assert.match(protect, /TG_OP='DELETE'/);
  assert.match(protect, /to_jsonb\(NEW\)-'status'-'remaining_places'-'updated_at'/);
  assert.match(protect, /OLD.status<>'open' AND NEW IS DISTINCT FROM OLD/);
  assert.match(protect, /NEW.remaining_places>OLD.remaining_places/);
  assert.match(protect, /NEW.status='expired' AND OLD.expires_at>clock_timestamp\(\)/);
});

test('discovery output is an exact privacy allowlist with no precise-label fallback', () => {
  const output = discover.match(/RETURNS TABLE \(([^]*?)\n\)/)[1];
  assert.deepEqual(output.trim().split(/,\s*/).map(s => s.trim()), [
    'availability_id uuid', 'origin_area text', 'destination_area text', 'earliest_departure_at timestamptz',
    'latest_departure_at timestamptz', 'remaining_places integer', 'make text', 'model text', 'year integer', 'color text',
  ]);
  assert.equal((discover.match(/JOIN private.trusted_location_discovery_areas/g) || []).length, 2);
  assert.match(discover, /SELECT a.id,od.discovery_area_label,dd.discovery_area_label/);
  assert.doesNotMatch(discover, /declared_label|latitude|longitude|route_shape|provider_namespace|plate_number|email|phone|COALESCE/i);
});

test('discovery excludes own, non-open, depleted, stale and ineligible rows', () => {
  for (const fragment of [
    'a.offering_member_id<>v_member_id', "a.status='open'", 'a.remaining_places>0', 'a.expires_at>clock_timestamp()',
    'a.total_places<=v.seat_capacity', "i.status='current'", 'i.earliest_departure_at>clock_timestamp()',
    "e.status='current'", 'e.version=a.route_evidence_version', 'mva.member_id=a.offering_member_id AND mva.active',
    'i.expires_at>clock_timestamp()', 'e.expires_at>clock_timestamp()',
    'ol.expires_at>clock_timestamp()', 'dl.expires_at>clock_timestamp()',
    "ol.source_kind='provider_resolved'", "dl.source_kind='provider_resolved'", 'LIMIT p_limit',
  ]) assert.ok(discover.includes(fragment), fragment);
});

test('0042 remains unchanged and no operational acceptance or interest writes are added', () => {
  assert.equal(crypto.createHash('sha256').update(read('../migrations/0042_trusted_movement_offer_authorization.sql')).digest('hex'),
    'c41da59fc4051e4cdb805e77337627fc7789460834f64530ee0f4897756f18ab');
  assert.doesNotMatch(sql, /public\.(?:create_movement_offer|accept_movement_offer|alignments|movement_offers|movement_needs)|detour|journeys|payment|pricing/i);
  assert.deepEqual([...sql.matchAll(/INSERT INTO ([\w.]+)/g)].map(m => m[1]), ['private.offering_movement_availability']);
});

test('behavioral harness uses trusted fixtures, checks failures and always rolls back', () => {
  assert.match(live, /^BEGIN;/);
  assert.match(live, /ROLLBACK;\s*$/);
  assert.doesNotMatch(live, /COMMIT;|DISABLE TRIGGER/);
  assert.match(live, /record_verified_selected_location_for_server/);
  assert.match(live, /record_attested_location_resolution_for_server/);
  assert.match(live, /WHERE NOT passed/);
  for (const label of ['unauthenticated caller rejected', 'cannot expose another members intent',
    'route from different intent or member rejected', 'inactive vehicle access rejected', 'capacity above vehicle rejected',
    'valid opening succeeds without requester', 'identical retry returns original availability',
    'eligible other member visible with trusted broad labels', 'own availability excluded',
    'discovery has only the ten safe output fields', 'no trusted area means no discovery fallback',
    'expired availability excluded', 'authenticated lacks direct ']) assert.ok(live.includes(label), label);
});
