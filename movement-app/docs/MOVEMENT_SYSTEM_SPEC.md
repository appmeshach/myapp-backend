# MOVEMENT SYSTEM — CANONICAL PRODUCT & ARCHITECTURE SPECIFICATION

Status: ACTIVE SOURCE OF TRUTH
Project: movement-app
Purpose: Preserve the product mission, architectural invariants, security boundaries, implementation state, deferred capabilities, and small decisions that must not be lost between conversations or development sessions.

---

# 1. HOW TO USE THIS DOCUMENT

This document is the canonical reference for the Movement system.

Before making a substantial product, database, API, security, or client-flow change, compare the proposed change against this document.

A change must not silently contradict an established rule merely because the current UI or database implementation is narrower than the intended product.

When new product decisions are made, update this document.

When implementation changes, update the implementation-status sections.

Use these classifications:

## CONSTITUTIONAL RULE

A foundational rule of the product.

Do not violate or weaken it without an explicit product-level decision.

## SECURITY INVARIANT

A security or privacy boundary that must remain true regardless of client implementation.

## CURRENT V1 DECISION

Something deliberately intended for the first releasable version.

## IMPLEMENTED

Already represented in code/database and verified sufficiently to be treated as existing behavior.

## NOT IMPLEMENTED YET

Part of the intended system that is not yet represented completely in the current implementation.

## DEFERRED BUT MUST REMAIN POSSIBLE

Not required for first release, but present architecture must not make it impossible or require destructive redesign later.

## OPEN DECISION

A question that has not yet been conclusively decided.

## HISTORICAL DECISION — DO NOT ACCIDENTALLY REVERSE

A decision made previously that may be easy to lose or accidentally redesign.

---

# 2. THE CENTRAL PRODUCT PRINCIPLE

## CONSTITUTIONAL RULE

# WE DO NOT CREATE JOURNEYS.

Movement is not Uber, Bolt, inDrive, or a conventional ride-hailing marketplace.

The platform does not primarily create a new journey because another person asks for transportation.

Instead, the platform identifies and connects movement that already exists or that a person already genuinely intends to make.

A person may already be going somewhere.

That person can expose that intended movement.

Another person who needs to move may discover that existing movement and determine whether some part of it is useful.

The requester should often adapt to movement that already exists rather than expecting the platform to manufacture a direct origin-to-destination trip specifically for them.

The system therefore matches movement.

It does not create journeys.

---

# 3. OFFER-FIRST AND REQUEST-FIRST ARE BOTH VALID

## CONSTITUTIONAL RULE

The system must support BOTH directions.

Neither direction defines the entire product by itself.

---

## 3.1 OFFER-FIRST

A requester does NOT need to exist before an offerer can offer movement.

A member may use the normal Offer Movement flow to independently declare:

- where they intend to start,
- where they intend to go,
- when they intend to move within the allowed planning window,
- the vehicle they have legitimate access to where applicable,
- available capacity,
- trusted location references.

The backend then establishes the authoritative movement context, including trusted route evidence.

An eligible offered movement may become discoverable to relevant potential requesters even when no requester existed at the time the offerer declared it.

A requester can appear later and determine:

"This person's existing offered movement may help me."

The requester can then adapt their own journey around that movement where appropriate.

### HISTORICAL DECISION — DO NOT ACCIDENTALLY REVERSE

AN OFFERER DOES NOT NEED A REQUESTER TO EXIST FIRST.

A member may offer movement they independently intend to make, and requesters may later discover and adapt to that movement.

The absence of an existing requester must not prevent an otherwise eligible offered movement from becoming available for discovery.

The system does not claim to know or prove a member's private motive or state of mind. It establishes trusted facts supporting the declared movement, such as the member, trusted locations, timing, route evidence, vehicle access where applicable, and other eligibility requirements.

---

## 3.2 REQUEST-FIRST

A requester may also express a movement need first.

An offerer may discover that masked need.

However, seeing a requester must NOT allow the offerer to fabricate a journey around that person's demand.

Before attaching an offer to a requester, the offerer must independently establish their own genuine movement intent and trusted route.

The system can then calculate the relationship between:

- the requester's need, and
- the offerer's independently proven movement.

The offerer can decide whether that requester fits into movement they already intend to make.

---

## 3.3 IMPORTANT DISTINCTION

"Offer-first" and "request-first" describe discovery/order of interaction.

They do NOT change the underlying invariant:

The offerer's movement must remain independently real.

---

# 4. MOVEMENT OFFER INVARIANT

## SECURITY INVARIANT

An offer attached to a requester must be backed by the offerer's own:

- verified movement intent,
- trusted origin,
- trusted destination,
- trusted route evidence.

A person must not be able to:

1. inspect a requester,
2. invent a convenient route around that requester,
3. present that invented route as pre-existing movement.

Existing server-side enforcement for this invariant must not be weakened merely to simplify UI.

---

# 5. MEMBERS ARE NOT PERMANENTLY "DRIVERS" OR "PASSENGERS"

## CONSTITUTIONAL RULE

A member is a person first.

The same member may:

- request movement on one occasion,
- offer movement on another occasion.

Do not architect permanent human identities around conventional taxi-marketplace roles unless a specific feature genuinely requires a temporary role for one movement interaction.

Terms such as requester and offerer describe a person's role in a particular movement context.

They are not permanent classes of user.

---

# 6. PARTIAL ROUTES ARE FUNDAMENTAL

## CONSTITUTIONAL RULE

A requester's full trip does not need to be covered by one matched vehicle.

Exact origin-to-destination matching is NOT required.

Example:

A person ultimately wants to reach Ikeja.

They might:

1. use ordinary public transport to reach Ologolo,
2. join an existing Ologolo → Victoria Island movement,
3. leave that movement in VI,
4. join another VI → Ikeja movement later,

OR:

5. continue from VI using ordinary transport.

All of those can represent successful use of the system.

Therefore movement usefulness is not defined only by:

requester origin == offerer origin

and

requester destination == offerer destination.

---

# 7. ROUTE SEGMENTS

## CONSTITUTIONAL RULE

A route is not merely two endpoint labels.

The system must be capable of reasoning about movement along a route.

A requester may benefit from only a segment of an offerer's full movement.

Conceptually:

Offerer:
A ---------------- B ---------------- C ---------------- D

Requester may only need:
        B -------- C

That can still be a useful movement relationship.

The offerer may continue beyond the requester's useful segment.

The requester may have travelled before joining the offerer and may continue travelling after leaving them.

---

# 8. MULTI-LEG MOVEMENT

## DEFERRED BUT MUST REMAIN POSSIBLE

Advanced automatic multi-leg journey construction does not need to be fully built for the first release.

However, current architecture must not assume:

"one requester need = one vehicle covering the whole trip."

Future architecture should be able to support combinations such as:

ordinary transport
→ matched movement
→ matched movement
→ ordinary transport.

Do not tightly bind the data model to a one-vehicle-door-to-door assumption that would require destructive redesign later.

---

# 9. ORDINARY TRANSPORT IS PART OF REAL-WORLD MOVEMENT

## CONSTITUTIONAL RULE

Movement does not attempt to replace every other form of transport.

Normal real-world transportation can complement matched movement.

A requester may:

- walk,
- take a bus,
- use a keke,
- take another commercial vehicle,
- use another transport method,

before or after a matched movement segment.

The application should help people exploit useful existing movement rather than insisting that the platform control the person's complete journey.

---

# 10. ROUTE RELATIONSHIP, NOT "PERFECT MATCH"

## CONSTITUTIONAL RULE

The backend may calculate objective facts describing how a request relates to an offerer's route.

Examples include:

- distance from a relevant requester point to the offerer's route,
- positions along the route,
- direction/order relationship,
- other factual geometric information.

The system should present relevant facts.

Humans make the final practical decision.

---

# 11. NO MAXIMUM-DETOUR RULE

## HISTORICAL DECISION — DO NOT ACCIDENTALLY REVERSE

There is deliberately NO universal maximum-detour threshold.

The system must not automatically reject an otherwise valid relationship simply because a calculated distance exceeds an arbitrary number.

Different people will tolerate different inconvenience.

The software may calculate and display objective measurements.

The offerer decides what inconvenience they are personally willing to accept.

Do not introduce hidden logic such as:

- "more than 2 km = impossible",
- "more than 5 minutes = invalid",
- universal detour rejection,

unless an entirely new explicit product decision is made later.

---

# 12. PRIVACY DOES NOT MEAN ANONYMITY

## CONSTITUTIONAL RULE

Members should be accountable.

Privacy should protect sensitive information.

Privacy must not turn participants into unaccountable anonymous actors.

The system should therefore combine:

- verified/accountable membership,
- controlled information disclosure,
- privacy before appropriate agreement,
- progressive access to operational information.

---

# 13. REQUESTER DESTINATION PRIVACY

## SECURITY INVARIANT

The requester's exact private destination must not automatically be exposed to an offerer during discovery.

Before appropriate agreement/activation, discovery APIs must not reveal information such as:

- exact requester destination coordinates,
- exact private destination,
- route-sensitive information that reconstructs the protected destination.

The backend may privately use trusted information to calculate movement relationships.

Backend knowledge does not imply frontend disclosure.

---

# 14. THREE DIFFERENT LOCATION CONCEPTS MUST NOT BE CONFUSED

The architecture must distinguish at least:

## 14.1 Requester's private intended destination

Where the requester ultimately intends to go.

This may remain private before agreement.

## 14.2 Offerer's intended destination

Where the offerer independently already intends to go.

This belongs to the offerer's genuine movement.

It is NOT automatically the requester's destination.

## 14.3 Agreed operational drop-off

A point later agreed between the participants for the shared movement segment.

This may be different from:

- the requester's final destination,
- the offerer's final destination.

Do not collapse these into one field or one concept.

---

# 15. TRUSTED LOCATION CHAIN

## SECURITY INVARIANT

The trusted location chain is:

typed search

→ trusted backend/provider

→ safe suggestion

→ cryptographic selection proof

→ user selection

→ proof-verified intake

→ private unresolved selected location

→ backend resolves provider identity

→ trusted resolved location

→ trusted coordinates.

The client must NEVER become authoritative for:

- coordinates,
- provider identity,
- route evidence,
- trusted location facts,
- other security-sensitive geographic facts.

The client may display and select.

The backend establishes authoritative security-sensitive facts.

---

# 16. PRECISE LOCATION AND DISCOVERY AREA ARE DIFFERENT DATA

## SECURITY INVARIANT

A private precise selected location and a broad discovery area serve different purposes.

Do not replace one with the other.

The precise trusted location may remain private.

A broader provider-backed area may be exposed where discovery requires approximate geographic context.

Broad discovery information must not become an accidental channel for exposing private precise location.

---

# 17. VEHICLE OWNERSHIP

## CONSTITUTIONAL RULE

Legal ownership of the vehicle is NOT required.

A member may legitimately offer movement using a vehicle they have permission/access to use, including:

- their own vehicle,
- family vehicle,
- borrowed vehicle,
- employer vehicle,
- friend's vehicle.

The system's primary security concern is the PERSON/member and their accountability.

Do not turn vehicle registration into legal-title verification unless a separate explicit product decision requires it.

Database/application terms such as "owner" must not silently be interpreted as proof of legal title where the product means access/accountability.

---

# 18. VEHICLE ACCESS AND CAPACITY

## CURRENT V1 DECISION

Where a movement is performed with a vehicle:

- the vehicle must be legitimately accessible to the offering member,
- active access must be checked,
- seat capacity must be respected,
- confirmed/accepted traveller count must never exceed capacity.

The offerer's own occupied place and any other capacity rules must be accounted for according to the authoritative backend model.

Existing backend enforcement around active access and capacity must remain authoritative.

The client may validate early for usability, but backend validation remains required.

## INTEREST DOES NOT RESERVE CAPACITY

A requester expressing interest does NOT reserve a place.

Interest means:

"This offered movement may work for me and I want the offerer to consider me."

It does not mean:

- seat reserved,
- agreement created,
- participation guaranteed.

## REQUESTER-SPECIFIC OFFERS DO NOT HOLD CAPACITY

An offerer may send requester-specific offers to more people than the number of places currently available.

Example:

- three places remain,
- five eligible interested requesters exist,
- the offerer may send offers to all five.

Sending those offers does not reserve the three places.

The outstanding offers compete for the remaining real capacity.

## FIRST VALID ACCEPTANCES CONSUME CAPACITY

Capacity becomes authoritatively committed only when an eligible requester successfully accepts and the backend successfully forms the required agreement/commitment state.

Acceptance must be atomic and server-controlled.

Example:

Three places remain and five people have outstanding offers.

- first valid acceptance succeeds,
- second valid acceptance succeeds,
- third valid acceptance succeeds,
- capacity becomes zero,
- later acceptance attempts fail because sufficient capacity no longer exists.

The backend must prevent simultaneous acceptance requests from overbooking the vehicle.

A phone seeing capacity earlier is never authoritative proof that capacity still exists at acceptance time.

## GROUP CAPACITY IS ALL-OR-NOTHING

Where a requester group requires multiple places, the required capacity must be committed together.

Example:

- one place remains,
- a confirmed two-person requester group attempts acceptance.

The entire acceptance must fail.

The system must not split the group merely because part of the required capacity remains.

## PENDING OFFERS ARE NOT CONFIRMED TRAVELLERS

The system and UI must distinguish:

- interest,
- pending requester-specific offer,
- accepted/confirmed participation.

Pending offers must never be presented as confirmed passengers.

---

# 19. GROUP TRAVEL

## CURRENT PRODUCT RULE

Group travel represents actual app members rather than an anonymous count of bodies.

`people_count` represents the total actual travellers in the requester's group.

The primary requester counts as one confirmed traveller.

Remaining places belong to invited/confirmed members.

Where acceptance requires group readiness:

- confirmed member count must equal `people_count`,
- unresolved invitations must not silently count as confirmed travellers,
- acceptance must fail if the required group is not ready.

Do not reduce group identity to only a numeric seat reservation if the system requires actual accountable members.

---

# 20. SOCIAL LAYER

## CONSTITUTIONAL RULE

Movement must NOT become conventional social media merely for engagement.

The social layer should grow from movement and human interaction around movement rather than replacing the movement system.

Useful capabilities may include:

- verified/accountable member profiles,
- voluntary saved social media,
- permission-controlled media sharing,
- in-app communication,
- people meeting through shared movement,
- movement-related reputation/relationship mechanisms where appropriate,
- future movement-based social expression.

Movement matching and social interaction may overlap without becoming the same system.

A member must not be required to participate socially merely to offer movement.

A member must not need to manufacture a transport offer merely to participate in a future social layer.

## ACCOUNT VERIFICATION AND SOCIAL MEDIA ARE DIFFERENT SYSTEMS

The application may verify the accountable person behind an account.

That does NOT mean every social image uploaded by that member has been individually identity-verified.

The system must distinguish:

### Identity/security verification media

Media collected or generated for purposes such as:

- identity verification,
- face verification,
- liveness,
- fraud prevention,
- security/accountability evidence.

This media is private security material.

It must NEVER become visible through the normal social-media permission system merely because another member requests access to saved media.

### Member-saved social media

Media the member voluntarily chooses to save or share for social/profile purposes.

This media:

- belongs to the verified/accountable account,
- is not automatically individually identity-verified,
- may later be permission-shared according to product rules,
- must not be represented as though every image itself has been identity-verified.

The application's verification indicator applies to the accountable member/account unless a specific piece of media has separately undergone an explicit verification process.

## DO NOT CONFUSE UPLOADED MEDIA WITH VERIFIED IDENTITY

A member may legitimately save social media that includes:

- themselves,
- places,
- events,
- vehicles,
- friends or group settings where permitted,
- other appropriate social content.

The system should not require identity verification against every ordinary social image.

However, the product must also avoid presenting ordinary saved media in a way that falsely implies:

"This exact photograph has been independently identity-verified."

Rules for a future primary profile image, impersonation prevention, deceptive profile presentation, reporting, and stronger identity linkage may be designed separately.

Avoid building unrelated attention-maximization mechanics unless the product direction is explicitly changed later.

---

# 21. START AND COMPLETION ARE HUMAN EVENTS

## CONSTITUTIONAL RULE

GPS must NOT automatically decide that a movement has started or completed merely because somebody appears to cross a coordinate.

Location may contribute evidence/context.

It does not replace human consent.

Movement completion is human-confirmed/mutual according to the lifecycle rules.

Do not implement:

"GPS says destination reached → movement automatically completed."

---

# 22. NEGOTIATION / AGREEMENT MODEL

## ARCHITECTURAL PRINCIPLE

Discovery is not agreement.

Route relationship is not agreement.

An offer is not automatically agreement.

The system should preserve distinct states conceptually:

1. movement/request exists,
2. discovery,
3. route relationship calculated,
4. human evaluates,
5. offer/interaction,
6. agreement,
7. activation,
8. movement start,
9. active movement,
10. end request/confirmation,
11. completion or another terminal outcome.

Exact database status names may differ.

Do not collapse these conceptual stages merely to make UI simpler.

---

# 23. OBJECTIVE SYSTEM, HUMAN DECISION

## CONSTITUTIONAL RULE

Where practical preference is subjective, the system should generally provide objective information rather than silently making the personal decision.

Examples:

- route distance,
- capacity,
- direction relationship,
- timing,
- movement state.

The human decides whether the arrangement works for them, except where security, eligibility, capacity, lifecycle, or other hard system invariants require rejection.

---

# 24. CURRENT CLIENT OFFER FLOW

## IMPLEMENTED — BUT INCOMPLETE AS THE FULL PRODUCT

Current file:

`src/app/offer-movement.tsx`

The implemented path currently includes:

- offerer location selection,
- departure selection,
- creation of offerer's movement intent,
- trusted route generation,
- active vehicle loading,
- masked requester-need discovery,
- requester selection,
- requested seats,
- "Check route relationship",
- objective route relationship result,
- "Confirm and create offer".

`checkRouteMatch()` currently depends on a selected requester need.

`confirmMovementOffer()` attaches the resulting offer to that requester.

This is a valid REQUEST-FIRST/REQUEST-ATTACHED branch.

It is NOT the complete meaning of "offer movement".

---

# 25. CURRENT CLIENT GAP: OFFER-FIRST

## NOT IMPLEMENTED YET / REQUIRES DESIGN

The current client does not yet fully provide the offer-first lifecycle required by the product constitution.

After the offerer successfully creates an eligible movement intent and trusted route, the absence of current requester demand must NOT mean:

"there is nothing meaningful left to do."

In the normal Offer Movement flow, the offered movement should be capable of becoming discoverable to relevant potential requesters without requiring an already-existing requester.

The offerer should not be forced through an unnecessary second "publish my movement" action merely to make an ordinary movement offer discoverable.

However, the backend must still distinguish between:

- the authoritative historical movement intent and route evidence, and
- whether that movement is currently available/discoverable for matching.

This distinction allows a movement to stop appearing as available because of cancellation, capacity, expiry, departure, lifecycle changes, or other eligibility changes without deleting or rewriting the historical movement record.

The exact V1 discovery representation, availability lifecycle, capacity binding, expiration rules, privacy fields, and requester-interest flow must be designed carefully before implementation.

Do NOT solve this by weakening the existing requester-attached offer authorization.

The existing trusted requester-specific offer flow remains valid and should become the later person-specific stage of offer-first interaction.

---

# 26. IMPORTANT ARCHITECTURAL DISTINCTION

A useful conceptual separation is:

## Movement intent

The authoritative backend record that:

"This member independently declared that they intend to make this movement."

It records the declared movement context. It does not claim to prove the person's private motive or state of mind.

## Trusted route evidence

The backend/provider-backed evidence corresponding to that declared movement.

## Movement availability / discoverability

Whether that eligible offered movement is currently available to be discovered by relevant potential requesters.

This is lifecycle state, not a replacement for the historical movement intent.

A movement may stop being discoverable without deleting the underlying intent or trusted evidence.

## Requester interest

A requester indicates that an already-offered movement may help them.

Interest does NOT automatically:

- reserve capacity,
- create an agreement,
- guarantee participation,
- reveal saved social media,
- activate the movement.

Before interest, a requester may privately view an offered movement and privately check objective route relationship using their own trusted requester movement context.

Those private checks do not automatically make the requester visible to the offerer.

Once the requester explicitly expresses interest, the requester becomes an actionable potential participant for that offerer.

## Basic accountable profile

After the requester expresses interest, the offerer may receive an appropriate basic accountable profile together with safe movement information and objective route-relationship facts.

The requester's normal profile avatar may be visible immediately after explicit interest as part of this basic accountable profile.

The profile avatar is separate from the member's permission-gated saved-media gallery.

Showing the avatar does NOT mean that the specific avatar image itself has been individually identity-verified unless the product later explicitly performs and represents such verification.

The verified-member/accountability indicator applies to the member/account, not automatically to every image associated with that member.

Saved social media beyond the normal profile avatar remains permission-gated.

Other exact V1 fields shown in the basic accountable profile must be separately designed.

Basic accountable profile access is distinct from permission to view saved social media.

## Optional saved-media permission

The offerer may request permission to view the interested requester's saved social media before deciding whether to send a requester-specific movement offer.

The requester may:

- allow the request,
- decline the request.

Declining saved-media access does NOT automatically cancel the requester's movement interest.

Granting saved-media access does NOT:

- reserve capacity,
- create a movement offer,
- create an agreement,
- activate movement.

The offerer remains free to send or decline the requester-specific movement offer whether saved-media access was granted or refused.

Saved-media access should initially be scoped to the relevant movement interaction rather than treated as permanent universal access.

The underlying permission architecture should not unnecessarily prevent reciprocal member-to-member media permission later, even if V1 exposes only the minimum required direction.

Identity-verification/security media is NEVER included in this saved-media permission mechanism.

## Requester-attached offer

The offerer has evaluated a particular requester against their independently established movement and is willing to offer that requester participation.

The offerer may decide using only:

- basic accountable profile information,
- movement information,
- objective relationship facts,

or may additionally request permitted saved social media.

Social-media access must not become a mandatory condition imposed by the platform itself.

## Agreement

Both sides have reached the required consent/acceptance state and all backend eligibility requirements pass.

These concepts must not be casually collapsed into one row/state without reviewing security, privacy, capacity, history, and lifecycle implications.

---

# 27. CURRENT TRUSTED ROUTE ARCHITECTURE

## IMPLEMENTED

The backend has private trusted route evidence for offerer movement.

Route evidence includes trusted provider-backed route information rather than client-submitted authoritative coordinates.

Important security properties already implemented/tested include:

- trusted origin/destination derived from private intent/location records,
- provider-backed route generation,
- route evidence lifecycle,
- private storage,
- versioning,
- one-current-evidence semantics,
- client inability to author authoritative route coordinates/provider identity,
- service-side recording,
- claim/rate-limit mechanisms,
- replay/idempotency protections.

Do not rebuild this casually.

---

# 28. MIGRATION / BACKEND HISTORY

## IMPLEMENTED HISTORY — DO NOT CASUALLY REDO

Important later milestones include:

- 0031 — route-generation context
- 0032 — route provider rate limit
- 0033 — route-generation claim boundary
- route Edge deployment
- 0034 — offering movement intent intake
- 0035 — requester movement intent/intake
- 0036 — subsequent movement architecture work
- 0037 — trusted route-match foundation
- 0038 — trusted writer work
- 0039 — route matching
- 0040 — discovery-area work
- 0041 — masked discovery
- 0042 — trusted movement-offer authorization
- 0043 — route-evidence provider identity scope/replay correction

Do not edit already-applied historical migrations to change production behavior.

Use forward-only migrations when production schema behavior must change.

---

# 29. MIGRATION 0042 INVARIANT

## IMPLEMENTED

0042 strengthened requester-attached movement offers.

Important behavior includes:

- offer binding to trusted evidence,
- server-side validation,
- acceptance-time revalidation,
- old weaker RPC removed/replaced,
- no automatic maximum-detour rejection.

Do not weaken 0042 merely to implement offer-first behavior.

Offer-first must be modeled in a way that preserves requester-attached authorization when an offer eventually becomes requester-specific.

---

# 30. MIGRATION 0043

## IMPLEMENTED IN PRODUCTION — CURRENT WORKING SESSION

`0043_route_evidence_provider_identity_scope.sql`

Purpose:

Correct an overly broad route-evidence provider identity/replay boundary.

Previously, provider route identity was globally unique across route evidence.

This conflicted with legitimate provider behavior where:

- the same provider route identity can occur for different offering movement intents,
- a repeated observation can contain a later locally-generated observation timestamp.

0043:

- removes the old global provider-route uniqueness constraint,
- scopes provider identity uniqueness to `offering_movement_intent_id`,
- scopes replay lookup to the authoritative offering intent,
- preserves stored original `generated_at`,
- allows a different valid incoming observation time on replay,
- continues rejecting material route-fact mismatches,
- preserves trusted endpoint, route-shape, distance, duration, expiry, and lifecycle checks.

Production verification completed:

- local migration 0043 matches remote 0043,
- old global unique constraint is absent,
- new intent-scoped unique constraint exists,
- live writer function matches the 0043 definition.

Do not undo this correction.

---

# 31. OLOGOLO LOCATION FIX

## IMPLEMENTED / COMPLETED

A production-specific Ologolo resolution failure was investigated.

Search already worked.

The failure occurred after selecting the location because Mapbox could resolve Ologolo/Ologolo Road as a street feature that did not contain the broader context in the exact shape originally expected.

The fix added a trusted reverse-geocoding fallback only after forward exact-ID verification.

Important retained protections include:

- exact provider identity verification,
- trusted provider coordinates,
- Nigeria validation,
- no client-authoritative coordinates,
- fail-closed malformed context handling,
- legitimate locality/place-only reverse fallback,
- precise location remains trusted/private,
- broad discovery area remains separate.

The Ologolo fix was deployed and committed.

Do not re-debug or redesign this unless new evidence shows a regression.

---

# 32. CURRENT TEMPORARY ROUTE DIAGNOSTICS

## CURRENT DEVELOPMENT STATE — MUST CLEAN UP

Temporary diagnostics were inserted into:

`supabase/functions/_shared/route-runtime.ts`

during investigation of repeated:

"Route generation is already in progress."

The diagnostic identified the actual writer failure that led to 0043.

These diagnostics are NOT permanent product code.

Before final commit/release of this work:

- remove temporary diagnostic instrumentation,
- preserve normal fail-closed behavior,
- rerun relevant tests/typechecks,
- redeploy clean Edge code,
- verify production behavior.

Do not accidentally commit debugging instrumentation.

---

# 33. DEPARTURE TIME

## CURRENT V1 DECISION / IMPLEMENTED

Offer Movement uses the same scrolling departure picker pattern as requester flow.

Behavior:

- options begin at the next whole minute,
- options extend 24 hours,
- one-minute increments,
- selected value is an ISO timestamp,
- displayed label is human-readable,
- manual free-text departure entry was replaced.

Do not casually revert to unstructured manual time entry.

---

# 34. PLANNING HORIZON

## IMPLEMENTED CURRENT RULE

Existing movement intent/request timing validation uses a controlled future planning horizon.

Current architecture contains a 24-hour planning boundary for relevant movement-intent timing.

Do not confuse this planning horizon with a maximum physical journey duration.

Those are different concepts.

---

# 35. DISCOVERY, AVAILABILITY VISIBILITY, AND NETWORK-SIZE PRIVACY

## SECURITY INVARIANT

Discovery should reveal only the information needed for another person to determine whether interaction may be useful.

It must not become a side channel for:

- exact requester destination,
- exact protected coordinates,
- private route geometry,
- unnecessary personal information.

Masked discovery exists for a reason.

Offer-first discovery must obey equivalent privacy principles.

## CURRENT V1 DECISION — UNAVAILABLE MOVEMENTS

A movement that is no longer eligible for new participation should normally disappear from general discovery.

Examples include movement that becomes:

- full,
- withdrawn from new discovery,
- expired,
- departed,
- cancelled,
- otherwise ineligible for new matching.

The backend must retain the authoritative movement history and the reason it is no longer available where required.

Stopping discovery does NOT mean deleting the movement.

People already interacting with the movement may still need an accurate status.

For example, a person attempting to accept after capacity has filled must be truthfully informed that sufficient capacity is no longer available.

General browsers do not need to see a public catalogue of:

- FULL,
- EXPIRED,
- WITHDRAWN,
- UNAVAILABLE

movements merely to demonstrate historical activity.

## CURRENT PRODUCT DECISION — DO NOT UNNECESSARILY EXPOSE NETWORK SIZE

Especially during early growth, the application should avoid unnecessary public information that allows ordinary users to estimate the total size or activity level of the network.

Do not unnecessarily expose things such as:

- total number of active movements,
- total people currently online,
- exact counts of all available movements,
- empty-state statistics that reveal how small the network currently is,
- historical unavailable inventory merely to demonstrate activity.

The product may design discovery and empty states so that the network's total size is not obvious.

## TRUST RULE — DO NOT FABRICATE REAL ACTIVITY

Protecting network-size information must NOT be implemented by presenting fictitious members, fictitious movements, fictitious available seats, fictitious agreements, or other invented activity as though it were real.

A movement presented as an actual available movement must correspond to an authoritative eligible movement.

The application may control presentation and avoid revealing unnecessary totals without inventing transactional activity.

---

# 36. BACKEND AUTHORITY

## SECURITY INVARIANT

Any fact affecting authorization, privacy, route trust, participant identity, vehicle access, capacity, lifecycle, evidence, or protected location must be revalidated server-side where required.

Client validation is convenience.

It is not the security boundary.

Never accept a client-supplied value as authoritative merely because the UI previously validated it.

---

# 37. FAIL CLOSED

## SECURITY INVARIANT

When trusted evidence is:

- malformed,
- expired,
- missing,
- ambiguous,
- unauthorized,
- inconsistent,

security-sensitive operations should fail closed.

Do not weaken validation simply to remove an error message.

Investigate the cause.

Preserve the invariant.

---

# 38. EVIDENCE EXPIRY

## SECURITY INVARIANT

Trusted route-match or route evidence may expire.

The backend should reject stale evidence where required.

The client may surface the failure and require recalculation.

Do not make evidence permanently reusable just to improve convenience.

---

# 39. NO TAXI-MARKETPLACE DRIFT

## CONSTITUTIONAL RULE

Do not turn Movement into:

- driver dispatch,
- bidding,
- surge pricing,
- a marketplace for creating rides on demand,
- an optimization engine whose goal is to manufacture new commercial journeys for requesters.

Any future money/contribution model must be evaluated against:

# WE DO NOT CREATE JOURNEYS.

Detailed economic rules must be documented separately when conclusively decided.

---

# 40. SECURITY AUDIT BEFORE RELEASE

## MANDATORY RELEASE GATE

Before production release, perform an explicit security hardening audit covering at least:

- credentials inventory,
- old test/development credentials,
- credential rotation,
- Supabase service-role handling,
- Mapbox token restrictions/rotation,
- authentication configuration,
- all RLS policies,
- RPC grants,
- SECURITY DEFINER ownership,
- SECURITY DEFINER search_path,
- private-schema privileges,
- Edge Function authentication,
- Storage bucket ACLs/private media,
- callback/webhook security,
- payment integration if present,
- face-verification integration if present,
- rate limiting,
- abuse controls,
- replay resistance,
- idempotency,
- test users,
- fixtures,
- stale diagnostics,
- dependencies,
- privacy-sensitive logging,
- accidental secrets in logs/source,
- backup/recovery,
- migration recovery,
- attack surface,
- CORS,
- information leakage,
- error sanitation,
- production origin/domain restrictions,
- test-mode behavior,
- unused endpoints/functions.

This audit is mandatory.

It is not optional polish.

---

# 41. RELEASE PATH

## CURRENT RELEASE PLAN

Do not build forever.

The working release sequence is:

1. complete the client movement/route/offer architecture,
2. complete minimum requester + offerer end-to-end UX,
3. perform release-readiness and edge-state audit,
4. perform mandatory security hardening,
5. test in fresh environments with multiple real accounts/devices,
6. freeze scope,
7. release.

Advanced nonessential capabilities may remain deferred where architecture preserves them.

---

# 42. DEFERRED BUT MUST REMAIN POSSIBLE

Examples currently include:

- richer automatic multi-leg journey chaining,
- richer route-segment recommendation UX,
- broader social functionality,
- nonessential UI polish,
- advanced reputation/relationship features.

Deferred means:

"not necessary before V1."

Deferred does NOT mean:

"safe to architect away."

---

# 43. DEVELOPMENT WORKFLOW

## PROJECT RULE

Project directory:

`C:\Users\gt\Desktop\myapp\movement-app`

Git repository parent:

`C:\Users\gt\Desktop\myapp`

Branch:

`main`

Never use:

`git add .`

Stage exact files only.

Do not accidentally stage sibling repositories:

- `../gseller-app/`
- `../gtransport-app/`
- `../gzone-app/`

Do not stage generated:

`supabase/.branches/`

Normal safe workflow:

audit
→ narrow change
→ focused tests
→ regression tests
→ TypeScript
→ diff check
→ database validation where applicable
→ deploy after validation
→ live verification
→ exact staging
→ commit
→ push.

---

# 44. CODING-GUIDANCE RULES

The project owner is responsible for product logic and real-world system behavior but does not need to understand implementation internals.

Therefore implementation guidance must:

- explain technical decisions in plain language,
- give exact file paths,
- use exact old-block → new-block replacements,
- inspect current disk content before claiming what exists,
- treat disk as authoritative,
- stop when unexpected red/error output appears,
- address that error before continuing,
- never weaken security merely to make tests pass,
- never ask for secrets,
- never expose credentials,
- avoid unnecessary scope expansion.

There is no general `npm test` script.

Do not instruct use of `npm test`.

Known useful commands include:

`npm.cmd run typecheck`

`npm.cmd run typecheck:edge`

Full Node test pattern:

`$tests = Get-ChildItem "supabase\tests" -File | Where-Object { $_.Name -match '\.test\.(cjs|mjs)$' }; node --test $tests.FullName`

---

# 45. KNOWN HARMLESS DEVELOPMENT WARNINGS

The following have occurred without representing application failure:

- Node `MODULE_TYPELESS_PACKAGE_JSON` warning,
- LF → CRLF warnings,
- no `seed.sql` match,
- some Supabase CLI profile/debug noise previously documented.

Do not "fix" unrelated tooling warnings in the middle of security-sensitive feature work unless they materially affect the current task.

---

# 46. CURRENT CRITICAL PRODUCT GAP DISCOVERED 2026-09-24

The current Offer Movement client flow can successfully create the offerer's movement intent and trusted route.

When no requester need exists, it currently tells the offerer:

"There are no available movement requests right now."

The current route-relationship button is then unavailable because that operation requires a selected requester.

This behavior exposed an architectural incompleteness:

The current UI behaves as though the only meaningful next step after establishing movement is attaching it to an already-existing requester.

That contradicts the broader offer-first product model if treated as the only path.

### REQUIRED ARCHITECTURAL RESPONSE

Do NOT simply enable "Check route relationship" without a requester.

A route relationship requires something to compare against.

Instead, design the missing offer-first publication/discovery lifecycle.

The offerer's own trusted movement must be capable of existing independently.

Later:

- a requester may discover it,
- the backend may evaluate compatibility privately,
- the appropriate party may decide whether interaction should proceed.

The existing requester-attached route-match flow remains valid and should continue to exist.

---

# 47. NEXT ARCHITECTURAL DESIGN TASK

Before further UI modification, design the minimum secure offer-first lifecycle.

Questions that must be answered include:

1. What exact object represents an exposed/discoverable existing movement?

2. Is it:
   - the movement intent itself with a discoverable state,
   - a separate publication/exposure record,
   - or another derived server-controlled representation?

3. What information is safe for requesters to discover before agreement?

4. How is the offerer's exact private location protected where necessary?

5. What broad geographic/route information is sufficient for discovery?

6. How is vehicle/capacity bound to exposed movement?

7. When does capacity become reserved?

8. How does an exposed movement expire?

9. Can the offerer stop exposing future availability without invalidating historical evidence?

10. How does a requester express interest in an exposed movement?

11. At what stage is requester private destination used by the backend?

12. At what stage may operational pickup/drop-off information be revealed?

13. How does offer-first interaction transition into the existing trusted requester-attached offer/agreement machinery?

14. How do we preserve:
    "the offerer independently intended this movement"
    while allowing a requester to appear later?

15. What is the minimum V1 behavior that preserves future multi-leg capability without trying to build full multi-leg automation now?

Do not write code for this until the data/lifecycle/security model is agreed.

---

# 48. DECISION LOG — NEVER FORGET

This section should accumulate small but important decisions that are easy to lose.

## Decision 001

WE DO NOT CREATE JOURNEYS.

## Decision 002

Offer-first and request-first are both valid.

## Decision 003

An offerer does not need a requester to exist before offering movement.

An eligible movement offered through the normal Offer Movement flow may become discoverable to relevant potential requesters even when no requester existed when it was declared.

## Decision 004

The authoritative movement intent and trusted route evidence remain historical backend facts even when that movement later stops being available/discoverable.

Availability may end because of cancellation, capacity, expiry, departure, lifecycle state, or other eligibility rules without deleting or rewriting the original trusted movement record.

## Decision 005

The normal Offer Movement flow should not require an unnecessary second "Publish" action merely to make an eligible offered movement discoverable.

Backend movement history and current discoverability remain distinct concepts even when the user experiences them as one Offer Movement action.

## Decision 006

A requester may browse eligible available movements before creating their own movement need.

However, trusted compatibility/relationship processing must use authoritative requester movement context rather than arbitrary client-supplied coordinates.

## Decision 007

Requester interest does not reserve capacity, create an agreement, or guarantee participation.

## Decision 008

A requester-specific offer does not by itself reserve capacity.

An offerer may send more requester-specific offers than the number of places currently available.

## Decision 009

Available capacity is authoritatively consumed when eligible acceptance succeeds.

The backend must make this operation atomic so simultaneous acceptance attempts cannot overbook a vehicle.

The first valid acceptances that fit the remaining capacity succeed.

Later acceptances fail when sufficient capacity no longer remains.

## Decision 010

Requester groups consume their required places together.

If sufficient capacity does not exist for the complete group, the entire acceptance fails rather than splitting the group.

## Decision 011

A movement that becomes unavailable for new participation normally disappears from general discovery.

The backend retains the movement and its authoritative lifecycle/history.

People already interacting with that movement must still receive truthful status where necessary.

## Decision 012

The product should avoid unnecessarily exposing totals or empty-state statistics that allow ordinary users to estimate the network's size or early growth.

## Decision 013

Network-size privacy must not be achieved by fabricating members, movements, available capacity, agreements, or other transactional activity.

## Decision 014

A requester may adapt to existing movement rather than requiring direct door-to-door matching.

## Decision 015

One matched vehicle does not need to cover the requester's complete trip.

## Decision 016

Ordinary/public transport may be used before, between, or after matched movement.

## Decision 017

Advanced multi-leg automation may be deferred, but architecture must preserve the possibility.

## Decision 018

No universal maximum-detour threshold.

The system provides objective facts; the person decides.

## Decision 019

Requester exact destination remains private before the appropriate agreement stage.

## Decision 020

Offerer's destination, requester's private destination, and agreed operational drop-off are distinct concepts.

## Decision 021

Client coordinates, provider identity, and route evidence are not authoritative.

## Decision 022

Vehicle legal ownership proof is not required.

Person/accountability and legitimate vehicle access matter.

## Decision 023

A member may both request and offer movement.

Do not create permanent taxi-style human roles.

## Decision 024

Group travel represents actual accountable app members rather than only anonymous seat counts.

## Decision 025

GPS does not automatically complete movement.

## Decision 026

The social layer remains movement-purpose-driven rather than becoming general social media.

A future non-offer social expression of movement may exist, but it is separate from ordinary V1 movement availability.

## Decision 027

We should not make people manufacture a ride merely to participate socially, and we should not make people participate socially merely to offer movement.

The movement-matching and social systems may overlap without becoming the same system.

## Decision 028

Viewing an offered movement or privately checking route relationship does not automatically reveal the requester to the offerer.

The requester becomes actionable/visible to the offerer only after explicitly expressing interest.

## Decision 029

After interest, the offerer may receive an appropriate basic accountable requester profile plus safe movement and objective route-relationship information.

The requester's normal profile avatar may be visible immediately after explicit interest.

The saved-media gallery remains permission-gated.

The account's verified-member indicator represents verification/accountability of the member/account and must not automatically imply that the specific avatar image itself has been individually identity-verified.

Basic accountable profile access is separate from saved social-media access.

## Decision 030

Saved social media is permission-controlled.

An offerer may request permission to view an interested requester's saved social media before deciding whether to send a requester-specific offer.

The requester may allow or decline.

## Decision 031

Declining saved-media access does not automatically cancel movement interest.

Granting media access does not reserve capacity, create an offer, create an agreement, or activate movement.

The offerer may still send or decline the movement offer whether media access was granted or refused.

## Decision 032

Account verification and ordinary saved social media are separate systems.

The application verifies the accountable member behind the account.

Ordinary saved social media is voluntary content uploaded by that account and is not automatically individually identity-verified.

## Decision 033

Identity-verification, face-verification, liveness, fraud-prevention, and other security media must never be exposed through the ordinary saved-social-media permission mechanism.

## Decision 034

The application must not present ordinary saved social media as though every individual image has itself been identity-verified.

## Decision 035

Saved-media permission should initially be scoped to the relevant movement interaction rather than automatically becoming permanent universal access.

The underlying architecture should not unnecessarily block reciprocal member-to-member permission later.

## Decision 036

Existing requester-attached offer security must not be weakened to implement offer-first.

## Decision 037

Precise trusted location and broad discovery area are separate concepts.

## Decision 038

Applied migrations are historical records.

Use forward-only migration changes rather than editing production history.

## Decision 039

Deferred features must be explicitly tracked before launch.

---

# 49. OPEN DECISIONS

Do not invent answers to these without deliberate product discussion.

Several earlier questions are now resolved:

- ordinary eligible Offer Movement can become discoverable without an existing requester,
- no second manual Publish action is required for ordinary V1 movement availability,
- users may browse available movements before creating requester movement context,
- compatibility/route relationship should be privately calculated before the requester explicitly expresses interest,
- private checking does not automatically expose the requester to the offerer,
- explicit interest makes the requester actionable/visible to the offerer,
- after explicit interest, the requester's normal profile avatar may be visible as part of the basic accountable profile while the saved-media gallery remains permission-gated,
- interest does not reserve capacity,
- requester-specific offers do not reserve capacity,
- successful acceptance atomically consumes capacity,
- groups consume required capacity together,
- unavailable movements normally leave general discovery rather than being publicly displayed as unavailable,
- network-size privacy must not rely on fabricated transactional activity,
- the offerer may request permission to view an interested requester's saved social media,
- the requester may allow or decline saved-media access,
- declining media access does not cancel interest,
- saved-media access does not create an offer, agreement, reservation, or activation,
- identity/security verification media is separate from ordinary saved social media and must never be exposed through social-media permission,
- ordinary saved social media is not automatically individually identity-verified.

Questions still requiring deliberate design include:

- exact backend representation of current movement availability/discoverability,
- exact privacy-safe movement card/data visible to browsing requesters,
- remaining exact fields contained in the basic accountable profile beyond the now-decided normal profile avatar and verified/accountability indicator,
- exact requester-interest state and data model,
- exact saved-media permission state/data model,
- which saved-media items become visible when permission is granted,
- whether V1 media permission is requester-to-offerer only in the UI or exposed reciprocally,
- exact transition from requester interest to the existing requester-specific offer machinery,
- what objective route-relationship information the requester sees,
- what objective route-relationship information the offerer sees,
- how long requester interest remains valid,
- how long saved-media permission remains valid,
- whether saved-media permission automatically ends when the movement interaction ends,
- how outstanding requester-specific offers expire,
- exact rules for stopping new discovery while preserving already-accepted agreements,
- minimum route-segment discovery UX for V1,
- exact operational pickup/drop-off negotiation and reveal timing,
- eventual automatic multi-leg recommendation behavior,
- richer social/reputation features,
- future non-offer movement social publication,
- future rules for primary profile imagery and deceptive/impersonating presentation,
- detailed economic/contribution model where not already formally specified elsewhere.

Add new unresolved questions here rather than silently making assumptions in code.

---

# 50. RULE FOR FUTURE AI / CODEX SESSIONS

Any AI or developer working on this repository should:

1. read this specification before making architectural changes,
2. distinguish constitutional product rules from current implementation limitations,
3. never infer intended product behavior solely from the present UI,
4. preserve existing security boundaries,
5. record important new decisions here,
6. record deferred work rather than silently forgetting it,
7. explicitly flag any proposed implementation that conflicts with this document.

If code and this specification disagree, investigate the disagreement.

Do not automatically assume the existing code represents the complete intended product.

---

# 51. IMPLEMENTATION AND DEPLOYMENT CHECKPOINT — 2026-10-08

## VERIFIED PRODUCTION STATE

Production Supabase project: `xdfmoggrsucisfybqctb`.

Migrations `0001` through `0091` have been deployed and recorded in production.

Latest completed milestone: **0091 — Pre-Departure Roster Freeze**.

GitHub repository: `appmeshach/myapp-backend`.

0091 was merged through PR #31, merge commit `e19b67f16ce572352f251ea5e118c3e115154159`.

GitHub CI passed after correcting checkout history with `fetch-depth: 0`.

Local validation included 1,866 passing Node tests, one skipped test, zero failed tests, TypeScript checks, PostgreSQL behavior tests, temporal tests, concurrency tests and regression tests.

Production verification confirmed:

- Migration 0091 recorded.
- Private roster-freeze table exists.
- Row Level Security enabled.
- No public policies on the roster-freeze table.
- Ordinary application roles cannot directly select from the table.
- No conflicting historical availability-backed started journeys at deployment.

**0091 rule:** The first authoritative offerer start request freezes admission to the parent movement availability. Previously accepted participants retain their movement arrangements, while remaining unused places are preserved accurately.

A successful migration deployment does not establish that full end-to-end multi-device testing has been completed.

Future sessions must independently inspect the repository and production state before declaring later milestones implemented.

---

# 52. OPEN PRE-LAUNCH PRODUCT DECISION — MEDIA ACCESS

## STATUS: PROPOSED, NOT FINALIZED, NOT IMPLEMENTED

**Feature:** Consent-Based Pre-Activation Media Access.

This proposal refines the existing media-permission principles documented in Sections 20, 26 and Decisions 029–035.

Proposed behavior:

1. An offerer independently declares movement and may discover eligible requesters through the Movement matching system.
2. The offerer may request permission to view a particular eligible requester's approved profile or voluntarily saved media before activation.
3. The requester may approve or decline that request.
4. Approval grants only the specific authorized access. Declining does not cancel movement interest or automatically reduce priority.
5. Requesters cannot view the offerer's identifying profile media before activation, but may see truthful account-verification status and permitted nonidentifying trust information.
6. After activation, both participants may view the approved profile media permitted by the agreed product rules.
7. Security verification documents, biometric evidence and liveness material must never be exposed through ordinary profile-media permission.
8. Movement deliberately accepts that an offerer who recognizes a requester may communicate outside the platform. This is a conscious product trade-off, not a security guarantee.

## UNRESOLVED QUESTIONS

The following require deliberate product review:

- Whether media requests are permitted before the requester explicitly expresses interest, and how that interacts with the existing visibility rule.
- Whether the existing basic profile avatar remains visible after interest or becomes permission-gated.
- Which exact media items are covered by approval.
- How long approval remains active.
- Whether and how access can be revoked.
- How repeated requests, misuse, unauthorized media URLs and caching are prevented.
- How media-access decisions interact with eligibility, discovery, activation and account safety.

## MANDATORY IMPLEMENTATION RESTRICTION

**Do not write code, design database migrations, commission Codex implementation, or change media-access policies based solely on this proposal.**

The project owner must explicitly finalize and authorize implementation.

Before that decision, inspect the existing media, discovery, identity and post-activation access systems to avoid duplicate functionality or contradictory authorization rules.

**PRE-LAUNCH REVIEW REQUIRED:** The proposal must be brought back for explicit consideration before V1 scope freeze. Review does not automatically mean implementation is mandatory.

---

# 53. MOVEMENT STARTUP COST LEDGER

## PERMANENT DEVELOPMENT REQUIREMENT

Every proposed external provider, API, hosting service, verification service, payment provider, mapping provider, messaging provider, analytics tool or paid infrastructure component must be classified as:

- **REQUIRED:** Necessary for safe or correct launch operation.
- **STRONGLY RECOMMENDED:** Materially improves reliability or usability but has a technically viable alternative.
- **OPTIONAL:** Can be deferred without compromising core launch safety or correctness.

For each item, record its purpose, when required, consequences of skipping it, billing model, verified current price when available, cheaper alternatives and scaling factors such as requests, users, movements, messages or verification checks.

## CURRENT WORKING INVENTORY

| Service or tool | Current position | Budget treatment |
|---|---|---|
| Supabase | Existing backend and production database | Essential existing infrastructure; verify plan, usage limits and current charges |
| GitHub | Existing source control and CI | Essential development workflow; no new paid tier justified |
| Expo / React Native | Existing mobile application framework | Continue using existing stack |
| Mapbox | Existing trusted location and routing integration | Review usage-based costs and launch thresholds |
| Payment provider | Production provider not finalized | Required before real-money launch; select against Nigerian payment requirements |
| Identity/face verification provider | Final production integration not established | Security-sensitive launch decision; compare providers and costs |
| Figma connection | Optional development integration | Useful for UI efficiency; not required for backend correctness |
| Codex Security | Not connected | Optional during development; reconsider during dedicated security audit |

This table is a planning inventory, not a verified current billing statement.

Avoid duplicating infrastructure or adding paid services solely for convenience.

Before launch, produce a dedicated budget covering minimum unavoidable costs, recommended costs, costs that can be deferred and projected scaling.

---

# 54. CONTINUITY AND PRE-LAUNCH REVIEW GATE

## AUTHORITATIVE SOURCES

Use this specification for established product intent, invariants and decision history.

Use current GitHub source, local working files, migration history, Supabase production state and verified tests for implementation truth.

**Do not treat an old implementation-status paragraph in this document as proof of current behavior.**

Sections 24–32 and 46–47 describe earlier development states and may now be historically outdated. Reconcile them against current implementation before planning further work; do not erase their original decision history.

## REQUIRED HANDOFF CONTENT

Future ChatGPT conversations and Codex sessions must preserve:

1. Current branch, baseline, merged commits and production migration status.
2. Last verified test results and any outstanding validation.
3. Current development milestone and next actionable step.
4. Constitutional product and security invariants.
5. Deferred capabilities and unresolved pre-launch decisions.
6. Startup cost ledger and pending provider selections.
7. Known unrelated/untracked files that must not be staged.
8. Exact deployment or security blockers.

## PRE-LAUNCH REVIEW REGISTER

Review the status of all earlier deferred capabilities, including:

- Automatic multi-leg movement chaining.
- Richer route-segment recommendations.
- Movement-based social and communication features.
- Profile/media consent and identity presentation.
- Reputation and relationship enhancements.
- Vehicle registration and accountable vehicle access.
- Payment-provider integration and money movement.
- Production-grade identity and face verification.
- Operational pickup/drop-off and coordination experience.
- Pricing and corridor calibration.
- Full end-to-end multi-account and device testing.
- Security hardening, recovery, privacy and abuse controls.
- Startup cost and provider budget.

These entries are review obligations, not claims that every feature is unimplemented or must ship in V1. Confirm current capability before assigning work.

## NO SILENT PRODUCT CHANGES

Do not silently convert a deferred proposal into an approved product decision.

Do not discard an established constitutional rule because an old UI does not support it.

Do not edit previously deployed migration files to introduce new behavior.

Do not introduce a paid service without explaining necessity and cost.

---

# END OF CANONICAL SPECIFICATION