# 0106 controlled read-only inspection preparation

0107 follow-up: [local live-inspection operator preflight](0107-railway-readonly-live-preflight.md)
adds fixed payload construction, operator target constraints and private manual
review permits only. Transport remains TRANSPORT_NOT_READY; no live action is
authorized and all 0106 minimization/readiness limitations remain intact.

**NOT AUTHORIZED TO EXECUTE YET.** This is local preparation only. No live
introspection occurred. No Railway API/CLI call, remote Supabase access, provider
mutation, production access, project creation/deletion, deployment, restart or
redeploy is authorized. No runtime variable values, logs, credentials or credential
caches are queried. Fresh disposable qualification remains unauthorized.

## Fixed documents and deterministic sequence

The authoritative immutable documents are exported by
`scripts/assessment-worker/qualification-railway-introspection-plan.cjs`.
Reviewable copies are `docs/0106-introspection/query-root.graphql` and
`docs/0106-introspection/referenced-type.graphql`. They are introspection only;
neither retrieves execution records. There is no live executor.

Artifact SHA-256 refers to canonical UTF-8 serialization of immutable JS document
source plus exactly one LF, not arbitrary platform working-tree newline bytes.
Review-file comparisons normalize CRLF to LF before exact content comparison;
extra/missing trailing newlines and content changes still fail. Both published
hashes remain unchanged because the canonical document sources are unchanged.
These hashes are review checksums, not platform provenance:

| Artifact | SHA-256 |
| --- | --- |
| query-root.graphql | c2d77d8ecb5af73166ce944034246eb70160ad7d5f7610c7c5e2c425fcb0f9aa |
| referenced-type.graphql | 767e872ef31749fc65294af899f50da35cd0b50cb866b31809a7736e7fbdefa7 |

1. `Movement0106QueryRoot` requests only `__schema.queryType.name`. It has no
   variables. This establishes the actual query operation root without guessing
   that its name is Query.
2. `Movement0106ReferencedType($name: String!)` requests `__type` with exactly the
   root name accepted at `data.__schema.queryType.name`. Its field definitions
   must contain exactly one `deploymentInstanceExecutions`. Capture its arguments,
   defaults' presence, full wrapper nesting and named output type.
3. Reuse the same second document, sequentially, for each referenced named type.
   `next(session)` returns the sole permitted next name, its discovery path and
   fixed document. Argument types are queued in schema order, followed by output;
   input objects queue all their input fields recursively. Output objects queue
   only types of the fixed structural/evidence field allowlist:
   edges, node, nodes, pageInfo, cursor, hasNextPage, hasPreviousPage, startCursor,
   endCursor, id, deploymentId, environmentId, serviceId, status, createdAt,
   updatedAt, completedAt, deploymentMeta. Selected output field arguments also
   receive input discovery. Scalars and enums receive exact kind validation.
   Repeated names are deduplicated; conflicting kinds stop discovery.

GraphQL `__type.fields` has no field-name selector: the root and referenced type
definitions return all field signatures, not field values. No whole-schema types
inventory is requested. Descriptions and deprecation prose are omitted. Seven
wrapper levels, 64 named types and 2,048 entries per definition bound discovery;
exceeding a bound stops rather than silently truncating evidence. Requiredness is
NON_NULL with no default. Literal default values are discarded in normalized
output; only `hasDefault` is retained. No default, prose or name confers authority.

If the target is absent from the actual query root, stop: the parent path remains
unresolved and a narrower separately reviewed parent-discovery extension is needed.
Unknown wrapper field names, interfaces/unions, unsupported introspection arguments
or wrapper depth exhaustion similarly require review. Do not guess a parent, add
arbitrary fields/types or fall back to a full schema dump.

## Strict validation and readiness

`start()` creates a private in-memory session; `accept(session, response)` consumes
one exact JSON envelope. `next(session)` provides fixed request metadata, never a
caller-provided document. `evidence(session)` provides detached deeply frozen
normalized schema facts. `finish(session)` rejects outstanding discovery.
The full raw definition is validated and used for discovery internally before
deliberately constructing the stored minimized representation. The root retains
only deploymentInstanceExecutions. Other output objects retain only the existing
OUTPUT_FIELDS allowlist fields used by discovery. Input objects retain every
validated input field, enums retain every member, and scalars retain only kind/name.
Unrelated root/output names, arguments and signatures are never stored in normalized
evidence and cannot appear in evidence(), finish() or stdin-validator stdout.
This is construction-time minimization, not post-serialization redaction. Future
raw provider responses remain local and require separate review before sharing.
Serialized sessions/artifacts cannot become session authority. No credentials,
environment intake, CLI or transport is exposed.

Validation rejects GraphQL errors (including empty errors arrays), unexpected
envelope/data/type keys, absent/null __type, duplicate fields/arguments/input fields/
enum members, unknown kinds, contradictory named kinds, wrong staged names/kinds,
invalid input/output kinds, malformed LIST/NON_NULL, nested NON_NULL and missing
wrapper children. Leaf names and wrapper nullability are validated structurally.
Default strings must parse as bounded GraphQL constant literals; variables,
malformed constants, prose and block strings are rejected. Block strings need
a separately reviewed extension if the actual schema uses them.
Descriptions are unexpected keys, not schema facts. Errors never echo input.

`executionSchemaReady(session)` returns false for every current 0106 evidence set.
This is intentional, including a fully closed synthetic structural graph: GraphQL
introspection alone cannot prove scope enforcement, cursor behavior, ordering or
exhaustion/completeness. No complete semantic proof intake is added in 0106, so
there is no true path or partial PASS. A future reviewed contract must independently
prove all of the following before adding a true path:

- Root/parent operation path and exact execution field.
- Every argument, nested input structure, kind, wrapper, default presence and requiredness.
- Exact output/list/connection graph and unambiguous execution node path.
- Exact execution identity and status paths and types, with supported status enum.
- Exact environment/service/deployment scope fields **and their enforcement semantics**.
- Whether results are paginated; exact pagination arguments, cursors, pageInfo paths,
  termination/exhaustion rules and completeness semantics if so.
- Ordering and filtering semantics sufficient for complete unambiguous selection.

An `edges` field does not prove a connection; a field named serviceId does not prove
service isolation; a plain LIST does not prove an exhaustive unpaginated result.
Current real schema facts remain all the 0105 missing facts. Synthetic tests prove
validator behavior, not Railway schema or authenticated completeness.

## Future operator procedure (not authorized)

Before any live step: obtain separate explicit authorization naming the disposable
non-production Railway scope, the two reviewed fixed document hashes, allowed staged
type transitions, approved read-only tooling and capture destination. Authentication
must stay in the operator's existing reviewed tool; it must never be pasted into
Codex, JSON intake or artifacts. Verify the tooling's actual read-only API syntax
separately; 0106 deliberately supplies no live Railway command.

After that authorization only:

1. Run the fixed root document, without variables. Capture only the response JSON
   body, without HTTP headers, session material, CLI diagnostics or environment dumps.
2. Start a local session and validate that response before any next request. Keep an
   ordered JSON array of response envelopes in `0106-responses.json` in the workspace.
3. Replay the array using only the module, then call `next(session)`. Write its fixed
   `document.source` and `variables` to separate local review artifacts. Verify the
   name equals the recorded discovery path. Review those artifacts before each
   authorized request. The fixed type document never changes; only the validated name
   changes. Do not accept operator edits or arbitrary type substitutions.
4. Append the next response, replay/validate and repeat serially until `next` is null.
   Call `finish` to distinguish completed discovery from a partial transcript.
5. Inspect capture files locally for unexpected sensitive defaults before sharing.
   The requests exclude runtime values; normalization removes literal schema defaults.
   Do not redact a response and then treat it as exact original schema evidence.
   If sensitive material appears, stop and retain it locally; return only a sanitized
   stop reason and already validated normalized facts.
6. Paste back normalized validator output, document hashes, discovery paths and the
   stop/completion result. Never paste authentication, raw defaults, secret files,
   variable values or credential caches. Raw schema envelopes require separate local
   sensitivity review before sharing. Schema capture is descriptive, not identity proof.

Immediate stop: unauthorized/production scope; unexpected query or name; GraphQL
errors, absent target/type, validation failure, contradictory definition, unknown
parent/wrapper, unsupported introspection, unresolved polymorphism, resource bounds,
authentication/transport failure or sensitive output. Do not retry with expanded
permissions/queries, invoke qualification, or promote any readiness/identity claim.

Current executable **local-only** validation (no provider calls):

```powershell
node --test supabase/tests/0106_railway_introspection_plan.test.cjs
# Once a reviewed synthetic/authorized schema transcript exists:
Get-Content -Raw -LiteralPath './0106-responses.json' | node scripts/assessment-worker/qualification-railway-introspection-validate.cjs
```

The stdin harness accepts only an array of introspection response envelopes, no
flags, file paths, GraphQL source or credentials, with a 4 MiB/65-response bound.
It outputs only normalized facts and false readiness; partial transcripts remain
explicitly incomplete. It does not generate or execute a network request.

For local reviewed artifact generation/replay, the API sequence is:

```javascript
const fs = require('node:fs');
const p = require('./scripts/assessment-worker/qualification-railway-introspection-plan.cjs');
const s = p.start();
for (const response of JSON.parse(fs.readFileSync('./0106-responses.json', 'utf8'))) p.accept(s, response);
const request = p.next(s);
if (request) {
  fs.writeFileSync('./0106-next.graphql', request.document.source + '\n');
  fs.writeFileSync('./0106-next.variables.json', JSON.stringify(request.variables) + '\n');
} else {
  console.log(JSON.stringify(p.finish(s)));
}
```

These files are local review artifacts only. No operator-provided GraphQL source is
read. Captured schema is not authenticated merely because it validates locally.

## Local runtime-provenance inventory

Search scope: repository source/docs/tests (`.md`, `.cjs`, `.mjs`, `.json`) for
RAILWAY_, runtime identity and runtime metadata. Credential files, caches, .env,
private keys and the capsule were not opened. Relevant sources are 0102 docs,
qualification-railway-evidence.cjs, qualification-supervisor.cjs,
qualification-child-adapter.cjs, 0104 fixtures and 0105 schema/topology docs/tests.

**Provider-owned runtime candidate set: empty.** Explicit blocker:
`runtime_identity_provenance_unresolved`. No undocumented runtime variable is assumed.
The following locally evidenced sources explain why existing values cannot fill it:

| Source/name | Local evidence / expected provenance | Operator spoof / app overwrite | Control-plane ownership / restart stability | Deployment vs execution identity | Confidence / sufficient? |
| --- | --- | --- | --- | --- | --- |
| MOVEMENT_QUALIFICATION_RAILWAY_PROJECT_ID, ENVIRONMENT_ID, SERVICE_ID, SERVICE_INSTANCE_ID (each with the full prefix) | 0102 docs; child adapter ENV; supervisor identity hashing; operator configuration | Yes / ordinary process configuration can be changed | Value's provenance not proven; plan hashes do not establish ownership; restart stability unresolved | Plan scope constraints only, no runtime execution | Proven operator input category; insufficient |
| Expected deployment/execution plan IDs and hashes | supervisor plan bindings; 0104 synthetic fixture | Yes / caller supplies plan; app can replace its configuration | Not independently authoritative; stability unresolved | Labels assert deployment/execution but do not observe them | Proven local claim category; insufficient |
| MOVEMENT_QUALIFICATION_RAILWAY_CLI_FILE | 0102 docs and railway-evidence path validation | Yes / configuration can change | Operator CLI path, no identity ownership; stability irrelevant | Neither | Proven tool configuration; insufficient |
| RAILWAY_TOKEN, RAILWAY_API_TOKEN, MOVEMENT_QUALIFICATION_RAILWAY_TOKEN | 0102 synthetic rejection tests only; no values inspected | Operator-configurable names / configuration can change | No runtime identity provenance; stability unresolved | Neither; credentials are excluded | Proven excluded shortcut names; not candidates |
| ServiceInstance id/environmentId/serviceId/latestDeployment.id | Fixed 0102 metadata query, injected synthetic tests; retained 0105 names | Local response can be fabricated / app can replace its claims | Potential control-plane metadata; no authenticated capture in 0106; restart behavior unresolved | Scope and possible deployment link, no independently linked process execution | Candidate for later control-plane review; insufficient |
| DeploymentInstanceExecution.id/deploymentId/status/timestamps/deploymentMeta | User-established retained field names in 0105 | Local assertion can be fabricated / app can replace assertion | Intended control-plane execution metadata; exact schema and provenance unresolved | Potential execution/deployment records, no runtime-to-record binding | Candidate for later schema review; insufficient |
| Node parent/child PID, spawn/IPC observation | child adapter private object ownership and 0105 tests | Arbitrary PID claims rejected; owned OS observation is local / serialized claims writable | OS/local adapter observation, not Railway control plane; PID reuse/restart instability | Local process only | Proven limited local observation; insufficient |

No listed source proves an immutable provider-owned runtime identifier. Potential
control-plane fields are not runtime candidates; their semantic promises remain
unresolved. No runtime configuration is read to build this inventory.

Future read-only proof questions, all unanswered unless separately supported:

- Which runtime variable names are automatically Railway-injected? Can names and
  ownership be documented without querying values or logs?
- Which are provider-owned and immutable, and what prevents project/service variable
  overrides or app replacement? Distinguish injected values from ordinary configuration.
- Are deployment, service and environment identifiers present automatically?
- Is there a replica/container/instance/execution identifier, rather than deployment only?
- Is it identical to or independently linkable with DeploymentInstanceExecution.id?
- What independent platform evidence binds the owned local process to that execution?
- Which identifiers survive automatic restart, and which change on replacement execution?
- What independent evidence distinguishes automatic policy restart from manual restart,
  redeploy, replacement or another actor? Promising fields are for later review only.

Read-only schema inspection alone may not answer runtime injection/immutability or
restart questions. Provider documentation or a separately authorized evidence method
will be needed; do not expand this procedure into variable-value/log access.

## Preserved boundaries and remaining gates

A process claiming execution X does not prove it is execution X. Private session
ownership proves only local validator sequence, never authenticity or process identity.
identity_proven, causality_proven, restart_origin_proven and platformRestart remain
null. restartAttribution remains `{measurement:null,
limitation:"restart_origin_unattributable"}`. No causality PASS exists.

0104 execution reader is unchanged: injected, normalized, no live query and no
authenticated completeness. childTopology, correlateOwnedChild and
completedQualification retain their private local ownership/sequence/correlation
meaning. Normal run.cjs is isolated. All 99 migrations remain unchanged; no migration
or global cross-workstation authority is added. The 0103 journal remains local-only.

Before read-only live inspection: explicit scoped authorization; review fixed documents,
hashes, transition allowlist and stop conditions; establish approved authenticated
read-only tooling and a safe local response capture path; verify non-production target.
Missing schema is the purpose of inspection, not a requirement to guess it beforehand.

Before fresh disposable qualification: independently reviewed exact execution reader
contract and authenticated exhaustive traversal; runtime identity provenance and
process/execution binding; restart-origin evidence if platform restart is to be claimed;
qualified host IPC/termination behavior; global one-shot authority; unused disposable
fixtures and reviewed sequencing/cadence; separate explicit qualification authorization.
0106 authorizes none of these live actions.

## Local validation record

The following is the initial 0106 validation record, before the pre-staging
minimization and canonical-LF corrections. Correction results are recorded below.

0106 focused: 53 tests, 53 PASS, zero failures/skips. Final combined run with
`--test-concurrency=1`: 632 tests, 629 PASS, three existing OS-specific skips,
zero failures. This covers 0105, both 0104 suites, 0103, all three 0102 suites,
0101, 0099 worker/job, worker-process and migration-integrity tests.
Windows IPC signal dispatch is not proof of POSIX signal delivery.

The first parallel combined attempt failed the existing 0103
`policy correlation never attributes origin ON_FAILURE` test. The unchanged
0103 suite then passed independently (97/97), and the final serialized combined
run passed. Timing contention is a possible explanation, not proven causality;
no supervisor check was weakened. The final focused run includes the added
default-literal/type-definition validation cases.

App, Edge and worker typechecks PASS. PowerShell's npm.ps1 execution restriction
was handled by using npm.cmd, without changing execution policy. All 99 migrations,
run.cjs and the existing execution reader/child adapter/supervisor match the exact
HEAD blob or Git checkout bytes (accounting for existing LF/CRLF representations).
No protected file was edited. Task-file whitespace and secret-pattern scan: PASS
across nine changed/new files, no secret-pattern matches; credential files and
the capsule were excluded and unread. This is a scoped pattern scan, not a global
proof of absence of secrets. git diff --check PASS; index empty.

HEAD remains `6f8e5359ce957e879219e9d9e3220c45155e8797` on
`feature/0092-shared-segment-suitability`. Three tracked documentation files are
modified and six task files are new/untracked. The pre-existing capsule remains
untouched, unread and untracked. No stage, commit, push, deploy, restart, redeploy,
live Railway/GraphQL/Supabase call, project action or production access occurred.

### Pre-staging correction validation

Correction changes are limited to qualification-railway-introspection-plan.cjs,
0106_railway_introspection_plan.test.cjs and this document. Fixed query sources,
GraphQL review files and the stdin harness are unchanged; no .gitattributes change
was needed. Both published canonical UTF-8 LF hashes are unchanged.

Focused 0106: 60 tests, 60 PASS, zero failures/skips. Seven added tests prove
root/output signature minimization in evidence(), finish() and stdin stdout;
complete input/enum preservation and kind/name-only scalar definitions; continued
full raw validation; preserved connection/edge/pageInfo discovery fields;
strict LF/CRLF canonical comparisons; and unchanged canonical hashes.
Serialized combined qualification regression set: 639 total, 636 PASS, three
existing OS-specific skips, zero failures. Migration-integrity test PASS.
App, Edge and worker typechecks PASS.

All 99 migrations and run.cjs/0104 reader/0104 child adapter/0103 supervisor remain
unchanged, checked against exact HEAD blob or Git checkout bytes. git diff --check
and whitespace checks across all nine task files PASS. Scoped task-file secret
pattern scan has no matches. HEAD/branch unchanged; index empty. The capsule
remains untouched, unread and untracked. No live/provider calls, credentials
inspection, staging, commit, push, deployment, restart or redeploy occurred.
