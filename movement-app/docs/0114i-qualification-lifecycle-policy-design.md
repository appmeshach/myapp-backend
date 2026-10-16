# 0114I qualification lifecycle policy design

STATUS: DESIGN_COMPLETE_IMPLEMENTATION_NOT_AUTHORIZED

Starting HEAD: `41dc697db847d7698019f85da4725eb5e8f40658`

Branch: `feature/0092-shared-segment-suitability`

This is a proposed policy for independent review, deliberately defining semantics
missing from the existing contract. It is not an already reviewed policy, an actual
target assertion, implementation approval or acquisition authorization.

## Problem and authoritative inputs

The [policy analysis](0114e-qualification-lifecycle-policy-analysis.md) found an
exact accepted label but no sufficient positive factual predicate or target-state
transitions. This design supplies those decisions without changing prior records.
The [pending lifecycle review](0114e-qualification-lifecycle-review.md),
[current package](0114e-current-acquisition-input-review.json),
[qualification evidence](0114e-qualification-target-evidence.json),
[0114E procedure](0114e-railway-acquisition-input-review.md),
[0114D wrapper description](0114d-railway-acquisition-wrapper.md),
[reviewed 0114H design](0114h-railway-service-name-compatibility-design.md),
[0114H implementation record](0114h-railway-service-name-compatibility-implementation.md)
and [readiness register](MOVEMENT_LAUNCH_READINESS_REGISTER.md) supply the constraints.
The implemented 0114H v3 contract supersedes historical v2 descriptions of executable
intake; those historical descriptions are not edited or treated as current authority.

Source checks covered the target binder, live-authorization owner, target-identity
owner and acquisition wrapper under scripts/assessment-worker, with relevant
0107-0114 tests/fixtures. They establish exact scope checks, frozen package binding,
private one-use authorities, finite human waits and terminal cleanup. They do not
already implement the new lifecycle validity rules below. Synthetic active inputs
are contract examples, not evidence about the current qualification target.

## Preserved constraints

- Exact `environmentKind="disposable"` is mandatory. Production and reviewed
  inactive/decommissioned scopes are forbidden.
- Exact project/environment/service IDs and the sole executable service-name
  authority remain bound together; no name-based trust, normalization or fallback.
- Reviewed complete forbidden inventory is mandatory before executable use.
  Human approval never overrides a machine mismatch.
- `serviceInstanceId` may be null in preparation. Null does not imply an instance
  exists or grant wildcard authority; subsequent observations retain existing checks.
- Applied source settings, deployment, service health and host attestation are
  separate matters. Lifecycle implies no journey, runtime or provider state.
- One session/context, three fixed requests, both human gates, credential boundary,
  no retry/fallback/resume/fork and private permit burning remain intact.

## Candidate comparison

These are alternatives evaluated here, not existing policy definitions. All require
independent review and preserve the preceding constraints.

| Candidate | Strengths and weaknesses | Staleness, provider burden | One-shot compatibility, reuse, time and terminal behavior |
| --- | --- | --- | --- |
| A: currently approved for qualification | Minimal; approval alone leaves facts, scope and end event ambiguous. | High stale-approval risk without freshness. No inherent provider call required, but evidence standard absent. | Compatible only with added scope/expiry rules. Reuse possible; time bounds and cancellation/failure effects unspecified as written. |
| B: created, independently reviewed, not retired/decommissioned, currently approved | Adds existence/provenance and explicit exclusions; still leaves approval duration and attempt scope open. | Historical creation cannot prove continuing eligibility. Existing reviewed evidence can be reused subject to fresh operator confirmation; no mandatory new call. | Reusable target; needs bounded assertion and terminal rules. Failure/cancellation do not inherently retire the target. |
| C: eligible for exactly one authorized acquisition attempt | Clear terminal boundary, aligns with private permits. Alone, it lacks positive eligibility facts and pre-attempt expiry. | An unused approval can grow stale. No inherent provider observation; cross-process replay cannot be solved by a public attempt ID alone. | Ends on success/failure/cancellation. Target can be reused with a new assertion; does not permanently consume infrastructure. Requires a start deadline. |
| D: activation review until explicit revocation or bounded expiry | Auditable activation and validity window. Revocation-only variant is too stale; a bounded variant is stronger. | Bounded expiry limits stale assertions without polling the provider. An assertion still needs facts and package scope. | Compatible with existing owners; reusable target. A time window alone could permit multiple attempts unless terminal rules are added. |
| E: B + bounded D, scoped like C to one package/attempt | Selected: explicit administrative eligibility facts, exact context, bounded freshness, terminal closure. More metadata and validation than A-D alone, justified by stale/replay risks. | Fresh operator assertion plus independent review, not fresh provider polling. Unknown facts fail closed. Thirty-minute ceiling bounds unattended staleness. | One privately authorized attempt; terminal exits end the assertion, never permanently consume the target. Fresh assertion/review and separate authorization required for reuse. |

## Selected semantics and exact active predicate

Select E: **a short-lived, independently reviewed operator eligibility assertion
bound to one exact acquisition-input package and one intended acquisition attempt**.
It is not a persistent target-wide status. Its identity scope is the exact
project/environment/service tuple and reviewed service name, with the explicit
nullable instance expectation, within that package. It does not activate sibling
services, an entire environment, a project or later acquisitions.

For a proposed package P, assertion R and time t, active is legitimate if and only if
all of the following hold:

1. An accountable operator controlling the intended qualification allocation
   explicitly reserves the exact scope for this one read-only identity-acquisition
   attempt. The target was created, remains allocated for this purpose according to
   the operator's current knowledge, and is not known deleted, retired, decommissioned,
   consumed under another applicable policy, or subject to an unresolved teardown
   requirement. It is not production or allocated concurrently to an incompatible
   use. Unknown or disputed eligibility facts prevent assertion.
2. The scope is independently reviewed disposable qualification infrastructure.
   Required IDs/name have reviewed provenance and exact associations. R matches P's
   exact scope, code identity, branch/root expectations, evidence and inventory.
3. The complete reviewed forbidden inventory excludes this scope. The operator
   confirms no known relevant change since the referenced evidence/inventory reviews;
   the independent reviewer checks the basis and the current confirmation.
4. A distinct independent human reviewer explicitly accepts these facts and the
   evidence-to-policy mapping for this exact package/attempt, with no unresolved
   contradiction or disqualifying condition. Approval of implementation or historical
   identities alone does not satisfy this review.
5. R's activation time has arrived and its thirty-minute expiry has not:
   `reviewedAt <= t < expiresAt`, with `expiresAt = reviewedAt + 1800000 ms`.
   R is not revoked, closed or replaced, and its bound package/evidence/code inputs
   have not changed. Its one attempt has not reached a terminal exit.

These conditions are jointly sufficient for this proposed administrative eligibility
assertion only. They are not sufficient for package completion or execution. Host
attestation, whole-package review, explicit manual acquisition authorization and all
machine gates remain separately mandatory. No lifecycle decision proves current
provider identity, applied configuration or operational health.

Existence alone, disposable alone, an appealing name, absence from a denylist,
historical approval, offline/running/healthy status, deployed code and a copied
record are each insufficient. Existing provenance can support fact review; it does
not turn old observations into fresh provider verification.

## Evidence and review model

Local repository evidence establishes the proposed package content, reviewed code
identity/pins, target provenance records and complete reviewed inventory. The
operator supplies a fresh explicit administrative assertion covering continued
allocation, reservation, no known disqualifying change and no unresolved teardown
obligation for this scope. The independent reviewer is distinct from that operator,
reviews the actual supporting records and current assertion, and checks exact
associations and exclusions. Neither a Boolean nor a hash proves review occurred.

No new provider observation is inherently required for lifecycle: the predicate is
an operator allocation decision supported by reviewed provenance, not a claim of
freshly authenticated provider existence. If provenance or current knowledge is
insufficient or contradicted, eligibility remains unresolved. Obtaining any needed
provider evidence requires separate explicit authorization; no lookup is a fallback.
The later authorized three-request flow remains the provider identity boundary.

The operator must have authority over the allocation; this is attested and reviewed,
not inferred from a repository username or service name. A reviewer must be able to
inspect the non-secret factual basis independently. Existing AT records are not
reused as approval of this policy or a new lifecycle assertion. No actual operator,
reviewer, timestamps or active facts are filled in by this design.

## Exact audit record and proposed package binding

Future implementation shall define strict schemas for a non-secret immutable
activation record and append-only per-attempt event records. The following field
set is the design contract, not a new file populated in this milestone:

| Activation-record field | Required meaning |
| --- | --- |
| version | `movement_railway_qualification_lifecycle_review_v1` (proposed). |
| policy | Path and canonical text SHA-256 of the independently approved version of this policy. |
| attemptReference | Non-secret unique operator-assigned reference for this intended attempt; not a capability. |
| subjectSha256 | Canonical digest of the complete proposed input package excluding only its top-level lifecycleReview descriptor. |
| target | Exact projectId/environmentId/serviceId/serviceName/serviceInstanceId/environmentKind; exact equality to the subject, instance explicitly null or reviewed ID. |
| operator | reference, assertedAt UTC, allocationEvidence references/digests, and explicit true acknowledgements for the operator facts in predicate item 1 and no known relevant evidence/inventory change. |
| evidence | References and canonical digests for identity/disposable provenance, inventory basis and any separately obtained supporting observations; absence of new observation stated explicitly. |
| review | Distinct reviewerReference, independentlyReviewed=true, result=NO_MISMATCH, reviewedAt UTC, evidenceReference and explicit acceptance of predicate items 1-4. |
| validity | expiresAt UTC exactly reviewedAt + 1800000 ms; operator.assertedAt <= reviewedAt; value=active; scope=one_package_one_attempt. |

All times use strict UTC timestamps with milliseconds; missing, invalid or future
activation times fail closed. Evidence references identify inspectable non-secret
records and precise scope, not credentials or fabricated observation IDs. Unknown
facts must not be represented as true. Activation records are immutable: corrections
require a new record/reference and fresh review, not overwritten history.

Proposed future input schema adds exactly one top-level descriptor `lifecycleReview`
containing `path` and `sha256`, referencing that activation record. It does not add a
targetInputSources.lifecycle tuple or duplicate executable lifecycle value. The
subject digest uses the existing canonical sorted-object JSON convention; tracked
text digests use UTF-8 with CRLF-to-LF only, preserving all other bytes/BOM/EOF.
Excluding only the descriptor avoids self-hash recursion. All other package fields,
including expectedTarget.lifecycle, review flags and evidence/code bindings, remain
covered. Runtime recomputes the subject digest; it never accepts caller substitutes.
The final manifest includes the full package digest and frozen verified activation
record digest/validity/attempt context. Those bind the descriptor as well as subject.

Each audit event contains version, attemptReference, activationRecordSha256,
subjectSha256, event type, occurredAt UTC, actorReference, reason and non-secret
evidence/result reference. Types are attempt_started, cancelled, failed, completed,
expired and revoked. Terminal history is appended, never used to mint authority.
Audit storage is an explicit operator-maintained local record, not a hidden global
runtime registry, provider mutation or a new database. Records contain no token,
credential, request authentication material, environment dump or private payload.

## Activation, duration and freshness

Activation occurs only when the distinct reviewer completes R for the finalized
proposed subject at reviewedAt. An incomplete package may be prepared with null
lifecycle; editing null to active without this record is invalid. Separate policy
approval and implementation must precede real use of this activation procedure.

Thirty minutes is a new proposed upper bound selected here, not an existing v3
guarantee or a claim about provider freshness. It permits two existing five-minute
human waits with bounded execution margin. It is an absolute ceiling for the
assertion, authorization, ticket redemption and the entire resulting attempt;
starting an attempt near expiry does not extend it. No renewal in place is allowed.

Future runtime checks UTC validity at intake, review, approval, manual authorization,
redemption and before every provider request, response acceptance and human decision.
At private admission it captures a monotonic deadline using the remaining interval;
both UTC expiry and that deadline apply. Later clock rollback cannot extend the
deadline; a detected rollback relative to prior checked UTC or invalid clock fails
closed. Forward jumps reaching expiry close the run. A private overall timer closes
context/session at expiry, even during a pending request or human wait. Response
arrival after closure cannot be accepted. Existing transport limits and five-minute
human limits are preserved; use the earlier deadline. No new timeout bypass exists.

## Revocation, terminal events and reuse

| Event | Required effect on assertion and target |
| --- | --- |
| Explicit operator/reviewer withdrawal, lost allocation authority, incompatible concurrent reservation, production/inactive/decommissioned reclassification or forbidden-inventory collision | Revoke immediately; block new admission and cancel any owned run. Target itself is not deleted by this policy. |
| Identity/name/instance-expectation, code, subject, evidence, inventory, host-attestation or branch/root-expectation drift | Invalidate the assertion/package association; stop before further execution. No hash refresh or in-place reapproval. |
| Known applied source configuration drift | Revoke for reassessment of reviewed context, even though configured/running status is not an activation prerequisite. A mere pre-existing pending configuration is not a drift event. |
| Cancellation, including before redemption | Close this assertion; no reuse of its record, ticket or permit. Target is not permanently consumed. |
| Validation/setup/transport/provider error, human rejection, timeout or crash | Close this attempt/assertion; burn existing issued authorities according to their owners. No retry or crash resume. Crash is conservatively terminal even if no request was sent. |
| Successful acquisition completion | Close this assertion after the single result; no deployment/schema/live authority is added. Target remains potentially reusable. |
| Expiry | Close at expiresAt even if unused; no admission or continuation. |
| Teardown required, teardown begun, retirement or deletion known | Revoke immediately and stop. An unresolved teardown obligation blocks activation. Lifecycle policy neither performs teardown nor excuses an existing teardown duty. |
| Service health change alone, including offline/crash/deployment failure reported outside this attempt | Does not by itself define inactive eligibility. If it reveals changed allocation, identity, source or teardown facts, revoke for that reason. An error in this acquisition is terminal under the failure rule regardless of service health. |

Revocation knowledge is not obtained by background provider polling. The responsible
operator/reviewer must notify the authority holder and cancel an owned run immediately
when a disqualifying event becomes known, append a revocation event, and withdraw the
current package/record reference so it cannot be admitted again. Future runtime
rechecks bound local input identities before each execution boundary; known withdrawal
or drift closes the run. Per-run cancellation/terminal state is owned privately by
the wrapper, not by a caller-provided status or public permit extractor. Concurrent
remote changes unknown to all participants remain an explicit epistemic limit;
expiry limits exposure but does not prove absence of remote change.

Redemption reserves the assertion to its original private run. Private ticket and
target-permit consumption remains one-use and burns before validation/context open.
A failed start closes the assertion too. The target is never permanently consumed
merely by observing identity. Reinstatement is a new operator assertion, new attempt
reference, fresh independent review, current evidence/inventory assessment, new
package binding and separate manual authorization. Any teardown obligation or other
disqualification must first be resolved under its own authority. A deleted target
cannot be revived by reusing its label; replacement IDs require new provenance.

The runtime one-shot guarantee is for the original in-process capability graph.
An attemptReference or audit JSON cannot prevent hostile cross-process replay.
No claim of global cryptographic one-shot enforcement is made. A new process must
start with fresh operator/reviewer admission and separate explicit authorization;
the operator checks prior attempt events and does not authorize the same record
again. No automatic restart/replay is allowed. Stronger cross-process enforcement
would require separately designed durable coordination, not a hidden ledger here.

## Relationships to other gates

| Concern | Policy relationship |
| --- | --- |
| Disposable kind | Necessary, independently reviewed, never sufficient alone. |
| Identity provenance | Necessary exact reviewed scope; assertions remain operator constraints, not provider proof. |
| Instance ID | Nullable expectation remains valid; null does not excuse later machine checks or unknown target allocation facts. |
| Source configuration | Applied configuration not required for read-only identity eligibility. No configuration change authorized. Known change to reviewed context invalidates the assertion. |
| Deployment | Neither prerequisite nor consequence of active; no deployment authorization. |
| Health | Neither prerequisite nor inferred by active; no status-to-lifecycle mapping. |
| Inventory | Complete independently reviewed scope inventory required and bound; changes need reassessment. |
| Host attestation | Separate mandatory execution gate, not a lifecycle fact; reviewed host changes invalidate the bound package review. |
| Provider observation | Existing reviewed provenance can support eligibility; fresh access only if independently needed and separately authorized. Active never certifies provider identity. |
| Acquisition authorization | Active is necessary eligibility only. PRELIVE_NOT_AUTHORIZED and false authority flags persist until existing separate explicit manual authorization machinery is used. |
| Completion/cancellation/failure | End the assertion, not the reusable infrastructure allocation; new attempt requires fresh review. |
| Teardown/deletion | Known obligation or event disqualifies the scope; no teardown/deletion action is granted. |
| Source/code drift | No silent evidence/pin refresh. Revoke, update factual basis under separate scope and obtain new reviews. |

## Future implementation and compatibility

Runtime changes are required for machine-enforced freshness, record/subject validation,
manifest binding, boundary rechecks, private run deadline and terminal closure. A
future separately authorized implementation should place intake/digest/time checks
in the existing authorization owner and lifetime enforcement in the wrapper, passing
only privately frozen verified context to the identity/adapter owners as needed.
Do not export a mint/getter/extractor, accept caller clocks in production, weaken
credential ordering, or add new provider requests. Inventory and host checks remain.

Use a new strict input-schema version and a new executable authorization-contract
version for these added semantics; do not silently relabel the current v2 input or
v3 executable contract as enforcing them. Proposed input name is
`movement_railway_acquisition_input_review_v3`; proposed executable name is
`movement_railway_identity_acquisition_auth_v4`. These are design identifiers only.
An implementation must update affected source pins/self hash and inert safe templates
under separately reviewed scope, retaining the twelve-pin architecture unless an
explicitly reviewed need changes it. No pin or template is changed now.

The new executable path must reject older/incomplete input versions and missing
lifecycle evidence without fallback. Historical v3 evidence remains historical;
do not rewrite it or silently manufacture a fresh review. Existing context-only 0113
and planning namespaces retain their restricted meanings and gain no continuation
authority. Future cutover must not leave an executable legacy acquisition bypass
that avoids the lifecycle checks. This is an intentional new-path compatibility
break requiring explicit implementation review, not current execution permission.

No database schema or migration is required. The model uses explicit review records
and existing per-process private capability owners. All 99 migrations remain intact.
No runtime, package, tests, fixtures, templates or historical evidence change in this
design milestone. Current lifecycle and instance expectation remain null; inventory,
host and whole-package review blockers remain unresolved.

## Future test plan

Use focused offline VM/fake-transport fixtures; no provider access is needed:

- Exact predicate field/schema validation, duplicate/extra keys, nulls, scope/name/ID
  mismatch, disposable-only rejection, forbidden inventory collision and unresolved
  teardown exclusion; evidence/operator/reviewer gaps and same-person review rejected.
- Canonical subject/record/policy binding without digest recursion; altered package,
  evidence, code, host, name, IDs and inventory rejected at every authority boundary.
- Thirty-minute equality and strict UTC parsing; future activation, exact expiry,
  forward/backward clock movement, monotonic expiry, near-expiry admission and pending
  requests/responses/human gates at expiry. Clock seams exist in tests only.
- Revoke/cancel/fail/complete/crash with zero, one, two or three requests: no reopen,
  retry/fallback/fork/resume, no result after closure, no leaked context or permit.
- Separate new review/authorization can reuse a still-eligible target; old record,
  ticket/permit, copied JSON, cross-session/owner and context-only 0113 continuation
  cannot. Do not claim cross-process replay prevention from an audit reference.
- Preserve both human gates, three-request ceiling, exact machine matching, nullable
  instance semantics, credential boundary and false global authority defaults. New
  contract rejects legacy inputs; historical conformance tests retain archived context.

No tests are run or changed now: this milestone changes only design documentation
and the readiness register. Required Git whitespace/status/HEAD checks are performed.

## Review status, unresolved questions and next milestone

No independent review of this new design is recorded. The thirty-minute bound,
operator evidence standard and explicit human cross-process admission boundary are
deliberate proposals requiring independent acceptance, not unresolved definitions
to be filled at runtime. No core policy alternatives are left for implementers to
choose silently. Exact future patch scope and safe-template regeneration must be
reviewed in an implementation plan after design review. If globally enforced replay
prevention is required beyond the existing trusted-operator model, stop for a separate
coordination design; this document does not claim it.

Next recommended milestone: independent review of this design and its checklist.
Implementation and any later target eligibility review require separate authorization.

## Explicit authority limits

This document grants no staging, commit, push, runtime implementation, package
promotion, active assertion, provider access/observation, credential access, source
configuration, deployment, restart, teardown, deletion, 0114D preparation or live
acquisition authority. No provider action or network access occurred. The protected
capsule remains unread/untouched. Current package and all authority flags remain
unchanged; production authority is never created by this policy.

## Independent review checklist

ReviewerReference: not supplied. Review result: PENDING. Each answer is YES/NO;
none is pre-filled or inferred from authorship of this design.

| # | Review question | YES/NO |
| --- | --- | --- |
| 1 | Is active meaning unambiguous? | |
| 2 | Is active distinct from provider service status? | |
| 3 | Is active never implied by disposable alone? | |
| 4 | Is exact identity binding preserved? | |
| 5 | Is the inventory relationship explicit? | |
| 6 | Is the source configuration relationship explicit? | |
| 7 | Is the deployment relationship explicit? | |
| 8 | Is the service health relationship explicit? | |
| 9 | Is the host relationship explicit? | |
| 10 | Is the provider observation relationship explicit? | |
| 11 | Is the activation event explicit? | |
| 12 | Are expiry and freshness explicit? | |
| 13 | Are revocation events explicit? | |
| 14 | Are cancellation semantics explicit? | |
| 15 | Are failure semantics explicit? | |
| 16 | Are completion semantics explicit? | |
| 17 | Are teardown/deletion semantics explicit? | |
| 18 | Are code/source drift semantics explicit? | |
| 19 | Are reinstatement rules explicit? | |
| 20 | Are consumption/reuse semantics explicit? | |
| 21 | Is hidden global mutable state unnecessary? | |
| 22 | Is the one-shot authorization architecture preserved? | |
| 23 | Is production authority excluded? | |
| 24 | Does this design task require no provider access? | |
| 25 | Is fail-closed behavior preserved? | |
