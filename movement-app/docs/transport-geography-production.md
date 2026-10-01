# Production transport geography contract

WE DO NOT CREATE JOURNEYS.

This milestone defines a fail-closed contract for future production transport-geography extraction. It does **not** acquire Overture data, execute a production extraction, register anything in Supabase, create a classifier, or implement pricing.

## Current status

Production execution is intentionally disabled. The committed contract pins Overture release `2026-09-23.1`, schema `v2.0.0`, transportation `segment` and `connector` feature types, road segments, DuckDB `v1.5.6`, and ODbL attribution metadata.

The existing fixture tooling remains separate and unchanged.

## Lagos State boundary interface

The eventual production extract requires an approved Lagos State administrative boundary supplied as normalized GeoJSON. The tooling contract accepts Polygon or MultiPolygon geometry, including multiple components, islands, and holes. Coordinates must be WGS84 longitude/latitude pairs and rings must be closed.

No Lagos coordinates are committed in this milestone. The approved boundary source, edition, authority, license, original CRS, transformations, source hash, normalized hash, and reviewer acceptance must be recorded separately before production acquisition can be authorized.

Initial buffer policy is zero metres. A future nonzero buffer requires explicit review and a documented purpose.

The extraction selection contract is:

1. derive a candidate bbox from the approved boundary;
2. use bbox overlap only as a prefilter;
3. select road segments by exact polygon intersection, including boundary touching;
4. retain each selected segment's complete source geometry without clipping;
5. derive the complete distinct connector-ID set from selected segments;
6. include exactly those referenced connectors, including connectors outside Lagos State.

Transport extraction coverage does not itself prove that a user journey remains inside Lagos State. Same-state journey validation is a separate server-side policy milestone.

## Source contract

Only the pinned Overture public source templates are authorized by the current contract:

```text
s3://overturemaps-us-west-2/release/2026-09-23.1/theme=transportation/type=segment/*
s3://overturemaps-us-west-2/release/2026-09-23.1/theme=transportation/type=connector/*
```

There is no operator remote-URL override and no `latest` alias. Future acquisition code must freeze an explicit object inventory before build work begins. Acquisition will be the network-enabled stage; production building and verification should consume local, hash-checked frozen inputs.

## Planned immutable package

The current contract reserves these top-level package payloads:

- `segments.parquet`
- `connectors.parquet`
- `manifest.json`
- `manifest.sha256`
- `source-inventory.json`
- `build-spec.json`
- `boundary.geojson`
- `boundary-provenance.json`
- `verification-report.json`

Future production design may also retain recipe, schema, NOTICE, and license directories as immutable manifest-covered payloads. Those details must be reviewed before production execution is enabled.

Generated production artifacts must never be committed to Git.

## Boundary provenance

The contract validator requires nonempty records for:

- publisher
- issuing authority
- administrative level (`state`)
- jurisdiction identifier
- edition/effective date
- source identifier
- license
- original CRS
- transformation description
- original-file SHA-256
- normalized-file SHA-256
- reviewer acceptance reference

SHA-256 values must be lowercase 64-character hexadecimal strings.

## Security posture

This milestone performs no remote access and no production build. Future production tooling must retain these boundaries:

- no arbitrary operator-supplied remote source URLs;
- no shell-built commands;
- no DuckDB extension autoinstall/autoload during a build;
- no implicit credential discovery for public acquisition;
- no production output inside the Git worktree;
- no overwrite of published packages;
- no silent schema coercion, geometry repair, dropped features, or missing connectors;
- no Supabase write or registration during extraction.

## Cost ledger

No paid external service is required by this contract milestone. Future production acquisition will require compute, disk, network access, and durable retained storage, but existing local resources may satisfy those requirements. Cloud compute, paid object storage, automated production CI, managed checksum services, and multi-region replication remain optional until a concrete operational need is approved.

## Next implementation boundary

A later reviewed milestone may add production source inventory/acquisition, offline build, and independent verification. Production execution must remain blocked until the Lagos boundary provenance, supported toolchain/platform, resource budget, retention plan, and artifact publication location are explicitly approved.
