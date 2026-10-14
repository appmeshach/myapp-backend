# 0113 one-shot first-context wrapper

**Local foundation only. TARGET_IDENTITY_UNRESOLVED. PRELIVE_NOT_AUTHORIZED.**
No live Railway request, real credential read or actual Railway identity observation
occurred. First-live permission remains a separate explicit human decision.

The new production module is
`scripts/assessment-worker/qualification-railway-first-context-wrapper.cjs`.
Its only export is `runFirstContext(executionAuthority)`, returning a Promise and
accepting exactly one original opaque 0110 authority. No caller target, session,
handoff, token, environment reader, header, endpoint, request or transport is accepted.
Import opens no context and sends no request. There are no injected dependencies,
callbacks, generic transport, subprocess logic or retained resource maps.

## Authority and exact execution sequence

A future reviewed operator flow first completes the existing 0110 package review,
separate final human authorization, and consumes its original live ticket into an
execution authority using the existing exact target/manifest/kind contract.
No normal-module actual-target ticket was created during this milestone.

0110 adds only `takeFirstContextExecutionAuthority(...args)`: locate the original
authority in the existing authorities WeakMap, obtain its retained original
binding internally, and delegate to existing takeContextExecutionAuthority.
For wrong arity, delegate with only the authority: the existing extractor deletes
it before rejecting arity. Correct calls burn before all existing code/HEAD/branch
rechecks. No alias authority, second pool or non-consuming target getter exists.

The wrapper forwards arity to this consumer before any adapter open. Forged,
copied, serialized, spent or cross-namespace authorities cannot open a context.
A genuine authority with extra arguments burns and fails. Restoring code cannot
revive an authority spent during failed extraction. The extracted operation must
equal project_token_context.

Within one synchronous setup, the wrapper opens C from the extracted target,
creates its own session S for that exact target, prepares P for S/target/C/handoff,
and binds B before dispatch. Only openExecutionContext reads the credential value.
No callback or await occurs between authority extraction and binding.

The sole await is executeHandoff(C, originalHandoff), which consumes the genuine
fixed Movement0108ProjectTokenContext handoff. No second HTTPS client, retry,
redirect, fallback, service/instance or schema request exists. Its genuine R is
converted with B to T using the same existing result WeakMap as ordinary consumption.
The exact S accepts T; existing strict validation and private completion finalize
attestation. The wrapper never handles completion directly or ordinary-consumes R.

## Independent final state and disposal

The wrapper ignores acceptance's returned inspection and independently inspects S.
It requires project_services, TARGET_IDENTITY_UNRESOLVED, non-null observed project
and environment, null observed service/instance, providerObserved=false and all
global authority false/null. It also requires targetIdentityObserved=false and
providerResultIngressConnected=false; a reviewable candidate causes failure.
It never invokes reviewNextIdentityRequest or returns any observed ID.

After C exists, every exit attempts the same public closeExecutionContext(C),
including after adapter invalidation and on success. Existing adapter close is
idempotent for its genuine closed contexts. A close failure prevents success.
There is no retry, reopen, second cleanup attempt, background retention or error
cause/body/token logging. Before open returns C, no context handle exists to close;
authority failure never reaches credential access. An open failure may occur within
the adapter's existing credential boundary and never initiates a request.

Only after successful verification and close does the wrapper return exactly:

```json
{
  "outcome": "TARGET_IDENTITY_UNRESOLVED",
  "stage": "project_services",
  "contextObservationAccepted": true,
  "serviceObserved": false,
  "targetIdentityObserved": false,
  "manualLiveAuthorizationConsumed": true
}
```

This frozen flat record describes progression reached before disposal. It is not
provider/global authority. No API may accept it as authorization; copying or
serialization grants nothing. No IDs/body/request/header/token/hash, context,
session, handoff, P/B/R/T, inspection or continuation capability escapes.

0113 is deliberately terminal. Future service/instance transport remains unsupported
and must obtain its own separately reviewed/live-authorized execution flow, open a
fresh C, create a fresh S, repeat fixed context attestation within that lifetime,
then acquire service/instance observations using that same fresh context. The
disposable probe cannot continue into those requests, candidates or schema work.

## Sources, tests and host assumptions

The wrapper's canonical SHA-256 is
`7c3a376d1f7a1b733f3be90a3b7d43fb4aa2fd5256c5638a13e6301a3d78cf94`.
It is the eleventh 0110 critical source; the previous ten pins are unchanged.
UTF-8, CRLF-to-LF-only, no trimming/BOM/EOF changes remain the canonical rules.
The authorization-boundary self-hash and safe template are regenerated after final
source bytes. Reviewed HEAD/branch and all target IDs remain null; authorization
remains false. No future commit SHA is guessed or automatically trusted.

Tests use a coherent isolated graph of all private capability owners, synthetic
token/environment/HTTPS, and mocked Git/source drift. Test-only facades and private
record capture inject failures; production exports offer no injection hook. No normal
valid live execution occurs. Normal network/subprocess paths are guarded. 0110's
existing fixed local Git checks remain transitive dependencies with empty child
environment; the wrapper adds no subprocess logic and tests invoke no real subprocess.

The wrapper cannot prove Railway host identity, token-storage security, deployment
identity or restart causality. Trusted host/module-loader/built-in integrity remains
an assumption; source pinning does not authenticate mutable require-cache contents.
One-use ownership is process/module-local, not a distributed lock. Direct adapter
calls remain outside 0110 enforcement; the reviewed host must use the reviewed wrapper.
Closing clears the credential reference, without claiming memory zeroization.

Before first live use, independently review actual expected IDs, complete forbidden
inventory, exact current committed HEAD/branch, host and credential handling, wrapper
source/pin, and separate explicit first-live authorization. Local existence is not
live readiness. Global provider/project-env/service/schema/target observation flags
remain false and identity/causality/restart/platformRestart remain null.

All 99 migrations, frozen 0109/0111 transfer modules, normal worker/execution
foundations and service/instance GraphQL documents remain unchanged. The capsule
remains unread/untouched. No Railway/Supabase/CLI/GitHub API action, deployment,
restart, staging, commit or push is authorized by this foundation.
