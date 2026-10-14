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

Only an original private provider-result capability may advance a stage. The
0112 context-only path now lets ingress consume an adapter-owned receipt bound
to the original session and live execution context. There is still no issuer,
raw-body factory, callback or injection export in ingress. Raw and synthetic VM
handles cannot enter the normal authority namespace. Local implementation is
distinct from a reviewed live host: providerResultIngressConnected remains false,
and no actual observation has occurred. Service/instance result integration
remains unavailable. Existing synthetic acquisition tests use a separate VM
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

Instance lookup uses only the previously observed service and attested
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

The future adapter bridge takes the original handoff once through
`takeIdentityHandoffForFutureAdapter(handoff, originalSession, originalExecutionContext)`.
It receives the fixed request and an opaque invocation capability. Its private
result must bind that invocation, session, original target, live execution context,
operation kind, endpoint `https://backboard.railway.com/graphql/v2`, project-token
auth kind and exact request. The issuer must itself enforce 0109 ownership,
context-first success, credential-lifetime liveness, separate human live permission,
one-use ownership and fixed-origin transport; caller claims are insufficient.
`acceptIdentityObservation` burns the invocation and consumes that private result
before exact request and shape validation. Closed-lifetime results must be burned
and rejected by the trusted ingress; synthetic tests cover that contract.

**Service/instance transport integration remains unimplemented.** The adapter
recognizes context/schema execution handoffs, not these identity request handoffs.
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
