# 0109 private direct HTTPS adapter foundation

**Adapter implemented locally, never executed live. First live action remains
separately unauthorized.** No real Railway/Supabase/provider request, real token/env
credential read, credential/cache inspection, production access or project/deploy/
restart/redeploy action occurred. All execution-path tests load isolated synthetic
adapter instances. The preserved capsule was not read. Fresh qualification remains
unauthorized; runtime/execution identity and restart origin remain unresolved.

## Local modules and the narrow 0107 change

qualification-railway-https-adapter.cjs implements the fixed Node HTTPS path and
private context/result ownership. qualification-railway-context-review.cjs adds
fixed project-token review tickets and routes original opaque handoffs to the adapter.
Production imports contain no test fixture or injectable network/env callback.

0107 preflight is narrowly extended with consumeSchemaPermitForAdapter(permit,
samePrivateTarget) and takeSchemaHandoffForAdapter(handoff,samePrivateTarget).
The original review, acknowledgement, descriptor consumption and injected response
validation APIs retain their behavior. Historical TRANSPORT_NOT_READY metadata is
unchanged. The 0107 export-surface assertion adds exactly these two authorized
methods; no previous assertion or behavior is removed or weakened.

The new consumption deletes the original private permit **before** checking target
object identity or stage. record.binding must equal the provided original target
by ===; a different valid binding with identical IDs/digest fails and burns the
permit, as does a serialized target. The exact current immutable request is
revalidated against its reviewed payload. Successful consumption creates a frozen
opaque handoff backed by a private WeakMap, preserving original permit, binding,
session, request and review metadata. Taking the handoff deletes it before checking
the target/stage again. Stale/wrong-target handoffs also fail permanently.

No assembled fields or serialized object can populate this map. Public detached
record inspection cannot remint a consumed handoff or create adapter-owned results.
The original descriptor {target,request} API is still descriptive and cannot be
passed to executeHandoff as authority. These are local one-use/object-ownership
properties, not cross-workstation/global one-shot authority.

## Fixed project-token context review

reviewProjectTokenContext(privateTarget) accepts one original 0107 private binding
and builds only the immutable Movement0108ProjectTokenContext document. It is not
a 0106 session/stage request. Canonical SHA-256 remains
d3190e45cbf0ec1242ef090a9a5a437c4043a5e7542b075921744349b8039e28.

Artifacts are fixed GraphQL source plus LF, variables JSON {} plus LF and safe
metadata JSON. Metadata contains operationName, querySha256, targetSha256, fixed
endpoint/auth kind, executionSchemaReady:false, providerContextObserved:false and
manualReviewRequired:true. No credential value appears.

approveProjectTokenContextReview(review,{...review.meta,reviewed:true}) requires
the original private review and exact acknowledgement; extra/missing/changed keys,
false review flags and serialized reviews fail. The review is consumed once.
consumeProjectTokenContextPermitForAdapter(permit,samePrivateTarget) consumes the
permit first, verifies original-target identity and fixed payload, then creates a
private one-use context handoff. Taking that handoff also consumes it first.
Neither gate accepts caller GraphQL, operation names, variables or credentials.
The acknowledgement is an operator assertion, not proof of human reading or live
authorization. Every context/schema request requires its own explicit review.

## Execution context and the only credential-read boundary

openExecutionContext(privateTarget) validates the original private target before
consulting the environment. It rejects RAILWAY_API_TOKEN **presence** using
Object.hasOwn, without reading its value. It requires RAILWAY_TOKEN presence and
reads process.env.RAILWAY_TOKEN only here, once per context. Missing/empty/non-string
values fail generically; no token format is parsed, validated, decoded or trimmed.
There is no public token, environment, env-reader or transport parameter.

Installed Node native source review showed HTTPS diagnostic logging can print
connection options containing headers. The boundary therefore rejects NODE_DEBUG
presence without reading its value and rejects enabled native http/https logger
state before reading a credential and before each native request. This also catches
an already-enabled logger after the env key was removed. Test instances replace
only the diagnostic-state query alongside synthetic HTTPS/env; no real diagnostic
or credential env values are consulted during execution-path tests. These are Node
diagnostic guards, not undocumented Railway runtime variables or token parsing.

Importing the adapter performs no credential read or network call. During 0109,
openExecutionContext was called only on isolated test-loaded instances whose env
objects contain synthetic literals; it was never called on the normal module.

The frozen opaque context handle exposes no fields. The secret stays only in
adapter-owned private memory and ephemeral native request headers. Context attestation
and all later schema requests use this same captured credential. Later env changes
do not change that lifetime. Closing/reopening selects a new lifetime, which must
attest again. The context is permanently tied to its original private target.
No CLI/cache fallback or Authorization/Bearer path exists.

## Fixed HTTPS policy

executeHandoff(executionContext,opaqueHandoff) is the only request API. No caller
endpoint, method, header bag, GraphQL source, variables, timeout, redirect policy,
signal or transport callback is accepted. The immutable handoff supplies the body.

| Policy | Exact implementation |
| --- | --- |
| HTTPS endpoint | https://backboard.railway.com/graphql/v2 |
| host / path / port | backboard.railway.com / /graphql/v2 / 443 |
| method | POST |
| explicit headers | Content-Type: application/json; Project-Access-Token: private captured value |
| body | JSON.stringify of exact frozen {query,operationName,variables} |
| TLS | rejectUnauthorized:true; native hostname/certificate validation |
| agent/proxy intake | agent:false; no caller/global-agent or proxy configuration intake |
| timeout | absolute 10,000 ms for the whole request/response attempt |
| response body maximum | 1,048,576 bytes (1 MiB) |
| response header maximum | 16,384 bytes |
| accepted HTTP status | exactly 200 |
| accepted content types | application/json or application/graphql-response+json; optional charset=utf-8 only, case insensitive |
| duplicate Content-Type | rejected; exactly one raw header required |
| encoding | absent or identity only; no decompression |
| Content-Length | if present, canonical nonnegative integer, within body bound and equal to received bytes |
| body decoding | fatal UTF-8 decoding; JSON object only, no array/null/scalar |
| redirects | rejected as non-200; never followed |
| retry | zero; one HTTPS attempt per consumed handoff |

The 1 MiB bound is deliberately below the 0106 stdin transcript aggregate limit:
each request inspects one bounded type, not an entire transcript. If legitimate
provider metadata exceeds it, stop and separately review a bound change; do not
truncate evidence or retry with a larger request. The fixed deadline includes
connect/body waiting, not merely idle socket time.

Timeout, byte overflow, incompatible status/header/encoding, truncated/aborted
response, protocol error, invalid JSON/UTF-8 or connection/native request error
destroys request/response where available and rejects with only
"Railway private HTTPS evidence unavailable". Native errors, response bodies,
headers and token values are never logged or attached as causes. Timers are cleared.
No raw disk persistence, logger or automatic capture function exists. Native HTTP
framing headers are generated by Node; the caller-visible explicit header bag is
the two fixed entries above, not a generic header override.

## Context-first gating and private invocation results

A context starts unattested. executeHandoff consumes a genuine context/schema
handoff against that context's **original** target. Schema before attestation, a
wrong target, invalid handoff or repeated context attestation fails closed. Only
one request or unconsumed result may be outstanding per execution context.

A successful HTTPS response becomes an opaque frozen result handle. The private
adapter WeakMap record binds execution-context identity, original target identity,
consumed handoff and original permit record, exact immutable request/kind, fixed
endpoint/auth kind and the body parsed from that exact invocation. No public
constructor, deserialize/import path or caller body can insert into the map.
Results from a different adapter module instance fail lookup, even with the same
IDs, token literal or serialized shape. No mutable authoritative body is returned.

consumeContextResult(result) accepts exactly one original opaque handle. It consumes
the result before checking validity, then applies the 0108 validator to the stored
body and original target. Exact successful IDs mark **only that same private execution
context** attested. Output uses projectIdSha256/environmentIdSha256, with per-invocation
providerContextObserved:true and projectEnvironmentContextProven:true, while service
proof stays false and execution/identity/causality/restart claims remain false/null.
These true flags are available only from this private invocation consumer; they do
not change frozen repository/current status. Test-loaded outputs are synthetic and
are not observations of Railway. Detached normalized evidence cannot be imported
as private context authority.

consumeSchemaResult(result) similarly consumes once and requires the same attested
execution context. It verifies that the original stored 0106 session still has the
same request/stage, then validates its stored body through plan.accept. Output remains
the minimized 0106 evidence, with executionSchemaReady:false. No body/session/target/
request replacement argument is accepted. Wrong consumer, invalid body or stale stage
consumes/fails and closes the context. The context is not reusable after a transport
or validation failure; any manual new attempt requires a fresh context, fresh context
attestation and fresh reviewed permits, never an automatic retry.

Service proof remains unnecessary for schema-level inspection. It remains a separate
future qualification constraint, not a runtime/execution identity proof.

## Close/invalidation and current authority

closeExecutionContext(originalHandle) is idempotent for that owned handle. It marks
the context closed/unattested, releases its secret reference, aborts an active request
and deletes all unconsumed private result records. Result consumption after close
fails; no new request can use the closed context. Outstanding handoffs cannot execute
through it. A still-unconsumed handoff may only be attempted in another context tied
to the same original target and subject to fresh context-first gating; closure does
not transfer attestation. Results/permits already consumed are never revived.
JS/native immutable string storage is not claimed to be securely zeroized; private
references are released where possible and no disk/public copies are made.

Frozen adapter status reports adapterImplemented:true, transportContractReady:true
and providerContextAttestationReady:true, but providerContextObserved:false,
projectEnvironmentContextProven:false, serviceContextProven:false and
executionSchemaReady:false. identity_proven, causality_proven, restart_origin_proven
and platformRestart remain null. restartAttribution remains {measurement:null,
limitation:"restart_origin_unattributable"}. Historical 0107/0108 states are preserved.
Introspection structure still cannot establish operational scope/order/pagination
exhaustion/completeness, runtime provenance, restart origin or fresh qualification.

## Test isolation and remaining live gates

supabase/tests/fixtures/0109-railway-https.cjs loads a separate adapter instance in
an isolated VM with synthetic process.env, node:https and deadline timers. There is
no corresponding production injection parameter. The normal native HTTPS/fetch
functions are guarded in focused tests, and any normal-module network attempt fails
the test. VM results fail consumption in the normal module or another VM instance.
Module/object ownership, not JSON prose, determines which instance owns a result.
This assumes protected reviewed module/runtime code; arbitrary modification of the
trusted Node loader or native library is not solved by public-object WeakMaps.

Before first live projectToken attestation: review/accept the exact adapter, ticket,
handoff and result code/hash versions and safety policy; approve actual active
non-production target IDs and complete forbidden inventory; have the operator
provision a project/environment-scoped token from a known approved origin outside
Codex, with only the approved source name and no API-token conflict; choose an
authorized operator host; and obtain separate explicit authorization for this exact
read-only context request. No raw-capture path is implemented or implicitly approved.
No credential value should be sent to Codex or placed in a command argument.

Before first live schema request: all the above, plus a successfully consumed real
context result in that same original-target/captured-credential execution context,
and a fresh manual review/one-use schema permit for the original 0106 session/stage.
Consume schema results before reviewing the next stage. Any error requires stop;
no fallback, reauthentication, redirects, broader lookup or unattended crawler.
Service proof alone does not block schema inspection. Fresh disposable qualification,
global one-shot authority, runtime identity and restart-origin proof remain deferred.

## Local validation record

0109 focused: 78 tests, 78 PASS, zero failures/skips. Final serialized combined set:
828 total, 825 PASS, three existing OS-specific skips, zero failures. Includes
0108/0107/0106/0105, both 0104 suites, 0103, Railway/operator/remote 0102 suites,
0101, 0099, worker-process and migration-integrity. App, Edge and worker typechecks
PASS. The earlier 824-test serialized run also passed before the four additional
native-diagnostic guard cases; the final run verifies the guarded implementation.
Windows IPC signal dispatch is not proof of POSIX signal delivery or Railway restart.

All execution-path tests used isolated synthetic module instances; focused guards
asserted zero normal-module HTTPS/fetch attempts. The normal production module's
openExecutionContext was never invoked. No real token or credential env value was
read, and no provider observation occurred. Per-invocation true flags in VM tests
are synthetic outputs and cannot be imported into the normal module's WeakMaps.

109 protected files, including all 99 migrations and worker/reader/child/supervisor,
0106, original target/request builder and 0108 modules, match exact HEAD blob or Git
checkout bytes. The sole authorized existing boundary-code change is the two-method
0107 original-object handoff extension; its export-surface test is updated exactly.
No original assertion is removed. Ten changed/new task files pass whitespace checks;
git diff --check PASS. HEAD remains 3d99e1477e3837edf42c9bc4e0d5bd8e832dbbfc on
the requested branch; index empty. Five tracked task files are modified and five
task files are new/untracked. The capsule remains untouched, unread and untracked.
No live provider/Supabase/Railway/CLI call, credential/cache inspection, stage,
commit, push, deploy, restart/redeploy or production access occurred.
