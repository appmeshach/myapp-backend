const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const name = '0049_interest_authorized_offer_continuation';

const read = file =>
  fs
    .readFileSync(path.join(__dirname, file), 'utf8')
    .replace(/\r\n/g, '\n');

const raw = read(`../migrations/${name}.sql`);
const sql = raw.replace(/--[^\n]*/g, '');
const live = read(`${name}_test.sql`);

const oldRpc =
  'public.create_movement_offer(uuid,uuid,uuid,integer,text,text,integer)';

const internalRpc =
  'private.create_movement_offer_internal(uuid,uuid,uuid,integer,text,text,integer)';

const interestRpc =
  'public.create_movement_offer_from_interest(uuid,integer,text,text,integer)';

const requestFirst = sql.slice(
  sql.indexOf('CREATE FUNCTION public.create_movement_offer('),
  sql.indexOf('$request_first$;') + '$request_first$;'.length,
);

const interestOffer = sql.slice(
  sql.indexOf(
    'CREATE FUNCTION public.create_movement_offer_from_interest(',
  ),
  sql.indexOf('$interest_offer$;') + '$interest_offer$;'.length,
);

function rollbackBatch() {
  return (
    `SELECT '${oldRpc}'::regprocedure::oid AS original_offer_oid
\\gset
` +
    raw.replace(/COMMIT;\s*$/, '') +
    '\n' +
    live.replace(
      /^BEGIN;\s*SET TRANSACTION ISOLATION LEVEL READ COMMITTED;/,
      '',
    ) +
    `
DO $restored$
BEGIN
  IF to_regprocedure('${interestRpc}') IS NOT NULL THEN
    RAISE EXCEPTION '0049 interest RPC survived rollback';
  END IF;

  IF to_regprocedure('${internalRpc}') IS NOT NULL THEN
    RAISE EXCEPTION '0049 internal constructor survived rollback';
  END IF;

  IF to_regprocedure('${oldRpc}') IS NULL THEN
    RAISE EXCEPTION '0049 rollback failed to restore request-first RPC';
  END IF;
END;
$restored$;

SELECT (
  '${oldRpc}'::regprocedure::oid = :original_offer_oid::oid
) AS original_offer_identity_restored
\\gset

\\if :original_offer_identity_restored
SELECT '0049 rollback verified; original request-first RPC restored' AS result;
\\else
\\echo '0049 rollback changed original request-first RPC identity'
\\quit 1
\\endif
`
  );
}

if (process.argv.includes('--print-rollback')) {
  process.stdout.write(rollbackBatch());
  process.exit(0);
}

test('0049 has one forward transaction and creates no tables or policies', () => {
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /COMMIT;\s*$/);

  assert.equal(
    (sql.match(/^BEGIN;/gm) || []).length,
    1,
  );

  assert.equal(
    (sql.match(/^COMMIT;/gm) || []).length,
    1,
  );

  assert.doesNotMatch(
    sql,
    /CREATE\s+(?:TABLE|POLICY|INDEX|TRIGGER)|DROP\s+(?:TABLE|FUNCTION)|TRUNCATE\s|DISABLE\s/i,
  );
});

test('0049 moves the exact 0045 constructor instead of copying offer construction logic', () => {
  assert.match(
    sql,
    /ALTER FUNCTION public\.create_movement_offer\(uuid,uuid,uuid,integer,text,text,integer\)\s+SET SCHEMA private;/,
  );

  assert.match(
    sql,
    /ALTER FUNCTION private\.create_movement_offer\(uuid,uuid,uuid,integer,text,text,integer\)\s+RENAME TO create_movement_offer_internal;/,
  );

  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION private\.create_movement_offer_internal\(uuid,uuid,uuid,integer,text,text,integer\)\s+FROM PUBLIC, anon, authenticated, service_role;/,
  );

  assert.equal(
    (
      sql.match(
        /private\.create_movement_offer_internal\(/g,
      ) || []
    ).length,
    3,
  );

  assert.doesNotMatch(
    sql,
    /INSERT\s+INTO\s+public\.movement_offers/i,
  );

  assert.doesNotMatch(
    sql,
    /INSERT\s+INTO\s+private\.movement_offer_(?:route_match|availability)_bindings/i,
  );
});

test('request-first public API is preserved as an authenticated-only wrapper', () => {
  assert.match(
    requestFirst,
    /p_movement_need_id uuid,\s+p_route_match_evidence_id uuid,\s+p_availability_id uuid,\s+p_seats_offered integer,\s+p_proposed_pickup_area text DEFAULT NULL,\s+p_proposed_dropoff_area text DEFAULT NULL,\s+p_estimated_arrival_minutes integer DEFAULT NULL/,
  );

  assert.match(
    requestFirst,
    /RETURNS TABLE \(movement_offer_id uuid, status text, created_at timestamptz\)/,
  );

  assert.match(
    requestFirst,
    /LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''/,
  );

  assert.match(
    requestFirst,
    /RETURN QUERY SELECT \* FROM private\.create_movement_offer_internal\(\s*p_movement_need_id, p_route_match_evidence_id, p_availability_id,\s*p_seats_offered, p_proposed_pickup_area, p_proposed_dropoff_area,\s*p_estimated_arrival_minutes\);/,
  );

  assert.doesNotMatch(
    requestFirst,
    /requester_movement_interest|assert_requester_movement_interest|p_interest_id/,
  );

  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.create_movement_offer\(uuid,uuid,uuid,integer,text,text,integer\)\s+FROM PUBLIC, anon, authenticated, service_role;/,
  );

  assert.match(
    sql,
    /GRANT EXECUTE ON FUNCTION public\.create_movement_offer\(uuid,uuid,uuid,integer,text,text,integer\)\s+TO authenticated;/,
  );
});

test('interest continuation exposes only interest id and proposal fields', () => {
  const signature = interestOffer.match(
    /CREATE FUNCTION public\.create_movement_offer_from_interest\(([^]*?)\)\s+RETURNS TABLE/,
  )[1];

  assert.deepEqual(
    signature
      .split(',')
      .map(value => value.trim()),
    [
      'p_interest_id uuid',
      'p_seats_offered integer',
      'p_proposed_pickup_area text DEFAULT NULL',
      'p_proposed_dropoff_area text DEFAULT NULL',
      'p_estimated_arrival_minutes integer DEFAULT NULL',
    ],
  );

  assert.doesNotMatch(
    signature,
    /movement_need_id|route_match_evidence_id|availability_id|offering_member_id|requesting_member_id|offering_movement_intent_id/,
  );

  assert.match(
    interestOffer,
    /RETURNS TABLE \(movement_offer_id uuid, status text, created_at timestamptz\)/,
  );
});

test('interest continuation requires authenticated offerer ownership and READ COMMITTED', () => {
  assert.match(
    interestOffer,
    /v_member_id uuid := auth\.uid\(\)/,
  );

  assert.match(
    interestOffer,
    /current_setting\('transaction_isolation'\) <> 'read committed'/,
  );

  assert.match(
    interestOffer,
    /v_member_id IS NULL OR NOT EXISTS \(\s*SELECT 1 FROM public\.members m WHERE m\.id = v_member_id\s*\)/,
  );

  assert.match(
    interestOffer,
    /p_interest_id IS NULL/,
  );

  assert.match(
    interestOffer,
    /FROM private\.requester_movement_interests i\s+WHERE i\.id = p_interest_id AND i\.offering_member_id = v_member_id/,
  );

  assert.match(
    interestOffer,
    /MESSAGE = 'Requester interest unavailable'/,
  );
});

test('interest continuation reuses authoritative 0047 support and rechecks lifecycle under lock', () => {
  assert.equal(
    (
      interestOffer.match(
        /PERFORM private\.assert_requester_movement_interest\(v_interest\.id\)/g,
      ) || []
    ).length,
    1,
  );

  assert.ok(
    interestOffer.indexOf(
      'PERFORM private.assert_requester_movement_interest',
    ) <
      interestOffer.indexOf(
        'SELECT i.* INTO STRICT v_interest',
      ),
  );

  assert.match(
    interestOffer,
    /SELECT i\.\* INTO STRICT v_interest FROM private\.requester_movement_interests i\s+WHERE i\.id = p_interest_id;/,
  );

  assert.match(
    interestOffer,
    /v_interest\.offering_member_id IS DISTINCT FROM v_member_id/,
  );

  assert.match(
    interestOffer,
    /v_interest\.requesting_member_id = v_member_id/,
  );

  assert.match(
    interestOffer,
    /v_interest\.status <> 'active'/,
  );

  assert.match(
    interestOffer,
    /v_interest\.expires_at <= clock_timestamp\(\)/,
  );
});

test('interest continuation reuses exact objective evidence and hidden bindings server-side', () => {
  assert.match(
    interestOffer,
    /private\.create_movement_offer_internal\(\s*v_interest\.movement_need_id, v_interest\.route_match_evidence_id,\s*v_interest\.availability_id, p_seats_offered, p_proposed_pickup_area,\s*p_proposed_dropoff_area, p_estimated_arrival_minutes\)/,
  );

  for (const hidden of [
    'v_interest.movement_need_id',
    'v_interest.route_match_evidence_id',
    'v_interest.availability_id',
  ]) {
    assert.ok(
      interestOffer.includes(hidden),
      hidden,
    );
  }

  assert.doesNotMatch(
    interestOffer,
    /record_trusted_route_match_evidence_for_server|record_offering_route_evidence_for_server|get_requester_availability_matching_context_for_server/i,
  );

  assert.doesNotMatch(
    interestOffer,
    /Mapbox|fetch\s*\(|https?:\/\//i,
  );
});

test('0049 adds no capacity reservation alignment journey or interest lifecycle mutation', () => {
  assert.doesNotMatch(
    sql,
    /remaining_places\s*=|INSERT\s+INTO\s+public\.alignments|INSERT\s+INTO\s+public\.journeys/i,
  );

  assert.doesNotMatch(
    interestOffer,
    /\bUPDATE\s+private\.requester_movement_interests|\bDELETE\s+FROM\s+private\.requester_movement_interests/i,
  );

  assert.doesNotMatch(
    interestOffer,
    /gallery|media|payment|pricing|activation|notification|pg_notify/i,
  );

  assert.doesNotMatch(
    interestOffer,
    /max_detour|max_distance|best_match|rank|score/i,
  );
});

test('both public RPCs are authenticated-only and the internal constructor remains private', () => {
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.create_movement_offer_from_interest\(uuid,integer,text,text,integer\)\s+FROM PUBLIC, anon, authenticated, service_role;/,
  );

  assert.match(
    sql,
    /GRANT EXECUTE ON FUNCTION public\.create_movement_offer_from_interest\(uuid,integer,text,text,integer\)\s+TO authenticated;/,
  );

  assert.doesNotMatch(
    sql,
    /GRANT EXECUTE ON FUNCTION private\.create_movement_offer_internal/,
  );

  assert.doesNotMatch(
    sql,
    /TO service_role;|TO anon;/,
  );
});

test('behavioral harness covers authorization stale support reuse and acceptance semantics', () => {
  for (const scenario of [
    'unrelated offerer denied',
    'requester cannot act as offerer',
    'missing auth denied',
    'null interest denied',
    'missing interest denied',
    'malformed UUID denied',
    'private helper revoked from ',
    'authenticated public RPC only',
    'interest_withdrawn',
    'availability_withdrawn',
    'unavailable',
    'full',
    'group_fit',
    'need_paused',
    'need_closed',
    'evidence_superseded',
    'access_revoked',
    'replaced offering route denied',
    'own supported interest creates pending offer',
    'safe exact return shape',
    'derived need offerer vehicle and proposal',
    'exact objective evidence and intent bound',
    'exact availability bound',
    'no evidence created or rewritten',
    'interest unchanged',
    'capacity needs participants alignments journeys unchanged',
    'large distance retained',
    'existing evidence offer uniqueness preserved atomically',
    'request-first without any interest still works',
    'acceptance revalidates support before capacity',
    'acceptance alone consumes group capacity',
    'expired evidence and elapsed interest rejected',
    'expired status rejected',
    'expired movement need rejected',
  ]) {
    assert.ok(
      live.includes(scenario),
      scenario,
    );
  }

  assert.match(
    live,
    /'rejects '\|\|scenario\|\|' atomically'/,
  );

  assert.match(
    live,
    /pg_sleep\(2\.1\)/,
  );

  assert.doesNotMatch(
    live,
    /DISABLE TRIGGER|session_replication_role/,
  );
});

test('behavioral harness is rollback-only and fails if any recorded check fails', () => {
  assert.match(
    live,
    /^BEGIN;\s+SET TRANSACTION ISOLATION LEVEL READ COMMITTED;/,
  );

  assert.match(
    live,
    /ROLLBACK;\s*$/,
  );

  assert.equal(
    (live.match(/^BEGIN;/gm) || []).length,
    1,
  );

  assert.equal(
    (live.match(/^ROLLBACK;/gm) || []).length,
    1,
  );

  assert.equal(
    (live.match(/^COMMIT;/gm) || []).length,
    0,
  );

  assert.match(
    live,
    /IF EXISTS\(SELECT 1 FROM pg_temp\.interest_results WHERE NOT passed\) THEN\s+RAISE EXCEPTION '0049 interest offer behavior test failed';/,
  );
});

test('rollback batch installs actual 0049 SQL and restores original request-first function identity', () => {
  const batch = rollbackBatch();

  assert.ok(
    batch.includes(
      raw.replace(/COMMIT;\s*$/, ''),
    ),
  );

  assert.equal(
    (batch.match(/^BEGIN;/gm) || []).length,
    1,
  );

  assert.equal(
    (batch.match(/^ROLLBACK;/gm) || []).length,
    1,
  );

  assert.equal(
    (batch.match(/^COMMIT;/gm) || []).length,
    0,
  );

  assert.match(
    batch,
    /original_offer_oid/,
  );

  assert.match(
    batch,
    /0049 interest RPC survived rollback/,
  );

  assert.match(
    batch,
    /0049 internal constructor survived rollback/,
  );

  assert.match(
    batch,
    /0049 rollback failed to restore request-first RPC/,
  );

  assert.match(
    batch,
    /0049 rollback changed original request-first RPC identity/,
  );
});
