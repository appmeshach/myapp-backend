# 0114E qualification lifecycle policy-basis analysis

STATUS: POLICY_DEFINITION_INCOMPLETE

Analysis starting HEAD: `5fecd25210a9276b020108e329e36345b5568494`
Branch: `feature/0092-shared-segment-suitability`

This offline analysis records existing constraints and missing policy decisions. It
does not define a new lifecycle policy or approve an active assertion. The current
package remains unchanged with `expectedTarget.lifecycle=null`.

## 1. Origin of the active requirement

The Railway target binder introduced the exact `disposable`/`active` requirement in
0107, commit `2c3b590b81bd72449556c5078ca27acfe6c66267`
(`feat(matching): add railway readonly inspection preflight`). File history and
blame identify that commit as the origin of the unchanged binder's scope check.
See [the target binder](../scripts/assessment-worker/qualification-railway-introspection-target.cjs)
and [0107 target constraints and denylist](0107-railway-readonly-live-preflight.md#target-constraints-and-denylist).
Later authorization and acquisition layers preserve and bind that constraint;
they do not supply its missing factual definition.

## 2. Definition found and authority of sources

No sufficiently precise existing definition of legitimate active eligibility was
found. There is a precise accepted label and a partial policy: only disposable,
active scopes are accepted; production and inactive/decommissioned targets are
excluded; explicit approved identities must match; forbidden inventory must be
reviewed. Those are necessary restrictions, not a sufficient positive predicate
for determining when a real target is active.

The executable binder labels its result `operator_plan_constraints`,
`independentlyAuthoritative:false`, and `identity_proven:null`. Its source comment
explicitly says binding does not authenticate a provider or runtime. The 0107
documentation says the truth of operator assertions requires independent review.
Neither statement defines the facts a reviewer must establish for active eligibility.

The following later materials were checked for an additional definition:

- [0114E lifecycle review](0114e-qualification-lifecycle-review.md),
  [input-review procedure](0114e-railway-acquisition-input-review.md),
  [safe template](0114e-acquisition-input-review-template.json),
  [current package](0114e-current-acquisition-input-review.json),
  [historical actual assessment](0114e-actual-acquisition-input-review.json), and
  [qualification evidence](0114e-qualification-target-evidence.json).
- [0114D wrapper description](0114d-railway-acquisition-wrapper.md),
  [reviewed 0114H design](0114h-railway-service-name-compatibility-design.md),
  [implementation record](0114h-railway-service-name-compatibility-implementation.md),
  and [readiness register](MOVEMENT_LAUNCH_READINESS_REGISTER.md).
- [Live authorization](../scripts/assessment-worker/qualification-railway-live-authorization.cjs),
  [target identity](../scripts/assessment-worker/qualification-railway-target-identity.cjs),
  [acquisition wrapper](../scripts/assessment-worker/qualification-railway-acquisition-wrapper.cjs),
  and relevant 0110-0114 tests and fixtures. Synthetic active values prove accepted
  contract inputs, not the eligibility of a real target.

Repository-wide lifecycle searches and the 0101/0102 system-spec checkpoints add
no Railway active predicate. The
[0102 workflow](0102-disposable-remote-staging-worker-qualification.md) discusses
consumed synthetic fixtures and separate teardown obligations. Its Supabase scope,
fixture consumption, worker execution lifecycle and teardown obligations cannot be
silently imported as a Railway target-state definition. Movement/job lifecycle
rules in the system specification likewise concern different entities.

## 3. Candidate meanings

The repository does not establish that active means merely existing, usable,
unconsumed/unretired, approved for qualification, deployed/running, source-configured,
healthy, or within an authorization window. Operator approval is required for scope
acceptance, but approval alone is not a documented sufficient factual definition.
No one candidate, or combination of candidates, can be selected from the evidence.
In particular, created/offline/pending source settings do not establish active.

## 4. Existing conditions and their limits

Before executable acceptance, the target must carry exact disposable/active labels,
explicit syntactically valid project/environment/service IDs, a nullable instance
expectation, exact expected/selected equality, and no collision with a reviewed
forbidden inventory. Later reviewed inputs bind the same target context, approved
service name and ID, code identity, inventory, host attestation and independent
human review. Human approval cannot override machine mismatch.

These are existing acceptance conditions and review obligations. They do not
constitute a complete list of factual conditions sufficient to assert active. A
reviewed predicate and its evidence standard are still missing; no reviewer should
simply attest active while that policy gap remains.

## 5. Dependencies

| Item | Existing requirement versus undefined lifecycle meaning |
| --- | --- |
| environmentKind | Exact disposable is a co-required label; disposable does not imply active. |
| Target identity | Exact reviewed project/environment/service context and later service-name binding are mandatory. Binding asserts scope; it does not prove eligibility or provider identity. |
| serviceInstanceId | Null is allowed by the target binder/current preparation. No non-null instance prerequisite for active is defined. Later exact instance checks do not define lifecycle. |
| Source configuration | No applied-settings predicate for active is defined or checked by the binder. Pending/applied settings cannot independently resolve lifecycle. |
| Deployment | No deployed/running/healthy predicate for active is defined. Deployment authority is separate. |
| Host attestation | A separate reviewed acquisition/package gate; no rule makes it a sufficient or causal definition of target lifecycle. |
| Forbidden inventory | Reviewed production/inactive/decommissioned inventory and exact scope exclusion are required. Absence from the inventory alone does not prove active. |
| Provider observation | No observation is performed by binding. Operator assertions are not provider facts; a required observation method for proving active is undefined. Later identity observation is separately gated. |
| Human/operator decision | Approved operator scope and independent review are required. A reviewer still lacks a complete factual predicate to apply. |
| Expiry/consumption | No target-state duration, freshness limit, consumption rule, expiry event or reinstatement rule is defined. Session timeout/permit burning is separate. |

## 6. Nature of the assertion

Active is carried as a reviewed operator eligibility assertion in local policy
constraints, not derived automatically from a provider status. This identifies the
trust boundary, not the missing policy content. Independent human review does not
make an undefined predicate evaluable, nor does a digest authenticate its truth.

## 7. Transition away from active

No authoritative target-state transition mapping was found for qualification
completion, target consumption, retirement, teardown, provider deletion, source
drift, deployment failure or cancellation. The policy excludes inactive and
decommissioned targets, but does not specify which event establishes those states,
when an earlier active assertion becomes invalid, or who records that change.

The wrapper terminates acquisition sessions on timeout, cancellation, failure or
completion. Its private permit is consumed before validation. Those mechanisms
limit execution authority; they do not mutate or define the target's lifecycle.
An active-to-inactive transition cannot be inferred from them.

## 8. Current target decision

The current qualification target cannot legitimately be marked active from the
existing local facts and policy. Its evidence retains lifecycle null and incomplete
eligibility, with the service offline, source settings pending/unapplied, and active
configuration unverified. Those facts neither establish active nor define a
general rule that offline means inactive. The completed project-ID provenance
review resolves only project provenance.

## 9. Existing basis and evidence needed if eligible

There is no sufficient existing policy basis to give a reviewer an exact affirmative
active checklist. Therefore no target-specific evidence bundle is claimed sufficient
in this analysis. Identity provenance and disposable evidence remain useful inputs;
they cannot substitute for the missing lifecycle definition.

## 10. Separate blockers and exact next action

**POLICY GAP:** The positive eligibility predicate is incomplete. A separate explicit
policy decision and review must settle what facts make the exact target eligible,
what evidence establishes those facts, who can assert/review them, the identity and
temporal scope of the assertion, its freshness/duration, and the events that revoke,
consume, retire or permit reinstatement of that eligibility. These are unresolved
decisions, not rules introduced or preferred by this analysis. The relationship to
configuration, deployment, observation and teardown must be decided if relevant;
no dependency is invented here.

**TARGET EVIDENCE GAP:** There is no independently reviewed current active assertion
or supporting lifecycle basis for this exact qualification target. In addition,
whether available facts satisfy the ultimate predicate cannot yet be evaluated
against a complete policy. This is not the narrower situation of having a complete
reviewed definition and merely missing proof. Current lifecycle stays null; existing
identity/disposable provenance does not close either gap.

The next action is a separately authorized, explicit lifecycle-policy definition and
independent review, using these unresolved decisions. Only after that policy is
established can target-specific evidence be assessed under it. This task stops at
the policy-definition gap and does not redesign or implement lifecycle.

## Validation

The existing 0107 target-preflight and 0114E input-review suites passed together:
566 tests, zero failures, cancellations or skips. They verify existing contract
constraints and incomplete-package rejection; they do not validate a real target
or supply missing lifecycle policy. No tests were changed. Whitespace checks pass
for both documents. All 152 protected tracked source/evidence/template/design files,
including all 99 migrations, match their starting byte hashes. HEAD and the index
are unchanged.

## Authority limits and preservation

This analysis grants no provider access, observation, deployment, restart,
source-configuration application, current-package completion, 0114D preparation,
live acquisition, staging, commit or push authority. All existing authorization
flags remain false. No runtime, test, fixture, template, reviewed design, current
package, historical evidence, qualification evidence or migration is changed. The
protected capsule remains unread and untouched. No credentials, token stores,
private keys, shell history or provider/network services were accessed.
