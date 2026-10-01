'use strict';

// WE DO NOT CREATE JOURNEYS. This entry point only accepts small local fixtures.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { isDeepStrictEqual } = require('node:util');
const DEFAULT_CONFIG = path.resolve(__dirname, '../../config/transport-geography-extract.json');
const REPOSITORY_ROOT = path.resolve(__dirname, '../..');
const FILES = ['segments.parquet', 'connectors.parquet', 'fixture-report.json'];
const fail = message => { throw new Error(message); };
const literal = value => "'" + String(value).replaceAll("'", "''") + "'";
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fingerprint = file => {
  const bytes = fs.readFileSync(file);
  return { content_sha256: hash(bytes), byte_length: bytes.length };
};

function localPath(value) {
  if (typeof value !== 'string' || !value || /[\x00-\x1f*?\[\]]/.test(value)
      || /^[\\/]{2}/.test(value) || /[a-z][a-z0-9+.-]*:\/\//i.test(value)
      || (value.includes(':') && !/^[A-Za-z]:[\\/][^:]*$/.test(value))) {
    fail('Expected one explicit local path; URLs, UNC paths and globs are forbidden');
  }
  return path.resolve(value);
}

function localFile(value, maxBytes = 1048576) {
  const file = localPath(value);
  const real = fs.realpathSync(file);
  localPath(real);
  if (fs.lstatSync(file).isSymbolicLink() || real !== file && process.platform !== 'win32') {
    fail('Symlinked fixture files are forbidden');
  }
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size === 0 || stat.size > maxBytes) fail('Fixture file is empty or exceeds size limit');
  return real;
}

function within(root, target) {
  // path.relative uses platform path semantics (including Windows drive/case
  // handling). Do not use string prefixes: sibling names are not descendants.
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep)
    && !path.isAbsolute(relative));
}

function outputPath(value) {
  const requested = localPath(value);
  const root = fs.realpathSync(REPOSITORY_ROOT);
  function assertAllowed(target, repository) {
    const allowed = path.join(repository, 'tmp', 'transport-geography');
    // Require a child of the ignored root so sibling staging is ignored too.
    if (within(repository, target) && (!within(allowed, target) || path.relative(allowed, target) === '')) {
      fail('Repository output must be under tmp/transport-geography/');
    }
  }
  assertAllowed(requested, REPOSITORY_ROOT);
  // An existing directory, file or dangling symlink must never be overwritten.
  if (fs.existsSync(requested) || fs.lstatSync(requested, { throwIfNoEntry: false })) {
    fail('Output directory must not exist; refusing to overwrite');
  }
  const parent = localPath(fs.realpathSync(path.dirname(requested)));
  const resolved = path.join(parent, path.basename(requested));
  // Check physical ancestry as well: an external symlink/junction can point
  // into docs/, and an allowed-looking path can redirect there through tmp/.
  assertAllowed(resolved, root);
  return resolved;
}

const runtime = () => ({ node: process.version, platform: process.platform, arch: process.arch });
const configFingerprint = () => fingerprint(DEFAULT_CONFIG).content_sha256;

function validateConfig(config) {
  const expected = JSON.parse(fs.readFileSync(DEFAULT_CONFIG, 'utf8'));
  // This milestone deliberately provides no production configuration switch.
  if (!isDeepStrictEqual(config, expected)) fail('Configuration must match the committed local-fixture-only contract');
  const b = config.coverage_bbox;
  if (!b || Object.keys(b).sort().join(',') !== 'xmax,xmin,ymax,ymin'
      || !Object.values(b).every(Number.isFinite) || b.xmin < -180 || b.xmax > 180
      || b.ymin < -90 || b.ymax > 90 || b.xmin >= b.xmax || b.ymin >= b.ymax) fail('Invalid coverage bbox');
  if (config.mode !== 'local-fixture-only' || config.max_input_bytes > 1048576
      || config.max_input_rows > 1000) fail('Only small local fixtures are supported');
  return config;
}

function readConfig(file = DEFAULT_CONFIG) {
  return validateConfig(JSON.parse(fs.readFileSync(localFile(file), 'utf8')));
}

function duckdb(binary = process.env.DUCKDB_BIN || 'duckdb', config = readConfig()) {
  function invoke(args) {
    const result = spawnSync(binary, args, { encoding: 'utf8', windowsHide: true,
      timeout: 30000, maxBuffer: 8 * 1024 * 1024, shell: false });
    if (result.error) fail(`DuckDB execution failed: ${result.error.message}. Set --duckdb or DUCKDB_BIN to an installed CLI.`);
    if (result.status !== 0) fail(`DuckDB failed: ${result.stderr || result.stdout}`);
    return result.stdout.trim();
  }
  const version = invoke(['-version']);
  if (version.split(/\s/)[0] !== config.duckdb_version) fail(`Expected DuckDB ${config.duckdb_version}, got ${version}`);
  const prefix = `SET autoinstall_known_extensions=false;
SET autoload_known_extensions=false;
LOAD parquet;
LOAD spatial;
SET threads=1;
SET preserve_insertion_order=true;
SET memory_limit='256MB';
SET max_temp_directory_size='0B';
`;
  return { version, query(sql) {
    const output = invoke(['-init', os.devNull, '-batch', '-bail', '-json', ':memory:', '-c', prefix + sql]);
    return output ? JSON.parse(output) : [];
  } };
}

function sqlTemplates() {
  return ['extract-segments.sql', 'extract-connectors.sql'].map(name => fs.readFileSync(path.join(__dirname, name), 'utf8'));
}

function sourceSQL(segments, connectors, config) {
  const b = config.coverage_bbox;
  return `CREATE TEMP VIEW source_segments AS SELECT * FROM read_parquet(${literal(segments)});
CREATE TEMP VIEW source_connectors AS SELECT * FROM read_parquet(${literal(connectors)});
CREATE TEMP VIEW extract_bounds AS SELECT ${b.xmin}::DOUBLE xmin, ${b.ymin}::DOUBLE ymin, ${b.xmax}::DOUBLE xmax, ${b.ymax}::DOUBLE ymax;
`;
}

function validateSource(db, file, type, config) {
  // Check the footer count before materializing rows, including compressed inputs.
  const footer = db.query(`SELECT num_rows FROM parquet_file_metadata(${literal(file)});`)[0];
  if (!footer || footer.num_rows < 1 || footer.num_rows > config.max_input_rows) fail('Fixture row limit exceeded or empty source');
  const metadata = db.query(`SELECT decode(value) AS value FROM parquet_kv_metadata(${literal(file)}) WHERE decode(key)='geo';`);
  if (metadata.length !== 1) fail('GeoParquet geo metadata required');
  const geo = JSON.parse(metadata[0].value);
  const geometry = geo.columns?.geometry;
  if (geo.primary_column !== 'geometry' || !geometry || geometry.encoding !== 'WKB') fail('Expected primary WKB geometry column');
  if (Object.hasOwn(geometry, 'crs')) {
    const id = geometry.crs?.id;
    if (!(id?.authority === 'EPSG' && id.code === 4326)
        && !(id?.authority === 'OGC' && id.code === 'CRS84')) fail('Expected WGS84 longitude/latitude CRS');
  }
  const rows = db.query(`SELECT id, ST_AsGeoJSON(geometry)::VARCHAR AS geometry, bbox${type === 'segment' ? ', subtype, connectors' : ''}
FROM read_parquet(${literal(file)}) ORDER BY id;`);
  const ids = new Set();
  for (const row of rows) {
    if (typeof row.id !== 'string' || !row.id.trim() || ids.has(row.id)) fail('Missing or duplicate feature id');
    ids.add(row.id);
    const shape = JSON.parse(row.geometry);
    const expectedType = type === 'segment' ? 'LineString' : 'Point';
    if (shape?.type !== expectedType) fail(`Expected ${expectedType} geometry`);
    const points = type === 'segment' ? shape.coordinates : [shape.coordinates];
    if (!Array.isArray(points) || points.length < (type === 'segment' ? 2 : 1)
        || points.some(p => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite)
          || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90)) fail('Invalid WGS84 coordinates');
    const bbox = row.bbox;
    if (!bbox || Object.keys(bbox).sort().join(',') !== 'xmax,xmin,ymax,ymin'
        || !Object.values(bbox).every(Number.isFinite)
        || bbox.xmin > bbox.xmax || bbox.ymin > bbox.ymax
        || points.some(p => p[0] < bbox.xmin || p[0] > bbox.xmax || p[1] < bbox.ymin || p[1] > bbox.ymax)
        || bbox.xmin < -180 || bbox.xmax > 180 || bbox.ymin < -90 || bbox.ymax > 90) fail('Invalid feature bbox');
    if (type === 'segment') {
      if (typeof row.subtype !== 'string' || !row.subtype) fail('Missing segment subtype');
      if (!Array.isArray(row.connectors) || row.connectors.length < 2
          || row.connectors.some(r => typeof r?.connector_id !== 'string' || !r.connector_id.trim()
            || !Number.isFinite(r.at) || r.at < 0 || r.at > 1)) fail('Invalid connector references');
    }
  }
  return rows;
}

function inspectPair(db, segments, connectors, config, selected = false) {
  const s = validateSource(db, segments, 'segment', config);
  const c = validateSource(db, connectors, 'connector', config);
  if (selected) {
    const b = config.coverage_bbox;
    const refs = new Set(s.flatMap(row => row.connectors.map(ref => ref.connector_id)));
    const ids = new Set(c.map(row => row.id));
    if (s.some(row => row.subtype !== 'road' || row.bbox.xmin > b.xmax || row.bbox.xmax < b.xmin
        || row.bbox.ymin > b.ymax || row.bbox.ymax < b.ymin)) fail('Unexpected segment selection');
    if ([...refs].some(id => !ids.has(id))) fail('Missing referenced connector');
    if ([...ids].some(id => !refs.has(id))) fail('Unreferenced connector in extract');
  }
  return { segment: s.length, connector: c.length };
}

function recipe() {
  return Object.fromEntries(['build-extract.cjs', 'verify-extract.cjs', 'extract-segments.sql', 'extract-connectors.sql']
    .map(name => [name, fingerprint(path.join(__dirname, name)).content_sha256]));
}

function build(options) {
  if (options.fixture !== true) fail('Explicit --fixture is required; production extraction is not implemented');
  const config = readConfig(options.config);
  // Reject unsafe output before opening sources, invoking DuckDB or staging.
  const out = outputPath(options.out);
  const segments = localFile(options.segments, config.max_input_bytes);
  const connectors = localFile(options.connectors, config.max_input_bytes);
  if (segments === connectors) fail('Distinct segment and connector inputs required');
  const parent = path.dirname(out);
  const db = duckdb(options.duckdb, config);
  const sources = { segment: fingerprint(segments), connector: fingerprint(connectors) };
  inspectPair(db, segments, connectors, config);
  const staging = fs.mkdtempSync(path.join(parent, '.transport-geography-fixture-'));
  try {
    const s = path.join(staging, FILES[0]);
    const c = path.join(staging, FILES[1]);
    const sql = sourceSQL(segments, connectors, config) + sqlTemplates().join('\n');
    db.query(sql + `
COPY (SELECT * FROM selected_segments ORDER BY id) TO ${literal(s)} (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 2048);
COPY (SELECT * FROM selected_connectors ORDER BY id) TO ${literal(c)} (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 2048);`);
    const counts = inspectPair(db, s, c, config, true);
    if (!isDeepStrictEqual(sources, { segment: fingerprint(segments), connector: fingerprint(connectors) })) fail('Inputs changed during build');
    const report = { report_version: 1, kind: 'transport-geography-fixture-integrity', production: false,
      config, config_sha256: configFingerprint(), runtime: runtime(),
      duckdb_version: db.version, recipe_sha256: recipe(), sources,
      artifacts: {
        segment: { file: FILES[0], ...fingerprint(s), feature_count: counts.segment },
        connector: { file: FILES[1], ...fingerprint(c), feature_count: counts.connector },
      } };
    fs.writeFileSync(path.join(staging, FILES[2]), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    fs.renameSync(staging, out);
    return report;
  } finally {
    // staging is created by this invocation and never supplied by the operator.
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function argumentsFor(argv, verify = false) {
  const options = {};
  const allowed = new Set(verify ? ['dir', 'duckdb', 'segments', 'connectors', 'config'] : ['out', 'duckdb', 'segments', 'connectors', 'config']);
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].slice(2);
    if (!argv[i].startsWith('--') || Object.hasOwn(options, key)) fail('Invalid or duplicate argument');
    if (key === 'fixture' && !verify) { options.fixture = true; continue; }
    if (!allowed.has(key) || !argv[i + 1] || argv[i + 1].startsWith('--')) fail(`Invalid argument: ${argv[i]}`);
    options[key] = argv[++i];
  }
  return options;
}

module.exports = { build, argumentsFor, readConfig, validateConfig, duckdb, literal, localPath,
  localFile, outputPath, runtime, configFingerprint, fingerprint, inspectPair, sourceSQL, sqlTemplates, recipe, FILES, fail };
if (require.main === module) {
  try { const report = build(argumentsFor(process.argv.slice(2))); console.log(JSON.stringify(report, null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
