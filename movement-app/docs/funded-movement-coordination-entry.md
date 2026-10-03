# Funded movement coordination entry (0080)

Movement connects an independently intended movement. The `journeys` row here
is its existing technical coordination container, not new travel intent.

`open_my_funded_movement_coordination(movement_need_id)` is an explicit action
by the exact offering member or primary requester. Authenticated identity comes
from `auth.uid()`. Invited travellers, unrelated members, anonymous callers and
service-role public calls cannot construct it. The server derives every other
selector. The response contains only movement_need_id, journey_state=not_started
and coordination_ready=true.

The selector requires exactly one alignment, its exact 0079 activation receipt,
the 0078 funding graph/evidence, and the 0077 historical proposal/materialization
graph. It requires activated status and the accepted offer's vehicle to match the
immutable proposal vehicle. It does not repeat pending-offer authorization or
consume availability/capacity again. Natural vehicle access was established by
the trusted offer/materialization chain; no ownership proof is introduced.

An append-only private receipt is necessary because an arbitrary imported journey
row plus activation alone cannot prove 0080 construction. Its unique agreement,
alignment and journey references and finite creation instant contain no duplicated
money, members or vehicle data. RLS is enabled with no API table privileges.
Construction inserts the receipt before the journey, temporarily deferring only
the new journey FK, then drains that FK to its default IMMEDIATE mode. Errors roll
back the construction subtransaction and its constraint-mode change. The journey
INSERT guard requires that receipt; direct writers cannot fabricate a financial
container without provenance. Exact replay validates both records and performs
zero writes. A partial receipt or unproven journey is rejected, never repaired.

All financial coordination calls, including reads/meeting-point context, lock
agreement SHARE → alignment UPDATE → offer SHARE → journey SHARE (or UPDATE for
meeting-point mutation). Alignment UPDATE serializes simultaneous principals
without SHARE upgrades. Agreement first matches 0079 and avoids the 0020 deferred
agreement-validator inversion. Legacy journey-first lifecycle RPCs reject financial
selectors before taking locks. Direct journey/alignment/offer guards acquire no
reverse graph locks. Entry takes no member, wallet, need or proposal UPDATE locks.
Profile revocation remains independent; reveal waits for the validated alignment.
Creation uses clock_timestamp after validation and waits; replay keeps the stored
creation instant. Public responses need no timestamp or internal IDs.

Financial journey and activated alignment lifecycle fields are frozen. Retained
start, end, completion and no-travel RPCs fail closed; direct trusted writes cannot
advance status, rewrite timestamps, rebind or delete the financial journey. The
accepted funded offer is immutable. Legacy settlement INSERT/UPDATE also rejects
financial alignment/journey selectors. Existing non-financial branches are retained
verbatim after the early guards and tested through real producers. No automatic
financial journey trigger is restored. Existing financial imports without exact
0080 receipts fail closed and require separate review; no backfill is invented.

Human-text meeting points retain existing principal edit/revision rules. Confirmed
invited travellers retain read access without mutation controls. Both financial
start capabilities are false. The 0056 in_progress recovery predicate is unchanged;
not_started containers are not active movements. Existing accepted continuations
still lead to verification using only the movement need ID.

`get_my_funded_movement_coordination_readiness(movement_need_id)` is a narrow
authenticated principal read. It proves funded activation and any existing entry,
returns only the need ID and funded_activated=true, and constructs nothing. A false
flag is returned only for a validated existing legacy not_started container and
allows explicit legacy navigation after a fresh read; it does not qualify for
the funded construction RPC. Empty results grant neither continuation. This
is needed because the legacy payment endpoint recognizes only the offerer. The
activation card uses this observation to expose the explicit continuation to either
principal. Only a tap invokes entry; success precedes navigation. Duplicate taps
coalesce, failures show generic copy, and account/focus/background cleanup aborts
requests and drops stale navigation. Rendering, recovery, polling, face/funding
success and activation do not construct coordination.

Verification before installation runs source DDL and behavioral fixtures in rolled
back transactions; concurrent sessions use committed source solely in a disposable
template0 schema clone. Ordinary ACLs remain; only DEFAULT ACL archive records
are removed. Installed mode compares every covered function signature/body/security
attribute/ACL to source and rejects drift without replacing definitions. Cleanup
and application catalog/data/ACL/RLS/migration-history fingerprints run on failure.
No persistent local installation or migration-history write is performed.

Run the focused portable suite, then the 0080 behavioral and concurrency runners,
then `node --test`, TypeScript with `--noEmit`, and whitespace checks. Installed
mode still needs verification after a separately authorized normal installation.
