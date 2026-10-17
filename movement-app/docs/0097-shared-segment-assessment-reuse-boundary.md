# 0097 shared-segment assessment reuse boundary

0097 adds a service-only lookup for an immutable 0096 geographic assessment and a reuse-first, one-pair TypeScript orchestration boundary. It creates no table, participant endpoint, discovery integration, provider call, queue, priority input, or admission rule.

The SQL lookup reconstructs the exact current trusted 0096 context in the same transaction. A hit requires the current movement need and members, current offering intent, both current route-evidence IDs and versions, algorithm v1, the current parameter and input-context fingerprints, byte-equivalent canonical JSON context, the same expiry, and an unexpired row. It returns the validated row's algorithm version and parameter fingerprint so the running TypeScript also proves deployment-contract identity before reuse. Historical rows stay immutable and are returned only when they remain the exact current identity.

Internal lookup states are `reuse_existing`, `not_found`, and `not_ready`. They are cache states, not geographic conclusions. In particular, missing or unavailable requester evidence produces `not_ready`, with no geometry, publication, requester-route generation, or provider work. If context becomes unavailable between an initial miss and the producer's second context read, the final resolution also becomes `not_ready`. A persisted deterministic `processing_limit` result is a normal hit. A transient `calculation_failed` result is never persisted and may be retried on a later explicit invocation.

`getOrProduceSharedSegmentAssessment` validates the four pair IDs and calls `backend.lookup` first. A hit returns the stored canonical result without geometry or publication. A legitimate miss invokes the existing 0096 producer for exactly one pair. Concurrent misses may both calculate; the 0096 unique identity and publication revalidation converge on one immutable row. No application lock is held during geometry work.

Every lookup response has exactly five keys: `lookup_state`, `assessment_id`, `algorithm_version`, `parameter_fingerprint`, and `canonical_result`. Both non-hit states return null for all four payload fields. The runtime validates the exact keys, assessment UUID, local algorithm version, lowercase SHA-256 fingerprint format, and canonical result. Orchestration independently requires `lookup.algorithm_version === ASSESSMENT_VERSION` and `lookup.parameter_fingerprint === await parameterFingerprint()` before returning a hit. A deployment-contract mismatch raises the generic internal `Assessment unavailable` error with zero context fallback, geometry, or publication; it never becomes a cache miss.

The second-read race resolves to the current `not_ready` state with null result/publication when the producer observes unavailable, stale, or invalid evidence. Keeping the historical `not_found` resolution in this case would mislead a future caller into retrying an identity that is no longer ready. Calculation failure with ready inputs still keeps the ordinary miss resolution and remains unpersisted. Tests cover all three non-ready input states, both local identity mismatches on hits and misses, malformed hit contracts, and exact null non-hit contracts.

Cost ledger: no new vendor, provider request, database table, queue, scheduled job, or paid service. Storage growth remains the 0096 immutable assessment row only.

## Hardening continuation verification — 2026-10-11

The continuation started at `b7bdc9d1521e0b1365a50cf8abf5df8f2a8b15f7` on `feature/0092-shared-segment-suitability`, with eight modified tracked files and seven untracked 0097 files, and an empty index. The five-field SQL contract, lookup types, orchestration identity comparisons, basic runtime parsing, identity mismatch tests, and second-read `not_ready` correction were already on disk. They were preserved. This continuation finished strict runtime algorithm-version validation, added malformed-response and exact non-hit contract tests, covered both producer identity checks and all three second-read non-ready states, and documented the decision.

The defect addressed is a cache-hit path bypassing the existing 0096 producer's local algorithm/parameter proof. SQL current-DB identity alone cannot prove identity with the deployed TypeScript. Hits now require both local identity comparisons before reuse; either mismatch fails closed without recomputation.

| Final validation | Result |
| --- | --- |
| Focused 0097 SQL security contract | 6/6 passed |
| Focused 0097 SQL behavior | 16/16 passed |
| 0097 runtime/orchestration and boundary tests | 28/28 passed |
| Imported 0096 geometry/runtime/orchestration regressions | 44/44 passed; combined focused run 72/72 |
| Genuine 0097 PostgreSQL concurrency | 3/3 passed; zero deadlocks |
| Broad-discovery assessment fanout | Zero; source regression passed |
| Full Supabase Node suite | 65 files; 1,168 passed; zero failures/skips |
| Root Node suite | 47 files; 957 total, 956 passed, zero failures, one skipped |
| App typecheck | `npm.cmd run typecheck`, exit 0 |
| Edge typecheck | `npm.cmd run typecheck:edge`, exit 0 |
| Fresh reset | All 97 migrations, 0001–0097, plus temporary platform bootstrap, passed in a disposable local database |
| Installed source/security | Exact 0097 body, postgres owner, security definer, empty search path, service-only ACL; 0096 exact sources/ACL/RLS/no policies passed |
| Historical integrity | All 96 tracked migrations unchanged from baseline; historical Node checks passed |
| Original local application fingerprint | Data/catalog/ACL/RLS/history unchanged after focused SQL, concurrency, and reset |
| Application/config source | No tracked changes to app/src/assets/constants/hooks/components/package files or `supabase/config.toml` |
| Final Git checks | Clean `git diff --check`; empty index; unchanged baseline HEAD |

The root skip is the existing DuckDB integration fixture requiring `DUCKDB_BIN` and explicit integration opt-in. The first concurrency attempt failed because its two-second fixture expired before the initial miss assertion on this host. The corrected fixture allows two minutes for setup, then waits for the exact recorded expiry; the final run passed. No production logic or migration changed to address that fixture. The full Node suites and typechecks were not repeated for this isolated concurrency-runner change.

Reset used only `postgresql://postgres:postgres@127.0.0.1:55432/requester0093_<random>?sslmode=disable`. The CLI's generic `remote` label for `--db-url` refers to this explicit loopback target, not a hosted project. Disposable clone cleanup and original-local fingerprint checks passed. No staging, commit, push, deployment, production access, or provider request was performed in this continuation. Earlier external-action history was not independently queried.
