const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const name =
  '0050_state_bound_movement_matching';

const read = file =>
  fs
    .readFileSync(
      path.join(__dirname, file),
      'utf8',
    )
    .replace(/\r\n/g, '\n');

const raw =
  read(`../migrations/${name}.sql`);

  const live =
  read(`${name}_test.sql`);

const sql =
  raw.replace(/--[^\n]*/g, '');

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
  IF to_regclass(
    'private.trusted_location_state_evidence'
  ) IS NOT NULL THEN
    RAISE EXCEPTION
      '0050 trusted state table survived rollback';
  END IF;

  IF to_regprocedure(
    'public.get_selected_location_resolution_context_with_state_for_server(uuid,uuid,uuid)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION
      '0050 state-aware context survived rollback';
  END IF;
END;
$restore$;

SELECT
  '0050 rollback verified; prior installation restored'
  AS result;
`
  );
}

if (
  process.argv.includes(
    '--print-rollback',
  )
) {
  process.stdout.write(
    rollbackBatch(),
  );

  process.exit(0);
}

function functionBody(
  start,
  terminator,
) {
  const startIndex =
    sql.indexOf(start);

  assert.notEqual(
    startIndex,
    -1,
    `missing function start: ${start}`,
  );

  const endIndex =
    sql.indexOf(
      terminator,
      startIndex,
    );

  assert.notEqual(
    endIndex,
    -1,
    `missing function terminator: ${terminator}`,
  );

  return sql.slice(
    startIndex,
    endIndex + terminator.length,
  );
}


test(
  '0050 has exactly one outer transaction',
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
      (
        sql.match(/^BEGIN;/gm)
        || []
      ).length,
      1,
    );

    assert.equal(
      (
        sql.match(/^COMMIT;/gm)
        || []
      ).length,
      1,
    );
  },
);


test(
  '0050 creates one immutable private trusted-state evidence table',
  () => {
    assert.match(
      sql,
      /CREATE TABLE private\.trusted_location_state_evidence\s*\(/,
    );

    assert.match(
      sql,
      /resolution_evidence_id uuid PRIMARY KEY/,
    );

    assert.match(
      sql,
      /resolved_location_reference_id uuid NOT NULL UNIQUE/,
    );

    assert.match(
      sql,
      /provider_namespace text NOT NULL/,
    );

    assert.match(
      sql,
      /state_provider_reference text NOT NULL/,
    );

    assert.match(
      sql,
      /state_name text NOT NULL/,
    );

    assert.match(
      sql,
      /state_key text NOT NULL/,
    );

    assert.match(
      sql,
      /schema_version text NOT NULL\s+DEFAULT 'trusted_location_state_v1'/,
    );

    assert.match(
      sql,
      /ALTER TABLE private\.trusted_location_state_evidence\s+ENABLE ROW LEVEL SECURITY/,
    );

    assert.doesNotMatch(
      sql,
      /CREATE POLICY[\s\S]*trusted_location_state_evidence/i,
    );
  },
);


test(
  '0050 trusted-state evidence is protected from update and delete',
  () => {
    assert.match(
      sql,
      /CREATE FUNCTION private\.protect_trusted_location_state_evidence\(\)/,
    );

    assert.match(
      sql,
      /CREATE TRIGGER protect_trusted_location_state_evidence/,
    );

    assert.match(
      sql,
      /BEFORE UPDATE OR DELETE\s+ON private\.trusted_location_state_evidence/,
    );

    assert.match(
      sql,
      /Trusted location state evidence is immutable/,
    );
  },
);


test(
  '0050 canonical Nigerian jurisdiction allowlist contains 36 states plus FCT',
  () => {
    const body =
      functionBody(
        'CREATE FUNCTION private.canonical_nigerian_state_key(',
        '$canonical_nigerian_state_key$;',
      );

    const jurisdictionCases =
      [
        ...body.matchAll(
          /WHEN '([^']+)' THEN '([^']+)'/g,
        ),
      ];

    assert.equal(
      jurisdictionCases.length,
      37,
    );

    assert.ok(
      jurisdictionCases.some(
        match =>
          match[1]
            === 'lagos'
          && match[2]
            === 'lagos',
      ),
    );

    assert.ok(
      jurisdictionCases.some(
        match =>
          match[1]
            === 'ogun'
          && match[2]
            === 'ogun',
      ),
    );

    assert.ok(
      jurisdictionCases.some(
        match =>
          match[1]
            === 'federal capital territory'
          && match[2]
            === 'fct',
      ),
    );

    assert.match(
      body,
      /right\(v_name,\s*6\)\s*=\s*' state'/,
    );

    assert.match(
      body,
      /ELSE NULL/,
    );
  },
);


test(
  '0050 state evidence assertion is bound to immutable resolution evidence and provider identity',
  () => {
    const body =
      functionBody(
        'CREATE FUNCTION private.assert_trusted_location_state_evidence(',
        '$assert_trusted_location_state$;',
      );

    assert.match(
      body,
      /private\.movement_location_resolution_evidence/,
    );

    assert.match(
      body,
      /private\.movement_location_references/,
    );

    assert.match(
      body,
      /resolved_location_reference_id/,
    );

    assert.match(
      body,
      /provider_namespace/,
    );

    assert.match(
      body,
      /canonical_nigerian_state_key/,
    );

    assert.match(
      body,
      /trusted_location_state_v1/,
    );

    assert.match(
      body,
      /Trusted location state evidence is invalid/,
    );
  },
);


test(
  '0050 exposes a service-only state-aware resolution context',
  () => {
    const signature =
      'public.get_selected_location_resolution_context_with_state_for_server';

    const body =
      functionBody(
        `CREATE FUNCTION\n${signature}(`,
        '$state_resolution_context$;',
      );

    assert.match(
      body,
      /has_trusted_state_evidence boolean/,
    );

    assert.match(
      body,
      /private\.trusted_location_state_evidence/,
    );

    assert.match(
      body,
      /assert_trusted_location_state_evidence/,
    );

    assert.match(
      sql,
      new RegExp(
        `GRANT EXECUTE\\s+ON FUNCTION\\s+${signature.replace(
          /\./g,
          '\\.',
        )}\\([\\s\\S]*?\\)\\s+TO service_role`,
      ),
    );

    assert.doesNotMatch(
      sql,
      new RegExp(
        `GRANT EXECUTE\\s+ON FUNCTION\\s+${signature.replace(
          /\./g,
          '\\.',
        )}\\([\\s\\S]*?\\)\\s+TO (?:anon|authenticated)`,
      ),
    );
  },
);


test(
  '0050 state-aware writer preserves legacy resolution evidence instead of rewriting it',
  () => {
    const body =
      functionBody(
        'CREATE FUNCTION public.record_attested_location_resolution_for_server(',
        '$resolve_with_state$;',
      );

    assert.match(
      body,
      /v_prior_evidence/,
    );

    assert.match(
      body,
      /WHERE e\.producer_request_id\s*=\s*p_producer_request_id/,
    );

    assert.match(
      body,
      /assert_movement_location_resolution_evidence/,
    );

    assert.match(
      body,
      /INSERT INTO private\.trusted_location_state_evidence/,
    );

    assert.match(
      body,
      /RETURN QUERY[\s\S]*v_prior_evidence\.id[\s\S]*v_prior_evidence\.resolved_location_reference_id[\s\S]*v_prior_evidence\.version/,
    );

    assert.doesNotMatch(
      body,
      /UPDATE\s+private\.movement_location_resolution_evidence/i,
    );

    assert.doesNotMatch(
      body,
      /UPDATE\s+private\.movement_location_references/i,
    );
  },
);


test(
  '0050 closes the old state-less service writer',
  () => {
    assert.match(
      sql,
      /REVOKE ALL\s+ON FUNCTION public\.record_attested_location_resolution_for_server\(\s*uuid,uuid,uuid,\s*text,text,text,text,text,text,\s*numeric,numeric,timestamptz,timestamptz\s*\)\s+FROM PUBLIC,anon,authenticated,service_role/,
    );

    assert.doesNotMatch(
      sql,
      /GRANT EXECUTE\s+ON FUNCTION public\.record_attested_location_resolution_for_server\(\s*uuid,uuid,uuid,\s*text,text,text,text,text,text,text,\s*numeric,numeric,timestamptz,timestamptz\s*\)\s+TO service_role/,
    );
  },
);


test(
  '0050 matching assertion fails closed without trusted state evidence',
  () => {
    const body =
      functionBody(
        'CREATE FUNCTION private.assert_state_bound_matching_context(',
        '$assert_state_bound_matching_context$;',
      );

    assert.match(
      body,
      /Requester origin trusted state evidence is unavailable/,
    );

    assert.match(
      body,
      /Requester destination trusted state evidence is unavailable/,
    );

    assert.match(
      body,
      /Offering origin trusted state evidence is unavailable/,
    );

    assert.match(
      body,
      /Offering destination trusted state evidence is unavailable/,
    );

    assert.match(
      body,
      /assert_trusted_location_state_evidence/,
    );
  },
);


test(
  '0050 enforces requester-contained offered-contained and same-state connection invariants',
  () => {
    const body =
      functionBody(
        'CREATE FUNCTION private.assert_state_bound_matching_context(',
        '$assert_state_bound_matching_context$;',
      );

    assert.match(
      body,
      /Requester movement crosses a state boundary/,
    );

    assert.match(
      body,
      /Offered movement crosses a state boundary/,
    );

    assert.match(
      body,
      /Requester and offered movements are in different states/,
    );

    const providerReferenceChecks =
      body.match(
        /state_provider_reference/g,
      ) || [];

    assert.ok(
      providerReferenceChecks.length >= 6,
    );

    const stateKeyChecks =
      body.match(
        /state_key/g,
      ) || [];

    assert.ok(
      stateKeyChecks.length >= 6,
    );

    assert.doesNotMatch(
      body,
      /\borigin_area\b|\bdestination_area\b|declared_label|profile/i,
    );
  },
);


test(
  '0050 preserves the original public trusted matching function identity',
  () => {
    assert.match(
      sql,
      /CREATE OR REPLACE FUNCTION\s+public\.get_trusted_matching_context_for_server\(\s*p_movement_need_id uuid,\s*p_offering_movement_intent_id uuid,\s*p_offering_member_id uuid\s*\)/,
    );

    assert.doesNotMatch(
      sql,
      /ALTER FUNCTION\s+public\.get_trusted_matching_context_for_server\(\s*uuid,\s*uuid,\s*uuid\s*\)\s+SET SCHEMA private/,
    );

    assert.doesNotMatch(
      sql,
      /get_trusted_matching_context_without_state_for_server/,
    );
  },
);


test(
  '0050 public trusted matching context preserves mature validation and adds the state gate before return',
  () => {
    const body =
      functionBody(
        'CREATE OR REPLACE FUNCTION\npublic.get_trusted_matching_context_for_server(',
        '$trusted_matching_context$;',
      );

    assert.match(
      body,
      /private\.assert_offering_movement_intent/,
    );

    assert.match(
      body,
      /private\.assert_geojson_linestring_v1/,
    );

    assert.match(
      body,
      /private\.assert_state_bound_matching_context/,
    );

    assert.match(
      body,
      /route_evidence_id uuid/,
    );

    assert.match(
      body,
      /route_shape jsonb/,
    );

    const stateGate =
      body.indexOf(
        'PERFORM private.assert_state_bound_matching_context(',
      );

    const returnQuery =
      body.indexOf('RETURN QUERY');

    assert.ok(stateGate >= 0);
    assert.ok(returnQuery > stateGate);

    assert.doesNotMatch(
      body,
      /get_trusted_matching_context_without_state_for_server/,
    );

    assert.match(
      sql,
      /GRANT EXECUTE\s+ON FUNCTION\s+public\.get_trusted_matching_context_for_server\(\s*uuid,\s*uuid,\s*uuid\s*\)\s+TO service_role/,
    );

    assert.doesNotMatch(
      sql,
      /GRANT EXECUTE\s+ON FUNCTION\s+public\.get_trusted_matching_context_for_server\(\s*uuid,\s*uuid,\s*uuid\s*\)\s+TO (?:anon|authenticated)/,
    );
  },
);


test(
  '0050 does not use client labels or profile state as matching security inputs',
  () => {
    const matchingSection =
      sql.slice(
        sql.indexOf(
          'CREATE FUNCTION private.assert_state_bound_matching_context(',
        ),
      );

    assert.doesNotMatch(
      matchingSection,
      /\bmovement_needs\.origin_area\b|\bmovement_needs\.destination_area\b|\bdeclared_label\b|\bprofile_state\b|\bhome_state\b/i,
    );

    assert.doesNotMatch(
      matchingSection,
      /\bdetour\b|max_detour|maximum_detour/i,
    );
  },
);