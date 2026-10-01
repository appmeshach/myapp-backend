'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const core = require('./build-extract.cjs');

function verify(options) {
  const dir = core.localPath(options.dir);
  const report = JSON.parse(fs.readFileSync(core.localFile(path.join(dir, core.FILES[2])), 'utf8'));
  const config = core.readConfig(options.config);
  if (report.report_version !== 1 || report.kind !== 'transport-geography-fixture-integrity'
      || report.production !== false || !isDeepStrictEqual(report.config, config)
      || !isDeepStrictEqual(report.recipe_sha256, core.recipe())) core.fail('Invalid fixture report or recipe mismatch');
  if (report.config_sha256 !== core.configFingerprint()) core.fail('Config SHA-256 mismatch');
  if (!isDeepStrictEqual(report.runtime, core.runtime())) core.fail('Runtime provenance mismatch');
  if (!isDeepStrictEqual(fs.readdirSync(dir).sort(), [...core.FILES].sort())) core.fail('Unexpected or missing package files');
  const files = {};
  for (const [index, type] of ['segment', 'connector'].entries()) {
    const artifact = report.artifacts?.[type];
    if (artifact?.file !== core.FILES[index]) core.fail('Invalid artifact path');
    files[type] = core.localFile(path.join(dir, core.FILES[index]));
    const actual = core.fingerprint(files[type]);
    if (actual.content_sha256 !== artifact.content_sha256 || actual.byte_length !== artifact.byte_length) core.fail('Artifact fingerprint mismatch');
  }
  const db = core.duckdb(options.duckdb, config);
  if (db.version !== report.duckdb_version) core.fail('DuckDB build mismatch');
  const counts = core.inspectPair(db, files.segment, files.connector, config, true);
  for (const type of ['segment', 'connector']) {
    if (counts[type] !== report.artifacts[type].feature_count) core.fail('Feature count mismatch');
  }
  // Independent selection verification requires the original fixture files.
  const segments = core.localFile(options.segments, config.max_input_bytes);
  const connectors = core.localFile(options.connectors, config.max_input_bytes);
  if (!isDeepStrictEqual(report.sources, { segment: core.fingerprint(segments), connector: core.fingerprint(connectors) })) core.fail('Source fingerprint mismatch');
  core.inspectPair(db, segments, connectors, config);
  const sql = core.sourceSQL(segments, connectors, config) + core.sqlTemplates().join('\n');
  for (const [type, table] of [['segment', 'selected_segments'], ['connector', 'selected_connectors']]) {
    const result = db.query(sql + `
SELECT count(*) AS differences FROM (
 (SELECT * FROM ${table} EXCEPT ALL SELECT * FROM read_parquet(${core.literal(files[type])}))
 UNION ALL
 (SELECT * FROM read_parquet(${core.literal(files[type])}) EXCEPT ALL SELECT * FROM ${table})
);`);
    if (result[0].differences !== 0) core.fail('Extract differs from deterministic source selection');
  }
  return { verified: true, production: false, counts };
}

module.exports = { verify };
if (require.main === module) {
  try { console.log(JSON.stringify(verify(core.argumentsFor(process.argv.slice(2), true)), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
