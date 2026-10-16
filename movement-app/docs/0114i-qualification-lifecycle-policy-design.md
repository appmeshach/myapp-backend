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

Draft admission claims the assertion for its original private authority graph as
defined below; redemption continues that same claim into its original run. Private
ticket and target-permit consumption remains one-use and burns before validation/context open.
A failed start closes the assertion too. The target is never permanently consumed
merely by observing identity. Reinstatement is a new operator assertion, new attempt
reference, fresh independent review, current evidence/inventory assessment, new
package binding and separate manual authorization. Any teardown obligation or other
disqualification must first be resolved under its own authority. A deleted target
cannot be revived by reusing its label; replacement IDs require new provenance.

The runtime one-shot guarantee includes assertion-level admission within the one
trusted process, in addition to the original in-process capability graph.
An attemptReference or audit JSON cannot prevent hostile cross-process replay.
No claim of global cryptographic one-shot enforcement is made. A new process must
start with fresh operator/reviewer admission and separate explicit authorization;
the operator checks prior attempt events and does not authorize the same record
again. No automatic restart/replay is allowed. Stronger cross-process enforcement
would require separately designed durable coordination, not a hidden ledger here.

## B1 correction: private assertion admission and closure

Correction starting HEAD: `42a12b2c46008b310f0035be39a84766fb088443`.
This section addresses B1 by design only. The
[prior review](0114i-qualification-lifecycle-policy-independent-review.md) remains
unchanged historical evidence about the earlier design. Renewed independent review
is required; implementation planning remains unauthorized until that review passes.

**Invariant:** Within one trusted process, one canonical activation record may be
admitted into at most one acquisition authority graph.

### Sole owner and canonical identity

The existing private owner in
`scripts/assessment-worker/qualification-railway-live-authorization.cjs` is the sole
admission owner. All executable draft/admission routes in this process must use
that same trusted owner instance. Reloading/replacing an owner or wrapper cannot
instantiate a second admission domain in the trusted process; fail closed under
the existing module-integrity boundary. No public registry, reset, admission getter
or authority extractor is introduced. The wrapper owns execution cleanup but cannot
mint, release or reassign an assertion claim.

Define C(R) as the UTF-8 canonical sorted-object JSON serialization of the entire
strictly parsed, validated activation record R, including its subjectSha256,
attemptReference, target, review and validity. Preserve exact values; reject duplicate
keys and malformed/extra fields before canonicalization. Define assertionKey as
SHA-256(C(R)), recomputed by the owner, never accepted from a caller. This semantic
admission key is separate from the existing CRLF-normalized tracked-text digest
which binds the record file to the package descriptor. Neither text hashing nor
package hashing changes. Whitespace/key-order reserialization of the same record
cannot evade the admission key.

The owner retains C(R) and the exact subjectSha256/attemptReference with the key.
On a key match it compares canonical bytes and bindings, not the digest alone.
Equal key but unequal bytes or bindings is a collision/consistency error: reject,
never create an alternate entry or treat it as fresh. The existing claim is never
released by an incoming mismatch. A private reverse index of attemptReference to
assertionKey rejects conflicting records/subjects using the same reference while
that marker is retained. The reference is an audit consistency check, not authority.

A path, draft object, package wrapper or caller handle is not an assertion identity.
An attemptReference supplied outside R must exactly match R or fail. Changing the
reference inside R changes reviewed content: it is invalid without a new complete
independent record review and package binding. Relabeling or recomputing a hash does
not constitute that review. A fresh attempt requires a genuinely new activation
record, new attemptReference and fresh operator/independent review as already
required; copying the old review is insufficient. Hashes do not prove human review.

### Minimal private state and atomic claim

The owner maintains one explicit private per-process admission table and its
reference index. States are unseen (no entry), claimed, and closed. Entries and
indexes are implementation bookkeeping, never executable capabilities. Only
original private draft/ticket/permit/session ownership plus all existing review and
authorization gates can authorize execution.

Choose validated draft admission as the claim point. After passive schema,
record/package/evidence/code/inventory/validity checks succeed, but before creating
any context-review capability, publishing the draft or issuing any review/ticket,
the owner synchronously checks both indexes and changes unseen to claimed. The
check/insert is one non-reentrant operation: no await, callback, user getter or
caller hook may intervene. If either index conflicts, creation fails closed. This
early point also precedes the context handoff created by later package approval;
waiting until ticket issuance would leave earlier authority ownership ambiguous.

The claim is bound to the original private draft entry, exact canonical record,
subject and reviewed package snapshot. It remains the same claim through review,
manual authorization, original ticket redemption, private target permit and original
run. A second draft cannot attach to it even with identical valid bytes/approvals.
Thus two draft-creation calls before the first ticket yield at most one admitted
draft. Draft admission still grants no execution or provider-access authority.

After claim, every operation on a located original graph must verify claimed state
and original ownership. Closed entries cannot issue or redeem any authority. A
post-claim exception, including one before draft publication, must close the entry.
An invalid input rejected before claim creates no authority; it must not cancel a
different graph merely by naming its digest. Duplicate-creation rejection likewise
does not terminate the genuine first graph. An explicit cancellation/revocation of
that graph follows the authenticated local ownership path described next.

### Non-rearmable terminals before and after redemption

The authorization owner has one idempotent private closure operation for the located
original claim. It marks closed before cleanup can throw and invalidates all future
issuance/redemption for that graph. Original ticket/permit consumers still burn
before validation, including when a subsequent closed-state check rejects them.

Before redemption, cancellation uses the original opaque draft (including before
ticket issuance) through a cancellation-only owner operation, not a digest/path or
caller-provided registry entry. This may only reduce authority; copies cannot cancel
the original. It closes any issued ticket as well. Explicit local revocation or
withdrawal must invoke that owner closure in addition to recording the event and
withdrawing the package reference; editing/restoring files alone cannot clear state.
Manual authorization rejection, invalid acknowledgement or validation failure on a
located original graph is terminal, not an opportunity to fix and resubmit that graph.

The owner privately connects closure to the pinned wrapper through the established
initialization-only linkage pattern. No public closure getter/installer or arbitrary
callback registration survives initialization. Redemption/setup must retain a
private cleanup obligation before anything can throw, including before a run handle
exists or a credential-bearing context opens. The wrapper reports every terminal
exit to that same claim owner and performs its existing context/session cleanup;
the owner never creates another graph to handle an error.

All of the following change claimed to closed: draft cancellation before ticket
issuance, cancellation after claim but before redemption, post-claim validation or
setup failure, manual authorization rejection, provider/transport error, human
rejection at either gate, timeout, owner-handled crash/exception, successful
completion, explicit revocation and expiry. The previously proposed overall expiry timer must
also close abandoned pre-ticket drafts and unredeemed tickets. A terminal signal
repeated on an already closed entry cannot rearm it. Unknown or invalid ownership
cannot mint a closure capability or execution authority.

A hard process death cannot execute cleanup: volatile state disappears and no resume
is allowed. This is the unchanged cross-process trust boundary, not a claim that
an uncatchable crash writes a durable closed marker.

### Retention, cleanup and duplicate behavior

Closed markers retain the assertion key, canonical record/bindings, attempt-reference
index and expiry; drop draft/run/session/context and other authority references after
cleanup. Claimed entries have the existing absolute expiry obligation even if no
caller returns. Markers and reference-index entries remain non-rearmable at least
through expiresAt. No cancellation, success, file restoration, wrapper replacement
or garbage collection of the original draft may remove them early.

After expiry, close any still-claimed graph before removing its compact marker and
reference-index entry. Removal is cleanup, not closed-to-unseen eligibility: every
admission first rechecks strict expiry. The previously specified prior-UTC check must
survive per-entry cleanup as a process-local clock high-water value; clock rollback
fails admission before lookup. Together with monotonic deadlines this prevents a
cleaned expired record becoming admissible again after a wall-clock rollback.
Cleanup runs at expiry and on later owner entry if a timer was delayed. A finite
reviewed capacity bound must fail closed on additional admissions rather than evict
unexpired markers; its concrete resource limit belongs in the implementation plan.
There is no permanent unbounded per-record retention or durable state.

Same canonical record at another path, a second package wrapper, or restored old
bytes encounters the same claimed/closed key. If another package changes subject
fields, R.subjectSha256 no longer matches and validation rejects it. A new path or
attemptReference cannot renew the old assertion. Only a new independently reviewed
record for a fresh attempt can be considered, subject to all unchanged eligibility
and authorization gates. Identity acquisition does not permanently consume the target.

This table is explicitly private, process-local admission bookkeeping. It does not
provide global cross-process replay prevention, a database or durable coordination.
A new process still requires fresh operator/reviewer admission and separate manual
authorization under the existing trusted-operator workflow.

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
manifest binding, assertion admission/closure ownership, boundary rechecks, private
run deadline and terminal closure. A
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
- B1: two draft creations before first ticket issuance admit only the first; attempts
  after first claim also fail. Verify no context-review capability or second ticket
  is issued by rejected creation, and the genuine first graph remains unaffected.
- B1: the same activation record at different paths, with reordered keys/whitespace,
  restored bytes, or different package wrapper objects retains one admission key.
  A conflicting subject/package or external attemptReference is rejected. Editing
  R.attemptReference without new independent review is not a fresh assertion; reuse
  of a retained reference with another record fails consistency checks.
- B1: cancellation before ticket issuance and before redemption, manual rejection,
  failed setup before a run handle, and validation failure after claim all close
  the assertion. Repeat after provider/transport error, both human rejections,
  timeout and owner-handled crash. Existing burns/cleanup remain intact.
- B1: completion then restored package bytes and revocation then recreated draft
  cannot rearm the assertion. A genuinely fresh independently reviewed activation
  record/new reference may admit a still-eligible target after prior closure.
- B1: expiry closes an abandoned draft/ticket/run; delayed cleanup releases marker
  memory only after expiry. Replaying the expired record after cleanup, including
  with UTC rollback, fails. Capacity exhaustion never evicts an unexpired marker.
- B1: equal digest with unequal canonical record bytes or subject/attempt binding
  fails closed (collision simulation confined to tests). Duplicate/reentrant claim
  attempts and alternate owner/wrapper loading cannot create a second admission.

No tests are run or changed now: this milestone changes only design documentation
and the readiness register. Required Git whitespace/status/HEAD checks are performed.

## Review status, unresolved questions and next milestone

The prior critical review recorded CHANGES_REQUIRED_BEFORE_IMPLEMENTATION_PLANNING
for the earlier design and remains unchanged historical evidence. B1 has been
addressed by design in the private admission/closure section above; renewed
independent review is still required. Implementation planning remains unauthorized
until renewed review passes. The thirty-minute bound,
operator evidence standard and explicit human cross-process admission boundary are
deliberate proposals requiring independent acceptance, not unresolved definitions
to be filled at runtime. No core policy alternatives are left for implementers to
choose silently. Exact future patch scope and safe-template regeneration must be
reviewed in an implementation plan after design review. If globally enforced replay
prevention is required beyond the existing trusted-operator model, stop for a separate
coordination design; this document does not claim it.

Next recommended milestone: renewed independent review of the corrected design,
specifically the B1 invariant, ownership, terminal coverage and cleanup rules.
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
