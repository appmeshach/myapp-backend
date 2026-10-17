# 0096 trusted shared-segment geographic assessment

Development-only implementation on `feature/0092-shared-segment-suitability`, starting at `1362bf2a83de6347f85fb00112ef79bda8405e76`. No deployment or provider request. We do not create journeys; we connect journeys that were already going to happen.

## Semantic contract

The strongest verdict is `geometric_corridor_support`: “These trusted reference geometries support a continuous, same-direction geometric corridor under the assessment algorithm.” Every result and persisted row retains `authorizesAdmission=false`, `confirmsUsableSharedSegment=false`, and `roadTopologyVerified=false`.

Close parallel paths, frontage roads, separate carriageways and stacked roads can have supporting 2D geometry. This does not establish road identity, traversability, connectivity, legal stopping/access, pickup/dropoff, requester driving or intended travel, timing coordination, or human agreement. Synthetic Lagos scenario labels are product illustrations, not claims about real road topology.

No support on the requester reference route returns `inconclusive / no_positive_support_on_reference_route`; `alternativeCorridors=unassessed`. Public transport, walking, keke, another Movement leg, and another plausible road route remain unassessed. This never means incompatible or ineligible and has no discovery or admission effect. Reverse-only support is inconclusive with `reverse_direction_only`. Short support is `overlap_observed / below_positive_support_standard`; material traversal ambiguity is `overlap_observed / ambiguous_traversal`.

Input state (`ready`, `evidence_unavailable`, `evidence_stale`, `evidence_invalid`), assessment state (`not_run`, `assessment_unavailable`, `complete`), and nullable geographic result are separate dimensions. Processing failure has no geographic verdict. The producer binds the running TypeScript `algorithm_version` and SHA-256 parameter fingerprint to the canonical database snapshot before touching geometry.

## Frozen algorithm

Version: `shared_segment_geographic_assessment_v1`. Changes to parameters, numerical model, correspondence, ambiguity, continuity, processing rules or rounding require a new version.

| Parameter | Value |
|---|---:|
| Global sampling stations | 5 m |
| Geometric correspondence envelope | 5 m |
| Minimum supported length in one continuous chain | 100 m on each reference |
| Maximum local heading difference | 45 degrees |
| Maximum unsupported position gap on each reference | 15 m |
| Original coordinates per route | 2,000 |
| Resampled points per route, including retained turns | 20,000 |
| Candidate/index/ambiguity/chain work units | 1,000,000 |
| Persisted correspondence intervals | 20,000 |
| Spherical Earth radius | 6,371,008.8 m |
| Numerical position epsilon | 0.0000001 m |
| Output precision | 6 decimal places |

The 5 m envelope is a geometric distance, not a detour, walking, pickup or road-width threshold. The 15 m gap rule is internal continuity, not access or a physical-road-gap authorization. No route-fraction gate exists. Fractions describe stored reference geometries, not actual intended travel.

The production algorithm is separate from the advisory prototype. It validates normalized finite two-dimensional LineStrings, preserves cumulative double precision positions, removes exactly duplicate vertices, and interpolates spherical arcs at 5 m global stations. It also retains original turn vertices, so no sample segment crosses an original turn. Ambiguous antipodal arcs and degenerate routes are invalid. No geometry is simplified to fit an envelope.

Short resampled segments are represented as Earth-centered 3D chords. A 5 m spatial hash indexes target chord boxes. Expanded source boxes identify deterministic candidate segment IDs, avoiding a whole-route Cartesian comparison. For every candidate, affine projection clips source position to the target segment and analytically clips the full correspondence portion to the 5 m tube. All alternatives are retained. This is the frozen spherical-arc/ECEF-chord numerical model; it does not model terrain or road levels.

Local tangent direction is checked at correspondence endpoints and midpoint, with a conservative angular variation bound from both segment lengths covering the intervening portion. Heading agreement additionally requires increasing target positions. Positive chains progress monotonically on both references. Unsupported gaps above 15 m on either axis split chains. One chain must have at least 100 m of actual supported interval union on both axes. Independent shorter chains cannot combine into a positive certificate across a long gap.

Ambiguity sweeps run on both route-position axes. Overlapping support with alternative corresponding positions more than 15 m apart is materially ambiguous under v1. This detects repeated offerer or requester traversal; separated support intervals alone are not ambiguity. Certification fails conservatively without discarding the observations.

Supported lengths are unions on each reference, not sums of reciprocal observations. Canonical intervals carry deterministic chain IDs and preserve the actual supported pieces, including holes inside an allowed continuity gap. Fractions remain bounded by one. All correspondence, continuity and positive decisions precede output rounding.

Work counts include grid inserts/lookups, bucket visits, candidate evaluation, active ambiguity checks/comparisons and chain predecessor checks. Resampling and sorting are separately bounded by point/interval caps. Limit exhaustion returns `assessment_unavailable / processing_limit`, never geographical incompatibility. Index storage, candidates, active ambiguity sets and result storage all have finite bounds. No claim lease is introduced.

`processing_limit` is a deterministic result of the frozen v1 envelope and may be persisted. Unexpected `calculation_failed` results are transient: orchestration returns them with `publication = null`, and SQL rejects them if a service caller attempts direct publication. The same canonical pair can therefore be retried after a healthy runtime resumes.

Need `discoverable` and intent `current` remain producer current-use gates required by the trusted snapshot contract. Roster freeze is an operational admission lifecycle event, so it is not part of geographic snapshot readiness or identity. Consumers that use an assessment for admission must enforce roster lifecycle themselves. A geometric assessment already persisted before any lifecycle transition remains immutable historical evidence until its recorded expiry; the transition does not change its geometric meaning.

## SQL authorization and immutable evidence

Table: `private.shared_segment_geographic_assessments`.

Columns bind assessment UUID, exact offerer/requester evidence IDs and versions, offerer intent/requester need IDs and both member IDs, algorithm version, SHA-256 parameter/input fingerprints, canonical context/result JSONB, three immutable false authority flags, database-generated publication/creation times, and current-use expiry. Canonical result JSON contains separate states, reasons, lengths/fractions, bounded intervals, direction/ambiguity diagnostics, point counts and work count. Neither route geometry, capacity, financial state, priority score nor opaque compatibility score is duplicated.

The UNIQUE identity is `(offerer_route_evidence_id, requester_route_evidence_id, algorithm_version, input_context_fingerprint)`. Historical rows cannot be updated or deleted. RLS is enabled with no policies. Anon, authenticated and service roles have no direct table privilege. The two public-schema RPCs are service-only SECURITY DEFINER functions with empty search paths:

- `get_shared_segment_geographic_assessment_context_for_server(uuid,uuid,uuid,uuid)`
- `publish_shared_segment_geographic_assessment_for_server(uuid,uuid,uuid,uuid,jsonb,jsonb)`

The reader uses UTC for canonical timestamp serialization, independent of session timezone. It verifies exact requester/offerer membership, current-use status, bound trusted resolved endpoint references, route currentness and expiry, geometry structure and the explicit provider/schema allowlist. The allowed stored provider contract is `mapbox-directions-v5 / mapbox-directions / v5-driving-geojson-full-v1`, with distinct semantic schemas `requester_route_evidence_v1` and `offering_route_evidence_v1`, and shape format `geojson_linestring_v1`. No provider is invoked.

Missing or unauthorized pair contexts return the same unavailable structure without geometry, context fingerprints or dependency IDs. These are internal RPCs; no participant endpoint is installed. Runtime failures expose a generic error and do not log coordinates or raw responses.

Canonical context includes exact pair identities, parent versions/statuses/departure fields, evidence metadata excluding geometry, trusted endpoint identities/provenance/coordinates/expiries, algorithm and parameter fingerprint, and derived horizon. The input fingerprint is SHA-256 of PostgreSQL canonical JSONB text. Evidence IDs bind immutable source geometry. Hash equality alone is insufficient: publication/reuse also compares complete canonical context fields and complete canonical result facts.

The parameter fingerprint hashes an exact frozen ordered JSON serialization shared by SQL and TypeScript; tests compare its bytes and SHA-256. Timestamps of computation/publication are outside canonical result equality. `generated_at` records the authoritative database publication time.

## Expiry and concurrency

Current-use expiry is the earliest applicable finite value of both route expiries, four endpoint expiries, intent expiry, requester `COALESCE(latest_departure_at, earliest_departure_at)`, and offerer earliest departure, matching the existing pre-departure contract. There is no arbitrary TTL, seat-count dependency or interest dependency. Historical facts remain preserved after expiry; later consumers must revalidate current use and roster lifecycle.

Lock hierarchy: requester need UPDATE lock, requester bindings/references, offerer intent UPDATE lock, offerer bindings/references, offerer route evidence, requester route evidence, assessment insert/read. The offerer parent/context is pre-owned before invoking its older evidence-first assertion. Requester generation uses the same requester parent boundary. Both RPCs require READ COMMITTED.

The internal producer calls the reader, computes TypeScript outside the completed RPC transaction, and calls publication in a new transaction. Publication obtains the same dependency locks and rebuilds the canonical context. Changed IDs, versions, endpoint bindings, status, provider contract, temporal fields or horizon reject the old result. Time is checked again after validation and insertion/conflict waits.

Concurrent workers may duplicate local computation. One immutable insert wins; conflict handling performs a separate fresh READ COMMITTED SELECT, compares context and result, and fails closed on differing facts. A lost response is recovered by repeating publication with the exact context/result; no row is overwritten. Crash before publication leaves no row. Tests include actual parent and UNIQUE-index waits with independent PostgreSQL sessions.

SQL validates bounded canonical output, interval unions/fractions, forward chain continuity, and a qualifying positive chain. It does not compute route geometry. The aggregate output-rounding validation allowance is derived from 20,000 intervals times one micrometre; positive decisions remain based on unrounded TypeScript lengths. SQL chain validation uses one-micrometre representation tolerance.

## Manifest

New files:

- `supabase/migrations/0096_trusted_shared_segment_geographic_assessment.sql`
- `supabase/functions/_shared/shared-segment-assessment-contracts.ts`
- `supabase/functions/_shared/shared-segment-assessment-geometry.ts`
- `supabase/functions/_shared/shared-segment-assessment-runtime.ts`
- `supabase/functions/_shared/shared-segment-assessment-orchestration.ts`
- `supabase/tests/0096_trusted_shared_segment_geographic_assessment_test.sql`
- `supabase/tests/0096_trusted_shared_segment_geographic_assessment.test.cjs`
- `supabase/tests/0096_trusted_shared_segment_geographic_assessment_harness.cjs`
- `supabase/tests/0096_trusted_shared_segment_geographic_assessment_concurrency.cjs`
- `supabase/tests/0096_trusted_shared_segment_geographic_assessment_reset.cjs`
- `supabase/tests/0096_trusted_shared_segment_geographic_assessment_validation.cjs`
- `docs/0096-trusted-shared-segment-geographic-assessment.md`

Existing changes: `supabase/tests/movement_context.test.cjs` adds exactly the sanctioned 0096 private context consumer; `supabase/tests/0048_offerer_interest_inbox.test.cjs` strips that exact addition before comparing the retained historical SHA-256 pin; `tests/migrationNumbering.test.cjs` advances the sequence/count to 0096 while retaining its historical hashes. No historical migration or existing production module changes.

## Validation

Final local verification on 2026-10-11 (Pacific time):

| Check | Result |
|---|---|
| 0096 focused SQL | 8/8 schema/security checks and 34/34 behavior checks; direct transient failure rejection and healthy retry included |
| 0096 genuine concurrency | 12/12 checks; actual parent and UNIQUE waits; zero deadlocks |
| Production geometry | 30/30 tests, including all coordinate/sample/work envelopes |
| Runtime/orchestration/lifecycle boundary | 12/12 tests, including both contract mismatches, transient retry and deterministic limit publication |
| Parameter/integrity tests | 2/2; total new Node tests 44/44 |
| Advisory prototype regression | 36/36 across the four existing advisory/projection/overlap suites |
| 0092 / 0093 / 0094 SQL | 24/24 / 49/49 / 26/26 |
| 0093 / 0094 concurrency | 16/16 / 9/9 |
| 0095 / original 0052 SQL | 13/13 / 25/25 |
| 0095 deadline concurrency | 7/7 |
| Offerer 0031 / 0032 / 0033 SQL | 15/15 / 56/56 / 29/29 |
| Route-match 0037 / 0038 SQL | 25/25 / 16/16 with current trusted endpoint provenance |
| 0089 priority behavior / concurrency | 75 assertions; 8 scenarios / 19 read assertions; zero deadlocks |
| 0089 regression | 86 inbox, 52 continuation, 34 reputation, 203 legacy assertions and generic completion/review exclusions |
| 0090 requester priority | 89 behavior assertions; 11 concurrency scenarios, six blocking and six lock-release proofs; zero deadlocks |
| 0091 roster | 99 behavior assertions; 22 concurrency scenarios / 18 blocking / six continuation proofs; 17 temporal assertions; zero deadlocks |
| Full Supabase Node | 64 files; 1,096 pass, zero failures/skips |
| Full root Node | 47 files; 957 tests, 956 pass, one existing optional extract integration skip, zero failures |
| App / Edge typecheck | Both exit 0 after final production changes |
| Fresh local reset | Exit 0; migrations 0001–0096 applied after platform bootstrap; application migration history 96 / 0001 / 0096 |
| Installed source/security | Exact five 0096 function bodies, owners, ACLs, search paths, UTC reader configuration, RLS/no policies verified; exact current 0089–0095 source also verified by composed harnesses |
| Historical integrity | All 95 historical migrations equal HEAD modulo CRLF/LF; original pinned historical hashes retained |
| Application fingerprints | Unchanged after every completed disposable harness; positive/negative publication also leaves every other public/private application table unchanged |
| git diff --check | Exit 0; branch and HEAD unchanged |

Integration runners are inert on import, use local Docker only, create schema-only disposable databases, and verify the original application data/catalog/ACL/RLS/history fingerprint before and after. Legacy route-match fixtures are supplied with current production-selected/resolved/state endpoint provenance; their original assertions remain intact. Priority/roster composition retains the existing current-schema harness adaptations without replacing production functions with old implementations.

Concurrent public workers serialize at the requester parent and exercise deterministic UNIQUE conflict recovery. The separate insert-only administrator fixture sessions hold compatible FK locks, proving an actual canonical-table UNIQUE wait followed by a fresh statement/read and service recovery. No constraint or production guard is disabled. Thirty-second future declarations in the new expiry fixtures provide time to establish real blocking under local test load; these are fixture horizons, not a lease or production TTL. The earlier eight-second fixture ran out of setup time during parallel regression load and was replaced with these future declarations; the production expiry rules were not changed.

The full suites initially identified the exact sanctioned-consumer allowlist and migration-count guards that needed advancing. Their historical protection remains intact: only the exact 0096 addition is stripped before checking the existing consumer hash. A chain-validation variable-name ambiguity found by focused SQL was corrected before final successful SQL/concurrency/reset verification. Initial reset attempts exposed local CLI path/TLS and platform-bootstrap requirements; the final Auth/Storage bootstrap reset succeeded and preserved application fingerprints.

Exact final `git status --short`:

```text
 M supabase/tests/0048_offerer_interest_inbox.test.cjs
 M supabase/tests/movement_context.test.cjs
 M tests/migrationNumbering.test.cjs
?? docs/0096-trusted-shared-segment-geographic-assessment.md
?? supabase/functions/_shared/shared-segment-assessment-contracts.ts
?? supabase/functions/_shared/shared-segment-assessment-geometry.ts
?? supabase/functions/_shared/shared-segment-assessment-orchestration.ts
?? supabase/functions/_shared/shared-segment-assessment-runtime.ts
?? supabase/migrations/0096_trusted_shared_segment_geographic_assessment.sql
?? supabase/tests/0096_trusted_shared_segment_geographic_assessment.test.cjs
?? supabase/tests/0096_trusted_shared_segment_geographic_assessment_concurrency.cjs
?? supabase/tests/0096_trusted_shared_segment_geographic_assessment_harness.cjs
?? supabase/tests/0096_trusted_shared_segment_geographic_assessment_reset.cjs
?? supabase/tests/0096_trusted_shared_segment_geographic_assessment_test.sql
?? supabase/tests/0096_trusted_shared_segment_geographic_assessment_validation.cjs
```

The reset runner targets only a disposable local clone at loopback port 55432. Because CLI `--db-url` reset removes platform schemas, a temporary schema-only Auth/Storage bootstrap initializes those platform schemas before the unchanged application migrations 0001–0096. It copies no user/application rows, omits application policies/triggers rebuilt by migrations and owner-specific default ACL statements, and removes its temporary workdir. The original application database and tracked config are preserved. CLI calls this generic URL mode “remote”; its target is explicitly the local disposable database, never a linked project.

## Cost and deferred work

New vendor: none. New Mapbox use per assessment/candidate pair: none. This consumes local/Supabase/Edge CPU, database execution and historical storage; it is not free. Reuse limits repeated calculation for identical trusted evidence/context/version identities. Scaling is distinct offerer/requester evidence pairs × geometry complexity × algorithm versions; historical storage grows with persisted pair/version/context assessments.

Optional later work includes further spatial optimization, background precomputation, claim leases if measurements justify them, and separately reviewed topology data. Discovery in both directions, received offers and later admission may reuse this same identity and algorithm. No discovery filtering, interests, offers, acceptance, mutual selection, capacity reservation, activation, journeys, finances, recommendations or priority-engine terms/orderings are changed. Admission and topology verification remain separate future milestones.

No staging, commit, push, deployment, production database access or live provider call occurred.
