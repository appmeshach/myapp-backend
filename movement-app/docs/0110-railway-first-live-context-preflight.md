# 0110 first-live Railway context preflight

**LIVE REQUEST NOT AUTHORIZED. Outcome: PRELIVE_NOT_AUTHORIZED.**

This local package records precisely what an operator has reviewed before a
separate decision to send the first Railway request. It protects against using
the wrong target, incomplete forbidden inventory, changed code, a different
operation, or a copied/reused authorization. It does not discover Railway IDs,
inspect credentials, or establish any provider evidence. This milestone has
created no normal-module live ticket or actual-target review package.

The implementation is
[qualification-railway-live-authorization.cjs](../scripts/assessment-worker/qualification-railway-live-authorization.cjs).
The [safe JSON template](0110-live-review-template.json) contains null IDs,
unknown inventory (`reviewed:false`, `ids:null`), unresolved reviewed HEAD/branch,
unchecked host assertions,
`reviewed:false` and `manualLiveAuthorization:false`. It cannot authorize
anything. Synthetic tests use separate VM module instances and invented IDs;
their tickets cannot be consumed by the normal module.

## Exact proposed operation and code

The immutable manifest version is `movement_railway_live_auth_v1`. Its only
operation kind is `project_token_context`, operation name
`Movement0108ProjectTokenContext`, query SHA-256
`d3190e45cbf0ec1242ef090a9a5a437c4043a5e7542b075921744349b8039e28`.
It fixes POST to `https://backboard.railway.com/graphql/v2`, project-token
authentication through `Project-Access-Token`, source name `RAILWAY_TOKEN`, and
forbidden source name `RAILWAY_API_TOKEN`. Redirects are rejected, retries are
zero, timeout is 10,000 ms, body limit is 1,048,576 bytes, header limit is
16,384 bytes, and accepted HTTP status is exactly 200. No generic header,
credential value, credential hash/prefix/path, provider response or live result
belongs in this artifact.

`baselineParentHead` is `7c2346ce73d12e571b5ff8506fd8d02be48f44b7`, the
historical implementation parent commit only. It is never a requirement for
future current HEAD and never substitutes for a reviewed HEAD. The real future
`reviewedHead` remains unresolved because 0110 has not yet been committed.
No future commit SHA is guessed or hardcoded.

After 0110 is committed, the operator must explicitly review the exact current
committed repository state and supply this safe metadata to
`createDraft(originalTarget, reviewedInventory, reviewedCode)`:

```json
{
  "reviewedHead": "<exact current Git HEAD: 40 lowercase hexadecimal characters>",
  "reviewedBranch": "feature/0092-shared-segment-suitability"
}
```

This illustrative placeholder is not a valid reviewed HEAD. The API validates
exact keys, a 40-character lowercase hexadecimal SHA and the expected branch;
it then requires locally observed Git HEAD/branch to equal the supplied values.
The supplied metadata is copied into the private draft and immutable manifest,
included in the exact human `codeReview` acknowledgement and bound into the
final manual-live acknowledgement (also through the code-identity digest).
Every draft, review completion, ticket issuance, ticket consumption and
execution-authority extraction rechecks that same reviewed HEAD/branch and all
source identities. A reviewed post-commit HEAD may differ from the historical
parent. If a ticket or execution authority is consumed and fails because of
drift, restoring HEAD cannot revive it.
The safe checked-in template uses null reviewedHead and reviewedBranch, including
inside codeIdentity; expectedBranch is merely the required branch constraint.
Template generation verifies source identities without claiming or adopting
the current Git HEAD as reviewed authority.

Git runs only in this qualification
preflight, never in the 0109 production adapter. Its two fixed read-only commands
use an empty child environment to avoid inheriting credential values, and a
command-scoped `safe.directory` restricted to this exact local repository.
There is no Git configuration write, staging, commit, push or remote operation.

Source identities below are SHA-256 of UTF-8 source after replacing CRLF with
LF only. There is no trimming, BOM removal or final-newline change. Files above
1 MiB are rejected. The query hash uses the existing 0108 canonical query plus
one LF; it differs from the validator module's source hash.

| Security-critical source | Pinned SHA-256 |
|---|---|
| 0109 HTTPS adapter | `a7b95e582df45a30b126ef63c313a9ad90ef78373d2688d40aab2d3fa9e2bf29` |
| 0109 context review | `23fb65eef738136b68b3d8ce19a69e51482f9bc075c6a26940e2300108c6dd0f` |
| 0107 private schema preflight/handoff | `88fe296bd5bfaa639844436c031dbdc674f29c25fbab3530081317143b3c9d74` |
| 0108 projectToken document/validator | `cd862abc5b85b8663fbc1075263c0b5d3c6d05793a31e875db67457f4adb3085` |
| 0108 transport contract | `33101241797b778067e2c44389c22c6b236e0f741e7565feae4cf8607e8b26de` |
| 0107 original target binding | `2c236cc1a077fea457938b4317afd7488de010f725ec0a5463fb52d0ab12d199` |
| 0107 fixed request construction | `62342054302e6f487708b85372b5f2cac7c1449e69ce3c25b0d142c1d4324ae3` |
| 0106 plan/validator | `dacaf8a4aaecff254760da0c687ccc78b3569b7e5449d1a919ba4170d18fc0e3` |

The new 0110 boundary's own canonical source hash is captured at module load,
included as `authorizationBoundarySha256` in the review artifact, and rechecked
before each authority transition. The human must review this new boundary and
that exact hash as well as the eight baseline pins. A changed boundary loaded
in a new process needs a new human review; load-time self-hashing alone cannot
prove that the operator reviewed the code. The immutable review and final
acknowledgement bind the complete code identity. Manifest and review digests
use recursively sorted object keys, preserve array order, compact JSON, and
no appended LF. Hashes establish local review consistency, not provider identity.

## Target and forbidden inventory

Actual Railway projectId, environmentId, serviceId and serviceInstanceId remain
unresolved. The known project label `thorough-blessing`, service label
`myapp-backend`, branch above, root `/movement-app`,
`RAILPACK_NODE_VERSION=24`, and historical region `europe-west4-drams3a` are
historical operator facts only. Names and region labels cannot manufacture IDs.
No Railway discovery is performed in 0110.

A future operator must independently obtain and explicitly review an active
disposable target's projectId, environmentId and serviceId, and review a known
serviceInstanceId or explicitly retain null under the existing target contract.
Project/environment IDs are required for the first context request. Service
and nullable service-instance IDs remain qualification constraints. The
projectToken query proves no service identity. Target facts are operator
assertions until an authenticated provider response establishes matching
project/environment scope.

The original 0107 private target binding is required. A detached record, JSON
copy, or different private binding with identical IDs cannot substitute for
that original object once reviewed. Handles live in private WeakMaps and
serialize to empty objects without authority.

Railway inventory requires `inventoryReviewed:true` and all four categories:
`projectIds`, `environmentIds`, `serviceIds`, `serviceInstanceIds`. Each must
contain exactly `{reviewed:true, ids:[...]}`. An empty reviewed array explicitly
means the operator checked and recorded no forbidden IDs in that category;
null or an omitted category means unknown and fails closed. IDs must follow
the existing bounded identifier contract, with no malformed/sensitive markers
or duplicates within a category. Target collisions are compared exactly in
their own category; a non-null instance is checked, a null instance is retained.
There is no case folding or comparison across different Railway namespaces.

Separate metadata records Supabase production ref `xdfmoggrsucisfybqctb`,
inactive ref `udlsysezmzutydnifhsq`, and consumed historical disposable ref
`uzkhnslyrhgucijcuoes`. Production/inactive refs must never be disposable
qualification targets; the consumed historical ref grants no new qualification
permission. These are Supabase project refs, not Railway IDs. They are not
silently inserted into or compared against Railway inventory categories.

## Human review and a later authorization decision

The future operator reviews the original target, all forbidden categories,
exact committed current code/HEAD/branch, manifest digest, and fixed 0109 context
review metadata. The implementation-parent SHA is historical metadata only.
The host checklist must explicitly acknowledge every item:

- Node major version at least 24 and the normal reviewed adapter module.
- No NODE_DEBUG environment setting or enabled native HTTP/HTTPS debug logger.
- No RAILWAY_API_TOKEN presence; RAILWAY_TOKEN provisioned privately outside Codex.
- No token in argv, PowerShell history, stdout/stderr, files/artifacts, or chat.
- No proxy override and HTTPS certificate verification enabled.
- First request only is projectToken context; stop on any error; no retry/fallback.
- No schema request before successful attestation in that same execution context.

These acknowledgements are operator attestations, not machine proof about a
future host. Exact keys and affirmative values are mandatory. No credential
field or environment-reader callback is accepted. Never paste a token into
ChatGPT/Codex: its value grants access and does not help review the safe facts.
Credential provisioning must occur privately on the separately reviewed host;
this document supplies no token-bearing command.

`reviewPackage` records `reviewed:true` only after all exact metadata matches.
It privately owns the original fixed context review and its one-use 0109
handoff. Its safe artifact remains PRELIVE_NOT_AUTHORIZED and supplies a final
acknowledgement template with `manualLiveAuthorization:false`.

Only a later separate human decision may set `manualLiveAuthorization:true`
and acknowledge the exact operation kind/name, manifest digest, reviewed HEAD/branch,
code identity digest, target review digest, inventory review digest, host review
digest and context-operation review digest. That decision must expressly
authorize one first-live context request on the reviewed disposable target.
Merely reviewing the package cannot grant live permission. No such decision
was given or actual-target ticket minted in 0110.

## Future trusted handoff and STOP conditions

A future separately authorized wrapper owns the one-use live ticket. It calls
`consumeLiveTicketForContext(ticket, originalTarget, originalManifest,
'project_token_context')` before reading any credential or opening HTTPS.
The ticket is deleted before argument/target/operation/version validation;
failures burn it. Success returns another opaque private one-use authority.
`takeContextExecutionAuthority(authority, originalTarget)` burns that authority,
rechecks code/HEAD and returns only the original private target and the
package-owned original 0109 context handoff. The trusted wrapper must then
immediately invoke the unchanged 0109 adapter open/execute path and consume
its private context result, with cleanup on success or failure. No token read
or adapter execution happens inside 0110. There is no public handoff override,
boolean authorization bypass, schema-ticket factory, or executor here.

This is a trusted operator wrapper design; the existing 0109 API is unchanged.
0110 cannot prevent unrelated code from directly calling that API. A future
live host must execute only the separately reviewed wrapper. It must not
serialize authorities or insert an unreviewed callback, async gap, or mutable
code change between authorization extraction and adapter invocation.

STOP before execution for unresolved/unreviewed IDs, unknown/incomplete inventory,
duplicates/malformed IDs, own-category forbidden collisions, wrong or copied
target/manifest/handle, missing/false/extra host or review metadata, absent exact
final human authorization, reused/burned ticket, HEAD/branch/source drift,
unreviewed wrapper or wrong operation. STOP for token-source conflict, missing
token, debug logging, proxy/TLS changes, or any violated host assertion.
During a future authorized operation, STOP for HTTP/redirect/authentication,
timeout, header/body-size, content-type/encoding, connection, malformed JSON,
GraphQL error, unexpected field, missing project/environment ID, or scope
mismatch. Close the execution context; do not retry, fall back, or continue to
schema inspection. An error never converts into provider evidence.

## Schema remains a separate gate

No live schema authorization exists in 0110. Schema inspection first needs a
successful real project/environment context attestation, the same execution
context and credential lifetime, fresh 0106 stage review, a fresh original
one-use schema permit, and a separate explicit schema-live authorization
decision. Proving project/environment scope first prevents schema observations
from being attributed to an unverified project. Schema observations still do
not prove service/runtime identity, causality or restart origin, and do not
authorize fresh disposable qualification.

Global values remain providerContextObserved=false,
projectEnvironmentContextProven=false, serviceContextProven=false,
executionSchemaReady=false; identity_proven, causality_proven,
restart_origin_proven and platformRestart are null. restartAttribution is
`{measurement:null, limitation:'restart_origin_unattributable'}`.
adapterImplemented, transportContractReady and providerContextAttestationReady
are locally true; manualLiveAuthorizationRequired remains true.

## NOT AUTHORIZED BY 0110

- No Railway request or Railway CLI.
- No Supabase request or GitHub API.
- No schema inspection or fresh qualification.
- No deployment, redeployment, restart, or provider-resource mutation.
- No production access or credential/cache inspection.
- No real credential environment value read.
- No staging, commit, or push.

All 99 migrations, normal worker, existing execution reader/child
adapter/supervisor, 0106 plan/validator, and existing 0107-0109 boundaries remain
unchanged. `0102-remote-fixtures.capsule` remains unread and untouched.
