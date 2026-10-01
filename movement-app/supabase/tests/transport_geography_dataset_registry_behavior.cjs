const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const migrationPath = path.join(
  __dirname,
  '../migrations/0063_transport_geography_dataset_registry.sql'
);

let raw = fs
  .readFileSync(migrationPath, 'utf8')
  .replace(/^\uFEFF/, '')
  .replace(/\r\n/g, '\n')
  .trim();

assert.match(raw, /^BEGIN;[\s\S]*COMMIT;$/);

const migrationBody = raw
  .replace(/^BEGIN;\s*/, '')
  .replace(/\s*COMMIT;$/, '');

const snapshot = `
SELECT jsonb_build_object(
  'data',
  (
    SELECT jsonb_object_agg(
      n.nspname || '.' || c.relname,
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
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r'
      AND n.nspname IN ('public','private','auth','supabase_migrations')
  ),
  'relations',
  (
    SELECT jsonb_agg(
      jsonb_build_object(
        'oid', c.oid,
        'name', n.nspname || '.' || c.relname,
        'acl', c.relacl,
        'owner', c.relowner,
        'rls', c.relrowsecurity,
        'force_rls', c.relforcerowsecurity
      )
      ORDER BY c.oid
    )
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public','private','auth','supabase_migrations')
  ),
  'functions',
  (
    SELECT jsonb_agg(
      jsonb_build_object(
        'oid', p.oid,
        'def', pg_get_functiondef(p.oid),
        'acl', p.proacl,
        'owner', p.proowner
      )
      ORDER BY p.oid
    )
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public','private','auth','supabase_migrations')
      AND p.prokind = 'f'
  ),
  'constraints',
  (
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.oid)
    FROM pg_constraint x
    JOIN pg_namespace n ON n.oid = x.connamespace
    WHERE n.nspname IN ('public','private','auth','supabase_migrations')
  ),
  'triggers',
  (
    SELECT jsonb_agg(to_jsonb(t) ORDER BY t.oid)
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public','private','auth','supabase_migrations')
  ),
  'indexes',
  (
    SELECT jsonb_agg(to_jsonb(i) ORDER BY i.indexrelid)
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public','private','auth','supabase_migrations')
  ),
  'policies',
  (
    SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid)
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public','private','auth','supabase_migrations')
  )
) AS state
`;

const absence = `
SELECT
  to_regclass('private.transport_geography_datasets') IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private'
      AND p.proname IN (
        'assert_transport_geography_bbox',
        'assert_transport_geography_dataset',
        'protect_transport_geography_dataset'
      )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname IN (
      'protect_transport_geography_dataset',
      'prevent_transport_geography_dataset_removal'
    )
  ) AS absent
`;

const behavioral = String.raw`
CREATE TEMP TABLE test_results (
  test_number integer GENERATED ALWAYS AS IDENTITY,
  test_name text NOT NULL,
  result text NOT NULL,
  diagnostic text
) ON COMMIT DROP;

CREATE FUNCTION pg_temp.check_result(
  p_name text,
  p_ok boolean,
  p_diagnostic text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO test_results(test_name,result,diagnostic)
  VALUES (
    p_name,
    CASE WHEN p_ok THEN 'PASS' ELSE 'FAIL' END,
    p_diagnostic
  );
END;
$$;

CREATE FUNCTION pg_temp.expect_state(
  p_name text,
  p_statement text,
  p_expected_state text
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_state text := '00000';
  v_message text := '';
BEGIN
  BEGIN
    EXECUTE p_statement;
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS
        v_state = RETURNED_SQLSTATE,
        v_message = MESSAGE_TEXT;
  END;

  PERFORM pg_temp.check_result(
    p_name,
    v_state = p_expected_state,
    format(
      'expected %s, actual %s %s',
      p_expected_state,
      v_state,
      v_message
    )
  );
END;
$$;

CREATE FUNCTION pg_temp.expect_role_state(
  p_name text,
  p_role text,
  p_statement text,
  p_expected_state text
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_state text := '00000';
  v_message text := '';
BEGIN
  BEGIN
    EXECUTE format('SET LOCAL ROLE %I', p_role);
    EXECUTE p_statement;
    RESET ROLE;
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS
        v_state = RETURNED_SQLSTATE,
        v_message = MESSAGE_TEXT;
      RESET ROLE;
  END;

  PERFORM pg_temp.check_result(
    p_name,
    v_state = p_expected_state,
    format(
      'expected %s, actual %s %s',
      p_expected_state,
      v_state,
      v_message
    )
  );
END;
$$;

CREATE FUNCTION pg_temp.add_dataset(
  p_version text,
  p_hash text,
  p_status text DEFAULT 'approved',
  p_crs text DEFAULT 'EPSG:4326',
  p_bbox jsonb DEFAULT '{"xmin":3.44,"ymin":6.40,"xmax":3.54,"ymax":6.50}'::jsonb,
  p_bytes bigint DEFAULT 1281400,
  p_features bigint DEFAULT 7247
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO private.transport_geography_datasets (
    transport_geography_version,
    dataset_family,
    dataset_release,
    schema_version,
    theme,
    feature_type,
    extract_format,
    source_license,
    source_attribution,
    source_locator,
    coverage_crs,
    coverage_bbox,
    content_sha256,
    byte_length,
    feature_count,
    status
  )
  VALUES (
    p_version,
    'overture',
    '2026-09-23.1',
    '2.0.0',
    'transportation',
    'segment',
    'geoparquet',
    'ODbL-1.0',
    'Overture Maps Foundation transportation data',
    's3://overturemaps-us-west-2/release/2026-09-23.1/theme=transportation/type=segment',
    p_crs,
    p_bbox,
    p_hash,
    p_bytes,
    p_features,
    p_status
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;


SELECT pg_temp.check_result(
  'registry table exists',
  to_regclass('private.transport_geography_datasets') IS NOT NULL
);

SELECT pg_temp.check_result(
  'private RLS enabled',
  (
    SELECT c.relrowsecurity
    FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='private'
      AND c.relname='transport_geography_datasets'
  )
);

SELECT pg_temp.check_result(
  'registry has no RLS policies',
  NOT EXISTS (
    SELECT 1
    FROM pg_policy p
    JOIN pg_class c ON c.oid=p.polrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='private'
      AND c.relname='transport_geography_datasets'
  )
);

SELECT pg_temp.check_result(
  'exact three private helpers exist',
  (
    SELECT count(*)=3
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='private'
      AND p.proname IN (
        'assert_transport_geography_bbox',
        'assert_transport_geography_dataset',
        'protect_transport_geography_dataset'
      )
  )
);

SELECT pg_temp.check_result(
  'all helpers SECURITY DEFINER with empty search path',
  (
    SELECT count(*)=3
       AND bool_and(p.prosecdef)
       AND bool_and(p.proconfig = ARRAY['search_path=""'])
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='private'
      AND p.proname IN (
        'assert_transport_geography_bbox',
        'assert_transport_geography_dataset',
        'protect_transport_geography_dataset'
      )
  )
);

SELECT pg_temp.check_result(
  'no public 0063 function',
  NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND p.proname LIKE '%transport_geography%'
  )
);


SELECT pg_temp.add_dataset(
  'overture.transportation.2026-09-23.1.test-a',
  repeat('a',64)
) AS first_dataset_id
\gset

SELECT pg_temp.check_result(
  'valid approved dataset inserted',
  EXISTS (
    SELECT 1
    FROM private.transport_geography_datasets
    WHERE id=:'first_dataset_id'::uuid
      AND status='approved'
  )
);

SELECT pg_temp.check_result(
  'valid dataset preserves explicit WGS84 CRS',
  (
    SELECT coverage_crs='EPSG:4326'
    FROM private.transport_geography_datasets
    WHERE id=:'first_dataset_id'::uuid
  )
);

SELECT pg_temp.check_result(
  'valid dataset preserves exact bbox',
  (
    SELECT coverage_bbox =
      '{"xmin":3.44,"ymin":6.40,"xmax":3.54,"ymax":6.50}'::jsonb
    FROM private.transport_geography_datasets
    WHERE id=:'first_dataset_id'::uuid
  )
);

SELECT pg_temp.check_result(
  'valid dataset preserves exact byte and feature counts',
  (
    SELECT byte_length=1281400
       AND feature_count=7247
    FROM private.transport_geography_datasets
    WHERE id=:'first_dataset_id'::uuid
  )
);

SELECT pg_temp.check_result(
  'valid dataset preserves SHA-256 fingerprint',
  (
    SELECT content_sha256=repeat('a',64)
    FROM private.transport_geography_datasets
    WHERE id=:'first_dataset_id'::uuid
  )
);

SELECT private.assert_transport_geography_dataset(
  'overture.transportation.2026-09-23.1.test-a'
);

SELECT pg_temp.check_result(
  'approved dataset passes live assertion',
  true
);

SELECT pg_temp.expect_state(
  'missing dataset fails closed',
  $$SELECT private.assert_transport_geography_dataset('missing.dataset.version')$$,
  '23514'
);

SELECT pg_temp.expect_state(
  'null dataset version rejected',
  $$SELECT private.assert_transport_geography_dataset(NULL)$$,
  '22004'
);


SELECT pg_temp.expect_state(
  'bbox array rejected',
  $$SELECT private.assert_transport_geography_bbox('[]'::jsonb)$$,
  '23514'
);

SELECT pg_temp.expect_state(
  'bbox missing field rejected',
  $$SELECT private.assert_transport_geography_bbox(
    '{"xmin":3.4,"ymin":6.4,"xmax":3.5}'::jsonb
  )$$,
  '23514'
);

SELECT pg_temp.expect_state(
  'bbox extra field rejected',
  $$SELECT private.assert_transport_geography_bbox(
    '{"xmin":3.4,"ymin":6.4,"xmax":3.5,"ymax":6.5,"extra":1}'::jsonb
  )$$,
  '23514'
);

SELECT pg_temp.expect_state(
  'bbox nonnumeric coordinate rejected',
  $$SELECT private.assert_transport_geography_bbox(
    '{"xmin":"west","ymin":6.4,"xmax":3.5,"ymax":6.5}'::jsonb
  )$$,
  '23514'
);

SELECT pg_temp.expect_state(
  'bbox numeric string coordinate rejected',
  $$SELECT private.assert_transport_geography_bbox(
    '{"xmin":"3.4","ymin":6.4,"xmax":3.5,"ymax":6.5}'::jsonb
  )$$,
  '23514'
);

SELECT pg_temp.expect_state(
  'bbox longitude below -180 rejected',
  $$SELECT private.assert_transport_geography_bbox(
    '{"xmin":-181,"ymin":6.4,"xmax":3.5,"ymax":6.5}'::jsonb
  )$$,
  '23514'
);

SELECT pg_temp.expect_state(
  'bbox longitude above 180 rejected',
  $$SELECT private.assert_transport_geography_bbox(
    '{"xmin":3.4,"ymin":6.4,"xmax":181,"ymax":6.5}'::jsonb
  )$$,
  '23514'
);

SELECT pg_temp.expect_state(
  'bbox latitude below -90 rejected',
  $$SELECT private.assert_transport_geography_bbox(
    '{"xmin":3.4,"ymin":-91,"xmax":3.5,"ymax":6.5}'::jsonb
  )$$,
  '23514'
);

SELECT pg_temp.expect_state(
  'bbox latitude above 90 rejected',
  $$SELECT private.assert_transport_geography_bbox(
    '{"xmin":3.4,"ymin":6.4,"xmax":3.5,"ymax":91}'::jsonb
  )$$,
  '23514'
);

SELECT pg_temp.expect_state(
  'bbox reversed longitude rejected',
  $$SELECT private.assert_transport_geography_bbox(
    '{"xmin":3.6,"ymin":6.4,"xmax":3.5,"ymax":6.5}'::jsonb
  )$$,
  '23514'
);

SELECT pg_temp.expect_state(
  'bbox reversed latitude rejected',
  $$SELECT private.assert_transport_geography_bbox(
    '{"xmin":3.4,"ymin":6.6,"xmax":3.5,"ymax":6.5}'::jsonb
  )$$,
  '23514'
);


SELECT pg_temp.expect_state(
  'wrong CRS rejected',
  $$SELECT pg_temp.add_dataset(
    'bad.crs',
    repeat('b',64),
    'approved',
    'EPSG:3857'
  )$$,
  '23514'
);

SELECT pg_temp.expect_state(
  'invalid SHA-256 rejected',
  $$SELECT pg_temp.add_dataset(
    'bad.hash',
    'abcdef'
  )$$,
  '23514'
);

SELECT pg_temp.expect_state(
  'zero byte length rejected',
  $$SELECT pg_temp.add_dataset(
    'bad.bytes',
    repeat('c',64),
    'approved',
    'EPSG:4326',
    '{"xmin":3.44,"ymin":6.40,"xmax":3.54,"ymax":6.50}'::jsonb,
    0,
    7247
  )$$,
  '23514'
);

SELECT pg_temp.expect_state(
  'zero feature count rejected',
  $$SELECT pg_temp.add_dataset(
    'bad.features',
    repeat('d',64),
    'approved',
    'EPSG:4326',
    '{"xmin":3.44,"ymin":6.40,"xmax":3.54,"ymax":6.50}'::jsonb,
    1281400,
    0
  )$$,
  '23514'
);

SELECT pg_temp.expect_state(
  'dataset cannot start superseded',
  $$SELECT pg_temp.add_dataset(
    'bad.initial.status',
    repeat('e',64),
    'superseded'
  )$$,
  '23514'
);

SELECT pg_temp.expect_state(
  'dataset cannot start retired',
  $$SELECT pg_temp.add_dataset(
    'bad.initial.retired',
    repeat('f',64),
    'retired'
  )$$,
  '23514'
);


SELECT pg_temp.expect_state(
  'approved dataset facts cannot mutate',
  format(
    'UPDATE private.transport_geography_datasets SET dataset_release=''changed'' WHERE id=%L::uuid',
    :'first_dataset_id'
  ),
  '23514'
);

SELECT pg_temp.expect_state(
  'approved status no-op rejected',
  format(
    'UPDATE private.transport_geography_datasets SET status=''approved'' WHERE id=%L::uuid',
    :'first_dataset_id'
  ),
  '23514'
);

UPDATE private.transport_geography_datasets
SET status='superseded'
WHERE id=:'first_dataset_id'::uuid;

SELECT pg_temp.check_result(
  'approved dataset can transition to superseded',
  (
    SELECT status='superseded'
    FROM private.transport_geography_datasets
    WHERE id=:'first_dataset_id'::uuid
  )
);

SELECT pg_temp.expect_state(
  'superseded dataset rejected for new classification',
  $$SELECT private.assert_transport_geography_dataset(
    'overture.transportation.2026-09-23.1.test-a'
  )$$,
  '23514'
);

SELECT pg_temp.expect_state(
  'superseded dataset cannot reopen',
  format(
    'UPDATE private.transport_geography_datasets SET status=''approved'' WHERE id=%L::uuid',
    :'first_dataset_id'
  ),
  '23514'
);

SELECT pg_temp.expect_state(
  'superseded dataset facts remain immutable',
  format(
    'UPDATE private.transport_geography_datasets SET byte_length=999 WHERE id=%L::uuid',
    :'first_dataset_id'
  ),
  '23514'
);


SELECT pg_temp.add_dataset(
  'overture.transportation.2026-09-23.1.test-b',
  repeat('1',64)
) AS second_dataset_id
\gset

UPDATE private.transport_geography_datasets
SET status='retired'
WHERE id=:'second_dataset_id'::uuid;

SELECT pg_temp.check_result(
  'approved dataset can transition to retired',
  (
    SELECT status='retired'
    FROM private.transport_geography_datasets
    WHERE id=:'second_dataset_id'::uuid
  )
);

SELECT pg_temp.expect_state(
  'retired dataset rejected for new classification',
  $$SELECT private.assert_transport_geography_dataset(
    'overture.transportation.2026-09-23.1.test-b'
  )$$,
  '23514'
);

SELECT pg_temp.expect_state(
  'retired dataset cannot reopen',
  format(
    'UPDATE private.transport_geography_datasets SET status=''approved'' WHERE id=%L::uuid',
    :'second_dataset_id'
  ),
  '23514'
);

SELECT pg_temp.check_result(
  'terminal dataset history remains stored',
  (
    SELECT count(*)=2
    FROM private.transport_geography_datasets
    WHERE id IN (
      :'first_dataset_id'::uuid,
      :'second_dataset_id'::uuid
    )
  )
);

SELECT pg_temp.expect_state(
  'dataset history cannot be deleted',
  format(
    'DELETE FROM private.transport_geography_datasets WHERE id=%L::uuid',
    :'first_dataset_id'
  ),
  '23514'
);

SELECT pg_temp.expect_state(
  'DELETE WHERE false still rejected by statement guard',
  $$DELETE FROM private.transport_geography_datasets
    WHERE false$$,
  '23514'
);

SELECT pg_temp.expect_state(
  'dataset history cannot be truncated',
  $$TRUNCATE private.transport_geography_datasets$$,
  '23514'
);


SELECT pg_temp.check_result(
  'service_role has registry SELECT privilege',
  has_table_privilege(
    'service_role',
    'private.transport_geography_datasets',
    'SELECT'
  )
);

SELECT pg_temp.check_result(
  'service_role has no registry INSERT privilege',
  NOT has_table_privilege(
    'service_role',
    'private.transport_geography_datasets',
    'INSERT'
  )
);

SELECT pg_temp.check_result(
  'service_role has no registry UPDATE privilege',
  NOT has_table_privilege(
    'service_role',
    'private.transport_geography_datasets',
    'UPDATE'
  )
);

SELECT pg_temp.check_result(
  'service_role has no registry DELETE privilege',
  NOT has_table_privilege(
    'service_role',
    'private.transport_geography_datasets',
    'DELETE'
  )
);

SELECT pg_temp.check_result(
  'anon has no registry SELECT privilege',
  NOT has_table_privilege(
    'anon',
    'private.transport_geography_datasets',
    'SELECT'
  )
);

SELECT pg_temp.check_result(
  'authenticated has no registry SELECT privilege',
  NOT has_table_privilege(
    'authenticated',
    'private.transport_geography_datasets',
    'SELECT'
  )
);

SELECT pg_temp.expect_role_state(
  'service_role actual registry read succeeds',
  'service_role',
  $$SELECT count(*) FROM private.transport_geography_datasets$$,
  '00000'
);

SELECT pg_temp.expect_role_state(
  'service_role direct registry INSERT denied',
  'service_role',
  $$INSERT INTO private.transport_geography_datasets(
    transport_geography_version,
    dataset_family,
    dataset_release,
    schema_version,
    theme,
    feature_type,
    extract_format,
    source_license,
    source_attribution,
    source_locator,
    coverage_crs,
    coverage_bbox,
    content_sha256,
    byte_length,
    feature_count,
    status
  )
  VALUES(
    'forbidden.service.write',
    'overture',
    '2026-09-23.1',
    '2.0.0',
    'transportation',
    'segment',
    'geoparquet',
    'ODbL-1.0',
    'attribution',
    'locator',
    'EPSG:4326',
    '{"xmin":3.4,"ymin":6.4,"xmax":3.5,"ymax":6.5}'::jsonb,
    repeat('2',64),
    1,
    1,
    'approved'
  )$$,
  '42501'
);

SELECT pg_temp.expect_role_state(
  'anon actual registry read denied',
  'anon',
  $$SELECT count(*) FROM private.transport_geography_datasets$$,
  '42501'
);

SELECT pg_temp.expect_role_state(
  'authenticated actual registry read denied',
  'authenticated',
  $$SELECT count(*) FROM private.transport_geography_datasets$$,
  '42501'
);

SELECT pg_temp.check_result(
  'service_role cannot execute approved dataset assertion helper',
  NOT has_function_privilege(
    'service_role',
    'private.assert_transport_geography_dataset(text)',
    'EXECUTE'
  )
);

SELECT pg_temp.check_result(
  'service_role cannot execute bbox helper',
  NOT has_function_privilege(
    'service_role',
    'private.assert_transport_geography_bbox(jsonb)',
    'EXECUTE'
  )
);

SELECT pg_temp.check_result(
  'service_role cannot execute trigger helper',
  NOT has_function_privilege(
    'service_role',
    'private.protect_transport_geography_dataset()',
    'EXECUTE'
  )
);

SELECT pg_temp.expect_role_state(
  'service_role actual helper execution denied',
  'service_role',
  $$SELECT private.assert_transport_geography_dataset(
    'overture.transportation.2026-09-23.1.test-a'
  )$$,
  '42501'
);


SELECT
  test_number,
  test_name,
  result,
  coalesce(diagnostic,'') AS diagnostic
FROM test_results
ORDER BY test_number;

SELECT
  count(*) AS total,
  count(*) FILTER (WHERE result='PASS') AS passed,
  count(*) FILTER (WHERE result='FAIL') AS failed
FROM test_results;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM test_results
    WHERE result <> 'PASS'
  ) THEN
    RAISE EXCEPTION '0063 behavioral assertions failed';
  END IF;
END;
$$;
`;

function rollbackBatch() {
  return [
    '\\set ON_ERROR_STOP on',

    absence,
    '\\gset',
    '\\if :absent',
    '\\else',
    '\\quit 1',
    '\\endif',

    `
SELECT
  (
    SELECT max(version)='0062'
    FROM supabase_migrations.schema_migrations
  )
  AND to_regclass('private.pricing_geography_evidence') IS NOT NULL
  AND to_regclass('private.pricing_quotes') IS NOT NULL
  AS baseline
`,
    '\\gset',
    '\\if :baseline',
    '\\else',
    '\\quit 1',
    '\\endif',

    snapshot,
    '\\gset before_',

    'BEGIN;',
    'SET TRANSACTION ISOLATION LEVEL READ COMMITTED;',
    migrationBody,
    behavioral,
    'ROLLBACK;',

    snapshot,
    '\\gset after_',

    absence,
    '\\gset',

    `
SELECT
  :'before_state'::jsonb = :'after_state'::jsonb
  AS restored
`,
    '\\gset',

    '\\if :restored',
    `SELECT 'PASS 0063 rollback: prior data definitions ACL RLS and migration history unchanged' AS result;`,
    '\\else',
    '\\quit 1',
    '\\endif',

    '\\if :absent',
    `SELECT 'PASS 0063 rollback: registry helpers and triggers absent after rollback' AS result;`,
    '\\else',
    '\\quit 1',
    '\\endif',

    ''
  ].join('\n');
}

if (!process.argv.includes('--print-rollback')) {
  console.error(
    'Run with --print-rollback and pipe the output to the local Supabase PostgreSQL container.'
  );
  process.exit(1);
}

process.stdout.write(rollbackBatch());
