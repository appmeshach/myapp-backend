# Transport geography extraction tooling

WE DO NOT CREATE JOURNEYS.

This milestone supplies operator-invoked extraction and verification for **small,
synthetic local fixtures only**. It does not download upstream data, create a
production Lagos extract, register datasets, call Supabase, or implement a
classifier, routing/traversal policy or pricing. Migration 0063 and its tests are
unchanged. No production release directory or production manifest is included.

## Prerequisites and checks

Use Node v24.13.1 and an already installed DuckDB v1.5.6 CLI with its local
`parquet` and `spatial` extensions. No npm packages or extensions are installed by
this tooling. Automatic extension installation/loading is disabled; missing local
extensions fail with a DuckDB error. The CLI startup file is disabled. DuckDB runs
in memory, with one thread, a memory bound, no disk spilling, and a 30-second
timeout per invocation.

Resolve DuckDB through `--duckdb <executable>`, then `DUCKDB_BIN`, then `duckdb`
on PATH. The audited Windows installation path is not part of the contract.

DuckDB identity is the full CLI version/build output for this fixture milestone.
The existing `spawnSync` interface delegates executable lookup to the operating
system and does not return the resolved executable path. A separate PATH search
could hash a different candidate because Windows and POSIX resolve executables
differently. This tooling therefore does not claim an executable SHA-256 or add
a second, potentially inconsistent resolver. A platform-specific executing
binary checksum must be pinned before production artifact approval. No absolute
executable path is stored in the config or report.

```powershell
$env:DUCKDB_BIN = 'C:\path\to\duckdb.exe'
npm run test:transport-geography
npm run test:transport-geography:integration
```

The portable test command skips the DuckDB integration suite explicitly. The
integration command requires DuckDB and fails if it cannot execute. It creates
tiny synthetic GeoParquet files in an OS temporary directory and removes its own
files afterward. Fixtures cover exact intersection (including an overlapping
bbox whose geometry misses the rectangle), whole-feature retention, inclusive boundaries,
outside-bbox connectors, byte repeatability, provenance, malformed inputs,
missing connectors and tampering. It never reads the existing Lagos research file.

## Operator interface

Given two synthetic local GeoParquet input files, create a fresh output directory:

```powershell
npm run transport-geography:build -- --fixture --segments C:\fixtures\segments.parquet --connectors C:\fixtures\connectors.parquet --out C:\fixtures\new-extract
npm run transport-geography:verify -- --dir C:\fixtures\new-extract --segments C:\fixtures\segments.parquet --connectors C:\fixtures\connectors.parquet
```

Both commands accept `--duckdb` and `--config`. An alternate config must match the
committed contract exactly. There is deliberately no production switch. `--fixture`
is the operator's assertion that inputs are synthetic; tooling cannot establish
the origin of arbitrary bytes. Each source is limited to 1 MiB and 1,000 rows.
URLs, UNC paths, wildcard inputs and empty files are rejected. Supply individual
local files, not SQL or remote reader expressions. No source locator is fetched.
Output parents must exist; existing output directories are refused. External
local output is allowed. Within this repository, output must be a child of
`tmp/transport-geography/`; output at the repository root or inside `docs/`,
`scripts/`, or any other repository location is rejected before DuckDB executes.
The tooling derives the repository root from its own location and checks both
the requested path and physical ancestry resolved through symlinks/junctions,
using platform-aware path comparisons. Staging stays beside the allowed output.

The committed config pins the selected upstream **target** release `2026-09-23.1`,
schema `v2.0.0`, transportation theme, `segment` and `connector`, and ODbL
attribution. These labels do not claim synthetic fixtures are actual upstream
data. The synthetic selection bbox is `(0,0)-(2,2)` in WGS84 longitude/latitude;
it is not a Lagos production boundary.

## Fixture input contract and selection

Input GeoParquet must have primary WKB `geometry` and WGS84 metadata (the GeoParquet
default CRS84, explicit OGC CRS84, or EPSG:4326). Null/unknown CRS is rejected.
Segments require unique nonblank `id`, LineString `geometry`, `bbox` with numeric
`xmin`, `ymin`, `xmax`, `ymax`, nonempty `subtype`, and a `connectors` list of at
least two `{connector_id, at}` records. Reference positions must be in `[0,1]`.
Connectors require unique nonblank `id`, Point `geometry`, and `bbox`. Coordinates
must be finite WGS84 pairs, and each bbox must contain its geometry. This is a
deliberately small fixture contract, not a complete validator for Overture v2.

Selection retains `subtype = road` segments using inclusive bbox overlap only as
an optimization/prefilter. Actual LineString intersection with the configured
WGS84 longitude/latitude rectangle is authoritative, using DuckDB Spatial
`ST_Intersects(geometry, ST_MakeEnvelope(xmin, ymin, xmax, ymax))`. This syntax and
edge-touching behavior were confirmed locally with DuckDB v1.5.6. The full rows
and geometry are preserved, including extra names/source/road attributes.
Geometries are not clipped; feature extents may exceed the selection rectangle.

The connector extract contains exactly the IDs referenced by selected segments,
including connectors beyond the bbox. Missing references fail the build. This
checks reference completeness only, not legal travel direction, connectivity
policy, geometric coincidence, or route suitability. No road name or pricing
class is embedded in selection logic. Both nonempty artifacts are mandatory.

## Integrity and reproducibility

A successful fixture build publishes `segments.parquet`, `connectors.parquet`,
and `fixture-report.json` by renaming a private staging directory. On failure it
cleans only its own staging directory. Inputs are never overwritten. The report
is explicitly nonproduction and contains the human-readable config and
`config_sha256` of the exact repository config/build-specification bytes (including
whitespace and line endings). The config fingerprint supplements the existing
recipe hashes; alternate configs must still match the repository contract.
The report also records `runtime.node` (`process.version`), `runtime.platform`
(`process.platform`), `runtime.arch` (`process.arch`), the full DuckDB version/build,
source byte fingerprints, output SHA-256 hashes, byte lengths and feature counts.
It includes no usernames, secrets, absolute machine paths or timestamps so repeated builds
can be byte-identical. Rows are sorted by ID; Parquet compression and row group
size are fixed. Byte reproducibility is tested for identical source bytes and
the same toolchain; it is not promised across DuckDB versions or platforms.

Verification requires the original fixtures. It checks package contents,
provenance/config/recipe, toolchain, hashes, sizes, counts, geometry/bbox validity,
road selection, connector completeness, and bidirectional full-row comparison
against a fresh exact-intersection source selection. It independently recomputes
the config SHA-256 and requires all three runtime values to match the verification
process, as well as matching the full DuckDB version/build output.
A report is not a digital signature or an
approval record. Keep original source bytes and reviewed code for independent
reproduction. Generated fixtures may be placed under ignored
`tmp/transport-geography/`; do not commit generated Parquet or reports.
The root research artifact `0063-lagos-overture-roads.parquet` is also explicitly
ignored by the shared `.gitignore`; its existing `.git/info/exclude` entry remains
unchanged. It is not used or modified by fixture tooling.

## Later production work

A separate authorized milestone must choose and document a real coverage bbox,
obtain and validate the production sources, handle scale, validate the complete
upstream schema, and produce an immutable package with **both** segment and
connector artifacts. Preserve ODbL obligations, OpenStreetMap contributor
attribution and copyright link, Overture attribution, and the Transportation
TomTom notice. This tooling retains these notices in fixture metadata but does
not perform a production license review.

0063 represents individual GeoParquet artifacts with one feature type per row;
the future packaging/registration design must explicitly account for both
artifacts and their exact hashes. This fixture report is not suitable for
registration. Do not add 0064, register a production dataset, or change the
0059/0060/0062 behavior as part of this tooling milestone.

DuckDB references: [CLI arguments](https://duckdb.org/docs/current/clients/cli/arguments),
[extension security](https://duckdb.org/docs/current/operations_manual/securing_duckdb/securing_extensions),
[Parquet metadata](https://duckdb.org/docs/current/data/parquet/metadata).
