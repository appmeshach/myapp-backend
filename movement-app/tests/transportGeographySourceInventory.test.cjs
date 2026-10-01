'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const inventory = require('../scripts/transport-geography/source-inventory.cjs');

function validEntries() {
  return [
    {
      feature_type: 'connector',
      object_key: `${inventory.PREFIXES.connector}part-00001.parquet`,
      byte_length: 222,
      etag: 'connector-etag',
      checksum: { algorithm: 'sha256', value: 'b'.repeat(64) },
    },
    {
      feature_type: 'segment',
      object_key: `${inventory.PREFIXES.segment}part-00001.parquet`,
      byte_length: 111,
      etag: 'segment-etag',
      version_id: 'segment-version',
      checksum: { algorithm: 'sha256', value: 'a'.repeat(64) },
    },
  ];
}

function validInventory(entries = validEntries()) {
  return {
    inventory_version: inventory.INVENTORY_VERSION,
    dataset_family: 'overture',
    dataset_release: '2026-09-23.1',
    schema_version: 'v2.0.0',
    theme: 'transportation',
    bucket: inventory.EXPECTED_BUCKET,
    entries,
  };
}

test('source inventory pins release, schema, bucket and both feature types', () => {
  const value = validInventory();
  assert.equal(inventory.validateInventory(value), value);
  assert.deepEqual(inventory.FEATURE_TYPES, ['segment', 'connector']);
  assert.match(inventory.PREFIXES.segment, /2026-09-23\.1/);
  assert.match(inventory.PREFIXES.connector, /2026-09-23\.1/);
});

test('canonicalization sorts entries deterministically and produces a stable SHA-256', () => {
  const reversed = validEntries().reverse();
  const canonical = inventory.canonicalizeInventory(validInventory(reversed));
  assert.deepEqual(canonical.entries.map(entry => entry.feature_type), ['connector', 'segment']);
  const serialized = inventory.serializeInventory(validInventory(reversed));
  assert.equal(serialized, inventory.serializeInventory(canonical));
  assert.match(inventory.inventorySha256(canonical), /^[0-9a-f]{64}$/);
  assert.equal(inventory.inventorySha256(canonical), inventory.inventorySha256(validInventory(reversed)));
});

test('validation rejects mixed releases, latest aliases and arbitrary source keys', () => {
  const badKeys = [
    'release/latest/theme=transportation/type=segment/part.parquet',
    'release/2026-09-23.1/theme=transportation/type=connector/part.parquet',
    'release/2026-09-23.1/theme=transportation/type=segment/../connector/part.parquet',
    'https://example.com/part.parquet',
  ];
  for (const object_key of badKeys) {
    const entry = { ...validEntries()[1], object_key };
    assert.throws(() => inventory.validateEntry(entry), /pinned release|object_key/i);
  }

  for (const change of [
    { dataset_release: 'latest' },
    { dataset_release: '2026-09-01.0' },
    { schema_version: 'v1.0.0' },
    { bucket: 'operator-bucket' },
  ]) {
    assert.throws(() => inventory.validateInventory({ ...validInventory(), ...change }), /pinned production contract/i);
  }
});

test('validation rejects duplicate, missing and nondeterministically ordered objects', () => {
  const entries = validEntries();
  assert.throws(() => inventory.validateInventory(validInventory([entries[0], entries[0], entries[1]])), /Duplicate/);
  assert.throws(() => inventory.validateInventory(validInventory([entries[0]])), /segment and connector|each required feature type/);
  assert.throws(() => inventory.validateInventory(validInventory(entries.slice().reverse())), /deterministic/);
});

test('entry metadata fails closed for invalid sizes, checksum shapes and unexpected fields', () => {
  const base = validEntries()[1];
  for (const change of [
    { byte_length: 0 },
    { byte_length: Number.MAX_SAFE_INTEGER + 1 },
    { checksum: { algorithm: 'md5', value: 'a'.repeat(64) } },
    { checksum: { algorithm: 'sha256', value: 'A'.repeat(64) } },
    { checksum: { algorithm: 'sha256', value: 'a'.repeat(63) } },
    { etag: '' },
    { version_id: '' },
    { extra: true },
  ]) {
    assert.throws(() => inventory.validateEntry({ ...base, ...change }), /inventory|checksum|etag|version|field|byte_length/i);
  }
});

test('source URIs are derived only from validated pinned inventory entries', () => {
  const entry = validEntries()[1];
  assert.equal(
    inventory.sourceUri(entry),
    `s3://${inventory.EXPECTED_BUCKET}/${entry.object_key}`,
  );
  assert.throws(() => inventory.sourceUri({ ...entry, object_key: 'release/latest/file.parquet' }), /pinned release/);
});

test('top-level shape rejects silent operational metadata that would make inventory identity ambiguous', () => {
  assert.throws(
    () => inventory.validateInventory({ ...validInventory(), generated_at: '2026-10-01T00:00:00Z' }),
    /top-level fields/,
  );
});
