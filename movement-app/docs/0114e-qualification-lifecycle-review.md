# Qualification lifecycle evidence review

Result: PENDING. Lifecycle promotion is stopped for insufficient reviewed evidence.
Recording HEAD: d0676136b088b3ca17ad0fff8222ba6f151af7d2.
Branch: feature/0092-shared-segment-suitability.

## Contract findings

The field under review is expectedTarget.lifecycle in
[the current v2 package](0114e-current-acquisition-input-review.json).
Its contract-level meaning is an operator-asserted lifecycle eligibility constraint
on the selected qualification target as a whole. It is not a queried Railway
environment/service lifecycle, service status, deployment status, source-setting
state, environment kind or acquisition-session stage.

scripts/assessment-worker/qualification-railway-introspection-target.cjs:13-36
defines the exact target scope and requires environmentKind='disposable' AND
lifecycle='active'. The only accepted executable lifecycle value is the exact
string active. Null, missing values, case changes, whitespace variants and other
status words are rejected. The resulting binding is explicitly categorized as
operator_plan_constraints, independentlyAuthoritative=false, identity_proven=null.
It does not authenticate a provider or establish the asserted fact.

scripts/assessment-worker/qualification-railway-live-authorization.cjs includes
lifecycle in SCOPE_KEYS and requires the package's exact expectedTarget scope to
equal the original bound target. Therefore a completed v2 input package usable by
executable v3 must supply active. Null is retained in safe templates and incomplete
preparation only; it cannot satisfy the executable binding/input path.

scripts/assessment-worker/qualification-railway-target-identity.cjs compares the
private approved acquisition context against that same bound lifecycle during
session creation. Its later reviewed-target handoff preserves the active
precondition; it does not supply a new lifecycle observation.

The contract gives a precise machine acceptance rule but does not define an
operational mapping from provider observations to active. In particular, it does
not establish that an offline, created, empty, pending, healthy, crashed or
undeployed service satisfies this qualification-target constraint. Do not invent
such a mapping or confuse service-running state with qualification eligibility.

There is no lifecycle provenance tuple in targetInputSources: its exact keys are
projectId, environmentId, serviceId, serviceInstanceId and serviceName. Do not add
another key. A reviewed lifecycle basis must be retained in an explicit review
record and covered by the separate whole-package eligibility review and its
non-secret evidence reference. Runtime scope equality/manifest binding protects
the asserted value; it does not independently prove the basis. This pending record
does not supply that basis or grant authority.

## Exact target and recorded evidence

| Field | Existing recorded value |
| --- | --- |
| projectId | 0fa3268a-396f-4042-a4c0-a92c23fdf486 |
| environmentId | 9410a813-0429-4bc7-bfbb-d54b85e17c8a |
| serviceId | ef516a68-9bb7-429e-a395-48ef2676593a |
| serviceName | movement-qualification |
| environmentKind | disposable |
| expectedTarget.lifecycle | null |
| serviceInstanceId | null |

The reviewed evidence does not justify promotion:

- [Qualification evidence](0114e-qualification-target-evidence.json), eligibility,
  records independently reviewed disposable environment kind, but lifecycle=null
  and eligibilityComplete=false. That review does not establish active lifecycle.
- The same artifact's qualificationReview.confirmedFacts records serviceOffline
  and sourceSettingsPending. sourceConfigurationApplied and
  activeConfigurationVerified are false. These are separate observations with no
  reviewed mapping to the required target lifecycle.
- [The procedure](0114e-railway-acquisition-input-review.md) explicitly states that
  creation or offline service state does not establish active lifecycle under the
  existing policy; lifecycle consequently stays null.
- [The safe template](0114e-acquisition-input-review-template.json), the current
  package, and [the historical assessment](0114e-actual-acquisition-input-review.json)
  retain null lifecycle. The historical assessment explicitly reports the missing
  independently reviewed current active-lifecycle assertion.
- [Historical 0114F metadata](0114f-operator-acquired-target-metadata.json) concerns
  recorded production identities; it supplies no current qualification lifecycle.
- [The reviewed design](0114h-railway-service-name-compatibility-design.md) and
  [implementation record](0114h-railway-service-name-compatibility-implementation.md)
  preserve unresolved lifecycle. Synthetic active fixtures prove code behavior,
  not actual target eligibility.

The [completed project review](0114e-qualification-project-id-review.md) resolves
project provenance only. It supplies no lifecycle assertion and remains unchanged.

## Missing review basis and human completion fields

Needed: a current, independently reviewed qualification-target eligibility assertion
supporting the exact value active for the exact target above, with an explicit
reviewed meaning/basis for that assertion and its evidence-to-value mapping. Existing
status observations cannot substitute for this. Where the operational meaning or
mapping is not established, obtain an explicit reviewed policy/basis first rather
than asking a reviewer to infer one from a service label or status. Any additional
provider evidence/access would require separate authorization; none is performed
or authorized by this task.

- reviewerReference: null
- independentlyReviewed: false
- lifecycleValueConfirmed: null
- reviewedLifecycleMeaningReference: null
- sourceEvidenceReference: null
- reviewReference: null
- reviewedAt: null
- reviewedAtLocal: null
- result: PENDING

## Preserved state and authority limits

The current package is byte-identical. Its lifecycle and instance expectation stay
null; project provenance stays independently reviewed through its existing local
record. Inventory, host attestation and whole-package review remain incomplete.
reviewed/inputReviewComplete and all live/manual/executable/provider/identity flags
stay false. 0114D readiness and deployment remain unauthorized; source settings
remain unapplied. No historical or qualification evidence is rewritten.

This record grants no staging, commit, push, provider access, new provider
observation, Railway configuration change, deployment, restart or live acquisition.
No runtime, template, fixture or migration changes are made. No network, credential,
secret, token-store, private-key, history or protected-capsule access occurred.
