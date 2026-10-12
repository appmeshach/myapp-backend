# 0101 worker host qualification

Result: **INCOMPLETE** (QUALIFICATION_INCOMPLETE). Production host remains UNSELECTED / UNQUALIFIED; geographic support activation BLOCKED.

Host: local; machine: development-laptop; region: local. Mode: offline. Commit: 993c9c008620ebe8e2c1cbba37266724edb9c000; dirty working tree: true; worker source SHA-256: `5316734c92ae254c2689f1197e2e0e4f8363c8143990c5f47fc8d217596832fe`.

Environment: v24.13.1, win32/x64; Intel(R) Core(TM) i5-7200U CPU   2.50GHz; 4 logical CPUs. OS total/available memory: 8067.21/1345.21 MiB. Operator memory budget: 512.00 MiB.

Algorithm: shared_segment_geographic_assessment_v1; parameter fingerprint: `1625aa38ea035ad2c26a8c13a3a4df37714fc32624089fa3894f57c2ddda29d5`. Geometry SHA-256: `d48f53b5f7e2e226ed9a1c23d9dd1884e6a6350539e8e58b794061103db54043`; contracts SHA-256: `9ad2c9a1675a4caeb4a6d658bcb8b24fcaecc6ae1b101effea906b8e216eda95`.

| Case | Samples | Wall p50/max ms | Compute p50/max ms | Peak child RSS MiB | Unexpected outcomes |
| --- | ---: | ---: | ---: | ---: | ---: |
| small | 5 | 358.53/460.37 | 25.09/35.28 | 55.39 | 0 |
| ordinary | 5 | 734.28/806.94 | 369.22/381.34 | 72.63 | 0 |
| nearMaximum | 5 | 2989.81/4191.58 | 2307.25/3661.24 | 107.61 | 0 |
| coordinateLimit | 5 | 445.39/586.69 | 5.99/7.86 | 56.95 | 0 |
| resamplingLimit | 5 | 488.32/570.78 | 22.01/28.40 | 57.03 | 0 |
| denseCrossing | 5 | 3128.45/3680.35 | 2398.32/3242.24 | 75.46 | 0 |
| stalledChild | 1 | not measured/not measured | not measured/not measured | not measured | 0 |
| malformedChild | 1 | not measured/not measured | not measured/not measured | not measured | 0 |
| abnormalChild | 1 | not measured/not measured | not measured/not measured | not measured | 0 |
| constrainedHeap | 1 | not measured/not measured | not measured/not measured | not measured | 0 |

Each computation forks a fresh child. first-process-run means the first case invocation in this qualification supervisor; subsequent-process-run means later invocations. Neither measures provider startup. p95 is reported only with at least 20 samples; five runs give a descriptive median, not statistical certainty.

Lease: worst normal supervisor compute wall 4191.58 ms + 10000 ms publication/supervisor reserve; provisional ceiling 30000 ms (50% of 60000 ms). Remaining lease 45808.42 ms. No lease change.

Memory: parent peak 69.20 MiB; child peak 107.61 MiB. Gate uses their conservative sum at <=80% of the operator budget. V8 old-space 192 MiB is not an RSS cap; this test does not enforce a host cgroup.

| Queue jobs | First claim ms | Drain ms | Maximum age ms | Retries/failures/duplicates |
| ---: | ---: | ---: | ---: | --- |


Queue uses one compute slot. Local SQL bridge timing includes local connection and IPC overhead; it is not target-cloud HTTP latency. DB calls: 0; completed jobs: 0; transferred bytes: not measured.

Recovery: not measured. Signal delivery: windows_handler_dispatch. Windows handler dispatch does not prove host POSIX signal delivery.

Deduplication: not measured

Idle: offline_simulated_poll, 2007.95 ms, 2 samples, 2 polls, CPU 0.00 ms (interval p50/max 0.00/0.00 ms), RSS p50/max 61943808.00/61947904.00 bytes, maximum sampling lateness 7.86 ms.

Security: allowlisted logs true; credential-free child true; process leak check null; installed SQL/security null. No raw error, private ID or coordinate is serialized.

Usage/cost inputs: wall 44545.21 ms; child CPU 19544.00 ms; parent CPU 906.00 ms; idle polling interval 1000 ms. Monthly fixed cost: unknown (operator entered). No provider prices inferred.

Gates: correctness: PASS; reliability: PASS; lease: PASS; memory: PASS; process: NOT MEASURED; integration: NOT MEASURED; security: NOT MEASURED.

Blockers: integration_not_measured, process_not_measured, security_not_measured.
