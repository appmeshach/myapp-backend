# 0101 worker host qualification and deployment boundary — final report

Implemented locally on `feature/0092-shared-segment-suitability`, baseline `993c9c0`, draft PR #35. Worker foundation/tooling verified; actual production host UNSELECTED / UNQUALIFIED and geographic support activation BLOCKED. No migration.

Artifacts: [runbook](0101-worker-deployment-boundary.md), [Windows offline](0101-offline-qualification/qualification.md), [local integration](0101-local-qualification/qualification.md), [final constrained Linux](0101-linux-final-qualification/qualification.md), [initial Linux failure](0101-linux-qualification/qualification.md). Each directory contains JSON, generated Markdown and schema.

| # | Requested result | Evidence/result |
| ---: | --- | --- |
| 1 | Architecture implemented | Four layers: process/runtime boundary; offline host benchmark; disposable SQL/failure/restart qualification; strict JSON/schema and generated Markdown reports. Existing worker/0096 architecture retained. |
| 2 | Exact changed-file manifest | 31 files; complete manifest below. All unstaged. |
| 3 | Worker start boundary | node scripts/assessment-worker/run.cjs; optional --once. Eager version/config checks before TS imports, authenticated ordinary-poll readiness, heartbeat, fixed errors and bounded SIGTERM/SIGINT shutdown. No HTTP listener. |
| 4 | Runtime/version contract | Node 24+ native TypeScript stripping; tested v24.13.1 on Windows and Linux, no loader/build/dependency installation. Complete source layout required. Worker manifest leaves app runtime unchanged. |
| 5 | Qualification CLI | qualify.cjs --offline or --integration; --runs 1..20 (default 5), bounded idle minutes/seconds, operator memory budget, host/cost labels and --output. Runbook has exact commands. |
| 6 | Qualification schema | movement_worker_host_qualification_v1; strict required fields, extra-key rejection, credential/UUID rejection, finite metrics and no geometry/private identifiers. Git commit/dirty state and worker source SHA-256 recorded. |
| 7 | Offline cases | Six frozen 0099 compute fixtures: small, ordinary ~15 km, near maximum, coordinate limit, resampling limit, dense crossing. Four adversarial fixtures: stall, malformed IPC, crash, 16 MiB heap-OOM. New malformed-diagnostic live-child regression. |
| 8 | Repetition/statistics | Five normal runs/case; min/p50/max, failure/timeout/termination counts and maximum RSS; p95 only with >=20 observations. First/subsequent supervisor invocation labels, fresh child every time; no provider/hardware cold-start claim. |
| 9 | Local benchmark measurements | Final Windows and enforced one-CPU Linux tables below; every normal complete-result hash matches frozen expectations in all final samples. |
| 10 | Memory measurements | Windows offline parent/child peaks 69.20/107.61 MiB; integration 91.20/108.05 MiB; Linux 90.55/108.94 MiB. All final memory screens pass; Linux also has enforced 512 MiB. V8 old-space is not RSS. |
| 11 | Lease-headroom result | Worst normal wall across final samples 4368.32 ms + 10,000 ms reserve <=30,000 ms; remaining 45631.68 ms inside unchanged 60,000 ms lease. Provisional screen, not SLA. |
| 12 | Timeout result | Stalled child -> compute_timeout, null geographic state/result/reason; expected fault gate passes. Host timeouts do not become processing_limit. |
| 13 | Abnormal termination result | Abnormal exit and explicit child SIGKILL -> compute_terminated; no geographic publication. |
| 14 | OOM result | Genuine 16 MiB V8 heap pressure -> compute_terminated in final samples; no normal OOM. Initial Linux sample correctly recorded HOST_UNQUALIFIED when native OOM diagnostics waited for delayed closure; the diagnostic defect and correction are documented below. |
| 15 | processing_limit result | All four frozen limit cases retain exact results; successful immutable completion and exact 0097 reuse are verified in SQL. |
| 16 | calculation_failed result | Infrastructure/transient outcome: no assessment publication, bounded retry; actual SQL lifecycle scenario passes. |
| 17 | SIGTERM behavior | Abort active I/O/child, stop new claims, clean idle/active-supervision exit; six-second watchdog on unresolved shutdown. Six actual Linux process tests pass, including SIGINT. Windows uses explicit test handler dispatch and remains incomplete for OS signal delivery. |
| 18 | Crash/restart recovery | Kill before claim leaves pending; kill after claim leaves running/no evidence; actual unchanged 60-second lease expires and reclaim increments attempt to two. Child failure retries exhaust at three without evidence. |
| 19 | Stale-token fencing | Old token load/finalize rejected after reclaim; new token can authoritatively complete. 0101 scenario and 0099 concurrency pass. |
| 20 | Lost-publication recovery | Actual COMMIT then killed supervisor before acknowledgement: exact reuse/recovery, one assessment, no second geometry/publication. |
| 21 | One-job result | PASS; drain 0.734 s, zero retries/failures/duplicates. |
| 22 | Ten-job result | PASS; drain 15.521 s, zero retries/failures/duplicates. |
| 23 | Hundred-job result | PASS; drain 173.767 s, zero retries/failures/duplicates. One slot and normal one-second inter-operation pacing. |
| 24 | Same-pair deduplication | 100 selected-boundary registrations -> one canonical job; 100 operations after publication -> exact reuse, zero new compute, one publication. |
| 25 | Idle-resource smoke | Real local SQL poll sample 2014.95 ms, 2 polls, RSS p50/max 77.13/77.48 MiB, CPU 0.00 ms; interval CPU stats and event-loop sampling lateness recorded. No held transaction. Offline samples explicitly simulated. |
| 26 | Structured logging/security | Allowlisted events/fields; removed private job IDs. Captured-process leak checks and installed SQL source/owner/search_path/ACL/RLS checks pass. |
| 27 | Secret exposure audit | No real credentials read for qualification, no keys/JWT/private URLs/identities/coordinates in reports or worker logs. Child environment empty and IPC shapes only. Native malformed diagnostics are discarded, never logged. Review host memory/core collectors before launch. |
| 28 | Service-role risk conclusion | Supervisor key remains broader than worker RPC requirements and can expose/mutate other privileged Supabase resources if leaked. Secure injection/access/rotation/revocation and residual-risk acceptance launch-required; narrower execution role feasible but separately deferred. Modern key format alone is not narrowing. |
| 29 | Provider-neutral deployment artifacts | Worker-specific manifest, native Node source/runtime/start contract and deployment/environment/security runbook. No build tool, root dependency change, Dockerfile, public server or provider descriptor. Docker used only for local DB/Linux QA. |
| 30 | Railway future procedure | Non-production worker service; Node 24/source/start/private credentials; one slot; allocation-specific offline/disposable lifecycle/idle/CPU/RSS/restart/billing checks; export then stop/delete. Not performed. |
| 31 | Fly future procedure | Non-production background machine/process; same runtime/start/secret/slot contract, explicit limits and signal grace; qualification/idle/billing review; export and stop/delete. Packaging choice deferred. Not performed. |
| 32 | Render future procedure | Non-production background worker; same source/Node/start/credentials, one slot; resource/lifecycle/idle/restart/billing checks; export and stop/delete. Not performed. |
| 33 | VPS future procedure | Least-privilege service account; Node 24 immutable source; protected secrets; process supervisor/restart-on-failure/grace >6 s; enforced limits and qualification; export and stop test service. Not performed. |
| 34 | Focused 0101 test counts | 35 Node qualification tests +6 process tests =41 distinct automated tests; same six process tests also pass with actual Linux OS signals. Combined final 0099/0101/process focused run: 79 passed. Nine SQL recovery/failure scenarios, three queue loads, dedup and idle checks pass. |
| 35 | 0099 regression counts | 38 runtime/worker Node; 8 SQL/security; 49 SQL/worker behavior; 10 concurrency; zero deadlocks. |
| 36 | 0100 regression counts | 16 actual SQL/HTTP integration checks passed; handler, app-service and requester UI coverage passed within full suites. Existing app sources/behavior unchanged. |
| 37 | 0092-0098 regression results | 0092 SQL24; 0093 SQL49/concurrency16; 0094 SQL26/concurrency9; 0095 SQL13/concurrency7; 0096 security8/behavior34/concurrency12; 0097 security6/behavior16/concurrency3; 0098 SQL/HTTP27/concurrency6. All pass, zero reported deadlocks. |
| 38 | Interest/priority/roster results | 0046 selected26; 0047 interest70; 0049 continuation52; 0052 deadline25; priority0089 behavior75/concurrency8 (19 reads),0090 behavior89/concurrency11; roster0091 behavior99/concurrency22/temporal17. Additional original inbox86/continuation52/reputation34/legacy203 checks pass. Zero deadlocks. |
| 39 | Supabase full-suite total | 1,314 passed; zero failed/skipped. Final source includes new diagnostic regression. |
| 40 | Root-suite total | 1,003 tests: 1,002 passed, zero failed, one existing opt-in DuckDB extraction/verification skip (requires DUCKDB_BIN). |
| 41 | App typecheck | PASS. |
| 42 | Edge typecheck | PASS. |
| 43 | Worker typecheck | PASS; final check supersedes an intermediate literal-type inference error corrected with a number annotation. |
| 44 | Fresh reset status | PASS: 0001-0099 in a disposable local clone, installed source/security verified; original data/catalog/ACL/RLS/history fingerprint unchanged. No 0100/0101 migration. |
| 45 | Historical migration integrity | All 99 migration files unchanged from HEAD; historical raw/normalized guards pass. App/Edge sources, root dependencies and supabase/config.toml also exactly unchanged. |
| 46 | Frozen algorithm fingerprints | Geometry d48f53b5f7e2e226ed9a1c23d9dd1884e6a6350539e8e58b794061103db54043; contracts 9ad2c9a1675a4caeb4a6d658bcb8b24fcaecc6ae1b101effea906b8e216eda95; parameter fingerprint 1625aa38ea035ad2c26a8c13a3a4df37714fc32624089fa3894f57c2ddda29d5. All match baseline. |
| 47 | git diff --check | PASS; routine LF/CRLF warnings are not whitespace errors. |
| 48 | Exact git status --short | Recorded below; index empty and HEAD remains 993c9c0. |
| 49 | Cost ledger | No new paid service. Required: qualified Node host, secure secrets, supervision, enforced CPU/RAM, connectivity and target qualification. Recommended logs/CPU/RAM/restarts/queue age-depth/heartbeat/budget alerts; replicas/autoscaling/PGMQ/Redis/external queue/monitoring/VPS/orchestration optional. Measured control RPCs 695, jobs 117, child CPU 50524.00 ms, parent CPU 6829.00 ms; no provider prices or byte estimates manufactured. |
| 50 | Current production-host status | UNSELECTED / UNQUALIFIED. Local final reports remain INCOMPLETE for unmeasured host dimensions; Linux signal evidence is separate. |
| 51 | Exact remaining launch blocker | Select an actual non-production candidate allocation first, then prove target resources, real signals/restart/queue/fencing/publication headroom, Supabase connectivity, secure secrets/crash handling and operational/cost suitability before any separately authorized production activation. GEOGRAPHIC SUPPORT PRODUCTION ACTIVATION BLOCKED. |
| 52 | Prohibited-action confirmation | No stage, commit, push, deployment, production access, routing/hosting-provider API call, account/project/service creation, purchase or global cloud CLI installation. Public documentation and a public Node image for local QA were accessed; all providers in behavior tests are mocks. |

## Final Windows offline measurements

| Case | Parent wall p50/max ms | Child compute p50/max ms | Peak child RSS MiB | State/reason |
| --- | ---: | ---: | ---: | --- |
| small | 358.53 / 460.37 | 25.09 / 35.28 | 55.39 | complete; geometric_corridor_support |
| ordinary | 734.28 / 806.94 | 369.22 / 381.34 | 72.63 | complete; geometric_corridor_support |
| nearMaximum | 2989.81 / 4191.58 | 2307.25 / 3661.24 | 107.61 | assessment_unavailable; processing_limit |
| coordinateLimit | 445.39 / 586.69 | 5.99 / 7.86 | 56.95 | assessment_unavailable; processing_limit |
| resamplingLimit | 488.32 / 570.78 | 22.01 / 28.40 | 57.03 | assessment_unavailable; processing_limit |
| denseCrossing | 3128.45 / 3680.35 | 2398.32 / 3242.24 | 75.46 | assessment_unavailable; processing_limit |

## Final Linux measurements — enforced one CPU and 512 MiB

| Case | Parent wall p50/max ms | Child compute p50/max ms | Peak child RSS MiB | State/reason |
| --- | ---: | ---: | ---: | --- |
| small | 805.34 / 1251.28 | 66.87 / 89.68 | 76.59 | complete; geometric_corridor_support |
| ordinary | 1195.35 / 1662.10 | 659.19 / 799.72 | 87.12 | complete; geometric_corridor_support |
| nearMaximum | 3319.05 / 3785.87 | 2878.75 / 3280.22 | 108.94 | assessment_unavailable; processing_limit |
| coordinateLimit | 452.49 / 623.96 | 5.85 / 9.98 | 76.35 | assessment_unavailable; processing_limit |
| resamplingLimit | 463.07 / 669.04 | 12.45 / 65.62 | 77.18 | assessment_unavailable; processing_limit |
| denseCrossing | 4305.63 / 4368.32 | 3854.14 / 3965.27 | 96.79 | assessment_unavailable; processing_limit |

Local Docker flags enforced the limits; core limit was zero and network disabled. Logical CPU/OS memory metadata describes the underlying VM, not quota. No Git executable in the minimal image; commit is unknown, but final worker source fingerprint matches Windows: `5316734c92ae254c2689f1197e2e0e4f8363c8143990c5f47fc8d217596832fe`. These are local synthetic samples, not production throughput guarantees.

## Serialized queue measurements

| Jobs | First claim ms | Drain s | Maximum DB queue age s | Compute p50/max ms | Retries/failures/duplicates |
| ---: | ---: | ---: | ---: | ---: | --- |
| 1 | 124.29 | 0.734 | 0.755 | 212.67 / 212.67 | 0/0/0 |
| 10 | 39.39 | 15.521 | 15.501 | 154.55 / 242.76 | 0/0/0 |
| 100 | 40.84 | 173.767 | 173.740 | 184.68 / 507.25 | 0/0/0 |

Queue timing includes the unchanged one-second inter-operation interval. The running-supervisor drain clock begins after registration and excludes inspection queries. A local serialized/autocommit SQL bridge is used; cloud network/startup latency is not inferred. RSS includes qualification modules. Counted DB calls exclude fixture/admin inspection; CPU sums accepted diagnostics, excluding lost/killed-worker diagnostics and external DB CPU. Bytes and provider prices are unmeasured.

## Corrections discovered during qualification

The initial Linux forced heap-OOM reported native OOM after ~389 ms, but a piped crash collector delayed stream/process closure. The old supervisor buffered 1,154 bytes of invalid diagnostics and waited until its deadline, classifying timeout. It now rejects a complete invalid metric line promptly as compute_terminated, drops later bytes and never logs the native text. A live-child malformed-diagnostic regression passes. Geometry and all 0099 SQL/lease/retry/publication semantics are unchanged. The OOM qualification probe now uses the existing 15-second worker cap; malformed/crash smoke probes use five seconds and the deliberate stall one second.

The first Linux failed artifact is retained with its original source hash, measurements, five-second deadline and HOST_UNQUALIFIED verdict. Known 192/16 MiB sample heap settings were added to the metadata and its schema/Markdown regenerated for compatibility; no measured outcome was changed. Final Linux fault gates pass. Review privileged-memory/core-dump collectors and access/retention before launch; a process core limit alone did not eliminate this local piped-collector behavior.

The first queue runner omitted the existing one-second delay between operations; final recordings include it. A pre-existing root source guard also failed once 0100 became committed: its historic comparison omitted the sanctioned new geographic-support service. The guard now pins that service to exact reviewed blob `b0af7a2d67b42206ed2b2942bd3944b255baa80f`; every other client/dependency guard and the exact requester-screen delta pin remain. No application code changed.

## Exact changed-file manifest

```text
 M docs/MOVEMENT_LAUNCH_READINESS_REGISTER.md
 M docs/MOVEMENT_SYSTEM_SPEC.md
 M scripts/assessment-worker/compute.cjs
 M scripts/assessment-worker/run.cjs
 M scripts/assessment-worker/worker.cjs
 M tests/preDepartureRosterFreeze.test.cjs
?? docs/0101-linux-final-qualification/qualification.json
?? docs/0101-linux-final-qualification/qualification.md
?? docs/0101-linux-final-qualification/qualification.schema.json
?? docs/0101-linux-qualification/qualification.json
?? docs/0101-linux-qualification/qualification.md
?? docs/0101-linux-qualification/qualification.schema.json
?? docs/0101-local-qualification/qualification.json
?? docs/0101-local-qualification/qualification.md
?? docs/0101-local-qualification/qualification.schema.json
?? docs/0101-offline-qualification/qualification.json
?? docs/0101-offline-qualification/qualification.md
?? docs/0101-offline-qualification/qualification.schema.json
?? docs/0101-worker-deployment-boundary.md
?? docs/0101-worker-host-qualification.md
?? scripts/assessment-worker/package.json
?? scripts/assessment-worker/qualification-integration.cjs
?? scripts/assessment-worker/qualification-report.cjs
?? scripts/assessment-worker/qualify.cjs
?? scripts/assessment-worker/runtime.cjs
?? supabase/tests/0101_worker_host_qualification.test.cjs
?? supabase/tests/0101_worker_host_qualification_validation.cjs
?? supabase/tests/fixtures/0101-compute-killed.cjs
?? supabase/tests/fixtures/0101-compute-malformed-diagnostic.cjs
?? supabase/tests/fixtures/0101-worker-process.cjs
?? tests/assessmentWorkerProcess.test.cjs
```

## Exact git status --short

```text
 M docs/MOVEMENT_LAUNCH_READINESS_REGISTER.md
 M docs/MOVEMENT_SYSTEM_SPEC.md
 M scripts/assessment-worker/compute.cjs
 M scripts/assessment-worker/run.cjs
 M scripts/assessment-worker/worker.cjs
 M tests/preDepartureRosterFreeze.test.cjs
?? docs/0101-linux-final-qualification/
?? docs/0101-linux-qualification/
?? docs/0101-local-qualification/
?? docs/0101-offline-qualification/
?? docs/0101-worker-deployment-boundary.md
?? docs/0101-worker-host-qualification.md
?? scripts/assessment-worker/package.json
?? scripts/assessment-worker/qualification-integration.cjs
?? scripts/assessment-worker/qualification-report.cjs
?? scripts/assessment-worker/qualify.cjs
?? scripts/assessment-worker/runtime.cjs
?? supabase/tests/0101_worker_host_qualification.test.cjs
?? supabase/tests/0101_worker_host_qualification_validation.cjs
?? supabase/tests/fixtures/0101-compute-killed.cjs
?? supabase/tests/fixtures/0101-compute-malformed-diagnostic.cjs
?? supabase/tests/fixtures/0101-worker-process.cjs
?? tests/assessmentWorkerProcess.test.cjs
```
