# 0079 funded movement activation

Activation is an explicit authenticated requester action: `activate_my_funded_movement(agreement_id, expected_version)`. Offering consent was already recorded by 0076/0077; 0078 funding is requester-owned. Neither unrelated travellers nor service role can call this action. Inputs contain no money, operational identifiers, face selectors or desired status.

First activation validates the complete 0077 graph via `movement_funding_agreement`, the exact immutable 0078 receipt/transactions/postings via `movement_funding_evidence`, and the unchanged `assert_alignment_face_ready` gate. After all waits, it records one `clock_timestamp()` and evaluates the existing exact-current face predicate again at that precise instant. The agreement must be current and the alignment must be awaiting activation with no activation timestamp.

Only alignment status, activated_at and updated_at change. Two private, RLS-enabled, API-inaccessible, append-only tables record the exact agreement/alignment/instant and the exact required members' successful face session IDs. No monetary fields are duplicated. No wallet posting, release, settlement, journey, notification, chat, payout or provider action occurs.

Replay validates the original materialization and funding, exact activation receipt and timestamp, exact immutable snapshot roster plus offerer, and each recorded session's alignment/member/liveness/match/completion/expiry at activated_at. It also rejects an attempt newer than the recorded session that had already begun at activated_at. Current photo flags, member flags and current wall-clock face expiry are deliberately not historical prerequisites: the immutable receipt certifies that the unchanged readiness gate checked those at activation. Replay returns the current locked alignment status and the original timestamp without writes. Existing lifecycle statuses activated, in_progress, completed and cancelled are supported; failed is rejected. Agreement supersession after activation preserves replay, while supersession before activation prevents construction.

Lock order: agreement SHARE, alignment UPDATE (SHARE for projection), existing graph's offer SHARE, then existing face gate's need UPDATE and required members UPDATE in UUID order. The agreement lock precedes alignment UPDATE to avoid both duplicate SHARE upgrades and the existing agreement-supersession agreement UPDATE -> alignment SHARE cycle. Funding's alignment SHARE -> agreement SHARE -> requester member UPDATE remains compatible. No proposal UPDATE, wallet account lock or journey lock is introduced. Identity producers use alignment -> member; photo replacement/revocation use member. Projection takes member SHARE and rechecks funding after any wait.

The forward migration guards legacy payment creation, payment success and the legacy payment projection, plus direct payment writes and alignment activation. Any linked financial agreement/proposal makes the legacy path fail closed, including service-role success calls and pre-cutover pending payments. Non-financial activation retains the old payment RPCs, journey trigger and reveal evidence. Pre-cutover financial alignments already activated through legacy payments are not grandfathered into funded activation: no receipts are backfilled, and such records fail closed at the new funded/reveal boundary rather than being treated as 0079-authorized history. Their handling requires separate review. Financial activation skips the automatic journey trigger and reveal accepts fully validated funded activation evidence without requiring a legacy payment or a journey. Existing viewer/subject/vehicle/photo boundaries remain unchanged; activation itself returns no reveal data.

`get_my_movement_activation_status(agreement_id, expected_version)` is requester-only and read-only. It returns exact bounded selectors, persisted lifecycle status, funding_required / identity_required / ready_to_activate / activated, and the activation timestamp. Readiness is an observation, not a reservation. The mutation repeats all live checks. Client service functions validate UUID/version before transport, exact keys/statuses/timestamps after transport, and hide database errors behind movement_activation_unavailable. Nothing invokes activation automatically. Existing legacy UI has no authoritative financial price and its payment backend now fails before provider setup for financial alignments; unavailable-state copy now says activation setup rather than payment setup. No UI redesign or automatic continuation is added.

## Journey boundary

0079 creates no journey. Existing meeting-point, start, no-travel and completion RPCs require an already existing journey; they therefore cannot advance a newly funded alignment in this milestone. A separate reviewed journey-construction milestone is required before those actions become reachable. Their lock and state contracts are unchanged. Receipt replay supports their existing post-activation lifecycle states structurally; real financial lifecycle advancement after activation is not fabricated in these fixtures. Cancellation and start attempts without a journey fail closed.

## Verification runners

Behavior uses rolled-back DDL/fixtures before installation and actual installed definitions after normal installation. Concurrency uses a schema-only disposable template0 clone, preserving ordinary ACLs and removing only DEFAULT ACL archive entries. Installed mode never replaces application definitions; pre-install source is committed only inside the disposable clone so all race sessions see it. Every covered function body/signature/security/search-path/ACL is compared to source; mismatch fails without overwriting installed definitions. Application data/catalog/ACL/RLS/history fingerprint and cleanup checks run on failures too. No migration-history writes occur.

The pre-install concurrency suite additionally creates a genuine pending legacy payment through the installed 0078-era producer before applying 0079 to the clone. It proves the retained service success RPC cannot activate that financial alignment. Installed mode cannot legally create such a past payment through 0079, so this historical fixture is source-mode only; installed mode retains the other races and direct legacy-creation rejection. No trigger is disabled and no protected history is rewritten.

Commands:

- `node --test tests/fundedMovementActivation.test.cjs supabase/tests/financial_agreement.test.cjs supabase/tests/financial_proposal.test.cjs`
- `node supabase/tests/0079_funded_movement_activation_behavior.cjs`
- `node supabase/tests/0079_funded_movement_activation_concurrency.cjs`
- `node --test`
- `node node_modules/typescript/bin/tsc --noEmit`
- `git diff --check`

0079 has not been persistently installed by this implementation. Installed-mode behavior and actual later financial journey lifecycle advancement remain to be verified after their respective prerequisites exist.
