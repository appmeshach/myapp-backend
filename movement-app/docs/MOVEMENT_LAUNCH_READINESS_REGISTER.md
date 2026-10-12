# Movement — Launch Readiness & Algorithm Dependency Register

Status: **0098 selected-availability route-match reuse locally verified; full user-flow audit remains in progress**. Updated 2026-10-11. Source of product authority: `docs/MOVEMENT_SYSTEM_SPEC.md`. Implementation evidence must be refreshed at every milestone.

## Purpose and evidence standard

This register prevents milestone drift. A SQL migration's existence proves only that a change was authored; "production installed" requires remote migration evidence, "behavior verified" requires relevant tests, and "end-to-end verified" requires real user-flow testing. Do not infer completeness from filenames or UI appearance.

0097 local verification: the service-only exact-current shared-segment assessment lookup and reuse-first one-pair orchestration pass focused SQL/runtime tests, genuine concurrency, both typechecks, full Node suites, 0096 concurrency regression, and a fresh disposable reset through 0097. Broad discovery, participant UI, provider generation, admission, and Priority v1 remain unchanged. Production remains verified only through migration 0091; 0097 is not deployed.

Statuses: **verified component**, **partially verified**, **requires inspection**, **deferred by decision**, **blocked**. Do not mark a full subsystem complete because one of its components passed.

## Verified checkpoint

- GitHub `main` merged PR #31 (0091), #32 (canonical specification), and #33 (approved media-access decision). PR #33 merge: `4aa3ec57865c618c1c5d844ffea1ca5a04737779`.
- Supabase production project `xdfmoggrsucisfybqctb`: migrations 0001–0091 reported installed; roster-freeze private table and RLS verified. Before deployment the availability-backed already-started count was zero; this was not an end-to-end journey test. **Production remains verified only through migration 0091.**
- 0091 portable CI and local PostgreSQL regression/concurrency work passed in its implementation checkpoint. See `docs/0091-pre-departure-roster-freeze.md` (its historical "candidate only" and git status sections are pre-merge snapshots).
- Current working branch `feature/0092-shared-segment-suitability` is a protected development worktree at `C:\Users\gt\Desktop\movement-0092-review\movement-app` and is not production deployed. Draft PR #35 is the recorded review context. Local base HEAD before 0097 work: `b7bdc9d1521e0b1365a50cf8abf5df8f2a8b15f7`.
- The requester-route-evidence foundation passed a fresh local reset through migration 0092 and a focused SQL regression of 24/24. This is NOT production deployed.
- 0092 work currently belongs to trusted requester-route / shared-segment eligibility evidence, not behavioural ranking.
- Current mobile inspection: `meetingJourneyService.ts`, `fundedCompletionService.ts`, `movementEndService.ts`, `movementDisputeService.ts` contain RPC calls. A name-specific search in `src/app` returned no direct usages; **indirect usage and full screen coverage have not been established**.

## DEVELOPMENT-BRANCH CHECKPOINT

- Protected worktree: `C:\Users\gt\Desktop\movement-0092-review\movement-app`
- Branch: `feature/0092-shared-segment-suitability`
- Draft PR #35
- Local base HEAD: `8783bb4 feat(matching): add requester route generation claim boundary` (external push state not refreshed)
- Requester-route-evidence foundation passed a fresh local reset through migration 0092 and focused SQL regression 24/24.
- This is NOT production deployed.
- 0092 work currently belongs to trusted requester-route / shared-segment eligibility evidence, not behavioural ranking.

## 0094 LOCAL COMPONENT CHECKPOINT

- Fresh local reset applied 0001-0094, including the final requester-generation context RPC. Installed 0094 and all seven 0093 function bodies/security settings match source. Historical 0001-0093 content matches HEAD modulo checkout line endings.
- 0094 SQL 26/26; 0094 genuine concurrency 9/9. Regressions: 0093 SQL 49/49 and genuine concurrency 16/16, 0092 24/24, 0032 56/56, 0033 29/29. Disposable harness application data/catalog/ACL/RLS/history fingerprints remain unchanged.
- Requester Node tests 86/86; offerer runtime/orchestration/provider plus two-route prototype 103/103. Full Node: 2,004 tests, 2,003 pass, one existing skip, zero failures. App and Edge typechecks pass.
- Requester provider generation is lazy per current need, JWT authenticated, uses the existing shared quota and one claimed provider attempt with exact publication replay. Reference-path non-overlap alone is not definitive incompatibility. See [0094 implementation and cost ledger](0094-requester-route-provider-generation.md).
- Mobile UI wiring, trusted shared-segment assessment and admission integration remain deferred. No production/provider/deployment action was performed; production verification remains through 0091.

## 0095 REQUESTER DEADLINE REPAIR

- Forward repair of the lost 0052 requester departure guards in the complete 0091 matching context; initial and final database wall-clock checks preserve the effective latest-or-earliest deadline.
- Final fresh reset applied 0001?0095 (exit 0); 0095 SQL 13/13 and genuine deadline concurrency 7/7, original 0052 25/25. Full Node: 2,009 tests, 2,008 pass, one existing skip, zero failures; both typechecks pass. Historical 0001?0094 content remains unchanged.
- Local validation results are recorded in [0095 repair evidence](0095-requester-deadline-matching-context-repair.md). Production verification remains through 0091; no deployment is implied.
- Shared-segment assessment is not implemented by this repair. It remains the next milestone, expected as 0096; discovery/admission integration is separately reviewed.

## 0098 CURRENT ROUTE-MATCH REUSE CHECKPOINT

- Baseline `3a09bb914cf9e16c36e34311329fdc9feedca94f` on `feature/0092-shared-segment-suitability`; work remains unstaged and uncommitted. Production verification remains through 0091.
- Service-only exact current lookup and selected-availability publication revalidation preserve 0046 authorization and the effective 0082 writer. Repeat hits perform zero geometry and zero publication. Uncertain writes recover only the complete frozen canonical payload, including calculatedAt; concurrent current-use convergence retains the winning row's timestamp.
- Focused SQL security 5/5, SQL behavior 22/22, real SQL-backed HTTP 5/5, genuine 0098 concurrency 6/6 with zero deadlocks, route runtime/orchestration 74/74. Full Supabase Node 1,193/1,193; root 956 passed with one existing skip. App/Edge typechecks and a fresh disposable reset through all 98 migrations pass. Original local application fingerprints and historical migrations remain unchanged.
- Evidence and regression details: [0098 implementation and validation](0098-current-route-match-reuse-boundary.md). This verifies the route-match component, not a deployed or device-tested complete requester flow.
- Requester geographic-support UI, 0094 app wiring, 0097 app invocation and a geographic-support endpoint remain deferred. Discovery, Priority v1, explicit interest, acceptance/admission, roster/capacity and financial semantics are unchanged. New vendor/provider usage: NONE; classified REQUIRED before geographic-support integration.

## 0099 PRIVATE JOB / WORKER DEVELOPMENT CHECKPOINT

- Baseline `e5fda80`; private foundation only. Production remains verified through
  0091. No production host is selected or deployed.
- Service-only selected registration is reuse-first; private canonical jobs use
  bounded attempts, lease tokens and current-context fencing. Isolated Node compute
  imports the frozen 0096 engine. Selected validation and trusted publication are
  atomic with completion; runtime failure never becomes immutable geometry evidence.
- Local evidence is recorded in [0099 foundation](0099-shared-segment-assessment-job-foundation.md).
  Target-host CPU/memory/lease validation remains blocked on future hosting selection.
- Participant-facing requester integration belongs to 0100. No UI, provider,
  discovery fanout, interest, priority, admission, roster/capacity or money change.

## 0100 REQUESTER SELECTED GEOGRAPHIC SUPPORT — LOCAL CHECKPOINT

- Baseline `1d141a6`; requester selected-card annotation and authenticated endpoint
  are implemented locally. Production remains verified only through 0091.
- Unchanged 0094 generation follows selected authorization; exact 0097 assessment
  hits return coarse results, and misses register/reuse existing private 0099 jobs.
  Edge never executes cold shared-segment geometry. No 0100 migration is needed.
- Route-match results and interest remain immediately usable while geographic work
  is pending or unavailable. Explicit manual refresh replaces automatic polling.
  Discovery, offerer activity, priority, roster/capacity, admission and finance keep
  their existing semantics.
- Evidence and cost classifications: [0100 integration](0100-requester-geographic-support-integration.md).
  Production activation requires worker host selection and target-host benchmarks;
  neither is complete. Offerer annotation and admission work remain deferred.

## Matching and cascading algorithm — highest-priority audit

| Required capability / constitutional rule | Evidence already inspected | Status | Next proof needed |
|---|---|---|---|
| Independently intended journeys, no fabricated demand-led trips | Canonical §§2–4; 0089/0090 preserve eligibility-before-priority | Partially verified | Inspect actual producer, route, offer, eligibility RPCs and abuse tests |
| Offer-first and request-first discovery | Canonical §3; 0089 offers list and 0090 requester discovery functions | Partially verified | Trace all producers/consumers and discovery state transitions |
| Trusted same-state and route evidence | Canonical §§6–16, location chain; earlier migrations described in canonical history | Requires inspection | Verify actual GIS/corridor geometry, state boundaries, evidence expiry and current tests |
| Corridor overlap, useful partial route segments, correct direction/time | Canonical §§6,7,10,33–34 | Requires inspection | Inspect latest matching function bodies and real segment-selection tests; distinguish proximity from corridor overlap |
| No universal maximum detour rule | Canonical §11 | Requires inspection | Test actual eligibility criteria do not silently impose universal detour threshold |
| Candidate priority both directions | 0089 `movement_priority_v1` (completed, reputation, waiting weighted by context), 0090 requester-offer ranking; evidence includes authoritative completion/reputation/waiting inputs and offerer-first original-seat policies | VERIFIED COMPONENTS | Preserve eligibility-before-ranking as 0092 geographic suitability is added; ensure no route micro-fit becomes an unintended ranking boost; later verify outcome measurement/group recommendation separately |
| Priority-engine constitutional specification | Canonical §23A; 0089/0090 implementation history | FROZEN V1 PRODUCT CONTRACT / VERIFIED IMPLEMENTED CORE | Keep deferred group recommendation, mutual reservation, controlled media and future REVIEW distinct from deployed ranking |
| Shared-segment geographic eligibility | 0092 contract/prototype; requester-route-evidence foundation commit `45e1882` | IN DEVELOPMENT / NOT PRODUCTION DEPLOYED | 0093 claim and 0094 provider generation locally verified; mobile invocation, trusted two-route comparison and later admission integration remain deferred; full user-flow proof still needed |
| Mutual-selection pre-activation reservation | Approved Priority Engine design only | DEFERRED / NOT DEPLOYED | Exact lifecycle integration; bilateral mutual choice; capacity concurrency/lock ordering; up-to-10-minute expiry/release; no pre-activation fee; conflict-pool exclusion |
| Seat capacity, group all-or-none, concurrency | Canonical §§18–19; 0091 preserves unused places and accepted siblings | Partially verified | Verify acceptance and group-ready tests end-to-end, capacity under race |
| Departure admission freeze | 0091 production installed, PostgreSQL concurrency tests | Verified component; no production E2E | Validate real user activation/start/discovery closure, accepted sibling continuation |
| Chaining with ordinary transport and multiple matched legs | Canonical §§8–9, Decisions 014–017 | **Deferred by decision** (architecture must allow it) | Define minimal v1 manual handoff vs future automatic chaining; no premature automation |
| Privacy during discovery and media permissions | Canonical §§12–16,20,35,52 | Partially verified / media implementation deferred | Verify actual RPC columns, authorized media and masking; review post-activation automatic profile access |

**Milestone rule:** Complete this algorithm inventory before choosing the scope of 0092. A missing screen is a candidate gap, not evidence that UI integration must be next.

## Launch-capability register (initial, not a comprehensive code audit)

| Subsystem | Status now | Launch acceptance evidence still required |
|---|---|---|
| Core matching, cascading and priority | Partially verified; priority core implemented, geographic shared-segment eligibility remains under active 0092 work, automatic chaining deferred | Bidirectional matching, segment/time/state/privacy/race tests, user flows; preserve eligibility-before-ranking while 0092 suitability evidence is added |
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
