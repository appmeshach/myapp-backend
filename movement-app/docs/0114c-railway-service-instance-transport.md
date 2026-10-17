# 0114C fixed service-instance transport and provider provenance

Local transport only. PRELIVE_NOT_AUTHORIZED. Actual Railway IDs remain unresolved.
No real provider request or real credential/provider-environment read occurred.
The acquisition wrapper, bounded human wait and executable acquisition authorization
remain absent. The exact existing human service gate and final target review are
not weakened or automated.

## Design check and original approval authority

The unchanged takeIdentityHandoffForFutureAdapter returns exactly kind, session,
binding, executionContext, request and invocation. Current revision is checked
inside its private owner record; it is not returned as caller-controlled authority.
The request is deeply frozen and already contains the exact serviceId/environmentId.
No shadow request or second source of truth is introduced.

In the unchanged identity owner, requestFor can build serviceInstance only at
service_instance with a private serviceApproval tied to exact serviceFacts,
accepted observation, binding, original C and current revision. The existing
review/permit/handoff consumers retain stage/revision; taking H burns it and
requires the same S/C and pending stage/revision. This genuine original handoff is
the proof that the original human approval succeeded. The adapter adds no public
or private humanReviewed approval flag.

The adapter additionally requires its completed original context attestation
and consumed original servicesAttempt to belong to that same S, target, C and
owner. A consumed services receipt alone cannot create H: the unchanged owner
still requires accepted evidence and exact human approval. Service_review, copied
reviews, boolean flags, matching service IDs/JSON and request availability grant
no instance transport authority.

## Exact production scope

Functional production addition:
- scripts/assessment-worker/qualification-railway-https-adapter.cjs

Provider boundary:
- scripts/assessment-worker/qualification-railway-target-identity-provider-boundary.cjs
  updates its descriptive consumer comment; its existing privately wired closure
  automatically routes the newly owned instance receipts. Public surface and
  consumer-only initialization remain unchanged.

Pin-only production change:
- scripts/assessment-worker/qualification-railway-live-authorization.cjs

New production files: none. Identity owner, 0113 wrapper and all migrations
are unchanged. The original 0114B services functions are source-identical and
regression-tested, including bind/execute/prepare/cancel and supporting validation.
No generic identity executor, schema transport, qualification/restart logic,
pagination, fallback, redirect following or inventory policy change is introduced.

## Narrow API and instance ownership

New adapter APIs:
- bindServiceInstanceTransfer(C, S, H): exactly three arguments; opaque transfer.
- executeServiceInstance(transfer): exactly one argument; Promise of genuine opaque R.
- prepareServiceInstanceResult(R, transfer): exactly two arguments; frozen
  object with exactly invocation and result (opaque ingress receipt).
- cancelServiceInstanceTransfer(transfer): exactly one argument.

Independent instanceBindings, instanceTransfers, instanceResults and
instanceReceipts WeakMaps own all instance capabilities. Context-owned Sets allow
close to invalidate every outstanding instance handle. Permanent instanceAttempt
history prevents a second instance bind/dispatch in C. Existing servicesAttempt
history is retained by reference; services requests cannot dispatch again.

A bound entry retains original kind/S/binding/C/request/invocation, original owner,
context record, completed attestation, original consumed servicesHistory and phase.
Dispatch burns the original binding before arity/state checks and moves the
original transfer into the completion pool. One existing post call sends the
retained request. Duplicate/concurrent execution cannot locate the burned binding
and cannot send another request; the original winning execution can complete.

The private result binds exact attempt, original S/binding/C/invocation/request,
kind=service_instance, endpoint/authKind and actual parsed frozen provider body.
Preparation independently burns any located result and transfer before validation,
requires exact pairing/provenance/liveness, and repeats objective metadata
validation plus any non-null expected instance-ID constraint. The unchanged identity
owner remains final semantic authority and repeats its strict validation.

The existing provider-boundary exports remain exactly status and takeObservation.
Its private consumer closure discriminates context/services/instance ownership
using adapter-private pools, never caller kind strings. The new private instance
consumer is not exported. The initialization connector is still removed before
normal import completes. No surviving installer, consumer retrieval, body factory,
provider issuer, ordinary callback registration or production test hook exists.
Trusted host/module-loader/built-in integrity remains an assumption, as before.

## Fixed request

Operation: Movement0111ServiceInstance.
Canonical query SHA-256:
e247e7ec5e98cc71bc399304c37846ede31d7009096da4449f9bc8e88f267493

Request has exactly data-only query, operationName, variables.
Variables have exactly serviceId and environmentId.
The original request derives serviceId from accepted serviceFacts that passed
the exact original human review; environmentId comes from accepted contextFacts.
The adapter verifies exact source/hash/operation/keys and attested environment.
Its comparison to retained target serviceId is only a consistency check: both
services early validation and final acceptance already required observed/expected
equality. The adapter does not construct execution IDs from target/public summaries;
execution bytes and variables remain the original approved owner request.

The endpoint/method/auth reuse the existing fixed contract:
https://backboard.railway.com/graphql/v2, POST, project_token,
Project-Access-Token. Existing timeout, TLS, status/JSON/UTF-8/header/body limits
apply. No caller query, variables, operationName, endpoint, header, credential,
request object or transport callback is accepted. No new secret reader or secret
lifetime exists; only the original C's retained private credential is used.

## Acceptance, review and lifecycle

acceptIdentityObservation(S, invocation, receipt) consumes genuine instance
evidence, verifies exact private provenance and expected constraints, and advances
only to candidate. The candidate remains humanReviewed=false and
serviceContextProven=false. Final reviewTargetCandidate / approveTargetCandidate
with existing reviewed forbidden inventory remains mandatory manual/operator work.
No final review capability or qualification authority is automatically issued.

Success leaves C open/attested and releases busy through existing private
consumption semantics. 0114D will own bounded final human review and disposal.
No human-wait timer or automatic close on success is added.

Copied/serialized/forged capabilities cannot locate private pools. Genuine H burns
inside the unchanged identity owner. Original binding, result, transfer and receipt
burn before arity/provenance/state validation where established. Wrong session/C,
stale revision and invalid pairing fail closed; no burned capability is restored.
Wrong-namespace attempts cannot mint evidence.

Close before bind rejects; close after bind deletes transfer ownership; close
during request cancels HTTPS; close after response or receipt preparation makes
R/receipt unusable. Cancellation burns a bound/dispatching/responded transfer,
invalidates C, clears result/receipt state and cancels any active post. Invalidation
clears C's secret reference without claiming memory zeroization. There is no retry,
replacement context, alternate handoff, second dispatch, reopen or automatic recovery.

Transport invalidation and identity failure remain distinct. Adapter errors close
C and invalidate its attempt/pools without inventing new session mutation. S can
remain pending with an unusable closed C. Existing owner rejection during handoff
taking or final acceptance uses its existing failed-stage semantics. This preserves
0114B/0112 ownership rather than introducing a new state authority.

Context, services and instance receipt/result/transfer pools are mutually
non-substitutable. Raw R is not an ingress receipt. Services/schema handoffs cannot
enter the instance binder; instance H cannot enter services. 0113 authority cannot
serve as an instance capability. Copies/matching JSON cannot issue observations.

## Global authority and authorization

Global providerContextObserved, projectEnvironmentContextProven, serviceContextProven,
executionSchemaReady and targetIdentityObserved remain false; identity_proven,
causality_proven, restart_origin_proven and platformRestart remain null.
Session-local provider-observed candidate evidence does not promote global authority.

0110 authority is still context-only. The acquisition planning namespace remains
PRELIVE_NOT_AUTHORIZED with transportSupported=false, liveAuthorized=false and
manualLiveAuthorization=false. Adapter availability does not authorize real
acquisition. No authorizeLiveAcquisition, takeAcquisitionExecutionAuthority,
acquisition ticket, host executor or acquisition wrapper consumer is added.

## Pins, templates and files

Exactly eleven pins remain. Changed pins are adapter and provider boundary only:
- Adapter: 6c25068a45e7ffe98f9db8bd1efe20e0bebad5140f740ea20725785af6361d6b
- Provider boundary: cf22b4ce9d68b36fa6c325f289661528fcfb6ec8e75d6acad9af5429be53e1df
- Unchanged identity: 1dce76ecf7657f40d6ad98a7347eecff868772c5812eeadf025165c80ebfcb47
- Unchanged wrapper: 7c3a376d1f7a1b733f3be90a3b7d43fb4aa2fd5256c5638a13e6301a3d78cf94
- authorizationBoundarySha256: f839671578650a222e349e213ec05b25b21f9356be7e013faebfb22c96a71821

All nine unaffected pins match committed 0114B. Canonical rules are unchanged:
UTF-8, CRLF-to-LF only, preserve other bytes/EOF.
Both docs/0110-live-review-template.json and
docs/0114a-acquisition-review-template.json regenerate exactly with null
reviewedHead/reviewedBranch, null actual Railway IDs, unreviewed inventory and
live authorization false. No pin 12 exists.

Tests added:
- supabase/tests/0114c_service_instance_transport.test.cjs
- supabase/tests/fixtures/0114c-service-instance.cjs

Tests changed:
- supabase/tests/0109_railway_private_https_adapter.test.cjs (exact additive API surface)
- supabase/tests/0114b_project_services_transport.test.cjs (recognize the separate
  new instance API and prove a services transfer cannot execute through it)

Execution tests use a coherent isolated VM graph with synthetic credentials,
environment and HTTPS. Private pool capture exists only in test VMs.
Real HTTPS/HTTP/fetch guards assert zero normal network calls. Test subprocesses
receive no inherited provider credentials. Pin comparison uses command-scoped
local Git trust; regression receives only explicit Git trust variables.
No normal-module real execution context is opened.

Docs updated narrowly: 0110 first-live preflight, 0111 identity acquisition,
0114A service gate/authorization foundation, 0114B services transport and the
launch readiness register. This milestone doc is added; both templates regenerate.

## Validation and remaining 0114D

Focused: 0114C 96/96; 0114B 72/72; 0114A 62/62; 0113 63/63;
0112 62/62; 0111 101/101; 0110 63/63; 0109 78/78.
Total 597 PASS, zero failures/skips. App, Edge and worker typechecks PASS.

The first isolated run's getter assertion was moved from VM-only private handoff
corruption (rejected by unchanged owner freezing) to adapter validation after
genuine bind. It now proves data-only descriptor rejection without getter access,
before dispatch. No identity semantics or production code changed to satisfy it.

Final serialized regression: 1,117 total, 1,114 PASS, zero failures, three existing
OS-specific skips. This is the same serialized 19-file chain used for 0114B:
0099, 0101, all three 0102 suites, 0103, both 0104 suites, 0105 through 0113,
tests/assessmentWorkerProcess.test.cjs and tests/migrationNumbering.test.cjs.
0114A/B/C run as separate focused suites.

All 99 migrations match existing index blob IDs through Git checkout filtering:
99 files, zero changes. Historical migration integrity passes in the regression.
Identity owner and wrapper paths have no diff. git diff --check PASS; new files
also pass trailing-whitespace/final-newline inspection.

HEAD: 3d978c44e09750ea8f21d2b47fe220ff717d5714.
Branch: feature/0092-shared-segment-suitability. Index: empty; no stage.
The protected capsule remains unread, untouched and already untracked.
No temporary file remains in the repository; verification scripts/logs are in OS temp.
No live provider/network request, Railway CLI, Supabase/GitHub API, real credential/
provider-environment read, stage, commit, push, deploy or restart occurred.
Only local Git, test and typecheck commands were run.

Remaining 0114D: implement a separately reviewed acquisition wrapper/lifetime
owner and executable authorization flow, bounded human service and final target
reviews, and final disposal on every exit. It must own one fresh C/S, repeat context
attestation, transport services, require exact human service approval, transport
instance, stop for exact final target review, then close C. No such wrapper,
human-wait mechanism or executable authority exists here. No STOP condition was encountered.

## Exact final git status

     M docs/0110-live-review-template.json
     M docs/0110-railway-first-live-context-preflight.md
     M docs/0111-railway-target-identity-acquisition.md
     M docs/0114a-acquisition-review-template.json
     M docs/0114a-railway-service-review-authorization-foundation.md
     M docs/0114b-railway-project-services-transport.md
     M docs/MOVEMENT_LAUNCH_READINESS_REGISTER.md
     M scripts/assessment-worker/qualification-railway-https-adapter.cjs
     M scripts/assessment-worker/qualification-railway-live-authorization.cjs
     M scripts/assessment-worker/qualification-railway-target-identity-provider-boundary.cjs
     M supabase/tests/0109_railway_private_https_adapter.test.cjs
     M supabase/tests/0114b_project_services_transport.test.cjs
    ?? 0102-remote-fixtures.capsule
    ?? docs/0114c-railway-service-instance-transport.md
    ?? supabase/tests/0114c_service_instance_transport.test.cjs
    ?? supabase/tests/fixtures/0114c-service-instance.cjs

## 0114D controlled acquisition lifetime and manual authorization

[0114D acquisition wrapper](0114d-railway-acquisition-wrapper.md) now owns one fresh
original S/C and exactly context, services and instance provider requests, with
separate five-minute human service and final target waits. It requires exact
original review submissions, performs no automatic human decision and closes C
on every terminal path before returning descriptive reviewed target facts.
No crash resume, provider retry/fallback/pagination, schema, qualification or
deployment/restart execution is added.

The original v1 acquisition namespace remains planning-only, transportSupported=false
and unauthorized. Separate movement_railway_identity_acquisition_auth_v2 provides
an executable path only after exact reviewed package/host/inventory/code and final
manualLiveAuthorization=true acknowledgement, followed by original one-use ticket
redemption exclusively by the pinned wrapper. V2 transportSupported=true describes
implementation
availability only. Safe templates retain PRELIVE_NOT_AUTHORIZED, false live/manual
authorization, null actual IDs/HEAD/branch and unreviewed inventory.
The acquisition safe template includes a separate executableAuthorization v2 view;
it does not promote the v1 planning manifest or old context-only authority.

The new acquisition wrapper is pin 12. All eleven previous source pins are unchanged;
the authorization self hash and both safe templates regenerate. Identity/review,
0112, 0114B/C transport and disposable 0113 semantics remain unchanged. No real
provider/network request or credential/provider-environment read occurred.
