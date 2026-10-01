# Production transport geography source inventory

WE DO NOT CREATE JOURNEYS.

This milestone defines the immutable metadata contract for the exact Overture source objects that a later production acquisition stage may freeze. It performs no network access, S3 listing, download, DuckDB execution, extraction, Supabase write, classifier work, or pricing.

## Why this exists

The production extraction contract pins Overture release `2026-09-23.1`, schema `v2.0.0`, transportation `segment` and `connector` data, and forbids `latest` or arbitrary operator URLs. Before a production build can become reproducible, the acquisition stage must stop depending on wildcard expansion and record the exact source objects it intends to use.

The source inventory is that frozen identity record.

## Inventory identity

A valid inventory records exactly:

- inventory format version;
- dataset family;
- pinned dataset release;
- pinned schema version;
- theme;
- pinned public Overture bucket;
- a deterministic list of source object entries.

Each object entry records:

- feature type: `segment` or `connector`;
- exact object key under the correct pinned release/type prefix;
- positive byte length;
- optional ETag;
- optional object version ID;
- optional lowercase SHA-256 checksum when a trustworthy upstream checksum is available.

ETags are retained only as source identity evidence. They are not treated as universal content hashes. A later acquisition implementation must compute local SHA-256 for retained bytes.

## Determinism

The inventory must contain at least one segment object and one connector object. Duplicate feature-type/object-key pairs are rejected.

Entries are serialized in deterministic feature-type/object-key order. The exact canonical JSON bytes end with one newline and can be SHA-256 hashed. Timestamps, operator names, retry logs, signed URLs, local paths, and other operational metadata do not belong inside this immutable identity document.

Human approvals and acquisition logs should reference the inventory SHA-256 rather than changing the inventory bytes.

## Security boundaries

The contract derives S3 URIs from validated object keys and the pinned bucket. It does not accept arbitrary URLs or bucket overrides.

Object keys must remain under one of these exact release/type prefixes:

```text
release/2026-09-23.1/theme=transportation/type=segment/
release/2026-09-23.1/theme=transportation/type=connector/
```

`latest`, path traversal, backslashes, control characters, mixed releases, mixed schemas, extra top-level fields, duplicate objects, and malformed checksums fail closed.

## What the later acquisition stage must do

This contract does **not** prove that an inventory is complete. A later network-enabled acquisition milestone must:

1. enumerate the approved public Overture source namespace completely, with pagination handled explicitly;
2. map each object to the correct feature type;
3. freeze the complete object list before any production build begins;
4. record available object identity metadata without interpreting ETag as a SHA-256;
5. detect source mutation between listing and retrieval;
6. download or otherwise freeze the exact approved objects into controlled local storage;
7. compute local SHA-256 for retained source bytes;
8. make the later build and verification stages consume only the frozen local inputs.

No production acquisition is authorized by this milestone.

## Cost ledger

This source-inventory contract adds no paid dependency and performs no network activity. The future acquisition stage may use normal internet bandwidth, local disk, and local compute. Paid cloud compute, paid object storage, managed checksum services, and production CI remain optional unless later capacity or operational requirements justify them.

## Next stopping point

After this contract is merged, the transport-geography infrastructure has a clean pause point: production extraction remains disabled, the Lagos boundary remains an approved future input, and no real Overture production data has been downloaded.

At that point the Movement project can return to visible application work before deciding whether deeper acquisition tooling is actually needed immediately.
