# 0098 current route-match reuse and replay recovery

Baseline: `3a09bb914cf9e16c36e34311329fdc9feedca94f`, branch `feature/0092-shared-segment-suitability`. This is a local component change; no deployment or production verification is implied.

The effective 0082 route-match writer keys replay by movement need, exact offering route evidence and algorithm. It compares requester/offerer/endpoint/intent/version bindings, every geometry fact, route order, calculated_at and derived expiry. The HTTP handler formerly recalculated and created a fresh calculatedAt on every request. An unchanged second request could therefore fail strict replay. Historical migrations and the writer are preserved.

## Internal boundaries

Migration `0098_current_route_match_reuse_boundary.sql` adds two service-only SECURITY DEFINER functions with an empty search_path and postgres ownership:

- `get_current_requester_availability_route_match_for_server(p_verified_member_id uuid, p_movement_need_id uuid, p_availability_id uuid, p_expected_payload jsonb DEFAULT NULL) RETURNS jsonb`
- `publish_requester_availability_route_match_for_server(p_verified_member_id uuid, p_movement_need_id uuid, p_availability_id uuid, p_expected_identity jsonb, p_payload jsonb) RETURNS jsonb`

Both revoke PUBLIC, anon and authenticated execution. Neither adds tables, policies, claims, leases or participant APIs. The lookup resolves private intent/member/route identifiers through 0046 and retains its READ COMMITTED and established need → requester endpoints → intent → route → availability → vehicle/access lock order. Current route-match locking follows those existing locks. No SQL transaction remains open during TypeScript geometry.

The internal context identity contains requester, need, selected availability, requester origin/destination reference IDs, offering intent/member/version and offering route evidence ID/version. A hit additionally requires `trusted_route_match_evidence_v1`, `route_match_geometry_v1`, current status and unexpired evidence. Existing context and current-use assertions enforce trusted route contracts, endpoint provenance and binding, dependency expiry, requester effective departure deadline, same-state, lifecycle, roster eligibility, group fit and vehicle access. The lookup is an exact current-use check, not a latest-row query. Historical and stale rows remain historical.

Only the server receives the canonical geometry payload needed for recovery. Client output remains exactly state, routeMatchEvidenceId, routeMatchEvidenceVersion, routeMatchEvidenceStatus, routeMatchEvidenceExpiresAt and straightLineDistanceFromRouteMeters. Destination distances, coordinates, geometry, private intent/member IDs and context remain internal. The app service parser, screen, Edge entry point and config are unchanged.

## Request and recovery behavior

After JWT/member validation and existing selected-availability authorization, a validated hit returns the same persisted public result: zero geometry, zero timestamp creation, zero publication. A failed lookup is not a miss.

A miss calculates once, creates calculatedAt once and freezes the publication payload and its coordinate objects. The publication wrapper revalidates the selected context under 0046 before using the unchanged writer. It checks the resulting canonical JSON before commit, rejecting extra keys and lossy coercion atomically.

If a current row appears while geometry runs, publication may reuse it only when identity and every geometry fact match. The winner's timestamp remains authoritative. This is validated current-row reuse; it does not submit a different timestamp to the historical writer or relax writer replay comparison.

An exception, missing result or mismatching publication result permits one recovery lookup. Its optional expected-payload argument checks complete geometry facts, calculated_at and the writer's exact dependency-derived expiry in PostgreSQL before numeric/timestamp values cross JavaScript's precision boundary. The handler additionally requires the same context and complete frozen payload, including the caller's calculatedAt. Recovery performs no second calculation, timestamp creation or publication. PostgreSQL microseconds are retained during timestamp parsing so different sub-millisecond timestamps cannot collapse into an exact match. An uncertain concurrent response whose persisted winner has a different timestamp fails closed; a subsequent explicit request can use the normal validated hit path.

The legacy intent selector retains 0039 authorization (requester or offerer) and the historical writer path. It receives no requester-only reuse privileges. Its pre-existing fresh-timestamp replay behavior is outside this selected-availability milestone.

Expired or stale evidence produces no reuse. If the unchanged historical writer's unique replay identity is already occupied by stale or mismatching evidence, publication still fails closed; there is no force refresh or history rewrite.

## Scope and cost

No requester geographic-support UI, 0094 app invocation, 0097 production invocation, geographic-support endpoint, discovery change, priority input, interest authorization change, capacity reservation, admission/acceptance change, financial effect or provider call was added. Synthetic provider-shaped fixtures are local test data only.

Classification: REQUIRED before requester geographic-support integration. New vendor and Mapbox usage: NONE. Cost is one small current-evidence lookup per selected check; repeated hits avoid geometry CPU and writes. Publication performs additional authorization/lookup work to close races. Ambiguous recovery performs at most one additional read.

## Continuation and verification

Before interruption, migration, contracts, runtime, handler and test scaffolding existed. The 72 focused Node checks, full Supabase suite (1,191 passed), root suite (956 passed, one existing skip) and both typechecks had passed. SQL and concurrency fixtures, full regression completion, reset and documentation remained unfinished.

Continuation preserved that implementation, corrected fixture-only timestamp/status assumptions, reused established current-policy roster fixtures, added SQL-side numeric/derived-expiry comparison, microsecond recovery precision and atomic canonical-payload verification, completed explicit interest reuse and committed-write recovery tests, and removed temporary `.0098-build.cjs`. The sanctioned context-reader guard adds only the 0098 recovery dependency read and retains its original pinned fingerprint. All historical behavioral assertions and migrations were preserved.

Root's existing skip requires `DUCKDB_BIN` for its external DuckDB integration.

| Validation | Result |
| --- | --- |
| 0098 SQL security | 5/5 |
| 0098 SQL behavior | 22/22 |
| Real SQL-backed HTTP behavior | 5/5; repeat reuse, committed-write lost response, mismatching timestamp/geometry/context |
| 0098 genuine concurrency | 6/6; actual PostgreSQL blocking and wall-clock expiry; database deadlock counter zero |
| Route runtime/orchestration and new 0098 tests | 74/74 (38 existing runtime, 11 existing orchestration, 25 new) |
| Route-match foundation / effective writer replay | 25/25 / 16/16; exact replay accepted and changed timestamp/result rejected |
| 0046 / 0047 / 0049 SQL | 26/26 / 70/70 / 52/52 using established current-policy roster fixtures |
| 0052 / 0095 deadline SQL | 25/25 / 13/13 |
| 0092 / 0093 / 0094 SQL | 24/24 / 49/49 / 26/26 |
| 0093 generation concurrency | 16/16 |
| 0094 context / 0095 deadline concurrency | 9/9 / 7/7; unchanged assertions passed in isolated reruns |
| 0096 / 0097 security SQL | 8/8 / 6/6; unchanged geometry/runtime/orchestration regressions also included in full Node |
| Earlier route context / quota / claim SQL | 0031: 15/15; 0032: 56/56; 0033: 29/29 |
| 0089 priority | 75 behavior assertions; 8 concurrency scenarios / 19 read assertions; 203 legacy regression assertions; zero deadlocks |
| 0090 requester priority | 89 behavior assertions; 11 concurrency scenarios / 6 blocking proofs / 6 lock-release proofs; zero deadlocks |
| 0091 current-policy roster | 99 behavior assertions; 22 concurrency scenarios / 18 actual blocking proofs / 6 continuation proofs; 17 temporal assertions; zero deadlocks |
| Full Supabase Node | 66 files, 1,193 passed, zero failures/skips |
| Root Node | 47 files, 957 total, 956 passed, one existing skip, zero failures |
| App and Edge typechecks | Both exit 0; Edge repeated after precision hardening |
| Fresh local reset | All 98 migrations, 0001–0098, plus temporary platform bootstrap, applied in a disposable loopback database |
| Installed source/security | Both 0098 RPC bodies, owner, definer, empty search_path and service-only ACL verified; effective 0082 writer and 0046 authorization bodies unchanged; 0093–0097 and priority/roster sources checked by composed harnesses |
| Historical SQL | All 97 tracked migrations unchanged from baseline; numbering and pinned historical integrity tests passed |
| Application fingerprints | Original local data/catalog/ACL/RLS/history unchanged after disposable runs; 0098 publication changes only route-match evidence within its fixture |

The reset target is exclusively `postgresql://postgres:postgres@127.0.0.1:55432/requester0093_<random>?sslmode=disable`. The CLI's generic “remote” label for `--db-url` refers to that explicit loopback target, not a hosted project. Clone and temporary reset files are cleaned up under verified path/name constraints.

An initial historical 0094 concurrency run crossed its 15-second fixture deadline before the live blocking-barrier assertion under competing fixture load. Original assertions and source were retained for the isolated rerun. Initial 0098 fixture corrections addressed an invalid availability status and a calculated_at update newer than created_at; neither indicated a production guard failure. The installed-source checker normalizes checkout CRLF only; it does not normalize SQL logic.

## Final changed-file manifest

Modified:

- `docs/MOVEMENT_LAUNCH_READINESS_REGISTER.md`
- `docs/MOVEMENT_SYSTEM_SPEC.md`
- `supabase/functions/_shared/route-contracts.ts`
- `supabase/functions/_shared/route-match-orchestration.ts`
- `supabase/functions/_shared/route-runtime.ts`
- `supabase/tests/0048_offerer_interest_inbox.test.cjs`
- `supabase/tests/movement_context.test.cjs`
- `supabase/tests/route_match_orchestration.test.mjs`
- `tests/migrationNumbering.test.cjs`

Created:

- `docs/0098-current-route-match-reuse-boundary.md`
- `supabase/migrations/0098_current_route_match_reuse_boundary.sql`
- `supabase/tests/0098_current_route_match_reuse_boundary.test.cjs`
- `supabase/tests/0098_current_route_match_reuse_boundary_concurrency.cjs`
- `supabase/tests/0098_current_route_match_reuse_boundary_harness.cjs`
- `supabase/tests/0098_current_route_match_reuse_boundary_reset.cjs`
- `supabase/tests/0098_current_route_match_reuse_boundary_test.sql`
- `supabase/tests/0098_current_route_match_reuse_boundary_validation.cjs`

Final `git diff --check` passes. The index is empty and HEAD remains the baseline. Temporary `.0098-build.cjs` was removed; no other temporary scaffolding is in the manifest. No stage, commit, push, deploy, production access or provider request occurred. App source, client response parser, `supabase/config.toml`, historical migrations and 0096/0097 production call paths are unchanged.
