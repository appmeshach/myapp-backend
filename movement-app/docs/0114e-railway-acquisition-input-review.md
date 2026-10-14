# 0114E Railway acquisition input review

This milestone is an offline input-review worksheet, review procedure and executable
conformance tests over existing APIs. No production/preflight JavaScript module,
new security-critical helper, pin, automatic sealed review package or authorization
capability is introduced. Source-pin count remains 12. All runtime semantics,
including 0114D's private redemption boundary, remain unchanged.

The deliverable is [the safe worksheet](0114e-acquisition-input-review-template.json).
Its outcome is PRELIVE_NOT_AUTHORIZED. All actual Railway IDs, reviewed HEAD/branch,
inventory and host attestations remain unresolved/unreviewed by default. Presence
of fields, successful structural checks, copied JSON, a reviewer signature or a
completed worksheet cannot issue a ticket or prove any provider identity.

## Known facts and unresolved inputs

| Field | Safe value | Meaning |
| --- | --- | --- |
| projectId | null | Actual Railway ID requires independently reviewed metadata |
| environmentId | null | Actual Railway ID requires independently reviewed metadata |
| serviceId | null | Actual Railway ID requires independently reviewed metadata |
| serviceInstanceId | null | May remain unknown until later fixed provider observation |
| serviceName | myapp-backend | Historical expectation; not an ID |
| branch | feature/0092-shared-segment-suitability | Expected branch; not provider evidence |
| rootDirectory | /movement-app | Expected root; not provider evidence |
| environmentKind | null | Later reviewed value must be disposable |
| lifecycle | null | Later reviewed value must be active |

Historical project label: thorough-blessing. Historical Node setting:
RAILPACK_NODE_VERSION=24. Historical region: europe-west4-drams3a.
These labels do not establish current provider facts, IDs, Node execution or host
security. The existing safe 0110/0114A templates also contain null actual IDs.
No independently justified actual ID was established from those reviewed sources.

Each non-null supplied ID needs its own targetInputSources entry:
independentlyReviewed=true, a non-secret source reference and a reviewer reference.
Use separately supplied provider metadata reviewed by an independent operator;
record provenance without credentials or raw secret-bearing exports. Do not derive
an ID from a label, syntax, hash or another system's namespace. Syntax validation
alone does not establish that an ID exists or belongs to the intended environment.

The Supabase refs xdfmoggrsucisfybqctb (production), udlsysezmzutydnifhsq
(inactive), and uzkhnslyrhgucijcuoes (consumed historical disposable) are explicitly
prohibited in every Railway identity field, including optional instance expectation.
Reject them before constructing any target binding. Historical labels are also
rejected as substitutes for IDs, even when their spelling passes identifier syntax.
This is an explicit worksheet review rule; the legacy target binder's syntactic
acceptance alone is insufficient. No existing runtime namespace policy is changed.

## Offline operator review procedure

1. Copy the worksheet as data, retaining the safe original. Obtain actual IDs and
   their independent non-secret source/reviewer references through a future
   explicitly authorized operator action. Do not search credentials, shell history,
   hidden config, CLI state, browser storage or the protected capsule for them.
2. Compare every target expectation with the intended disposable/active target.
   Retain the exact service, branch and root expectations above. Keep instance
   expectation null if unknown; a supplied instance ID requires independent review.
   An unknown required project/environment/service ID blocks review completion.
3. Reject all prohibited cross-system refs and label substitutions. Existing
   identifier syntax is ASCII alphanumeric first, then ASCII alphanumeric,
   underscore or hyphen, maximum 128 characters. Existing sensitive-value checks
   still apply. This is a structural constraint, not ID discovery or authenticity.
4. Populate the complete forbidden inventory below and independently acknowledge
   its provenance and completeness. Do not project away its completeness flags.
5. Use only the existing offline APIs listed below for structural, inventory and
   source checks. Compare the resulting descriptive facts with the worksheet.
   No executable acquisition draft, ticket, session or execution context is needed.
6. Independently review the exact host checklist. Structural presence is not an
   attestation. Keep unverified fields false/null. Do not inspect environment secrets
   or read a credential to populate it. An unavailable attestation blocks completion.
7. Compare and bind the reviewed code identity. Independently record reviewer and
   evidenceReference in independentReview. A completed human worksheet may mark
   reviewed/inputReviewComplete true only after every check passes, but must retain
   PRELIVE_NOT_AUTHORIZED, liveAuthorized=false, manualLiveAuthorization=false,
   executableAcquisitionPrepared=false and all provider/identity claims false.
   This milestone ships no code that seals or issues such a completed package.
8. Recheck HEAD, branch, all source pins and the authorization self hash before
   treating a completed review as current. Any change makes it stale and requires
   independent review again. Serialized/copied worksheets are data, never opaque
   capabilities; editing or copying one does not confer authority.

The test-only checkWorksheet model exercises this procedure with synthetic facts.
It is not installed as a production validator, CLI or callable review API. The
shipped offline boundary consists of the worksheet, explicit human review rules,
existing reviewed APIs and their conformance tests. There is no new opaque 0114E
capability, private review pool or executable conversion function.

## Existing APIs to reuse without executing

- qualification-railway-introspection-target.cjs: bindTarget(expected, selected,
  denylist), describeTarget(binding). Pass independently reviewed matching scope
  facts. Binding records operator constraints only and starts no identity session.
- qualification-railway-target-identity.cjs: reviewForbiddenInventory(binding,
  fullInventory). This validates the original full schema, provenance, explicit
  completeness assertions, label mappings and matching-category target collisions.
  Retain the inventory facts in the worksheet; never mistake this local review
  capability for a provider observation or acquisition ticket.
- qualification-railway-live-authorization.cjs: verifyCodeIdentity({reviewedHead,
  reviewedBranch}). This invokes local Git only with an empty child environment,
  rechecks actual HEAD/branch and canonical sources, and returns descriptive identity.
- reviewTemplate() and acquisitionReviewTemplate() expose existing safe checklist,
  labels, namespace barrier and pinned code facts. They neither authorize nor execute.

For inventory validation, a temporary local target binding can use the binder's
empty legacy denylist; that is never sufficient review by itself. Immediately
validate the FULL independently reviewed inventory through reviewForbiddenInventory
and require success. Alternatively populate its simple denylist from the already
reviewed category IDs. Never present a binding alone as reviewed input completion.

Do not call createExecutableAcquisitionDraft, authorizeAcquisition, ticket consumers,
beginAuthorizedAcquisition, startTargetIdentitySession, openExecutionContext,
adapter execute methods, provider/schema functions or Railway CLI in this workflow.
No executable acquisition is prepared. The future 0114D conversion and final
manualLiveAuthorization=true remain a separate expressly authorized milestone.

## Forbidden inventory

The worksheet retains exactly the owner's full inventory fields:
inventoryReviewed, basis, provenance, projectIds, environmentIds, serviceIds,
serviceInstanceIds. Each category retains reviewed, completenessAcknowledged,
completenessIsOperatorAssertion, ids and labels. Defaults are false/null rather
than misleading empty complete lists.

For a completed inventory, all review/completeness flags must be true; basis and
provenance must be valid non-secret descriptive strings. Every ids value is an
array of at most 256 unique valid IDs. labels is an array of {id, label}, with at
most one label per listed ID, no unlisted IDs and no duplicate label mappings.
Labels remain descriptive. Matching-category target collisions fail, including
a supplied instance expectation. Unknown instance ID is checked after observation
by the unchanged later 0114D target review; offline review cannot prove absence
of a collision with an unknown ID.

An empty array means independently reviewed and explicitly asserted no forbidden
IDs in that category only when all three category flags and inventoryReviewed
are true. Completeness is an operator assertion, never inferred by this program.
The identity owner's policy is unchanged.

## Code identity and stale reviews

Required initial reviewed HEAD: ee228de90d4f1d68662948670bb15efed7fb6f0f.
Required reviewed branch: feature/0092-shared-segment-suitability.
These are requiredCodeReview expectations, not filled reviewedHead/reviewedBranch
attestations. The safe fields remain null. Git drift invalidates review.

The worksheet copies the exact current 12 source pins and
authorizationBoundarySha256=601a71a287a07c439bd4b3a136a64773ca709ee8d3b86414b4e2cedb2a6f3bd4.
Canonical source rule: UTF-8; CRLF to LF only; preserve all other bytes and EOF.
No source verification was weakened, no pin changed and no production module added.
A later committed implementation or changed branch requires fresh review metadata.

## Host review

The checklist is copied exactly from the existing live-authorization safe template.
nodeMajor must be an integer at least 24 at actual host review; its safe value is
null. Every other checklist field defaults false and requires an explicit true
operator attestation. reviewed/reviewer are separate review metadata, not extra
keys inside the exact checklist.

| Checklist field | Required later assertion |
| --- | --- |
| normalReviewedAdapter | Use the normal reviewed adapter |
| noNodeDebugEnvironment | No Node debug environment |
| nativeHttpHttpsDebugDisabled | Native HTTP/HTTPS debug disabled |
| noRailwayApiTokenPresence | No alternate Railway API token present |
| tokenProvisionedPrivatelyOutsideCodex | Credential provisioned privately outside Codex |
| noTokenInArgv | No credential in arguments |
| noTokenInCommandHistory | No credential in command history |
| noTokenInOutput | No credential in output |
| noTokenInArtifacts | No credential in artifacts |
| noTokenSharedInChat | No credential shared in chat |
| noProxyOverride | No proxy override |
| certificateVerificationEnabled | Certificate verification enabled |
| firstRequestContextOnly | First request is context only |
| stopOnError | Stop on error |
| noRetryOrFallback | No retry/fallback |
| noSchemaBeforeSameContextAttestation | No schema before same-context attestation |

Do not read a real credential, inspect environment secrets, query Credential Manager
or use private signing keys to fill this checklist. An operator's future host
attestation is still not permission to execute. 0114E leaves host review incomplete.

## Validation and boundaries

Focused tests intercept real HTTP, HTTPS and fetch. Their isolated existing VM
fixture records zero credential/environment reads, sessions, contexts, timers,
provider calls or execution trace entries for every offline case. Its Git mock
permits only local HEAD/branch checks. No acquisition draft or ticket is created
in 0114E tests. Existing 0114D-through-0109 regression suites retain their separate
synthetic execution tests, with no real provider action.

Conformance covers safe defaults, labels vs IDs, the cross-system barrier, malformed
IDs, independent provenance, optional instance expectation, full inventory review
and collisions, every host assertion, stale HEAD/branch, all 12 source pins and self
drift, non-executable copied/serialized data and false/null global authority.

Actual Railway IDs and independent target/inventory/host review remain unresolved.
Future work must obtain those inputs explicitly, revalidate reviewed code and host,
create a genuine 0114D draft, review it and separately manually authorize execution.
No provider request, credential read, CLI invocation, schema request, deployment or
restart is part of this milestone. No target/service/instance identity is proven.

## Completed local validation

0114E: 141/141 PASS. Earlier focused suites: 0114D 141/141, 0114C 96/96,
0114B 72/72, 0114A 63/63, 0113 63/63, 0112 62/62, 0111 101/101,
0110 63/63, 0109 78/78. Total focused: 880 PASS, zero failures/skips.

The same 19-file serialized regression chain used for 0114D passed:
1,117 total, 1,114 PASS, zero failures, three existing OS-specific skips.
This is the chain from 0099/0101 through 0113 including the three 0102 suites,
both 0104 suites, worker process and migration integrity, serialized with
--test-concurrency=1. App, Edge and worker typechecks passed.

All 99 migrations match index Git blobs through checkout filtering. All
production/preflight files and their 12 pins are unchanged, including the
authorization self hash. git diff --check passed; new files have final newlines
and no trailing whitespace.

HEAD remains ee228de90d4f1d68662948670bb15efed7fb6f0f on
feature/0092-shared-segment-suitability. Index is empty. The protected untracked
capsule was not read or touched. No stage, commit, push, deployment, restart,
live provider/Railway request, Railway CLI, Supabase/GitHub API, real credential
or environment-secret read occurred. No STOP condition was encountered.

## 0114F human target metadata evidence intake

[0114F metadata intake](0114f-railway-target-metadata-resolution.md) records the
tracked-source search: no independently authoritative actual Railway target IDs
were found. All actual IDs remain null; synthetic fixtures and historical labels
cannot populate live inputs. A human must acquire minimal non-secret typed provider
metadata and a different person must independently compare its value and context.
The safe evidence template grants no execution authority. The 0114E safe template,
all runtime modules and 12 pins remain unchanged. Actual acquisition remains a
separately reviewed 0114D package and final manual authorization step.
