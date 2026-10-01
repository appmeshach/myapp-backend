const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = p =>
  fs.readFileSync(path.join(__dirname, p), 'utf8').replace(/\r\n/g, '\n');

const raw = read('../migrations/0063_transport_geography_dataset_registry.sql');
const sql = raw.replace(/--[^\n]*/g, '');

const helpers = [
  'assert_transport_geography_bbox',
  'assert_transport_geography_dataset',
  'protect_transport_geography_dataset',
];

test('0063 is one transaction and creates only the intended private registry objects', () => {
  assert.equal((sql.match(/^BEGIN;/gm) || []).length, 1);
  assert.equal((sql.match(/^COMMIT;/gm) || []).length, 1);

  assert.deepEqual(
    [...sql.matchAll(/CREATE TABLE ([\w.]+)/g)].map(m => m[1]),
    ['private.transport_geography_datasets']
  );

  assert.deepEqual(
    [...sql.matchAll(/CREATE FUNCTION private\.(\w+)/g)].map(m => m[1]),
    helpers
  );

  assert.deepEqual(
    [...sql.matchAll(/CREATE TRIGGER (\w+)/g)].map(m => m[1]),
    [
      'protect_transport_geography_dataset',
      'prevent_transport_geography_dataset_removal',
    ]
  );

  assert.doesNotMatch(sql, /CREATE FUNCTION public\./);
  assert.doesNotMatch(sql, /CREATE POLICY/);
  assert.doesNotMatch(sql, /CREATE OR REPLACE/);
});

test('registry keeps dataset identity provenance and extract fingerprint separate from classifier policy', () => {
  for (const field of [
    'transport_geography_version',
    'dataset_family',
    'dataset_release',
    'schema_version',
    'theme',
    'feature_type',
    'extract_format',
    'source_license',
    'source_attribution',
    'source_locator',
    'coverage_crs',
    'coverage_bbox',
    'content_sha256',
    'byte_length',
    'feature_count',
    'status',
    'registered_at',
  ]) {
    assert.match(sql, new RegExp('\\b' + field + '\\b'));
  }

  assert.match(sql, /coverage_crs\s+text\s+NOT NULL[\s\S]*EPSG:4326/);
  assert.match(sql, /content_sha256\s+text\s+NOT NULL[\s\S]*\{64\}/);
  assert.match(sql, /extract_format\s+text\s+NOT NULL[\s\S]*geoparquet/);

  assert.doesNotMatch(sql, /classifier_name\s+text/);
  assert.doesNotMatch(sql, /classifier_version\s+text/);
  assert.doesNotMatch(sql, /pricing_policy_version\s+text/);
  assert.doesNotMatch(sql, /seat_price_minor/);
});

test('bbox validator is exact-object fail-closed WGS84 longitude latitude validation', () => {
  const start = sql.indexOf(
    'CREATE FUNCTION private.assert_transport_geography_bbox('
  );
  assert.ok(start >= 0);

  const body = sql.slice(start, sql.indexOf('$$;', start) + 3);

  assert.match(body, /jsonb_typeof\(p_bbox\).*object/s);
  assert.match(body, /jsonb_object_keys\(p_bbox\)/);
  assert.match(body, /ARRAY\['xmax','xmin','ymax','ymin'\]/);
  assert.match(body, /jsonb_typeof\(p_bbox->'xmin'\) IS DISTINCT FROM 'number'/);
  assert.match(body, /jsonb_typeof\(p_bbox->'ymin'\) IS DISTINCT FROM 'number'/);
  assert.match(body, /jsonb_typeof\(p_bbox->'xmax'\) IS DISTINCT FROM 'number'/);
  assert.match(body, /jsonb_typeof\(p_bbox->'ymax'\) IS DISTINCT FROM 'number'/);
  assert.match(body, /v_xmin < -180/);
  assert.match(body, /v_xmax > 180/);
  assert.match(body, /v_ymin < -90/);
  assert.match(body, /v_ymax > 90/);
  assert.match(body, /v_xmin >= v_xmax/);
  assert.match(body, /v_ymin >= v_ymax/);
});

test('approved dataset assertion fails closed and rechecks status after SHARE lock', () => {
  const start = sql.indexOf(
    'CREATE FUNCTION private.assert_transport_geography_dataset('
  );
  assert.ok(start >= 0);

  const body = sql.slice(start, sql.indexOf('$$;', start) + 3);

  assert.match(body, /p_transport_geography_version IS NULL/);
  assert.match(body, /WHERE d\.transport_geography_version = p_transport_geography_version/);
  assert.match(body, /status IS DISTINCT FROM 'approved'/);
  assert.match(body, /FOR SHARE/);

  const statusChecks =
    body.match(/status IS DISTINCT FROM 'approved'/g) || [];

  assert.equal(statusChecks.length, 2);
  assert.match(body, /WHEN no_data_found/);
});

test('dataset facts are immutable and lifecycle is one-way', () => {
  const start = sql.indexOf(
    'CREATE FUNCTION private.protect_transport_geography_dataset()'
  );
  assert.ok(start >= 0);

  const body = sql.slice(start, sql.indexOf('$$;', start) + 3);

  assert.match(body, /TG_OP IN \('DELETE', 'TRUNCATE'\)/);
  assert.match(body, /NEW\.status IS DISTINCT FROM 'approved'/);
  assert.match(
    body,
    /\(to_jsonb\(NEW\) - 'status'\)[\s\S]*IS DISTINCT FROM[\s\S]*\(to_jsonb\(OLD\) - 'status'\)/
  );
  assert.match(body, /NEW\.status NOT IN \('superseded', 'retired'\)/);
  assert.match(body, /NEW\.status IS NOT DISTINCT FROM OLD\.status/);
});

test('registry security is private RLS with service-role read only and no helper execution grants', () => {
  assert.match(
    sql,
    /ALTER TABLE private\.transport_geography_datasets ENABLE ROW LEVEL SECURITY/
  );

  assert.match(
    sql,
    /REVOKE ALL[\s\S]*ON TABLE private\.transport_geography_datasets[\s\S]*FROM PUBLIC, anon, authenticated, service_role/
  );

  assert.match(
    sql,
    /GRANT SELECT[\s\S]*ON TABLE private\.transport_geography_datasets[\s\S]*TO service_role/
  );

  for (const helper of helpers) {
    assert.match(
      sql,
      new RegExp(
        'REVOKE ALL\\s+ON FUNCTION private\\.' +
          helper.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
          '\\([^;]*\\)\\s+FROM PUBLIC, anon, authenticated, service_role'
      )
    );
  }

  assert.doesNotMatch(sql, /GRANT\s+(INSERT|UPDATE|DELETE|TRUNCATE)/i);
});

test('0063 does not cut over 0059 or 0060 and introduces no classifier or pricing behavior', () => {
  assert.doesNotMatch(
    sql,
    /ALTER TABLE private\.pricing_geography_evidence/
  );

  assert.doesNotMatch(
    sql,
    /CREATE OR REPLACE FUNCTION public\.record_pricing_geography_evidence_for_server/
  );

  assert.doesNotMatch(sql, /\bpricing_corridor_distance_meters\b/);
  assert.doesNotMatch(sql, /\bgeographic_events\b/);

  assert.doesNotMatch(sql, /\b450\b|\b850\b/);
  assert.doesNotMatch(sql, /\bMFEU\b/i);
  assert.doesNotMatch(sql, /\b70\s*\/\s*30\b/);
  assert.doesNotMatch(sql, /\bactivation_fee_minor\b/);
  assert.doesNotMatch(sql, /\bfinancial_agreements\b/);
  assert.doesNotMatch(sql, /\bfinancial_proposals\b/);
  assert.doesNotMatch(sql, /\bpricing_quotes\b/);
  assert.doesNotMatch(sql, /\bactivation_payments\b/);
  assert.doesNotMatch(sql, /\bsettlement\b/);
});

test('registry contains no hard-coded Lagos road or locality classifier rules', () => {
  assert.doesNotMatch(
    sql,
    /Lekki|Ikoyi|Victoria Island|VI\b|Ajah|Agungi|Ologolo|Ikeja|Yaba|Oniru|Chevron|Admiralty|Epe/i
  );

  assert.doesNotMatch(
    sql,
    /'(?:motorway|trunk|primary|secondary|tertiary|residential|service)'/i
  );
});

test('source provenance cannot silently contain blank padded values', () => {
  for (const field of [
    'source_license',
    'source_attribution',
    'source_locator',
  ]) {
    assert.match(
      sql,
      new RegExp(
        'length\\(' +
          field +
          '\\)[\\s\\S]*' +
          field +
          ' = btrim\\(' +
          field +
          '\\)'
      )
    );
  }
});

test('registry has exact immutable extraction identity uniqueness', () => {
  assert.match(sql, /transport_geography_version text NOT NULL UNIQUE/);

  assert.match(
    sql,
    /UNIQUE\s*\(\s*dataset_family,\s*dataset_release,\s*theme,\s*feature_type,\s*content_sha256\s*\)/s
  );
});
