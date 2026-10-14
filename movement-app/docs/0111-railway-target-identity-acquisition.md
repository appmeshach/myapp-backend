# 0111 Railway target identity acquisition foundation

**TARGET IDENTITY NOT OBSERVED. Outcome: TARGET_IDENTITY_UNRESOLVED.**

This milestone prepares how we check the real Railway target before future live
qualification. It sends no request and obtains no actual ID. Local readiness
`targetIdentityAcquisitionReady=true` means the documents, validators, private
review flow and inventory wrapper exist. It does not mean a live transport path
is connected: `providerResultIngressConnected=false`, `targetIdentityObserved=false`.
0110 still says PRELIVE_NOT_AUTHORIZED. Its implementation parent remains historical
metadata; future reviewed current HEAD/branch must be supplied explicitly. The
current implementation HEAD is not hardcoded as future authority anywhere here.

## Names describe; IDs identify

`thorough-blessing` and `myapp-backend` are human labels. The branch
`feature/0092-shared-segment-suitability`, root `/movement-app`, and historical
region `europe-west4-drams3a` are expectations or corroborating metadata. None
is converted into a project, environment, service or instance ID.

Actual projectId, environmentId, serviceId and serviceInstanceId remain unresolved.
A future independently authorized operator review must obtain explicit resource
IDs from reliable read-only metadata, record their provenance, and compare the
intended disposable/non-production scope. Reading a resource's explicit ID is
different from guessing one from its name. This document performs or authorizes
no dashboard automation, discovery or account listing.

The existing 0107 binding requires independently supplied operator-expected
projectId, environmentId and serviceId; serviceInstanceId may initially be null.
0111 deliberately preserves that prerequisite. If only labels are available,
STOP: a context execution target cannot yet be formed. A future operator must
first review expected IDs outside this milestone. They remain operator
constraints, not provider evidence. A provider-returned service or non-null
expected instance mismatch also stops the chain rather than silently replacing
the original target.

Possible future evidence channels include named provider variables
`RAILWAY_PROJECT_ID`, `RAILWAY_ENVIRONMENT_ID`, `RAILWAY_SERVICE_ID`. These are
names only in 0111; their values are neither read nor current authority. No such
channel substitutes for the authenticated projectToken context result.

## Expected values and provider observations

`startTargetIdentitySession(originalPrivateTarget)` creates an opaque private
session. Inspection shows every ID's `operatorExpectedValue`, initially null
`providerObservedValue`, expected source `operator_expected_constraint`, and
the required provider evidence source:

| ID | Required observation source |
|---|---|
| projectId | provider_project_token_context |
| environmentId | provider_project_token_context |
| serviceId | provider_project_services |
| serviceInstanceId | provider_service_instance_metadata |

The historical project/service labels remain expected. The minimal queries do
not observe projectName or environmentName, so those observed names remain null.
Pure public response validators accept untrusted data only and return
`validationOnly:true`, `serviceContextProven:false`. Their output cannot advance
the private session. Operator-entered IDs, matching strings, raw bodies, copied
sessions/results, and flags such as `providerObserved:true` cannot establish
provider evidence.

Only an original private provider-result capability may advance observation stages;
0114A adds a separate original human service-review gate between them. The
0112 context-only path now lets ingress consume an adapter-owned receipt bound
to the original session and live execution context. There is still no issuer,
raw-body factory, callback or injection export in ingress. Raw and synthetic VM
handles cannot enter the normal authority namespace. Local implementation is
distinct from a reviewed live host: providerResultIngressConnected remains false,
and no actual observation has occurred. 0114B implements local project-services
transport/result integration; service-instance integration remains unavailable. Existing synthetic acquisition tests use a separate VM
dependency; the 0112 tests use a coherent isolated adapter/identity/ingress graph.

## Two phases and fixed contracts

Phase 1 uses the existing `Movement0108ProjectTokenContext` document, canonical
SHA-256 `d3190e45cbf0ec1242ef090a9a5a437c4043a5e7542b075921744349b8039e28`.
The future trusted ingress must consume/validate its genuine private 0109
context result in that original credential lifetime, associate it with this
session and original target, and convey the exact validated response values.
0111 revalidates equality with the expected project/environment. No other route
can populate those observed IDs.

Phase 2 has two fixed read-only documents:

| Operation | Canonical SHA-256 | Exact variables |
|---|---|---|
| Movement0111ProjectServices | `fa6231580d6acec3510c26f4be5972605a3648c4c47f7da73eaa24021b137833` | `{id: observedProjectId}` |
| Movement0111ServiceInstance | `e247e7ec5e98cc71bc399304c37846ede31d7009096da4449f9bc8e88f267493` | `{serviceId: observedServiceId, environmentId: observedEnvironmentId}` |

Exact sources are [project-services.graphql](0111-target-identity/project-services.graphql)
and [service-instance.graphql](0111-target-identity/service-instance.graphql),
also frozen in the module. Canonical hashing uses the embedded LF source plus
exactly one final LF, UTF-8, with no trimming. Checked-in CRLF is normalized to LF
for source comparison. There is no generic source/name/variable override.

Service discovery queries only the already-attested project. It never uses `me`,
account/workspace enumeration or CLI listing. The validator requires exact
response keys without errors, matching project.id, at most 256 edges, valid IDs,
and no duplicate IDs or names. It selects only the unique exact name
`myapp-backend`. Zero matches, duplicates, fuzzy/case matches and malformed shapes
fail. It also checks the retained operator-expected service ID. The response is a
candidate observation, not proof of service context or account-wide completeness.
The fixed query observes `services.pageInfo.hasNextPage`. Services must contain
exactly edges and pageInfo; pageInfo must contain exactly the boolean hasNextPage.
Only `hasNextPage=false` permits service selection. A missing, null, malformed or
extra-field pageInfo fails. `hasNextPage=true` means the connection may be
incomplete: the entire observation fails even when an exact target is present.
No service ID is stored, the private session fails, and its consumed observation
and invocation cannot be replayed after changing the body. 0111 does not paginate,
issue a second request, retry or fall back. No first/after/cursor or paging callback
is accepted. Resolving truncation requires a different separately reviewed
milestone; single-connection completeness is not account-wide inventory proof.

Instance lookup requires the 0114A exact human service approval, then uses only
the previously observed service and attested
environment. Its exact response contains id, serviceName, rootDirectory and
region. Null serviceInstance, missing/malformed ID or wrong service name fails.
Instance ID comes only from response.id. A non-null root must match `/movement-app`;
null root remains unresolved corroboration. Region may be null or bounded safe
provider metadata; historical region equality is not required. Root and region
never manufacture an ID. The response does not echo service/environment IDs:
their association depends on the original private invocation and same-context
transport provenance, not on serviceName/root/region.

## Private permits and future transport integration

Reviews, permits, adapter handoffs, invocation handles, candidates and final
target handoffs use private WeakMaps. Review acknowledgement is exact metadata
plus `reviewed:true`; it remains a local permit, never live authorization.
Original-object identity, stage/revision and execution context are retained.
Reviews/permits/handoffs/invocations are one-use and burn before validation.
Stale/copy/wrong-stage handles fail; invalid accepted observations fail the session
with no retry. A different private target with identical IDs cannot substitute.

The 0114B adapter bridge takes the original handoff once through
`takeIdentityHandoffForFutureAdapter(handoff, originalSession, originalExecutionContext)`.
It receives the fixed request and an opaque invocation capability. Its private
result must bind that invocation, session, original target, live execution context,
operation kind, endpoint `https://backboard.railway.com/graphql/v2`, project-token
auth kind and exact request. The bridge enforces 0109 ownership, context-first success, credential-lifetime
liveness, one-use ownership and fixed-origin transport; caller claims are
insufficient. The future acquisition owner must separately enforce human live
permission; this plumbing adds no executable acquisition authorization.
`acceptIdentityObservation` burns the invocation and consumes that private result
before exact request and shape validation. Closed-lifetime results must be burned
and rejected by the trusted ingress; synthetic tests cover that contract.

**0114B implements project-services transport locally; service-instance transport
remains unimplemented.** The adapter now has a separate fixed project-services path; its existing
context/schema executor is not a generic identity-handoff executor.
Its public ordinary context consumer still returns only hashed scope facts.
[0112 context transfer](0112-railway-context-result-transfer.md) adds a separate
private one-use path from an original genuine context result to this session.
It retains the original validated body and finalizes attestation only after this
owner accepts it. No request occurred and no actual Railway identity was observed.
New service/instance execution kinds still require separate protected review and
live permission. No second HTTPS client, generic GraphQL, environment reader,
schema behavior change or live ticket is introduced.

## Forbidden inventory and final human review

Forbidden inventory is the set of Railway IDs the approved safety policy says
must never be used for this qualification. Completeness does not mean enumerate
every Railway resource in the account. It means the operator deliberately
identified every prohibited ID relevant to that policy.

`reviewForbiddenInventory(originalTarget, record)` requires inventoryReviewed,
a safe basis/provenance description and all four category records. Each has
`reviewed:true`, `completenessAcknowledged:true`,
`completenessIsOperatorAssertion:true`, bounded unique valid `ids`, and optional
known `{id,label}` entries in `labels`. Labels must refer to listed IDs. An empty
array is valid only with every explicit acknowledgement; null/missing/unreviewed
data fails. Completeness is an operator assertion, not observed account inventory.
Comparisons preserve case and category namespaces. Original-target collisions are
rejected, then final observed-ID collisions are checked again, including an
instance discovered after an initially null expected instance.

Separate Supabase metadata records production `xdfmoggrsucisfybqctb`, inactive
`udlsysezmzutydnifhsq`, and consumed historical disposable `uzkhnslyrhgucijcuoes`.
They are not Railway IDs; do not insert them into Railway arrays. Production and
inactive projects are never disposable targets; the consumed ref grants no new
qualification authorization. No cross-system ID comparison is performed.

A fully observed safe candidate contains the four observed IDs, expected project
and service names, null unobserved project/environment names, observed service
name/root/region, per-phase evidence labels, `providerObserved:true`,
`humanReviewed:false`, and `serviceContextProven:false`. Only synthetic VM tests
create one in 0111. Global state stays unchanged even when tests reach this stage.

Human acceptance requires the exact entire candidate and digest, exact inventory
digest, explicit no-collision confirmation and intended disposable/non-production
confirmation. This covers all four IDs, labels, root, region and evidence sources.
Human review cannot strengthen provider evidence beyond what was observed.
The approved private handoff is one-use and bound to the original target.

`takeReviewedTargetFor0110` converts only that original approved handoff into a
fresh 0107 binding containing the reviewed observed IDs (including a newly known
instance), plus the 0110 inventory shape. Full completeness/provenance is preserved
alongside the compatibility arrays. It does not modify 0110, create a draft,
resolve future reviewed HEAD, grant schema/qualification permission or mint a
live ticket. A new 0110 review remains necessary.

## Required future sequence

1. Independently review expected IDs and complete policy inventory; form the
   original private disposable target. Review current committed code/HEAD/branch,
   host assumptions and the trusted future integration.
2. Complete 0110 review and obtain separate explicit human authorization for one
   first-live context request; consume its ticket before any credential read.
3. Open the original 0109 execution context; send only the fixed 0108 context query.
4. Consume and validate the genuine project/environment result in that lifetime.
5. Only then review and separately authorize the scoped service-list operation;
   use its original permit/handoff and that same execution context.
6. Validate project scope and exact unique service selection, retaining operator
   constraints. Only then review and separately authorize the instance operation.
7. Execute the fixed instance lookup in that same context, validate original
   service/environment invocation binding and exact response, then form a candidate.
8. Human reviews the entire candidate, inventory completeness/provenance, forbidden
   collisions and disposable scope. Consume the original approved handoff.
9. Feed the fresh original target and inventory compatibility record into subsequent
   0110 planning with explicitly reviewed current HEAD/branch and fresh approvals.

STOP for unknown expected IDs, incomplete inventory, missing permission, copied,
reused or stale handles, source/query or scope mismatch, closed credential lifetime,
ambiguous/truncated service selection, null/malformed response, forbidden collision,
or any transport/provider error. No retry or fallback is authorized. Schema still
requires successful real same-context attestation, fresh stage review and original
one-use schema permit, plus separate explicit live schema permission.

The [safe template](0111-target-identity-review-template.json) has null IDs and
observations, unchecked inventory, providerObserved=false, humanReviewed=false and
manualLiveAuthorization=false. Global providerContextObserved,
projectEnvironmentContextProven, serviceContextProven and executionSchemaReady
remain false; identity_proven, causality_proven, restart_origin_proven and
platformRestart remain null. Restart origin remains unattributable.

## NOT AUTHORIZED BY 0111

- No Railway request, Railway CLI or dashboard automation.
- No Supabase request or GitHub API.
- No token, credential/cache or provider-variable read.
- No schema inspection, fresh qualification or live ticket.
- No mutation, deployment, redeployment, restart or production access.
- No staging, commit or push.

At the original 0111 milestone the existing 0106-0110 boundaries were unchanged.
0112 later adds the reviewed context-only transfer to 0109/0111 and updates the
0110 source pins; service/instance transport remains unsupported. All 99 migrations
and the other protected worker foundations remain unchanged. The capsule remains
unread and untouched.

## 0114A mandatory human service review

[0114A foundation](0114a-railway-service-review-authorization-foundation.md) now
makes accepted service observation stop at service_review. Only
reviewObservedServiceCandidate(session) followed by
approveObservedServiceCandidate(originalReview, originalSession, exactAcknowledgement)
can advance the same session to service_instance. The original private review
binds accepted observation/facts, context, ownership and exact revision; it burns
once before approval validation and cannot be duplicated. Descriptive IDs/names,
copied JSON, hashes and humanReviewed flags grant no authority. Instance review is
impossible before approval. Final target review still requires instance evidence
and the existing reviewed forbidden inventory. Existing selection/pagination
validation is preserved; no new unexpected-service inventory policy was invented.
No live request or real credential read occurred. Actual IDs remain unresolved;
service/instance transport and the future acquisition wrapper remain unsupported.
0112 context-transfer semantics and the disposable 0113 wrapper remain unchanged.

## 0114B trusted fixed project-services bridge

[0114B transport](0114b-railway-project-services-transport.md) consumes the existing
original handoff through takeIdentityHandoffForFutureAdapter, without changing
this identity owner. bindProjectServicesTransfer(C, S, H) requires completed
accepted context in that same original S/C; executeProjectServices(transfer)
sends only the retained fixed request; prepareProjectServicesResult(R, transfer)
returns original invocation and a one-use opaque ingress receipt.
acceptIdentityObservation(S, invocation, receipt) performs the existing final
checks and advances only to service_review. No automatic human approval occurs.
The exact original service review/approval remains mandatory before instance review.

Provider ingress remains consumer-only, with no surviving issuer, raw-body
factory or callback registration. Closing C invalidates outstanding services
state; success leaves C open. No second dispatch, concurrency, retry, redirect,
fallback, page traversal, context migration or new inventory policy is added.
This plumbing has no live acquisition owner/authority. Service-instance transport,
the final acquisition wrapper and human-wait mechanism remain absent. Actual
Railway IDs remain unresolved, global authority stays false/null, and no live
provider request or real token/provider-environment read occurred. 0112 context
transfer behavior and the one-shot/disposable 0113 wrapper remain unchanged.

## 0114C service-instance transport

[0114C](0114c-railway-service-instance-transport.md) consumes the original fixed
instance handoff through the unchanged identity owner, which remains the sole
authority for prior human service approval and current revision. Exact original
S/C and the consumed original services attempt are required; no matching JSON,
copied review, boolean flag or caller request can substitute.
bindServiceInstanceTransfer, executeServiceInstance, prepareServiceInstanceResult
and cancelServiceInstanceTransfer use separate private instance namespaces.
The fixed query uses only the original handoff's approved observed serviceId and
accepted environmentId. acceptIdentityObservation advances only to candidate;
final target review remains manual/existing. Success leaves C open for 0114D.
Context and services behavior, inventory policy and all global authority are unchanged.
Service-instance transport is implemented locally, but acquisition wrapper,
bounded human wait and executable live acquisition authorization remain absent.
Actual IDs remain unresolved and live acquisition unauthorized. No real
Railway/provider request or credential/provider-environment read occurred.

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

## 0114E offline acquisition input review

[0114E input review](0114e-railway-acquisition-input-review.md) adds an offline
worksheet and independent operator review procedure, exercised by synthetic tests
using existing APIs. Actual Railway IDs remain null; historical labels are not IDs.
Forbidden inventory requires explicit provenance and completeness acknowledgements.
Host/checklist presence grants no execution authority. No sealed executable package,
ticket, identity session, execution context, credential read or provider request is
created by this workflow. All 12 pins and runtime modules remain unchanged.
0114D acquisition still requires a later separately reviewed and manually authorized
execution; the safe outcome remains PRELIVE_NOT_AUTHORIZED.
