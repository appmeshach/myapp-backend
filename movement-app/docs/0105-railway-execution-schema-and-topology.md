# 0105 local execution-schema and topology foundation

Outcome B: **insufficient schema**. No execution GraphQL query or live transport is
implemented. This checkpoint uses existing local evidence and synthetic tests only.
No live use or fresh disposable qualification is authorized.

## Local discovery inventory and evidence

The repository-wide hidden-file filename/content search included docs, scripts,
tests, fixtures, saved qualification JSON/schema reports and existing generated
documentation. Dependencies, Git internals, credential caches, environment files,
private key containers and the preserved capsule were excluded without opening them.
Search terms: deploymentInstanceExecutions, DeploymentInstanceExecution,
restartPolicyMaxRetries, RAILWAY_ variable names; filename terms: schema, introspect,
railway, .graphql and .gql. No saved Railway SDL/introspection artifact was found.

Exact relevant local sources:

| Local path | Evidence and limits |
| --- | --- |
| docs/0104-qualification-child-and-provider-adapters.md | Records deploymentInstanceExecutions and explicitly absent input/return/pagination contract; no schema definition. |
| docs/0102-disposable-remote-staging-worker-qualification.md | MOVEMENT_QUALIFICATION_RAILWAY_* operator configuration; no immutable runtime provenance. |
| scripts/assessment-worker/qualification-railway-evidence.cjs | Existing fixed service-instance queries, policy validation and lifecycle correlation; no execution query. |
| scripts/assessment-worker/qualification-execution-reader.cjs | Ten statuses and strict injected normalization shape; explicitly not Railway GraphQL. |
| scripts/assessment-worker/qualification-supervisor.cjs | Operator plan ID hashes and local supervision; no runtime execution identity. |
| scripts/assessment-worker/qualification-child-adapter.cjs | Fixed fork and private inherited IPC; no provider identity metadata. |
| supabase/tests/0102_railway_evidence.test.cjs | Synthetic fixed-query/service-instance/correlation contracts. |
| supabase/tests/0102_operator_evidence.test.cjs | Synthetic operator configuration, no runtime provenance. |
| supabase/tests/0103_qualification_supervisor.test.cjs | Synthetic local supervisor bindings. |
| supabase/tests/0104_qualification_execution_reader.test.cjs | Synthetic normalization validation, no wire schema. |
| supabase/tests/fixtures/0104-qualification.cjs | Synthetic provider IDs; no platform metadata authority. |

Other schema filename candidates inspected in the repository-wide search:
scripts/assessment-worker/qualify-remote-schema.cjs (Postgres catalog verifier),
docs/0082-temporal-schema.sql, supabase/migrations/0001_core_movement_schema.sql,
and docs/0101-{offline,local,linux-final}-qualification/qualification.schema.json.
These concern database/report schemas, not Railway execution introspection.
No unrelated catalog JSON matching line was dumped as evidence.

Retained prior field-name facts (user-established and local adapter references,
**not a complete captured type definition**): ServiceInstance has id,
environmentId, serviceId, serviceName, region, restartPolicyMaxRetries,
restartPolicyType, latestDeployment. Policies: ALWAYS, NEVER, ON_FAILURE.
DeploymentInstanceExecution names: id, deploymentId, createdAt, updatedAt,
completedAt, status, deploymentMeta. Status names: CRASHED, CREATED, EXITED,
INITIALIZING, REMOVED, REMOVING, RESTARTING, RUNNING, SKIPPED, STOPPED.
No relevant exitCode is established. Some names survive only as prior supplied
facts; local validators do not prove their GraphQL types/nullability.

Unknown exactly: query parent type; argument names/types/requiredness; input object
name and fields/types/nullability; output type/nullability; wrapper, connection,
edge, node and pageInfo structure; pagination args and cursor semantics; filters
and environment/service/deployment scope; ordering; complete unambiguous selection.
qualification-execution-schema-gap.cjs exposes a deeply frozen descriptive inventory,
no query capability. No pagination/completeness claim is made. The 0104 normalization
contract remains an injected-code boundary; its one-row requirement does not prove
upstream completeness or authentication.

## Identity categories and local model

childTopology(worker) requires the exact live adapter-owned object in a private
WeakMap. It returns a detached descriptive snapshot. Serialized artifacts and PID
objects cannot be decoded into ownership or fault authority.

Control-plane hashes are operator_plan_constraints: plan-bound project,
environment, service, service-instance, deployment and expected execution identifiers.
They are not independently authoritative runtime values. The six IPC binding hashes
bind the qualification run, supervisor run, job, expected execution, source and
migrations. Hashing a claim does not prove the claim's provenance.

No locally evidenced immutable Railway runtime variable name or trusted provider
runtime mechanism was found. The typed runtime slot is closed to all caller input:
source:null, identity_proven:null,
limitation:runtime_identity_provenance_unresolved. No arbitrary env-name parser,
child identity assertion or operator replacement is accepted. This explicitly avoids
the circular inference that a process naming execution X proves membership in X.

Local OS observations record parent PID, the child object's PID at Node's spawn
event, local spawn observation timestamp, inherited-channel ready observation,
owned child presence and fixed-source revalidation. A real default Node fork plus
spawn/IPC/PID observations can establish parentChildObserved within this reviewed
process. Trusted injected fork implementations are always labeled synthetic_transport
and never claim that relation as OS-observed. A child PID is never read from IPC prose.
No stronger nonce is added: object ownership and the inherited channel suffice for
this limited local relationship; no global/provider identity is inferred.

PID reuse exists; PIDs are namespace-local, not global or Railway identities.
spawnObservedAt is local acceptance time, not an authoritative OS process start time.
No container, host, replica or parent Railway execution is independently identified.
Fixed-file checks retain the 0104 protected-filesystem prerequisite and do not claim
atomic path-to-execution identity. Windows signal behavior remains unqualified.

## Correlation and authority

Successful supervision stores its completed record privately keyed by the original
worker object, only after the final journal evidence write succeeds.
correlateOwnedChild(worker) requires both that record and the adapter's observed
controlled exit, verifies run/job/expected-execution/deployment bindings, then emits
correlated:true with correlationScope:validated_local_sequence_only. Provider lifecycle
and DB attempt 1 -> 2, stale-token fencing and single publication come from the existing
strict supervisor sequence, not operator-submitted artifacts. Provider observations
still come from an injected reader without authenticated completeness proof.
Synthetic transport correlation is explicitly labeled as such. Failure, cleanup kill,
PID reuse, serialized completion, and caller identity assertions cannot mint this
completed correlation. Mutating a returned snapshot does not modify private state.

identity_proven:null, causality_proven:null and restart_origin_proven:null remain
independent limitations. Correlation establishes neither child-to-Railway execution
identity nor causation. Even a future identity proof would not establish automatic
restart origin. platformRestart:null and restartAttribution remain
{measurement:null, limitation:"restart_origin_unattributable"}. No PASS is emitted.

Normal run.cjs and all 99 migrations remain unchanged. The 0103 journal is a local
directory reservation only; no cross-workstation/global one-shot authority is added.
The preserved capsule and real credentials are unread. No fresh remote fixtures,
project reuse, provider/network calls, deployment or production action occurred.

Remaining prerequisites: exact reviewed authenticated execution query and complete
traversal; independently supported runtime provenance and child/execution topology;
qualified host IPC/termination behavior; global one-shot authority; unused fixture
sequencing and cadence under separate authorization; automatic restart-origin evidence.

## Validation

0105 focused: 15 PASS, zero failures/skips. Combined 0105/0104/0103/0102/0101/0099,
worker-process and migration-integrity: 579 total, 576 PASS, three OS-specific skips,
zero failures. App, Edge and worker typechecks PASS. The real Windows Node fork/IPC
local relationship test PASS; this does not qualify POSIX self-termination on Windows.
All 99 migrations are byte-for-byte unchanged against HEAD; normal run.cjs is unchanged.
Repository-wide discovery/secret-pattern scan: 786 eligible text files; only an
existing synthetic test password matched the secret pattern. No sensitive material
was opened. Diff check and all three new-file whitespace checks PASS.
HEAD remains ab2e31c976559cb2d26656b7d0984fbb443f2ba7. Nine implementation/test/doc
files are unstaged changes; the preserved capsule remains unread and untracked.
No staging, commit, push, deployment, restart/redeploy, live provider/Supabase call,
fresh fixture/project action or production access occurred.
