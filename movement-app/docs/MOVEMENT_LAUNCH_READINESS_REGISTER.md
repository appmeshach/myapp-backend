# Movement — Launch Readiness & Algorithm Dependency Register

Status: **audit in progress; planning artifact, not approval of migration 0092**. Updated 2026-10-08. Source of product authority: `docs/MOVEMENT_SYSTEM_SPEC.md`. Implementation evidence must be refreshed at every milestone.

## Purpose and evidence standard

This register prevents milestone drift. A SQL migration's existence proves only that a change was authored; "production installed" requires remote migration evidence, "behavior verified" requires relevant tests, and "end-to-end verified" requires real user-flow testing. Do not infer completeness from filenames or UI appearance.

Statuses: **verified component**, **partially verified**, **requires inspection**, **deferred by decision**, **blocked**. Do not mark a full subsystem complete because one of its components passed.

## Verified checkpoint

- GitHub `main` merged PR #31 (0091), #32 (canonical specification), and #33 (approved media-access decision). PR #33 merge: `4aa3ec57865c618c1c5d844ffea1ca5a04737779`.
- Supabase production project `xdfmoggrsucisfybqctb`: migrations 0001–0091 reported installed; roster-freeze private table and RLS verified. Before deployment the availability-backed already-started count was zero; this was not an end-to-end journey test.
- 0091 portable CI and local PostgreSQL regression/concurrency work passed in its implementation checkpoint. See `docs/0091-pre-departure-roster-freeze.md` (its historical "candidate only" and git status sections are pre-merge snapshots).
- Current working branch `feature/0092-movement-lifecycle-continuation` was locally created from `origin/main`; **the number 0092 and its scope remain unassigned**.
- Current mobile inspection: `meetingJourneyService.ts`, `fundedCompletionService.ts`, `movementEndService.ts`, `movementDisputeService.ts` contain RPC calls. A name-specific search in `src/app` returned no direct usages; **indirect usage and full screen coverage have not been established**.

## Matching and cascading algorithm — highest-priority audit

| Required capability / constitutional rule | Evidence already inspected | Status | Next proof needed |
|---|---|---|---|
| Independently intended journeys, no fabricated demand-led trips | Canonical §§2–4; 0089/0090 preserve eligibility-before-priority | Partially verified | Inspect actual producer, route, offer, eligibility RPCs and abuse tests |
| Offer-first and request-first discovery | Canonical §3; 0089 offers list and 0090 requester discovery functions | Partially verified | Trace all producers/consumers and discovery state transitions |
| Trusted same-state and route evidence | Canonical §§6–16, location chain; earlier migrations described in canonical history | Requires inspection | Verify actual GIS/corridor geometry, state boundaries, evidence expiry and current tests |
| Corridor overlap, useful partial route segments, correct direction/time | Canonical §§6,7,10,33–34 | Requires inspection | Inspect latest matching function bodies and real segment-selection tests; distinguish proximity from corridor overlap |
| No universal maximum detour rule | Canonical §11 | Requires inspection | Test actual eligibility criteria do not silently impose universal detour threshold |
| Candidate priority both directions | 0089 `movement_priority_v1` (completed, reputation, waiting weighted by context), 0090 requester-offer ranking | Verified components, not complete algorithm | Verify deterministic ranking, tie-breaks, eligibility after ranking, stale evidence, priority fairness and offerer-side behavior |
| Seat capacity, group all-or-none, concurrency | Canonical §§18–19; 0091 preserves unused places and accepted siblings | Partially verified | Verify acceptance and group-ready tests end-to-end, capacity under race |
| Departure admission freeze | 0091 production installed, PostgreSQL concurrency tests | Verified component; no production E2E | Validate real user activation/start/discovery closure, accepted sibling continuation |
| Chaining with ordinary transport and multiple matched legs | Canonical §§8–9, Decisions 014–017 | **Deferred by decision** (architecture must allow it) | Define minimal v1 manual handoff vs future automatic chaining; no premature automation |
| Privacy during discovery and media permissions | Canonical §§12–16,20,35,52 | Partially verified / media implementation deferred | Verify actual RPC columns, authorized media and masking; review post-activation automatic profile access |

**Milestone rule:** Complete this algorithm inventory before choosing the scope of 0092. A missing screen is a candidate gap, not evidence that UI integration must be next.

## Launch-capability register (initial, not a comprehensive code audit)

| Subsystem | Status now | Launch acceptance evidence still required |
|---|---|---|
| Core matching, cascading and priority | Partially verified | Bidirectional matching, segment/time/state/privacy/race tests, user flows |
| Offer/need creation and acceptance | Requires full current inspection | Authenticated end-to-end flow, trusted route and capacity enforcement |
| Activation, coordination, start, completion, recovery | Implemented backend components (0079–0088,0091); UI unknown | Service-screen mapping, two-account device runs, safe interruption/recovery |
| Pricing and financial custody | Backend component tests; provider launch status unknown | Pricing anchors and 70/30 economics, funded settlement, provider integration, reconciliation |
| Identity, vehicle access and user safety | Requires inspection | Provider choice and threat model, no vehicle legal-title requirement, verification abuse tests |
| Social chat and media | Product direction approved; exact implementation unknown | Access controls and privacy, account blocks, chat; post-activation ordinary profile media mutual/automatic |
| Mobile experience | Requires inspection | Actual route through offer-first and request-first paths; error states, notifications, accessibility |
| Reliability and operations | Partially verified (CI, production migration controls) | Monitoring, rollback/recovery, backups, incident procedures, rate limits |
| Geography and payments in Lagos | Requires inspection | Same-state, representative Lagos route tests, local provider settlement |
| Launch budget and vendor dependencies | Planning ledger in canonical §53 | Required/strongly recommended/optional, actual verified costs, traffic-based forecasts |

## Approved media behavior and deferred design

Offerer may request requester profile/saved media before activation, including at discovery, subject to requester approval or decline without priority penalty. Requester cannot view offerer ordinary profile media pre-activation; truthful nonidentifying trust status may show. **After activation ordinary offerer and requester profile media is mutually visible automatically without approval.** Verification, biometric and other security evidence always excluded. Details of revocation, suspension, post-completion duration, signed URLs, cache and misuse protection need explicit security design. This product decision is approved, **code intentionally deferred**.

## Startup cost discipline

For every provider or paid dependency record necessity (required / strongly recommended / optional), operational consequence if skipped, validated price, billing unit, projected usage, and lower-cost alternative. Existing Supabase, GitHub, Expo infrastructure should be reused; mapping usage, payment processors, identity checks, messaging and observability need audited spend. Codex Security optional until pre-launch audit; no paid addition for polish.

## Milestone-selection gate (mandatory)

At the end of each milestone:
1. Record exact evidence: files, commits, migration history, CI, local tests, live verification, missing E2E.
2. Update each register row and explicitly retain deferred items.
3. List unmet launch criteria and their dependency ordering; prioritize safety/route correctness and core flow before visual polish.
4. Select one next milestone with a named user-visible or safety outcome, proof it is missing, prerequisites, test plan and cost implications.
5. Do not implement or deploy on the basis of this register alone; inspect latest files and get the exact code before edits.
6. Preserve unrelated local untracked files and never edit deployed migration history.

## Next audit work — no new migration yet

1. Trace latest SQL producer → trusted route/evidence → availability → offer/request matching → admission → acceptance → start roster closure; gather function identities, tests and latest replacement versions.
2. Verify priority behavior in both directions, and segment/time/direction/same-state constraints.
3. Map service functions to hooks and actual React Native screens (a direct-name search is insufficient).
4. Publish a capability matrix with **verified / partial / missing / deferred** backed by exact code/tests; then assign 0092 with justified dependency order.

**This is an initial roadmap scaffold and auditable work queue, not a claim of a completed system-wide implementation audit.**
