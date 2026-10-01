'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const core = require('../scripts/transport-geography/build-extract.cjs');
const { verify } = require('../scripts/transport-geography/verify-extract.cjs');

test('fixture contract pins provenance, licensing, limits and both feature types', () => {
  const c = core.readConfig();
  assert.equal(c.dataset_release, '2026-09-23.1');
  assert.equal(c.schema_version, 'v2.0.0');
  assert.deepEqual(c.feature_types, ['segment', 'connector']);
  assert.equal(c.source_license, 'ODbL');
  for (const name of ['OpenStreetMap', 'Overture', 'TomTom']) assert.ok(c.source_attribution.includes(name));
  for (const change of [{ mode: 'production' }, { max_input_rows: 1000000 },
    { coverage_bbox: { xmin: 2, ymin: 0, xmax: 0, ymax: 2 } }, { schema_version: 'unknown' }]) {
    assert.throws(() => core.validateConfig({ ...c, ...change }), /Configuration/);
  }
});

test('numeric bbox strings fail closed in the extraction config', () => {
  const config = core.readConfig();
  for (const key of Object.keys(config.coverage_bbox)) {
    assert.throws(() => core.validateConfig({ ...config,
      coverage_bbox: { ...config.coverage_bbox, [key]: String(config.coverage_bbox[key]) },
    }), /Configuration/);
  }
});

test('config fingerprint hashes the exact repository config bytes', () => {
  const bytes = fs.readFileSync(path.join(__dirname, '../config/transport-geography-extract.json'));
  assert.equal(core.configFingerprint(), crypto.createHash('sha256').update(bytes).digest('hex'));
});

test('output safety rejects docs, scripts, repository root and prefix lookalikes before reading inputs', () => {
  const root = path.resolve(__dirname, '..');
  for (const destination of ['docs/extract', 'scripts/extract', '.', 'tmp/transport-geography-other/extract',
    'tmp/transport-geography/../../docs/extract']) {
    // No source paths or executable: the output gate must be the first failure.
    assert.throws(() => core.build({ fixture: true, out: path.join(root, destination), duckdb: 'must-not-run' }),
      /Repository output must be under tmp\/transport-geography/);
  }
  if (process.platform === 'win32') {
    assert.throws(() => core.outputPath(path.join(root.toUpperCase(), 'DOCS', 'extract')), /Repository output/);
  }
});

test('output safety permits external temp paths and refuses existing destinations', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'transport-output-'));
  try {
    assert.equal(core.outputPath(path.join(dir, 'new-extract')), path.join(fs.realpathSync(dir), 'new-extract'));
    assert.throws(() => core.outputPath(dir), /refusing to overwrite/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('output safety permits repository tmp/transport-geography children without leaving artifacts', () => {
  const root = path.resolve(__dirname, '..');
  const created = [];
  try {
    for (const dir of [path.join(root, 'tmp'), path.join(root, 'tmp', 'transport-geography')]) {
      if (!fs.existsSync(dir)) { fs.mkdirSync(dir); created.push(dir); }
    }
    const parent = path.join(root, 'tmp', 'transport-geography');
    assert.equal(core.outputPath(path.join(parent, 'test-extract')), path.join(fs.realpathSync(parent), 'test-extract'));
    assert.equal(fs.existsSync(path.join(parent, 'test-extract')), false);
  } finally {
    // Remove only empty directories created by this test, never existing content.
    for (const dir of created.reverse()) fs.rmdirSync(dir);
  }
});

test('output safety rejects an external symlink or junction resolving into repository docs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'transport-output-link-'));
  try {
    const link = path.join(dir, 'alias');
    fs.symlinkSync(path.resolve(__dirname, '../docs'), link, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => core.outputPath(path.join(link, 'extract')), /Repository output/);
    fs.unlinkSync(link);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('operator arguments fail closed and require explicit fixture mode', () => {
  assert.throws(() => core.build({}), /--fixture/);
  for (const argv of [['--production'], ['--out'], ['--fixture', '--fixture'], ['--out', 'a', '--out', 'b']]) {
    assert.throws(() => core.argumentsFor(argv), /argument/i);
  }
  assert.deepEqual(core.argumentsFor(['--fixture', '--out', 'a']), { fixture: true, out: 'a' });
});

test('remote paths, UNC paths, globs and SQL reader expressions are rejected', () => {
  for (const value of ['s3://bucket/a', 'https://example.org/a', 'azure://a', '//host/a',
    '\\\\host\\a', '*.parquet', '[a,b]', 'file:thing', 'a\n.parquet', undefined]) {
    assert.throws(() => core.localPath(value), /local path/);
  }
  assert.equal(core.literal("one'two"), "'one''two'");
});

test('empty and oversized fixtures are rejected before DuckDB execution', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'transport-size-'));
  try {
    const file = path.join(dir, 'fixture.parquet');
    fs.writeFileSync(file, '');
    assert.throws(() => core.localFile(file), /empty/);
    fs.writeFileSync(file, Buffer.alloc(1048577));
    assert.throws(() => core.localFile(file), /size limit/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// Explicit opt-in keeps the existing JS regression suite portable. The dedicated
// integration script sets this switch and fails (never skips) if DuckDB is absent.
test('local DuckDB fixture extraction and independent verification', {
  skip: process.env.TRANSPORT_GEOGRAPHY_INTEGRATION !== '1' ? 'Run npm run test:transport-geography:integration with DUCKDB_BIN set' : false,
}, async t => {
  const db = core.duckdb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "transport-fixture-'"));
  const segments = path.join(dir, 'input-segments.parquet');
  const connectors = path.join(dir, 'input-connectors.parquet');
  const out = path.join(dir, 'extract');
  const options = { fixture: true, segments, connectors, out };
  const verification = { dir: out, segments, connectors };
  const reportFile = path.join(out, 'fixture-report.json');
  let report;
  function rewriteReport(change) {
    const next = structuredClone(report);
    change(next);
    fs.writeFileSync(reportFile, JSON.stringify(next));
  }
  try {
    // Synthetic coordinates only. s-cross extends outside the bbox; s-touch
    // touches its edge. s-bbox-only has a tight overlapping bbox but its L-shaped
    // line runs entirely outside the rectangle. It, rail and distant roads are excluded.
    db.query(`
CREATE TABLE segments AS
SELECT id, subtype, ST_GeomFromText(wkt) AS geometry,
  {'xmin': xmin, 'ymin': ymin, 'xmax': xmax, 'ymax': ymax} AS bbox,
  [{'connector_id': c1, 'at': 0.0}, {'connector_id': c2, 'at': 1.0}] AS connectors,
  [{'dataset': 'synthetic-fixture', 'record_id': id}] AS sources,
  {'primary': 'synthetic name'} AS names
FROM (VALUES
 ('s-cross', 'road', 'LINESTRING (-1 1, 3 1)', -1.0, 1.0, 3.0, 1.0, 'c-left', 'c-right'),
 ('s-touch', 'road', 'LINESTRING (2 0, 3 0)', 2.0, 0.0, 3.0, 0.0, 'c-edge', 'c-far'),
 ('s-bbox-only', 'road', 'LINESTRING (-1 1, -1 3, 1 3)', -1.0, 1.0, 1.0, 3.0, 'c-miss-start', 'c-miss-end'),
 ('s-rail', 'rail', 'LINESTRING (0 0, 1 1)', 0.0, 0.0, 1.0, 1.0, 'c-unused', 'c-left'),
 ('s-away', 'road', 'LINESTRING (10 10, 11 11)', 10.0, 10.0, 11.0, 11.0, 'c-unused', 'c-right')
) AS v(id, subtype, wkt, xmin, ymin, xmax, ymax, c1, c2);
CREATE TABLE connectors AS
SELECT id, ST_Point(x,y) AS geometry, {'xmin': x, 'ymin': y, 'xmax': x, 'ymax': y} AS bbox,
  [{'dataset': 'synthetic-fixture', 'record_id': id}] AS sources
FROM (VALUES ('c-left', -1.0, 1.0), ('c-right', 3.0, 1.0), ('c-edge', 2.0, 0.0),
 ('c-far', 3.0, 0.0), ('c-unused', 10.0, 10.0), ('c-miss-start', -1.0, 1.0), ('c-miss-end', 1.0, 3.0)) AS v(id,x,y);
COPY segments TO ${core.literal(segments)} (FORMAT PARQUET);
COPY connectors TO ${core.literal(connectors)} (FORMAT PARQUET);`);

    await t.test('exact intersection excludes bbox-only overlap while whole roads, edge touching and connector closure survive', () => {
      const adversarial = db.query(`SELECT bbox.xmin <= 2 AND bbox.xmax >= 0 AND bbox.ymin <= 2 AND bbox.ymax >= 0 AS bbox_overlap,
ST_Intersects(geometry, ST_MakeEnvelope(0,0,2,2)) AS geometry_intersects
FROM read_parquet(${core.literal(segments)}) WHERE id='s-bbox-only';`);
      assert.deepEqual(adversarial, [{ bbox_overlap: true, geometry_intersects: false }]);
      report = core.build(options);
      assert.deepEqual(report.runtime, { node: process.version, platform: process.platform, arch: process.arch });
      assert.equal(report.config_sha256, core.configFingerprint());
      assert.equal(report.artifacts.segment.feature_count, 2);
      assert.equal(report.artifacts.connector.feature_count, 4);
      assert.deepEqual(verify(verification), { verified: true, production: false, counts: { segment: 2, connector: 4 } });
      const rows = db.query(`SELECT id, ST_AsText(geometry) AS wkt, names.primary AS name FROM read_parquet(${core.literal(path.join(out, 'segments.parquet'))});`);
      assert.deepEqual(rows.map(r => r.id), ['s-cross', 's-touch']);
      assert.equal(rows[0].wkt, 'LINESTRING (-1 1, 3 1)');
      assert.equal(rows[0].name, 'synthetic name');
      const connectorRows = db.query(`SELECT id FROM read_parquet(${core.literal(path.join(out, 'connectors.parquet'))}) ORDER BY id;`);
      assert.deepEqual(connectorRows.map(r => r.id), ['c-edge', 'c-far', 'c-left', 'c-right']);
    });
    assert.ok(report, 'A successful fixture build is required for subsequent verification tests');
    await t.test('repeated builds produce identical bytes and reports', () => {
      const second = path.join(dir, 'second');
      assert.deepEqual(core.build({ ...options, out: second }), report);
      for (const file of core.FILES) assert.deepEqual(fs.readFileSync(path.join(out, file)), fs.readFileSync(path.join(second, file)));
      assert.throws(() => core.build(options), /refusing to overwrite/);
    });
    await t.test('report provenance, runtime, config SHA-256, path, feature count, byte length and hash tampering fail', () => {
      for (const [change, expected] of [
        [r => { r.production = true; }, /Invalid fixture report/],
        [r => { r.config.dataset_release = 'wrong'; }, /Invalid fixture report/],
        [r => { r.config_sha256 = '0'.repeat(64); }, /Config SHA-256 mismatch/],
        ...['node', 'platform', 'arch'].map(key => [r => { r.runtime[key] = 'wrong'; }, /Runtime provenance mismatch/]),
        [r => { r.artifacts.segment.file = '../input-segments.parquet'; }, /Invalid artifact path/],
        [r => { r.artifacts.segment.feature_count++; }, /Feature count mismatch/],
        [r => { r.artifacts.segment.byte_length++; }, /Artifact fingerprint mismatch/],
        [r => { r.artifacts.segment.content_sha256 = '0'.repeat(64); }, /Artifact fingerprint mismatch/],
        [r => { r.sources.segment.content_sha256 = '0'.repeat(64); }, /Source fingerprint mismatch/],
      ]) {
        rewriteReport(change);
        assert.throws(() => verify(verification), expected);
      }
      rewriteReport(() => {});
    });
    await t.test('modifying original source bytes fails independent verification', () => {
      const bytes = fs.readFileSync(segments);
      try {
        fs.appendFileSync(segments, 'modified-source');
        assert.throws(() => verify(verification), /Source fingerprint mismatch/);
      } finally { fs.writeFileSync(segments, bytes); }
    });
    await t.test('modified artifact bytes fail integrity checks', () => {
      const file = path.join(out, 'segments.parquet');
      const bytes = fs.readFileSync(file);
      fs.appendFileSync(file, 'tampered');
      assert.throws(() => verify(verification), /fingerprint/);
      fs.writeFileSync(file, bytes);
    });
    await t.test('missing referenced connector fails without publishing a partial package', () => {
      const missing = path.join(dir, 'missing.parquet');
      db.query(`COPY (SELECT * FROM read_parquet(${core.literal(connectors)}) WHERE id != 'c-left') TO ${core.literal(missing)} (FORMAT PARQUET);`);
      const destination = path.join(dir, 'missing-output');
      assert.throws(() => core.build({ ...options, connectors: missing, out: destination }), /Missing referenced connector/);
      assert.equal(fs.existsSync(destination), false);
      assert.equal(fs.readdirSync(dir).some(n => n.startsWith('.transport-geography-fixture-')), false);
    });
    await t.test('duplicates, empty selection, row overflow and absent geometry fail closed', () => {
      const queries = [
        [`SELECT * FROM read_parquet(${core.literal(segments)}) UNION ALL SELECT * FROM read_parquet(${core.literal(segments)})`, /duplicate feature id/],
        [`SELECT * FROM read_parquet(${core.literal(segments)}) WHERE subtype='rail'`, /empty source/],
        [`SELECT s.* FROM read_parquet(${core.literal(segments)}) s, range(1001)`, /row limit/],
        [`SELECT * EXCLUDE (geometry) FROM read_parquet(${core.literal(segments)})`, /geo metadata/],
        [`SELECT * REPLACE (ST_Point(0,0) AS geometry) FROM read_parquet(${core.literal(segments)})`, /LineString/],
        [`SELECT * REPLACE ([{'connector_id': 'c-left', 'at': 2.0}] AS connectors) FROM read_parquet(${core.literal(segments)})`, /connector references/],
        [`SELECT * REPLACE ({'xmin': 0.0, 'ymin': 0.0, 'xmax': 0.0, 'ymax': 0.0} AS bbox) FROM read_parquet(${core.literal(segments)})`, /feature bbox/],
        [`SELECT * REPLACE ({'xmin': bbox.xmin::VARCHAR, 'ymin': bbox.ymin::VARCHAR, 'xmax': bbox.xmax::VARCHAR, 'ymax': bbox.ymax::VARCHAR} AS bbox) FROM read_parquet(${core.literal(segments)})`, /feature bbox/],
      ];
      queries.forEach(([query, expected], i) => {
        const file = path.join(dir, `bad-${i}.parquet`);
        db.query(`COPY (${query}) TO ${core.literal(file)} (FORMAT PARQUET);`);
        const destination = path.join(dir, `bad-output-${i}`);
        assert.throws(() => core.build({ ...options, segments: file, out: destination }), expected);
        assert.equal(fs.existsSync(destination), false);
      });
    });
    await t.test('rehashed attribute tampering still fails source selection comparison', () => {
      const original = path.join(out, 'segments.parquet');
      const bytes = fs.readFileSync(original);
      const replacement = path.join(dir, 'omitted.parquet');
      // Keep both segments and their references, but alter a preserved attribute.
      db.query(`COPY (SELECT * REPLACE ({'primary': 'changed'} AS names) FROM read_parquet(${core.literal(original)})) TO ${core.literal(replacement)} (FORMAT PARQUET);`);
      fs.copyFileSync(replacement, original);
      rewriteReport(r => Object.assign(r.artifacts.segment, core.fingerprint(original)));
      assert.throws(() => verify(verification), /source selection/);
      fs.writeFileSync(original, bytes);
      rewriteReport(() => {});
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
