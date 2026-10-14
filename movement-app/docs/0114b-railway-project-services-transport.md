# 0114B fixed project-services transport and provider provenance

Local plumbing only. PRELIVE_NOT_AUTHORIZED. Actual Railway IDs remain unresolved.
Transport implementation exists, but no authorized acquisition owner/authority
exists. No live Railway/provider request or real token/provider-environment read
occurred. Service-instance transport, final acquisition wrapper, executable live
acquisition authority and bounded human waiting remain absent.

## Production scope and unchanged foundations

Changed production files:
- scripts/assessment-worker/qualification-railway-https-adapter.cjs
- scripts/assessment-worker/qualification-railway-target-identity-provider-boundary.cjs
- scripts/assessment-worker/qualification-railway-live-authorization.cjs (two pin values only)

New production files: none. The identity owner is byte-identical to committed
0114A; its service review gate is unchanged. The original identity handoff already
supplies exactly kind, session, binding, executionContext, request, invocation.
Those original values are retained; no shadow request model, new session or
replacement context is introduced. 0112 P/B/R/T public semantics are unchanged.
The adapter adds only private retention of completed attestation's original
session/binding/context/owner/facts. Ordinary context summaries do not establish
that provenance. 0113 wrapper source and its one-shot/disposable behavior are unchanged.

## Narrow public adapter flow

New APIs:
- bindProjectServicesTransfer(C, S, H): exactly three arguments; returns opaque transfer.
- executeProjectServices(transfer): exactly one argument; returns Promise of opaque adapter result R.
- prepareProjectServicesResult(R, transfer): exactly two arguments; returns frozen
  object with exactly invocation and result (the opaque ingress receipt).
- cancelProjectServicesTransfer(transfer): exactly one argument; cancels a bound,
  dispatching or responded attempt and invalidates C.

The session must already hold accepted project/environment evidence from its exact
original C, finalized through the genuine 0112 context transfer. The adapter calls
the existing takeIdentityHandoffForFutureAdapter(H, S, C), which burns original H
and checks the original session/context/stage/revision. Adapter binding then checks
the handoff's project_services kind, target, completed attestation, original S/C,
owner identity and context liveness. No alternate acquisition/context or reopen
can substitute. Failures after locating C invalidate that transport context.

Binding marks C busy, retains a single permanent servicesAttempt and prevents
old/new concurrent dispatch. Execution burns the binding before arity/state checks,
moves the original transfer into a separate completion pool, and invokes the
existing fixed-origin HTTPS implementation exactly once. A second or concurrent
execute sees no binding and cannot dispatch; it does not invalidate a winning
original execute. No retry, fallback, redirect or second page request exists.
An attempted duplicate bind against a located C fails closed by invalidating C.

## Exact request and credential boundary

Operation: Movement0111ProjectServices.
Query canonical SHA-256:
fa6231580d6acec3510c26f4be5972605a3648c4c47f7da73eaa24021b137833

The request is the original deeply frozen handoff request. The adapter requires
exact data-only query/operationName/variables keys, exact query source and canonical
hash, and exactly one variable: id equals the previously accepted provider
projectId retained in completed context attestation. No caller request bytes,
query, variables, operationName, endpoint, auth header, token or transport callback
is accepted. The query is never reconstructed from caller data.

Endpoint/auth are fixed by the existing transport contract:
https://backboard.railway.com/graphql/v2, POST, project_token,
Project-Access-Token. Existing TLS, JSON/UTF-8, status/header/body limits and timeout
checks are reused. Only the original C accesses its retained private credential;
no new environment reader is added. No credential value is copied into provider
observations, return records, errors, docs or artifacts.

## Private ownership and provider consumer

The adapter has separate servicesBindings, servicesTransfers, servicesResults and
servicesReceipts WeakMaps. Each C tracks associated handles in private Sets so
close can delete all outstanding state. The retained attempt binds original owner,
S, binding, C, completed attestation, request, invocation and phase.
A genuine HTTPS result binds entry, kind=project_services, original S/binding/C/
invocation/request, endpoint/authKind and the actual parsed frozen provider body.
There is no public raw-body result factory.

Preparation independently burns any located R and transfer before validating
arity, phase, pool pairing, liveness, exact provenance and fixed request. It repeats
objective project-services validation and expected service-ID comparison before
issuing an ingress receipt. The unchanged identity owner independently performs
its existing final semantic and expected-ID validation again.

Provider boundary's public exports remain exactly status and takeObservation.
No public API is added; takeObservation now consumes genuine context or services
receipts through a private closure. Initialization synchronously links that closure
from the literal adapter to the literal boundary, deletes the temporary
_connectProjectServicesConsumer property and freezes exports before either completed
normal import returns. Both import orders are tested. No issuer, private consumer,
callback registration or raw-body factory survives import. Null-prototype export
objects avoid CommonJS circular-require prototype mutation.

This relies on trusted host/module-loader/built-in integrity, as existing source
pinning does. It does not authenticate malicious require-cache/preload changes.
Normal production imports expose no injection or initialization hook.

Services ingress burns the genuine receipt before arity/liveness checks, validates
the original attempt and returns only the private bound observation record to the
consumer. Context receipt dispatch forwards all arities to the existing context
consumer, preserving its burn semantics. Raw services R is not an ingress receipt.

## Acceptance, human review and lifecycle

acceptIdentityObservation(S, invocation, receipt) checks exact original session,
invocation, target, execution context, request, endpoint and auth kind, then strict
objective response facts and expected service ID. Success ends at service_review,
with no service approval, instance observation or final target candidate.
Instance review remains impossible until the unchanged exact original
reviewObservedServiceCandidate plus approveObservedServiceCandidate succeeds.
Service-instance handoffs cannot enter this services executor, even after human
approval. Schema handoffs likewise cannot enter it.

Success does not close C; C remains attested/open for the future same-context
review/instance lifetime. The private consumer releases busy after consuming its
receipt; final identity acceptance is synchronous. ServicesAttempt remains retained
and cannot dispatch a second services request in that C.

Close before bind rejects. Close after bind deletes pending transfer ownership;
close during HTTPS cancels the request; close after response or receipt preparation
makes R/receipt unusable. Cancellation burns a located transfer, invalidates C,
clears outstanding result/receipt pools and cancels any in-flight post. C's existing
credential reference is cleared; this is not a claim of memory zeroization.
No recoverability, replacement handoff or retry is introduced.

Identity state is mutated only through its existing consumers. Wrong original
handoff ownership/stage/revision follows the identity owner's existing failed-stage
semantics. Adapter cancellation/close does not invent a new identity-state mutation;
a session may remain pending with an unusable closed C. Final acceptance failure
uses the existing terminal failed stage. Copied/forged handles cannot locate private
entries; invalid genuinely located inputs burn before validation. Wrong paired
result/transfer invalidates the located attempts. Cross-module copies do not enter
another module's pools or consume the original module's capability.

Context and services result namespaces are disjoint. Context T/R cannot become a
services receipt; services receipt cannot satisfy context completion or an instance
invocation. 0113 cannot consume a services capability as execution authority.
The consumer cannot manufacture observations from matching JSON or copied artifacts.

## Authority, authorization and remaining work

All global providerContextObserved, projectEnvironmentContextProven,
serviceContextProven, executionSchemaReady and targetIdentityObserved remain false.
identity_proven, causality_proven, restart_origin_proven and platformRestart remain
null. Synthetic local observations do not promote frozen global authority.

0110 context authority remains context-only. 0114A acquisition planning namespace
stays transportSupported=false, liveAuthorized=false, manualLiveAuthorization=false.
The adapter plumbing does not create an executable acquisition ticket or authority.
Direct adapter availability is not human live permission; the eventual trusted
acquisition owner must enforce separately reviewed authorization.

No new unexpected-service inventory policy, service pagination, schema transport,
qualification execution, deployment or restart logic is added.

0114C gap: implement only the fixed same-C/S service-instance transport/provenance
path after exact human service approval, with its own reviewed one-use capabilities.
0114D gap: add the acquisition wrapper/lifetime owner, separately reviewed live
authorization and bounded human service/target waiting. It must own fresh C/S,
repeat context attestation, acquire services, require service review, acquire
instance evidence and require final target review, then dispose resources.
Neither milestone is implemented here.

## Source pins and safe templates

Exactly eleven source pins remain. Only adapter and provider boundary change from
committed 0114A. The identity pin and other eight unaffected pins are unchanged:
- Adapter: d6a85fe9f2c3eb8f985646018e8570f95c218878123c332a03c2f3e2526ba2f7
- Provider boundary: 8e24f4e4ae8f0f732606e0caf7a204d31ddd5807195d1ef50595feabd2e584de
- Identity: 1dce76ecf7657f40d6ad98a7347eecff868772c5812eeadf025165c80ebfcb47
- authorizationBoundarySha256: bbe947b0cb9e806109746de86d477b608c9025a5668a69451b125565bb4240bc

The authorization module changes only those two pin values. Canonical rules remain
UTF-8, CRLF-to-LF only, without trimming/BOM/EOF alteration. Both
docs/0110-live-review-template.json and docs/0114a-acquisition-review-template.json
regenerate exactly, retaining null actual target IDs and reviewed HEAD/branch,
unreviewed inventory and live authorization false. No twelfth source is added.

## Tests, docs and validation

Tests added:
- supabase/tests/0114b_project_services_transport.test.cjs
- supabase/tests/fixtures/0114b-project-services.cjs

Tests changed narrowly:
- supabase/tests/0109_railway_private_https_adapter.test.cjs (exact additive API surface)
- supabase/tests/fixtures/0109-railway-https.cjs (coherent isolated boundary initialization)
- supabase/tests/0114a_service_review_authorization_foundation.test.cjs (later authorized
  transport pin changes recognized without removing gate assertions)

Execution tests use isolated VM graphs with synthetic environment/HTTPS only.
Private pool capture is VM-only, with no normal production introspection export.
Normal HTTPS/HTTP/fetch guards record zero real calls. Test subprocesses receive
no inherited provider credentials. Module import-order tests use an empty environment.
Pin comparison uses local Git with command-scoped trust. Serialized regression
uses only three explicit Git trust variables and writes no Git configuration.

Focused suites: 0114B 72/72; 0114A 62/62; 0113 63/63; 0112 62/62;
0111 101/101; 0110 63/63; 0109 78/78. Total 501 PASS, zero failures/skips.
App typecheck, Edge typecheck and worker typecheck PASS.

The interrupted focused run's one failing assertion was corrected: a different VM
must reject an original receipt without consuming its original namespace. A separate
same-module/two-acquisition test proves wrong-session/instance receipt consumption
fails and burns. No production change was needed for that test failure.

Final serialized regression, using the same 19-file chain as after 0114A:
1,117 total, 1,114 PASS, zero failures, three existing OS-specific skips.
Command: node --test --test-concurrency=1 --test-reporter=tap over 0099,
0101, all three 0102 suites, 0103, both 0104 suites, 0105 through 0113,
tests/assessmentWorkerProcess.test.cjs and tests/migrationNumbering.test.cjs.
The focused 0114A and 0114B suites run separately.

All 99 migrations match their existing index blob IDs through Git checkout filters;
changed count zero. The regression's historical migration-integrity test passes.
Identity owner, first-context wrapper and all migration paths have no diff.
git diff --check PASS; new files also checked for trailing whitespace/final newlines.
No file outside the authorized production, tests, docs and safe-template scope changed.

Docs updated:
- docs/0110-railway-first-live-context-preflight.md
- docs/0111-railway-target-identity-acquisition.md
- docs/0114a-railway-service-review-authorization-foundation.md
- docs/MOVEMENT_LAUNCH_READINESS_REGISTER.md

Templates regenerated:
- docs/0110-live-review-template.json
- docs/0114a-acquisition-review-template.json

Added: docs/0114b-railway-project-services-transport.md.

HEAD: bdc3f942b1fa819118abf188e5b2658cf3dd4510.
Branch: feature/0092-shared-segment-suitability.
Index: empty; no staging occurred. The capsule remains unread, untouched and
already untracked. No temporary verification file remains in the repository;
test scripts/logs are in OS temp. No live network/provider request, Railway CLI,
Supabase/GitHub API, real credential/provider-environment read, stage, commit,
push, deploy or restart occurred. Local Git and test/typecheck commands only.
