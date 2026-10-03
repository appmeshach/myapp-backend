'use strict';

// Portable structural checks only. No Docker, psql, Supabase, or database calls.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const dir = path.join(__dirname, '../supabase/migrations');
const read = p => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const name = '0073_financial_proposal_movement_context_binding_foundation.sql';
const raw = read(path.join(dir, name));
const strip = s => s.replace(/'(?:''|[^'])*'|--[^\n]*|\/\*[\s\S]*?\*\//g, t => t.startsWith("'") ? t : ' ');
const sql = strip(raw);
const compact = s => strip(s).replace(/\s+/g, ' ').trim();
function body(name) {
  const m = sql.match(new RegExp(`CREATE (?:OR REPLACE )?FUNCTION private\\.${name}\\([^]*?AS \\$\\$([^]*?)\\$\\$;`));
  assert(m, name); return m[1];
}
const historical = body('assert_financial_proposal_movement_context_binding');
const compatibility = body('assert_financial_proposal_source_compatibility');
const roster = body('assert_financial_proposal_snapshot_roster');
const protect = body('protect_financial_proposal');
const guard = body('protect_proposal_bound_movement_context_snapshot');
const live = read(path.join(__dirname, '../supabase/tests/0073_financial_proposal_movement_context_binding_test.sql'));
const runner = read(path.join(__dirname, '../supabase/tests/0073_financial_proposal_movement_context_binding_behavior.cjs'));
const races = read(path.join(__dirname, '../supabase/tests/0073_financial_proposal_movement_context_binding_concurrency.cjs'));

test('0073 exact identity, one atomic transaction and locked empty-history gate', () => {
  assert.deepEqual(fs.readdirSync(dir).filter(n => n.startsWith('0073_')), [name]);
  assert.match(sql, /^BEGIN;/); assert.match(sql, /COMMIT;\s*$/);
  assert.equal((sql.match(/^BEGIN;/gm) || []).length, 1);
  assert.equal((sql.match(/^COMMIT;/gm) || []).length, 1);
  assert.match(sql, /LOCK TABLE private\.financial_proposals IN ACCESS EXCLUSIVE MODE/);
  assert(sql.indexOf('LOCK TABLE') < sql.indexOf('IF EXISTS'));
  assert(sql.indexOf('IF EXISTS') < sql.indexOf('ALTER TABLE'));
  assert.match(sql, /IF EXISTS \(SELECT 1 FROM private\.financial_proposals\) THEN\s*RAISE EXCEPTION USING ERRCODE='23514'/);
});
test('SQL dollar delimiters and parentheses balance in migration and behavioral SQL', () => {
  for (const source of [raw, live]) {
    assert.doesNotMatch(source, /AS \$(?:\r?\n)|^\$;$/m);
    const delimiters = new Map();
    for (const m of source.matchAll(/\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/g)) delimiters.set(m[0], (delimiters.get(m[0]) || 0) + 1);
    for (const [delimiter,count] of delimiters) assert.equal(count % 2, 0, delimiter);
    let depth = 0;
    for (const c of strip(source).replace(/'(?:''|[^'])*'/g, "''")) {
      if (c === '(') depth++;
      if (c === ')') depth--;
      assert(depth >= 0, 'unmatched closing parenthesis');
    }
    assert.equal(depth, 0);
  }
});
test('exact mandatory snapshot ID/version and nonunique supporting index, no fabricated provenance', () => {
  const schema = sql.slice(sql.indexOf('ALTER TABLE'), sql.indexOf('CREATE FUNCTION'));
  assert.match(schema, /ADD COLUMN movement_context_snapshot_id uuid NOT NULL\s*REFERENCES private\.movement_context_snapshots\(id\)/);
  assert.match(schema, /ADD COLUMN movement_context_snapshot_version integer NOT NULL\s*CHECK \(movement_context_snapshot_version>=1\)/);
  assert.equal((schema.match(/ADD COLUMN/g) || []).length, 2);
  assert.match(schema, /CREATE INDEX financial_proposals_snapshot_status\s*ON private\.financial_proposals\(movement_context_snapshot_id,status\)/);
  assert.doesNotMatch(schema, /DEFAULT|CREATE UNIQUE|\bUPDATE\b|\bINSERT\b/);
});
test('complete null-safe historical movement field mapping', () => {
  const left = ['movement_context_snapshot_version','movement_need_id','member_needing_movement_id','offering_member_id','vehicle_id','people_count','seats_offered','vehicle_seat_capacity','origin_area','destination_area','earliest_departure_at','latest_departure_at','proposed_pickup_area','proposed_dropoff_area','estimated_arrival_minutes'];
  const right = ['version','movement_need_id','requesting_member_id','offering_member_id','vehicle_id','people_count','seats_offered','vehicle_seat_capacity','requester_origin_area','requester_destination_area','requester_earliest_departure_at','requester_latest_departure_at','proposed_pickup_area','proposed_dropoff_area','declared_arrival_minutes'];
  const m = historical.match(/ROW\(([^]*?)\)\s*IS DISTINCT FROM ROW\(([^]*?)\)/);
  assert(m);
  assert.deepEqual(m[1].replace(/\s/g,'').split(','), left.map(n => 'p.' + n));
  assert.deepEqual(m[2].replace(/\s/g,'').split(','), right.map(n => 's.' + n));
  assert.match(historical, /s.context_schema_version IS DISTINCT FROM 'movement_context_v1'/);
  assert.match(historical, /s.movement_offer_id IS NULL/);
});
test('finite lifetime independently bounded by both exact immutable sources', () => {
  for (const part of ['p.created_at IS NULL','NOT isfinite(p.created_at)','p.created_at<s.created_at','p.expires_at IS NULL','NOT isfinite(p.expires_at)','p.expires_at<=p.created_at','s.expires_at IS NULL','NOT isfinite(s.expires_at)','p.expires_at>s.expires_at']) assert(historical.includes(part), part);
  assert(protect.includes('private.assert_financial_proposal_quote_binding(NEW)'));
  const old = read(path.join(dir, '0070_financial_proposal_quote_binding_foundation.sql'));
  assert.match(old, /p.created_at<q.created_at/); assert.match(old, /p.expires_at>q.expires_at/);
  assert(body('validate_financial_proposal_movement_context_binding').includes('private.assert_financial_proposal_quote_binding(p)'));
});
test('historical assertions take no locks and require no current lifecycle or clock', () => {
  for (const b of [historical, compatibility, roster]) assert.doesNotMatch(b, /FOR (?:UPDATE|SHARE|KEY SHARE)|clock_timestamp|current_setting|\.status|remaining_places|assert_pricing_quote\(|assert_movement_context_snapshot\(/);
});
test('quote/snapshot share exact need, principals and immutable intent version', () => {
  assert.match(compact(compatibility), /ROW\(q.movement_need_id,q.requesting_member_id,q.offering_member_id, q.offering_movement_intent_id,q.offering_intent_version\) IS DISTINCT FROM ROW\(s.movement_need_id,s.requesting_member_id,s.offering_member_id, s.offering_movement_intent_id,s.offering_intent_version\)/);
  assert.doesNotMatch(sql.slice(sql.indexOf('ALTER TABLE'), sql.indexOf('CREATE FUNCTION')), /ADD COLUMN (?:route|intent|state)/);
});
test('deeper compatibility compares route versions/endpoints, not independent match IDs', () => {
  assert.match(compact(compatibility), /ROW\(g.route_evidence_id,g.route_evidence_version, qm.requester_origin_location_reference_id,qm.requester_destination_location_reference_id, q.state_location_reference_id\) IS DISTINCT FROM ROW\(sm.route_evidence_id,sm.route_evidence_version, s.requester_origin_location_id,s.requester_destination_location_id,s.requester_origin_location_id\)/);
  assert.doesNotMatch(compatibility, /qm\.id\s*(?:<>|IS DISTINCT FROM)|g\.route_match_evidence_id\s*(?:<>|IS DISTINCT FROM)|qm\.version\s*(?:<>|IS DISTINCT FROM)/);
  const geography = compact(read(path.join(dir, '0059_pricing_geography_evidence_foundation.sql')));
  assert(geography.includes('m.route_evidence_id,m.route_evidence_version,m.requester_origin_location_reference_id'));
  const producer = read(path.join(dir, '0072_trusted_movement_context_snapshot_producer.sql'));
  assert(producer.includes('m.requester_origin_location_reference_id')); assert(producer.includes('m.requester_destination_location_reference_id'));
  assert(producer.includes('m.route_evidence_id')); assert(producer.includes('m.route_evidence_version'));
});
test('exact historical roster counts and symmetric member/participant/role set equality', () => {
  assert.match(roster, /proposal_count<>p.people_count OR snapshot_count<>p.people_count OR proposal_count<>snapshot_count/);
  assert.equal((roster.match(/\bEXCEPT\b/g) || []).length, 2);
  assert.equal((roster.match(/SELECT t.member_id,t.participant_id,t.role/g) || []).length, 2);
  assert.equal((roster.match(/SELECT t.member_id,t.movement_participant_id,t.role/g) || []).length, 2);
  assert.doesNotMatch(roster, /public\.movement_participants/);
});
test('new deferred parent and child checks reread final parent and preserve original validators', () => {
  assert.match(sql, /AFTER INSERT OR UPDATE ON private.financial_proposals\s*DEFERRABLE INITIALLY DEFERRED/);
  assert.match(sql, /AFTER INSERT ON private.financial_proposal_travellers\s*DEFERRABLE INITIALLY DEFERRED/);
  const b = body('validate_financial_proposal_movement_context_binding');
  assert.match(b, /SELECT x\.\* INTO STRICT p FROM private.financial_proposals x WHERE x.id=proposal_to_check/);
  assert(b.includes('private.assert_financial_proposal_snapshot_roster(p.id)'));
  assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION private\.(?:validate_financial_proposal|assert_financial_proposal_context|protect_financial_proposal_traveller|protect_movement_context_record)/);
});
test('conditional exact operational offer identity, initial offer remains NULL', () => {
  assert.match(historical, /p.movement_offer_id IS NOT NULL AND p.movement_offer_id IS DISTINCT FROM s.movement_offer_id/);
  assert.match(protect, /NEW.movement_offer_id IS NOT NULL OR NEW.alignment_id IS NOT NULL/);
  assert.doesNotMatch(protect, /NEW.movement_offer_id\s*:=/);
});
test('all original 0021/0070 construction, immutability and lifecycle guards retained', () => {
  const old = strip(read(path.join(dir, '0070_financial_proposal_quote_binding_foundation.sql')));
  const start = old.indexOf("    IF NEW.status<>'current'");
  const oldTail = old.slice(start, old.indexOf('$$;', start));
  assert.equal(compact(protect.slice(protect.indexOf("    IF NEW.status<>'current'"))), compact(oldTail));
  assert.match(protect, /IF TG_OP='DELETE' THEN\s*RAISE EXCEPTION USING ERRCODE='23514'/);
  assert.doesNotMatch(protect, /ARRAY\[[^\]]*movement_context_snapshot/);
});
test('INSERT live validation takes stronger dependencies before quote and snapshot locks', () => {
  const start = protect.indexOf("IF TG_OP='INSERT'");
  const end = protect.indexOf('RETURN NEW;', start);
  const b = protect.slice(start, end);
  assert(b.indexOf('assert_movement_offer_availability_binding') < b.indexOf('assert_pricing_quote('));
  assert(b.indexOf('assert_pricing_quote(') < b.indexOf('assert_movement_context_snapshot('));
  assert(b.lastIndexOf('assert_pricing_quote(') > b.indexOf('assert_movement_context_snapshot('));
  assert.doesNotMatch(protect.slice(end), /assert_pricing_quote\(|assert_movement_context_snapshot\(|assert_movement_offer_availability_binding\(/);
  assert(protect.indexOf('assert_financial_proposal_source_compatibility(NEW)') < start);
  const snapshot = read(path.join(dir, '0022_movement_context_foundation.sql'));
  assert.match(snapshot, /WHERE s.id=p_snapshot_id FOR SHARE/);
});
test('snapshot supersession uses fresh READ COMMITTED existence query without reverse locks', () => {
  assert.match(guard, /OLD.status='current' AND NEW.status='superseded'/);
  assert.match(guard, /current_setting\('transaction_isolation'\) IS DISTINCT FROM 'read committed'/);
  assert.match(guard, /p.movement_context_snapshot_id=OLD.id AND p.status='current'/);
  assert.doesNotMatch(guard, /FOR (?:UPDATE|SHARE)|movement_needs|expires_at|materialized_at|UPDATE private.financial_proposals/);
  assert.match(sql, /BEFORE UPDATE ON private.movement_context_snapshots FOR EACH ROW/);
  assert.doesNotMatch(sql, /DROP TRIGGER|STABLE|IMMUTABLE/);
});
test('exact private helper inventory and hardened ACLs; RLS/write grants untouched', () => {
  const names = [...sql.matchAll(/CREATE (?:OR REPLACE )?FUNCTION ([\w.]+)/g)].map(m => m[1]);
  assert.deepEqual(names, ['assert_financial_proposal_movement_context_binding','assert_financial_proposal_source_compatibility','assert_financial_proposal_snapshot_roster','validate_financial_proposal_movement_context_binding','protect_proposal_bound_movement_context_snapshot','protect_financial_proposal'].map(n => 'private.' + n));
  assert.equal((sql.match(/SECURITY DEFINER SET search_path = ''/g) || []).length, 6);
  assert.equal((sql.match(/REVOKE ALL ON FUNCTION/g) || []).length, 6);
  assert.equal((sql.match(/FROM PUBLIC,anon,authenticated,service_role/g) || []).length, 6);
  assert.doesNotMatch(sql, /\bGRANT\b|CREATE POLICY|DISABLE ROW LEVEL SECURITY|CREATE FUNCTION public\./);
});
test('foundation performs no economics or operational/financial writes and exposes no issuer', () => {
  assert.doesNotMatch(sql, /calculate_financial_proposal_economics|seat_price_minor|gross_requester_total_minor|offering_final_net_minor/);
  assert.doesNotMatch(sql, /\b(?:INSERT INTO|UPDATE|DELETE FROM) (?:public|private)\./);
  assert.doesNotMatch(sql, /accept_movement_offer|financial_agreements|financial_components|wallet_|payment|journey|CREATE (?:OR REPLACE )?FUNCTION public\./i);
});
test('0001 through 0072 remain byte-normalized unchanged', () => {
  const names = fs.readdirSync(dir).filter(n => /^\d{4}_.*\.sql$/.test(n) && +n.slice(0,4) <= 72).sort();
  assert.equal(names.length, 72);
  assert.equal(crypto.createHash('sha256').update(names.map(n => n + '\n' + read(path.join(dir,n))).join('\n')).digest('hex'), '14971e4db941d6bac282986bdf96063ce630c7da3ab7ac61921ba55373bb90ce');
});
test('behavioral tests use normal triggers and roll back, runner tests exact migration precondition', () => {
  assert.match(live, /^BEGIN;/); assert.match(live, /ROLLBACK;\s*$/);
  assert.doesNotMatch(compact(live), /DISABLE TRIGGER|session_replication_role|\bCOMMIT;/);
  assert.match(runner, /migration.slice\(migration.indexOf\('LOCK TABLE'\), migration.indexOf\('ALTER TABLE'\)\)/);
  for (const label of ['different intent','different exact route','independent pricing geography','materialized current proposal','live roster changed','shorter source expiry','initial','superseded proposal']) {
    if (label !== 'initial') assert(live.includes(label), label);
  }
});
test('additional genuine offers obtain fresh authorization through normal producers', () => {
  const helper = strip(live.match(/CREATE FUNCTION pg_temp\.new_offer\([\s\S]*?END \$\$;/)[0]);
  for (const producer of ['public.create_offering_movement_intent', 'pg_temp.snapshot_route(fresh_intent', 'pg_temp.snapshot_match(f.need,fresh_intent,fresh_route,route_version)', 'public.open_offering_movement_availability', 'public.create_movement_offer(f.need,fresh_match,fresh_availability,3']) {
    assert(helper.includes(producer), producer);
  }
  assert.match(helper, /gen_random_uuid\(\),i.origin_id,i.destination_id,i.earliest_departure_at,i.latest_departure_at/);
  assert.match(helper, /gen_random_uuid\(\),fresh_intent,f.vehicle/);
  assert.match(helper, /SELECT version INTO STRICT route_version FROM private.offering_route_evidence WHERE id=fresh_route/);
  assert.doesNotMatch(helper, /f\.match_evidence|f\.availability|INSERT INTO private\.|UPDATE private\.|DISABLE TRIGGER/);
  for (const declaration of ["CASE WHEN p_nullable THEN NULL ELSE 'Chevron pickup' END", "CASE WHEN p_nullable THEN NULL ELSE 'Oniru dropoff' END", 'CASE WHEN p_nullable THEN NULL ELSE 18 END']) {
    assert(helper.includes(declaration), declaration);
  }
});
test('fresh intent defers only its parent completeness check and restores the immediate baseline', () => {
  const helper = strip(live.match(/CREATE FUNCTION pg_temp\.new_offer\([\s\S]*?END \$\$;/)[0]);
  assert.match(helper, /BEGIN\s+SET CONSTRAINTS private\.offering_intent_complete DEFERRED;[\s\S]*public\.create_offering_movement_intent[\s\S]*IF NOT \(r->>'ok'\)::boolean THEN RAISE EXCEPTION 'Fresh intent failed: %',r; END IF;\s+SET CONSTRAINTS private\.offering_intent_complete IMMEDIATE;\s+EXCEPTION WHEN OTHERS THEN\s+RAISE;\s+END;/);
  assert.deepEqual([...helper.matchAll(/SET CONSTRAINTS ([^;]+);/g)].map(m => m[1]), [
    'private.offering_intent_complete DEFERRED', 'private.offering_intent_complete IMMEDIATE',
  ]);
  assert(helper.indexOf('private.offering_intent_complete IMMEDIATE') < helper.indexOf('pg_temp.snapshot_route('));
  const foundation = strip(read(path.join(dir, '0022_movement_context_foundation.sql')));
  assert.match(foundation, /CREATE CONSTRAINT TRIGGER offering_intent_complete AFTER INSERT ON private\.offering_movement_intents\s+DEFERRABLE INITIALLY DEFERRED/);
  assert.match(foundation, /CREATE CONSTRAINT TRIGGER offering_intent_locations_complete AFTER INSERT ON private\.offering_movement_intent_locations\s+DEFERRABLE INITIALLY DEFERRED/);
  const intake = strip(read(path.join(dir, '0034_offering_movement_intent_intake.sql')));
  assert(intake.indexOf('INSERT INTO private.offering_movement_intents (') < intake.indexOf('INSERT INTO private.offering_movement_intent_locations ('));
  assert(intake.indexOf('INSERT INTO private.offering_movement_intent_locations (') < intake.indexOf('PERFORM private.assert_offering_movement_intent(v_intent_id)'));
  const construct = strip(live.match(/CREATE FUNCTION pg_temp\.construct\([\s\S]*?END \$\$;/)[0]);
  assert.match(construct, /SET CONSTRAINTS ALL IMMEDIATE;\s+RETURN p.id;/);
  assert.match(live, /p:=pg_temp.construct\(\);[\s\S]*different genuine offer with identical terms rejected/);
});
test('genuine offer probes reach the exact historical guard and rebind both nullable sources', () => {
  assert.match(live, /different genuine offer with identical terms rejected[^\n]*'23514','Proposal operational offer must equal its historical snapshot source'/);
  const nullable = live.slice(live.indexOf("PERFORM pg_temp.probe('NULL optional offer declarations match exactly'"), live.indexOf("PERFORM pg_temp.probe('historical validation after quote"));
  assert.match(nullable, /status=''superseded''[\s\S]*pg_temp.new_offer\(true\)/);
  assert.match(nullable, /public.record_movement_context_snapshot_for_server\(o\)/);
  assert.match(nullable, /BEGIN\s+SET CONSTRAINTS private\.movement_context_snapshot_complete,private\.movement_context_travellers_complete DEFERRED;\s+SELECT snapshot_id INTO s FROM public\.record_movement_context_snapshot_for_server\(o\);\s+SET CONSTRAINTS private\.movement_context_snapshot_complete,private\.movement_context_travellers_complete IMMEDIATE;\s+EXCEPTION WHEN OTHERS THEN\s+RAISE;\s+END;/);
  assert.deepEqual([...nullable.matchAll(/SET CONSTRAINTS ([^;]+);/g)].map(m => m[1]), [
    'private.movement_context_snapshot_complete,private.movement_context_travellers_complete DEFERRED',
    'private.movement_context_snapshot_complete,private.movement_context_travellers_complete IMMEDIATE',
  ]);
  assert.doesNotMatch(nullable, /SET CONSTRAINTS ALL DEFERRED|(?:INSERT INTO|UPDATE|DELETE FROM) (?:private\.movement_context_snapshot(?:s|_travellers)|public\.movement_participants)|DISABLE TRIGGER|session_replication_role/);
  assert.match(nullable, /pg_temp.record_result\(route_match_evidence_id\)[\s\S]*movement_offer_route_match_bindings WHERE movement_offer_id=o/);
  assert.match(nullable, /public.record_pricing_quote_for_server\(g/);
  assert.match(nullable, /SET snapshot_id=s,quote_id=q; PERFORM pg_temp.construct\(\)/);
  assert.doesNotMatch(races, /new_offer\(/);
});
test('concurrency tests require observed blocking, rollback/commit races and isolated cleanup', () => {
  for (const part of ['pg_blocking_pids','constructor-first','superseder-first','constructor-rollback','proposalSupersessionRace(true)','proposalSupersessionRace(false)',"eligibilityRace('roster')","eligibilityRace('acceptance')",'expiryDuringWait','sharedIntentRace','noDeadlock','DROP DATABASE','fingerprint unchanged']) assert(races.includes(part), part);
  assert.match(races, /--schema-only/); assert.match(races, /binding0073_race_\[/);
  assert.doesNotMatch(races, /migration up|db push|apply_migration/);
});
test('both database harnesses are syntactically valid and inert when imported', () => {
  new vm.Script(runner); new vm.Script(races);
  assert.match(runner, /if \(require.main === module\)/);
  assert.match(races, /if \(require.main === module\)/);
});
test('clone archive filters only DEFAULT ACL entries and retains ordinary ACLs', () => {
  const { filterDefaultAcls } = require('../supabase/tests/0073_financial_proposal_movement_context_binding_concurrency.cjs');
  const keep = [
    '; Archive TOC',
    '101; 1259 100 TABLE private financial_proposals postgres',
    '102; 0 0 ACL private TABLE financial_proposals postgres',
    '103; 0 0 ACL public COLUMN movement_offers.proposed_pickup_area postgres',
    '104; 0 0 ACL auth TABLE users supabase_auth_admin',
    '105; 0 0 ACL public TABLE DEFAULT ACL postgres',
    '106; 3256 101 POLICY public movement_needs requester postgres',
  ];
  const defaults = [
    '201; 826 200 DEFAULT ACL auth DEFAULT PRIVILEGES FOR TABLES supabase_auth_admin',
    '202; 826 201 DEFAULT ACL extensions DEFAULT PRIVILEGES FOR FUNCTIONS supabase_admin',
    '203; 826 202 DEFAULT ACL public DEFAULT PRIVILEGES FOR SEQUENCES postgres',
  ];
  assert.equal(filterDefaultAcls([...keep, ...defaults].join('\n')), keep.join('\n') + '\n');
  assert.match(races, /'--schema-only', '--no-owner', '--format=custom', '--file=' \+ archive/);
  for (const schema of ['public', 'private', 'auth', 'extensions']) assert(races.includes('--schema=' + schema));
  assert.match(races, /command\(\['pg_restore', '--list', archive\]\)/);
  assert.match(races, /command\(\['tee', restoreList\], filterDefaultAcls\(toc\)\)/);
  assert.match(races, /command\(\['pg_restore', '-U', 'postgres', '--dbname=' \+ database, '--no-owner', '--exit-on-error', '--use-list=' \+ restoreList, archive\]\)/);
  assert.doesNotMatch(races, /--no-acl|--no-privileges|GRANT .*supabase_admin|GRANT .*supabase_auth_admin|DISABLE ROW LEVEL SECURITY|session_replication_role/);
  assert.match(races, /CREATE DATABASE \$\{database\} TEMPLATE template0/);
  assert.match(races, /DROP DATABASE \$\{database\} WITH \(FORCE\)/);
  assert.match(races, /before = query\('postgres', snapshot\)/);
  assert.match(races, /assert.equal\(query\('postgres', snapshot\), before/);
});
test('clone failure always attempts file cleanup and preserves database and fingerprint failures', async () => {
  for (const phase of ['pg_dump', 'pg_restore']) {
    const primary = new Error(phase + ' failed');
    const dropError = new Error('DROP failed');
    const fileError = new Error('rm failed');
    const calls = [];
    let fingerprintReads = 0;
    const mock = {
      container: 'unused', snapshot: 'fingerprint', fixtures: () => { throw new Error('Fixture must not run'); },
      command(args) {
        calls.push(args[0]);
        if (args[0] === phase && !args.includes('--list')) throw primary;
        if (args[0] === 'rm') throw fileError;
        return '';
      },
      query(db, sql) {
        calls.push(sql);
        if (sql.includes('schema_migrations')) return '1';
        if (sql === 'fingerprint') return ++fingerprintReads === 1 ? 'before' : 'changed';
        if (sql.startsWith('DROP DATABASE')) throw dropError;
        return '';
      },
    };
    const sandbox = { module: { exports: {} }, console: { log() {} }, setTimeout,
      require: name => name.startsWith('./0073_') ? mock : require(name) };
    vm.runInNewContext(races + '\nmodule.exports.testMain = main;', sandbox);
    await assert.rejects(sandbox.module.exports.testMain(), error => {
      assert.equal(error.cause, primary);
      assert.equal(error.errors[0], primary);
      if (phase === 'pg_restore') assert(error.errors.includes(dropError));
      assert(error.errors.some(e => /fingerprint unchanged/.test(e.message)));
      assert.equal(error.errors.at(-1), fileError);
      return true;
    });
    assert.equal(fingerprintReads, 2, 'Fingerprint checked even after DROP failure');
    assert.equal(calls.at(-1), 'rm', 'File removal attempted after every failure');
  }
});
test('all new feature files have clean trailing whitespace and final newlines', () => {
  for (const source of [raw,live,runner,races,read(__filename)]) {
    assert.doesNotMatch(source, /[\t ]+$/m);
    assert(source.endsWith('\n'));
  }
});
