# 0114J implementation-plan review

reviewerReference: Codex-0114J-plan-critical-review

reviewedCommit: `ce75e131b240d209f7b5519c7b8f64b12e062cb5`

reviewedBranch: `feature/0092-shared-segment-suitability`

reviewedArtifact: [0114J implementation plan](0114j-qualification-lifecycle-implementation-plan.md)

outcome: PLAN_CHANGES_REQUIRED_BEFORE_IMPLEMENTATION_AUTHORIZATION

separateImplementationAuthorizationMayBeRequested: false

implementationAuthorized: false

This is a separate critical review pass by the same Codex assistant that authored
the plan and earlier design/reviews. It is not independent human approval or proof
of independence from the author. The reference identifies this review pass only;
it is not AT or a lifecycle operator/reviewer attestation.

## Scope, evidence and disposition

Reviewed the committed plan against the corrected design and both earlier review
records, current/safe 0114E packages, 0114E procedure, 0114D wrapper description,
reviewed 0114H design/implementation, readiness register, current authorization,
wrapper, identity, target and HTTPS adapter sources, and relevant 0110-0114 tests
and fixture loaders. The request names qualification-railway-private-https-adapter.cjs;
the actual repository file is qualification-railway-https-adapter.cjs, which was
inspected. No substitute production file or file modification is inferred.

Two blocking plan defects remain: an unestablished executable launch/main-module
assumption (R1) and a missing final time check after blocking identity validation
(R2). Stop at correction/review; do not proceed to implementation authorization.
These findings do not reopen the reviewed B1 policy invariant or require durable
coordination. The design remains approved for planning within its stated trust scope;
this particular implementation plan is not approved.

## Mandatory 60-point checklist

YES means the stated design/plan direction is acceptable for that point, not that
future code already enforces it. NEEDS_CHANGE entries reference blocking findings.
Existing authority-boundary ordering can be sound while its temporal guard is not.

| # | Point | Result | Basis |
| --- | --- | --- | --- |
| 1 | Exact runtime scope sufficient | YES | Three files can implement the changes; no fourth file demonstrated necessary. |
| 2 | Protected runtime files correctly preserved | YES | Target syntax and transport can stay unchanged. |
| 3 | Owner-domain strategy enforceable | NEEDS_CHANGE | R1: actual supported launch domain not established. |
| 4 | require.main assumption established | NEEDS_CHANGE | R1: no acquisition launcher proves it. |
| 5 | require.cache identity safe enough | YES | Useful identity check under trusted loader, not a stand-alone singleton proof. |
| 6 | Children-graph strategy safe enough | NEEDS_CHANGE | R1: unverified launch/root and reload-graph contract. |
| 7 | Duplicate owner/reload prevention sufficient | NEEDS_CHANGE | R1: prescribed topology lacks an established supported host. |
| 8 | Unsupported VM/worker route denied | YES | Explicit requirement; tests must demonstrate denial. |
| 9 | No public global registry needed | YES | No evidence one is needed. |
| 10 | Carrier created early enough | YES | At claim before capability publication. |
| 11 | Carrier ownership unambiguous | YES | Authorization owns it. |
| 12 | Transfer-to-wrapper safe | YES | Fixed private continuation inside owner protection. |
| 13 | Pre-run-handle failure closes | YES | Owner retains obligation before continuation/handle creation. |
| 14 | Cancellation-only API safe | YES | Original draft only; reduces authority. |
| 15 | State closes before cleanup | YES | Idempotent mark-first rule. |
| 16 | Clock order deterministic | NEEDS_CHANGE | R2: time precedes potentially blocking revalidation without final sampling. |
| 17 | High-water fail-closed | YES | Retained across cleanup, rollback latches failure. |
| 18 | Monotonic deadline cannot extend | YES | Original deadline retained. |
| 19 | Expiry timer semantics safe | YES | Earlier deadline and idempotent closure; timer alone cannot close R2. |
| 20 | Delayed-callback semantics safe | NEEDS_CHANGE | R2: synchronous validation can outlast expiry before timer runs. |
| 21 | Post-cleanup rollback blocked | YES | High-water retained; strict expiry precedes lookup. |
| 22 | 64-entry limit acceptable | YES | Conservative manual-workflow cap. |
| 23 | 16-KiB limits acceptable | YES | Both raw and canonical checked independently. |
| 24 | Capacity exhaustion fail-closed | YES | Reject after lazy cleanup. |
| 25 | No live-marker eviction | YES | Claimed and closed count until expiry. |
| 26 | Schema versions coherent | YES | v3 input/v4 executable/v1 activation. |
| 27 | lifecycleReview descriptor unambiguous | YES | Exactly path/sha256, null safe form rejected. |
| 28 | Subject digest unambiguous | YES | Excludes only lifecycleReview. |
| 29 | Activation schema unambiguous | YES | Root/nested key sets and predicate binding specified; minor type/cardinality notes below. |
| 30 | Operator/reviewer distinction preserved | YES | Structural distinct references plus human evidence boundary. |
| 31 | Nullable instance preserved | YES | Existing exact conditional expectation remains. |
| 32 | Evidence/path restrictions sufficient | YES | Allowlist/realpath boundary; Windows edge-case coverage noted below. |
| 33 | Policy digest binding sufficient | YES | Compiled reviewed-document digest and current bytes both checked. |
| 34 | Admission table sufficient | YES | Owner-bound claimed/closed with retained markers. |
| 35 | Reverse index sufficient | YES | Reference conflict rejects, never grants authority. |
| 36 | Collision handling sufficient | YES | Canonical-byte/binding comparison, no alternate bucket. |
| 37 | Duplicate preserves first graph | YES | Explicit separation from original-graph terminals. |
| 38 | Cleanup cannot rearm | YES | UTC expiry required before removal; no reset. |
| 39 | Claim point safe | YES | Passive validation then synchronous claim before capabilities. |
| 40 | Credential-read boundary preserved | YES | Only guarded context open; R2 still affects temporal validity of that guard. |
| 41 | Context-open boundary preserved | YES | After target-permit consumption; R2 applies to freshness. |
| 42 | Three requests preserved | YES | Fixed 1/2/3 sequence. |
| 43 | Both human gates preserved | YES | Service and final target gates. |
| 44 | Same context/session preserved | YES | Same original private graph. |
| 45 | Closure before result safe | NEEDS_CHANGE | R2: final validity after potentially blocking close is not specified. |
| 46 | Legacy v3 bypass blocked | YES | Strict v4-only cutover requirement; no separate legacy executable pool. |
| 47 | v2 package rejected | YES | New intake rejects old schema. |
| 48 | 0113 continuation blocked | YES | Context-only sessions lack acquisition authority. |
| 49 | Source-pin impact complete | YES | Two changed pinned files plus separate authorization self hash. |
| 50 | Pin count twelve | YES | Authorization is not one of the twelve source entries. |
| 51 | Current package unchanged | YES | Real v2 incomplete package explicitly preserved. |
| 52 | Templates inert | YES | Null/unreviewed/false defaults cannot pass executable intake. |
| 53 | Historical evidence/hashes preserved | YES | Archived contexts retained. |
| 54 | Focused test inventory coherent | YES | Eleven existing suites plus one new suite. |
| 55 | Regression inventory coherent | YES | Nineteen separate existing paths; 0109/0110 are distinct raw lines. |
| 56 | Loopback boundary explicit | YES | Requires future explicit permission; no permission now. |
| 57 | No external/provider network needed | YES | Fake transports/local validation only. |
| 58 | Migrations untouched | YES | No schema/database dependency. |
| 59 | Fail-closed behavior sufficient | NEEDS_CHANGE | R1/R2 block overall acceptance. |
| 60 | No unresolved architectural choice | NEEDS_CHANGE | R1 launch contract and R2 final-guard placement must be resolved in plan. |

## Blocking findings and smallest corrections

### R1. Owner guard depends on an unestablished acquisition launch contract

Plan section: "A. Production owner-loading domain", especially lines 97-120 and
131-137; "Focused future test matrix", owner-domain row.

The plan requires a genuine cached require.main and makes its children graph a
security gate, but identifies no concrete supported acquisition launcher/import
contract that guarantees this root. The normal worker start in
scripts/assessment-worker/package.json is node run.cjs. That file runs the polling
assessment worker, not the Railway acquisition wrapper. It therefore does not prove
the acquisition launch assumption. Current acquisition is a programmatic module API;
the inspected normal-import tests also use node -e (0114D import-order and 0114B
initialization cases), a mode without the ordinary CommonJS main-file root. Those
tests exercise import sealing, not successful admission. They cannot establish the
new admission host merely by being changed to simulated fixture metadata.

Failure mode: a legitimate intended programmatic caller could be rejected for a
missing root or unsupported parent graph, while a future coding agent must decide
which launch forms are actually supported. The plan's blanket cache/children audit
could also treat legitimate circular/shared-module references or main-module ID
conventions as an identity mismatch unless those cases are specified. Cache equality
and frozen exports alone do not prove duplicate-instance rejection; graph topology
is meaningful only against an established supported loading contract. This is not
a demonstrated hostile-loader exploit; it is the explicit unverified-launch stop
condition in this review task.

Smallest correction: specify the exact supported acquisition host invocation and
its import/main/cache contract, or remove dependence on an unestablished main root
using a precise reviewed private-owner anchor. Do not add a public global registry.
State which existing node -e/ESM/test-host modes remain import-only versus supported
for admission, and why the selected host is operationally usable. Define real Module
identity rules including main ID conventions, cycles/shared children and stale
references. Add zero-credential/offline genuine CommonJS host tests proving both
accepted admission through that host and rejected reload/duplicate/replacement routes;
test fixture emulation alone is insufficient. Record any necessary launcher/file
scope change explicitly before authorizing implementation. This review does not
choose or implement a replacement architecture.

### R2. Time validation precedes blocking work without a final fence

Plan sections: "C. Clock and expiry algorithm", steps 1-5, particularly lines
188-211; "Ordered end-to-end sequence", steps 9-15.

Step 5 checks UTC/monotonic deadlines and THEN re-reads bound code/input/record/
evidence identities. The existing verifyCodeIdentity performs synchronous Git
subprocesses (5000 ms timeout each) and source reads; verifyAcquisition also reads
input/evidence. A guard can therefore enter before expiry, block across expiry,
finish successful identity validation, and dispatch/open context afterward. The
event loop cannot run the expiry timer while those synchronous calls block.
Calling that guard "immediately before" adapter execution does not make its initial
time sample fresh at the actual side-effect boundary.

Concrete counterexample: 50 ms remain, identity/file validation takes 100 ms, every
digest still matches, and the next synchronous statement sends request 2. Neither
the old time sample nor a delayed timer prevents the expired request. The same
ordering matters for credential-bearing context opening, response/human acceptance
and ticket/permit issuance. Completion additionally closes resources before releasing
the result; a slow close can cross expiry, while the plan only says time checks
"passed" and the normal carrier check rejects closed state.

Smallest correction: separate potentially blocking domain/code/file validation from
a final pure deadline/state fence. After ALL such work, sample UTC/monotonic again,
apply high-water/expiry and original ownership, and perform the next bounded
side-effect without intervening I/O, await or caller hooks. Reuse that exact order at
claim, authority issuance/redemption, credential/context boundary, every dispatch,
observation/human acceptance and result release. Specify a validity-only final check
after successful terminal cleanup that can reject a late result without reopening
the closed claim. Keep prior burn-before-validation and close-on-expiry rules.
Add fake-clock cases where synchronous Git/file/domain checks and cleanup advance
time past expiry while timer callbacks are deliberately withheld; assert zero new
credential reads/requests/acceptance/results after that boundary. No timer-only fix
or longer expiry is sufficient or requested.

## Findings A-M

| Area | Assessment |
| --- | --- |
| A. Exact scope | Three runtime files can carry the proposed responsibility. Introspection-target need not change; actual HTTPS adapter can stay unchanged if R2 is corrected before dispatch/context/acceptance. No omitted runtime file is proven necessary yet; R1 must explicitly settle any host-scope implication. |
| B. Owner domain | Not accepted as written: R1. Current require.cache/literal-owner checks are useful; the new main-root/graph admission assumptions lack demonstrated acquisition-host support. No simpler complete replacement is silently selected here. |
| C. Carrier | Accepted: original carrier at claim, fixed private continuation, one-use run attachment, owner-protected transfer and mark-before-cleanup cover pre-handle failures. Public draft cancellation only reduces authority and cannot recover a carrier. |
| D. Clocks | Not accepted end-to-end: R2. High-water retention, immutable monotonic deadline, early/delayed timers, min-deadline rules and UTC-required marker retention are otherwise coherent. Capture finite nonnegative monotonic time and check finite deadline arithmetic in implementation tests. |
| E. Capacity | Accept 64/16KiB/non-configurable constants. Canonical serialization can differ from raw size, so both independent caps matter. 1 MiB bounds retained canonical payload only, correctly not total RSS. Invalid pre-claim inputs cannot consume markers; 64 genuine admitted inputs may exhaust capacity by design. Closed entries count until UTC expiry; lazy cleanup precedes capacity check. |
| F. Schema | Accept version/key/subject/policy binding direction. Distinct reference strings are structural checks, not proof of different humans. Bounded local evidence allowlist avoids discovery; no self-hash cycle is required. Record path edge-case and schema cardinality notes below. |
| G. Admission | Accept claimed/closed and reverse-index model. Canonical-byte mismatch never opens an alternate bucket; duplicates cannot close the first graph. Live capabilities are not reconstructed from markers. Closed compaction and fresh-review reuse preserve B1 at design level, subject to R1 implementation-domain correction. |
| H. Execution | Structural order preserves passive checks, claim, private review/authorization, ticket/permit burn, guarded context, requests 1/2/gate/3/gate and close-before-result. R2 prevents acceptance of its temporal safety as currently ordered. |
| I. Legacy | Accept strict v4-only cutover and v2 input rejection. Existing planning/context APIs remain limited; one-argument 0113 sessions cannot acquire name/permit authority. No concrete legacy bypass was identified that requires another runtime file. Future code still must prove rejection, not merely version labels. |
| J. Pins | Accept: current SOURCE_HASHES has twelve entries, including wrapper/identity but excluding authorization. Those two pins plus the separate authorization self hash change; ten remain. Template/fixture/document digests are not source pins. No future hash calculated. |
| K. Inert data | Accept: current actual package remains unchanged v2/null/incomplete and is rejected; safe v3/v4/v1 templates retain null/unreviewed/false defaults. Historical evidence/hashes are not refreshed. |
| L. Tests | Eleven existing suites are 0110,0111,0112,0113,0114A,B,C,D,E,F,H; plus new 0114J is twelve. Nineteen regression paths are distinct in committed raw Markdown; 0109 and 0110 are separate items, so adjacent rendering is not an ambiguous shell argument defect. Matrix needs R1 genuine-host and R2 blocking-work/final-fence cases before approval. Case-count estimate is not an acceptance guarantee. |
| M. Network | Future loopback-only permission is a reasonable separate validation scope. External/provider access remains forbidden; fake transports and destination restrictions must fail closed rather than fall back. If loopback permission is absent, full regression acceptance stops. No loopback server, provider action or network permission is granted by this review. |

## Nonblocking notes

1. Cleanup prose says "OR original monotonic deadline" and immediately overrides
   that with UTC-required marker retention. The latter is safe and explicit; make
   the closed-state versus marker-removal distinction clearer in the corrected plan.
2. Include Windows/POSIX filename cases in path tests: drive-relative paths, colon/
   alternate streams, reserved device names, trailing dots/spaces and symlink/realpath
   boundaries. No demonstrated escape is asserted here; do not rely on basename or
   startsWith alone. The existing no-escape/regular-file requirement must hold.
3. Make allocationEvidence minimum cardinality and all array/Boolean/reference field
   types explicit in the executable schema table; preserve human-reviewed truth
   boundaries. Numeric size preferences alone are not a blocker.
4. Keep raw and canonical length boundary cases separate and validate finite deadline
   arithmetic. performance.now's trusted per-process origin must not be confused with
   a restartable injected production clock.

## Preservation, next step and authority limits

The plan is unchanged; substantive corrections are recorded here only. Corrected
design and historical reviews remain unchanged. Current package lifecycle stays
null; qualification evidence, runtime/tests, templates and migrations are unchanged.
Only this review and the readiness-register outcome are written. No tests, typechecks,
subprocess probes of launch behavior or loopback servers were run; conclusions use
local source/launch/test inspection. Git whitespace/status/HEAD checks and requested
protected-path diffs verify the review-only scope. Index and HEAD remain unchanged.

Next milestone: separately authorized narrow implementation-plan correction for R1/R2,
followed by renewed plan review. Separate implementation authorization may not yet
be requested on the basis of this plan. No runtime implementation, lifecycle promotion,
package completion, provider observation/configuration, deployment, restart, 0114D
preparation, live acquisition, external/loopback network, credentials/secrets/capsule
access, staging, commit or push authority is granted.
