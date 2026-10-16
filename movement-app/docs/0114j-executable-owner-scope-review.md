# 0114J executable-owner scope review

outcome: SCOPE_APPROVED_ADD_SINGLE_OWNER_HOST

startingHead: `d1cbc7cf4c2308b3286d3816e7d4106941ea3d82`

reviewedBranch: `feature/0092-shared-segment-suitability`

implementationAuthorized: false

providerAuthorized: false

This selects a future scope, not implemented singleton enforcement. The attempted
narrow correction stopped with PLAN_SCOPE_CHANGE_REQUIRED and changed no files.
The existing [implementation plan](0114j-qualification-lifecycle-implementation-plan.md)
and [critical review](0114j-qualification-lifecycle-implementation-plan-review.md)
remain unchanged. They require correction and renewed review before implementation
authorization. This is a Codex architecture review, not independent human approval.

## Repository evidence

Offline searches for the three owner modules and acquisition APIs find their runtime
definitions, cross-imports and test/fixture callers; no production acquisition driver
was found. scripts/assessment-worker/package.json starts node run.cjs. That file
owns the polling assessment worker/backend/shutdown, not Railway acquisition.
Its main-module status cannot be borrowed as an acquisition launch guarantee.

Authorization installs redeemAcquisitionTicketForWrapper through the wrapper's
temporary _connectAcquisitionRedemption slot, and consumeAcquisitionTarget through
identity's _connectAcquisitionTargetConsumer slot. Slots are deleted and exports
frozen. Those links prevent extracting/reusing an original private authority through
public data. They are one-use per initialized module instance, not a surviving
process-wide admission anchor if the entire three-module graph is recreated.

The HTTPS adapter's requireOwner resolves identity when a transfer is bound and then
captures it for that transfer. This protects an existing transfer from replacement;
it does not remember the first authorization graph for the process. Its provider-
boundary connector is an adapter-receipt consumer, not an acquisition-host latch.

Read the corrected 0114I design, renewed B1 review, 0114D wrapper record, reviewed
0114H design/implementation and readiness register. Current 0110-0114 tests use
normal imports, node -e import-order probes and independent VM fixture caches. They
do not establish a production acquisition host. No tests or runtime probes were run.

## Options 1-5

| Option | Assessment |
| --- | --- |
| 1. Dedicated owner host | Select with an explicit main-only startup contract, private linkage and immutable canonical cache bindings. A freely reloadable new library alone would merely move the defect. |
| 2. Existing run.cjs | Reject: mixes acquisition credentials/authority with unrelated assessment polling, backend access and shutdown. No current acquisition use supports that coupling. |
| 3. Symbol.for/globalThis anchor | Reject: discoverable process/realm storage is not private; non-enumerability/freezing does not establish authorized first ownership. A mutable global registry conflicts with the reviewed boundary. |
| 4. Canonical module/cache key alone | Reject: deleting a cache entry can create new private variables. An external original anchor is necessary; adding that anchor reduces to selected Option 1. |
| 5. Other latent design | Existing target bindings, adapter receipts and context-only authorities do not supply the needed first-owner anchor. No narrower established architecture was found. Immutable cache binding is a supporting mechanism for Option 1, not a stand-alone new registry. |

## Selected host and exact future production scope

Add exactly one file:
`scripts/assessment-worker/qualification-railway-acquisition-owner-host.cjs`.

The future runtime patch is that host plus the three already planned files:
qualification-railway-live-authorization.cjs,
qualification-railway-acquisition-wrapper.cjs, and
qualification-railway-target-identity.cjs, all under scripts/assessment-worker/.
The host bootstraps/anchors; authorization remains sole owner of assertion Maps and
their claim/closure transitions. Wrapper owns resource cleanup; identity owns session
semantics. Do not move admission state into the host or duplicate it there.

No package.json or run.cjs change. No adapter, target binder, provider-boundary or
other production file change is selected. No new custom command parser, network
listener, input protocol, driver plugin or callback-loading interface is included.

This intentionally adds an explicit Node entrypoint. Supported startup is:
`node --interactive scripts/assessment-worker/qualification-railway-acquisition-owner-host.cjs`
from the reviewed worktree, on the main Node thread. The native trusted-operator
Node console can obtain the host's frozen operation facade by requiring the same
canonical host file after startup. A plain node HOST invocation may bootstrap and
exit without doing acquisition; it is not an unattended acquisition command.
No custom provider CLI, automatic acquisition or npm start hook is added.

This is a newly specified host contract, not a claim that the repository already
implements or tested it. The corrected plan must require real child-process tests
of this exact startup mode on the supported Node version, including console/main
identity behavior. If that contract does not hold, stop for renewed scope review;
do not silently substitute node -e, a preload or a generic driver.

Normal import when this file is NOT the actual main never bootstraps. It exports
only frozen inert availability information and performs no host enablement. Main
startup performs local linkage only: no credentials, context opening or requests.
Execution still requires the separate explicit input/context/package/manual reviews
and existing operation calls. Only a trusted operator/controller in the selected
host process may use the operation facade. No caller supplies a raw owner capability.

## Stable anchor and initialization proof obligation

The new host must execute as the genuine Node CommonJS main Module: real Module
instance, main thread, require.main === module, canonical realpath/file identity,
and the original matching cache entry. Validate this before enabling anything.
There is only one actual main in the supported trusted process. A file imported by
another main, a copied file loaded as a child, VM-emulated module or worker cannot
become that original main. This replaces the unverified arbitrary-main assumption
with a named startup contract. No traversal of unrelated module.children graphs
is required as the security root.

During this main startup, the host creates one private nonserializable seal and a
private host-validity closure, neither exported nor placed on globalThis/process.
It publishes one temporary initialization-only connector before requiring the
canonical authorization/wrapper/identity graph. Authorization's initialization
uses that connector to bind its original Module/exports and private host-install
closure. The host verifies the literal original graph and supplies the seal/guard
only to that authorization closure. Wrapper and identity receive host association
only through their existing authorization-owned private initialization links.

After graph linking, but BEFORE enabling any acquisition API, the host pins exactly
four canonical require.cache properties: its own and the three owner modules'.
Use existing Node cache properties with their original Module value, non-writable
and non-configurable; also make each original Module.exports property non-writable/
non-configurable after final exports assignment. Freeze exported facades as before;
do not freeze entire Module objects or unrelated cache entries. Verify descriptors,
canonical realpaths and literal identities. Cache/module metadata checks may use
I/O during initialization; no provider operation is performed.

Then consume/delete all temporary host/owner connectors, seal exports and enable
the one graph. A bootstrap exception leaves no enabled graph and no reinitialize
path; any partial immutable bindings are fail-closed until process exit. First
inert import cannot be upgraded later by calling a public enable method.

Pinning is an explicit scope consequence, not an assumption that ordinary cache
equality proves a singleton. Strict-mode deletion/replacement of a pinned entry
throws; otherwise it fails without changing the entry. A subsequent canonical
require returns the original Module. No new cache entry for that canonical key can
replace it through supported reload. A copied graph at other paths lacks the
original host seal and cannot claim, publish acquisition review, issue or redeem a
ticket. A copied host imported there is not main and cannot mint another seal.

These are fixed immutable bindings in Node's existing loader cache, not an added
public mutable owner/admission registry. They expose no raw seal, maps, cleanup
carrier, owner getter, reset or reinitialize API. Observable cache metadata is not
claimed secret. Replacing the whole loader cache, forging main Module identity or
patching built-ins remains outside the trusted-host model. Cache pinning and the
new private host connection must be explicitly reviewed in the corrected plan.

## Executable API gating

All below preserve existing review/authorization requirements; possession of a host
facade is never manual acquisition approval. The host exports bounded operation
wrappers, not its seal or a generic capability factory. Direct module APIs can work
only on the original host-enabled graph; inert copies fail before assertion claim.

| Function | Classification and host rule |
| --- | --- |
| createExecutableAcquisitionDraft | First host-gated boundary: require privately installed original host association BEFORE claim or review-capability publication. |
| reviewExecutableAcquisitionPackage | Review-only but graph-bearing; require original host/draft association. |
| approveExecutableAcquisitionPackageReview | Approval transition; same association plus original human/context/host acknowledgement. |
| authorizeAcquisition | Authority-creating; host association plus separate exact manual authorization. |
| beginAuthorizedAcquisition | Executable; original host-owned ticket and private redemption/setup chain only. |
| takePendingHumanReview | Review interaction; only original host-owned run/gate. |
| submitServiceReview | Executable continuation after mandatory service gate; original host/run. |
| submitTargetReview | Executable completion after final gate; original host/run. |
| cancelAcquisition | Cancellation-only on original run; remains available for terminal cleanup even after host/lifetime failure. Never grants authority. |
| cancelExecutableAcquisitionDraft | Planned cancellation-only operation, not current code; original draft only, no admission registry lookup or capability extraction. |
| reviewTemplate/acquisitionReviewTemplate/executableAcquisitionReviewTemplate, verifyCodeIdentity | Inert local descriptions/validation; no acquisition enablement merely by import/call. |
| createAcquisitionDraft/reviewAcquisitionPackage/approveAcquisitionPackageReview | Planning-only; no new execution authority. |
| Legacy first-context APIs/0113 | Retain separately constrained context-only behavior; cannot redeem acquisition tickets or continue to services/instance. No new authority is conferred by the host. |
| Identity/adapter public functions | Existing exact original-permit/session/context requirements remain; cannot independently mint host association or an acquisition graph. |

## Duplicate-graph cases

"Executable" below always assumes separately completed review and manual
authorization; nothing is exercised in this scope-review task.

| Case | Inert import | Acquisition admission | Reason |
| --- | --- | --- | --- |
| 1. Canonical host as the documented main | Yes | Original graph only | One private startup seal; immutable bindings before enablement. |
| 2. Second require of canonical path in that process | Yes | Same original graph only | Cached frozen facade, not a second initialization. |
| 3. Cache deletion then canonical require | Yes via original binding | No new graph | Deletion/replacement fails; subsequent require returns original. Re-evaluated uncached code has no host seal. |
| 4. Copied authorization file | Inert or initialization rejection | No | Not the host-captured original Module; no private enablement. |
| 5. Copied complete owner/wrapper/identity set | Inert or rejection | No | Fresh local connectors cannot mint the original main-host seal. Copied host as a child is inert. |
| 6. Replacement wrapper | Inert or rejection | No replacement graph | Canonical cache/exports replacement fails; copy lacks original private linkage. |
| 7. Replacement identity | Inert or rejection | No replacement graph | Same immutable binding and host association rule. |
| 8. Stale connector | Import need not invoke it | No | Deleted one-use slots and spent startup state; no enable getter. |
| 9. Independent VM context | Inert/fixture-only or rejection | No independent graph | Emulated Module/main/cache is not genuine startup; no seal. |
| 10. Worker thread | Inert or rejection | No | Main-thread/main-host checks prevent a second isolate domain. |
| 11. node -e importing canonical modules in its own process | Yes | No | Host was not started as the named main. Existing import-order probes remain valid as inert tests. |
| 12. ESM importing CJS from another entry | Yes | No new graph | Import cannot become host main. A bridge inside an already enabled host can only refer to its original facade. |

A copied host launched as main in a DIFFERENT Node process is a new process under
the existing fresh-review/manual-authorization rule, not a violation of same-process
B1. No global cross-process replay guarantee is added.

Do not claim that JavaScript facade functions can authenticate their caller's realm.
If trusted host code deliberately hands its original facade to a VM/ESM bridge,
calls still route the one original graph, not a VM-owned admission domain. Such
delegation is not an approved independent production host and creates no new seal.
This scope guarantees owner-domain uniqueness, not a sandbox against arbitrary
trusted-process code. No public owner capability is extractable from the facade.

## Future offline proof and test scope

The plan correction must add genuine Node child-process tests, not only VM fixtures:

- Documented main-host startup enables the original graph using synthetic input,
  fake transport/clock and zero real credentials; no token/context/request at bootstrap.
- Same canonical require/relative/absolute alias preserves identity. Strict and
  non-strict deletion/replacement of each pinned cache/exports binding cannot replace
  it; the original graph can still claim after rejected duplicate/reload attempts.
- Copied file, copied full graph including host, stale connector and replacement
  wrapper/identity cannot claim or issue a ticket even with matching source bytes.
- node -e, ESM-main import, independent VM and worker imports remain inert/rejected;
  no second graph can obtain private enablement or issue authority.
- Genuine private handles remain one-use; enumerate exports/descriptors to prove
  no seal/getter/reset/installer/registry survives bootstrap. Early bootstrap failure
  cannot be retried into enablement in that process.
- Exercise native --interactive main/console identity without real provider access;
  no fixture-only claim that the launch contract works. Close stdin/process cleanly.

Synthetic hosts may be loaded in isolated child processes/VM test loaders with
test-only built-in substitutions. Do not add production callback/clock/token/host
injection, patchable source switches or environment overrides. All tests are future
work; none run now. Exact test paths and template regeneration belong in corrected
0114J plan scope and need renewed review before implementation.

## R2, pins and data consequences

R2 remains pending and is not corrected here. The new first host-gated admission
boundary adds a phase-1 host/module/source validation step before claim. Its final
pure deadline/state fence must occur after that work; all previously identified R2
transition fences, including validity-only result release after cleanup, remain
required. Bootstrap before any assertion exists is local linkage, not lifecycle
activation. Host validity never replaces lifecycle or manual authorization.

Pin architecture change is explicit: add this host as a THIRTEENTH pinned runtime
source in authorization. Do not remove an existing safety pin or disguise the host
as a fixture/document to preserve twelve. Authorization stays separately self-hashed;
wrapper/identity pins still change. Adapter and target-binder pins remain unchanged.
Host linkage must avoid reciprocal embedded self-digest cycles: authorization pins
host source; host checks literal original module identities and uses authorization's
existing source/code verification. No new hash is calculated here.

The reviewed twelve-pin architecture must therefore be reconsidered explicitly in
renewed plan review, including safe-template identities and pin-count tests. This
scope decision does not edit the reviewed design, plan or historical pin records.

No input-v3/executable-v4/activation-v1 schema or lifecycleReview descriptor change
is selected. Current package stays byte-identical with lifecycle null. Safe templates
will need the future thirteenth source identity while remaining inert. Provider
request ceiling, both human gates, same session/context, nullable instance, exact
name/ID rules, thirty-minute expiry, target reuse and B1 invariant are unchanged.
No database, durable coordination, migration, environment/credential inspection or
provider behavior is introduced by bootstrap.

## Trust boundary, disposition and next milestone

Trust genuine Node startup, built-ins, reviewed source/filesystem and loader
integrity. Prevent ordinary supported duplicate/import/reload paths; do not claim
defense against arbitrary pre-start code injection, replacing every loader object,
patched built-ins, or a compromised host. No runtime observation is needed to make
this scope decision; later implementation must prove the new startup contract.

Selected future scope is one new owner host plus the original three runtime files,
with an explicit thirteen-pin proposal. No broader architecture or durable state
is selected. No stop condition was encountered within this narrow scope decision.

Next milestone: separately authorized 0114J plan correction incorporating this
main-host/private-link/immutable-binding scope and thirteen-pin change, plus the
still-pending R2 final pure fences; then renewed plan review. Separate implementation
authorization may not yet be requested. No runtime implementation, provider/live
execution, package promotion, lifecycle activation, staging, commit or push is
authorized. No capsule, credentials, secrets, provider, external or loopback network
was accessed. Only this scope review and the readiness outcome are written now.
