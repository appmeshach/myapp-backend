# 0099 private shared-segment assessment job and worker foundation

Baseline `e5fda80`, branch `feature/0092-shared-segment-suitability`. This is a
local private foundation, not a deployed worker or participant-facing feature.
Production remains verified only through 0091. No production host was selected.

## Implemented architecture

Service-only registration accepts verified requester member, movement need and
selected availability IDs. It reuses the complete existing 0046 selected-action
authorization and derives the private pair in SQL. Exact-current 0097 lookup
precedes job creation, including deterministic processing-limit hits. Missing
requester evidence returns `not_ready` with zero jobs, claims or provider work.
Only a legitimate miss inserts/reuses one canonical job.

The reused authorities are 0046's
`public.get_requester_availability_matching_context_for_server`, 0096's
`public.get_shared_segment_geographic_assessment_context_for_server` and
`public.publish_shared_segment_geographic_assessment_for_server`, and 0097's
`public.get_current_shared_segment_geographic_assessment_for_server`. The existing
`getOrProduceSharedSegmentAssessment` runtime remains the producer composition.

A sequential Node supervisor claims one job, commits that RPC transaction, loads
its exact current context, and runs the unchanged 0096 TypeScript engine in a
credential-free child. No SQL transaction spans CPU computation. A live context
load requires running status, the current lease token, current selection, exact
canonical context/fingerprints and future dependency/lease horizons. Completed
tokens cannot retrieve geometry.

The supervisor retains 0097 reuse-first resolution. A validated SQL lookup hit
uses no child process; a miss invokes one isolated calculation and passes that
one result into the existing producer. Local algorithm/parameter identity is
checked before any child work. The child imports the frozen engine directly;
there is no geometry port, simplified algorithm, changed constant or new authority.

Finalization validates the selected relationship and fence, performs exact-current
lookup, then delegates publication to the unchanged 0096 writer. It revalidates
selection after publication and checks horizons after insertion and completion.
Publication and job completion commit together. Expiry during publication rolls
back both. Internal completion returns `state`, `assessment_id` and the authoritative
`publication_state` (`published` or `reuse_existing`).

An uncertain response permits one recovery-only finalization: 0097 lookup first,
exact queued/current context, matching known result facts, and no publication on
a miss. A committed completion can recover after lease expiry while its selected
context remains current; this does not expose geometry or permit a stale-token
writer. Reclaim issues a different token and fences the predecessor.

## Migration and private interfaces

`0099_shared_segment_assessment_job_foundation.sql` adds one table,
`private.shared_segment_assessment_jobs`, one protection trigger, two private
helpers and five public-schema, service-only RPCs. All functions are postgres-owned
SECURITY DEFINER with empty search_path. PUBLIC/anon/authenticated execution is
revoked; helpers also revoke service execution. The table has RLS, no policies,
and no direct anon/authenticated/service privileges.

| RPC | Inputs | Purpose |
| --- | --- | --- |
| `register_requester_availability_assessment_job_for_server` | verified member, need, availability UUIDs | selected authorization, reuse first, deduplicated registration |
| `claim_shared_segment_assessment_job_for_server` | none | at most one execution claim |
| `load_shared_segment_assessment_job_context_for_server` | job UUID, lease token | running/live claimed context only |
| `finalize_shared_segment_assessment_job_for_server` | job UUID, token, canonical context, optional result, optional recovery-only boolean | fenced publication/completion or exact recovery |
| `fail_shared_segment_assessment_job_for_server` | job UUID, token, whitelisted category | bounded transient retry or permanent stale state |

The registration name fits PostgreSQL's 63-byte identifier limit. No public
client supplies offerer/intent/evidence IDs, fingerprints or geometry. There is
no participant endpoint, client service, job enumeration API or config registration.

Canonical uniqueness matches 0096:
`(offerer_route_evidence_id, requester_route_evidence_id, algorithm_version,
input_context_fingerprint)`. Explicit columns additionally bind both versions,
need/requester, intent/offerer, availability and parameter fingerprint. The stored
full canonical context excludes route geometry and is compared in SQL, not merely
by hash. Identity fields cannot change. The current one-availability-per-intent
constraint supports the single selected binding. New evidence/context identities
can create new jobs; existing terminal jobs cannot reset their attempt allowance.

Job expiry is the minimum of the unchanged geographic context horizon and selected
availability expiry. This scheduling restriction does not alter the immutable
geographic assessment's own horizon. The claim index covers active pending/running
jobs. PK, canonical uniqueness and unique lease-token indexes provide direct lookup
and deduplication. History is retained; no automatic pruning was added.

## Lifecycle, lease and retry policy

States are `pending`, `running`, `completed`, `failed`, `stale`, `expired`.
Geographic verdicts are never job statuses. Claims use deterministic ordering and
`FOR UPDATE SKIP LOCKED`, with bounded maintenance of at most 16 candidate rows.
Only one execution lease is issued per call. Attempts increment on claim, never on
registration, and cannot decrease or exceed three.

Initial local settings: 60-second DB lease, clipped to job expiry; 15-second external
child wall deadline; 5-second trusted-I/O budgets; 10-second publication/recovery
reserve before cold compute. Cache reuse requires no cold-compute reserve. These
are provisional development settings requiring target-host measurement before
activation. They were not copied from the 0093 provider-generation lease.

Reported transient failures retry after 2 seconds, then 10 seconds, with a maximum
of three claims. A crash leaves a running lease; expiry allows a fresh fenced
claim, or marks exhausted work failed. Repeated registration cannot reset attempts.
Invalid evidence, contract safety failures and invalidated current dependencies
become terminal stale work. Expired horizons become expired work. No job retargets
newer evidence. Historical assessment rows remain immutable after later changes.

- `processing_limit`: deterministic 0096 result; publishable; successful completion
  and subsequent exact reuse. It never means inconclusive or incompatibility.
- `calculation_failed`: transient; no immutable publication; bounded retry.
- Timeout, abnormal exit, malformed IPC or OOM: infrastructure failure; no fabricated
  result; bounded retry. OOM/crash share `compute_terminated` classification.
- Known canonical-result/context safety rejection: permanent `contract_mismatch`,
  retaining a generic error without exposing raw DB text.

## Worker and security

`node scripts/assessment-worker/run.cjs --once` executes one private development
operation; omit `--once` for a sequential loop with one compute slot and one-second
idle polling. It requires Node 24+ and development `SUPABASE_URL` /
`SUPABASE_SERVICE_ROLE_KEY` environment configuration. No environment secrets are
embedded or printed. Modern secret keys and legacy service JWT headers follow
the existing transport conventions.

The fork receives only offerer/requester shapes, an empty inherited environment,
explicit exec arguments, and no JWT, service key, job token, identity or provider
reference. It performs no DB/provider/publication work. IPC input is bounded to
1 MiB; result to 4 MiB; diagnostics to 4 KiB. Result parsing enforces the exact
AssessmentResult keys, authority flags, enums and finite bounds. The supervisor
waits for stream closure before accepting diagnostics and successful exit.
Its independent timer/SIGKILL can terminate a synchronous stalled child.

The child has a 192 MiB V8 old-space cap. This is not an OS-wide RSS cap. Production
memory/CPU controls and service credential scope remain part of target-host review.
SIGINT/SIGTERM abort in-flight compute/IO, stop polling and leave any unresolved
lease reclaimable. There is no idle DB transaction. Safe audit events contain job
ID, state, attempt count, duration, result category and work count only.

## Benchmarks

Recorded output: [worker benchmark results](0099-worker-benchmark-results.txt).
The unchanged preflight fixtures run sequentially in fresh children on local Node
v24.13.1 / Intel i5-7200U. Lengths are synthetic approximations around Lagos latitude,
not production road-topology measurements or a production throughput guarantee.

| Case | Supervisor wall ms | Compute wall ms | Child CPU ms | Peak child RSS bytes | Overhead ms | Result / work units |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Small | 1,229.62 | 166.61 | 15 | 57,253,888 | 1,063.02 | complete / 3,289 |
| Ordinary | 1,796.03 | 857.96 | 656 | 67,690,496 | 938.07 | complete / 175,286 |
| Near maximum | 2,426.47 | 1,921.18 | 1,845 | 111,357,952 | 505.29 | processing_limit / 1,000,000 |
| Coordinate limit | 486.40 | 5.75 | 0 | 58,146,816 | 480.65 | processing_limit / 0 |
| Resampling limit | 303.15 | 11.94 | 0 | 58,847,232 | 291.22 | processing_limit / 0 |
| Dense crossing | 1,678.38 | 1,308.86 | 1,329 | 75,833,344 | 369.51 | processing_limit / 1,000,000 |

CPU timing has platform granularity; zero on the tiny limit case is not zero work.
Overhead includes fork/startup, IPC, parsing and exit. Near-maximum CPU exceeds the
hosted Edge allowance, yet the local child completes without an Edge supervisor.
External deadline, abort, abnormal exit, malformed IPC and genuine isolated heap
OOM are separately tested. Production suitability is not inferred from this host.

## Product separation and cost

No UI or requester client service changed. A real screen test browses fifty
availabilities and performs zero selected route/job actions; source guards prohibit
job/worker wiring in requester discovery, offerer surfaces and offering services.
No offerer-triggered requester generation or assessment job/provider path was added.
Existing interest guards contain no geographic/job prerequisite, and the unchanged
interest/continuation behavior assertions pass against final 0099. The isolated SQL worker
changes only jobs and geographic assessment rows; every other public/private
application table fingerprints identically. No priority, roster, capacity,
acceptance, activation, financial or journey state is written.

Required: private job rows/indexes, eventual compute hosting, bounded compute slots
and trusted worker DB access. Strongly recommended: heartbeat/availability monitoring,
job age/depth, duration, retry/failure/cache metrics and target-host end-to-end
benchmarks including SQL publication. Optional: PGMQ, more slots, autoscaling,
external queue and richer UI. No PGMQ/Redis/RabbitMQ/SQS was installed. New external
queue vendor: NONE. New provider: NONE. Real provider calls: ZERO. No paid host
was selected or deployed. Job and assessment history consume existing DB storage.

0100 owns requester-route preparation and the separate selected geographic-support
endpoint/client/UI. Hosting selection and production lease/execution validation
remain outstanding before activation. Geographic support remains advisory with
all three authority/topology flags false; admission integration is deferred.

## Verification

All tests below use local fixtures. Original application data/catalog/ACL/RLS/history
fingerprints matched before/after every disposable SQL run. Fresh reset installed
all 99 migrations in a constrained random clone at loopback port 55432 and verified
the exact effective function sources and security. The CLI's generic `remote` label
is not a hosted project.
Final cleanup found zero remaining `requester0093_<12 hex>` disposable databases.

| Verification | Result |
| --- | --- |
| 0099 SQL security / SQL-backed worker behavior | 8 / 49 assertions passed |
| 0099 genuine concurrency | 10 scenarios passed; zero deadlocks |
| Focused worker/runtime Node tests | 38 passed, including isolated stall, abort, abnormal exit, malformed IPC and genuine heap OOM |
| 0096 / 0097 security | 8 / 6 assertions passed |
| 0096 / 0097 behavior against final 0099 | 34 / 16 assertions passed |
| 0096 / 0097 / 0098 concurrency against final 0099 | 12 / 3 / 6 scenarios passed; zero deadlocks |
| 0098 behavior / security | 27 (22 SQL + 5 real local HTTP) / 5 assertions passed |
| 0092 / 0093 / 0094 / 0095 SQL | 24 / 49 / 26 / 13 assertions passed |
| 0093 / 0094 / 0095 concurrency | 16 / 9 / 7 scenarios passed |
| 0046 / 0047 / 0049 / 0052 behavior | 26 / 70 / 52 / 25 assertions passed |
| 0031 / 0032 / 0033 / 0037 / 0038 behavior | 15 / 56 / 29 / 25 / 16 assertions passed |
| 0089 priority behavior / concurrency | 75 assertions / 8 scenarios passed; zero deadlocks |
| 0089 legacy regression | 86 inbox, 52 continuation, 34 reputation and 203 legacy assertions passed |
| 0090 priority behavior / concurrency | 89 assertions / 11 scenarios passed; zero deadlocks |
| 0091 roster behavior / concurrency / temporal | 99 assertions / 22 scenarios / 17 checks passed; zero deadlocks |
| Full Supabase Node suite | 1,231 passed; zero failures or skips |
| Root Node suite | 957 passed, zero failures, one existing optional DuckDB skip (958 total) |
| App / Edge / worker JavaScript type validation | All passed |
| Fresh disposable reset through 0099 | Passed; original database unchanged |
| Worker syntax checks / `git diff --check` | All six worker scripts passed; whitespace check passed |
| Historical migration integrity | All tracked 0001–0098 migrations unchanged from HEAD |
| Frozen engine / parameter integrity | SHA-256 unchanged: `d48f53b5f7e2e226ed9a1c23d9dd1884e6a6350539e8e58b794061103db54043` / `9ad2c9a1675a4caeb4a6d658bcb8b24fcaecc6ae1b101effea906b8e216eda95` |

An unchanged 0095 eight-second deadline fixture expired under concurrent Docker
test load. Its isolated rerun passed all seven scenarios without changing the
fixture or production code. Installed-source checks covered exact 0096/0098/0099
bodies, effective 0082/0046 writers, final 0095 repairs, 0089/0090 priority and all
0091 functions, ownership, empty search paths, service-only grants, table RLS and
absence of policies. Existing context-consumer assertions retain their historical
hash by removing only the exact sanctioned 0099 addition.

## Changed-file manifest

Modified (7):

- `docs/MOVEMENT_SYSTEM_SPEC.md`
- `docs/MOVEMENT_LAUNCH_READINESS_REGISTER.md`
- `supabase/functions/_shared/shared-segment-assessment-runtime.ts` (export existing parser only)
- `supabase/tests/0048_offerer_interest_inbox.test.cjs`
- `supabase/tests/movement_context.test.cjs`
- `tests/migrationNumbering.test.cjs`
- `tests/requesterMovementInterest.test.cjs` (fifty-candidate fixture/test only)

Created (22):

- `supabase/migrations/0099_shared_segment_assessment_job_foundation.sql`
- `supabase/functions/_shared/shared-segment-assessment-job-contracts.ts`
- `supabase/functions/_shared/shared-segment-assessment-job-runtime.ts`
- `scripts/assessment-worker/compute-child.cjs`
- `scripts/assessment-worker/compute.cjs`
- `scripts/assessment-worker/result.cjs`
- `scripts/assessment-worker/worker.cjs`
- `scripts/assessment-worker/run.cjs`
- `scripts/assessment-worker/benchmark.cjs`
- `scripts/assessment-worker/tsconfig.json`
- `supabase/tests/0099_shared_segment_assessment_job_foundation.test.cjs`
- `supabase/tests/0099_shared_segment_assessment_job_foundation_test.sql`
- `supabase/tests/0099_shared_segment_assessment_job_foundation_harness.cjs`
- `supabase/tests/0099_shared_segment_assessment_job_foundation_concurrency.cjs`
- `supabase/tests/0099_shared_segment_assessment_job_foundation_reset.cjs`
- `supabase/tests/0099_shared_segment_assessment_job_foundation_validation.cjs`
- `supabase/tests/fixtures/0099-compute-stall.cjs`
- `supabase/tests/fixtures/0099-compute-abnormal.cjs`
- `supabase/tests/fixtures/0099-compute-malformed.cjs`
- `supabase/tests/fixtures/0099-compute-oom.cjs`
- `docs/0099-worker-benchmark-results.txt`
- `docs/0099-shared-segment-assessment-job-foundation.md`

No historical migration, frozen geometry/parameter module, preflight artifact,
application source, dependency/lockfile or Supabase configuration was changed.
The earlier context-consumer hash remains pinned; only the exact sanctioned 0099
addition is stripped before comparison. Nothing staged, committed, pushed or
deployed; no production access or real-provider action.

Exact `git status --short` (directories expanded in the manifest above):

```text
 M docs/MOVEMENT_LAUNCH_READINESS_REGISTER.md
 M docs/MOVEMENT_SYSTEM_SPEC.md
 M supabase/functions/_shared/shared-segment-assessment-runtime.ts
 M supabase/tests/0048_offerer_interest_inbox.test.cjs
 M supabase/tests/movement_context.test.cjs
 M tests/migrationNumbering.test.cjs
 M tests/requesterMovementInterest.test.cjs
?? docs/0099-shared-segment-assessment-job-foundation.md
?? docs/0099-worker-benchmark-results.txt
?? scripts/assessment-worker/
?? supabase/functions/_shared/shared-segment-assessment-job-contracts.ts
?? supabase/functions/_shared/shared-segment-assessment-job-runtime.ts
?? supabase/migrations/0099_shared_segment_assessment_job_foundation.sql
?? supabase/tests/0099_shared_segment_assessment_job_foundation.test.cjs
?? supabase/tests/0099_shared_segment_assessment_job_foundation_concurrency.cjs
?? supabase/tests/0099_shared_segment_assessment_job_foundation_harness.cjs
?? supabase/tests/0099_shared_segment_assessment_job_foundation_reset.cjs
?? supabase/tests/0099_shared_segment_assessment_job_foundation_test.sql
?? supabase/tests/0099_shared_segment_assessment_job_foundation_validation.cjs
?? supabase/tests/fixtures/
```
