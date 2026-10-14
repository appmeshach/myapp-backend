# 0114A service review gate and acquisition authorization foundation

Local foundation only. TARGET_IDENTITY_UNRESOLVED. PRELIVE_NOT_AUTHORIZED.
Actual projectId, environmentId, serviceId and serviceInstanceId remain null in
both safe authorization templates. No live provider request or real credential /
provider environment read occurred. Service/instance transport and the eventual
0114 acquisition wrapper remain unimplemented. 0113 remains one-shot/disposable;
its source, behavior and context-only authority consumers are unchanged.

## Required service decision

The session sequence is:
context_expected -> project_services -> project_services_pending -> service_review
-> service_instance -> service_instance_pending -> candidate -> reviewed.
Any invalid accepted provider observation ends at failed.

Successful Movement0111ProjectServices acceptance preserves the existing exact
provider provenance, request/invocation/context/session/binding/revision checks,
strict response shape, project ID comparison, complete single-page false pagination,
bounded edges, unique IDs/names, exact service-name selection and expected service
ID comparison. Accepted frozen objective serviceFacts and the original accepted
observation stay private. The resulting stage is service_review.

No Movement0111ServiceInstance review can be created before exact human service
approval. reviewNextIdentityRequest, old request reviews/permits, copied facts,
matching ID/name JSON and humanReviewed=true cannot cross the gate.
No new generic instance factory or transport consumer was added.

Public service APIs:
- reviewObservedServiceCandidate(session): exactly one argument, original session.
- approveObservedServiceCandidate(review, session, acknowledgement): exactly three
  arguments, original review and its original session.

Review is issued once for that session's service decision. Its frozen public
artifact has exactly candidate, revision, liveAuthorized (false).
candidate has exactly:
- observedServiceId, observedServiceName
- expectedServiceId, expectedServiceName
- providerObserved (true), evidenceSource (provider_project_services)
- projectId, environmentId (attested parent IDs)
- projectNameExpected, environmentNameExpected
- projectNameObserved, environmentNameObserved (both null)
- parentContextEvidenceSource (provider_project_token_context)

The acknowledgement has exactly reviewed (true), candidate (exact descriptive
values), revision (exact), liveAuthorized (false). Candidate JSON is permitted
only as descriptive acknowledgement of an original privately owned review; it
never replaces the review capability. No C, S, raw response, handoff, invocation,
provider result or internal candidate capability is returned.

A separate module-private serviceReviews WeakMap binds the original review to
the original session, binding, execution context, contextFacts, accepted
serviceFacts, accepted observation, revision and immutable descriptive candidate.
Approval deletes the genuine review before checking arity, session, private
ownership/state and acknowledgement. Copies, serialized reviews, caller-built
objects and acknowledgements alone cannot locate that private entry.
Wrong session, stale revision, substituted evidence, invalid acknowledgement and
missing/extra approval arguments burn a located original review. Restoration and
replay cannot revive it, and a second review cannot be issued. Such failures leave
the session at service_review, permanently ineligible for instance acquisition.
Review creation follows existing non-consuming inspection/review arity semantics.

Successful exact approval advances the SAME session to service_instance, increments
revision and retains approval privately, tied to the accepted evidence and context.
Instance request creation additionally checks that retained approval's exact facts,
observation, binding, execution context and revision. The fixed request uses only
the approved observed serviceId and the already attested environmentId; existing
expected instance/name/root constraints and provider validation are preserved.
Approval returns only descriptive inspection, with no separate approval ticket.

Final HUMAN TARGET REVIEW remains separate, requires accepted instance evidence
at candidate, and keeps the original final-target review plus reviewed forbidden
inventory and one-use target-handoff semantics. Service approval alone cannot
create a final target review or mark a complete target human-reviewed.

Zero matches, multiple exact-name matches, duplicate IDs/names, malformed pagination,
hasNextPage !== false and expected service ID mismatch fail accepted observation
terminally. No second page, cursor traversal, retry or fallback was added.
Unrelated valid service entries retain the existing selection policy. A new
'all unexpected services forbidden' policy is not represented by the reviewed
state and was not invented. Existing independently reviewed forbidden inventory
collision checks remain at final target review.

## Distinct acquisition package namespace

movement_railway_live_auth_v1 remains context-only; consumeLiveTicketForContext,
takeContextExecutionAuthority and takeFirstContextExecutionAuthority are unchanged.
It cannot represent service/instance permission.

The new namespace is movement_railway_identity_acquisition_auth_v1, operationKind
target_identity_acquisition. It binds exact reviewed HEAD/branch, the eleven
source pins and authorization-boundary self hash, original private target constraints
(project/environment/service/nullable instance IDs, expected serviceName and
disposable active lifecycle), independently reviewed forbidden Railway inventory
and the existing separate cross-system forbidden information.

Its exact ordered operations are:
1. Movement0108ProjectTokenContext (provider)
2. Movement0111ProjectServices (provider)
3. HUMAN_SERVICE_REVIEW (required human decision)
4. Movement0111ServiceInstance (provider)
5. HUMAN_TARGET_REVIEW (required human decision)

All three provider entries bind their existing fixed query SHA-256, maxRequests=1.
maxProviderRequests=3; exactRequestOrderRequired=true; retries=0;
fallbackAllowed=false; redirectPolicy=reject; humanServiceReviewRequired=true;
finalHumanTargetReviewRequired=true; schemaAuthorized=false;
transportSupported=false; liveAuthorized=false; manualLiveAuthorization=false.
No schema, generic GraphQL or qualification operation is represented.

New planning APIs are createAcquisitionDraft(binding, forbiddenInventory, reviewedCode),
reviewAcquisitionPackage(draft), approveAcquisitionPackageReview(review, binding,
acknowledgement), and acquisitionReviewTemplate(). Draft/review ownership uses
separate private WeakMaps. Review issuance and approval recheck exact local code
identity. Review is issued once; approval burns before arity/binding/metadata/code
checks. The exact acknowledgement contains reviewed=true, manifest (exact descriptive
values), manifestSha256, liveAuthorized=false. Approved output is a descriptive
PRELIVE_NOT_AUTHORIZED artifact with localReviewComplete=true. Copied artifacts
cannot approve a package or enter any old context ticket/authority consumer.
No acquisition ticket, execution authority, adapter call, credential reader or
service/instance transport consumer exists in this namespace.

The separate safe template is docs/0114a-acquisition-review-template.json.
It starts with null target IDs, null reviewed HEAD/branch, unknown inventory,
reviewed=false, localReviewComplete=false and all live authorization false.
Synthetic IDs occur only in isolated tests.

## Source identity and scope

Existing production files changed:
- scripts/assessment-worker/qualification-railway-target-identity.cjs
- scripts/assessment-worker/qualification-railway-live-authorization.cjs

New production files: none. Pin count: exactly 11.
Only the identity owner's pin changes among existing pins:
1dce76ecf7657f40d6ad98a7347eecff868772c5812eeadf025165c80ebfcb47
The other ten pins, including 0109 adapter, 0111 provider boundary, 0112 transfer
owners and 0113 wrapper, remain unchanged.
authorizationBoundarySha256:
ad96ba6dc9be5e3ee771a1ee58d7a45d89eef85a9786532209dd349a10c6cc87
Both the existing first-context template and separate acquisition template were
regenerated from final source bytes, using UTF-8 with CRLF-to-LF only.

Tests changed:
- supabase/tests/0111_railway_target_identity.test.cjs (explicit service approval)
- supabase/tests/fixtures/0111-target-identity.cjs (optional VM-only private capture)

Tests added:
- supabase/tests/0114a_service_review_authorization_foundation.test.cjs
- supabase/tests/fixtures/0114a-foundation.cjs

The private capture is appended only inside the test VM; no production injection
or introspection export exists. Execution tests use synthetic capability owners,
provider observations, credentials/environment and transport. New acquisition
tests mock Git and source drift. Focused network guards observe zero real calls.
Focused test processes receive an empty environment. The serialized regression
receives only three explicit Git configuration variables for exact repository
trust, with no inherited provider credential values. No persistent Git configuration
is written. The pin comparison uses local Git with command-scoped trust.

## Validation record

Focused: 0114A 62/62; 0113 63/63; 0112 62/62; 0111 101/101;
0110 63/63; 0109 78/78. Zero failures/skips.
App typecheck (npm.cmd run typecheck), Edge typecheck (npm.cmd run typecheck:edge),
and worker typecheck (node node_modules/typescript/bin/tsc --project
scripts/assessment-worker/tsconfig.json) PASS.

Final serialized regression: 1,117 total, 1,114 PASS, zero failures, three existing
OS-specific skips. Command: node --test --test-concurrency=1 --test-reporter=tap
over the following prior 0113 chain (19 files):
- 0099_shared_segment_assessment_job_foundation
- 0101_worker_host_qualification
- 0102_disposable_remote_qualification, 0102_operator_evidence, 0102_railway_evidence
- 0103_qualification_supervisor
- 0104_qualification_child_adapter, 0104_qualification_execution_reader
- 0105_schema_and_topology
- 0106_railway_introspection_plan
- 0107_railway_introspection_preflight
- 0108_railway_transport_contract
- 0109_railway_private_https_adapter
- 0110_railway_first_live_preflight
- 0111_railway_target_identity
- 0112_context_result_transfer
- 0113_first_context_wrapper
- tests/assessmentWorkerProcess.test.cjs
- tests/migrationNumbering.test.cjs

The first 17 names are supabase/tests/<name>.test.cjs. 0114A runs separately,
62/62 PASS; all six focused suites together have 429 passing tests.
The first combined attempt had one environment-only migration-test failure:
its existing Git helper rejected repository ownership under an empty environment.
A standalone corrected migration test passed, then the entire serialized chain
passed using only explicit process-scoped Git trust variables. No test assertion,
production source, migration or persistent Git configuration was changed to fix it.

HEAD remains 99e3c23c1a2222c32ed9894b560c6df91ed5cb11 on
feature/0092-shared-segment-suitability. Index remains unchanged/empty.
0102-remote-fixtures.capsule remains unread, untouched and untracked.
No live Railway/Supabase/provider request, Railway CLI, GitHub API, real credential
read, provider-environment read, stage, commit, push, deploy or restart occurred.
The required Expo v57 documentation was read before code changes; that documentation
fetch was the sole intentional external documentation action in this task.
No temporary file remains in the repository; verification scripts/logs live in OS temp.

Remaining 0114B gap: separately review/authorize the acquisition transport and
wrapper that owns a fresh C/S, repeats context attestation, acquires services,
pauses for exact human service review, acquires instance evidence and requires
final target review. This foundation makes none of those live requests executable.

## Exact repository verification

All 99 migration files were hashed through Git's checkout filters and compared
with their existing index blob IDs: count 99, changed 0. The historical byte
integrity test also passes with process-scoped repository trust.
The frozen adapter, provider boundary and 0113 wrapper have no diff.
No production file outside the two authorized owners changed.
git diff --check PASS. Index: no staged paths. HEAD and branch are unchanged.

Final status (the capsule was already untracked before work started):

     M docs/0110-live-review-template.json
     M docs/0110-railway-first-live-context-preflight.md
     M docs/0111-railway-target-identity-acquisition.md
     M docs/MOVEMENT_LAUNCH_READINESS_REGISTER.md
     M scripts/assessment-worker/qualification-railway-live-authorization.cjs
     M scripts/assessment-worker/qualification-railway-target-identity.cjs
     M supabase/tests/0111_railway_target_identity.test.cjs
     M supabase/tests/fixtures/0111-target-identity.cjs
    ?? 0102-remote-fixtures.capsule
    ?? docs/0114a-acquisition-review-template.json
    ?? docs/0114a-railway-service-review-authorization-foundation.md
    ?? supabase/tests/0114a_service_review_authorization_foundation.test.cjs
    ?? supabase/tests/fixtures/0114a-foundation.cjs

Documentation/templates changed: the four tracked docs/templates listed above.
Added: this milestone document and the separate acquisition safe template.
The existing 0111 target-identity template remains valid and unchanged because
its unresolved facts and fixed GraphQL documents did not change.
