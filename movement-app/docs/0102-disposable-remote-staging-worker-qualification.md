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
6. Derive participant ACL evidence using the read-only catalog query on the operator
   workstation and import its signed, run-bound artifact with the finalizer below.
   Railway restart/sealed-variable technical proof remains unresolved; documentary
   observations cannot grant PASS and both measurements remain null.
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
`platformRestart`, `hostSecretStorage` and hosted `participantAcl` stay unmeasured
until the operator evidence finalization step. Participant ACL evidence means actual
catalog/security verification, not participant-authenticated hosted HTTP requests.
Exact database job/publication counts are verified by the local SQL validation;
hosted observations prove typed canonical registration and assessment identity reuse,
not unrestricted private-table counting.

## Operator evidence collection and finalization

The supplied prior Railway Hobby / europe-west4-drams3a result reports startup,
idle SIGTERM, execution, reuse, fencing, crash, lease recovery and lost-acknowledgement
recovery PASS. Correctness/reliability/lease/memory/integration passed; process/security
remain NOT MEASURED and classification remains QUALIFICATION_INCOMPLETE.
This is supplied evidence, not new provider verification. Its old-source report must
not be finalized against updated source.

The former observation-boolean protocol is superseded and rejected. Screenshots,
operator prose, manually entered counts/booleans, or a hash of an arbitrary record
cannot establish technical Railway restart or sealed-variable proof. Documentary
observations may be retained separately for review; they never promote measurements.
This iteration implements no Railway machine-proof intake and makes no Railway API
call. platformRestart and hostSecretStorage always remain null, even with successful
participant ACL proof. TARGET_HOST_TECHNICALLY_QUALIFIED is unavailable through this
finalizer; incomplete is the correct outcome for otherwise passing runtime evidence.

### Reviewed source-pinned identity

qualification-evidence-trust.cjs contains this exact reviewed public identity:

~~~text
-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAcYWxHYOyBz21Z1mdST5qlJCC0gb60lsCB3bmfeS3LPA=
-----END PUBLIC KEY-----
~~~

Its expected SHA-256 over SPKI DER is
13228a92e18fb61153185a048c4edb496cdee1b83d1e894f8f216568211f0fa9.
The module parses Ed25519, independently computes that digest and fails closed on a
mismatch. No environment/CLI/artifact value can replace the verifier. Identity
rotation requires a visible source diff and independent review; it also changes the
worker fingerprint. The closure-held public key is not exported for mutation.

Collection reads only MOVEMENT_QUALIFICATION_EVIDENCE_SIGNING_KEY_FILE. It must be an
explicit absolute path to a regular file outside the entire repository. Relative,
missing, directory, repository and links resolving into repository paths reject.
The private key must parse as Ed25519 and its derived public fingerprint must match
the source pin before any catalog query or signing. The real private key remains
workstation-only; never copy it to Git, Railway, Supabase, tests or docs. Collection
does not print/serialize its contents or path. Finalization requires no private key
and does not read the signing file.

Both legacy MOVEMENT_QUALIFICATION_EVIDENCE_VERIFY_KEY and private-PEM
MOVEMENT_QUALIFICATION_EVIDENCE_SIGNING_KEY inputs are explicitly rejected, even when
empty. Remove them from the operator environment. No new identity generation is
needed: the operator has already generated and independently verified this pin.

~~~powershell
Remove-Item Env:MOVEMENT_QUALIFICATION_EVIDENCE_VERIFY_KEY -ErrorAction SilentlyContinue
Remove-Item Env:MOVEMENT_QUALIFICATION_EVIDENCE_SIGNING_KEY -ErrorAction SilentlyContinue
$env:MOVEMENT_QUALIFICATION_EVIDENCE_SIGNING_KEY_FILE = 'C:\Users\gt\movement-private\0102\movement-0102-signing.pem'
~~~

This assignment contains only a path; do not load the private PEM into an environment
variable. Protect the external private file using Windows access controls.

### ACL artifact and finalization

The strict JSON artifact uses 0102-operator-evidence-v2 with exactly:
version, provider, machine, region, projectRefHash, workerSourceSha256,
migrationDigest, qualificationRunSha256, observedAt, evidence, catalogProof and
signature. No observations or arbitrary metadata are accepted. The measurements are
{platformRestart:null,hostSecretStorage:null,participantAcl:true|null}.
catalogProof is null or a generated object containing method
0102_read_only_catalog_v1, observedAt and catalogSha256. All digests use SHA-256.
Ed25519 signs recursively key-sorted JSON excluding signature, encoded as canonical
base64url. Raw project refs, URLs, DB credentials, UUID/private identifiers, geometry,
catalog contents and signing material/path are never serialized.

The collector's --verify-participant-acl flag runs admin.psql(admin.catalogSql(), ...)
using only the dedicated disposable operator connection, then admin.verifyCatalog().
The query remains BEGIN READ ONLY and verifies relevant migration/function source/
signature/ACL/RLS/trigger/parameter invariants. Only successful verification permits
participantAcl=true. Failure produces no signed proof; without the flag participantAcl
stays null. There is no manual ACL input. DB credentials never go to Railway.

The artifact binds the exact project hash, provider/machine/region, current worker
fingerprint, migration digest and SHA-256 of the complete original report. The worker
fingerprint incorporates the migration digest and source pin file. Original report,
artifact and catalog observation must be no older than one hour and not in the
future. Original runtime reports validate first; old-source and previously asserted
external-measurement reports reject. Extra fields and altered/mismatched signatures
reject. No env/CLI measurement boolean can grant a result.

After a separately authorized fresh updated-source run, on the operator workstation:

~~~powershell
node scripts/assessment-worker/qualification-operator-evidence.cjs collect --ack-disposable-environment --report C:\Users\gt\movement-private\0102\original-qualification.json --verify-participant-acl --output C:\Users\gt\movement-private\0102\operator-evidence.json
node scripts/assessment-worker/qualification-operator-evidence.cjs finalize --ack-disposable-environment --report C:\Users\gt\movement-private\0102\original-qualification.json --evidence C:\Users\gt\movement-private\0102\operator-evidence.json --output C:\Users\gt\movement-private\0102\final-qualification.json
~~~

Both outputs require new paths. Import needs only the disposable context and
source-pinned public identity, with no DB password or private key. It makes no DB or
provider call. Retain the original report, signed artifact and final report together;
the artifact supplies provenance without changing the strict remote v2 report schema.
Runtime samples/usage remain intact, existing false gates remain false, missing
evidence stays null, and failed runtime evidence cannot become PASS. Even with
participantAcl=true, process/security remain unmeasured unless already failed.
Every required gate/measurement, safe logs, compatible runtime and absence of failures
remain mandatory for technical qualification. The report validator is unchanged.

### Remaining Railway proof and environment constraints

Railway documents authenticated APIs for deployment IDs/statuses/timestamps, runtime
logs and service restart-policy configuration. These are possible future inputs,
not a complete verified restart event sequence. Future technical restart proof must
correlate authenticated provider stop/automatic-restart events with read-only DB lease
expiry/reclaim/fencing/completion observations and exactly one publication. Manual
restart/redeploy is not automatic restart proof. No such adapter is implemented.

Railway documents sealed values as unavailable for UI/API readback, but its public
variable API guide does not establish a per-variable sealed-state metadata field.
Authenticated schema/capability verification remains necessary before implementing
technical proof for MOVEMENT_QUALIFICATION_SERVICE_ROLE_KEY,
MOVEMENT_QUALIFICATION_FIXTURE_CAPSULE and MOVEMENT_QUALIFICATION_FIXTURE_KEY.
Neither variable existence nor absence of values proves sealed configuration.
No token is introduced here and no provider call is made.

References: [public API authentication](https://docs.railway.com/integrations/api),
[service metadata](https://docs.railway.com/integrations/api/manage-services),
[deployment logs](https://docs.railway.com/integrations/api/api-cookbook),
[sealed-variable behavior](https://docs.railway.com/variables), and
[variable API](https://docs.railway.com/integrations/api/manage-variables).
Documentation and documentary records do not certify this actual service.

Do not rerun full qualification against existing disposable project
uzkhnslyrhgucijcuoes. Its immutable synthetic pairs have already been consumed:
fixture preparation requires no members/jobs, initial qualification requires an idle
queue, and first registration requires job_registered with attempt count zero.
A completed pair returns assessment_reuse; the prior crash may leave pending work.
Capsules also expire after one hour. Do not regenerate capsules/fixtures, delete
records, truncate tables, edit lease clocks or bypass immutability to reuse it.

The existing project may remain for evidence preservation and separately authorized
read-only inspection. A fresh empty disposable project, migrations through 0099,
new capsule and updated-source run are required later. No project is created/deleted
during this correction. Archive evidence and perform whole-environment teardown only
when separately authorized. Technical qualification never certifies teardown or
authorizes production. The old report and capsule remain preserved.

Security-correction validation: focused evidence tests 70/70 PASS; combined
0102/0101/0099 runtime, worker-process and migration-integrity regressions 220 PASS,
one POSIX-only Windows skip (221 total). Positive signing tests use memory-only
module copies with temporary random keys outside Git; production rejects that
identity. No test uses the real operator private file. Local 0102 SQL catalog/fixture/
completion/reuse/lease/fencing/crash validation PASS; original application data/
catalog/ACL/RLS/history fingerprint unchanged. App, Edge and worker typechecks PASS;
tracked/new-file whitespace checks PASS; all 99 migrations unchanged.

Text scan covered 772 worktree files, excluding Git/dependency/build caches and the
preserved capsule. No embedded private PEM was found, including tracked/new sources.
The only credential-shaped match was the ignored Supabase local startup-secret cache;
qualification credential assignments were synthetic values in the two test files.
Actual private key/capsule contents were not read or compared. No new credential
material was found in tracked/new source. The real private file remains untouched.
No stage, commit, push, deploy, provider API call, project create/delete or production
operation occurred; the capsule remains untracked and unstaged. The existing shared
fingerprint integration in qualify.cjs is retained without additional edits here.

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
