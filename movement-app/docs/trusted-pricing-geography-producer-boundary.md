# Trusted pricing-geography producer boundary (0060)

WE DO NOT CREATE JOURNEYS.

0059 is immutable private evidence storage and validation. 0060 is a trusted recording boundary for normalized classifier output. A later classifier/runtime must actually determine the shared qualifying major-road corridor, distance, meaningful mapped stages, core-stage entries and major transport transitions. Later Pricing Policy v1 converts geography into money; a still later issuer handles financial proposals. Neither classifier nor policy nor financial integration is implemented here.

## RPC and authority

```sql
public.record_pricing_geography_evidence_for_server(
  p_route_match_evidence_id uuid,
  p_expected_route_match_evidence_version integer,
  p_expected_route_evidence_id uuid,
  p_expected_route_evidence_version integer,
  p_pricing_corridor_distance_meters bigint,
  p_geographic_events jsonb,
  p_classifier_name text,
  p_classifier_version text,
  p_transport_geography_version text
)
```

Returns only pricing-geography evidence ID, version, status and expiry. SECURITY DEFINER with an empty search path; PUBLIC, anon and authenticated cannot execute. Service role is the only operational caller. Existing 0059 RLS and service SELECT-only table privileges remain unchanged; no direct mutation permission or client projection is added. The backend must never expose this RPC as an unvalidated client payload proxy.

PostgreSQL derives need, members, intent/version, match/version, route/version and authoritative state anchor from the exact trusted match. It derives schema version, next evidence version, current status, IDs, timestamps, expiry and support flag. The submitted exact match/route identities and versions must agree; the function never searches for a newer source to substitute.

Support is exactly distance <= 100,000 integer metres. 100,001 metres remains stored unchanged and unsupported. A classifier's 12,000 metre corridor is preserved even if the provider's full route is 15,000 metres. These distances describe different facts. PostgreSQL bigint input syntax rejects fractional text; ordinary PostgreSQL numeric-to-bigint casts can round before this function receives an argument, so the future runtime must validate integer input before coercion.

The event array is passed to 0059's exact validator. Only `core_stage_entry` and `major_transport_transition` with integral, ordered corridor-relative positions are accepted. Empty events mean continuous corridor; `continuous_corridor` is not an event. Extra keys, money, weights, labels, geometry and arbitrary payloads are rejected. This validates structure, not geographic truth.

## Time, replay and versioning

No caller-supplied timestamps or expiry are needed. Expiry is the earlier of the locked need's effective departure deadline and the exact match expiry, ignoring a null match expiry. The inherited validator checks all underlying bounds and live eligibility. `generated_at` and `created_at` represent database recording of this normalized evidence, not an assertion about when a future classifier computed it. Exact source selectors prevent late results from rebinding to changed sources.

Replay identity is `(exact match ID, classifier name, classifier version, transport-geography dataset version)`. Within that identity the entire normalized payload and authoritative bindings must agree. Exact live retries return the same ID/version and original timestamps/expiry. Changed distance or events fail closed. Terminal or expired evidence, or stale upstream context, cannot be retried into a new current row. Ambiguous pre-existing owner-created replay history fails closed.

A different exact source or classifier/dataset identity is a new classification: allocate max historical version + 1 for the canonical need/intent, supersede its current pricing evidence, and insert the new immutable result atomically. A failed insertion rolls the supersession back. Provenance is not a classifier approval registry: service code must enforce approved names/releases later. Intentional semantic changes require a new versioned provenance identity; callers cannot correct payloads under an old identity. This is deliberately not a general request-ID/upsert API.

## Lock order and live use

READ COMMITTED is mandatory. A preliminary match read discovers the immutable need ID without locking the match. The writer locks need FOR UPDATE, rereads the exact match and verifies expected selectors. 0059's context assertion supplies authoritative requester-endpoints -> intent -> route -> match locking and 0050/0052 eligibility checks. Only then does it lock pricing history in version order. It rechecks context after any history-row wait, then either live-validates a replay or inserts and live-validates the new row. Fresh checks use clock_timestamp. No reverse match-first or pricing-first dependency lock path is introduced.

The need lock serializes producer calls, version allocation and supersession. The foundation's partial unique index still enforces one stored-current row. Consumers must use the live assertion in their own transaction: source changes do not automatically rewrite the historical pricing row's stored status. Single-session SQL tests do not constitute a new two-session proof of 0060; the 0059 lock-order tests remain relevant precedent.

0060 writes pricing evidence only. It does not change route/match evidence, movement offers, alignments, journeys, capacity, activation, fees, proposals, agreements, payments, settlement or completion. There are no external calls, map/provider runtime, dispatch, client changes or monetary calculations.

## Future classifier decisions

The classifier criteria remain unresolved and require separate review before implementation:

- Use deterministic map/network data, not AI intuition; select approved datasets and release governance.
- Avoid hard-coded Lagos-specific universal geography logic. Locality/neighborhood labels alone are insufficient.
- Collapse adjacent/continuous urban localities; every named town passed must not become a chargeable stage.
- Re-entering the same stage must not automatically duplicate an event. Decide stage identity and traversal/deduplication rules above 0059's structural type/position checks.
- Require stronger structural geographic/network evidence for major transitions. Define thresholds and calibration criteria, with policy/versioned classification.
- Define the shared major-road corridor, excluding voluntary pickup/dropoff deviation, and deterministic integer-distance measurement/rounding.
- Same-state routes over 100 km remain structurally valid movement but unsupported by Pricing Policy v1 evidence support.
- Establish runtime authorization, approved classifier versions, replay discipline, compute-time audit requirements and an appropriate evidence TTL if tighter than source deadlines is needed. Those additions require separately reviewed contracts.

## Local validation

```powershell
node --test .\supabase\tests\trusted_pricing_geography_producer.test.cjs
node supabase/tests/trusted_pricing_geography_producer.test.cjs --print-rollback | docker exec -i supabase_db_movement-app psql -X -U postgres -d postgres -v ON_ERROR_STOP=1
```

The generated SQL batch requires installed 0059 and an absent 0060 producer. It installs 0060 inside the outer test transaction, builds trusted fixtures under active constraints, exercises real role access and rejection/replay paths, and finishes ROLLBACK. External snapshots prove prior data, definitions, privileges, RLS and migration history unchanged, and the producer absent afterward. The standalone behavioral SQL assumes transaction-local installation; use the generator above. No staging, commit, remote deployment or persistent 0060 installation is part of validation.

Local validation on 2026-09-29 passed 71 behavioral assertions with zero failures and both external rollback checks. Focused Node tests passed 14/14; the full repository Node suite passed 1,204/1,204, and TypeScript passed. No genuine 0059 defect was found. Migrations 0001–0059 remain unchanged. No two-session 0060 concurrency execution is claimed.
