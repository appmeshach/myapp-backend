# 0107 Railway read-only operator preflight

0108 follow-up: [supplied endpoint/auth contract and context preflight](0108-railway-transport-auth-contract.md)
adds a separate contract-ready state using official facts supplied for that task.
The historical 0107 TRANSPORT_NOT_READY evidence below is unchanged. No live
executor or provider observation is added; original-object permit handoff and
fixed context-request review support still need separate implementation review.

**PREFLIGHT ONLY. NO NETWORK. NO LIVE AUTHORIZATION. Outcome B:
TRANSPORT_NOT_READY.** No Railway CLI, GraphQL provider or Supabase call occurred.
No token, credential cache, runtime variable value, log, live schema response or
execution record was read. No production, deployment, restart/redeploy or project
action occurred. Fresh disposable qualification remains unauthorized.

## Local tools and fixed requests

`qualification-railway-introspection-request.cjs` exports only verifyDocuments()
and buildRequest(session). Every request re-verifies **both** immutable 0106
documents against the published canonical SHA-256 values (UTF-8 source plus one
LF). Changing either source or operation name fails closed before producing any
request. The .graphql working-tree newline bytes are not the hash authority.

Root payload, with no target variables or credentials:

```javascript
{
  query: plan.documents.root.source,
  operationName: 'Movement0106QueryRoot',
  variables: {}
}
```

Referenced-type payload:

```javascript
{
  query: plan.documents.type.source,
  operationName: 'Movement0106ReferencedType',
  variables: { name: plan.next(session).variables.name }
}
```

The exact sources and canonical hashes remain [the reviewed 0106 documents](0106-railway-readonly-introspection-plan.md).
No document, operation name, variables, arbitrary type or hash override is a caller
parameter. Extra arguments and fake/serialized sessions fail. Payloads are frozen.
The builder imports only crypto and the local immutable plan; it has no transport.

## Target constraints and denylist

`qualification-railway-introspection-target.cjs` exposes bindTarget(expected,
selected, denylist) and describeTarget(binding). Both scopes must have exactly:

```javascript
{
  environmentKind: 'disposable',
  lifecycle: 'active',
  projectId: '<explicit approved Railway project identifier>',
  environmentId: '<explicit approved Railway environment identifier>',
  serviceId: '<explicit approved Railway service identifier>',
  serviceInstanceId: null // exact identifier if the later reviewed API requires it
}
```

Every selected value must equal its approved expected value; no normalization,
wildcard, substitution or environment intake is allowed. Identifier syntax uses
the existing local operator identifier convention (bounded alphanumeric/underscore/
hyphen), not an invented Railway UUID or auth format. Existing sensitive markers
are excluded from identifiers; this is not token authentication or format validation.
Only disposable/active labels are accepted. Production, inactive/decommissioned
targets, missing IDs, extra keys and mismatches fail closed.

The required operator-maintained denylist has exactly inventoryReviewed:true and
projectIds/environmentIds/serviceIds/serviceInstanceIds arrays. Duplicate or invalid
entries and any exact match in its corresponding identifier dimension fail. A denied
project rejects all its environments; a denied environment rejects every service
selection containing that identifier. Arrays are bounded to 256 entries each.
The complete production and inactive/decommissioned qualification scope inventory
must be separately reviewed before live authorization. Empty arrays are valid only
as an explicitly reviewed inventory assertion, never an automatic default.

No authoritative local Railway forbidden-scope identifier inventory was established.
No real target manifest was provided or validated in 0107. Synthetic tests exercise
the mechanism, not a real scope. Existing 0102 Supabase denylist references are a
different provider namespace and are deliberately not relabeled as Railway IDs.
No production IDs or secrets are hard-coded here.

The binding is a private local object; describeTarget returns immutable operator
constraints and a digest, labeled operator_plan_constraints and
independentlyAuthoritative:false, identity_proven:null. Copies/serialized bindings
cannot become private bindings. Hashes do not authenticate the scope, provide global
one-shot authority or establish runtime identity. All manifests and reviewed labels
are operator assertions; their truth requires independent review.

## Authentication and transport blockers

Current authVariableNameAllowlist is **empty**. No new or undocumented environment
variable name is assumed. Existing local RAILWAY_TOKEN/RAILWAY_API_TOKEN names occur
in 0102 rejection tests, not in a reviewed auth contract for this adapter, so they
are not adopted. No value of process.env is read by these modules.

A later explicitly approved adapter must obtain authentication only from the approved
operator environment **at execution time**, using a separately reviewed exact
variable-name allowlist and provider auth syntax. It must never accept credentials
from an argument, stdin transcript, target manifest, review artifact or Codex. Token
values must never enter argv, stdout/stderr, evidence JSON, capture/query files or
diagnostics. No cache inspection, token-format guessing or echoing is allowed.
The environment value reader, header construction and transport are absent in 0107.

Local evidence inspected: qualification-railway-evidence.cjs cliQuery invokes a
configured executable with api/document/--variables and an allowlisted child
environment, relying on the CLI's own login context. 0102 synthetic tests and docs
describe that implementation; 0106 describes a future inspection procedure only.
This does not establish the exact provider endpoint, API version, authentication
scheme or a cache-free approved-environment auth path for the proposed adapter.
No endpoint, header, CLI flag extension or token scheme is guessed or executed.

The exact **descriptive** future interface is:

```javascript
executeReadonlyIntrospection({ target, request }) // -> exact GraphQL body envelope
```

target must be a private reviewed binding's operator constraints; request must come
from the one-use reviewed permit described below. A future adapter must independently
validate its approved endpoint/auth contract and establish that its provider context
is bound to that approved non-production scope. Introspection payloads intentionally
have no project/service variables; merely carrying target metadata cannot enforce
provider scope. The mechanism connecting auth/provider context to these constraints
is therefore a blocker before the first live request.

No executeReadonlyIntrospection function is exported or implemented. The frozen
preflight contract has endpoint:null, authenticationSyntax:null and
outcome:TRANSPORT_NOT_READY. All tooling in this checkpoint stops at local artifacts
and descriptive invocation objects. Do not route them into an existing CLI wrapper
or another transport to bypass this gate.

## Manual per-request review and capture

`qualification-railway-introspection-preflight.cjs` exports contract, reviewNext,
approveReview, consumeApprovedRequest and acceptResponseBody. It has no loop,
executor, network, filesystem writer or auth reader.

reviewNext(session, binding) builds fixed canonical artifact strings for:

- 0107-next-request.graphql: immutable source plus one LF.
- 0107-next-request.variables.json: {} or exactly the validated staged name.
- 0107-next-request.meta.json: operationName, canonical query SHA-256, stagedTypeName,
  discoveryPath, targetSha256, executionSchemaReady:false, manualReviewRequired:true
  and transportReadiness:TRANSPORT_NOT_READY.

The operator may save these strings locally for review; generation does not execute
anything. Even root requests require explicit review. approveReview(review,
{...review.meta, reviewed:true}) requires the original private review object and
an exact acknowledgement of every metadata fact. Serialized reviews, missing/extra
keys, changed paths/hashes/target digests and false acknowledgements fail. Approval
is an operator assertion, not proof that a human read the artifact or live permission.

consumeApprovedRequest(permit) re-verifies documents and the current session stage,
then consumes the original private permit exactly once, including on stale-stage
failure. It returns only {target,request}, without execution. A changed stage requires
a new review; no previous permit or serialized copy can approve it. This local gate
does not solve cross-workstation authority. No automatic next request or retry occurs.

The future adapter may return only a GraphQL body, `{data:...}`; provider GraphQL
errors cause immediate stop, including responses containing both data and errors.
HTTP/auth headers, cookies, session metadata, diagnostics, environment dumps, logs
and tokens must not be attached or saved. acceptResponseBody(session,body) applies
strict 0106 validation and returns only its minimized evidence; errors are generic
and never echo the body. It does not save raw input, infer authentication or promote
readiness. In synthetic/local use it remains injected response validation only.

Future authorized raw bodies stay in the reviewed private local capture directory,
with restrictive access and separate sensitivity review before sharing. Schema
default literals may be sensitive: normalization preserves only default presence.
Do not paste raw bodies without that review or use redaction to pretend they are
exact original schema evidence. Paste only minimized normalized evidence and safe
review metadata. No token or runtime value is needed in a schema transcript.

## Future strict operator sequence — not authorized

Do not begin live steps until the endpoint/auth/scope-binding contract, non-production
manifest, forbidden-scope inventory, protected capture destination, transport code
and explicit user authorization are all independently reviewed. No live command is
provided in 0107.

1. Verify branch feature/0092-shared-segment-suitability and the explicitly approved
   HEAD (0107 baseline: 560df67fcd4bdb4de8fe0c46287eb44a0fda226c). If later reviewed
   code changes HEAD, obtain approval for that exact version; do not blindly reuse
   the historical baseline.
2. Verify both canonical 0106 document hashes.
3. Verify the exact approved active disposable Railway target and selected values.
4. Verify the complete reviewed denylist and reject all production/inactive scopes.
5. Create a private 0106 session with plan.start().
6. Build the exact root request through reviewNext; save/review artifacts and obtain
   explicit local acknowledgement for a one-use permit.
7. Only after separate live authorization, execute the consumed fixed request using
   the separately reviewed transport and independently bound provider context.
8. Save only the response body locally, excluding all transport/auth metadata.
9. Validate it locally with acceptResponseBody; stop immediately on any error.
10. Call plan.next(session); if null, proceed to step 17.
11. Build the exact referenced-type review using reviewNext(session,binding).
12. Manually review its exact staged name, discovery path, document hash and target
    digest; approve only the original review to mint a fresh one-use permit.
13. Execute that fixed request through the reviewed adapter after consuming the permit.
14. Append only its response body to the private ordered local transcript.
15. Validate the response locally before advancing or issuing another request.
16. Repeat from step 10 until plan.next(session) is null, with fresh manual review
    for every request, never an unattended crawler.
17. Call plan.finish(session); unresolved staged discovery must fail.
18. Output minimized normalized evidence after sensitivity review; readiness stays false.
19. Stop. Do not invoke an execution reader or qualification.

Immediate stop: unexpected branch/HEAD/hash, absent authorization, invalid/forbidden
or mismatched scope, unreviewed inventory, unresolved auth/provider-scope binding,
unreviewed transport, missing/incorrect/stale manual review, transport/auth failure,
provider errors, sensitive capture, schema-validation failure or discovery bounds.
No automatic retry, broader query, whole-schema fallback, arbitrary type lookup,
variable-value/log query, execution-record query or provider mutation is allowed.

Current local-only test command:

```powershell
node --test supabase/tests/0107_railway_introspection_preflight.test.cjs
```

## Preserved authority and qualification limitations

executionSchemaReady remains false. identity_proven, causality_proven,
restart_origin_proven and platformRestart remain null; restartAttribution remains
{measurement:null, limitation:"restart_origin_unattributable"}. Even successful
future schema responses cannot promote any claim through this checkpoint's code.
Runtime provenance is unresolved; no runtime variable values or logs are inspected.

Normal run.cjs, 0104 execution reader/child adapter, 0103 supervisor and all 99
migrations are unchanged. Existing adapters remain local/injected; no authenticated
execution completeness, process/execution identity, restart origin, global one-shot
authority or fresh qualification authorization is added.

Before the first live schema request: exact reviewed endpoint/API/auth syntax and
environment-variable-name allowlist; provider-context/target binding mechanism;
explicit approved non-production IDs and forbidden inventory; reviewed transport
implementation with no credential leakage; private capture policy; current code/hash
review and separate explicit live authorization. These are open, not assumed proven.

## Local validation record

0107 focused: 52 tests, 52 PASS, zero failures/skips. Serialized combined set:
691 total, 688 PASS, three existing OS-specific skips, zero failures. Includes 0106,
0105, both 0104 suites, 0103, Railway/operator/remote 0102 suites, 0101, 0099,
worker-process and migration-integrity tests. App, Edge and worker typechecks PASS.
An initial VM test loader used the test-directory require path; correcting its
local module resolution made the focused suite pass without changing the tested
preflight behavior. No live transport was used for any test.

All 99 migrations and the protected worker/0104/0103 files match exact HEAD blob
or Git checkout bytes. Both 0106 modules are also unchanged (105 protected files
checked, including migrations). Seven changed/new task files pass whitespace
checks; git diff --check PASS. HEAD is
560df67fcd4bdb4de8fe0c46287eb44a0fda226c on the requested branch. Index empty;
two tracked docs modified and five task files new/untracked. The capsule remains
untouched, unread and untracked. No credential/cache/token inspection, provider
call, stage, commit, push, deploy, restart or redeploy occurred.
