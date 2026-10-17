# 0099 requester selected geographic-support preflight — STOPPED

Baseline: `de1d394 fix(matching): add current route-match reuse recovery`, branch
`feature/0092-shared-segment-suitability`. The worktree was clean before this work.

The requested integration is **not implemented**. The request explicitly requires
stopping before exposing the endpoint if a safe runtime budget cannot be demonstrated.
The frozen geometry engine exceeded the enforced CPU allowance in local Supabase
Edge user workers. Only benchmark artifacts and this report were added.

## Blocking evidence

[Supabase's hosted runtime limits](https://supabase.com/docs/guides/functions/limits)
specify **2 seconds CPU per request**, excluding asynchronous I/O. The much longer
wall-clock allowance does not increase CPU capacity. A JavaScript abort timer cannot
interrupt this synchronous geometry engine while it holds the event loop.

Benchmarks used the unchanged 0096 implementation and parameters. Host: Intel
Core i5-7200U, 4 logical CPUs, 8.46 GB RAM; Node v24.13.1. Edge image:
`public.ecr.aws/supabase/edge-runtime:v1.77.1`, reporting compatible Deno v2.1.4,
V8 11.6.189.12. Each Edge measurement used a fresh user worker, 256 MB memory,
30 s worker wall-clock limit, empty worker environment, offline container and
read-only minimal source mount. No DB, provider, application credentials, or
production connection was used.

The final saved 2 s-cap run cancelled the dense-crossing request with
`CPU time limit reached` and `WorkerRequestCancelled`. An earlier run also cancelled
the near-maximum case. Other runs completed those cases; that variability is part
of the failure to establish safe headroom, not evidence that the cap is safe.

| Case | Original coordinates per route | Resampled points per route | Work units | Saved Node wall / CPU ms | Saved Edge 2 s-cap geometry ms | Saved diagnostic Edge geometry ms | Result |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Simple 300 m shared line | 2 | 61 | 3,289 | 41.60 / 31 | 23.38 | 63.19 | complete / geometric_corridor_support |
| Ordinary 15 km shared line with vertices | 200 | 3,185 | 175,286 | 548.59 / 610 | 307.91 | 679.59 | complete / geometric_corridor_support |
| Near coordinate/resampling envelope, 89 km | 2,000 | 19,716 | 1,000,000 | 1,517.74 / 1,672 | 1,798.64 | 3,725.04 | processing_limit when completed |
| One over original-coordinate limit | 2,001 / 2 | 0 | 0 | 0.14 / 0 | 1.05 | 2.03 | processing_limit |
| Over resampling limit, 150 km | 2,000 | 0 | 0 | 5.32 / 16 | 8.55 | 25.44 | processing_limit |
| Dense repeated 4 m traversals crossing at 60 degrees | 2,000 | 3,591 / 3,599 | 1,000,000 when completed | 942.51 / 1,156 | **CPU supervisor cancellation** | 2,817.30 | processing_limit when completed |

Lengths above describe synthetic fixture construction; positions use approximate
metres-to-longitude conversion around Lagos latitude. They are not production
routes. Dense crossing is an adversarial envelope case, not an ordinary route.
The ordinary case is a representative length/vertex-count synthetic route, not
a complete urban-road performance model. Neither completed processing-limit
case may be interpreted as inconclusive.

Node CPU numbers cover synchronous assessment and include runtime/GC activity;
Node wall time and process CPU time can differ. Edge geometry wall time is measured
inside the worker. Request wall time additionally includes fresh-worker startup.
The Edge supervisor cancellation is direct CPU-cap evidence; diagnostic wall
measurements alone are not CPU measurements. The diagnostic cap is **10 s solely
to observe full results**; it does not change a production limit or the algorithm.
Local image tests reproduce worker machinery and limits, not production hardware.

The bare benchmark already fails the CPU-cap condition without authentication,
SQL response parsing, fingerprint checks, assessment serialization or final
validation. A safe reserve for the full cold-miss endpoint therefore has not been
demonstrated. Do not expose the proposed endpoint from these results. The next
decision must provide demonstrated CPU headroom while retaining frozen semantics;
changing parameters, silently downsampling, extending wall time, or relying on an
abort timer is not a resolution. Background queues and algorithm changes were
outside this request and were not attempted.

Raw saved evidence:

- [Node measurements](0099-node-benchmark-results.txt)
- [2 s-cap Edge measurements](0099-edge-cpu-cap-results.txt)
- [2 s-cap Edge supervisor logs](0099-edge-cpu-cap-errors.txt)
- [Diagnostic Edge measurements](0099-edge-diagnostic-results.txt)
- [Diagnostic Edge shutdown logs](0099-edge-diagnostic-errors.txt)

Closing the benchmark main listener makes this Edge image print `main worker has
been destroyed` and exit with status 1. That shutdown line is not an assessment
failure. The explicit `0099_BENCHMARK_DONE` marker records completion of the suite;
individual HTTP states and supervisor logs determine CPU-cap failure. PowerShell
redirection also records native stderr as `NativeCommandError` metadata.

## Reproduce

Run from the repository root, with the existing image available locally:

```powershell
node scripts/0099-benchmark-node.mjs
node scripts/0099-benchmark-node.mjs nearMaximum
node scripts/0099-benchmark-edge.cjs
node scripts/0099-benchmark-edge.cjs --diagnostic
```

The Node optional case argument permits a separate process for a cold case. The
saved Node suite is one process, so later cases may benefit from JIT warmup.
The Edge driver copies five source files into a newly created OS temporary
directory, mounts that directory read-only, uses `--network none` and `--rm`, and
validates the cleanup path before removing its own temporary directory. A saved
completion marker is required; CPU cancellation yields the driver's failure state.
No provider request is part of any benchmark.

## Architecture audited before integration

1. **Current UI sequence:** `checkOfferedMovement` clears prior evidence and
   selection, requires `explicitMovementNeedId` from successful user submission,
   sets the existing busy state, calls `calculateRouteMatch(need, {availabilityId})`,
   discards stale/unmounted results, stores exact route-match evidence/selection,
   and displays origin distance. `canExpressInterest` continues to rely on that
   route-match evidence and existing interest rules. Recovered needs alone do not
   enable the selected route check.
2. **Selected authorization:** reuse the actual 0046 RPC
   `get_requester_availability_matching_context_for_server`, called by
   `RouteBackend.getRequesterAvailabilityMatchingContext`. It authoritatively
   checks verified requester ownership/current need and the selected availability's
   live relationship, privately resolves intent/member/offerer evidence, and follows
   the existing lock hierarchy. The 0095 effective context and 0091 roster rules
   remain in force. No private client selectors would be accepted.
3. **0094 operation:** the reusable portion would be extracted from
   `createRequesterRouteGenerationHandler` after authentication/current-need proof:
   claim, exact reuse/in-progress, trusted context, quota, provider validation,
   revalidation, frozen publication and exact replay recovery. The existing public
   handler and defaults would be preserved: overall 20,000 ms; provider 5,000 ms;
   recovery 3,000 ms; bootstrap 5,000 ms; minimum publication 2,000 ms. There is
   currently no separately exported preparation operation; none was added.
4. **0097 operation:** `getOrProduceSharedSegmentAssessment` would receive a
   private SQL-derived pair, perform exact-current reuse first, and compute only
   on a safe miss. Algorithm/fingerprint mismatch must fail without recomputation.
5. **Final SQL boundary:** a minimal forward helper would be required to combine
   selected-availability validation and 0097 exact-current lookup in one SQL
   transaction, bind the returned assessment to the expected pair/assessment, and
   reject stale need, availability or either route. Separate 0046/0097 HTTP RPCs
   do not atomically prove that final relationship. No migration was created.
6. **Tentative wall budget:** 30 s consisting of up to 5 s auth/selection,
   the existing 20 s preparation operation, and a bounded 5 s assessment/final-
   validation reserve. This proposal was **not adopted or tested as an endpoint**;
   its separate CPU prerequisite failed. No SQL transaction would span provider
   or synchronous geometry work.
7. **Public request proposal:** exactly `{movementNeedId: uuid, availabilityId:
   uuid}`. Private selectors, coordinates, geometry, provider options, refresh and
   extra keys would be rejected before quota/provider work.
8. **Public response proposal:** exactly `{geographicSupport}` with the five
   requested coarse states; optional bounded `retryAfterSeconds` only for pending
   0094 in-progress generation. No private identities, evidence, fingerprints,
   geometry or metrics. This contract is **not exposed**.

The planned endpoint, three shared modules, requester-route extraction, final SQL
helper, app service, config, UI integration and integration tests were not created.
No geographic mapping, retry, in-flight UI guard, abort behavior or final SQL race
handling is claimed implemented. These remain outstanding after a runtime solution.

## Validation and integrity

- Combined focused Node run: **141 passed, 0 failed, 0 skipped**, using
  `0096_trusted_shared_segment_geographic_assessment.test.cjs`,
  `0097_shared_segment_assessment_reuse_boundary.test.cjs`, and
  `0098_current_route_match_reuse_boundary.test.cjs`. The 0097 file imports the
  0096 test module, so the aggregate includes those tests a second time. This is
  not 141 new 0099 tests. It includes 0098 reuse/recovery and 0097 zero-fanout guards.
- App typecheck: passed after isolating benchmark fixtures from the app TS graph.
- Edge typecheck: passed.
- `git diff --check`: passed.
- `git diff --exit-code de1d394 -- supabase src tests package.json tsconfig.json`:
  passed. Production sources, all migrations, tests and configuration match HEAD.
- Index empty; HEAD unchanged. No installed-source/ACL mutation occurred.
- No database queries or writes were made, so application DB fingerprints and
  installed-source checks were **not recomputed**. Database identity is not inferred
  from a file hash. All local benchmark containers exited; temporary source copies
  were removed.
- Frozen geometry SHA-256:
  `d48f53b5f7e2e226ed9a1c23d9dd1884e6a6350539e8e58b794061103db54043`.
  Frozen contracts SHA-256:
  `9ad2c9a1675a4caeb4a6d658bcb8b24fcaecc6ae1b101effea906b8e216eda95`.
- No 0099 integration test counts exist. Requester-route SQL/concurrency,
  0096/0097/0098 SQL/concurrency, interest/continuation, priority/roster, full
  Supabase/root suites and fresh reset were **not rerun** after the preflight stop.
  Prior 0098 results remain historical evidence in its report, not this run's totals.
- Provider calls: **zero**. Geometry calls: exactly one per benchmark case; cache
  and cross-candidate cost tests are not implemented. Benchmarks intentionally
  do not use a cache. Interest independence, selection races and offerer behavior
  are unchanged by source integrity, not proved as a new integrated 0099 flow.

## Changed-file manifest / git status

All changes are new, unstaged artifacts; no existing tracked file was modified:

```text
?? docs/0099-edge-cpu-cap-errors.txt
?? docs/0099-edge-cpu-cap-results.txt
?? docs/0099-edge-diagnostic-errors.txt
?? docs/0099-edge-diagnostic-results.txt
?? docs/0099-node-benchmark-results.txt
?? docs/0099-requester-geographic-support-preflight.md
?? scripts/0099-benchmark-edge-main/
?? scripts/0099-benchmark-edge-worker/
?? scripts/0099-benchmark-edge.cjs
?? scripts/0099-benchmark-node.mjs
?? scripts/0099-geographic-support-benchmark.mjs
```

The two directories each contain only `index.mjs`: 11 new files in total.

## Cost ledger and deferrals

**Required for the future integration:** selected-action authorization, existing
requester-route reuse/generation/quota, DB assessment lookup, one-pair geometry on
an exact miss, final selected-pair validation. First cold selection may incur one
admitted provider attempt and one assessment computation; a second candidate
should reuse requester evidence; repeated same candidate should call neither
provider nor geometry. Those future counts have not been newly tested here.

**Strongly recommended:** duration instrumentation without private geometry,
cache counters, selected-request rate limiting and deployed-equivalent benchmarking.
The offline runtime benchmark was performed and exposed the blocker; deployed
hardware verification remains deferred.

**Optional/deferred:** richer visualization, warming, batch assessment, queues and
offerer annotation. Offerer-side integration is deferred. Geographic admission,
road identity, usable shared travel and compatibility remain unconfirmed; the
frozen internal flags remain `authorizesAdmission = false`,
`confirmsUsableSharedSegment = false`, `roadTopologyVerified = false`.

New vendor: **none**. Real Mapbox calls: **zero**. Future authorized use would be
only existing requester generation when a current need has no reusable route.
No staging, commit, push, deployment, production access or real-provider action
occurred. No acceptance, priority, capacity, roster or lifecycle behavior changed.
