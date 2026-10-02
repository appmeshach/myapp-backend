'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationsDir =
  path.join(__dirname, '../supabase/migrations');

const supabaseTestsDir =
  path.join(__dirname, '../supabase/tests');

const read = p =>
  fs.readFileSync(p, 'utf8')
    .replace(/\r\n/g, '\n');

const migrationPath =
  path.join(
    migrationsDir,
    '0072_trusted_movement_context_snapshot_producer.sql'
  );

const raw = read(migrationPath);

const sql =
  raw.replace(/--[^\n]*/g, '');


test(
  '0072 is exactly the trusted movement-context snapshot producer migration',
  () => {
    assert.deepEqual(
      fs.readdirSync(migrationsDir)
        .filter(name => /^0072_/.test(name)),
      [
        '0072_trusted_movement_context_snapshot_producer.sql'
      ]
    );

    assert.match(sql, /^BEGIN;/);
    assert.match(sql, /COMMIT;\s*$/);
  }
);


test(
  '0072 exposes one narrow service-only server RPC',
  () => {
    assert.match(
      sql,
      /CREATE FUNCTION public\.record_movement_context_snapshot_for_server\(\s*p_movement_offer_id uuid\s*\)/
    );

    assert.doesNotMatch(
      sql,
      /p_seats_offered|p_people_count|p_vehicle_id|p_requesting_member_id|p_offering_member_id/
    );

    assert.match(
      sql,
      /SECURITY DEFINER\s+SET search_path = ''/
    );

    assert.match(
      sql,
      /REVOKE ALL ON FUNCTION\s+public\.record_movement_context_snapshot_for_server\(uuid\)\s+FROM PUBLIC, anon, authenticated, service_role;/
    );

    assert.match(
      sql,
      /GRANT EXECUTE ON FUNCTION\s+public\.record_movement_context_snapshot_for_server\(uuid\)\s+TO service_role;/
    );
  }
);


test(
  '0072 derives movement terms from the existing authorized offer',
  () => {
    for (const required of [
      'private.movement_offer_route_match_bindings',
      'private.movement_offer_availability_bindings',
      'private.trusted_route_match_evidence',
      'private.offering_movement_availability',
      'private.offering_route_evidence',
      'private.offering_movement_intents',
      'public.movement_offers',
      'public.movement_needs',
      'public.vehicles',
      'public.movement_participants'
    ]) {
      assert.ok(
        sql.includes(required),
        required
      );
    }

    assert.match(
      sql,
      /PERFORM private\.assert_movement_offer_availability_binding\(o\.id\);/
    );

    assert.match(
      sql,
      /o\.seats_offered/
    );

    assert.match(
      sql,
      /o\.proposed_pickup_area/
    );

    assert.match(
      sql,
      /o\.proposed_dropoff_area/
    );

    assert.match(
      sql,
      /o\.estimated_arrival_minutes/
    );
  }
);


test(
  '0072 requires pending offer and discoverable need',
  () => {
    assert.match(
      sql,
      /o\.status IS DISTINCT FROM 'pending'/
    );

    assert.match(
      sql,
      /n\.status IS DISTINCT FROM 'discoverable'/
    );

    assert.match(
      sql,
      /Movement context snapshot requires a pending offer for an available need/
    );
  }
);


test(
  '0072 copies exact confirmed requester roster',
  () => {
    assert.match(
      sql,
      /mp\.status = 'confirmed'/
    );

    assert.match(
      sql,
      /confirmed_count IS DISTINCT FROM n\.people_count::bigint/
    );

    assert.match(
      sql,
      /invited_count <> 0/
    );

    assert.match(
      sql,
      /mp\.role = 'primary_requester'/
    );

    assert.match(
      sql,
      /INSERT INTO private\.movement_context_snapshot_travellers/
    );

    assert.match(
      sql,
      /mp\.id,\s*mp\.role/
    );
  }
);


test(
  '0072 exact replay returns the existing snapshot',
  () => {
    const replayStart =
      sql.indexOf(
        'IF existing_snapshot.movement_offer_id IS NOT DISTINCT FROM o.id THEN'
      );

    assert.ok(replayStart > 0);

    const replayBlock =
      sql.slice(
        replayStart,
        sql.indexOf(
          'UPDATE private.movement_context_snapshots',
          replayStart
        )
      );

    assert.match(
      replayBlock,
      /private\.assert_movement_context_snapshot_offer_binding/
    );

    assert.match(
      replayBlock,
      /private\.assert_movement_context_snapshot/
    );

    assert.match(
      replayBlock,
      /RETURN QUERY/
    );
  }
);


test(
  '0072 preserves need-first operational locking',
  () => {
    const needLock =
      sql.indexOf(
        'FROM public.movement_needs x'
      );

    const offerLock =
      sql.indexOf(
        'FROM public.movement_offers x',
        needLock
      );

    const authorization =
      sql.indexOf(
        'PERFORM private.assert_movement_offer_availability_binding(o.id);'
      );

    assert.ok(needLock > 0);
    assert.ok(offerLock > needLock);
    assert.ok(authorization > offerLock);

    assert.match(
      sql,
      /current_setting\('transaction_isolation'\) IS DISTINCT FROM 'read committed'/
    );
  }
);


test(
  '0072 writes only movement-context evidence',
  () => {
    const writes = [
      ...sql.matchAll(
        /(?:INSERT INTO|UPDATE|DELETE FROM)\s+((?:private|public)\.\w+)/g
      )
    ].map(match => match[1]);

    assert.deepEqual(
      writes,
      [
        'private.movement_context_snapshots',
        'private.movement_context_snapshots',
        'private.movement_context_snapshot_travellers'
      ]
    );

    assert.doesNotMatch(
      sql,
      /\bINSERT INTO\s+(?:public|private)\.(?:alignments|financial_proposals|financial_agreements|alignment_activation_payments|wallet\w*|payments?\w*)/i
    );
  }
);


test(
  '0072 does not consume availability or create journey lifecycle state',
  () => {
    assert.doesNotMatch(
      sql,
      /remaining_places\s*=|remaining_places\s*-|status\s*=\s*'accepted'/
    );

    assert.doesNotMatch(
      sql,
      /\bINSERT INTO\s+public\.alignments/
    );

    assert.doesNotMatch(
      sql,
      /\bINSERT INTO\s+(?:public|private)\.journeys/
    );
  }
);


test(
  '0072 private provenance helper is not executable by API roles',
  () => {
    assert.match(
      sql,
      /REVOKE ALL ON FUNCTION\s+private\.assert_movement_context_snapshot_offer_binding\(\s*private\.movement_context_snapshots\s*\)\s+FROM PUBLIC, anon, authenticated, service_role;/
    );

    assert.match(
      sql,
      /REVOKE ALL ON FUNCTION\s+private\.protect_produced_movement_context_snapshot\(\)\s+FROM PUBLIC, anon, authenticated, service_role;/
    );
  }
);


test(
  '0072 behavioral SQL is transactional and rollback-only',
  () => {
    const behavioral = read(
      path.join(
        supabaseTestsDir,
        '0072_trusted_movement_context_snapshot_producer_test.sql'
      )
    );

    assert.match(
      behavioral,
      /^BEGIN;/
    );

    assert.match(
      behavioral,
      /SET TRANSACTION ISOLATION LEVEL READ COMMITTED;/
    );

    assert.match(
      behavioral,
      /SET CONSTRAINTS ALL IMMEDIATE;/
    );

    assert.match(
      behavioral,
      /ROLLBACK;\s*$/
    );

    const withoutComments =
      behavioral.replace(/--[^\n]*/g, '');

    assert.doesNotMatch(
      withoutComments,
      /\bCOMMIT\s*;|DISABLE TRIGGER|session_replication_role/
    );
  }
);


test(
  '0072 behavioral runner fails when PostgreSQL fails',
  () => {
    const runner = read(
      path.join(
        supabaseTestsDir,
        '0072_trusted_movement_context_snapshot_producer_behavior.cjs'
      )
    );

    assert.match(
      runner,
      /result\.error \|\| result\.status !== 0/
    );

    assert.ok(
      runner.indexOf(
        'result.error || result.status !== 0'
      ) <
      runner.indexOf(
        'PASS full external rollback snapshot'
      )
    );
  }
);