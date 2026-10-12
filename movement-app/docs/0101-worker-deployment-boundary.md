# 0101 private worker deployment and qualification boundary

No production host is selected or qualified. Geographic support production
activation remains **BLOCKED**. This milestone creates tooling and a process
contract, with no provider account, service, purchase or deployment.

## Runtime and reproducible source layout

Use Node **24 or later**, with its default native TypeScript stripping enabled.
The verification runtime is Node **24.13.1**. Do not pass
`--no-experimental-strip-types`. The CommonJS supervisor intentionally requires
the existing erasable TypeScript modules directly. Offline and isolated-process
tests prove that path on Windows and Linux. There is no ts-node, tsx, transpiler,
workspace or custom loader, and no geometry port.

Keep the complete repository layout (including `supabase/functions/_shared`)
when preparing a source release. Copying only `scripts/assessment-worker` is
insufficient. The runtime uses Node built-ins and the existing local TypeScript
source graph; it needs no npm installation, root Expo build or new dependency.
`scripts/assessment-worker/package.json` declares the runtime/start commands and
no dependencies. Native TypeScript support is checked through the real worker
entrypoint, not inferred from the application toolchain. The app runtime is unchanged.

Native stripping and module limitations follow the
[Node 24 TypeScript documentation](https://nodejs.org/docs/latest-v24.x/api/typescript.html).
Windows signal limitations follow the
[Node process signal documentation](https://nodejs.org/docs/latest-v24.x/api/process.html#signal-events).

From the repository root:

```sh
node scripts/assessment-worker/run.cjs
node scripts/assessment-worker/run.cjs --once
```

Or run `npm start --prefix scripts/assessment-worker`. There is no worker build
step, HTTP listener, Dockerfile, provider descriptor or global CLI requirement.
Docker is used by the existing local DB harness and by local Linux signal QA,
not as the deployment architecture.

## Exact environment contract

| Variable | Requirement |
| --- | --- |
| `SUPABASE_URL` | Required server origin; HTTPS, or HTTP only for localhost, 127.0.0.1 or the existing local kong hostname. No userinfo, path, query or fragment. |
| `SUPABASE_SERVICE_ROLE_KEY` | Required nonempty secret without whitespace. Supports the existing legacy service-role JWT and modern `sb_secret_` transport convention. |

No other worker environment variable is required. Native TS stripping must
remain enabled. Do not load application `.env` files automatically. Supply only
worker credentials through the host's private secret injection facility. Do not
put keys on command lines, in logs, source control, app configuration or reports.
Qualification host/cost labels are CLI inputs, not worker settings. Offline
qualification never reads these credentials. Integration ignores them and uses
only a fixed local Docker container plus an ephemeral localhost bridge.

The sequential worker has one compute slot, a one-second interval between
operations (including idle polling), an unchanged
60-second DB lease, 15-second maximum isolated compute wall budget, 192 MiB child
V8 old-space cap, five-second control I/O budgets and three maximum DB attempts.
The heap setting is not an OS RSS limit. A candidate must supply enforced CPU and
memory limits and prove its normal workload fits them; these scripts do not
silently enlarge any canonical budget.

Qualification found a supervisor diagnostic defect on local Linux: a native heap
OOM was reported on stderr in about 389 ms, but delayed native process/stream
closure caused the old parser to report its external timeout. The supervisor now
rejects a complete non-metric stderr line immediately as compute_terminated,
without logging its contents. It still requires a clean exit plus one strict
canonical result and one valid metric record for success. No frozen geometry,
lease, retry, publication or normal compute budget changes. A new live-child
malformed-diagnostic fixture protects this boundary.

## Liveness, readiness, logs and shutdown

Structured newline JSON events are `worker_started`, `worker_ready`,
`worker_heartbeat`, `job_transition`, `shutdown_started`, `worker_stopped` and
`bootstrap_failed`. The fixed allowlist permits timestamps, uptime, versions,
coarse transition/result category, attempt count, duration, CPU/RSS and poll
count. It removes job/member/evidence IDs, shapes, context, raw errors and keys.

`worker_started` follows runtime/argument/configuration validation. Readiness
requires a successful authenticated existing service-only claim RPC, including
an idle response. This is ordinary worker polling, not an extra health claim.
An idle heartbeat shows event-loop progress and reports supervisor RSS/polls.
During compute, the next heartbeat follows the bounded operation; a one-second
heartbeat cadence is not promised during active work. Watch process exit and
heartbeat age; no public health endpoint is provided.

Missing/invalid config, unsupported Node, invalid CLI arguments and unrecoverable
claim/control bootstrap failures exit nonzero with a fixed sanitized error.
No-job `--once` exits zero after authenticated readiness. Recoverable job failures
remain governed by the existing bounded DB retry policy.

SIGTERM/SIGINT set a single shutdown state and abort compute/control I/O. No new
claim starts afterward. An active isolated child receives SIGKILL through its
existing abort boundary. No partial result is published. An unresolved running
job stays fenced until lease expiry, after which a fresh token can reclaim it.
The process normally exits zero; a six-second shutdown watchdog exits nonzero if
abort does not settle. The host's termination grace period should exceed six
seconds. No background transaction is held during compute, polling or idle sleep.

On Windows, automatic process tests dispatch the handler over a test-only IPC
channel because Node's Windows `child.kill` terminates rather than delivers POSIX
signals. The production entrypoint exposes no IPC/test switches. The report marks
this distinction and leaves its process gate incomplete on Windows. Linux
process tests use actual OS signals. A separate local Linux test proves the
boundary but does not qualify a Windows machine or an actual cloud host.

## Qualification commands and reports

```sh
node scripts/assessment-worker/qualify.cjs --offline --runs 5 --memory-limit-mb 512 --output tmp/0101-offline
node scripts/assessment-worker/qualify.cjs --integration --runs 5 --memory-limit-mb 512 --idle-seconds 2 --output tmp/0101-integration
node scripts/assessment-worker/qualify.cjs --offline --idle-minutes 60 --provider candidate --machine plan-name --region region-name --output tmp/0101-idle
```

Integration requires the existing `supabase_db_movement-app` local container and
installed historical schema. It creates a schema-only disposable database,
verifies installed sources/owners/ACLs/RLS and fingerprints the original before
and after; it never accepts a URL, remote project, production credential or a
provider endpoint. Its queue and failure tests use the same shipped HTTP backend,
worker and frozen child, connected to a local SQL bridge in the clone. Candidate
offline performance/idle measurements can run on any conventional Node host.
Target-host control-path readiness is separately observable by starting the
normal worker with explicitly non-production credentials and legitimate test jobs.
The clone harness requires local Docker and is not a cloud database provisioning
tool. A future target must reproduce lifecycle tests against disposable
infrastructure rather than treat local results as remote proof.

Options: exactly one mode; repetitions 1..20 (default 5); idle minutes greater
than 0 through 60; test idle seconds greater than 0 through 10; one idle unit only;
memory budget 64..1,048,576 integer MiB. Optional operator labels: `--provider`,
`--machine`, `--region`, `--currency`; bounded `--monthly-fixed-cost` requires a
currency. Labels reject URLs, UUIDs, credential-like strings and multiline text.
No billing lookup occurs. `--output` writes `qualification.json`,
`qualification.md` and `qualification.schema.json`. Without it, Markdown is
printed only. Invalid arguments/failed execution or an UNQUALIFIED report exit
nonzero. INCOMPLETE is a successful measurement but not an activation approval.

The schema version is `movement_worker_host_qualification_v1`. It uses strict
required fields and rejects extra fields at every object boundary. Sections are
host/environment, algorithm fingerprints, worker settings, per-case samples and
statistics, queue, deduplication, recovery, idle, security, usage, lease, gates,
classification and reasons. No canonical result intervals, geometry coordinates,
private URLs, identities, provider references or secrets enter the report. Hashes
of complete frozen results permit deterministic equality without serializing them.

Six unchanged 0099 fixtures run five times by default: small shared line,
ordinary approximately 15 km, near maximum, coordinate limit, resampling limit
and dense crossing. Expected result SHA-256 hashes were pinned before editing
against the frozen engine and the existing 0099 benchmark expectations. Source
hashes and the parameter fingerprint are separately checked. Four adversarial
fixtures run once: deliberate stall, malformed IPC, abnormal exit and real
constrained-heap OOM. A killed child and calculation_failed retry are also tested
through the integration lifecycle.

Each successful sample records original/resampled counts, work/result category,
parent wall, child compute/CPU, peak RSS, timeout and complete-result hash. No
result is invented for a runtime failure. Aggregates include minimum, p50,
maximum, failures/timeouts/abnormal terminations and maximum RSS. p95 uses the
nearest-rank method only with at least 20 observations. Tiny samples are
descriptive, not statistical assurance. `first-process-run` is the first
invocation of this supervisor; all later invocations are `subsequent-process-run`.
Every compute uses a fresh child; no hardware/provider cold-start claim is made.

## Gates and measurement limits

| Gate | Provisional candidate requirement |
| --- | --- |
| Correctness | Every normal complete-result hash, frozen source hash, algorithm version and parameter fingerprint match. Deterministic limits remain processing_limit. |
| Reliability | No unexpected normal failure; adversarial timeout/crash/malformed/OOM classifications match. None becomes processing_limit. |
| Lease | Worst successful normal supervised compute wall plus 10-second existing publication/recovery reserve <=30 seconds (50% of the unchanged 60-second lease). |
| Memory | No normal OOM; conservative sum of parent and normal child peak RSS <=80% of explicit operator memory budget. |
| Process | Start/stop/restart/fencing tests pass with actual POSIX delivery on the measured platform. Windows handler tests alone remain incomplete. |
| Integration | 1/10/100 drains have no retries, failures or duplicate publications; 100 registrations -> one job; 100 later selected-boundary reuse operations -> zero compute and one publication. |
| Security | Fixed logs, credential-free child and captured-process leakage checks pass; clone installed SQL authority is verified. |

The 50% lease rule is a qualification screen, not a production SLA: the old local
worst case was roughly 2.43 seconds, far below the 15-second compute cap. A
10-second publication/recovery reserve retains the current 0099 reasoning and
leaves another half-lease for context load, connectivity variation and scheduling.
Candidate end-to-end network/DB latency must still be measured; local bridge
latency is not target-cloud latency. Never extend the lease to make a slow host pass.
The 20% memory reserve is an explicit provisional budget screen for allocator,
runtime and scheduling variation, not proof of OOM safety under an enforced host
limit. OS memory metadata may describe the host rather than cgroup allowance;
the operator must enter the actual candidate allocation and observe enforced limits.

Any false gate yields `unqualified` / `HOST_UNQUALIFIED`; missing measurements,
missing memory budget or fewer than five runs yield `incomplete`. All gates
passing yields `qualified` / `LOCAL_SAMPLE_QUALIFIED` within that sample only.
None selects a production host or clears the launch gate.

Queue fixtures are legitimate distinct canonical pairs. One slot drains them
sequentially with the same one-second interval as run.cjs; no 100-child fanout.
The drain clock starts after registration in the running qualification supervisor,
and stops at the last completion acknowledgement, excluding inspection queries.
Metrics include first claim, compute summary,
total drain, DB-created-to-completed maximum age, retry/failure/duplicate counts
and parent RSS. DB connection behavior is one serialized autocommit bridge
connection, with no transaction held over geometry. Counted DB calls are service
control RPCs; fixture setup, verification and inspection queries are excluded.
Bytes transferred are deliberately unmeasured. CPU totals exclude abnormal child
fixtures without valid diagnostics and external database CPU; they are not a
complete provider billing meter.

Accepted child CPU diagnostics are summed; diagnostics lost when a supervisor is
killed before acknowledgement are excluded. This is measured use, not an exhaustive
billable total. The stalled-child probe has a deliberate one-second deadline;
malformed/crash probes use five seconds; the heap-OOM probe uses the existing
15-second worker deadline so GC pressure is not judged against a shorter smoke
budget. Normal worker budgets and the lease are unchanged.

Failed fixture samples have null metrics: an aggregate peak of zero in those
cases means no accepted RSS diagnostic, not a zero-memory process. Idle resource
samples include the qualification supervisor's report/fixture module overhead;
use normal worker heartbeats and host metrics for later standalone idle sizing.

Restart scenarios cover kill before claim, kill after claim/load barrier, natural
60-second lease expiry/reclaim, stale-token finalization, child SIGKILL/bounded
retries, kill after publication COMMIT before response acknowledgement, idle
SIGTERM/SIGINT and active-compute SIGTERM. Only the graceful-compute cleanup
fixture advances its orphan lease in the disposable clone; natural expiry is
separately measured. Atomic publication/completion and recovery-only exact reuse
remain authoritative. Qualification failures do not publish geographic evidence.

Idle sampling records supervisor RSS, heap, process CPU delta, sampling lateness
and poll count. Offline idle uses explicitly labelled simulated no-DB polls;
integration idle uses real service claim RPCs against an empty cloned queue.
Automated smoke durations are short. Later operators should repeat bounded
one-hour observations for multi-hour measurements and inspect host CPU, RSS,
restart and billing metrics. No DB transaction is held during idle time.

## Service-role risk and cost ledger

The supervisor calls existing service-only RPCs whose installed grants require
`service_role`. The job table itself has no direct service-role table grant and
has RLS with no policies, but that does not narrow the credential's authority
elsewhere. A leaked service-role/modern secret can expose or mutate other
privileged Supabase data through capabilities available to that key. Treat the
supervisor host as trusted infrastructure. The compute child gets no inherited
environment, key, job token or identity; it cannot publish or access Supabase.

A dedicated DB/JWT execution role with only the required RPC grants is feasible
as a later separately reviewed authorization/transport change. An ordinary modern
secret key is not asserted to be such a role. Credential narrowing is deferred;
secure server-side secret injection, access control, redaction, rotation/revocation
planning and accepting this residual broad-authority risk are launch-required.

Review host crash-dump collectors, access and retention as part of secret handling:
supervisor dumps could contain keys, and child dumps could contain private shapes.
The local Linux test kernel has a piped collector; disabling the process core limit
alone did not remove its delayed closure. Do not assume process-level limits
prove that a host will never collect privileged memory. No dump contents are
logged or included in qualification artifacts.
No auth redesign or critical new flaw was found in 0101.

Required before activation: one qualified Node host, secure secrets, restart
supervision, sufficient enforced CPU/memory, Supabase connectivity and successful
qualification on the target allocation. Strongly recommended: logs, CPU/RAM,
restart count, queue depth/age, heartbeat and cost alerts/budget thresholds.
Optional: replicas, autoscaling, PGMQ, Redis, managed queue, monitoring vendor,
VPS and orchestration. No new paid service was introduced. Fixed monthly cost,
idle CPU/RSS, child CPU and control-RPC usage are inputs for later operator billing
analysis; no Railway/Fly/Render prices are manufactured.

## Future manual candidate procedures — not performed

Intended review order only: Railway, Fly.io, Render, small VPS/conventional Node.
No provider order is encoded in runtime logic and no provider is selected. Exact
provider dashboard/CLI syntax must be verified when that later work is authorized.

For **Railway**, later create a non-production worker service, provide the complete
source tree and verified Node 24 runtime, set the root start command above, inject
non-production credentials, use one replica/slot, run offline qualification on
the actual allocation and exercise legitimate disposable jobs through the normal
worker. Observe CPU/RSS/restarts, readiness/heartbeats, idle use and estimated
billing; export reports and stop/delete the test service when finished.

For **Fly.io**, later prepare a non-production background process/machine with
Node 24 and the same source/start/environment, one compute slot and explicit
machine memory. A container may be prepared then if it is the chosen packaging
mechanism; 0101 imposes none. Verify shutdown signal/grace handling, connectivity,
offline and disposable lifecycle qualification, idle CPU/RSS/restarts and billing;
export reports and stop/delete the candidate when finished.

For **Render**, later create a non-production background worker with verified
Node 24 and the complete source tree, no build step, the same start command and
private non-production credentials. Keep one slot, run allocation-specific
qualification and disposable jobs, inspect graceful shutdown/restarts, idle use,
metrics and estimated billing; export reports and stop/delete after qualification.

For a **VPS/conventional Node host**, later prepare a least-privilege service
account, Node 24, immutable source release, protected secret injection and a
process supervisor (such as the host's service manager) with restart-on-failure
and a grace period above six seconds. Set enforced CPU/RSS controls, retain one
slot and test network access, offline cases, real signals, disposable lifecycle,
idle/queue metrics and operator-entered cost. Export reports and stop/remove the
non-production test service when no longer required.

No public HTTP service, cloud SDK, provider CLI, Redis, PGMQ, external queue,
Kubernetes or production migration is needed for this boundary.
