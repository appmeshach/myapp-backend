'use strict';

// WE DO NOT CREATE JOURNEYS. This module defines fail-closed production
// transport-geography contracts only; it performs no acquisition or extraction.
const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');

const DEFAULT_CONFIG = path.resolve(__dirname, '../../config/transport-geography-production.json');
const EXPECTED_RELEASE = '2026-09-23.1';
const EXPECTED_SCHEMA = 'v2.0.0';
const EXPECTED_SEGMENT_SOURCE = `s3://overturemaps-us-west-2/release/${EXPECTED_RELEASE}/theme=transportation/type=segment/*`;
const EXPECTED_CONNECTOR_SOURCE = `s3://overturemaps-us-west-2/release/${EXPECTED_RELEASE}/theme=transportation/type=connector/*`;
const REQUIRED_ARTIFACTS = [
  'segments.parquet',
  'connectors.parquet',
  'manifest.json',
  'manifest.sha256',
  'source-inventory.json',
  'build-spec.json',
  'boundary.geojson',
  'boundary-provenance.json',
  'verification-report.json',
];

const fail = message => { throw new Error(message); };

function validateProductionConfig(config) {
  const committed = JSON.parse(fs.readFileSync(DEFAULT_CONFIG, 'utf8'));
  if (!isDeepStrictEqual(config, committed)) fail('Production config must match the committed contract exactly');
  if (config.mode !== 'production-contract-only' || config.production_execution_enabled !== false) {
    fail('Production execution must remain disabled in this milestone');
  }
  if (config.dataset_release !== EXPECTED_RELEASE || config.schema_version !== EXPECTED_SCHEMA
      || config.theme !== 'transportation' || config.segment_subtype !== 'road'
      || !isDeepStrictEqual(config.feature_types, ['segment', 'connector'])) {
    fail('Unexpected production dataset contract');
  }
  if (config.coverage_crs !== 'EPSG:4326'
      || config.selection !== 'bbox-prefilter-exact-polygon-intersection-whole-segments-and-referenced-connectors') {
    fail('Unexpected coverage contract');
  }
  if (config.boundary?.jurisdiction_country_code !== 'NG'
      || config.boundary?.jurisdiction_name !== 'Lagos State'
      || config.boundary?.administrative_level !== 'state'
      || config.boundary?.input_required !== true
      || config.boundary?.approved_source_required !== true
      || !isDeepStrictEqual(config.boundary?.accepted_formats, ['GeoJSON'])
      || config.boundary?.buffer_meters !== 0) {
    fail('Unexpected Lagos boundary contract');
  }
  if (config.source_templates?.segment !== EXPECTED_SEGMENT_SOURCE
      || config.source_templates?.connector !== EXPECTED_CONNECTOR_SOURCE
      || config.source_access?.stage !== 'acquisition-only'
      || config.source_access?.anonymous_public_access !== true
      || config.source_access?.allow_operator_remote_url_override !== false
      || config.source_access?.allow_latest_release_alias !== false) {
    fail('Unexpected source access contract');
  }
  if (config.build?.stage !== 'offline-only'
      || config.build?.preserve_whole_segment_geometry !== true
      || config.build?.connector_selection !== 'exact-distinct-references-from-selected-segments'
      || config.build?.clip_geometry !== false) {
    fail('Unexpected offline build contract');
  }
  if (!isDeepStrictEqual(config.artifacts, REQUIRED_ARTIFACTS)) fail('Unexpected production artifact contract');
  if (config.duckdb_version !== 'v1.5.6' || config.source_license !== 'ODbL') {
    fail('Unexpected toolchain or licensing contract');
  }
  for (const name of ['OpenStreetMap', 'Overture', 'TomTom']) {
    if (typeof config.source_attribution !== 'string' || !config.source_attribution.includes(name)) {
      fail('Incomplete source attribution contract');
    }
  }
  return config;
}

function readProductionConfig(file = DEFAULT_CONFIG) {
  const resolved = path.resolve(file);
  return validateProductionConfig(JSON.parse(fs.readFileSync(resolved, 'utf8')));
}

function validatePosition(position) {
  if (!Array.isArray(position) || position.length !== 2 || !position.every(Number.isFinite)
      || position[0] < -180 || position[0] > 180 || position[1] < -90 || position[1] > 90) {
    fail('Boundary coordinates must be finite WGS84 longitude/latitude pairs');
  }
}

function validateRing(ring) {
  if (!Array.isArray(ring) || ring.length < 4) fail('Boundary rings must contain at least four positions');
  for (const position of ring) validatePosition(position);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) fail('Boundary rings must be closed');
}

function validatePolygonCoordinates(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 1) fail('Polygon must contain at least one ring');
  for (const ring of coordinates) validateRing(ring);
}

function validateGeometry(geometry) {
  if (!geometry || typeof geometry !== 'object') fail('Boundary geometry is required');
  if (geometry.type === 'Polygon') {
    validatePolygonCoordinates(geometry.coordinates);
    return;
  }
  if (geometry.type === 'MultiPolygon') {
    if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length < 1) fail('MultiPolygon must not be empty');
    for (const polygon of geometry.coordinates) validatePolygonCoordinates(polygon);
    return;
  }
  fail('Boundary geometry must be Polygon or MultiPolygon');
}

function boundaryFeatures(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) fail('Boundary GeoJSON object is required');
  if (Object.hasOwn(document, 'crs')) fail('Normalized boundary GeoJSON must not contain a legacy crs member');
  if (document.type === 'Feature') return [document];
  if (document.type === 'FeatureCollection') {
    if (!Array.isArray(document.features) || document.features.length < 1) fail('Boundary FeatureCollection must not be empty');
    return document.features;
  }
  fail('Boundary GeoJSON must be a Feature or FeatureCollection');
}

function validateBoundaryGeoJSON(document) {
  const features = boundaryFeatures(document);
  for (const feature of features) {
    if (!feature || feature.type !== 'Feature') fail('Boundary collection may contain only Features');
    validateGeometry(feature.geometry);
  }
  return document;
}

function validateBoundaryProvenance(provenance) {
  if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) fail('Boundary provenance object is required');
  const requiredStrings = [
    'publisher', 'issuing_authority', 'administrative_level', 'jurisdiction_identifier',
    'edition_or_effective_date', 'source_identifier', 'license', 'original_crs',
    'transformation', 'original_file_sha256', 'normalized_file_sha256', 'reviewer_acceptance_reference',
  ];
  for (const key of requiredStrings) {
    if (typeof provenance[key] !== 'string' || !provenance[key].trim()) fail(`Boundary provenance field required: ${key}`);
  }
  for (const key of ['original_file_sha256', 'normalized_file_sha256']) {
    if (!/^[0-9a-f]{64}$/.test(provenance[key])) fail(`Boundary provenance ${key} must be lowercase SHA-256`);
  }
  if (provenance.administrative_level !== 'state') fail('Boundary provenance administrative level must be state');
  return provenance;
}

module.exports = {
  DEFAULT_CONFIG,
  EXPECTED_RELEASE,
  EXPECTED_SCHEMA,
  EXPECTED_SEGMENT_SOURCE,
  EXPECTED_CONNECTOR_SOURCE,
  REQUIRED_ARTIFACTS,
  readProductionConfig,
  validateProductionConfig,
  validateBoundaryGeoJSON,
  validateBoundaryProvenance,
};
