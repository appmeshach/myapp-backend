'use strict';
// Portable/read-only. Integration runners remain explicitly invoked and inert.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const dir = path.join(__dirname, '../supabase/migrations');
const read = p => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const raw = read(path.join(dir, '0074_trusted_financial_proposal_issuer.sql'));
const sql = raw.replace(/--[^\n]*/g, '');
const testDir = path.join(__dirname, '../supabase/tests');
const live = read(path.join(testDir, '0074_trusted_financial_proposal_issuer_test.sql'));
const runner = read(path.join(testDir, '0074_trusted_financial_proposal_issuer_behavior.cjs'));
const races = read(path.join(testDir, '0074_trusted_financial_proposal_issuer_concurrency.cjs'));
test('one atomic 0074 migration introduces only the narrow issuer', () => {
  assert.deepEqual(fs.readdirSync(dir).filter(n => /^0074_/.test(n)), ['0074_trusted_financial_proposal_issuer.sql']);
  assert.match(sql, /^BEGIN;/); assert.match(sql, /COMMIT;\s*$/);
  assert.deepEqual([...sql.matchAll(/CREATE FUNCTION ([\w.]+)/g)].map(m => m[1]), ['public.issue_financial_proposal_for_server']);
  assert.doesNotMatch(sql, /ALTER |DROP |CREATE (?:TABLE|INDEX|TRIGGER|POLICY)|CREATE OR REPLACE/);
  assert.equal((sql.match(/\$\$/g) || []).length, 2);
});
test('exact ID/version inputs only, stable limited result and hardened service boundary', () => {
  assert.match(sql, /p_pricing_quote_id uuid,\s*p_expected_pricing_quote_version integer,\s*p_movement_context_snapshot_id uuid,\s*p_expected_movement_context_snapshot_version integer\s*\)/);
  assert.match(sql, /RETURNS TABLE \(\s*proposal_id uuid,\s*proposal_version integer,\s*proposal_status text,\s*proposal_created_at timestamptz,\s*proposal_expires_at timestamptz\s*\)/);
  assert.match(sql, /SECURITY DEFINER SET search_path = ''/);
  assert.match(sql, /FROM PUBLIC,anon,authenticated,service_role;/);
  assert.deepEqual([...sql.matchAll(/GRANT[^;]+;/g)].map(m => m[0]), ['GRANT EXECUTE ON FUNCTION public.issue_financial_proposal_for_server(uuid,integer,uuid,integer) TO service_role;']);
  assert.match(sql, /transaction_isolation'\) IS DISTINCT FROM 'read committed'/);
  for (const input of ['p_pricing_quote_id', 'p_expected_pricing_quote_version', 'p_movement_context_snapshot_id', 'p_expected_movement_context_snapshot_version']) assert(sql.includes(input + ' IS NULL'));
  assert.match(sql, /p_expected_pricing_quote_version<1 OR p_expected_movement_context_snapshot_version<1/);
});
test('exact source versions and compatibility checked before acquiring dependencies', () => {
  assert.match(sql, /q.version IS DISTINCT FROM p_expected_pricing_quote_version/);
  assert.match(sql, /s.version IS DISTINCT FROM p_expected_movement_context_snapshot_version/);
  assert(sql.indexOf('assert_financial_proposal_source_compatibility(p)') < sql.indexOf('assert_movement_offer_availability_binding'));
});
test('strong movement dependencies precede quote, snapshot and proposal history; revalidation follows waits', () => {
  const chain = ['assert_movement_offer_availability_binding', 'assert_pricing_quote(q.id)', 'assert_movement_context_snapshot(s.id)', 'ORDER BY x.version FOR UPDATE'];
  for (let i = 1; i < chain.length; i++) assert(sql.indexOf(chain[i - 1]) < sql.indexOf(chain[i]));
  const after = sql.slice(sql.indexOf('ORDER BY x.version FOR UPDATE'));
  for (const check of chain.slice(0, 3)) assert(after.includes(check), check);
  assert(after.indexOf('assert_movement_context_snapshot(s.id)') < after.indexOf('p.created_at:=clock_timestamp()'));
  assert.match(sql, /WHERE x.movement_need_id=s.movement_need_id AND x.offering_member_id=s.offering_member_id\s*ORDER BY x.version FOR UPDATE/);
});
test('only 0071 owns economics and trusted policies are fixed', () => {
  assert.match(sql, /p.financial_model_version:='shared_platform_fee_v1'/);
  assert.match(sql, /p.platform_fee_allocation_policy_version:='equal_split_requester_remainder_v1'/);
  assert.match(sql, /calculate_financial_proposal_economics\(\s*q.seat_price_minor,s.people_count,p.financial_model_version,p.platform_fee_allocation_policy_version\)/);
  for (const column of ['quoted_platform_fee_total_minor', 'quoted_movement_contribution_minor']) assert(sql.includes(`p.${column}:=economics.${column};`));
  assert.doesNotMatch(sql, /\b(?:div|round|floor|ceil)\s*\(|\*\s*(?:0\.3|0\.15|0\.7|0\.85|30|15|70|85)\b/);
});
test('every proposal declaration comes from the exact snapshot or quote', () => {
  const mapping = {
    movement_need_id:'movement_need_id', offering_member_id:'offering_member_id', member_needing_movement_id:'requesting_member_id', vehicle_id:'vehicle_id',
    origin_area:'requester_origin_area', destination_area:'requester_destination_area', earliest_departure_at:'requester_earliest_departure_at', latest_departure_at:'requester_latest_departure_at',
    people_count:'people_count', seats_offered:'seats_offered', vehicle_seat_capacity:'vehicle_seat_capacity', proposed_pickup_area:'proposed_pickup_area', proposed_dropoff_area:'proposed_dropoff_area', estimated_arrival_minutes:'declared_arrival_minutes',
    movement_context_snapshot_id:'id', movement_context_snapshot_version:'version',
  };
  for (const [a,b] of Object.entries(mapping)) assert(sql.includes(`p.${a}:=s.${b};`), a);
  for (const [a,b] of Object.entries({currency:'currency',pricing_policy_version:'pricing_policy_version',pricing_quote_id:'id',pricing_quote_version:'version'})) assert(sql.includes(`p.${a}:=q.${b};`), a);
});
test('finite source-bounded database lifetime and initially NULL lifecycle links', () => {
  assert.match(sql, /p.created_at:=clock_timestamp\(\)/);
  assert.match(sql, /p.expires_at:=least\(q.expires_at,s.expires_at\)/);
  for (const f of ['route_evidence_id','offering_accepted_at','requester_accepted_at','movement_offer_id','alignment_id','financial_agreement_id','materialized_at']) assert(sql.includes(`p.${f}:=NULL;`), f);
  assert.match(sql, /p.status:='current'/);
  for (const check of ['quote_binding','movement_context_binding','source_compatibility']) assert(sql.includes('assert_financial_proposal_' + check + '(p)'));
});
test('deterministic need/offerer versioning rejects integer overflow', () => {
  assert.match(sql, /coalesce\(max\(x.version\)::bigint,0\)\+1/);
  assert.match(sql, /next_version>2147483647/);
  assert(sql.indexOf('max(x.version)') > sql.indexOf('ORDER BY x.version FOR UPDATE'));
});
test('exact replay includes terminal proposals, validates payload/economics/roster and never writes', () => {
  const replay = sql.slice(sql.indexOf('SELECT count(*) INTO replay_count'), sql.indexOf('SELECT coalesce(max'));
  for (const f of ['pricing_quote_id','pricing_quote_version','movement_context_snapshot_id','movement_context_snapshot_version','financial_model_version','platform_fee_allocation_policy_version']) assert(replay.includes('x.'+f));
  assert.doesNotMatch(replay, /AND x.status|INSERT INTO|UPDATE private/);
  assert.match(replay, /IF replay_count>1 THEN/);
  assert.match(replay, /replay payload mismatch/);
  assert.match(replay, /assert_financial_proposal_snapshot_roster\(previous.id\)/);
  assert.match(replay, /RETURN QUERY SELECT previous.id,previous.version,previous.status,previous.created_at,previous.expires_at/);
});
test('only safe current history may be superseded and immutable facts remain untouched', () => {
  for (const f of ['offering_accepted_at','requester_accepted_at','movement_offer_id','alignment_id','financial_agreement_id','materialized_at']) assert(sql.includes('x.'+f+' IS NOT NULL'));
  assert.match(sql, /UPDATE private.financial_proposals x SET status='superseded'/);
  assert.deepEqual([...sql.matchAll(/(?:INSERT INTO|UPDATE|DELETE FROM) ((?:private|public)\.\w+)/g)].map(m => m[1]), ['private.financial_proposals','private.financial_proposals','private.financial_proposal_travellers']);
});
test('exact snapshot roster copied, construction constraints deferred narrowly and drained', () => {
  assert.match(sql, /SELECT p.id,t.member_id,t.movement_participant_id,t.role\s*FROM private.movement_context_snapshot_travellers t WHERE t.snapshot_id=s.id/);
  assert.match(sql, /assert_financial_proposal_snapshot_roster\(p.id\)/);
  assert.doesNotMatch(sql, /SET CONSTRAINTS ALL|DISABLE TRIGGER|session_replication_role/);
  assert.match(sql, /financial_proposal_snapshot_roster_complete DEFERRED;[\s\S]*INSERT INTO private.financial_proposals[\s\S]*financial_proposal_snapshot_roster_complete IMMEDIATE;/);
  assert.doesNotMatch(sql, /accept_movement_offer|wallet_|ledger|payment|INSERT INTO public\.|UPDATE public\.|financial_components|member_profiles/);
});
test('behavioral fixture uses normal producers and ends in rollback', () => {
  assert.match(live, /^BEGIN;/); assert.match(live, /ROLLBACK;\s*$/);
  assert.doesNotMatch(live.replace(/--[^\n]*/g,''), /INSERT INTO private\.(?:pricing_quotes|pricing_geography_evidence|movement_context_snapshots|trusted_route_match_evidence)|DISABLE TRIGGER|session_replication_role/);
  for (const label of ['exact 0071 totals','exact source field mapping','exact historical roster copy','replay immutable payload','superseded proposal replay','wrong version','expired quote and snapshot','progressed proposal','failed transaction rolls back','no offer acceptance capacity alignment agreement wallet ledger payment journey writes']) assert(live.includes(label), label);
});
test('integration runners are inert, require installed migration and preserve clone safety', () => {
  new vm.Script(runner); new vm.Script(races);
  for (const source of [runner,races]) {
    assert.match(source, /if \(require.main === module\)/);
    assert.match(source, /version='0074'/);
    assert.doesNotMatch(source, /apply_migration|migration up|db push/);
  }
  for (const label of ['--format=custom','DEFAULT ACL','--use-list=','TEMPLATE template0','DROP DATABASE','fingerprint unchanged','issuerReplayRace','issuerNewVersionRace','quoteSupersessionRace','pg_blocking_pids','expiryDuringWait',"eligibilityRace('acceptance')"]) assert(races.includes(label), label);
  assert.doesNotMatch(races, /--no-acl/);
});
test('all 73 historical migrations remain byte-normalized unchanged', () => {
  const names=fs.readdirSync(dir).filter(n => /^\d{4}_.*\.sql$/.test(n) && +n.slice(0,4)<=73).sort();
  assert.equal(names.length,73);
  assert.equal(crypto.createHash('sha256').update(names.map(n=>n+'\n'+read(path.join(dir,n))).join('\n')).digest('hex'),'1e47a41f26b36ef823418fc4000cb8ef7a60d41b4bbc68d8a5f18a6825916c30');
});
test('new files have clean whitespace and final newlines', () => {
  for (const source of [raw,live,runner,races,read(__filename)]) { assert.doesNotMatch(source, /[\t ]+$/m); assert(source.endsWith('\n')); }
});
