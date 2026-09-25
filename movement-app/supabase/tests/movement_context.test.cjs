const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const migration = 'supabase/migrations/0022_movement_context_foundation.sql';
const source = fs.readFileSync(migration, 'utf8');
function stripComments(s) {
  return s.replace(/'(?:''|[^'])*'|--[^\r\n]*|\/\*[\s\S]*?\*\//g, t => t.startsWith("'") ? t : ' ');
}
const sql = stripComments(source);
const live = fs.readFileSync('supabase/tests/0022_movement_context_foundation_test.sql', 'utf8');
const tables = ['movement_location_references', 'offering_movement_intents', 'offering_movement_intent_locations',
  'movement_context_snapshots', 'movement_context_snapshot_travellers'];
const helpers = ['protect_movement_context_record', 'protect_movement_context_child', 'assert_offering_movement_intent',
  'validate_offering_movement_intent', 'assert_movement_context_snapshot', 'validate_movement_context_snapshot'];
// Optional output only: never opens a database connection or executes psql.
// Review this batch independently against an isolated local database at 0021.
function installationRollbackBatch() {
  const baseline = live.slice(live.indexOf('CREATE TEMP TABLE context_functions'), live.indexOf('CREATE FUNCTION pg_temp.context_check'))
    .replace(/\bcontext_(functions|tables|data)\b/g, 'install_$1').replace(/ ON COMMIT DROP/g, '');
  const migrationBody = source.replace(/^BEGIN;\s*/, '').replace(/COMMIT;\s*$/, '');
  const testBody = live.replace(/^BEGIN;\s*/, '').replace('SET TRANSACTION ISOLATION LEVEL READ COMMITTED;', '');
  const relations = tables.map(t => `to_regclass('private.${t}') IS NULL`).join(' AND\n    ');
  const functions = helpers.map(f => `to_regprocedure('private.${f}(${f.startsWith('assert_') ? 'uuid' : ''})') IS NULL`).join(' AND\n    ');
  return `-- Generated review batch: database must be isolated and at migration 0021.
-- Baselines intentionally live outside the installation transaction.
DO $$ BEGIN
  IF NOT (${relations}) OR NOT (${functions}) THEN
    RAISE EXCEPTION 'Installation rollback test requires 0022 to be absent';
  END IF;
END $$;
${baseline}
BEGIN ISOLATION LEVEL READ COMMITTED;
${migrationBody}
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_temp.install_functions s LEFT JOIN pg_proc p ON p.oid=s.oid
    WHERE p.oid IS NULL OR s.definition_hash<>md5(pg_get_functiondef(p.oid))
      OR s.acl IS DISTINCT FROM p.proacl::text OR s.config IS DISTINCT FROM p.proconfig::text) THEN
    RAISE EXCEPTION 'Migration changed a pre-existing function or grant';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_temp.install_tables s LEFT JOIN pg_class c ON c.oid=s.oid
    WHERE c.oid IS NULL OR s.acl IS DISTINCT FROM c.relacl::text OR s.relrowsecurity<>c.relrowsecurity
      OR s.relforcerowsecurity<>c.relforcerowsecurity
      OR s.policy_hash<>(SELECT md5(coalesce(jsonb_agg(to_jsonb(pol) ORDER BY pol.oid)::text,'[]')) FROM pg_policy pol WHERE pol.polrelid=c.oid)) THEN
    RAISE EXCEPTION 'Migration changed pre-existing table access';
  END IF;
END $$;
${testBody}
-- The preceding ROLLBACK removes the migration as well as every fixture.
DO $$ DECLARE entry record; fingerprint text; BEGIN
  IF NOT (${relations}) OR NOT (${functions}) THEN
    RAISE EXCEPTION '0022 objects survived installation rollback';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_temp.install_functions s LEFT JOIN pg_proc p ON p.oid=s.oid
    WHERE p.oid IS NULL OR s.definition_hash<>md5(pg_get_functiondef(p.oid))
      OR s.acl IS DISTINCT FROM p.proacl::text OR s.config IS DISTINCT FROM p.proconfig::text) THEN
    RAISE EXCEPTION 'Prior function definitions or grants changed';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_temp.install_tables s LEFT JOIN pg_class c ON c.oid=s.oid
    WHERE c.oid IS NULL OR s.acl IS DISTINCT FROM c.relacl::text OR s.relrowsecurity<>c.relrowsecurity
      OR s.relforcerowsecurity<>c.relforcerowsecurity
      OR s.policy_hash<>(SELECT md5(coalesce(jsonb_agg(to_jsonb(pol) ORDER BY pol.oid)::text,'[]')) FROM pg_policy pol WHERE pol.polrelid=c.oid)) THEN
    RAISE EXCEPTION 'Prior table privileges or policies changed';
  END IF;
  FOR entry IN SELECT t.*,d.fingerprint old_fingerprint FROM pg_temp.install_tables t JOIN pg_temp.install_data d ON d.table_oid=t.oid LOOP
    EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text)::text,''[]'')) FROM %I.%I r',entry.schema_name,entry.table_name) INTO fingerprint;
    IF fingerprint IS DISTINCT FROM entry.old_fingerprint THEN
      RAISE EXCEPTION 'Prior data changed: %.%',entry.schema_name,entry.table_name;
    END IF;
  END LOOP;
END $$;
SELECT 'installation rollback: objects absent; prior data and definitions restored' AS result;
DROP TABLE pg_temp.install_data,pg_temp.install_tables,pg_temp.install_functions;
`;
}
if (process.argv.includes('--print-installation-rollback')) {
  process.stdout.write(installationRollbackBatch());
  process.exit(0);
}
function body(name) {
  const match = sql.match(new RegExp(`CREATE FUNCTION private\\.${name}\\([^]*?\\$\\$;`));
  assert.ok(match, name);
  return match[0];
}
function table(name) {
  const start = sql.indexOf(`CREATE TABLE private.${name} (`);
  assert.ok(start >= 0);
  return sql.slice(start, sql.indexOf('\n);', start) + 3);
}
test('exactly five private tables and only six private helpers', () => {
  assert.deepEqual([...sql.matchAll(/CREATE\s+TABLE\s+([\w.]+)/gi)].map(m => m[1]), tables.map(t => 'private.' + t));
  assert.deepEqual([...sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w.]+)/gi)].map(m => m[1]), helpers.map(f => 'private.' + f));
});
test('transaction and delimiters are structurally balanced', () => {
  assert.match(sql, /^BEGIN;/); assert.match(sql, /COMMIT;\s*$/);
  let depth = 0;
  for (const c of sql.replace(/'(?:''|[^'])*'/g, "''")) {
    if (c === '(') depth++;
    if (c === ')') depth--;
    assert.ok(depth >= 0, 'unmatched closing parenthesis');
  }
  assert.equal(depth, 0);
  assert.equal((sql.match(/\$\$/g) || []).length, helpers.length * 2);
});
test('no operational definitions, mutations, extension or policy changes', () => {
  assert.doesNotMatch(sql, /CREATE\s+OR\s+REPLACE|CREATE\s+EXTENSION|CREATE\s+POLICY|ALTER\s+FUNCTION|DROP\s|TRUNCATE\s/i);
  assert.doesNotMatch(sql, /\b(?:INSERT\s+INTO|DELETE\s+FROM|UPDATE)\s+(?:public|private)\./i);
  assert.deepEqual([...sql.matchAll(/ALTER TABLE ([\w.]+)/g)].map(m => m[1]), tables.map(t => 'private.' + t));
});
test('exactly nine triggers, all on the new private tables', () => {
  const targets = [...sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?TRIGGER\b[^;]*?\bON\s+([\w.]+)/gi)].map(m => m[1]);
  assert.equal(targets.length, 9);
  assert.ok(targets.every(t => tables.map(n => 'private.' + n).includes(t)));
  assert.equal((sql.match(/DEFERRABLE INITIALLY DEFERRED/g) || []).length, 4);
});
test('RLS without policies and exact service SELECT-only ACL', () => {
  for (const t of tables) assert.ok(sql.includes(`ALTER TABLE private.${t} ENABLE ROW LEVEL SECURITY;`));
  const revokes = sql.match(/REVOKE ALL ON private\.movement_location_references[^;]*;/)?.[0];
  const grant = sql.match(/GRANT SELECT ON private\.movement_location_references[^;]*;/)?.[0];
  assert.ok(revokes && grant);
  for (const t of tables) { assert.ok(revokes.includes('private.' + t)); assert.ok(grant.includes('private.' + t)); }
  assert.match(revokes, /FROM PUBLIC,anon,authenticated,service_role;/);
  assert.match(grant, /TO service_role;/);
  assert.equal((sql.match(/\bGRANT\b/g) || []).length, 1);
});
test('each helper pins its own search path and revokes all execution', () => {
  for (const f of helpers) {
    assert.match(body(f), /SECURITY DEFINER SET search_path = ''/);
    const signature = f.startsWith('assert_') ? 'uuid' : '';
    assert.ok(sql.includes(`REVOKE ALL ON FUNCTION private.${f}(${signature}) FROM PUBLIC,anon,authenticated,service_role;`));
  }
  assert.doesNotMatch(sql, /\bEXECUTE\s+(?:format\s*\(|')/i);
});
test('no routing vendors, spatial types or output measurements', () => {
  assert.doesNotMatch(sql, /\b(?:google|mapbox|tomtom|openstreetmap|osrm|graphhopper|valhalla|postgis|geometry|geography|polyline)\b/i);
  assert.doesNotMatch(sql, /\b(?:distance|deviation|overlap|detour|fuel|toll|price|payment|refund|payout|settlement)\w*\s+(?:numeric|bigint|integer|text|uuid)/i);
  assert.doesNotMatch(sql, /\bST_\w+\s*\(|https?:\/\//i);
  assert.doesNotMatch(sql, /private\.financial_|public\.(?:journeys|create_movement_offer|accept_movement_offer)/i);
});
test('0021 remains byte-identical modulo checkout line endings and its gate stays closed', () => {
  const old = fs.readFileSync('supabase/migrations/0021_financial_proposal_foundation.sql', 'utf8').replace(/\r\n/g, '\n');
  assert.equal(crypto.createHash('sha256').update(old).digest('hex'), 'c8fcabaa415f177e5121c3fe8a17b9b921ab8a8f31efa08fd17facb220dd5b7e');
  assert.match(old, /route_evidence_id uuid CHECK \(route_evidence_id IS NULL\)/);
  assert.doesNotMatch(sql, /route_evidence_id/);
});
test('no operational callers or older migrations consume these tables', () => {
  function walk(dir) { return fs.readdirSync(dir, {withFileTypes:true}).flatMap(e => e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]); }
  const names = new RegExp(`\\b(?:${tables.join('|')})\\b`);
  for (const file of [...walk('supabase/migrations'), ...walk('src'), ...walk('supabase/functions')]) {
        const sanctionedConsumers = new Set([
  'supabase/migrations/0023_route_evidence_foundation.sql',
  'supabase/migrations/0024_movement_planning_horizon.sql',
  'supabase/migrations/0025_trusted_route_producer_boundary.sql',
  'supabase/migrations/0026_trusted_location_resolution_boundary.sql',
  'supabase/migrations/0027_trusted_selected_location_intake.sql',
  'supabase/migrations/0028_trusted_location_search_intake_boundary.sql',
  'supabase/migrations/0031_route_generation_context.sql',
  'supabase/migrations/0033_route_generation_claim_boundary.sql',
  'supabase/migrations/0034_offering_movement_intent_intake.sql',
  'supabase/migrations/0035_requester_movement_need_intake.sql',
  'supabase/migrations/0036_trusted_matching_context.sql',
  'supabase/migrations/0037_trusted_route_match_evidence_foundation.sql',
  'supabase/migrations/0038_trusted_route_match_evidence_writer.sql',
  'supabase/migrations/0039_authorized_trusted_matching_context.sql',
  'supabase/migrations/0040_trusted_location_discovery_area.sql',
  'supabase/migrations/0042_trusted_movement_offer_authorization.sql',
  'supabase/migrations/0043_route_evidence_provider_identity_scope.sql',
  'supabase/migrations/0044_offering_movement_availability_foundation.sql',
  'supabase/migrations/0045_movement_offer_availability_capacity.sql',
  'supabase/migrations/0046_requester_availability_matching_context.sql',
]);
    if (file !== migration && !sanctionedConsumers.has(file) && /\.(sql|ts|tsx)$/.test(file)) {
      assert.doesNotMatch(fs.readFileSync(file,'utf8'), names, file);
    }
  }
});
test('scalar coordinate and provider pairs are coherent with resolution provenance', () => {
  const t = table(tables[0]);
  for (const re of [/latitude numeric CHECK \(latitude BETWEEN -90 AND 90\)/,
    /longitude numeric CHECK \(longitude BETWEEN -180 AND 180\)/,
    /\(latitude IS NULL\)=\(longitude IS NULL\)/,
    /\(provider_namespace IS NULL\)=\(provider_place_reference IS NULL\)/,
    /resolution_status='unresolved' AND source_kind IN/,
    /resolution_status='resolved' AND source_kind='provider_resolved'/,
    /latitude IS NOT NULL AND longitude IS NOT NULL AND provider_namespace IS NOT NULL/,
    /resolved_at IS NOT NULL AND resolution_version IS NOT NULL/]) assert.match(t,re);
});
test('intent is independent of demand, versioned with one current logical identity', () => {
  const t = table(tables[1]);
  assert.doesNotMatch(t, /movement_need|movement_offer|requesting|journey/);
  assert.match(t, /UNIQUE \(offering_member_id,intent_key,version\)/);
  assert.match(sql, /ON private.offering_movement_intents\(offering_member_id,intent_key\) WHERE status='current'/);
  assert.match(t, /'current','superseded','withdrawn','expired'/);
});
test('exact two immutable intent endpoints required on both insertion paths', () => {
  assert.match(table(tables[2]), /role IN \('origin','destination'\)/);
  assert.match(table(tables[2]), /PRIMARY KEY \(intent_id,role\)/);
  assert.match(body('assert_offering_movement_intent'), /count\(\*\)[^]*<>2/);
  assert.match(body('assert_offering_movement_intent'), /lr.owner_member_id<>intent_row.offering_member_id/);
  assert.match(sql, /AFTER INSERT ON private.offering_movement_intents/);
  assert.match(sql, /AFTER INSERT ON private.offering_movement_intent_locations/);
});
test('immutable parent fields, terminal lifecycles and history protection', () => {
  const b = body('protect_movement_context_record');
  assert.match(b, /TG_OP='DELETE'/);
  assert.match(b, /Location inputs are immutable/);
  assert.match(b, /to_jsonb\(NEW\)-'status'/);
  assert.match(b, /OLD.status<>'current' AND NEW IS DISTINCT FROM OLD/);
  assert.match(b, /Intent expiry has not elapsed/);
  assert.doesNotMatch(sql, /ON DELETE (?:CASCADE|SET NULL)/i);
});
test('children are immutable and construction serialized with parent lifecycle', () => {
  const b = body('protect_movement_context_child');
  assert.match(b, /TG_OP<>'INSERT'/);
  assert.equal((b.match(/FOR UPDATE/g) || []).length, 2);
  assert.match(b, /parent_status<>'current'/);
});
test('need declarations and conflicting alignment state are checked', () => {
  const b = body('assert_movement_context_snapshot');
  assert.match(b, /need_row.member_id,need_row.origin_area,need_row.destination_area/);
  assert.match(b, /need_row.latest_departure_at,need_row.people_count/);
  assert.match(b, /need_row.status<>'discoverable'/);
  assert.match(b, /'awaiting_activation_payment','activated','in_progress','completed'/);
});
test('optional pending offer binds every original declaration without computing arrival', () => {
  const b = body('assert_movement_context_snapshot');
  assert.match(b, /snapshot_row.movement_offer_id IS NOT NULL/);
  assert.match(b, /offer_row.status<>'pending'/);
  assert.match(b, /offer_row.seats_offered,offer_row.proposed_pickup_area,offer_row.proposed_dropoff_area,offer_row.estimated_arrival_minutes/);
  assert.match(table(tables[3]), /movement_offer_id IS NOT NULL OR \(proposed_pickup_area IS NULL/);
});
test('independent intent version, endpoints and requester location ownership match', () => {
  const b = body('assert_movement_context_snapshot');
  assert.match(b, /private.assert_offering_movement_intent\(snapshot_row.offering_movement_intent_id\)/);
  assert.match(b, /intent_row.offering_member_id,intent_row.version,intent_row.earliest_departure_at,intent_row.latest_departure_at/);
  assert.match(b, /il.role='origin' AND il.location_reference_id=snapshot_row.offering_origin_location_id/);
  assert.match(b, /il.role='destination' AND il.location_reference_id=snapshot_row.offering_destination_location_id/);
  assert.match(b, /lr.owner_member_id<>snapshot_row.requesting_member_id/);
});
test('vehicle capacity and active access are locked and checked', () => {
  const b = body('assert_movement_context_snapshot');
  assert.match(b, /WHERE v.id=snapshot_row.vehicle_id FOR SHARE/);
  assert.match(b, /mva.vehicle_id=snapshot_row.vehicle_id AND mva.active FOR SHARE/);
  assert.match(b, /current_capacity<>snapshot_row.vehicle_seat_capacity/);
  assert.match(table(tables[3]), /seats_offered>=people_count/);
  assert.match(table(tables[3]), /seats_offered<=vehicle_seat_capacity/);
});
test('exact roster prevents count-only substitution and excludes offerer and invites', () => {
  const b = body('assert_movement_context_snapshot');
  assert.match(b, /mp.id=st.movement_participant_id/);
  assert.match(b, /mp.member_id=st.member_id AND mp.role=st.role AND mp.status='confirmed'/);
  assert.match(b, /mp.status='invited'/);
  assert.match(b, /st.member_id=snapshot_row.offering_member_id/);
  assert.match(b, /st.role='primary_requester'/);
  assert.doesNotMatch(table(tables[4]), /REFERENCES public.movement_participants/);
});
test('construction checks live final state; historical updates do not enqueue it', () => {
  assert.match(body('assert_movement_context_snapshot'), /FROM private.movement_context_snapshots s WHERE s.id=p_snapshot_id/);
  assert.match(body('assert_movement_context_snapshot'), /current_setting\('transaction_isolation'\)<>'read committed'/);
  assert.match(body('assert_movement_context_snapshot'), /WHERE n.id=snapshot_row.movement_need_id FOR UPDATE/);
  assert.match(body('assert_movement_context_snapshot'), /WHERE s.id=p_snapshot_id FOR SHARE/);
  assert.doesNotMatch(sql, /CREATE CONSTRAINT TRIGGER[^;]*AFTER INSERT OR UPDATE/);
});
test('installation rollback batch has one transaction and verifies object removal afterward', () => {
  const batch = stripComments(installationRollbackBatch());
  assert.equal((batch.match(/^BEGIN ISOLATION LEVEL READ COMMITTED;/gm) || []).length, 1);
  assert.doesNotMatch(batch, /^COMMIT;/m);
  assert.equal((batch.match(/^ROLLBACK;/gm) || []).length, 1);
  assert.ok(batch.indexOf('CREATE TEMP TABLE install_functions') < batch.indexOf('BEGIN ISOLATION'));
  assert.ok(batch.indexOf('0022 objects survived installation rollback') > batch.indexOf('ROLLBACK;'));
  assert.match(batch, /fingerprint IS DISTINCT FROM entry.old_fingerprint/);
});
test('whitespace-only provider metadata is explicitly rejected', () => {
  for (const field of ['declared_label','provider_namespace','provider_place_reference','resolution_version']) {
    assert.ok(table(tables[0]).includes(`${field} ~ '[^[:space:]]'`));
  }
});
test('time and eligibility checks reject future and expired input', () => {
  assert.match(body('protect_movement_context_record'), /NEW.created_at>clock_timestamp\(\)/);
  assert.match(body('protect_movement_context_record'), /NEW.resolved_at>clock_timestamp\(\)/);
  assert.match(body('assert_offering_movement_intent'), /intent_row.expires_at<=clock_timestamp\(\)/);
  assert.match(body('assert_movement_context_snapshot'), /snapshot_row.expires_at<=clock_timestamp\(\)/);
  assert.match(sql, /isfinite\(created_at\)/);
});
test('rollback harness isolates failures and preserves named results', () => {
  assert.match(live, /^BEGIN;/); assert.match(live, /ROLLBACK;\s*$/);
  assert.doesNotMatch(live, /^COMMIT;/m);
  assert.match(live, /SET CONSTRAINTS ALL IMMEDIATE;\s*SET CONSTRAINTS ALL DEFERRED;\s*BEGIN\s*EXECUTE p_sql/);
  assert.match(live, /observed=p_state AND \(p_message IS NULL OR observed_message=p_message\)/);
  assert.match(live, /test_name text PRIMARY KEY/);
  assert.match(live, /jsonb_populate_recordset\(NULL::pg_temp.context_results,saved_results\)/);
  assert.match(live, /all existing function definitions grants and configuration unchanged/);
  assert.match(live, /all existing table ACL RLS and policies unchanged/);
});
test('behavioral matrix includes stale context, lifecycle, replay and private access', () => {
  for (const label of ['single coordinate','resolved state requires provenance','missing destination',
    'two current intent versions','lost vehicle access','active alignment rejects snapshot',
    'same-count source substitution rejects revalidation','changed capacity rejects revalidation',
    'expired intent rejects snapshot','expired snapshot rejects revalidation','historical supersession preserves stale snapshot',
    'identical snapshot retry preserves every field','all fixture users disappeared','no automatic private rows: ']) assert.ok(live.includes(label),label);
});
