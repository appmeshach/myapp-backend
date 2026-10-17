# 0092 — Shared-corridor suitability contract design

Status: design contract only; no admission behavior changed in this document.
Base of truth: verified repo migration chain through 0091 and the current advisory route-geometry implementation in the TypeScript modules.
Scope: define a versioned shared-corridor suitability contract without inventing a new approval policy, without introducing a universal detour cap, and without requiring a single exact pickup point before a candidate can be presented for coordination.

## 1. Confirmed audit evidence and boundaries

The effective backend already preserves a strict separation between:

- objective route evidence
- route-aware discovery filtering
- exact binding validation
- availability/capacity lock validation
- human acceptance and activation

Relevant verified production definitions and their latest effective provenance:

- `private.assert_requester_interest_support` — [supabase/migrations/0047_requester_movement_interest_foundation.sql](../supabase/migrations/0047_requester_movement_interest_foundation.sql)
- `private.assert_movement_offer_route_match_binding` — [supabase/migrations/0042_trusted_movement_offer_authorization.sql](../supabase/migrations/0042_trusted_movement_offer_authorization.sql)
- `private.assert_movement_offer_availability_binding` — [supabase/migrations/0045_movement_offer_availability_capacity.sql](../supabase/migrations/0045_movement_offer_availability_capacity.sql)
- `private.create_movement_offer_internal` — effective constructor body in [supabase/migrations/0045_movement_offer_availability_capacity.sql](../supabase/migrations/0045_movement_offer_availability_capacity.sql); public wrapper in [supabase/migrations/0049_interest_authorized_offer_continuation.sql](../supabase/migrations/0049_interest_authorized_offer_continuation.sql)
- `public.accept_movement_offer` — current public wrapper in [supabase/migrations/0076_financial_proposal_offerer_consent.sql](../supabase/migrations/0076_financial_proposal_offerer_consent.sql); underlying logic remains the 0045 acceptance path
- `public.list_requester_movement_interests_for_offerer` — current effective version in [supabase/migrations/0089_trusted_movement_priority_engine_foundation.sql](../supabase/migrations/0089_trusted_movement_priority_engine_foundation.sql)
- `public.get_requester_availability_matching_context_for_server` — [supabase/migrations/0046_requester_availability_matching_context.sql](../supabase/migrations/0046_requester_availability_matching_context.sql)
- `public.discover_offering_movement_availability` — [supabase/migrations/0044_offering_movement_availability_foundation.sql](../supabase/migrations/0044_offering_movement_availability_foundation.sql)
- `public.discover_masked_movement_needs` — [supabase/migrations/0041_trusted_masked_movement_discovery.sql](../supabase/migrations/0041_trusted_masked_movement_discovery.sql)
- `private.trusted_route_match_evidence` — [supabase/migrations/0037_trusted_route_match_evidence_foundation.sql](../supabase/migrations/0037_trusted_route_match_evidence_foundation.sql)

The currently verified contract is deliberately conservative:

1. The geometry module is an objective measurement layer, not a final suitability verdict.
2. Discovery functions expose only trusted, masked or public-safe context; they do not prove a legal or agreed pickup arrangement.
3. Exact route evidence, availability identity, need identity and intent identity are all checked together before creation or acceptance.
4. Human agreement is required; a one-sided selection is not mutual acceptance.
5. A supported corridor does not imply lawful accessibility, exact meeting point, reservation, alignment, payment or activation.
6. No universal maximum detour is encoded in the current route-evidence contract.
7. Priority and seat policies remain separate from route suitability validation and must not be mixed into a new suitability gate.

## 2. Independent state dimensions and current architecture

The shared-segment concept spans multiple independent dimensions. These must be represented separately in any future contract, and no single flat status model may conflate them.

### 2.1 Evidence integrity dimension

This dimension answers: "Is the currently trusted evidence exact, current, and bound to the correct need, intent, availability and route version?"

Required evidence integrity includes:

- exact member identity for the requester and offerer
- exact movement need identity
- exact offering intent identity
- exact route-evidence row identity and version
- exact availability identity and state
- current freshness and non-expiry checks
- provenance checks for route evidence and availability context
- absence of stale, mismatched or superseded records

This is a strict backend validity question. It does not itself prove a usable road corridor.

### 2.2 Geographic suitability dimension

This dimension answers: "Is there independently sufficient evidence of a contiguous, directionally compatible, traversable shared road portion?"

The contract must explicitly distinguish this from evidence integrity. A request may satisfy evidence integrity and still be geographically unsupported or not provably traversable.

Geographic suitability requires more than nearest-point geometry or a positive `route_order = 'forward'` value. Those are useful objective signals, but they are not enough to establish a proven shared corridor by themselves.

If the current provider or route-evidence layer does not establish road connectivity, traversability, or a contiguous usable shared segment, the correct result is a provisional or coordination classification, not a supported-corridor claim. The contract must document the missing evidence rather than invent a road-connectivity capability.

### 2.3 Shared-corridor assessment dimension

This dimension is a proposed design layer only. It is not an implemented database enum and not a new production approval policy.

A future proposed assessment dimension may use labels such as:

- `provisional_candidate`
- `needs_coordination`
- `provisionally_compatible`
- `supported_shared_corridor`
- `unsupported_shared_corridor`

These names are proposed identifiers only. They are not the existing database status names and must not be treated as implemented migration state.

The critical rule is simple:

- evidence integrity is required for any authoritative claim
- geographic suitability is also required for a supported-corridor claim
- neither can be inferred from a nearest-point projection alone

### 2.4 Human joining-point agreement dimension

This dimension answers: "Has a practical pickup/dropoff or meeting arrangement been agreed between the parties or is the arrangement still open to coordination?"

This is separate from route evidence and separate from the database eligibility checks.

The current product semantics remain:

- one-sided invitation is not mutual consent
- exclusivity begins after mutual choice under the future reservation design
- the maximum mutual reservation is ten minutes
- either member may cancel immediately
- current 0045 and 0076 acceptance semantics must not be silently reinterpreted as the complete future reservation design

The precise mandatory coordination checkpoint remains a product-policy question. The document must not state that every joining point must be formally agreed before the current movement-offer acceptance operation.

### 2.5 Movement lifecycle dimension

This dimension uses the existing lifecycle status names and semantics already in the authoritative database contract.

It covers:

- creation state
- active or pending state
- accepted state
- completed or canceled state
- roster and capacity constraints
- availability lock and need/offer lifecycle

This dimension must remain separate from geometry evidence, corridor assessment and human joining-point agreement.

## 3. Required conceptual distinctions

### 3.1 Objective route evidence

This is the minimum independently trusted, computed geometry fact:

- `private.trusted_route_match_evidence` stores objective evidence of the relationship between a requester’s trusted origin/destination and an offerer’s trusted route.
- It includes route distances, projected position along route, closest route coordinates, and `route_order` in `('forward', 'same_position', 'reverse')`.
- This evidence answers: "Where does the requester project relative to the route?"
- It does not answer: "Is the road segment geographically suitable, legally accessible, or practically joinable?"
- It does not answer: "Did both humans agree to the pickup or handoff point?"

### 3.2 Ambiguous projection

A projection is ambiguous when:

- the route contains self-intersections or repeated traversals
- the nearest point may occur on multiple plausible path traversals
- the route loops or doubles back in a way that creates multiple near-equal projections
- the evidence is stale or mismatched
- the currently trusted route evidence no longer matches the current offer intent or availability

Ambiguity does not mean the route is invalid. It means the current evidence is not enough to justify a unique supported-corridor claim.

### 3.3 Potentially compatible corridor

A corridor is potentially compatible when the objective evidence indicates a plausible forward-order projection or interior overlap without contradicting the authoritative binding and current state rules.

This is a provisional state only. It means: "The route geometry is consistent with a possible shared road segment in the intended direction." It does not mean:

- the road segment is geographically proven to be traversable as a shared corridor
- the practical stop is legally accessible
- the trip is mutually accepted
- all group and capacity constraints are resolved

### 3.4 Supported shared corridor

A supported shared corridor is only safe to claim when both of the following are true:

A. Evidence integrity is satisfied: exact member, need, intent, route version, availability, provenance and freshness all remain valid.
B. Geographic suitability is satisfied: the route evidence independently supports a contiguous, directionally compatible and traversable shared road portion.

If either condition is not satisfied, the appropriate result is a provisional or coordination classification, not a supported shared-corridor claim.

This is still not the same as human agreement or a legal stopping point.

### 3.5 Human-agreed joining arrangement

This is the product-level arrangement for how the shared corridor will be used in practice: pickup/dropoff arrangement, timing, waiting, public transport handoff, walking before/after the shared segment, or any other agreed connection method.

This must remain distinct from the route-evidence layer and from the backend eligibility layer.

A shared corridor can exist without a fixed pickup point being negotiated yet. Conversely, a negotiated pickup point does not by itself prove the underlying road corridor is objectively supported.

## 4. Minimum trusted evidence required for an authoritative supported-corridor claim

A supported-corridor claim must not be based on a proximity heuristic alone. It must be based on the following exact evidence chain:

1. The offerer has an independently intended route and a current trusted route-evidence record.
2. The requester has a movement need and trusted origin/destination references.
3. The exact `private.trusted_route_match_evidence` row exists for that requester + movement need + offerer intent + route evidence identity.
4. The evidence row is current, unexpired, and its `version` matches the bound route-match evidence version on the offer or interest.
5. The offerer intent and offering availability remain the same current binding target.
6. The route order and projected positions are directionally consistent with the intended sharing direction.
7. The requester's route and the offerer's route have a contiguous, directionally compatible shared portion that the current evidence can credibly support as traversable.
8. No authoritative state rule has failed: availability, capacity, need lifecycle, identity, freshness, lock order, or exact binding mismatch.

This does not require a precise pickup/dropoff arrangement to exist. It does require evidence integrity and geographic suitability to be separately satisfied.

If the provider evidence cannot support item 7, the correct classification is provisional, coordination required, or unsupported, not `supported_shared_corridor`.

## 5. Required binding semantics

The current backend already enforces a binding chain that must stay central for any future suitability layer.

### Required exact identity linkage

At minimum, the following identities must match exactly:

- movement need id
- requesting member id
- offering member id
- offering movement intent id
- route evidence id
- route evidence version
- current trusted route match evidence row id and version
- current availability id, offering member, offering intent, route evidence and vehicle access context

This exact chain is already enforced in:

- `private.assert_requester_interest_support`
- `private.assert_movement_offer_route_match_binding`
- `private.assert_movement_offer_availability_binding`
- the corresponding create/accept flows

Any future suitability assertion must use the same identity chain and not invent a looser or implicit match rule.

## 6. Routing edge cases and ambiguity handling

### 6.1 Reverse direction

A reverse-direction projection is not a supported forward shared corridor. It may still be a candidate for coordination under a separate negotiated arrangement, but it is not a confirmed shared road segment for the intended direction.

### 6.2 Same-position or zero-length overlap

A same-position projection means the requester and offerer are effectively aligned at one location on the route, but this alone does not prove a useful directional share, a legally accessible stop, or a practical boarding location. It remains a coordination or unconfirmed case until a human arrangement is made.

### 6.3 Self-intersections and loops

When a route loops, doubles back, or intersects itself, the geometry may produce multiple possible nearest points or repeated traversals of the same road. In those cases, the outcome must be conservative:

- no silent confirmation
- no unique route-segment claim without a more exact, current evidence record
- allow human coordination to evaluate whether the practical path is still usable

### 6.4 Parallel roads and divided carriageways

A nearby parallel route or divided roadway may be numerically close but not legally or practically connected. A route geometry projection cannot by itself establish a useful connection or accessibility. The future suitability contract must keep these cases in either:

- ambiguous projection
- coordination required
- unsupported shared corridor

### 6.5 Partial share and ordinary transport

Partial route sharing is allowed. A requester does not have to match the offerer’s exact endpoint. The practical connection can include walking or ordinary transport before and after the shared corridor.

This is consistent with the product requirements and must remain a route-evidence concept, not a universal detour rule.

### 6.6 Insufficient or stale evidence

When the route evidence is stale, mismatched, expired, or no longer bound to the current availability or intent, the safe result is:

- reject or suppress the candidate from further binding operations
- do not convert it into an accepted shared corridor
- require fresh evidence before re-presentation

## 7. Why nearest-point projection is not sufficient proof

The relevant geometry and evidence logic measures distance to the route and the position along the route. These are not maximum acceptable detour thresholds and they are not proof of geographically suitable shared road continuity.

A numerical tolerance around a projected point is a precision control for comparing positions or path estimates; it is not a product rule such as:

- “any detour greater than 500 meters is ineligible”
- “only exact route overlap is acceptable”
- “all corridor candidates must be within X meters of the route start or end”

This is crucial: route evidence defines objective proximity and route order, not universal travel-acceptability. Travel practicality, walking access, legality, and human agreement are separate concerns.

The current nearest-point projections and `route_order = 'forward'` are useful objective measurements, but they do not establish the missing geographic-suitability proof when a provider road network cannot prove traversability or contiguous shared connectivity.

## 8. Human choice and current acceptance semantics

The contract must preserve established human choice and lifecycle semantics.

- a one-sided invitation is not mutual consent
- exclusivity begins after mutual choice under the future reservation design
- the maximum mutual reservation is ten minutes
- either member may cancel immediately
- the existing 0045 and 0076 acceptance semantics remain authoritative and must not be silently reinterpreted as the complete future reservation design

The current acceptance operation does not require every joining point to be formally agreed in advance. Movement supports discovering and selecting potential shared journeys before the exact pickup/dropoff arrangement has been finalized. The precise mandatory coordination checkpoint remains a product-policy question.

This matters because the existing operation is not equivalent to the future reservation design. The contract must keep the current operational lifecycle intact and not overstate what the existing database flow guarantees.

## 9. Proposed contract identifiers for future use only

The following statuses are proposed design identifiers only and are not implemented database status names:

- `objective_route_projection`
- `ambiguous_projection`
- `provisional_candidate`
- `needs_coordination`
- `provisionally_compatible`
- `supported_shared_corridor`
- `unsupported_shared_corridor`
- `human_agreed_joining_arrangement`
- `ineligible`

These are descriptive operational labels for future design discussion only. They must not be treated as implemented SQL enums, migration states or lifecycle states.

`ineligible` is an authoritative eligibility disposition, not a geographic corridor-assessment status. It signifies that the request fails a current backend eligibility rule; it does not represent a shared-road assessment outcome.

## 10. Proposed future private suitability decision record or assertion

A future versioned private suitability decision should not be a public discovery status. Instead, it should be a private authoritative assertion used only in binding, eligibility and acceptance validation.

### Proposed design

A private function, for example:

- `private.assert_shared_segment_suitability_v1(p_movement_need_id uuid, p_offering_movement_intent_id uuid, p_route_match_evidence_id uuid, p_availability_id uuid)`

This function should perform only the following checks:

- exact evidence binding
- current route-evidence validity and expiration
- current availability identity and state
- intended direction consistency
- ambiguous or insufficient evidence handling
- geographic-suitability evidence sufficiency check
- no unauthorized or stale state
- no admission claim without a separate human coordination or acceptance step

### Decision record shape

The future record may be a lightweight private table or an assertion-only pattern, for example:

- `decision_version` (for example `shared_segment_suitability_v1`)
- `movement_need_id`
- `offering_member_id`
- `offering_movement_intent_id`
- `route_match_evidence_id`
- `route_match_evidence_version`
- `status` in a safe restricted set such as `provisional_candidate`, `needs_coordination`, `provisionally_compatible`, `supported_shared_corridor`, `unsupported_shared_corridor`, `ineligible`
- `created_at`
- `expires_at`
- `evidence_hash` or equivalent immutable row fingerprint

This should not expose a final accepted trip or seat reservation. It should remain private and policy-neutral until actual product approval is defined.

## 11. Distinguishing candidate visibility from authoritative support

### Candidate that may be shown for coordination

A candidate may be shown if:

- the evidence is current and exact
- the route order is supportive or neutral enough for human review
- the need and availability remain valid
- no authoritative state or binding rule has failed
- the evidence is not stale or mismatched
- the geographic-suitability proof remains incomplete or provisional, and is therefore presented as coordination-only

This is a coordination candidate, not a final suitability approval.

### Candidate whose shared corridor has been authoritatively established

This is a more demanding state that can only be reached if:

- the same exact trusted evidence chain remains valid at decision time
- evidence integrity remains satisfied
- geographic suitability is independently established
- the route is not self-overlapping or looped in a way that invalidates the support claim
- all other binding and lifecycle checks are satisfied

This state still does not imply a legal stop, exact pickup point, payment or activation. It only means the backend has a reliable, authoritatively bound shared-corridor fact.

## 12. What current trusted evidence cannot safely establish

The current evidence stream cannot safely establish all of the following without additional product policy:

- whether a specific pickup point is legally accessible
- whether an agreed joining point is safe or permitted
- whether an exact stop is available at the requester’s origin or destination
- whether a route segment is suitable for all group sizes without additional walking or transfer
- whether a corridor is acceptable under local road access restrictions
- whether a human has mutually agreed to a practical meeting arrangement
- whether a different route choice or barrier crossing is required

Those are product-policy decisions and should remain explicitly unresolved unless the business process defines them separately.

## 13. Release and regression safeguards

The following release safeguards must remain explicit and are required before any stronger contract or migration is considered:

- same-state travel semantics must remain unchanged
- route evidence expiry and version mismatches must fail closed
- discovery privacy must remain enforced; requester destination exposure is not allowed
- complete-group seat capacity and roster validity must remain enforced before any offer or acceptance path is accepted
- roster and admission freezes must remain enforced exactly as currently defined
- two concurrent acceptances must remain protected by the existing locking and validation order
- the existing need/offer/availability locking order must remain intact
- no unauthorized financial, payout or settlement effects may be introduced by a corridor-suitability change
- already accepted agreements must not be retroactively reinterpreted under a new suitability contract
- both discovery directions and the acceptance path must remain validated
- migration rollout must be versioned and explicit
- production deployment must require explicit authorization before rollout

These safeguards are part of the contract and must not be treated as optional documentation notes.

## 14. Scenario/test matrix

| Scenario | Evidence integrity | Geographic suitability | Proposed classification | Human coordination possible? | Must still be validated before acceptance |
|---|---|---|---|---|---|
| Ordinary forward shared corridor | Valid and current | Independently supported | `provisionally_compatible` or `supported_shared_corridor` only after both checks are satisfied | Yes, until an exact practical joining arrangement is agreed | Need state, capacity, availability, exact identities, route freshness, accepted roster |
| Reverse direction | Valid and current | Not directionally compatible for the intended use | `needs_coordination` | Yes | Same as above; reverse order does not imply support |
| Same-position projections | Valid and current | Not sufficient proof of a usable corridor | `needs_coordination` | Yes | Exact route identity and current state still required |
| Partial segment sharing | Valid and current | Plausible but not fully proven as traversable shared continuity | `provisional_candidate` or `provisionally_compatible` | Yes | Need timing, practical join, exact route binding, capacity |
| Requester approaching route by ordinary transport | Valid and current | Possible but not proven as a legal or practical connection | `provisional_candidate` or `needs_coordination` | Yes | Walking/transport practicality is not proven by route geometry alone |
| Repeated route traversal | Valid and current | Ambiguous because of repeated traversals | `ambiguous_projection` | Yes | Fresh route evidence and exact identity binding |
| Self-intersection | Valid and current | Not uniquely supported | `ambiguous_projection` or `needs_coordination` | Yes | Exact supported corridor must be re-established if needed |
| Parallel roads separated by barrier | Valid and current | Not sufficient proof of usable connection | `needs_coordination` or `unsupported_shared_corridor` | Yes, but with caution | Needs an explicit joining arrangement and legal/physical accessibility policy |
| Nearby roads with no usable connection | Valid and current | Not sufficient proof of a viable shared connection | `needs_coordination` or `unsupported_shared_corridor` | Yes | Must not be treated as support without exact evidence |
| Evidence-integrity or freshness checks fail | Fails freshness or version checks | Not evaluated | `ineligible` (authoritative eligibility disposition, not a corridor-assessment status) | No until fresh evidence is provided | Re-run the full route-match and availability validation |
| Evidence or availability identity mismatch | Fails exact binding | Not evaluated | `ineligible` | No | Must fail closed before offer or acceptance |
| Group capacity becomes insufficient | Valid but capacity not satisfied | Not evaluated | `ineligible` | No | Capacity check and route binding must be repeated |
| Candidate geometrically eligible but not mutually selected | Valid and current | Could be provisionally supported | `provisional_candidate` or `provisionally_compatible` | Yes | Human coordination or later explicit proposal required |
| Candidate selected but not yet activated | Accepted status under current lifecycle semantics | Separate from corridor assessment | Existing lifecycle state only | Yes, pending activation | Activation, payment and lifecycle checks still required |

## 15. Proposed minimum future SQL integration plan

This document intentionally does not implement a database gate. The future minimal integration plan is as follows:

1. Add a private versioned suitability assertion, not a public status API.
2. Reuse the established exact binding chain already used by request-interest and offer-accept flows.
3. Invoke the suitability assertion only after evidence integrity and geographic-suitability checks are both satisfied or explicitly classified as provisional.
4. Keep the priority engine and all weights unchanged.
5. Keep the public discovery and inbox APIs advisory-only and non-admission.
6. Preserve current lock ordering and same-state rules.
7. Only allow a stronger suitability state to participate in binding or acceptance after the product team approves the practical meeting-point semantics.

Provisional or coordination-only route findings cannot independently authorize interest creation, movement-offer creation, acceptance, alignment creation or seat reservation. Any such action remains subject to the currently applicable authoritative backend rules. This document does not invent a new admission restriction and does not imply that the current production backend already enforces the proposed suitability states.

Implementation should remain narrow and versioned:

- private suitability assertion(s)
- versioned state names for design review only
- no public route suitability filter that invents admission policies
- no change to the 0089/0090 priority formulas
- no change to current capacity or lifecycle semantics

## 16. Open product-policy decisions that must remain explicit

The following are not safely inferable from current trusted evidence and must be resolved by product review before a stronger contract is enforced:

- What exact evidence qualifies as a geographically supported shared corridor when a route loops, intersects itself or has multiple plausible traversals?
- Is a supported corridor alone sufficient for an offer to be presented, or must a proposed pickup/dropoff arrangement also exist?
- What human coordination step is required before a route can become authoritatively supported for acceptance?
- What exact product semantics define a “practical joining arrangement” when the requester approaches using ordinary transport or a different stop is needed?
- What is the minimum evidence required to move from a coordination candidate to a final accepted itinerary?

These are genuine product-policy questions, not engineering problems. The safe default is to keep the current route evidence and current admission path conservative and bounded to exact trusted proof.

## 17. Final contract statement

This 0092 design keeps the backend contract honest:

- objective route projection is evidence, not assent
- evidence integrity and geographic suitability are two separate requirements
- a supported shared corridor is a route-level fact, not a legal or social acceptance decision
- a human-agreed joining arrangement is a separate product commitment
- a mutually activated movement is a later operational state produced only after separate acceptance and lifecycle checks

A shared road segment may be objectively evidenced without being a legally accessible stop, without a fixed pickup point and without immediate acceptance. The system must preserve that distinction until a product-approved meeting-point and acceptance policy is explicitly defined.
