# 0103 qualification supervisor foundation

The [0104 child and reader foundation](0104-qualification-child-and-provider-adapters.md)
adds an explicit fixed inherited-IPC child adapter and an injected execution validator.
It consumes WeakMap authority in the parent after fsync, never serializes the object,
and waits for acknowledged receipt plus exact Node exit signal. No default adapter
is installed. Exact live execution input/return/pagination schema remains absent
locally, and no execution query is guessed. The local reservation limitation and
platformRestart:null remain unchanged.

This is a local qualification-only orchestration library for a future fresh disposable
Railway worker scenario. It does not authorize or implement a live qualification.
`run.cjs` is unchanged: no crash flag, environment switch, supervisor import or kill
endpoint exists. There is no supervisor CLI and no default remote worker/process or
provider execution adapter. All implementation tests inject synthetic transports.

`qualification-supervisor.cjs` exports `supervise`, `controlledWorker`, a strict phase
recorder and `readQuery`. The latter delegates only the two existing reviewed fixed
queries to the bounded authenticated Railway CLI boundary. No mutation, subscription,
arbitrary execution query or token input is accepted. Provider adapters expose exactly
one `read` method; code capabilities must be reviewed, never supplied as operator JSON,
booleans, screenshots or prose. Production execution traversal is still unknown in
the existing local schema knowledge and must be reviewed before an adapter is added.

Startup requires the existing disposable acknowledgement, environment kind and
production/inactive denylist before any provider, database or worker activity. It also
requires a fresh report with exact current worker-source/migration binding, Railway
identity bindings, authenticated fresh in-memory fixture capsule, designated job UUID,
known original execution/deployment, a 32-byte nonce and an existing absolute journal
directory outside the repository. This work never reads the preserved
`0102-remote-fixtures.capsule` file.

The state sequence is:

`initialized -> provider_preflight -> job_registered -> original_claim_observed ->
fault_authorized -> fault_observed -> provider_recovery_wait ->
replacement_execution_observed -> lease_reclaim_observed -> stale_token_fenced ->
publication_observed -> completed`.

Failures enter terminal `failed`. Repeated, skipped, backward or unknown phases and
backward/invalid timestamps reject. The phase recorder itself is not an evidence
verifier and cannot grant a measurement; only the orchestrator supplies proven
transitions. The qualification report, source, migrations, project, provider, machine,
region, provider identities, designated job and supervisor nonce hash are bound at
startup. Plan data is privately copied before asynchronous work.

The journal is a LOCAL SUPERVISOR RESERVATION. The supervisor atomically creates
`<qualificationRunSha256>.0103.jsonl` with `wx` and fsyncs the initial binding before
activity. O_EXCL prevents duplicate/resumed execution for that report only inside the
same canonical local journal directory, independent of nonce or job changes there.
Existing partial, malformed, failed or completed files block another invocation in
that directory. Journals are never read/resumed as evidence or release authority.
Preparation failure deliberately consumes this local slot.

This reservation does not establish distributed exclusivity across another workstation
or a different/lost state directory. Deletion/loss of a journal is not machine-prevented
by this foundation. Keep a protected stable journal directory; deleting its contents
is not an authorized resume procedure. Cross-process/cross-workstation one-shot
authority remains an operational qualification prerequisite. The in-process WeakMap
release capability still binds and consumes one authorization; it cannot be fabricated
from serialized journal data.

Existing database semantics independently protect an already-consumed job and its
unchanged canonical identity, not an entire qualification run or fixture pair across
all possible contexts. In 0099, the job UNIQUE key is
`(offerer_route_evidence_id, requester_route_evidence_id, algorithm_version,
input_context_fingerprint)` (line 30). Registration's ON CONFLICT DO NOTHING and
locked lookup (lines 120–131) return the existing job and attempt count for that key;
the caller does not choose a new job UUID. The protection trigger prohibits deletion,
identity changes, attempt resets and changes to terminal jobs (lines 47–65). Claim
increments the attempt (lines 152–157); the supervisor rejects a nonzero registration
or a different returned job identity.

Those constraints do not uniquely key a disposable fixture pair or qualification
report. 0096's canonical context includes intent version/status/timing, route evidence
and endpoint references (lines 113–124). Changed current evidence/context can produce
another uniqueness key for the same fixture selectors; registration has an insertion
path for that key. 0092's requester_route_evidence_one_current index restricts only
current rows for a need; its source explicitly permits superseding earlier rows
(lines 127–132). The existing 0093 writer actually supersedes the old current row and
inserts replacement requester evidence for the same need (lines 246–249). Thus a
global designated-fixture one-shot property is not proven.
Changing only the proposed jobId cannot bypass unchanged-key registration, but existing
job protections must not be generalized to all future contexts or workstations. The
existing 0099 harness covers duplicate registration, immutable identity, retained
attempts and terminal jobs; no DB query is needed for this source-level conclusion.
No migration or database persistence change is made.

Directory hardening reuses the operator signing-key boundary's repositoryRoot/within
helpers: the supplied path must be absolute, the directory itself cannot be a symlink,
and the canonical realpath must still be a directory. Both lexical and resolved paths
must lie outside the repository/worktree. Exclusive journal creation remains, and no
resume/evidence intake is added. This boundary does not claim to prevent external
filesystem replacement or deletion; operators must protect the directory.

The explicit 0104 dedicated child adapter wraps `controlledWorker` preparation. Registration must be
pending attempt zero for the designated capsule pair. The supervisor reads the actual
pending DB snapshot and requires zero publication, no assessment and no lease. Worker
preparation then claims exactly attempt one and loads the exact fixture context with
no reused assessment. A second DB snapshot must match job, participants, availability,
original token and expiry, running attempt one and zero publications. Exact nonce/run/
job/execution tickets protect every worker method. The original running provider
execution is re-observed before authorization. A bounded observer failure or timeout
prevents release. Authorization is fsynced before `fire` invokes the existing
`controlledFailure` primitive using privately cached register/claim/load results;
it never makes a second claim. The worker's fire closure is also one-shot.
Release additionally requires an unforgeable in-process capability minted only after
durable authorization. It is bound to the exact nonce/run/job/execution ticket,
consumed on fire, and revoked on timeout/failure. A nonce, boolean or fabricated
authorization object cannot directly invoke the worker's termination path. This
foundation intentionally provides no serialized capability decoder. 0104 consumes
the capability in the parent and uses an inherited-channel sequence for child release;
operational host/process qualification remains a prerequisite.

There is no default termination capability. The explicit 0104 child adapter can
execute the primitive in its own dedicated worker process, forward the private
observer handshake, and observe process exit without terminating the supervisor.
The primitive's existing five-second observer bound remains. Synthetic tests replace
termination and interpret the primitive's fixed "termination returned" test error.
This does not make the supervisor operationally qualified for live use.

Provider reads and DB captures have five-second bounds; recovery polling has a
three-minute clock deadline and bounded poll count. No restart/deploy/redeploy is
performed: the supervisor waits for the same original execution to become
CRASHED/RESTARTING, then a distinct RUNNING execution on the same deployment/service/
environment/instance. Policy must remain ON_FAILURE or ALWAYS with at least one
retry. Existing `correlateRestart` independently verifies the final strict lifecycle.
Policy alone, RUNNING alone, changed identities, malformed observations or ambiguity
cannot complete correlation.

The DB chain is mandatory: running attempt one with original token, zero publications
and no assessment; running attempt two after original expiry with a different token,
zero publications and no assessment; old-token load returning exactly lease_invalid;
then completed attempt two, the replacement token, valid assessment identity and
exactly one publication. Completion must follow reclaim, which must follow expiry
and replacement creation. Missing intermediate observations fail closed; a fast
completion cannot substitute for the required running attempt-two snapshot. Existing
`recoveryFromSnapshots` and `correlateRestart` validate the final chain too.

Claim time is not returned by the existing RPC. Evidence retains the observed RPC
expiry and local termination clock separately from `derivedLeaseStartAt`, with
`leaseDurationMs = 60000` and
`leaseStartDerivation = "leaseExpiresAt - leaseDurationMs"`. Deadline-capped expiry
makes this a conservative derived boundary, not observed claim time. UTC PostgreSQL
microseconds are strictly calendar-validated and normalized to millisecond precision.
There is no `claimedAt` field.

Persisted journals and returned evidence contain only hashes, fixed metadata/enums,
validated timestamps, phase sequence and correlation projections. Raw job/participant/
assessment UUIDs, lease tokens, nonce, capsule, fixture key, service-role value, DB
password, provider session or private key never persist. Private snapshots and cached
worker responses stay in memory. Failures use one fixed sanitized error. Artifacts
are informational correlation evidence, not signed operator evidence, and are never
accepted as input to authorize faults or promote operator measurements.

Automatic restart attribution remains unresolved. No authoritative restart-origin
field/mechanism exists in the current local schema knowledge. Absence of supervisor
mutations cannot exclude an outside operator restart. Every completed supervisor
artifact therefore has `platformRestart: null` and
`restartAttribution: { measurement: null, limitation: "restart_origin_unattributable" }`.
No process gate or operator-evidence-v3 behavior is promoted. Policy plus execution
lifecycle and DB recovery establish correlation only; no restart PASS or technically
qualified host is claimed.

Before any live use: separately authorize a fresh disposable project/capsule/run;
review the provider execution QUERY traversal and dedicated child/observer adapter;
preserve a durable journal; arrange unused fixture sequencing and capture cadence;
review cross-process/cross-workstation one-shot authority;
and resolve authoritative automatic-restart origin. The old disposable fixtures/run
must not be reused. Live use is not yet authorized or operationally qualified.

Reservation-review validation: 97/97 supervisor focused tests PASS. The final combined
0103/0102/0101/0099, worker-process and migration-integrity run has 454 PASS, zero
failures and one POSIX-only Windows skip (455 total). It includes all 136 existing
Railway and 71 operator-evidence tests. App, Edge and worker typechecks PASS. The
earlier foundation's local 0102 SQL catalog/fixture/recovery workflow PASS preserved
the original database fingerprint. This reservation review uses source/schema/tests
only and performs no DB query. Supervisor adapters remain synthetic, not an
operationally qualified SQL/provider/process integration. All 99 migrations, normal
worker entry and pinned trust identity are unchanged. Operator evidence v3 behavior
is preserved; its only code adjustment exports the existing repository path helpers.
The foundation's secret-pattern scan covered 630 source/test/documentation files, excluding secret
files, credential caches and the preserved capsule; matches were synthetic test
literals only. No live provider call, production action, staging, commit, push,
deployment, provider restart/redeploy or Supabase project lifecycle action occurred.
# 0105 follow-up

[0105](0105-railway-execution-schema-and-topology.md) retains the directory-local
journal scope. A completed record is now retained privately by worker object only
after successful final journal persistence, for local adapter sequence correlation.
Serialized evidence cannot mint that record or prove provider identity/restart origin.
