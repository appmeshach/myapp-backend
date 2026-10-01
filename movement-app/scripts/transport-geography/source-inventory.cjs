'use strict';

// WE DO NOT CREATE JOURNEYS. This module validates deterministic metadata about
// pinned Overture source objects only. It performs no network access or download.
const crypto = require('node:crypto');
const {
  EXPECTED_RELEASE,
  EXPECTED_SCHEMA,
} = require('./production-contract.cjs');

const INVENTORY_VERSION = 1;
const EXPECTED_BUCKET = 'overturemaps-us-west-2';
const EXPECTED_THEME = 'transportation';
const FEATURE_TYPES = ['segment', 'connector'];
const PREFIXES = Object.freeze({
  segment: `release/${EXPECTED_RELEASE}/theme=${EXPECTED_THEME}/type=segment/`,
  connector: `release/${EXPECTED_RELEASE}/theme=${EXPECTED_THEME}/type=connector/`,
});

const fail = message => { throw new Error(message); };
const isPlainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const safeToken = value => typeof value === 'string' && value.length > 0 && value.length <= 1024
  && !/[\x00-\x1f\x7f]/.test(value);

function validateEntry(entry) {
  if (!isPlainObject(entry)) fail('Source inventory entry must be an object');
  const allowed = new Set(['feature_type', 'object_key', 'byte_length', 'etag', 'version_id', 'checksum']);
  for (const key of Object.keys(entry)) if (!allowed.has(key)) fail(`Unexpected source inventory entry field: ${key}`);

  if (!FEATURE_TYPES.includes(entry.feature_type)) fail('Source inventory feature_type must be segment or connector');
  if (!safeToken(entry.object_key)) fail('Source inventory object_key is required');
  const prefix = PREFIXES[entry.feature_type];
  if (!entry.object_key.startsWith(prefix) || entry.object_key === prefix
      || entry.object_key.includes('..') || entry.object_key.includes('\\')
      || /(^|\/)latest(\/|$)/i.test(entry.object_key)) {
    fail('Source inventory object_key must remain under the pinned release/type prefix');
  }
  if (!Number.isSafeInteger(entry.byte_length) || entry.byte_length <= 0) {
    fail('Source inventory byte_length must be a positive safe integer');
  }

  if (Object.hasOwn(entry, 'etag')) {
    if (!safeToken(entry.etag) || entry.etag.length > 256) fail('Source inventory etag is invalid');
  }
  if (Object.hasOwn(entry, 'version_id')) {
    if (!safeToken(entry.version_id) || entry.version_id.length > 512) fail('Source inventory version_id is invalid');
  }
  if (Object.hasOwn(entry, 'checksum')) {
    if (!isPlainObject(entry.checksum)
        || Object.keys(entry.checksum).sort().join(',') !== 'algorithm,value'
        || entry.checksum.algorithm !== 'sha256'
        || typeof entry.checksum.value !== 'string'
        || !/^[0-9a-f]{64}$/.test(entry.checksum.value)) {
      fail('Source inventory checksum must be lowercase SHA-256');
    }
  }
  return entry;
}

function entryKey(entry) {
  return `${entry.feature_type}\u0000${entry.object_key}`;
}

function compareEntries(a, b) {
  return entryKey(a).localeCompare(entryKey(b), 'en');
}

function validateInventory(inventory) {
  if (!isPlainObject(inventory)) fail('Source inventory must be an object');
  const expectedKeys = [
    'inventory_version', 'dataset_family', 'dataset_release', 'schema_version',
    'theme', 'bucket', 'entries',
  ];
  if (Object.keys(inventory).sort().join(',') !== expectedKeys.sort().join(',')) {
    fail('Unexpected source inventory top-level fields');
  }
  if (inventory.inventory_version !== INVENTORY_VERSION
      || inventory.dataset_family !== 'overture'
      || inventory.dataset_release !== EXPECTED_RELEASE
      || inventory.schema_version !== EXPECTED_SCHEMA
      || inventory.theme !== EXPECTED_THEME
      || inventory.bucket !== EXPECTED_BUCKET) {
    fail('Source inventory provenance does not match the pinned production contract');
  }
  if (!Array.isArray(inventory.entries) || inventory.entries.length < 2) {
    fail('Source inventory must contain segment and connector objects');
  }

  const seen = new Set();
  const typeCounts = { segment: 0, connector: 0 };
  let previous = null;
  for (const entry of inventory.entries) {
    validateEntry(entry);
    const key = entryKey(entry);
    if (seen.has(key)) fail('Duplicate source inventory object');
    seen.add(key);
    typeCounts[entry.feature_type]++;
    if (previous && compareEntries(previous, entry) >= 0) {
      fail('Source inventory entries must be in deterministic feature_type/object_key order');
    }
    previous = entry;
  }
  if (typeCounts.segment < 1 || typeCounts.connector < 1) {
    fail('Source inventory must contain at least one object for each required feature type');
  }
  return inventory;
}

function canonicalizeInventory(inventory) {
  if (!isPlainObject(inventory) || !Array.isArray(inventory.entries)) fail('Source inventory entries are required');
  const canonical = {
    inventory_version: inventory.inventory_version,
    dataset_family: inventory.dataset_family,
    dataset_release: inventory.dataset_release,
    schema_version: inventory.schema_version,
    theme: inventory.theme,
    bucket: inventory.bucket,
    entries: inventory.entries.map(entry => ({
      feature_type: entry.feature_type,
      object_key: entry.object_key,
      byte_length: entry.byte_length,
      ...(Object.hasOwn(entry, 'etag') ? { etag: entry.etag } : {}),
      ...(Object.hasOwn(entry, 'version_id') ? { version_id: entry.version_id } : {}),
      ...(Object.hasOwn(entry, 'checksum') ? { checksum: { algorithm: entry.checksum.algorithm, value: entry.checksum.value } } : {}),
    })).sort(compareEntries),
  };
  return validateInventory(canonical);
}

function serializeInventory(inventory) {
  const canonical = canonicalizeInventory(inventory);
  return JSON.stringify(canonical, null, 2) + '\n';
}

function inventorySha256(inventory) {
  return crypto.createHash('sha256').update(serializeInventory(inventory), 'utf8').digest('hex');
}

function sourceUri(entry) {
  validateEntry(entry);
  return `s3://${EXPECTED_BUCKET}/${entry.object_key}`;
}

module.exports = {
  INVENTORY_VERSION,
  EXPECTED_BUCKET,
  EXPECTED_THEME,
  FEATURE_TYPES,
  PREFIXES,
  validateEntry,
  validateInventory,
  canonicalizeInventory,
  serializeInventory,
  inventorySha256,
  sourceUri,
};
