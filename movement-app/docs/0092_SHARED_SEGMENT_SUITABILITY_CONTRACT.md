# 0092 — Trusted shared-segment suitability: implementation contract (draft)

Status: **design and test contract only; no admission behavior changed**.
Base: GitHub main after PR #34; production migrations through 0091 last verified.
Scope: evaluate whether an independently intended offering journey actually supports a useful requester travel segment without inventing a journey, mandating door-to-door matches, or imposing a universal detour cap.

## Confirmed audit evidence

- `route-match-geometry.ts` computes each requester endpoint's nearest position on a trusted offerer route independently; strict `<` ties prefer the first encountered segment. Looping/hairpin/parallel-road interpretation is therefore not proven.
- `record_trusted_route_match_evidence_for_server` records the positions, endpoint distances, and the derived `forward | same_position | reverse` relationship.
- The current `assert_trusted_route_match_evidence` validates trusted provenance/current bindings; the inspected `assert_requester_interest_support`, `assert_movement_offer_route_match_binding`, and `assert_movement_offer_availability_binding` do not themselves compare route positions or endpoint distance for suitability.
- Requester-first offer creation and offer-from-interest both call `private.create_movement_offer_internal`; the latter also validates interest first.
- Offerer-side interest inbox and requester-side offer discovery validate existing admission eligibility before prioritization.
- `public.accept_movement_offer` delegates to `private.accept_movement_offer_legacy_internal`, which locks need then offer, validates `assert_movement_offer_availability_binding` twice, and consumes complete requester-group capacity under the established availability lock before creating an alignment.

## Nonnegotiable boundaries

1. An offerer must already have independently intended their own journey.
2. A partial section of the offerer's journey may serve a requester; requester need endpoints need not equal offerer endpoints.
3. Requesters may walk or use ordinary transport before/after a matched journey. No universal maximum detour or walking-distance rejection.
4. Objective geometry evidence is **not** itself the human agreement to a pickup/drop-off point.
5. Same-state, expiry, trust, timing, active vehicle access, group-capacity, privacy and admission freeze remain enforced by authoritative existing components; do not infer they are all independently end-to-end verified.
6. No change to financial accounting, activation, payouts, journey start/completion, member identities, or existing agreements.
7. Requester destination coordinates or reconstructable route positions must not be exposed through discovery APIs.

## Proposed assessment semantics (not yet authorized as SQL status names)

- **supported_projection**: candidate offers at least one verified directional shared portion of the existing route. This is an objective route-relationship finding, *not proof of lawful accessible boarding or participant agreement*.
- **needs_coordination**: route projection is reversed, zero-length, self-overlapping, tied, insufficiently evidenced, or depends on alternative boarding points. Preserve possibility of human negotiation but **do not advertise as a confirmed shared segment**.
- **ineligible**: an authoritative non-negotiable rule fails (trusted identity/context/expiry, current availability, capacity, timing, state route validation or start freeze). An ordinary reverse projection alone does not establish this.

These outcomes MUST NOT be translated directly into admission filtering until the product-facing coordination/confirmation behavior and authoritative data evidence have been explicitly defined and reviewed.

## Implementation boundaries

- Keep `calculateTrustedRouteMatchGeometry` a trusted *measurement* producer. A new analysis layer may detect multiple projections and ambiguous topology, but must not overwrite verified route evidence with a heuristic conclusion.
- Avoid treating `route_order='forward'` as sufficient: separately projected points can lie on nearby but incompatible strands of an overlapping or looped route.
- Do not infer legal accessibility from geometric closeness; provider road snap alone is not proof of permitted pickup.
- Decide how specific agreed pickup/drop-off points receive trusted references **before** permitting ambiguous matches to transition to accepted journeys.
- Reuse `private.assert_movement_offer_availability_binding` or a centrally invoked assertion for the acceptance gate; preserve need → offer → intent/route/availability → evidence lock order and existing exception handling.
- The two discovery directions, explicit interest creation, both offer constructors, and acceptance must not disagree on authoritative admission eligibility.
- Existing historical accepted agreements must not be retroactively rewritten. Plan deployed-policy versioning and in-flight transition behavior before a migration.

## Required tests before any admission-changing migration

| Case | Evidence requirement | Expected property |
|---|---|---|
| Ologolo → VI; Ikate → Oniru | Forward usable corridor and permitted joining point | A legitimate partial segment is not rejected merely because endpoints differ |
| Ologolo → VI; opposite-direction requester | Reverse projection | Not asserted to be a confirmed forward shared segment |
| Requester exits before offerer terminus | Ordered interior points | Whole offerer journey not required |
| Long walk/public transport to joining corridor | Off-route requester endpoint | No arbitrary universal detour cutoff |
| Looped/self-overlapping route | Multiple plausible nearest points | Ambiguity detected or conservatively unconfirmed; never silently treated as unique |
| Nearby parallel or divided roadway | Geometry without accessible joining point | Closeness alone not asserted as lawful accessible pickup |
| Destination precedes origin on route | Reverse ordering | No false confirmed overlap |
| Expired or cross-bound evidence | Trusted evidence and state context | Existing fail-closed rules preserved |
| Timings do not overlap | Trusted temporal evidence | Current timing policy consistently enforced |
| Group exceeds remaining seats | Current availability | All-or-none admission |
| Departure roster frozen | Freeze receipt | New admissions blocked; accepted siblings unaffected |
| Two concurrent acceptances | Database transaction/locks | No seat overdraw, duplicate alignment or lock-order regression |
| Requester-facing/offerer-facing discovery | Masked projections | No exact requester destination disclosure |
| Established funded agreement | Existing financial accounting | No financial/lifecycle mutation from suitability work |

## Sequence and release gate

1. Add adversarial geometry tests (loops, ties, hairpins, divided/parallel roads) that show what existing measurements can and cannot prove.
2. Specify a testable authoritative representation of a **selected shared segment and joining points**, including cases requiring coordination; distinguish proposal from acceptance.
3. Implement a pure, versioned assessment function and unit tests without modifying production admission.
4. Determine which outcomes may enter discovery, interest, offer, or acceptance. Review existing SQL lock sequence and exception handling before integration.
5. Add PostgreSQL integration and concurrency tests for both discovery paths and acceptance; run all relevant node tests and typechecks.
6. Review a migration on a branch/PR; deploy to the active Supabase project only after tests and explicit deployment authorization; independently verify production.

## Cost ledger

No additional paid service is currently justified. Reuse existing Supabase, GitHub and trusted route-evidence/mapping infrastructure. Provider-level road access/turn restrictions may require a later capability audit; classify any new paid provider before selection.

## Open decisions that must not be silently filled in by implementers

- Which minimum evidence supports a *confirmed* segment when the route doubles back, intersects itself or has multiple plausible projections?
- Which coordination outcome is visible in each discovery direction, and can it progress to binding offer/acceptance without an explicit agreed pickup/drop-off reference?
- How to validate actual permitted joining points without prescribing universal detour tolerance?
- How to version suitability policy and preserve already-accepted agreements when moving from evidence-only to enforced admission?
