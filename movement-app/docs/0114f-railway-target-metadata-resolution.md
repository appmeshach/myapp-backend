# 0114F Railway target metadata resolution and operator evidence intake

0114F is a human metadata intake and independent review procedure, safe JSON
template and conformance tests. No production/preflight module, automated metadata
resolver, parser CLI, new capability, pin or live execution path is added.

Outcome remains PRELIVE_NOT_AUTHORIZED. Actual projectId, environmentId, serviceId
and serviceInstanceId remain null. No real evidence, reviewer identity or review
time has been invented. The 0114E safe template is unchanged.

## Local tracked-source search, before implementation

NO INDEPENDENTLY AUTHORITATIVE ACTUAL RAILWAY TARGET IDS FOUND LOCALLY

Starting HEAD: 19150ae041e7cf78cedd5ba1247a551a5d26df06.
Branch: feature/0092-shared-segment-suitability.
The search considered 869 tracked paths, read 838 ordinary text/source/config
files after exclusions, and identified 77 Railway-related files with 406 target
field/label references. It checked literals, field assignments, doc placeholders
and UUID-shaped strings in those files; no UUID-shaped occurrence was found.
This does not assume all Railway IDs must be UUIDs.

Only tracked ordinary documentation, source, tests/fixtures and non-secret config
were eligible. .env files, credential/capsule/history/private-key/signing-key paths
and key containers were excluded before reads. Untracked files and hidden provider
state were not searched. Dependency lock data was excluded as non-target metadata.
No credential environment, shell history, browser storage, credential store, CLI
state or protected capsule was inspected. No network/API/CLI discovery occurred.
The report concerns this permitted local scope, not metadata a human might later
obtain from the provider.

### Candidate ID-shaped literals and classification

The table gives an exact representative file/line for every distinct literal
candidate group. Repeated fixture occurrences have the same test-only status.
All candidates below are ineligible for 0114E promotion; none is independently
authoritative. Test mutation values are not historical provider metadata.

| Field/context | Value | Classification | Exact representative location | May populate 0114E? |
| --- | --- | --- | --- | --- |
| serviceId | provider_project_services | source tag/field alias; not an ID | scripts/assessment-worker/qualification-railway-target-identity.cjs:85 | No |
| serviceInstanceId | provider_service_instance_metadata | source tag/field alias; not an ID | scripts/assessment-worker/qualification-railway-target-identity.cjs:85 | No |
| service | provider_project_services | source tag/field alias; not an ID | scripts/assessment-worker/qualification-railway-target-identity.cjs:261 | No |
| serviceInstance | provider_service_instance_metadata | source tag/field alias; not an ID | scripts/assessment-worker/qualification-railway-target-identity.cjs:261 | No |
| project | PROJECT | source tag/field alias; not an ID | scripts/assessment-worker/qualification-supervisor.cjs:52 | No |
| environment | ENVIRONMENT | source tag/field alias; not an ID | scripts/assessment-worker/qualification-supervisor.cjs:52 | No |
| service | SERVICE | source tag/field alias; not an ID | scripts/assessment-worker/qualification-supervisor.cjs:52 | No |
| serviceInstance | SERVICE_INSTANCE | source tag/field alias; not an ID | scripts/assessment-worker/qualification-supervisor.cjs:52 | No |
| MOVEMENT_QUALIFICATION_RAILWAY_PROJECT_ID | synthetic-project | synthetic test value | supabase/tests/0102_operator_evidence.test.cjs:142 | No |
| MOVEMENT_QUALIFICATION_RAILWAY_ENVIRONMENT_ID | synthetic-environment | synthetic test value | supabase/tests/0102_operator_evidence.test.cjs:142 | No |
| MOVEMENT_QUALIFICATION_RAILWAY_SERVICE_ID | synthetic-service | synthetic test value | supabase/tests/0102_operator_evidence.test.cjs:142 | No |
| MOVEMENT_QUALIFICATION_RAILWAY_SERVICE_INSTANCE_ID | synthetic-instance | synthetic test value | supabase/tests/0102_operator_evidence.test.cjs:142 | No |
| serviceId | synthetic-service | synthetic test value | supabase/tests/0102_operator_evidence.test.cjs:144 | No |
| environmentId | synthetic-environment | synthetic test value | supabase/tests/0102_operator_evidence.test.cjs:144 | No |
| project | synthetic-project | synthetic test value | supabase/tests/0102_railway_evidence.test.cjs:10 | No |
| environment | synthetic-environment | synthetic test value | supabase/tests/0102_railway_evidence.test.cjs:10 | No |
| service | synthetic-service | synthetic test value | supabase/tests/0102_railway_evidence.test.cjs:10 | No |
| serviceInstance | synthetic-instance | synthetic test value | supabase/tests/0102_railway_evidence.test.cjs:10 | No |
| projectId | synthetic-project | synthetic test value | supabase/tests/0104_qualification_execution_reader.test.cjs:3 | No |
| serviceInstanceId | synthetic-instance | synthetic test value | supabase/tests/0104_qualification_execution_reader.test.cjs:3 | No |
| serviceId | partial | synthetic test value | supabase/tests/0105_schema_and_topology.test.cjs:35 | No |
| environmentId | synthetic | synthetic test value | supabase/tests/0106_railway_introspection_plan.test.cjs:157 | No |
| environmentId | synthetic-env | synthetic test value | supabase/tests/0107_railway_introspection_preflight.test.cjs:7 | No |
| serviceId | other | synthetic test value | supabase/tests/0111_railway_target_identity.test.cjs:231 | No |
| environmentId | other | synthetic test value | supabase/tests/0111_railway_target_identity.test.cjs:232 | No |
| serviceInstanceId | expected-instance | synthetic test value | supabase/tests/0111_railway_target_identity.test.cjs:247 | No |
| projectId | other | synthetic test value | supabase/tests/0112_context_result_transfer.test.cjs:177 | No |

Additional mutation assignments use other/Other/changed as negative-test values,
not provider facts. For example, 0108_railway_transport_contract.test.cjs:64
uses Other for mismatches; line 58 uses changed; 0111_railway_target_identity.test.cjs:97-98
uses other. All these paths are under supabase/tests.

| Additional candidate | Exact file/context | Classification | Independently authoritative / usable? |
| --- | --- | --- | --- |
| synthetic-instance | supabase/tests/fixtures/0114d-acquisition-wrapper.cjs:16, fabricated instance response | synthetic test value | No / No |
| synthetic-expected-instance | supabase/tests/0114c_service_instance_transport.test.cjs:313, expectation loop | synthetic test value | No / No |
| explicit approved project/environment/service identifier placeholders | docs/0107-railway-readonly-live-preflight.md:63-65 | unknown placeholder, not an actual ID | No / No |
| thorough-blessing | docs/0110-live-review-template.json:69, projectName | historical label only | No / No |
| myapp-backend | docs/0110-live-review-template.json:70, serviceName | historical label only | No / No |
| expected branch/root/region | docs/0110-live-review-template.json:71-74 | historical labels only | No / No |
| all four null target IDs | docs/0114e-acquisition-input-review-template.json:15-18 | unresolved | No / No |

No actual historical/untrusted Railway target ID or unknown actual ID was found.
The historical material contains labels, code/evidence hashes and expectations;
hashes and source tags are not reversible provider identities. Supabase refs are
cross-system exclusions, never candidate Railway identities.

## Exact allowed human evidence

A later human operator may inspect an already accessible provider dashboard and
record only a non-secret identifier explicitly visible for the intended resource.
0114F itself does not operate the browser or contact the provider. If the UI does
not expose a clearly typed identifier, stop and record unresolved; do not use
developer tools, API calls, CLI, credential searches or inference to obtain it.

sourceKind is exactly operator_visible_provider_metadata.
sourceSurface must be one of:
- identifier_field: an explicitly labeled provider identifier field;
- copy_identifier_control: an explicitly labeled ID-copy control for that resource;
- identifier_url_path_segment: a visibly typed identifier path segment whose
  resource type and enclosing project/environment/service are independently
  corroborated in the provider UI. A bare opaque URL segment is insufficient.

sourceReference is a short inert description of the UI location and non-secret
evidence reference. Do not store raw URLs, query strings, fragments containing
data, account/session links or browser exports. Only the extracted typed ID and
minimal context belong in the repository. No provider-visible value is assumed
authentic merely because it matches syntax or a familiar label.

Forbidden intake includes tokens, credentials, account API keys, private keys,
cookies, request/response headers, screenshots, HTML/DOM dumps, network traces,
API/GraphQL/CLI exports, secret-bearing variables/config or browser-storage data.
Do not commit any such material. A value with an obvious secret pattern is rejected;
this check is not a guarantee that arbitrary text is secret-free. Minimize evidence
to manually inspected fields and seek a fresh non-secret record if contamination
is suspected. Do not print the rejected content.

## Record model and stages

[The safe evidence template](0114f-target-metadata-evidence-template.json) defines
one exact record per field under identifiers. Each has:
- field, value, provider=Railway;
- sourceKind, sourceSurface, sourceReference, sourceClassification;
- acquiredByReference, acquiredAt, acquisitionReference;
- independentlyReviewed, reviewerReference, reviewedAt, reviewReference;
- labelContext, contextCompared, authoritativeForInputReview.

References are non-secret human/record references, not invented account identities.
Use concise plain descriptions (1-256 characters) and ISO UTC timestamps with
milliseconds. Review time must not precede acquisition time. Record actual times;
do not fill the template with this document's creation time.

1. Operator acquisition: operator A reads a clearly typed visible identifier and
   confirms its resource and context. A records only the minimal value, source,
   acquisition reference/time and their non-secret reference. This alone is NOT
   independent review and must leave independentlyReviewed and
   authoritativeForInputReview false.
2. Independent comparison: reviewer B independently checks the provider-visible
   source, the exact copied value and its resource type and context. B records
   their own reference, review time and comparison reference, and explicitly
   confirms contextCompared. Merely reviewing A's transcription is insufficient.
3. Repository recording: only after the comparison succeeds may the minimal
   record state independentlyReviewed=true and authoritativeForInputReview=true,
   with sourceClassification=operator_supplied_provider_metadata. This is authority
   for input review only, never execution or runtime identity proof.
4. Completion: project, environment and service records are mandatory. Instance
   may remain the untouched null/default record until the later fixed provider
   observation. A supplied instance expectation requires the same full evidence.
   Completed evidence review may mark reviewed/evidenceReviewComplete true while
   preserving every execution/provider/identity authority flag false.
5. Reuse: a human transfers reviewed facts and references into a separate 0114E
   candidate worksheet, then performs its complete code, inventory and host review.
   There is no automatic promotion, executable draft or ticket conversion here.
   The committed 0114E safe template remains null and unreviewed.

No project policy permitting same-person review is established here.
samePersonReviewPermitted remains false. A and B must be different people, not
different aliases of one person. Normalized reference equality fails review;
different strings alone cannot prove distinct people. If one person performs
both steps, mark the record NOT independently corroborated and leave its authority
flags false. Do not invent reviewers to satisfy the structure.

The JSON records and copied/serialized versions are descriptive data. There is no
opaque 0114F capability, sealed authority pool, automatic authenticity verifier or
production validation API. Test-only predicates model structural and procedural
requirements; source authenticity and independent human identity require actual
human judgement and evidence. Fabricated plausible IDs cannot be disproved from
syntax alone. No synthetic conformance fixture is admissible live evidence even
if someone rewrites its provenance flags.

## Context, ID and namespace rules

Expected project label: thorough-blessing. Service label: myapp-backend.
Expected branch: feature/0092-shared-segment-suitability.
Expected root: /movement-app. Environment label remains unknown until a human
records it. A visible environment label, if supplied, remains descriptive.
The reviewer must compare project/service/branch/root context independently;
historical labels do not establish that today's selected target has that context.

Require the existing identifier grammar: ASCII alphanumeric first, then ASCII
alphanumeric, underscore or hyphen, at most 128 characters. Reject malformed IDs,
all known fixture/test values in the local catalog and declared synthetic,
historical/untrusted, label-only or unknown provenance. Test/fixture prefixes and
placeholder/source-field aliases cannot become reviewed live inputs. Historical
evidence alone is insufficient to resolve the current target.

Explicitly reject these as any Railway ID:
- xdfmoggrsucisfybqctb, udlsysezmzutydnifhsq, uzkhnslyrhgucijcuoes;
- thorough-blessing, myapp-backend;
- feature/0092-shared-segment-suitability, /movement-app;
- europe-west4-drams3a, RAILPACK_NODE_VERSION=24.

No cross-system lookup is performed. The ordinary target binder's syntactic
acceptance alone is insufficient for evidence intake. Do not weaken or change
existing target/identity/inventory semantics. The separate forbidden inventory
still needs its full independent completeness review in 0114E.

## Authority and code boundaries

The safe outcome is PRELIVE_NOT_AUTHORIZED. liveAuthorized,
manualLiveAuthorization, providerObservationOccurred, targetIdentityProven and
executableAcquisitionPrepared all remain false, including after evidence review.
Human UI evidence is input provenance, not a genuine adapter result or the runtime
provider observation required by 0114D. It grants no service/instance identity proof.

Recording context is HEAD 19150ae041e7cf78cedd5ba1247a551a5d26df06 on the required
branch. The unchanged 12 pins and authorization self hash are copied as descriptive
code facts. Recording context is not reviewed execution authorization. The existing
0114E template's historical requiredCodeReview HEAD is not silently updated:
it remains a historical worksheet expectation, not current reviewed authority.
A future actual package must independently review the current committed HEAD,
branch, exact sources, forbidden inventory and host.

No execution context, identity session, executable acquisition draft, authorization,
ticket, wrapper acquisition, schema request, credential/environment-secret read,
HTTP/HTTPS/fetch request, GraphQL/API request or Railway CLI invocation is part of
this workflow. No Supabase/GitHub API, capsule access, secret discovery, deployment
or restart occurs. All production/preflight files and pins remain unchanged.

After successful metadata intake, the next step is separate 0114E input completion
and then separately reviewed 0114D package preparation and explicit final manual
authorization. Execution never follows automatically. No actual IDs or independent
operator evidence have yet been supplied; that remains the current gap.

## Tests and regression compatibility

The focused suite guards real HTTP/HTTPS/fetch and uses the existing isolated
module graph to assert zero credential reads, sessions, contexts, drafts, tickets,
timers and execution calls. Tests use fabricated values and hypothetical actor
references only, and produce no actual evidence record or live inputs.

The prior 0114E suite originally assumed its starting HEAD would remain current
forever. Its one normal-Git check now verifies current identity and explicitly
rejects the historical HEAD when stale. The synthetic historical tests and golden
0114E JSON remain unchanged. This is a test-only compatibility correction; no
runtime verification is relaxed.

## Completed validation

0114F: 137/137 PASS. 0114E: 141/141 PASS. Earlier focused suites:
0114D 141/141, 0114C 96/96, 0114B 72/72, 0114A 63/63, 0113 63/63,
0112 62/62, 0111 101/101, 0110 63/63, 0109 78/78.
Total focused: 1,017 PASS; zero failures/skips.

The same 19-file serialized chain used for 0114D passed: 1,117 total,
1,114 PASS, zero failures, three existing OS-specific skips, with
--test-concurrency=1. App, Edge and worker typechecks passed. All 99 migrations
match index Git blobs through checkout filtering; historical integrity passed.
git diff --check passed; added files have no trailing whitespace and final newlines.

The index remains empty. HEAD remains
19150ae041e7cf78cedd5ba1247a551a5d26df06 on
feature/0092-shared-segment-suitability. The already untracked capsule is unread
and untouched. No stage, commit, push, deploy, restart, live provider/network
action, Railway CLI, Supabase/GitHub API, real credential or environment-secret
read occurred. No STOP condition was encountered.
