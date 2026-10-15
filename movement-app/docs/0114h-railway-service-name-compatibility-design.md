# 0114H Railway service-name compatibility design

Status: DESIGN_COMPLETE_IMPLEMENTATION_NOT_AUTHORIZED. Offline documentation only.
Starting HEAD: 6958bee9713e69643267e45efe7122d5857dc751.
Branch: feature/0092-shared-segment-suitability.

No runtime implementation, executable acquisition preparation, provider access,
Railway configuration change, pending-source application, deployment or restart is
authorized by this document. A design is not independent package approval or live
authorization. Existing qualification completeness and authority flags stay false.

## Finding and current ownership

0114G found RUNTIME_NAME_DEPENDENCY_FOUND. The current implementation fails closed
for the new qualification service; it does not silently select that service by ID.
The incompatible boundary is a universal production-name expectation, not a missing
GraphQL name variable. Do not remove either equality check to resolve it.

All source line references below describe the starting HEAD.

| Boundary | Current ownership and behavior |
| --- | --- |
| Identity expectations | scripts/assessment-worker/qualification-railway-target-identity.cjs:30 fixes serviceName to myapp-backend; line 31 says labelsAuthoritative=false. That label disclaimer does not disable mandatory name acceptance checks. |
| Session | The same file:74-79 stores the opaque target binding, without a separately reviewed expected name. inspectSession:86 displays the global expectations. |
| Services | Lines 92-108 require a complete, bounded, single services connection, validate every edge, reject duplicate IDs/names, and select an exact match against the global name. acceptIdentityObservation:251-252 separately requires the selected ID to equal the bound serviceId. |
| Instance | Lines 110-117 require the same global service name and retain root/region rules. Lines 254-255 also enforce any non-null expected instance ID. |
| Human service review | Lines 269-293 display expected/observed service IDs and names, retain original session/context/observation ownership and revision, and require an exact original acknowledgement. |
| Final target review | Lines 257-262 retain serviceNameExpected/serviceNameObserved with IDs. Lines 314-328 bind the canonical candidate digest, exact candidate, reviewed inventory and disposable/non-production acknowledgement. |
| Planning package | scripts/assessment-worker/qualification-railway-live-authorization.cjs:235-265 copies the global name into expectedTarget.serviceName, freezes the manifest, and compares its canonical digest and exact acknowledgement. This v1 namespace is planning-only. |
| Executable package | The same file:285-318 copies identity.reviewTemplate().expectations into expectedTarget.expectations. Thus v2 already indirectly binds serviceName through its canonical manifest digest. It binds the hardcoded name, not the reviewed qualification name. |
| Authorization | Lines 302-327 bind manifest/code/host digests and reviewed HEAD/branch in the final manual acknowledgement, with code identity rechecks and one-shot ticket issuance. |
| Private handoff | Lines 329-335 redeem the original ticket only into the literal acquisition wrapper. They pass privateTarget, contextHandoff, inventoryReview and executionPolicy, but no separate reviewed service-name expectation. |
| Acquisition owner | scripts/assessment-worker/qualification-railway-acquisition-wrapper.cjs:90-107 starts identity.startTargetIdentitySession(e.target) and opens one context. Lines 123-139 preserve the two original human review gates. It never accepts a caller name override. |
| Early adapter validation | scripts/assessment-worker/qualification-railway-https-adapter.cjs:349-350 invokes the identity validator and checks serviceId; lines 449-450 invoke the instance validator and check optional instance ID. Final identity-owner acceptance repeats validation. |
| Queries | Identity source:193-204 and adapter:290-296,381-388 use project ID, then service/environment IDs. serviceName is a response field only. These queries and their hashes need no name-compatibility change. |
| Legacy target | scripts/assessment-worker/qualification-railway-introspection-target.cjs:13-36 binds exact IDs, disposable/active constraints and inventory. It does not carry serviceName. Extending that shared legacy schema is unnecessary for this design. |

The reviewed name does already exist as data in
docs/0114e-qualification-target-evidence.json, particularly
qualificationReview.reviewedContext.serviceName alongside the exact three IDs.
That scoped review is by AT, result NO_MISMATCH, at 2026-10-15T18:11:49.000Z.
The runtime does not ingest that evidence file. The reviewed name is therefore
absent from the executable input path, rather than being read and then overwritten.
The hardcoded constant instead supplies all runtime expectations.

docs/0114e-acquisition-input-review-template.json has a suitable conceptual
expectedTarget.serviceName field, but its current value is historical and
targetInputSources covers only IDs. It is an offline worksheet, not a production
sealer. The current test-only worksheet model is not a trusted runtime boundary.
docs/0114a-acquisition-review-template.json has a direct planning field and an
indirect executable expectations field. Editing any of these JSON fields today
cannot produce an original runtime capability or change the fixed expectation.

## Decision: acquisition-owned reviewed target context

Keep the legacy ID-only target binding unchanged. Add a distinct, acquisition-owned
expected target context to a future version of the executable acquisition package.
Use a new manifest version, movement_railway_identity_acquisition_auth_v3, so old
reviews cannot be interpreted as approval of a newly variable service name.
No dual-version execution fallback is proposed. Preserve v1/v2 historical artifacts
as historical data; legacy context-only authorization remains context-only.

The new context contains the exact projectId, environmentId, serviceId, nullable
serviceInstanceId, serviceName, existing environmentKind/lifecycle constraints and
an inputReview binding. The IDs/eligibility are copied from the original target
binding and compared with the reviewed input; a second conflicting ID set is
rejected. The name has one canonical location: manifest.expectedTarget.serviceName.
Remove the executable duplicate expectations.serviceName; other non-name
expectations retain their existing meaning and values. Reject a conflicting or
extra duplicate field rather than choosing precedence.

inputReview records the exact independently reviewed input-package digest, its
review reference/reviewer, the referenced qualification-evidence digest and scoped
record, and the exact reviewed name/ID context. Use existing canonical hashing
rules for structured review data. Tracked textual review/evidence artifacts use
the repository's established canonical text hashing convention: normalize CRLF to
LF where that convention already requires it, preserving every other
byte-significant property covered by the established canonicalization rules. Do
not introduce a second raw-byte hashing convention for the same tracked textual
evidence class. A genuinely binary artifact or one already governed by an explicit
exact-byte contract follows its existing explicit contract; do not generalize a
new contract from 0114H. Hash equality alone still does not prove human review
occurred. Human package review must explicitly
compare these bindings; review acknowledgements must match the original retained
manifest. Only allowlisted non-secret artifact references are permitted; never
follow arbitrary caller paths or read credentials to resolve a reference.

For the current intended context, reviewed evidence supplies:

| Field | Reviewed intended value |
| --- | --- |
| projectId | 0fa3268a-396f-4042-a4c0-a92c23fdf486 |
| environmentId | 9410a813-0429-4bc7-bfbb-d54b85e17c8a |
| serviceId | ef516a68-9bb7-429e-a395-48ef2676593a |
| serviceName | movement-qualification |
| serviceInstanceId | null, unresolved |

These are design examples drawn from reviewed evidence, not compiled defaults or
an allowlist. The current evidence is not a completed input package: lifecycle is
null, source settings are pending/unapplied, inventory/host/whole-package completion
remain unresolved. This design cannot turn those values into executable inputs.

### Entry, freezing and trust boundaries

1. A future regenerated 0114E input package explicitly reviews serviceName and the
   exact name/ID association, using the scoped qualification evidence. Add name
   provenance/context review to that future worksheet schema. Retain independent
   review of all existing required inputs. Neither an arbitrary string nor a
   self-asserted reviewed=true field establishes this review.
2. At future executable-draft construction, the authorization owner validates the
   exact input schema and its linkage to the original opaque ID binding. Copy only
   plain own data properties into a fresh canonical snapshot; reject getters,
   symbols, hidden/extra fields and inconsistent references. Validate a non-empty,
   bounded service label under the existing label rules, with no normalization,
   trimming, case folding, aliases or wildcard semantics. The draft snapshot is
   deeply immutable before its first review is issued. Caller mutations afterward
   cannot affect it. Draft construction itself grants no authority.
3. The earliest trusted acceptance of that name as an approved acquisition
   expectation is exact approval of the original executable package in its private
   pool, after the independent input/context review. The approval must bind the
   name, IDs, input/evidence digests, reviewed code, inventory and host/context
   reviews together. This is the existing explicit human-acknowledgement trust
   model, not automated proof that a human inspected evidence.
4. The latest mutation boundary is draft snapshot creation, before package review.
   Any later name/ID change requires a new draft and new independent review. At
   review/approval/authorization/redemption, reject changed code or protected
   inputs; do not silently refresh their hashes. Final manual authorization remains
   separate and requires the exact new manifest digest. Review is not permission
   to open a context.
5. On successful one-shot ticket redemption, the authorization owner creates one
   opaque acquisition-target permit in a private WeakMap. Its record binds the
   original ID binding, approved frozen target context, manifest digest and code
   identity. Only the existing pinned wrapper receives this permit. It contains no
   public mint/getter and no serializable authority.
6. The identity owner receives a private consume closure from the literal
   authorization owner during initialization, using the existing temporary,
   non-enumerable, deleted-connector pattern. The closure redeems only original
   permits for the original binding, burns before validation, rechecks code/input
   identity and returns only the approved snapshot internally. This is a specific
   owner-to-owner connection, not arbitrary callback registration. Both import
   orders, null-prototype exports, deletion/freezing, post-load owner replacement
   and failure cleanup must be proven in isolated tests before implementation can
   be accepted. Do not introduce a public authority extraction API.
7. The wrapper passes that permit to identity.startTargetIdentitySession with the
   original binding, before opening the credential-bearing execution context.
   The identity owner consumes it once and privately retains the frozen expected
   context in the new session. No later setter or caller name argument is allowed.
   Failed creation burns the permit/ticket and opens no context. Cancellation,
   failure or expiry cannot recover or reuse it; the wrapper clears any retained
   reference on every terminal path.

The existing one-argument session entry may remain for the 0113 context-only path.
It has no approved service-name expectation and must reject every services/instance
continuation. Do not default it to myapp-backend. Keep the existing context-only
wrapper's output/stopping behavior and closed-context lifetime unchanged. A plain
name object passed as a second argument must fail before credential/context access.

This private acquisition permit is deliberately separate from the legacy ID target
binding. Adding serviceName only to a public validator argument or to that legacy
binding would not establish package review, ticket ownership or an immutable
session expectation. Changing the fixed constant alone is insufficient.

## Selection, response validation and human gates

Services validation uses the session's approved name and service ID. Retain exact
body shape, complete single-page requirement, maximum edge count, identifier/label
syntax, and duplicate-ID/name rejection. Select the unique exact name match and
then require its ID to equal the approved serviceId. Unrelated valid services may
remain present under the existing policy; never choose the first service. If an old
myapp-backend service is also present, it is merely another unrelated service when
the reviewed expected name differs. Missing the expected name fails even if the
expected ID appears under another name.

Instance validation requires serviceName exactly equal to the same session name,
plus the existing nullable expected instance-ID rule and unchanged root/region
rules. Do not reinterpret a returned instance ID as proof by itself. ID-based query
variables and the accepted same-session provider context remain unchanged.

Both the adapter's early validation and the identity owner's final validation must
call validators using the original session retained in the transfer/invocation.
Resolve the name from private session state. Do not accept an independent name
argument from callers, transfer metadata, raw response bodies or copied reviews.
Require session/binding/context/manifest ownership consistency at both calls.
Any standalone structural validator is validation-only and cannot mint a receipt,
session expectation or provider observation. A missing approved context fails.

The service-candidate prompt continues to show expectedServiceId,
expectedServiceName, observedServiceId and observedServiceName with project and
environment IDs and provenance. Add the acquisition manifest digest to the review
binding. Machine equality and provenance checks happen before issuing this prompt.
Retain exact canonical acknowledgement, original review identity, revision and
session/context ownership. Human approval cannot override a machine mismatch.

The final candidate retains expected and observed names and IDs, plus the same
manifest digest, in its canonical candidate hash. Preserve exact original candidate
acknowledgement, forbidden-inventory digest/collision checks and disposable-target
confirmation. A copied, stale, cross-session or altered candidate never advances.
The final descriptive result may retain those review facts but must expose no
permit, ticket, execution context or continuation authority.

## Future runtime modification set

Only the following four existing runtime files are required by this proposal.
All paths are under scripts/assessment-worker/.

| File | Required future semantic change |
| --- | --- |
| qualification-railway-live-authorization.cjs | Add exact reviewed acquisition-input intake; freeze name/ID/evidence context; generate v3 manifest with direct serviceName; preserve original-review approval, separate manual authorization and all rechecks; privately issue/consume the one-use target permit on ticket redemption; connect only the literal identity owner. Update planning/template generation so historical labels cannot masquerade as approved new expectations. |
| qualification-railway-target-identity.cjs | Remove universal service-name authority; add private acquisition-permit consumption/session context; use session-owned exact name/ID in services and instance validators, inspect/review facts and final candidate; reject context-only continuation; preserve state machine, human acknowledgements and all provenance/shape constraints. |
| qualification-railway-https-adapter.cjs | Pass retained original session to early services/instance validation and enforce matching approved acquisition context; retain final-owner repetition, closed ingress, receipt ownership and fixed ID-only GraphQL operations. Never accept caller name overrides. |
| qualification-railway-acquisition-wrapper.cjs | Pass only the privately redeemed original target permit into fresh session construction before context open; clear it on terminal exit; preserve one fresh S/C, exact order, both manual gates, finite waits, three-request ceiling and one-shot private redemption. |

No new runtime helper is proposed. No change to the shared ID-only target binder,
first-context wrapper, provider-boundary receipt namespace, context-review module,
queries, schema preflight or transport host/security policy is required. Tests must
prove this isolation. If implementation discovers a need to expand this set, stop
and revise the design rather than silently widening scope.

## Future tests and acceptance matrix

No tests are changed or executed by this design milestone. Future implementation
must first add synthetic cases that expose the present incompatibility, then pass
them without relaxing existing rejection/provenance coverage. No normal-module
real ticket/context/provider execution is permitted for those tests.

| Exact test file under supabase/tests/ | Future additions or modifications |
| --- | --- |
| 0111_railway_target_identity.test.cjs | Parameterize approved session expectations; accept two independently reviewed synthetic names in separate sessions; reject cross-paired IDs/names, absent permit, raw/copy/replayed permit and context-only continuation. Preserve strict connection/instance validation and final candidate hashing. |
| 0114a_service_review_authorization_foundation.test.cjs | Review expected/observed name+ID and manifest digest; reject altered acknowledgements, hidden/getter fields and different review/session/revision; ensure both names can be reviewed without production fallback. Keep v1 planning-only. |
| 0114b_project_services_transport.test.cjs | Early validation must use the original approved session; reject right ID/wrong name, right name/wrong ID, cross-session expectation substitution, duplicates and incomplete pagination before receipt issuance. Preserve fixed query bytes and ID variables. |
| 0114c_service_instance_transport.test.cjs | Correct reviewed non-production name passes only after service approval; mismatch/case change/old-name fallback and wrong non-null instance ID fail early and finally. Keep root/region handling, same S/C history and closed ingress. |
| 0114d_acquisition_wrapper.test.cjs | v3 manifest/source/input digest binding; name mutation at every review/authorization/redemption boundary; genuine private permit lifecycle and before-open rejection; both import orders and no surviving connector/getter; full two-name synthetic end-to-end cases with both gates. Preserve timeout/cancel/failure/replay/no-fork/three-request tests. |
| 0114e_acquisition_input_review.test.cjs | Add a future worksheet version with name provenance and exact target association; stale package/evidence/name/ID/code/HEAD/branch checks; regenerated safe-template expectations. Retain byte-preservation checks for historical evidence/assessment and false authority/completeness claims. Do not rewrite history to make a current review pass. |
| 0113_first_context_wrapper.test.cjs | Prove unchanged context-only stop/close semantics and that its session/authority cannot supply an acquisition permit or continue into services. Update only current pin/template expectations if needed. |

Update the isolated loaders/fixtures that construct these paths:
supabase/tests/fixtures/0111-target-identity.cjs,
0112-context-transfer.cjs, 0113-first-context-wrapper.cjs, 0114a-foundation.cjs,
0114b-project-services.cjs, 0114c-service-instance.cjs,
0114d-acquisition-wrapper.cjs and 0114d-authorization-loader.cjs.
Supply synthetic reviewed contexts/permits through the isolated owner model, never
add a public runtime minting hook for tests. Keep synthetic names and IDs separate
from actual target identity and real credential material.

The new positive cases that must fail against current source are: a fully reviewed
synthetic package for movement-qualification produces the corresponding manifest
expectation; its exact name/ID services response passes early and final validation;
its exact-name instance reaches final human review; and two separately reviewed
names coexist without global state leakage. Current source either lacks that input
contract or rejects the non-hardcoded name. Existing negative cases should continue
to pass, not be rewritten as acceptance cases.

Required security regression cases additionally cover:

- Correct name/wrong ID and correct ID/wrong name; cross-project/environment input
  mixing; missing, null, empty, oversized, wildcard, fuzzy, alias, case-folded or
  normalized substitutions; provider-returned names cannot become expectations.
- Historical-name fallback, first-service fallback, duplicate names/IDs, pagination,
  malformed/extra response fields, wrong instance expectation, context replacement.
- Caller mutation before/after review, mutated nested context, changed evidence or
  package bytes, altered digest/review reference, stale HEAD/branch/source/self
  hash, copied/serialized/forged handles and cross-VM/cross-session reuse.
- Direct session/adapter entry with no approved permit; wrong binding or module
  owner; wrong arity burns genuine permits; initialization/replacement attacks;
  no token/context read before successful permit consumption.
- Skipping either human gate, mismatched canonical acknowledgements, stale revision,
  timeout, cancellation, terminal cleanup, retry/reopen/fork and capability leakage.
- Historical myapp-backend can be an explicit reviewed name with synthetic eligible
  IDs, without changing the disposable/non-production qualification restriction.
  Supporting that spelling does not authorize targeting production.

## Manifest, pins, templates and history

Today the executable v2 manifest already hashes serviceName indirectly through
expectedTarget.expectations.serviceName. v1 planning and the 0114E worksheet have
a direct field. The future v3 uses one direct canonical field and binds the reviewed
input/evidence context; this is a contract change, not merely adding a missing hash.
Name changes alter manifestSha256, final authorization acknowledgement and final
candidate digest. Reused v2 reviews/tickets, or new manifests with old digests, fail.

Future changes to the identity owner, HTTPS adapter and acquisition wrapper
invalidate those three existing source pins. Updating the authorization module's
manifest logic, private linkage and three pin literals changes its self hash.
The pin inventory can remain twelve entries; the other nine source pins remain
unchanged if their bytes are unchanged. Canonical source hashing stays UTF-8 with
CRLF-to-LF only, preserving every other byte/BOM/EOF. No hashes are changed here.

Future current safe templates must be regenerated for the new contract and source
identity, retaining null unknown IDs/name, unchecked reviews/inventory/host facts
and PRELIVE_NOT_AUTHORIZED. Retain myapp-backend only in clearly historical context,
never as a missing-name default. At minimum revisit
docs/0114a-acquisition-review-template.json (including its embedded executable
template), docs/0114e-acquisition-input-review-template.json and
docs/0111-target-identity-review-template.json. Also regenerate current code-identity
snapshots in docs/0110-live-review-template.json when their pins/self hash change.
Version new worksheets/templates explicitly; preserve historical versions or their
Git snapshots instead of rewriting prior completed or incomplete reviews.

Keep docs/0114f-operator-acquired-target-metadata.json,
docs/0114e-actual-acquisition-input-review.json and
docs/0114e-qualification-target-evidence.json unchanged. The current qualification
evidence supplies a scoped reviewed name/ID context, not an automatically completed
input review. Regenerate a separate future assessment against the then-current
reviewed implementation and protected inputs. Never refresh historical hashes to
pretend that an old review approved new code. No database migration is required.

## Rollout and current validation boundary

1. Independently review this design and separately authorize implementation scope.
2. Add the synthetic failing acceptance/security cases; implement the four runtime
   boundaries as one coherent versioned change, preserving all rejection rules.
3. Verify private initialization under both import orders and context-only isolation;
   recompute affected source pins/self hash and regenerate current safe templates.
4. Run focused 0109-0114F suites, the established serialized regression, app/Edge/
   worker typechecks and git diff --check; prove unchanged migrations/history and
   capsule exclusion. Reconcile all current source/template tests without dropping
   security assertions. No provider connection is needed for this validation.
5. Obtain independent review of the exact resulting code and a separate regenerated
   0114E package. Resolve lifecycle, inventory, host and whole-package review gaps;
   retain instance ID null unless properly established under the existing procedure.
6. Any later actual acquisition requires its own exact manual authorization and
   permitted controlled observation. Nothing here authorizes that step or applying
   pending source settings. No deployment/restart follows implicitly.

For 0114H itself, only this document is added. Verify git diff --check, unchanged
runtime/preflight sources, 99 migrations, twelve matching pins, authorization self
hash, qualification/historical evidence and all safe templates. The protected
capsule remains unread, untouched and untracked. No full runtime regression or
typecheck is required solely for this documentation-only change. AGENTS.md requires
the Expo lookup before writing code; no code is written, so no Expo lookup or other
network access is needed.

Stop rather than weakening either exact match, accepting unreviewed caller names,
bypassing a human gate, creating historical-name fallback, treating the example
qualification name as implicitly trusted, accessing providers/secrets/capsule,
changing Railway settings or deploying. None is needed to complete this design.

## Independent design review

The following completed human review is recorded from the supplied review facts:

- reviewerReference: AT
- reviewedAt: 2026-10-15T19:42:20.000Z
- local review time: 2026-10-15 20:42:20 WAT
- reviewer independently reviewed the actual 0114H design document: true
- result: NO_MISMATCH
- all 20 requested design-review points confirmed: true

AT confirmed these 20 design points:

1. Exact serviceName equality is preserved.
2. Exact serviceId equality is preserved.
3. Name and ID belong to one reviewed target context.
4. Caller cannot substitute name or ID after review.
5. movement-qualification is not a built-in trusted name.
6. myapp-backend is not a fallback.
7. Service-candidate human review remains mandatory.
8. Final target human review remains mandatory.
9. Machine equality checks happen before human approval.
10. Approved serviceName becomes immutable before package review.
11. Later name/ID mutation requires a new draft and review.
12. Executable v3 manifest binds reviewed name/ID/input/evidence context.
13. Private permit is one-use and exposes no public authority getter/minting API.
14. Context-only 0113 path cannot continue into service acquisition.
15. Provider-observed names cannot become expectations automatically.
16. Correct ID with wrong name fails.
17. Correct name with wrong ID fails.
18. No fuzzy, alias, case-folded, wildcard, first-service or historical-name fallback is introduced.
19. Historical production evidence remains historical and is not rewritten.
20. This design grants no deployment, Railway change, runtime implementation or 0114D authorization.

This independent design review does not authorize implementation or, by itself,
staging, commit or push. It does not authorize Railway access/configuration or
deployment. It does not complete 0114E, resolve lifecycle or serviceInstanceId,
resolve forbidden inventory or host attestation, or create 0114D authority.
The technical design remains unchanged.
