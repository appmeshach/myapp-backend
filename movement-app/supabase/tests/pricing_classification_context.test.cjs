const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..', '..');

const migrationPath = path.join(
  root,
  'supabase',
  'migrations',
  '0062_pricing_classification_context.sql',
);

const contractsPath = path.join(
  root,
  'supabase',
  'functions',
  '_shared',
  'route-contracts.ts',
);

const runtimePath = path.join(
  root,
  'supabase',
  'functions',
  '_shared',
  'route-runtime.ts',
);

const docsPath = path.join(
  root,
  'docs',
  'pricing-classification-context.md',
);

const migration =
  fs.readFileSync(migrationPath, 'utf8');

const contracts =
  fs.readFileSync(contractsPath, 'utf8');

const runtime =
  fs.readFileSync(runtimePath, 'utf8');

const docs =
  fs.readFileSync(docsPath, 'utf8');

test(
  '0062 has one outer transaction',
  () => {
    assert.equal(
      (migration.match(/\bBEGIN\s*;/gi) || []).length,
      1,
    );

    assert.equal(
      (migration.match(/\bCOMMIT\s*;/gi) || []).length,
      1,
    );
  },
);

test(
  '0062 creates only the trusted classification context RPC',
  () => {
    assert.match(
      migration,
      /CREATE FUNCTION\s+public\.get_pricing_classification_context_for_server/i,
    );

    assert.doesNotMatch(
      migration,
      /CREATE TABLE/i,
    );

    assert.doesNotMatch(
      migration,
      /CREATE INDEX/i,
    );

    assert.doesNotMatch(
      migration,
      /CREATE TRIGGER/i,
    );
  },
);

test(
  'classification context is service-role only',
  () => {
    assert.match(
      migration,
      /REVOKE ALL[\s\S]*FROM PUBLIC,\s*anon,\s*authenticated,\s*service_role/i,
    );

    assert.match(
      migration,
      /GRANT EXECUTE[\s\S]*TO service_role/i,
    );
  },
);

test(
  '0062 reuses canonical route-match assertion',
  () => {
    assert.match(
      migration,
      /private\.assert_trusted_route_match_evidence\s*\(/,
    );
  },
);

test(
  '0062 requires exact source identities and versions',
  () => {
    for (const token of [
      'p_route_match_evidence_id',
      'p_expected_route_match_evidence_version',
      'p_expected_route_evidence_id',
      'p_expected_route_evidence_version',
    ]) {
      assert.match(
        migration,
        new RegExp(token),
      );
    }
  },
);

test(
  '0062 returns trusted geometry but no pricing result',
  () => {
    for (const token of [
      'route_shape',
      'calculated_route_shape_length_meters',
      'requester_origin_position_along_route_meters',
      'requester_destination_position_along_route_meters',
      'requester_origin_closest_route_latitude',
      'requester_destination_closest_route_latitude',
      'route_order',
    ]) {
      assert.match(
        migration,
        new RegExp(token),
      );
    }

    assert.doesNotMatch(
      migration,
      /pricing_corridor_distance_meters\s+(?:bigint|integer|numeric)/i,
    );

    assert.doesNotMatch(
      migration,
      /geographic_events\s+jsonb/i,
    );
  },
);

test(
  '0062 performs no financial or pricing evidence writes',
  () => {
    assert.doesNotMatch(
      migration,
      /\b(?:INSERT|UPDATE|DELETE)\b[\s\S]*pricing_geography_evidence/i,
    );

    assert.doesNotMatch(
      migration,
      /\b(?:INSERT|UPDATE|DELETE)\b[\s\S]*pricing_quotes/i,
    );

    assert.doesNotMatch(
      migration,
      /\b(?:INSERT|UPDATE|DELETE)\b[\s\S]*financial_/i,
    );

    assert.doesNotMatch(
      migration,
      /record_pricing_geography_evidence_for_server\s*\(/i,
    );
  },
);

test(
  '0062 contains no monetary pricing policy',
  () => {
    assert.doesNotMatch(
      migration,
      /(?:450|850|MFEU|seat_price|70\/30|0\.70|0\.30)/i,
    );
  },
);

test(
  'route contracts define pricing classification context',
  () => {
    assert.match(
      contracts,
      /export interface PricingClassificationContext/,
    );

    assert.match(
      contracts,
      /getPricingClassificationContext\s*\(/,
    );
  },
);

test(
  'route runtime allowlists exact classification RPC',
  () => {
    assert.match(
      runtime,
      /get_pricing_classification_context_for_server/,
    );

    assert.match(
      runtime,
      /RPC_PRICING_CLASSIFICATION_CONTEXT/,
    );

    assert.match(
      runtime,
      /getPricingClassificationContext\s*\(/,
    );
  },
);

test(
  'runtime rejects source identity substitution',
  () => {
    assert.match(
      runtime,
      /row\.route_match_evidence_id[\s\S]*routeMatchEvidenceId/,
    );

    assert.match(
      runtime,
      /row\.route_evidence_id[\s\S]*expectedRouteEvidenceId/,
    );
  },
);

test(
  'runtime validates route order against positions',
  () => {
    assert.match(
      runtime,
      /row\.route_order === 'forward'/,
    );

    assert.match(
      runtime,
      /row\.route_order === 'same_position'/,
    );

    assert.match(
      runtime,
      /row\.route_order === 'reverse'/,
    );
  },
);

test(
  'documentation preserves classifier separation',
  () => {
    assert.match(
      docs,
      /does not perform classification/i,
    );

    assert.match(
      docs,
      /versioned authoritative[\s\S]*transport-geography dataset/i,
    );

    assert.match(
      docs,
      /does not[\s\S]*calculate seat price/i,
    );
  },
);

const rollbackSnapshot = `SELECT jsonb_build_object(
  'data',(SELECT jsonb_object_agg(
    n.nspname||'.'||c.relname,
    query_to_xml(
      format(
        'SELECT count(*) AS rows, md5(coalesce(string_agg(to_jsonb(t)::text, '''' ORDER BY to_jsonb(t)::text), '''')) AS hash FROM %I.%I t',
        n.nspname,
        c.relname
      ),
      false,
      true,
      ''
    )::text
  )
  FROM pg_class c
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE c.relkind='r'
    AND n.nspname IN (
      'public',
      'private',
      'auth',
      'supabase_migrations'
    )),
  'schemas',(SELECT jsonb_agg(
    to_jsonb(n) ORDER BY n.oid
  )
  FROM pg_namespace n
  WHERE n.nspname IN (
    'public',
    'private',
    'auth',
    'supabase_migrations'
  )),
  'relations',(SELECT jsonb_agg(
    jsonb_build_object(
      'oid',c.oid,
      'name',c.relname,
      'acl',c.relacl,
      'owner',c.relowner,
      'rls',c.relrowsecurity,
      'force',c.relforcerowsecurity
    )
    ORDER BY c.oid
  )
  FROM pg_class c
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname IN (
    'public',
    'private',
    'auth',
    'supabase_migrations'
  )),
  'functions',(SELECT jsonb_agg(
    jsonb_build_object(
      'oid',p.oid,
      'def',pg_get_functiondef(p.oid),
      'acl',p.proacl,
      'owner',p.proowner
    )
    ORDER BY p.oid
  )
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname IN (
    'public',
    'private',
    'auth',
    'supabase_migrations'
  )
    AND p.prokind='f'),
  'constraints',(SELECT jsonb_agg(
    to_jsonb(c) ORDER BY c.oid
  )
  FROM pg_constraint c
  JOIN pg_namespace n ON n.oid=c.connamespace
  WHERE n.nspname IN (
    'public',
    'private',
    'auth',
    'supabase_migrations'
  )),
  'triggers',(SELECT jsonb_agg(
    to_jsonb(t) ORDER BY t.oid
  )
  FROM pg_trigger t
  JOIN pg_class c ON c.oid=t.tgrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname IN (
    'public',
    'private',
    'auth',
    'supabase_migrations'
  )),
  'indexes',(SELECT jsonb_agg(
    to_jsonb(i) ORDER BY i.indexrelid
  )
  FROM pg_index i
  JOIN pg_class c ON c.oid=i.indrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname IN (
    'public',
    'private',
    'auth',
    'supabase_migrations'
  )),
  'policies',(SELECT jsonb_agg(
    to_jsonb(p) ORDER BY p.oid
  )
  FROM pg_policy p
  JOIN pg_class c ON c.oid=p.polrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname IN (
    'public',
    'private',
    'auth',
    'supabase_migrations'
  ))
) AS state`;

function normalizedFile(relative) {
  return fs.readFileSync(
    path.join(root, relative),
    'utf8',
  ).replace(/\r\n/g, '\n');
}

function pricingClassificationRollbackBatch() {
  const migrationRaw =
    normalizedFile(
      'supabase/migrations/0062_pricing_classification_context.sql',
    );

  const fixtureSource =
    normalizedFile(
      'supabase/tests/0060_trusted_pricing_geography_producer_test.sql',
    );

  assert.match(
    migrationRaw.trim(),
    /^BEGIN;[\s\S]*COMMIT;$/,
  );

  const fixtureEndMarker =
    'SET CONSTRAINTS ALL IMMEDIATE;';

  const fixtureEnd =
    fixtureSource.indexOf(
      fixtureEndMarker,
    );

  assert(
    fixtureEnd >= 0,
    '0060 fixture boundary unavailable',
  );

  let fixturePrefix =
    fixtureSource.slice(
      0,
      fixtureEnd
        + fixtureEndMarker.length,
    );

  fixturePrefix =
    fixturePrefix
      .replace(
        /^BEGIN;\s*SET TRANSACTION ISOLATION LEVEL READ COMMITTED;\s*/i,
        '',
      );

  const migrationBody =
    migrationRaw
      .trim()
      .replace(/^BEGIN;\s*/i, '')
      .replace(/\s*COMMIT;$/i, '');

  const absent = `
SELECT NOT EXISTS (
  SELECT 1
  FROM pg_proc p
  JOIN pg_namespace n
    ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND p.proname=
      'get_pricing_classification_context_for_server'
) AS absent`;

  const behavior = String.raw`

CREATE FUNCTION pg_temp.classification_source_state()
RETURNS jsonb
LANGUAGE sql
AS $source_state$
  SELECT jsonb_object_agg(
    n.nspname||'.'||c.relname,
    query_to_xml(
      format(
        'SELECT count(*) AS rows, md5(coalesce(string_agg(to_jsonb(t)::text, '''' ORDER BY to_jsonb(t)::text), '''')) AS hash FROM %I.%I t',
        n.nspname,
        c.relname
      ),
      false,
      true,
      ''
    )::text
  )
  FROM pg_class c
  JOIN pg_namespace n
    ON n.oid=c.relnamespace
  WHERE c.relkind='r'
    AND n.nspname IN (
      'public',
      'private',
      'auth',
      'supabase_migrations'
    );
$source_state$;

CREATE TEMP TABLE classification_source_before
ON COMMIT DROP
AS
SELECT
  pg_temp.classification_source_state()
    AS state;


DO $tests$
DECLARE
  m private.trusted_route_match_evidence%ROWTYPE;
  other private.trusted_route_match_evidence%ROWTYPE;
  r private.offering_route_evidence%ROWTYPE;
  c record;
  original_source jsonb;
  returned jsonb;
  base text;
  route_change text;
  role_name text;
BEGIN
  SELECT x.*
  INTO STRICT m
  FROM private.trusted_route_match_evidence x
  JOIN fixture f
    ON f.match_id=x.id
  WHERE f.label='1';

  SELECT x.*
  INTO STRICT other
  FROM private.trusted_route_match_evidence x
  JOIN fixture f
    ON f.match_id=x.id
  WHERE f.label='2';

  SELECT *
  INTO STRICT r
  FROM private.offering_route_evidence
  WHERE id=m.route_evidence_id;

  SELECT *
  INTO STRICT c
  FROM public.get_pricing_classification_context_for_server(
    m.id,
    m.version,
    m.route_evidence_id,
    m.route_evidence_version
  );

  returned := to_jsonb(c);

  PERFORM pg_temp.pricing_check(
    'valid exact classification context returned',
    returned IS NOT NULL
  );

  PERFORM pg_temp.pricing_check(
    'exact route-match identity preserved',
    returned->>'route_match_evidence_id'
      = m.id::text
    AND (
      returned->>'route_match_evidence_version'
    )::integer = m.version
  );

  PERFORM pg_temp.pricing_check(
    'exact movement and offering intent bindings preserved',
    returned->>'movement_need_id'
      = m.movement_need_id::text
    AND returned->>'offering_movement_intent_id'
      = m.offering_movement_intent_id::text
    AND (
      returned->>'offering_intent_version'
    )::integer = m.offering_intent_version
  );

  PERFORM pg_temp.pricing_check(
    'exact route evidence identity preserved',
    returned->>'route_evidence_id'
      = m.route_evidence_id::text
    AND (
      returned->>'route_evidence_version'
    )::integer = m.route_evidence_version
  );

  PERFORM pg_temp.pricing_check(
    'trusted route shape preserved exactly',
    returned->>'route_shape_format'
      = 'geojson_linestring_v1'
    AND returned->'route_shape'
      = r.route_shape
  );

  PERFORM pg_temp.pricing_check(
    'route match calculated geometry preserved',
    (
      returned
        ->>'calculated_route_shape_length_meters'
    )::bigint
      = m.calculated_route_shape_length_meters
    AND (
      returned
        ->>'requester_origin_position_along_route_meters'
    )::bigint
      = m.requester_origin_position_along_route_meters
    AND (
      returned
        ->>'requester_destination_position_along_route_meters'
    )::bigint
      = m.requester_destination_position_along_route_meters
    AND returned->>'route_order'
      = m.route_order
  );

  PERFORM pg_temp.pricing_check(
    'closest route points preserved',
    (
      returned
        ->>'requester_origin_closest_route_latitude'
    )::numeric
      = m.requester_origin_closest_route_latitude
    AND (
      returned
        ->>'requester_origin_closest_route_longitude'
    )::numeric
      = m.requester_origin_closest_route_longitude
    AND (
      returned
        ->>'requester_destination_closest_route_latitude'
    )::numeric
      = m.requester_destination_closest_route_latitude
    AND (
      returned
        ->>'requester_destination_closest_route_longitude'
    )::numeric
      = m.requester_destination_closest_route_longitude
  );

  PERFORM pg_temp.pricing_check(
    'provider route distance is not exposed as pricing distance',
    r.route_distance_meters=15000
    AND NOT (
      returned
        ? 'route_distance_meters'
    )
    AND NOT (
      returned
        ? 'pricing_corridor_distance_meters'
    )
    AND NOT (
      returned
        ? 'geographic_events'
    )
  );

  PERFORM pg_temp.pricing_check(
    'route-match expiry preserved',
    (
      returned
        ->>'route_match_evidence_expires_at'
    )::timestamptz
      IS NOT DISTINCT FROM
        m.expires_at
  );

  base := format(
    'SELECT * FROM public.get_pricing_classification_context_for_server(%L,%s,%L,%s)',
    m.id,
    m.version,
    m.route_evidence_id,
    m.route_evidence_version
  );

  PERFORM pg_temp.probe(
    'exact valid context read has no side effect',
    base
  );

  PERFORM pg_temp.probe(
    'wrong route-match version rejected',
    format(
      'SELECT * FROM public.get_pricing_classification_context_for_server(%L,%s,%L,%s)',
      m.id,
      m.version+1,
      m.route_evidence_id,
      m.route_evidence_version
    ),
    '23514'
  );

  PERFORM pg_temp.probe(
    'wrong route evidence id rejected',
    format(
      'SELECT * FROM public.get_pricing_classification_context_for_server(%L,%s,%L,%s)',
      m.id,
      m.version,
      other.route_evidence_id,
      m.route_evidence_version
    ),
    '23514'
  );

  PERFORM pg_temp.probe(
    'wrong route evidence version rejected',
    format(
      'SELECT * FROM public.get_pricing_classification_context_for_server(%L,%s,%L,%s)',
      m.id,
      m.version,
      m.route_evidence_id,
      m.route_evidence_version+1
    ),
    '23514'
  );

  PERFORM pg_temp.probe(
    'missing route-match evidence rejected',
    format(
      'SELECT * FROM public.get_pricing_classification_context_for_server(%L,1,%L,1)',
      '00000000-0000-0000-0000-000000000000',
      m.route_evidence_id
    ),
    '23514'
  );

  PERFORM pg_temp.probe(
    'existing unrelated route cannot substitute exact source',
    format(
      'SELECT * FROM public.get_pricing_classification_context_for_server(%L,%s,%L,%s)',
      m.id,
      m.version,
      other.route_evidence_id,
      other.route_evidence_version
    ),
    '23514'
  );

  PERFORM pg_temp.probe(
    'closed need invalidates classification context',
    format(
      'UPDATE public.movement_needs SET status=''closed'' WHERE id=%L; %s',
      m.movement_need_id,
      base
    ),
    '23514'
  );

  route_change := format(
    'DO $r$ DECLARE r private.offering_route_evidence%%ROWTYPE; BEGIN
       SELECT * INTO STRICT r
       FROM private.offering_route_evidence
       WHERE id=%L;
       PERFORM public.record_offering_route_evidence_for_server(
         r.offering_movement_intent_id,
         r.provider_namespace,
         r.provider_product,
         r.provider_version,
         ''0062-replacement'',
         r.route_shape,
         r.route_distance_meters,
         r.route_duration_seconds,
         clock_timestamp(),
         r.expires_at
       );
     END $r$;',
    m.route_evidence_id
  );

  PERFORM pg_temp.probe(
    'legitimate route replacement fixture succeeds',
    route_change
  );

  PERFORM pg_temp.probe(
    'route replacement invalidates old exact classification context',
    route_change || base,
    '23514'
  );

  PERFORM pg_temp.probe(
    'superseded match rejected after legitimate route and match replacement',
    route_change
      || format(
        'DO $m$ DECLARE r private.offering_route_evidence%%ROWTYPE; BEGIN
           SELECT * INTO STRICT r
           FROM private.offering_route_evidence
           WHERE offering_movement_intent_id=%L
             AND status=''current'';
           PERFORM public.record_trusted_route_match_evidence_for_server(
             %L,
             %L,
             r.id,
             r.version,
             10,
             20,
             10000,
             100,
             9000,
             6.43,
             3.52,
             6.60,
             3.35,
             clock_timestamp(),
             NULL
           );
         END $m$;',
        m.offering_movement_intent_id,
        m.movement_need_id,
        m.offering_movement_intent_id
      )
      || base,
    '23514'
  );

  FOREACH role_name
  IN ARRAY ARRAY[
    'anon',
    'authenticated',
    'service_role'
  ]
  LOOP
    PERFORM pg_temp.probe(
      role_name || ' RPC access',
      format(
        'SET LOCAL ROLE %I; SELECT * FROM public.get_pricing_classification_context_for_server(%L,%s,%L,%s)',
        role_name,
        other.id,
        other.version,
        other.route_evidence_id,
        other.route_evidence_version
      ),
      CASE
        WHEN role_name='service_role'
          THEN '00000'
        ELSE '42501'
      END
    );
  END LOOP;

  PERFORM pg_temp.pricing_check(
    'RPC is security definer with empty search path',
    (
      SELECT
        count(*)=1
        AND bool_and(
          p.prosecdef
          AND p.proconfig
            = ARRAY['search_path=""']
        )
      FROM pg_proc p
      JOIN pg_namespace n
        ON n.oid=p.pronamespace
      WHERE n.nspname='public'
        AND p.proname=
          'get_pricing_classification_context_for_server'
    )
  );

  PERFORM pg_temp.pricing_check(
    'only service role has RPC execution',
    NOT has_function_privilege(
      'anon',
      'public.get_pricing_classification_context_for_server(uuid,integer,uuid,integer)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'authenticated',
      'public.get_pricing_classification_context_for_server(uuid,integer,uuid,integer)',
      'EXECUTE'
    )
    AND has_function_privilege(
      'service_role',
      'public.get_pricing_classification_context_for_server(uuid,integer,uuid,integer)',
      'EXECUTE'
    )
  );

  PERFORM pg_temp.pricing_check(
    'classification context writes no application auth financial pricing or operational rows',
    (
      SELECT state
        = pg_temp.classification_source_state()
      FROM classification_source_before
    )
  );
END;
$tests$;


SELECT
  test_number,
  test_name,
  CASE
    WHEN passed THEN 'PASS'
    ELSE 'FAIL'
  END AS result,
  diagnostic
FROM pg_temp.pricing_results
ORDER BY test_number;


SELECT
  count(*) AS total,
  count(*) FILTER (WHERE passed) AS passed,
  count(*) FILTER (WHERE NOT passed) AS failed
FROM pg_temp.pricing_results;


DO $assertions$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_temp.pricing_results
    WHERE NOT passed
  ) THEN
    RAISE EXCEPTION
      '0062 behavioral assertions failed';
  END IF;
END;
$assertions$;

ROLLBACK;
`;

  const batch = [
    '\\set ON_ERROR_STOP on',

    absent,
    '\\gset',

    '\\if :absent',
    '\\else',
    '\\quit 1',
    '\\endif',

    `
SELECT
  (
    SELECT max(version)='0061'
    FROM supabase_migrations.schema_migrations
  )
  AND to_regclass(
    'private.pricing_quotes'
  ) IS NOT NULL
  AND to_regclass(
    'private.pricing_geography_evidence'
  ) IS NOT NULL
  AS baseline`,
    '\\gset',

    '\\if :baseline',
    '\\else',
    '\\quit 1',
    '\\endif',

    rollbackSnapshot,
    '\\gset before_',

    'BEGIN;',
    'SET TRANSACTION ISOLATION LEVEL READ COMMITTED;',

    migrationBody,

    fixturePrefix,

    behavior,

    rollbackSnapshot,
    '\\gset after_',

    absent,
    '\\gset',

    `
SELECT
  :'before_state'::jsonb
    = :'after_state'::jsonb
  AS restored`,
    '\\gset',

    '\\if :restored',
    "SELECT 'PASS 0062 rollback: prior data definitions ACL RLS and migration history unchanged' AS result;",
    '\\else',
    '\\quit 1',
    '\\endif',

    '\\if :absent',
    "SELECT 'PASS 0062 classification RPC absent after ROLLBACK' AS result;",
    '\\else',
    '\\quit 1',
    '\\endif',

    '',
  ].join('\n');

  const executable =
    batch.replace(/--[^\n]*/g, '');

  assert.equal(
    (executable.match(/^BEGIN;/gm) || []).length,
    1,
  );

  assert.equal(
    (executable.match(/^ROLLBACK;/gm) || []).length,
    1,
  );

  assert.doesNotMatch(
    executable,
    /\bCOMMIT\s*;/i,
  );

  return batch;
}


test(
  'rollback runner validates installed 0061 baseline and full restoration',
  () => {
    const batch =
      pricingClassificationRollbackBatch();

    assert.match(
      batch,
      /max\(version\)='0061'/,
    );

    assert.match(
      batch,
      /pricing_quotes/,
    );

    assert.match(
      batch,
      /pricing_geography_evidence/,
    );

    assert.match(
      batch,
      /gset before_/,
    );

    assert.match(
      batch,
      /gset after_/,
    );

    assert.doesNotMatch(
      batch,
      /DISABLE TRIGGER|session_replication_role|INSERT INTO supabase_migrations/i,
    );
  },
);


if (
  process.argv.includes(
    '--print-rollback',
  )
) {
  process.stdout.write(
    pricingClassificationRollbackBatch(),
  );

  process.exit(0);
}
