# 0102 disposable remote staging worker qualification

Baseline: `dd66ebb`, branch `feature/0092-shared-segment-suitability`.
Production activation remains **BLOCKED**. This milestone provisions no environment,
deploys nothing and changes no Movement migration, geometry, participant UI or worker authority.

The 0096 assessment, 0099 job, trusted route and availability histories deliberately
reject deletion. Qualification retains its immutable synthetic records. The operator
must destroy the entire dedicated disposable Supabase environment afterward.
There is no record cleanup, trigger bypass, DELETE/TRUNCATE control, admin cleanup RPC,
automatic project creation/destruction or automatic host acceptance.

## Operator and host workflow

1. Check the exact staging cost before creating anything. Provision a dedicated,
   empty, disposable Supabase environment externally, with no copied production data.
   Apply the repository migrations through 0099 using the normal provisioning workflow.
   0100/0101 introduce no additional Movement database migration.
2. On the operator workstation, install `psql` separately and configure the explicit
   qualification variables below. Run the read-only schema preflight.
3. Prepare four synthetic fixture pairs on the workstation. The command rechecks
   schema prerequisites before writing. It uses session-local historical builders,
   reserved `0102-disposable` labels and `@0102-disposable.invalid` addresses, fresh
   UUIDs, synthetic routes and the existing trusted requester route claim/publication
   RPCs. It refuses an environment with existing members/jobs. No job is hand-inserted.
4. Transfer the encrypted capsule and its encryption key to the candidate host as
   private secrets. **Do not transfer the Postgres admin password.** Protect the capsule
   and key together: they reveal private synthetic fixture identities when combined.
5. Run remote qualification privately without a public HTTP listener or domain.
   Stop competing workers. Never reuse this disposable environment for production.
6. Record actual provider restart behavior and host secret/access controls separately.
   The command cannot inspect Railway secret storage or prove its platform restart
   policy. It leaves those measurements null; it does not accept self-attestation flags.
7. Destroy the whole disposable Supabase environment externally. Verify destruction,
   then record final operator acceptance separately. The tooling never certifies teardown.

```sh
node scripts/assessment-worker/qualify-remote-schema.cjs --ack-disposable-environment
node scripts/assessment-worker/prepare-remote-fixtures.cjs --ack-disposable-environment --output /private/0102.capsule
node scripts/assessment-worker/qualify.cjs --remote-staging --ack-disposable-environment --runs 5 --memory-limit-mb 512 --provider Railway --machine Hobby --region ACTUAL_REGION --output /private/0102-report
```

The first command is strictly read-only. The second is a distinct, explicit fixture
write command. The hosted command registers jobs and runs the worker through existing
service-role HTTP RPCs. Preparing synthetic state externally is necessary because
the frozen worker RPC boundary provides no general participant/fixture creation API;
adding one or shipping an admin password to Railway would widen authority.

## Environment contract and denylist

All commands require:

| Variable | Requirement |
| --- | --- |
| `MOVEMENT_QUALIFICATION_ENVIRONMENT_KIND` | Exactly `disposable` |
| `MOVEMENT_QUALIFICATION_PROJECT_REF` | Explicit 20 lowercase letters/digits |
| `MOVEMENT_QUALIFICATION_SUPABASE_URL` | Exactly canonical HTTPS `<ref>.supabase.co`, optional trailing slash |
| `MOVEMENT_QUALIFICATION_SERVICE_ROLE_KEY` | Disposable service-role JWT or modern secret key |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are never fallback inputs. Both
`xdfmoggrsucisfybqctb` and `udlsysezmzutydnifhsq` are hard-coded forbidden refs in
qualification tooling only. They fail before network, authentication, probing or
process creation. Ref/URL mismatch, lookalike domains, credentials/paths/queries in
URLs, missing explicit variables, missing acknowledgement and wrong environment kind
also fail locally. A legacy JWT's embedded ref/role must match. Modern opaque secret
keys cannot be locally decoded to establish project ownership; the operator must
ensure they belong only to the disposable environment.

Operator-only additions:

| Variable | Requirement |
| --- | --- |
| `MOVEMENT_QUALIFICATION_DB_CONNECTION_MODE` | Required: exactly `direct` or `session_pooler`; never inferred |
| `MOVEMENT_QUALIFICATION_DB_HOST` | Required: direct mode exactly `db.<supplied-ref>.supabase.co`; session mode a valid lowercase DNS hostname ending exactly `.pooler.supabase.com`, copied explicitly from Supabase Connect UI |
| `MOVEMENT_QUALIFICATION_DB_USER` | Session mode required: exactly `postgres.<supplied-ref>`; direct mode optional, if supplied exactly `postgres` |
| `MOVEMENT_QUALIFICATION_DB_PORT` | Optional assertion, exactly `5432`; ambient `PGPORT`, if supplied, must also be exactly `5432`; `6543` rejected |
| `MOVEMENT_QUALIFICATION_DB_DATABASE` | Optional assertion, exactly `postgres` |
| `MOVEMENT_QUALIFICATION_DB_PASSWORD` | Disposable Postgres password, passed to `psql` by environment only |
| `MOVEMENT_QUALIFICATION_DB_SSLROOTCERT` | Optional trusted CA file for `verify-full` TLS |
| `MOVEMENT_QUALIFICATION_FIXTURE_KEY` | 64 lowercase hex characters representing a fresh random 32-byte AES key; preparation only |

Both modes fix `PGPORT=5432`, `PGDATABASE=postgres`, `PGSSLMODE=verify-full`,
`PGCONNECT_TIMEOUT=10`, and `PGOPTIONS=-c client_min_messages=error`. Direct mode
sets `PGUSER=postgres`; session mode binds project identity through the exact
`postgres.<MOVEMENT_QUALIFICATION_PROJECT_REF>` username because the shared pooler
hostname does not encode project identity. The disposable acknowledgement and both
forbidden refs remain mandatory before any process/network call. Session hosts
reject URLs, ports, user/path/query decorations, suffix lookalikes, localhost and IP
literals. Transaction pooling on `6543` is rejected. There are no normal `PGHOST`,
`PGUSER`, `PGPASSWORD` or `SUPABASE_*` fallbacks. Host, user, password and connection
strings are never serialized into qualification reports.

Supavisor Session Pooler provides IPv4 on all tiers for these operator catalog and
fixture sessions only; hosted worker service-role HTTP transport stays unchanged.
Direct connections may require IPv6 connectivity;
see [Supabase connection documentation](https://supabase.com/docs/guides/database/connecting-to-postgres).
No credentials are placed in command arguments. Ambient `PG*` variables are not
inherited; a conflicting ambient port is rejected locally.

### Reported operator network blocker and follow-up

Operator evidence supplied for disposable project `uzkhnslyrhgucijcuoes` records
schema 0001–0099 successfully provisioned, `db push --dry-run` up to date and local/
remote migration lists matching through 0099. Its direct hostname resolves AAAA
only (`2a05:d018:cb1:bb02:43d8:94b9:b82e:b83b`); direct `psql` cannot translate the
host to a usable address in the current Windows/network environment. These are
operator-reported observations, not fresh remote verification by this follow-up.

Explicit session-pooler mode is the supported IPv4 path for operator catalog/fixture
access. No IPv4 add-on was purchased or required. Actual pooler access and target-host
qualification still require operator execution with the Connect UI hostname and
disposable credentials. Production remains blocked; Railway configuration has not
changed. No migration is introduced, and fixture SQL and frozen geometry are unchanged.

Follow-up local validation: combined 0102/0101/0099 Node suite 143 PASS, one
POSIX-only test skipped on Windows (144 total); focused 0102 rerun PASS after
adding report-field rejection assertions (71 cases, one skip). Worker process and
migration-integrity tests 7/7 PASS. 0102 local SQL catalog/fixture/workflow validation
PASS; 0099 SQL/worker behavior 49/49 PASS; genuine concurrency 10/10 PASS with zero
deadlocks. Disposable clone validation preserved the original application data/
catalog/ACL/RLS/history fingerprint. App, Edge and worker typechecks and
`git diff --check` PASS. Automated tests made no real remote DB call. No stage,
commit, push, deploy, production operation or provider purchase was performed.

Hosted additions:

| Variable | Requirement |
| --- | --- |
| `MOVEMENT_QUALIFICATION_FIXTURE_CAPSULE` | Encrypted contents of the operator artifact, without its trailing newline |
| `MOVEMENT_QUALIFICATION_FIXTURE_KEY` | Corresponding private AES key |

AES-256-GCM authenticates the capsule. It binds project SHA-256, repository migration
digest, creation time and four unique fixture pairs. Expired (>1 hour), altered,
wrong-project or wrong-schema capsules fail before network. This is a trusted
operator provisioning artifact, not independent certification or host attestation.
Do not print capsule plaintext, put secrets in Git, or provide Mapbox/production secrets.

## Schema verification split

The qualification subprocess entry repeats the dedicated-variable, disposable,
acknowledgement and forbidden-ref checks. Direct invocation with normal worker
variables is rejected. The separate test driver accepts loopback HTTP only and
is never selected by CLI.

Operator SQL runs `BEGIN READ ONLY` with a statement timeout. It checks expected
migration versions through 0099, exact latest relevant 0096–0099 function bodies,
the five worker RPC signatures, owner/definer/search-path/service-only EXECUTE ACLs,
private job/assessment RLS and absence of policies/participant SELECT privileges,
enabled immutability triggers bound to their expected functions, and the frozen
parameter SHA-256. This is relevant worker catalog verification, not global schema
equality or an audit of every historical database object. No auto-migration occurs.

Hosted preflight uses an invalid reserved identity with the existing read-only load
RPC before claim/registration. A mismatch returns `staging_schema_mismatch`, with
zero registration/computation. Subsequent typed RPC validation and the complete
workflow establish runtime compatibility and algorithm identity. The host reports
`fullCatalogVerifiedOnHost: false`; it cannot read catalog/migration metadata through
the service-role worker boundary. Direct SQL credentials are not required on Railway.

## Process, publication and recovery proof

The command first runs the unchanged repeated frozen offline cases and adversarial
timeout/malformed/crash/OOM cases on the candidate host. All original resource limits
remain: one compute slot, 60-second lease, 15-second compute deadline, 192 MiB V8
old-space and 10-second publication/supervisor reserve. V8 old-space is not an RSS cap.

Remote execution requires an idle dedicated queue. On POSIX it launches the real
supervisor privately, waits for authenticated readiness, delivers actual SIGTERM and
requires clean idle exit. Four prepared pairs exercise:

- One canonical job: register → claim → load → unchanged isolated geometry → trusted
  finalize/publication. A bound claim refuses to compute/finalize another job.
- Exact reuse: repeat registration returns the same assessment identity, the queue
  remains idle, and the compute counter does not increment.
- Lost acknowledgement: discard one successful finalize response locally after the
  real RPC returns, then prove recovery-only finalization without another compute.
  This models acknowledgement loss after commit, not provider network fault injection.
- Lease recovery/fencing: on POSIX a real subprocess claims and is killed with SIGKILL
  before load/compute. Wait for its genuine lease expiration, reclaim with a new token
  and incremented attempt, reject the stale token, and complete with the new lease.
  Windows uses an intentionally abandoned claim and leaves native process proof absent.
- Child failure: kill a real isolated child. Register `compute_terminated`, retain a
  pending retry with no publication/result. Infrastructure failure never becomes
  `processing_limit` or geographic evidence. No lease/backoff SQL edits occur.

The process kill proves worker process behavior, not Railway platform restart.
`platformRestart`, `hostSecretStorage` and hosted `participantAcl` stay unmeasured.
Operator ACL checks do not masquerade as participant-authenticated hosted requests.
Exact database job/publication counts are verified by the local SQL validation;
hosted observations prove typed canonical registration and assessment identity reuse,
not unrestricted private-table counting.

## Verdict and reporting

Local/offline modes retain the v1 schema and CLI behavior. Remote mode uses
`movement_worker_remote_qualification_v2`, with strict, closed objects. Reports
include provider/machine/region, project hash only, preflight scope, measurements,
resource usage and:

```json
{"fixtureCleanup":{"strategy":"disposable_environment_teardown","recordLevelCleanupAttempted":false,"environmentTeardownRequired":true,"environmentTeardownCompleted":false}}
```

Every remote Markdown report says **ENVIRONMENT TEARDOWN REQUIRED**. No URL, raw ref,
service key/password, participant/job/evidence IDs, provider reference, geometry or
canonical context is serialized. Worker logs have fixed event/property allowlists;
captured process output is checked for private data. Compute children retain the
existing empty environment and receive geometry only. No public listener is opened.
DB-call counts cover instrumented supervisor calls; subprocess polling is not a
complete request accounting measure. Transferred bytes remain unmeasured.

All seven gates—correctness, reliability, lease, memory, process, integration and
security—must be true, with five repetitions, for `TARGET_HOST_TECHNICALLY_QUALIFIED`.
The serializer additionally refuses that label if any remote measurement is absent
or failed. A local run can never emit it. `TARGET_HOST_QUALIFIED` is not a tooling
verdict. Teardown is a separate lifecycle obligation, not a geometry correctness
gate. This implementation deliberately remains incomplete while provider restart,
host secret storage and participant-equivalent access proof are absent. Final
operator acceptance after confirmed teardown is not automated by 0102.

## Railway evidence and cost ledger

User-supplied existing Railway Hobby offline evidence: Node v24.21.0, Linux/x64,
AMD EPYC 9655P. Correctness/reliability/lease/memory PASS; worst normal supervisor wall
277.75 ms; parent peak RSS 110.34 MiB; child peak RSS 136.84 MiB; no unexpected normal
outcomes. Lease 60,000 ms; reserve 10,000 ms. Offline result remains
`QUALIFICATION_INCOMPLETE`, with process/integration/security not remotely measured.
This milestone records that evidence; it did not rerun Railway or receive its report artifact.

Railway Hobby: already paid, candidate host, offline performance qualified.
Remote staging Supabase: not created by 0102. Exact potential cost must be checked
before creation. No new queue/provider/service is selected or purchased.

A leaked service-role secret grants broad access to the disposable environment.
It must contain no production data; keys must belong only to that environment.
Destroying the environment retires access to it. Production credential narrowing,
host access controls, rotation and residual blast-radius acceptance remain separate
launch/security decisions. Production activation is still **BLOCKED**.

## Validation and final handoff

The final handoff uses the numbering requested for this milestone.

| # | Item | Result |
| ---: | --- | --- |
| 1 | Architecture | Separate disposable remote boundary; operator preflight/preparation; private hosted worker execution; no environment lifecycle automation. |
| 2 | Changed files | Exact 12-file manifest below: four modified, eight added. |
| 3 | CLI | `--remote-staging --ack-disposable-environment`, existing bounded measurement/host/output options; separate read-only operator and explicit fixture commands. |
| 4 | Environment | Dedicated variables only, exactly disposable; capsule/key on host; admin DB password on operator workstation only. |
| 5 | Denylist | Both known forbidden refs fail locally before network/authentication/probing. |
| 6 | URL/ref | Canonical HTTPS Supabase hostname and exact ref equality; reject lookalikes and alternate URL components. |
| 7 | Acknowledgement | Required flag plus exact environment-kind declaration; fixed sanitized warning before writes. |
| 8 | Schema | Read-only operator relevant catalog/history/ACL/RLS/source/signature/trigger/fingerprint checks; scoped hosted runtime proof; no claim of hosted full catalog equality. |
| 9 | Fixtures | Four fresh marked synthetic pairs through existing invariant-preserving builders and trusted route authority; encrypted operator capsule; worker registration via 0099 RPC. |
| 10 | No cleanup | No record DELETE/TRUNCATE or guard bypass in qualification commands; local validation separately proves deletion still rejected. |
| 11 | Teardown | Required external operator action; script always reports attempted=false, required=true, completed=false. |
| 12 | Remote flow | Existing typed HTTP register/claim/load/finalize/fail boundary, unchanged isolated geometry. |
| 13 | Reuse | Same assessment identity, zero second compute, idle queue; real local SQL validation confirms four jobs/three publications across scenarios. |
| 14 | Process | Real private supervisor readiness/idle SIGTERM; actual POSIX test passes in Linux container; Windows does not claim POSIX proof. |
| 15 | Restart | POSIX claimed process SIGKILL plus genuine lease recovery automated; Railway platform restart remains unmeasured and requires operator proof. |
| 16 | Fencing | Old token rejected after unchanged 60-second lease and incremented-attempt/new-token reclaim. |
| 17 | Lost response | Successful finalize acknowledgement deliberately discarded; recovery-only completion with zero recompute; not a claim of provider network fault injection. |
| 18 | Security | Empty compute-child environment, bounded private logs, no public listener, no hosted admin password; broad service-role blast radius remains explicit. Host storage and participant-authenticated proof remain unmeasured. |
| 19 | Sanitization | Closed v2 report schema, fixed measurements, actual project hash only, forbidden private strings/extra properties refused. Encrypted capsule is private transfer material, not a public report. |
| 20 | Verdict | Seven true technical gates and five repetitions required; serializer also requires complete remote measurements. Local reports cannot emit target label. Final acceptance/teardown never automated. |
| 21 | Railway | Supplied Hobby/AMD EPYC/Node 24.21.0 evidence recorded: four offline gates PASS, 277.75 ms / 110.34 MiB / 136.84 MiB; no Railway run performed by this milestone. |
| 22 | Focused tests | Windows: 32 pass, one POSIX skip; Linux with network disabled: 33 pass. Disposable local SQL catalog/fixture/workflow/immutability validation PASS. |
| 23 | 0101 | 35 qualification regressions PASS; six supervisor process tests included in passing root suite. Fixed local integration module unchanged. |
| 24 | 0099 | Runtime included in full Node suite; SQL behavior 49/49 and genuine concurrency 10/10 PASS, zero deadlocks. |
| 25 | 0100 | Handler/service/UI included in full suites; SQL-backed requester endpoint/HTTP behavior 16/16 PASS. |
| 26 | Older regressions | All foundation, assessment, assessment behavior/concurrency, requester SQL/concurrency, route behavior, priority and roster groups PASS. Roster: 99 behavior / 22 concurrency / 17 temporal; zero deadlocks. |
| 27 | Full totals | Supabase: 1,346 pass, one Windows POSIX skip, zero failures (1,347 total). Root: 1,002 pass, one existing DuckDB opt-in skip, zero failures (1,003 total). |
| 28 | Typechecks | App, Edge, worker PASS. |
| 29 | Migration integrity | All 99 Movement migrations unchanged against HEAD; no migration introduced. Fresh disposable CLI reset 0001–0099 PASS; original local data/catalog/ACL/RLS/history fingerprint unchanged after every clone. |
| 30 | Fingerprints | Frozen hashes below unchanged. |
| 31 | Diff check | `git diff --check` PASS. |
| 32 | Git status | Exact status below; index empty; HEAD remains `dd66ebba2393144c37e987ee99dbd4bfd3a051d2`. |
| 33 | Cost | Railway Hobby already paid/candidate; Supabase staging not created; exact cost required before creation; no new provider/queue/purchase. |
| 34 | Production gate | Actual remote process/integration/security evidence, provider restart, secure storage/access proof, confirmed disposable teardown and separate operator acceptance outstanding. Production BLOCKED. |
| 35 | Actions | No stage, commit, push, deploy, production access, remote database/provider call, project/branch creation/destruction or purchase. Only mocks and owned local Docker clones/containers used. |

Frozen geometry SHA-256:
`d48f53b5f7e2e226ed9a1c23d9dd1884e6a6350539e8e58b794061103db54043`.
Frozen contracts SHA-256:
`9ad2c9a1675a4caeb4a6d658bcb8b24fcaecc6ae1b101effea906b8e216eda95`.
Parameter fingerprint:
`1625aa38ea035ad2c26a8c13a3a4df37714fc32624089fa3894f57c2ddda29d5`.

Modified files:

- `docs/MOVEMENT_LAUNCH_READINESS_REGISTER.md`
- `docs/MOVEMENT_SYSTEM_SPEC.md`
- `scripts/assessment-worker/qualification-report.cjs`
- `scripts/assessment-worker/qualify.cjs`

Added files:

- `docs/0102-disposable-remote-staging-worker-qualification.md`
- `scripts/assessment-worker/prepare-remote-fixtures.cjs`
- `scripts/assessment-worker/qualification-remote-process.cjs`
- `scripts/assessment-worker/qualification-remote.cjs`
- `scripts/assessment-worker/qualify-remote-schema.cjs`
- `supabase/tests/0102_disposable_remote_qualification.test.cjs`
- `supabase/tests/0102_disposable_remote_qualification_validation.cjs`
- `supabase/tests/fixtures/0102-remote-process.cjs`

Exact working-tree status:

```text
 M docs/MOVEMENT_LAUNCH_READINESS_REGISTER.md
 M docs/MOVEMENT_SYSTEM_SPEC.md
 M scripts/assessment-worker/qualification-report.cjs
 M scripts/assessment-worker/qualify.cjs
?? docs/0102-disposable-remote-staging-worker-qualification.md
?? scripts/assessment-worker/prepare-remote-fixtures.cjs
?? scripts/assessment-worker/qualification-remote-process.cjs
?? scripts/assessment-worker/qualification-remote.cjs
?? scripts/assessment-worker/qualify-remote-schema.cjs
?? supabase/tests/0102_disposable_remote_qualification.test.cjs
?? supabase/tests/0102_disposable_remote_qualification_validation.cjs
?? supabase/tests/fixtures/0102-remote-process.cjs
```

Local validation logs are in `%TEMP%/movement-0101-validation`. The 0102 live SQL
test uses the fixed schema-only clone harness and is separately invoked with
`node --no-warnings supabase/tests/0102_disposable_remote_qualification_validation.cjs`.
The clone excludes migration-history rows, so that test supplies only the expected
history array; all relevant installed sources, ACLs, RLS, signatures, trigger
attributes and persisted parameter fingerprint are read from actual PostgreSQL.
