# 0101 worker host qualification

Result: **INCOMPLETE** (QUALIFICATION_INCOMPLETE). Production host remains UNSELECTED / UNQUALIFIED; geographic support activation BLOCKED.

Host: local; machine: linux-1cpu-512MiB; region: local. Mode: offline. Commit: unknown; dirty working tree: true; worker source SHA-256: `5316734c92ae254c2689f1197e2e0e4f8363c8143990c5f47fc8d217596832fe`.

Environment: v24.13.1, linux/x64; Intel(R) Core(TM) i5-7200U CPU   2.50GHz; 4 logical CPUs. OS total/available memory: 3855.27/1607.63 MiB. Operator memory budget: 512.00 MiB.

Algorithm: shared_segment_geographic_assessment_v1; parameter fingerprint: `1625aa38ea035ad2c26a8c13a3a4df37714fc32624089fa3894f57c2ddda29d5`. Geometry SHA-256: `d48f53b5f7e2e226ed9a1c23d9dd1884e6a6350539e8e58b794061103db54043`; contracts SHA-256: `9ad2c9a1675a4caeb4a6d658bcb8b24fcaecc6ae1b101effea906b8e216eda95`.

| Case | Samples | Wall p50/max ms | Compute p50/max ms | Peak child RSS MiB | Unexpected outcomes |
| --- | ---: | ---: | ---: | ---: | ---: |
| small | 5 | 805.34/1251.28 | 66.87/89.68 | 76.59 | 0 |
| ordinary | 5 | 1195.35/1662.10 | 659.19/799.72 | 87.12 | 0 |
| nearMaximum | 5 | 3319.05/3785.87 | 2878.75/3280.22 | 108.94 | 0 |
| coordinateLimit | 5 | 452.49/623.96 | 5.85/9.98 | 76.35 | 0 |
| resamplingLimit | 5 | 463.07/669.04 | 12.45/65.62 | 77.18 | 0 |
| denseCrossing | 5 | 4305.63/4368.32 | 3854.14/3965.27 | 96.79 | 0 |
| stalledChild | 1 | not measured/not measured | not measured/not measured | not measured | 0 |
| malformedChild | 1 | not measured/not measured | not measured/not measured | not measured | 0 |
| abnormalChild | 1 | not measured/not measured | not measured/not measured | not measured | 0 |
| constrainedHeap | 1 | not measured/not measured | not measured/not measured | not measured | 0 |

Each computation forks a fresh child. first-process-run means the first case invocation in this qualification supervisor; subsequent-process-run means later invocations. Neither measures provider startup. p95 is reported only with at least 20 samples; five runs give a descriptive median, not statistical certainty.

Lease: worst normal supervisor compute wall 4368.32 ms + 10000 ms publication/supervisor reserve; provisional ceiling 30000 ms (50% of 60000 ms). Remaining lease 45631.68 ms. No lease change.

Memory: parent peak 90.55 MiB; child peak 108.94 MiB. Gate uses their conservative sum at <=80% of the operator budget. V8 old-space 192 MiB is not an RSS cap; this test does not enforce a host cgroup.

| Queue jobs | First claim ms | Drain ms | Maximum age ms | Retries/failures/duplicates |
| ---: | ---: | ---: | ---: | --- |


Queue uses one compute slot. Local SQL bridge timing includes local connection and IPC overhead; it is not target-cloud HTTP latency. DB calls: 0; completed jobs: 0; transferred bytes: not measured.

Recovery: not measured. Signal delivery: posix_signal. Windows handler dispatch does not prove host POSIX signal delivery.

Deduplication: not measured

Idle: offline_simulated_poll, 2000.30 ms, 2 samples, 2 polls, CPU 2.09 ms (interval p50/max 1.03/1.41 ms), RSS p50/max 94724096.00/94724096.00 bytes, maximum sampling lateness 1.22 ms.

Security: allowlisted logs true; credential-free child true; process leak check null; installed SQL/security null. No raw error, private ID or coordinate is serialized.

Usage/cost inputs: wall 57510.87 ms; child CPU 36214.95 ms; parent CPU 1056.55 ms; idle polling interval 1000 ms. Monthly fixed cost: unknown (operator entered). No provider prices inferred.

Gates: correctness: PASS; reliability: PASS; lease: PASS; memory: PASS; process: NOT MEASURED; integration: NOT MEASURED; security: NOT MEASURED.

Blockers: integration_not_measured, process_not_measured, security_not_measured.
