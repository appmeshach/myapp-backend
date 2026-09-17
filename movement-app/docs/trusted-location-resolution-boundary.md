# 0026 Trusted location resolution boundary

0026 records a normalized trusted-server result for an existing member-owned
unresolved location. It creates a new resolved reference and immutable evidence
linking the original declaration to that reference. It never changes the original
declaration, existing intent endpoints, or existing route evidence.

A label such as Ologolo, a landmark or a business needs no flexible/specific flag.
Exact coordinates and provider identifiers remain private. The RPC does not prove
geographic truth: the eventual server adapter must authenticate and normalize
provider output before calling it. A service credential must never be exposed to
clients or used to forward untrusted client coordinates as authoritative output.

## Storage

Exactly one new table, `private.movement_location_resolution_evidence`:

| Column | Contract |
| --- | --- |
| id | Generated UUID primary key |
| source_location_reference_id | Required immutable declaration FK, DELETE RESTRICT |
| resolved_location_reference_id | Required unique new resolved-reference FK, DELETE RESTRICT |
| version | Positive integer, unique per source |
| producer_request_id | Globally unique trusted-server request UUID |
| provider_product, provider_version | Required trimmed nonblank strings, at most 100 characters |
| resolution_schema_version | Fixed `movement_location_resolution_v1` |
| requested_expires_at | Original optional finite caller deadline, retained for exact replay |
| recorded_at | Finite database recording time |

Source and target IDs must differ. UPDATE (including no-op UPDATE) and DELETE are
always rejected. There is no status column or latest/current lifecycle. A new
resolution appends another version; it does not invalidate earlier unexpired
references. The same provider place may legitimately resolve different sources.

Coordinates, namespace, place reference, resolution version, resolution time,
owner, label and effective expiry live only on the new
`private.movement_location_references` row. Existing 0022 constraints and its
protection trigger remain active without modification. A private assertion and
an immediate AFTER INSERT trigger validate the evidence/target relationship.
No new deferred trigger is introduced, so multiple versions in one transaction
do not conflict with later historical supersession checks.

## RPC

```sql
public.record_location_resolution_for_server(
  p_source_location_reference_id uuid,
  p_producer_request_id uuid,
  p_provider_namespace text,
  p_provider_product text,
  p_provider_version text,
  p_provider_place_reference text,
  p_resolution_version text,
  p_latitude numeric,
  p_longitude numeric,
  p_resolved_at timestamptz,
  p_expires_at timestamptz DEFAULT NULL
)
```

Returns only `evidence_id uuid`, `resolved_location_reference_id uuid`,
`version integer`, and `expires_at timestamptz`.

The database derives owner and declared label from the source; generated IDs,
recording time, `provider_resolved`/`resolved`, evidence version, schema identifier
and effective expiry are not caller-selected. The new target creation time equals
the evidence recording time, sampled from `clock_timestamp()`.

Required inputs reject NULL. Numeric coordinates must be finite and within
latitude -90..90 and longitude -180..180, inclusive; NaN and infinities are
explicitly rejected. Provider strings reject empty, whitespace-only, untrimmed
and oversized values. Place references allow 500 characters; other provenance
strings allow 100.

## Source, hints and time

Source must exist, remain unresolved with member_declared/member_selected kind,
have no coordinates/resolution timestamp/version, and be unexpired. Any existing
provider namespace/place-reference pair is only a selection hint. When present,
both values must exactly match the trusted output. This rule applies regardless
of which eligible source kind holds the pair. Cross-provider translation is not
silently permitted. The new row carries the trusted resolution separately.

Resolution time must be finite, at or after source creation and no later than a
fresh database clock. Requested expiry must be finite and in the future.
Effective expiry is `LEAST(p_expires_at, source.expires_at)`: PostgreSQL ignores
NULL arguments; two NULLs intentionally mean no deadline. The deadline is checked
again against fresh target creation time and by final authoritative validation.

An exact retry reruns authoritative source/target eligibility after lock waits.
An expired source or target cannot be returned as eligible. Expiration never
mutates stored history. Provider retention and licensing deadlines must eventually
be normalized by the server adapter; 0026 introduces no provider policy.

## Idempotency and concurrency

An exact request replay returns the original IDs, version and effective expiry.
Changed source, namespace, product/version, place, resolution version,
coordinates, resolution time or original requested expiry fails with 23514.
Two requested expiries that clamp to the same effective expiry are still different
payloads. A new request UUID creates a new target and the next source version.

The writer requires READ COMMITTED. It locks the source FOR UPDATE before source
eligibility, request lookup or MAX(version)+1. Same-source calls serialize. The
assertion reads immutable evidence identity then locks source -> target; retries
follow that same source -> target order and sample time after all waits. There
are no offering-intent locks or advisory locks in this RPC. Callers handling
multiple sources in a transaction must acquire them in consistent UUID order and
retry whole transactions after deadlocks.

Unique request IDs arbitrate concurrent first calls across different sources. A
loser may receive 23505; sequential changed-payload replay receives 23514. The
writer does not catch uniqueness errors: normal statement atomicity rolls back
both inserts, including a target inserted before an evidence constraint failure.
Privileged administrator writes must follow the same lock ordering.

## Privileges and scope

The table has RLS and no client policies. PUBLIC, anon and authenticated have no
access; service_role has SELECT only and no INSERT/UPDATE/DELETE/TRUNCATE grant.
Existing location-table privileges are unchanged. Only service_role receives
EXECUTE on the public RPC. All four functions are SECURITY DEFINER with empty
search_path, and all private helpers revoke EXECUTE from application roles.
Database owners remain trusted administrators.

No provider is selected, no secrets or HTTP calls are added, and no exact-location
projection or coordinate logging is introduced. There are no matching, detour,
pricing, payment, alignment, journey or chat changes.

0025 is unchanged and still needs intent endpoints already bound to resolved
references. An unresolved-bound intent does not become routable through 0026.
Declaration intake/authenticated ownership establishment and intent construction
or replacement belong to the separately reviewed 0027 boundary. New intent
versions must still satisfy 0024's departure horizon. Provider adapters, licensing
implementation, cross-provider translation and client exposure remain deferred.

## Verification and limits

Run `node supabase/tests/trusted_location_resolution.test.cjs`, the 0022-0025
static suites, and both typechecks. Static tests inspect source; they are not a
PostgreSQL parser and do not execute any database statements.

The rollback-only SQL test defines 69 named checks: 27 fixed checks, 2 role-denial
checks, 2 table-privilege checks, 10 replay-field checks, 2 selected-hint mismatch
checks, and 26 invalid-input/no-orphan checks. It also includes successful retries,
new versions, derived owner/label, target-only coordinate/provenance storage,
unchanged source/endpoint/history, expiry clamping, NULL deadlines, immutable
evidence and existing 0022 protection. It forces the fixture intent's deferred
constraints before reporting results. Inspect the aggregate failure count and
every named result, even when the SQL client reports successful execution.

Persisted-source expiry, persisted-target expiry on retry and concurrent lock-wait
expiry still require an explicitly authorized database experiment with genuine
elapsed time and separate sessions. Already-expired references cannot be inserted
as fixtures under the existing 0022 trigger, nor can their deadlines be rewritten.
The deterministic test does not bypass these protections or use sleeps to pretend
it exercised concurrency. These paths have static guards but are not claimed as
executed behavioral coverage.

The SQL test rolls back fixtures and temporary helpers when run against an
installed 0026 schema; it does not remove previously installed migration objects.
An installation rollback experiment must strip only the migration/test top-level
wrappers, establish READ COMMITTED before installation, and wrap both in one
outer transaction ending in ROLLBACK. Do not include the migration COMMIT in that
bundle. No installation bundle or database execution is part of this local work.
