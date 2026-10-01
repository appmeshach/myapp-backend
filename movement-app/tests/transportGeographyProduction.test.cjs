'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const contract = require('../scripts/transport-geography/production-contract.cjs');

test('production contract pins release, schema, sources, Lagos boundary policy and artifacts', () => {
  const config = contract.readProductionConfig();
  assert.equal(config.production_execution_enabled, false);
  assert.equal(config.dataset_release, contract.EXPECTED_RELEASE);
  assert.equal(config.schema_version, contract.EXPECTED_SCHEMA);
  assert.equal(config.source_templates.segment, contract.EXPECTED_SEGMENT_SOURCE);
  assert.equal(config.source_templates.connector, contract.EXPECTED_CONNECTOR_SOURCE);
  assert.equal(config.boundary.jurisdiction_name, 'Lagos State');
  assert.equal(config.boundary.buffer_meters, 0);
  assert.equal(config.build.clip_geometry, false);
  assert.deepEqual(config.artifacts, contract.REQUIRED_ARTIFACTS);
});

test('production execution and source contract changes fail closed', () => {
  const config = contract.readProductionConfig();
  for (const change of [
    { production_execution_enabled: true },
    { dataset_release: 'latest' },
    { schema_version: 'unknown' },
    { source_templates: { ...config.source_templates, segment: 'https://example.com/data.parquet' } },
    { source_access: { ...config.source_access, allow_operator_remote_url_override: true } },
    { build: { ...config.build, clip_geometry: true } },
    { boundary: { ...config.boundary, buffer_meters: 100 } },
  ]) {
    assert.throws(() => contract.validateProductionConfig({ ...config, ...change }), /contract|disabled/i);
  }
});

test('boundary accepts Polygon and MultiPolygon with islands and holes', () => {
  const polygon = {
    type: 'Feature',
    properties: { synthetic: true },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]],
        [[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]],
      ],
    },
  };
  assert.equal(contract.validateBoundaryGeoJSON(polygon), polygon);

  const multi = {
    type: 'FeatureCollection',
    features: [
      polygon,
      {
        type: 'Feature',
        properties: { synthetic: true },
        geometry: {
          type: 'MultiPolygon',
          coordinates: [
            [[[10, 10], [11, 10], [11, 11], [10, 11], [10, 10]]],
            [[[20, 20], [21, 20], [21, 21], [20, 21], [20, 20]]],
          ],
        },
      },
    ],
  };
  assert.equal(contract.validateBoundaryGeoJSON(multi), multi);
});

test('boundary fails closed for unsupported, malformed or non-WGS84 coordinates', () => {
  const feature = geometry => ({ type: 'Feature', properties: {}, geometry });
  for (const document of [
    { type: 'FeatureCollection', features: [] },
    feature({ type: 'LineString', coordinates: [[0, 0], [1, 1]] }),
    feature({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] }),
    feature({ type: 'Polygon', coordinates: [[[181, 0], [1, 0], [1, 1], [181, 0]]] }),
    { type: 'Feature', crs: { type: 'name' }, properties: {}, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } },
  ]) {
    assert.throws(() => contract.validateBoundaryGeoJSON(document), /Boundary|Polygon|coordinates|crs/i);
  }
});

test('boundary provenance requires reviewed authority fields and lowercase SHA-256 values', () => {
  const provenance = {
    publisher: 'synthetic authority',
    issuing_authority: 'synthetic authority',
    administrative_level: 'state',
    jurisdiction_identifier: 'NG-LA-synthetic',
    edition_or_effective_date: 'synthetic-edition',
    source_identifier: 'synthetic-boundary-source',
    license: 'synthetic-license',
    original_crs: 'EPSG:4326',
    transformation: 'none; synthetic test only',
    original_file_sha256: 'a'.repeat(64),
    normalized_file_sha256: 'b'.repeat(64),
    reviewer_acceptance_reference: 'synthetic-review',
  };
  assert.equal(contract.validateBoundaryProvenance(provenance), provenance);
  for (const change of [
    { publisher: '' },
    { administrative_level: 'country' },
    { original_file_sha256: 'ABC' },
    { normalized_file_sha256: '0'.repeat(63) },
  ]) {
    assert.throws(() => contract.validateBoundaryProvenance({ ...provenance, ...change }), /Boundary provenance/i);
  }
});
