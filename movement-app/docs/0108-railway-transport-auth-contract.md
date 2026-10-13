# 0108 Railway direct transport/auth and context foundation

0109 follow-up: [private HTTPS adapter foundation](0109-railway-private-https-adapter-foundation.md)
implements the original-object handoff, fixed context review ticket and direct HTTPS
path without invoking it live. The historical 0108 readiness/observation record
below is preserved. Real provider evidence and first live authorization remain absent.

**PREFLIGHT ONLY. No live executor or live authorization.** No network request,
Railway/Supabase invocation, token-value/cache inspection, production access,
deployment, restart/redeploy or project action occurred. No independent browsing
was performed. The preserved capsule was not read. Fresh qualification remains
unauthorized; runtime provenance remains unresolved.

## Evidence categories

1. **Official current Railway documentation facts supplied with this task:** public
   endpoint https://backboard.railway.com/graphql/v2; project tokens scope one
   environment within a project and use Project-Access-Token; account/workspace/
   OAuth tokens use Authorization: Bearer; CLI names RAILWAY_TOKEN (project) and
   RAILWAY_API_TOKEN (account/workspace) with only one set at a time; projectToken
   exposes projectId/environmentId read-only; serviceInstance is read-only with
   serviceId:String! and environmentId:String!. These facts are attributed to the
   supplied review-session material, not an independent lookup or observed request.
2. **Local validation:** fixed payloads, canonical hash, strict JSON/identifier and
   private-target equality checks, auth-source-name selection and synthetic tests.
   Local validation cannot authenticate a caller-supplied response.
3. **Future provider evidence:** none observed. A real result must originate from
   the exact reviewed authenticated invocation and remain privately bound to it.

## Frozen transport contract and credential source

qualification-railway-transport-contract.cjs fixes:

| Contract fact | Exact value |
| --- | --- |
| endpoint | https://backboard.railway.com/graphql/v2 |
| method | POST |
| contentType | application/json |
| preferredAuthKind | project_token |
| directAuthHeaderName | Project-Access-Token |
| operatorEnvironmentVariableName | RAILWAY_TOKEN |
| allowedHeaderNames | Content-Type, Project-Access-Token |
| body keys | query, operationName, variables |
| broader tokens / interactive CLI auth | unsupported |

assertTokenSource accepts exactly {authKind:'project_token',
environmentVariableNames:['RAILWAY_TOKEN']}. It checks **names only**, never process.env
or a credential value. RAILWAY_API_TOKEN alone, simultaneous names, alternate sources,
broader auth kinds, value/header bags and CLI login/cache shortcuts fail closed.
Extra keys are rejected before inspecting their values. No token-format validation
is implemented. The historical 0107 auth allowlist stays empty; this separate 0108
contract establishes the new single-name allowlist without rewriting old evidence.

Only the later separately authorized final execution boundary may read
process.env.RAILWAY_TOKEN. The future boundary must reject the presence of
RAILWAY_API_TOKEN without reading its value; it must not accept Authorization,
another source or interactive CLI credentials. The sole secret-bearing object is
the ephemeral HTTPS header constructed inside that trusted execution boundary.
There is no header-value object, env reader or secret storage in 0108.

The future value must never enter argv, stdout/stderr, exceptions, request/review
artifacts, evidence JSON, transcripts, disk captures or Codex. No token format is
guessed, decoded, logged or accepted as a local input. Identifier validation uses
the existing operator ID convention and excludes existing sensitive markers; it
does not validate token values or claim a Railway UUID contract.

Future bodies are exactly {query:<fixed source>, operationName:<fixed operation>,
variables:<exact reviewed object>}. No caller-controlled source, operation, endpoint,
auth kind, generic header bag or transport option may be introduced. The existing
0107 builder supplies the two immutable 0106 schema requests, preserving their
canonical hashes and private staged names. The new context builder accepts no
arguments and supplies variables:{}.

## Fixed project-token context document

qualification-railway-project-token-context.cjs exports the immutable document,
canonicalSha256, buildRequest() and validateContextResponse(privateTarget,body).
The exact [review artifact](0108-introspection/project-token-context.graphql) is:

```graphql
query Movement0108ProjectTokenContext {
  projectToken {
    projectId
    environmentId
  }
}
```

Canonical SHA-256: d3190e45cbf0ec1242ef090a9a5a437c4043a5e7542b075921744349b8039e28.
Serialization is immutable UTF-8 source plus exactly one LF. Working-tree review
file comparisons normalize CRLF to LF before exact comparison; no whitespace trim
or content relaxation is used. buildRequest rechecks the fixed hash; contract
initialization also verifies the context payload before advertising readiness.
No caller source, operation, variables or hash override is accepted.

The successful response must be exactly:

```json
{"data":{"projectToken":{"projectId":"<approved ID>","environmentId":"<approved ID>"}}}
```

GraphQL errors (including empty arrays), headers/cookies/other transport metadata,
missing/null projectToken, missing/malformed IDs, extra data/context fields,
descriptions/prose and credential fields fail. The original private 0107 binding
is required; a serialized target snapshot cannot substitute for it. Both IDs must
equal that binding's approved constraints exactly. No case folding or normalization
occurs. Errors are generic and never echo the input.

Output is only frozen {projectId,environmentId}. It records structural validation
and equality of untrusted input. It is **not authenticated provider evidence**, not
a live result handle and not a reusable context capability. Valid synthetic input
does not set providerContextObserved or projectEnvironmentContextProven to true.

## Service context and readiness

Service binding is not necessary for provider-global/schema-level introspection.
The project-token context check is needed to establish that the executing credential
belongs to the exact approved project/environment; it says nothing about a service.
serviceId/serviceInstanceId remain 0107 future qualification constraints only.
No serviceInstance query is implemented here, and serviceContextProven stays false.
Future execution-record/qualification service scope needs separate review.

| State | 0108 value / meaning |
| --- | --- |
| transportContractReady | true: endpoint, method, headers, source name and body are fixed |
| providerContextAttestationReady | true: fixed query and strict local validator exist |
| providerContextObserved | false: no real provider response |
| projectEnvironmentContextProven | false: caller/synthetic bodies cannot authenticate context |
| serviceContextProven | false: no service proof; not a schema-inspection blocker |
| liveExecutorImplemented | false |
| authenticatedResultMintingImplemented | false |
| executionSchemaReady | false |
| identity_proven / causality_proven / restart_origin_proven / platformRestart | null |
| restartAttribution | {measurement:null, limitation:"restart_origin_unattributable"} |

0107 remains historically TRANSPORT_NOT_READY, with its original frozen metadata.
The separate 0108 contract-ready state resolves documentation gaps only; it does
not make an executor ready, authorize live use, inspect schema, establish runtime
identity or remove any execution-reader qualification limitations.

## Future exact-invocation result binding design

The unimplemented adapter interface is:

```javascript
executeFixedReadonlyRailwayRequest({privatePermit, privateTarget, requestKind})
```

requestKind must be one of project_token_context or schema_introspection. It must
select only the new fixed context document or the exact private 0107 staged payload;
there is no source/header/body/endpoint/auth override parameter. Every request,
including context attestation, requires explicit local artifact review and a fresh
one-use private permit. No loop, automatic retry or fallback is added.

The trusted later adapter must keep result records in an adapter-owned WeakMap keyed
by opaque frozen handles. There must be no public result constructor, arbitrary
body injection, imported snapshot or caller-supplied network function that can mint
an authenticated handle. Only the internal successful fixed HTTPS invocation may
insert a record. A serialized/caller-constructed handle must always fail lookup.

Each private record must bind:

- The **original** consumed one-use permit and **original** private target object.
- The exact immutable payload and canonical hash, plus the schema session/stage
  where relevant; endpoint/method and project_token auth kind.
- The opaque execution-context identity established for the exact approved auth
  source and target (no secret copied into result/evidence records).
- A successful context attestation from that same auth/execution context, whose
  IDs matched the original private target.
- The body obtained directly from that exact invocation, not a caller-provided
  replacement. For the initial context invocation, its own validated response
  establishes the context; subsequent schema results reference that private
  context handle. This avoids requiring a pre-existing attestation circularly.

Result consumers must accept only the original private handle, check all bindings
and consume it once before forwarding the recorded body into the strict context
or minimized 0106 validator. Provider-context observation/proof may become true
only in that future trusted live path. It must never promote executionSchemaReady,
service proof, identity, causality, restart origin or platformRestart automatically.
Raw bodies remain local until sensitivity review; transport/auth metadata and
credential material never enter captures, diagnostics or normalized evidence.
The future context must be bound to the same private credential lifetime used by
attestation. Changing credential selection, target or execution context invalidates
that context and requires fresh attestation; hashes/IDs alone cannot transfer it.
Any secret lifetime stays inside the separately reviewed execution boundary, never
inside public handles or result/evidence records. 0108 creates no such lifetime.

**Known handoff gaps, not hidden by this design:** 0107 consumeApprovedRequest returns
a detached {target,request} description. It does not expose the original binding to
an adapter or compare it with a separately supplied privateTarget by object identity.
Matching two digests is insufficient to prove original-object ownership. A narrow
separately reviewed handoff must atomically verify record.binding === privateTarget,
consume the permit and pass only its internally recorded payload/session/stage into
the trusted adapter. Also, 0107 permits currently cover only the 0106 schema queries;
a separately reviewed fixed context-request review ticket is required. Neither gap
is patched by silently broadening 0107 or accepting caller-created tickets in 0108.

acceptResponseBody(session,body) remains a strict **injected** validator; it never
proves invocation origin. Likewise validateContextResponse accepts untrusted input
only. Neither normalized facts nor a fabricated {authenticated:true,body:...}
artifact can be converted into live evidence. 0108 exports no authenticated result
factory, consumer or executor; the private transport result is a future design only.

## Current CLI fact — documented, not adopted

The supplied official facts document Railway CLI api with --file <query.graphql>
and --variables @<vars.json>, using login/token context. This is descriptive, not an
executable instruction in this checkpoint. No railway api invocation occurred.
The direct project-token path is preferred because endpoint, header and environment
scope are explicit, projectToken can attest context and interactive cache dependence
is excluded. Account/workspace/OAuth authentication is documented as a different
Railway capability but unsupported for this narrow flow unless separately reviewed.

## Remaining authorization and implementation gates

Before implementing the tiny direct HTTPS adapter: review/accept this contract and
the exact-invocation result design; explicitly authorize that implementation milestone;
review the narrow original-target permit handoff and fixed context-request permit
support. These are implementation gates, not missing endpoint/auth documentation.
The adapter review must fix timeout/body bounds, HTTPS origin enforcement/no redirects,
safe generic failures, cancellation, simultaneous-source rejection, no automatic
retry and private result ownership, with synthetic transport tests that cannot mint
production authority through injected callbacks.

Before the first live context or schema request: implement and review that tiny
adapter/handoff/context gate; approve the exact current code/HEAD and all three
canonical documents; supply/review the actual active non-production target and
complete forbidden inventory; establish private response capture/sensitivity handling;
verify the approved auth-source-name boundary without sharing or inspecting values
in Codex; and obtain separate explicit read-only live authorization. The first
authorized live operation must be projectToken context attestation. Only a validated
same-auth-context result may permit the first schema request, after a fresh manual
review of its fixed document and stage. Service context alone does not block schema
inspection, but project/environment attestation failure must stop it.

No global one-shot authority, runtime provenance, authenticated exhaustive execution
reader, host/restart qualification, fixture sequencing or fresh qualification
authorization is solved here. Protected runtime files, 0106/0107 modules and all
99 migrations remain unchanged.

## Local validation record

0108 focused: 59 tests, 59 PASS, zero failures/skips. Serialized combined set:
750 total, 747 PASS, three existing OS-specific skips, zero failures. Includes
0107, 0106, 0105, both 0104 suites, 0103, all Railway/operator/remote 0102 suites,
0101, 0099, worker-process and migration-integrity. App, Edge and worker typechecks
PASS. Every context response in tests is synthetic/injected, not provider evidence.

All 99 migrations and protected runtime/0106/0107 modules match exact HEAD blob
or Git checkout bytes (108 protected files checked). No protected module was
modified. Seven changed/new task files pass whitespace checks; git diff --check
PASS. HEAD remains 2c3b590b81bd72449556c5078ca27acfe6c66267 on the requested branch;
index empty. Two tracked docs are modified and five task files are new/untracked.
The capsule remains untouched, unread and untracked. No browsing, live/provider
request, token-value/credential/cache inspection, stage, commit, push, deployment,
restart or redeploy occurred. The 0106 hashes remain unchanged; the new context
canonical hash is recorded above.
