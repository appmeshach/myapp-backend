# 0094 requester route provider generation

Development implementation only; not deployed. Mobile UI invocation, shared-segment comparison, and admission integration remain deferred. Historical migrations 0001–0093 are preserved.

## Meaning and scope

One private provider-derived automotive-road-network reference path between requester trusted endpoints is used only as compatibility support geometry. It does not prove intended driving, an intended/must-follow path, or the only possible journey. Non-overlap alone cannot establish definitive geographic incompatibility. Ordinary transport, keke, walking and other connecting legs remain possible. No priority equation, financial boundary, journey, reservation, admission or existing offerer workflow changes.

## Context and time authority

0094 adds only `public.get_claimed_requester_route_generation_context_for_server(uuid,uuid,uuid)`: READ COMMITTED, SECURITY DEFINER, empty search_path, service_role-only execution. It takes the established need → bindings → sorted trusted references → claim locks, then rechecks exact owner, incomplete token, endpoint bindings, contract and active lease. It returns nineteen fields: need/member; two reference IDs and four coordinates; schema/format and three provider identifiers; claimed_at, lease_expires_at, server_observed_at, earliest_generated_at, movement_need_deadline, evidence_expires_at. It creates no table and renews no claim.

Deadline is `COALESCE(latest_departure_at,earliest_departure_at)` from 0051/0052. Expiry is the earliest non-null endpoint expiry and that deadline; a null endpoint expiry does not remove the departure bound. No arbitrary route TTL. The context accepts structurally valid paused needs; Edge scheduling separately uses the existing authenticated `get_my_current_movement_need()` with the caller JWT and compares the exact need ID. This repository RPC selects the newest discoverable need with a future effective departure deadline.

Edge reads context again after the provider finishes. This both revalidates dependencies and supplies authoritative DB `server_observed_at` for `generated_at`, preserving full PostgreSQL timestamp precision. The route observation happens after provider completion, avoiding Edge clock skew. Expiry uses that context's exact bounded timestamp. The unchanged 0093 writer remains the publication authority and rechecks its claim/dependencies. There is no transaction spanning network work.

## Provider contract and validation

Existing Mapbox adapter: namespace `mapbox-directions-v5`, product `mapbox-directions`, version `v5-driving-geojson-full-v1`; driving profile, alternatives=false, geometries=geojson, overview=full, steps=false. No new vendor or provider fallback/retry. Snapped waypoints and point limits are opt-in so default offerer outputs remain unchanged. Response reading retains the 256 KiB bound and now cancels a stalled body on abort.

Require one valid route, usable response UUID-derived reference, positive safe integer metrics, finite/ranged nondegenerate LineString geometry, and exactly two finite/ranged provider snapped waypoints. First/last geometry points must be within 2 metres of the respective provider snapped waypoint. This is numerical representation equivalence only: trusted endpoint-to-snap displacement is never used as a detour, access, walking-distance or eligibility threshold.

At most 2,000 geometry points are accepted to bound CPU, payload and database validation work. Larger valid geometries report `unsupported_evidence`; no silent downsampling or definitive incompatibility inference. Existing provider response byte limits also fail closed.

## Edge sequence, quota and recovery

POST accepts only `{movementNeedId}`; authentication and membership, current-need scheduling, one 0093 claim acquisition, trusted context, shared 0032 quota admission, one provider attempt, validated result, second context read, immutable copied publication payload, claimed publication. Reuse and in-progress claims do not consume quota or invoke the provider. There is no per-candidate route generation loop or client-supplied coordinate/provider/member/token/expiry contract.

20-second overall bound, 5-second provider bound, 3-second reserved recovery, 2-second minimum initial publication budget, within the DB's fixed 30-second lease. Conservative remaining-lease arithmetic uses authoritative DB observation minus elapsed local monotonic time, including context request latency. Budget is checked before quota and again before provider work. Await races discard late/uncooperative results; a timed-out provider cannot publish.

Quota reuses `consume_route_provider_quota_for_server` through the existing backend adapter: 10/minute UTC and 100/day UTC per member, shared with offerer route generation. No quota namespace, table or allowance expansion. Quota admission can be spent even if a later provider/publication failure prevents evidence creation.

After uncertain publication, replay the same frozen payload and exact token once within remaining recovery time. Never claim again, regenerate geometry or retimestamp that payload. Exact completed replay can resolve a lost response; unresolved uncertainty returns safely unavailable. This prevents duplicate work within a claimed attempt, not global exactly-once provider billing. Lease expiry can legitimately allow another paid attempt.

API returns only safe `{state}` / `{state,retryAfterSeconds}` with private/no-store headers: generated, reuse_existing, in_progress, route_rate_limited, unsupported_evidence, or generic failures. Coordinates, route geometry, tokens, member IDs, provider references, evidence IDs/versions and database/provider errors stay server-internal. JWT verification remains enabled in function configuration. No mobile client wiring yet.

## Cost ledger

Classification: REQUIRED for this chosen provider-backed requester-route evidence model. New vendor: none. Provider: existing Mapbox integration. Billing/scaling: usage-based Directions requests. Growth unit: requester movement needs genuinely needing fresh evidence, plus legitimate regeneration after expiry, contract changes or failure; not candidate matches. Fresh compatible evidence is reused across comparisons. Repeated failed attempts after claim expiry can add paid usage, currently bounded by the shared route quota. No live price is asserted.

## Validation

Local schema-only disposable harnesses reuse 0093's application data/catalog/ACL/RLS/history fingerprint guard and verify installed function bodies, owners and security configuration against current sources. Genuine concurrency tests use independent PostgreSQL sessions, `pg_blocking_pids` barriers and real server lease/endpoint/departure expiry, without modifying clocks or weakening triggers. Node provider tests use mock transport only. Final fresh-reset results are recorded below after execution.

Final local run on 2026-10-10 (Pacific time):

| Check | Result |
|---|---|
| Fresh reset with copied temporary config, port 55432/shadow 55431 | Exit 0; all 0001–0094 applied; history `94 / 0001 / 0094` |
| 0094 behavior SQL | 26/26 |
| 0094 genuine concurrency | 9/9 |
| 0093 behavior / genuine concurrency | 49/49 / 16/16 |
| 0092 requester evidence | 24/24 |
| 0032 shared quota | 56/56 |
| 0033 offerer claim | 29/29 |
| Requester runtime/orchestration/wiring Node | 86/86 |
| Offerer runtime/orchestration/provider + two-route prototype Node | 103/103 |
| Full Supabase Node pattern | 1,047/1,047; 62 files |
| Root Node pattern | 957 tests, 956 pass, one existing optional integration skip; 47 files |
| Combined full Node | 2,004 tests, 2,003 pass, one skip, zero failures |
| App / Edge typechecks | Both exit 0 |
| Installed source | Exact 0094 body + seven final 0093 bodies; postgres owner, definer, empty search_path |
| Historical migrations | All 93 equal HEAD modulo CRLF/LF; existing pinned hash guards retained |
| Application fingerprints | Unchanged after each SQL/concurrency disposable harness |
| `git diff --check` | Exit 0 |

Commands: `node supabase/tests/0094_requester_route_generation_context_harness.cjs` (runs all five SQL files); `node supabase/tests/0094_requester_route_generation_context_concurrency.cjs`; `node supabase/tests/0093_requester_route_generation_claim_boundary_concurrency.cjs`; `node --test` over all `supabase/tests/*.test.cjs|mjs` files and all root `tests/*.test.cjs|mjs` files; focused requester and offerer/prototype test files; `npm.cmd run typecheck`; `npm.cmd run typecheck:edge`. Reset command: `node_modules/.bin/supabase.cmd --workdir .0094-local-reset db reset --local --yes`; the temporary copy was removed after validation. Tracked config contains only the new function registration, no database port override.

Only the documented 0094 source/tests/docs and sanctioned adapter/config/numbering/consumer-allowlist changes remain. No production access, live provider call, deployment, staging, commit or push occurred.
