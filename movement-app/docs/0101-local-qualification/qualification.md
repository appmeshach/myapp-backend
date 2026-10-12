# 0101 worker host qualification

Result: **INCOMPLETE** (QUALIFICATION_INCOMPLETE). Production host remains UNSELECTED / UNQUALIFIED; geographic support activation BLOCKED.

Host: local; machine: development-laptop; region: local. Mode: integration. Commit: 993c9c008620ebe8e2c1cbba37266724edb9c000; dirty working tree: true; worker source SHA-256: `5316734c92ae254c2689f1197e2e0e4f8363c8143990c5f47fc8d217596832fe`.

Environment: v24.13.1, win32/x64; Intel(R) Core(TM) i5-7200U CPU   2.50GHz; 4 logical CPUs. OS total/available memory: 8067.21/1294.37 MiB. Operator memory budget: 512.00 MiB.

Algorithm: shared_segment_geographic_assessment_v1; parameter fingerprint: `1625aa38ea035ad2c26a8c13a3a4df37714fc32624089fa3894f57c2ddda29d5`. Geometry SHA-256: `d48f53b5f7e2e226ed9a1c23d9dd1884e6a6350539e8e58b794061103db54043`; contracts SHA-256: `9ad2c9a1675a4caeb4a6d658bcb8b24fcaecc6ae1b101effea906b8e216eda95`.

| Case | Samples | Wall p50/max ms | Compute p50/max ms | Peak child RSS MiB | Unexpected outcomes |
| --- | ---: | ---: | ---: | ---: | ---: |
| small | 5 | 548.96/1615.27 | 32.59/75.07 | 56.62 | 0 |
| ordinary | 5 | 880.90/1232.88 | 460.44/652.50 | 73.12 | 0 |
| nearMaximum | 5 | 3199.67/4098.14 | 2495.19/3515.21 | 108.05 | 0 |
| coordinateLimit | 5 | 726.03/1232.86 | 6.06/8.12 | 56.60 | 0 |
| resamplingLimit | 5 | 446.37/612.70 | 20.52/38.11 | 56.67 | 0 |
| denseCrossing | 5 | 1065.06/1351.10 | 727.05/973.75 | 74.86 | 0 |
| stalledChild | 1 | not measured/not measured | not measured/not measured | not measured | 0 |
| malformedChild | 1 | not measured/not measured | not measured/not measured | not measured | 0 |
| abnormalChild | 1 | not measured/not measured | not measured/not measured | not measured | 0 |
| constrainedHeap | 1 | not measured/not measured | not measured/not measured | not measured | 0 |

Each computation forks a fresh child. first-process-run means the first case invocation in this qualification supervisor; subsequent-process-run means later invocations. Neither measures provider startup. p95 is reported only with at least 20 samples; five runs give a descriptive median, not statistical certainty.

Lease: worst normal supervisor compute wall 4098.14 ms + 10000 ms publication/supervisor reserve; provisional ceiling 30000 ms (50% of 60000 ms). Remaining lease 45901.86 ms. No lease change.

Memory: parent peak 91.20 MiB; child peak 108.05 MiB. Gate uses their conservative sum at <=80% of the operator budget. V8 old-space 192 MiB is not an RSS cap; this test does not enforce a host cgroup.

| Queue jobs | First claim ms | Drain ms | Maximum age ms | Retries/failures/duplicates |
| ---: | ---: | ---: | ---: | --- |
| 1 | 124.29 | 733.60 | 754.64 | 0/0/0 |
| 10 | 39.39 | 15521.12 | 15501.46 | 0/0/0 |
| 100 | 40.84 | 173766.55 | 173739.72 | 0/0/0 |

Queue uses one compute slot. Local SQL bridge timing includes local connection and IPC overhead; it is not target-cloud HTTP latency. DB calls: 695; completed jobs: 117; transferred bytes: not measured.

Recovery: before_claim: PASS; stale_token: PASS; after_claim: PASS; child_kill: PASS; lost_publication_ack: PASS; sigterm_idle: PASS; sigint_idle: PASS; sigterm_compute: PASS; calculation_failed: PASS. Signal delivery: windows_handler_dispatch. Windows handler dispatch does not prove host POSIX signal delivery.

Deduplication: 100 registrations -> 1 canonical job; 100 selected-boundary reuse operations -> 0 new computations; 1 publication.

Idle: local_sql_worker_poll, 2014.95 ms, 2 samples, 2 polls, CPU 0.00 ms (interval p50/max 0.00/0.00 ms), RSS p50/max 80879616.00/81244160.00 bytes, maximum sampling lateness 14.62 ms.

Security: allowlisted logs true; credential-free child true; process leak check true; installed SQL/security true. No raw error, private ID or coordinate is serialized.

Usage/cost inputs: wall 354312.08 ms; child CPU 50524.00 ms; parent CPU 6829.00 ms; idle polling interval 1000 ms. Monthly fixed cost: unknown (operator entered). No provider prices inferred.

Gates: correctness: PASS; reliability: PASS; lease: PASS; memory: PASS; process: NOT MEASURED; integration: PASS; security: PASS.

Blockers: process_not_measured.
