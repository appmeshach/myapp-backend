# 0112 context-only trusted result transfer

**TARGET_IDENTITY_UNRESOLVED. No live request or real token read occurred.**
0110 remains PRELIVE_NOT_AUTHORIZED. Actual Railway IDs remain unresolved.

Validation checks what a response says. Provenance establishes which original
request and live execution context produced it. Correct-looking JSON, hashes,
matching IDs or providerObserved=true cannot establish that provenance.

This local implementation adds a narrow path from the existing adapter's
genuine opaque context result into the original 0111 identity session. The
adapter remains the only result/receipt issuer. Ingress exports only status and
takeObservation; it has no raw-record issuer, setter, callback or transport.

## Original capability chain

In a future separately authorized execution, the operator wrapper first consumes
0110 live authority before opening the adapter context or reading a token. It
then follows this exact local chain, using original object references throughout:

1. `identity.contextTransfer.preparePermit(session, target, executionContext,
   contextHandoff)` creates P. The owner verifies the private session, exact
   target, context_expected stage and revision, and locks that session. The context
   and handoff references are captured as intent; adapter ownership is proven at
   binding and original handoff ownership at dispatch. P is not live permission.
2. `adapter.bindContextResultTransfer(executionContext, contextHandoff, P)` burns
   P through its owner before validation, creates the private one-use session
   slot, checks the adapter-owned live, idle, unattested context and exact target,
   and returns B. A copied context cannot acquire adapter ownership. Retargeting
   after a response is impossible because session/stage binding precedes dispatch.
3. Existing `executeHandoff(executionContext, contextHandoff)` consumes the
   genuine reviewed handoff and sends the existing fixed context request. A
   registered B requires exactly that handoff, context kind and fixed source.
   Existing schema behavior and ordinary unregistered execution are unchanged.
4. The original result R is owned by the same adapter-private results WeakMap
   used by ordinary consumeContextResult. It retains context, target, handoff,
   invocation, request, kind, endpoint, auth kind and body.
5. `prepareContextResultTransfer(R, B)` burns both supplied owned inputs first.
   It verifies all original associations and context liveness, then runs the
   existing context validator. It returns opaque T containing the original
   validated body privately. No JSON or hash-summary reconstruction is used.
6. `identity.acceptContextObservation(session, T)` pulls T through ingress.
   The adapter burns T and the private session slot, verifies the exact session
   and live context, and supplies a frozen context-only observation plus an
   opaque completion capability. It exposes no token/header, private invocation
   or generic result record.
7. The identity owner calls the existing context.validateContextResponse again,
   verifies its private acceptance capability and slot, and updates only this
   session to project_services. It then internally calls the same adapter
   consumeContextResultTransfer with the completion capability. That second
   phase burns the completion/acceptance capabilities, verifies actual owner
   acceptance and unchanged context lifetime, and only then finalizes attestation.

The completion phase is deliberately private-capability gated, not an
authorized/trusted/verified boolean. Calling it before actual session acceptance
fails, burns the completion and closes the context. Taking T directly from
ingress cannot finalize the context or make its returned record transferable.
The supported wrapper entry is acceptContextObservation, which completes the
two phases synchronously without an injected callback or async gap.

## Busy state, single ownership and failures

HTTP completion alone does not attest the context. While R, T or its completion
capability is pending, busy remains true and attested remains false. Requests
cannot run in parallel or skip pending acceptance. Successful finalization sets
attested=true and busy=false only after exact 0111 acceptance.

Ordinary consumeContextResult and transfer preparation compete for the same R.
Whichever consumes R first wins. Ordinary consumption preserves its existing
summary/argument behavior and cancels the sibling transfer slot. Transfer first
prevents later ordinary consumption. No independent duplicate of R is stored.

All new one-use consumers burn owned inputs before argument/provenance checks.
Bad target/context/handoff/session, stale revision, extra/missing arguments or
wrong result metadata cannot be repaired for retry. Fake keys cannot identify
original handles. A failed owned transfer cancels slots and invalidates its
owned context(s). Ingress forwards all arities so an owned T is burned even when
its expected-session argument is missing; it preserves generic public errors.

Adapter close/invalidate deletes pending B, T and completion handles, cancels
bound/taken acceptance slots and clears the private credential reference. Close
after R or T but before observation permanently fails. No reopen/restoration
revives those capabilities. Cancellation tracking is for cleanup only, not a
second slot authority store.

## Fixed scope and module ownership

Only kind context is transferred, normalized to project_token_context. The
operation is Movement0108ProjectTokenContext, SHA-256
`d3190e45cbf0ec1242ef090a9a5a437c4043a5e7542b075921744349b8039e28`.
The request must equal the existing frozen document with empty variables;
endpoint must be https://backboard.railway.com/graphql/v2 and auth kind project_token.
No caller field overrides those facts. Redirect/retry/TLS/body/header policies
remain the existing adapter policies; no second HTTP client is added.

The adapter resolves the identity owner lazily, so there is no eager circular
initialization. Each B/T captures the exact owner module instance. Missing or
partial contextTransfer exports and owner replacement fail closed. There is no
public initialization handshake, callback registration, Symbol.for secret or
hash capability. CommonJS exports are callable; safety comes from owner-private
WeakMap membership. Arbitrary in-process loader/built-in tampering remains
outside the reviewed-host trust assumption; source pins do not authenticate
in-memory require-cache state.

Test fixtures use coherent, isolated adapter/identity/ingress VM graphs with
synthetic environment, HTTP and private-record fault capture. Those instrumentation
hooks exist only in the fixture, not production exports. VM-A/VM-B/normal handles
cannot cross namespaces. Legacy 0111 synthetic issuer tests retain their separate
VM-only dependency and cannot create normal observations.

## Pins and current readiness

At the 0112 milestone, 0110 verifies ten critical sources. The adapter pin is updated and the
identity owner/ingress pins added after final source bytes are known. UTF-8 and
CRLF-to-LF-only canonicalization, preserved BOM/EOF, explicit future reviewed
HEAD/branch, historical baselineParentHead and transition rechecks remain intact.
The 0110 self hash and safe unresolved template are regenerated; self-hashing
does not prove human review or provider identity. No future commit SHA is guessed.

identity.contextTransfer.status.targetIdentityResultBridgeReady=true means local
context-transfer code exists. providerResultIngressConnected=false still means
no reviewed/configured live provider host path. Global providerContextObserved,
projectEnvironmentContextProven, serviceContextProven, executionSchemaReady and
targetIdentityObserved remain false. identity_proven, causality_proven,
restart_origin_proven and platformRestart remain null; restart origin is
unattributable. No normal production execution context was opened in validation.

Service-list and service-instance transport remain unsupported. Their fixed
0111 contracts, exact-name matching and hasNextPage=false requirement remain
unchanged. Context acceptance only makes local service review eligible; it does
not observe a service, create a candidate, send that request or authorize it.
No schema behavior or schema-live permission changes.

The later [0113 wrapper](0113-railway-first-context-wrapper.md) is now locally
implemented and becomes the eleventh source pin; the original ten are unchanged.
It is a disposable first-context probe that closes after exact acceptance and
independent session verification, including on success, and returns no continuation
capability. No live request, real token read or actual identity observation occurred.
Future service/instance acquisition requires its own separately reviewed and
live-authorized fresh execution context/session, repeated project-token attestation
in that lifetime, and only then same-context service/instance execution.

Before first live use, independently obtain/review actual expected Railway IDs,
complete category-specific forbidden inventory, current committed code/HEAD,
host diagnostics/credential handling and the trusted wrapper. Separate explicit
first-live authorization is still mandatory. Later service/instance transport
needs a separately reviewed fixed-kind adapter integration and live permissions.

## Recovery and validation

The interrupted work was preserved: six tracked edits and two new test files
were inspected before further editing. The focused suite as found passed 59/59.
The remaining work retained original response-body provenance, preserved generic
ingress errors while burning wrong-arity receipts, completed source pins and
documentation, and validated the combined suites. No architectural widening was
needed to preserve busy/attested semantics.

## NOT AUTHORIZED BY 0112

- No Railway/Supabase request, Railway CLI, dashboard automation or GitHub API.
- No real token, credential/cache or provider-variable read.
- No service/instance execution, schema request or fresh qualification.
- No generic GraphQL, pagination traversal, retry or fallback.
- No production access, deployment, redeployment or restart.
- No staging, commit or push.

All 99 migrations, worker run, execution reader, child adapter, supervisor,
0106/0107/0108 foundations and 0111 GraphQL documents remain unchanged. The
capsule remains unread, untouched and untracked.
