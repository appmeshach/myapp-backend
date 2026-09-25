const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const migration =
  'supabase/migrations/0046_requester_availability_matching_context.sql';

const behavioral =
  'supabase/tests/0046_requester_availability_matching_context_test.sql';

const raw =
  fs.readFileSync(migration, 'utf8')
    .replace(/\r\n/g, '\n');

const live =
  fs.readFileSync(behavioral, 'utf8')
    .replace(/\r\n/g, '\n');

const sql =
  raw.replace(/--[^\n]*/g, '');

function functionBody() {
  const start =
    sql.indexOf(
      'CREATE FUNCTION\n'
      + 'public.get_requester_availability_matching_context_for_server(',
    );

  assert.ok(
    start >= 0,
    '0046 requester availability matching context function exists',
  );

  const endMarker =
    '$requester_availability_matching_context$;';

  const end =
    sql.indexOf(
      endMarker,
      start,
    );

  assert.ok(
    end >= 0,
    '0046 requester availability matching context function terminates',
  );

  return sql.slice(
    start,
    end + endMarker.length,
  );
}

const body = functionBody();

function rollbackBatch() {
  const migrationWithoutCommit =
    raw.replace(
      /COMMIT;\s*$/,
      '',
    );

  const behavioralInsideTransaction =
    live.replace(
      /^BEGIN;\s*SET TRANSACTION ISOLATION LEVEL READ COMMITTED;\s*/,
      '',
    );

  return (
    migrationWithoutCommit
    + '\n'
    + behavioralInsideTransaction
    + '\n'
    + `
DO $restore$
BEGIN
  IF to_regprocedure(
    'public.get_requester_availability_matching_context_for_server(uuid,uuid,uuid)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION
      '0046 requester availability matching context survived rollback';
  END IF;
END;
$restore$;

SELECT
  '0046 rollback verified: function absent'
  AS result;
`
  );
}


if (process.argv.includes('--print-rollback')) {
  process.stdout.write(
    rollbackBatch(),
  );

  process.exit(0);
}

test(
  '0046 contains exactly one transaction and creates no table',
  () => {
    assert.match(
      sql,
      /^BEGIN;/,
    );

    assert.match(
      sql,
      /COMMIT;\s*$/,
    );

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
      /\bCREATE\s+TABLE\b/i,
    );

    assert.doesNotMatch(
      sql,
      /\bCREATE\s+OR\s+REPLACE\b/i,
    );

    assert.doesNotMatch(
      sql,
      /\bDROP\b/i,
    );
  },
);

test(
  '0046 creates only the narrow requester availability context function',
  () => {
    const functions =
      [
        ...sql.matchAll(
          /CREATE\s+FUNCTION\s+([\w.]+)\s*\(/g,
        ),
      ].map(
        match => match[1],
      );

    assert.deepEqual(
      functions,
      [
        'public.get_requester_availability_matching_context_for_server',
      ],
    );

    assert.match(
      body,
      /p_verified_member_id uuid,\s+p_movement_need_id uuid,\s+p_availability_id uuid/,
    );

    assert.doesNotMatch(
      body,
      /\bp_offering_movement_intent_id\b/,
    );

    assert.doesNotMatch(
      body,
      /\bp_offering_member_id\b/,
    );

    assert.doesNotMatch(
      body,
      /\bp_route_evidence_id\b/,
    );

    assert.doesNotMatch(
      body,
      /\bp_latitude\b|\bp_longitude\b|\bp_route_shape\b/,
    );
  },
);

test(
  '0046 server function pins search path and grants execution only to service role',
  () => {
    assert.match(
      body,
      /LANGUAGE plpgsql\s+SECURITY DEFINER\s+SET search_path = ''/,
    );

    assert.match(
      sql,
      /REVOKE ALL\s+ON FUNCTION\s+public\.get_requester_availability_matching_context_for_server\(\s*uuid,\s*uuid,\s*uuid\s*\)\s+FROM PUBLIC, anon, authenticated, service_role;/,
    );

    assert.match(
      sql,
      /GRANT EXECUTE\s+ON FUNCTION\s+public\.get_requester_availability_matching_context_for_server\(\s*uuid,\s*uuid,\s*uuid\s*\)\s+TO service_role;/,
    );

    assert.equal(
      (sql.match(/\bGRANT\s+EXECUTE\b/g) || []).length,
      1,
    );

    assert.doesNotMatch(
      sql,
      /\bTO authenticated\b/,
    );

    assert.doesNotMatch(
      sql,
      /\bTO anon\b/,
    );
  },
);

test(
  '0046 preserves READ COMMITTED and requester ownership authorization',
  () => {
    assert.match(
      body,
      /current_setting\('transaction_isolation'\)\s+<> 'read committed'/,
    );

    assert.match(
      body,
      /FROM public\.movement_needs n\s+WHERE n\.id = p_movement_need_id\s+FOR UPDATE/,
    );

    assert.match(
      body,
      /v_need\.member_id\s+IS DISTINCT FROM p_verified_member_id/,
    );

    assert.match(
      body,
      /Verified member does not own this movement need/,
    );
  },
);

test(
  '0046 follows the established 0045 lock bridge before availability assertion',
  () => {
    const lockIndex =
      body.indexOf(
        'private.lock_offer_availability_intent(',
      );

    const availabilityAssertionIndex =
      body.indexOf(
        'private.assert_offering_movement_availability(',
      );

    const trustedContextIndex =
      body.indexOf(
        'public.get_trusted_matching_context_for_server(',
      );

    assert.ok(
      lockIndex >= 0,
      '0045 lock helper is reused',
    );

    assert.ok(
      availabilityAssertionIndex > lockIndex,
      'availability assertion follows established requester/intent prelocks',
    );

    assert.ok(
      trustedContextIndex > availabilityAssertionIndex,
      '0036 trusted matching context is reused after availability validation',
    );
  },
);

test(
  '0046 privately derives exact availability bindings and rechecks them',
  () => {
    assert.match(
      body,
      /private\.offering_movement_availability%ROWTYPE/,
    );

    for (const field of [
      'offering_movement_intent_id',
      'offering_member_id',
      'route_evidence_id',
      'route_evidence_version',
    ]) {
      assert.match(
        body,
        new RegExp(
          `v_preliminary_availability\\s*\\.${field}`,
        ),
        `preliminary availability ${field}`,
      );

      assert.match(
        body,
        new RegExp(
          `v_availability\\s*\\.${field}`,
        ),
        `authoritative availability ${field}`,
      );
    }

    assert.match(
      body,
      /FROM private\.offering_movement_availability a\s+WHERE a\.id = p_availability_id/,
    );

    assert.match(
      body,
      /private\.assert_offering_movement_availability\(\s*p_availability_id\s*\)/,
    );
  },
);

test(
  '0046 reuses 0036 trusted matching context instead of duplicating route logic',
  () => {
    assert.match(
      body,
      /FROM public\.get_trusted_matching_context_for_server\(\s*v_need\.id,\s*v_availability\.offering_movement_intent_id,\s*v_availability\.offering_member_id\s*\) c/,
    );

    assert.match(
      body,
      /v_context\.route_evidence_id\s+IS DISTINCT FROM\s+v_availability\.route_evidence_id/,
    );

    assert.match(
      body,
      /v_context\.route_evidence_version\s+IS DISTINCT FROM\s+v_availability\.route_evidence_version/,
    );

    assert.match(
      body,
      /v_context\.offering_movement_intent_id\s+IS DISTINCT FROM\s+v_availability\.offering_movement_intent_id/,
    );

    assert.match(
      body,
      /v_context\.offering_member_id\s+IS DISTINCT FROM\s+v_availability\.offering_member_id/,
    );
  },
);

test(
  '0046 checks complete-group capacity without operational mutation',
  () => {
    assert.match(
      body,
      /v_need\.people_count\s+>\s+v_availability\.remaining_places/,
    );

    assert.match(
      body,
      /Availability cannot serve the complete requester group/,
    );

    assert.doesNotMatch(
      body,
      /\bINSERT\s+INTO\b/i,
    );

    assert.doesNotMatch(
      body,
      /\bUPDATE\s+(?:public|private)\./i,
    );

    assert.doesNotMatch(
      body,
      /\bDELETE\s+FROM\b/i,
    );

    assert.doesNotMatch(
      body,
      /\bremaining_places\s*[-+]=|\bremaining_places\s*=\s*remaining_places/i,
    );

    assert.doesNotMatch(
      body,
      /\bcreate_movement_offer\b|\baccept_movement_offer\b/i,
    );

    assert.doesNotMatch(
      body,
      /\bINSERT\s+INTO\s+public\.alignments\b/i,
    );
  },
);

test(
  '0046 contains no interest, journey, pricing or maximum-distance decision',
  () => {
    const executable =
      body.replace(
        /RAISE EXCEPTION[\s\S]*?;/g,
        '',
      );

    assert.doesNotMatch(
      executable,
      /\binterest\b/i,
    );

    assert.doesNotMatch(
      executable,
      /\bjourney\b/i,
    );

    assert.doesNotMatch(
      executable,
      /\bpayment\b|\bpricing\b|\bfare\b|\bprice\b/i,
    );

    assert.doesNotMatch(
      executable,
      /\bmax(?:imum)?[_\s-]*(?:distance|detour)\b/i,
    );

    assert.doesNotMatch(
      executable,
      /\bdistance[_\s-]*(?:limit|threshold)\b/i,
    );
  },
);

test(
  '0046 returns the established TrustedMatchingContext shape',
  () => {
    const returns =
      body.match(
        /RETURNS TABLE \(([\s\S]*?)\)\s+LANGUAGE plpgsql/,
      );

    assert.ok(
      returns,
      'RETURNS TABLE block exists',
    );

    const columns =
      returns[1]
        .split(',')
        .map(
          value =>
            value
              .trim()
              .replace(/\s+/g, ' '),
        );

    assert.deepEqual(
      columns,
      [
        'movement_need_id uuid',
        'requesting_member_id uuid',
        'requester_origin_location_reference_id uuid',
        'requester_origin_latitude numeric',
        'requester_origin_longitude numeric',
        'requester_destination_location_reference_id uuid',
        'requester_destination_latitude numeric',
        'requester_destination_longitude numeric',
        'requester_earliest_departure_at timestamptz',
        'requester_latest_departure_at timestamptz',
        'offering_movement_intent_id uuid',
        'offering_member_id uuid',
        'offering_intent_version integer',
        'offering_earliest_departure_at timestamptz',
        'offering_latest_departure_at timestamptz',
        'route_evidence_id uuid',
        'route_evidence_version integer',
        'route_shape_format text',
        'route_shape jsonb',
        'route_distance_meters bigint',
        'route_duration_seconds bigint',
        'route_generated_at timestamptz',
        'route_expires_at timestamptz',
      ],
    );
  },
);

test(
  '0046 rollback batch installs and tests in one transaction then verifies removal',
  () => {
    const batch =
      rollbackBatch();

    assert.equal(
      (
        batch.match(
          /^BEGIN;/gm,
        ) || []
      ).length,
      1,
    );

    assert.equal(
      (
        batch.match(
          /^ROLLBACK;/gm,
        ) || []
      ).length,
      1,
    );

    assert.doesNotMatch(
      batch,
      /^COMMIT;/m,
    );

    assert.ok(
      batch.indexOf(
        'CREATE FUNCTION\npublic.get_requester_availability_matching_context_for_server(',
      )
      <
      batch.indexOf(
        'CREATE TEMP TABLE pg_temp.requester_availability_matching_results',
      ),
    );

    assert.ok(
      batch.indexOf(
        'ROLLBACK;',
      )
      <
      batch.indexOf(
        '0046 requester availability matching context survived rollback',
      ),
    );

    assert.match(
      batch,
      /to_regprocedure\(\s*'public\.get_requester_availability_matching_context_for_server\(uuid,uuid,uuid\)'\s*\) IS NOT NULL/,
    );
  },
);