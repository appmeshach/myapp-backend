# Financial movement start (0081)

We do not create journeys. This handshake starts the technical lifecycle of an
independently intended, accepted, held, funded-activated and explicitly coordinated
movement. It creates no travel intent and uses no GPS or new paid service.

`request_my_funded_movement_start(movement_need_id)` accepts only the exact offerer.
`confirm_my_funded_movement_start(movement_need_id)` accepts only the exact primary
requester. The only public selector is the need UUID. Authenticated `auth.uid()`
supplies identity; invited travellers, unrelated members, anonymous users and
service-role public calls cannot act. Every operational identity derives from the
existing graph. Private tables have RLS and no API grants.

The selector retains 0080's agreement SHARE → alignment UPDATE → offer SHARE order,
then locks the exact journey UPDATE and existing meeting point SHARE. It validates
0077's immutable materialization, 0078's exact requester component holds/postings,
0079's historical funded activation and face evidence, and 0080's entry receipt,
accepted vehicle and unique journey. It does not consume capacity again or demand
current proposal/face expiry. Consent-preserving agreement supersession remains
compatible. Read committed is required. Direct guards take no reverse graph locks.

Request requires activated/not_started state, no confirmation or terminal evidence,
and an existing valid human-text meeting point. The append-only request binds the
alignment, journey, trusted request instant and frozen canonical point revision.
Principal identities remain derivable from the immutable funded alignment. The
receipt INSERT guard also requires the exact actor. Request changes only the
journey's request timestamp and normal updated timestamp. Editing then freezes,
including direct trusted point mutation/deletion. Request never creates or repairs
a meeting point, roster, offer, journey, activation or funding.

Confirmation requires the exact request. One `clock_timestamp()` captured after
all waits becomes both the immutable start receipt time and journey.started_at.
Journey and alignment advance together to in_progress; request/activation/creation
times, identity, vehicle, money and all end/completion fields remain unchanged.
Receipt-first row guards allow only these exact transition shapes. Four narrowly
deferred new completeness constraints validate the final graph and are drained
back to IMMEDIATE inside an exception subtransaction. Partial receipts, one-row
transitions and mismatched timestamps cannot commit. No bypass variable exists.

Exact request and confirmation replay revalidate historical provenance and return
persisted state/time with zero writes. Entry replay also accepts the genuinely
started graph. The entry client strictly accepts not_started or in_progress, so an
entry retry after start can navigate to the same coordination screen.

The old eight-field coordination/status and meeting-point mutation signatures
remain compatible. The additive `get_my_movement_start_status` read exposes those
same fields plus `start_authority=legacy|funded`, with no internal IDs. Only this
authoritative projection selects the client mutation path. Financial request and
confirmation return its exact shape. Old generic journey-ID and need-based start
RPCs remain blocked for financial movements; non-financial behavior is unchanged.

The existing coordination screen has explicit Request movement start / Confirm
movement start buttons. Read, save, mount, focus and foreground never start a
movement. Mutation responses are strictly parsed; legacy-shaped mutations obtain
a fresh extended read before publishing authority. Synchronous busy guards coalesce
taps. Account/background/focus/unmount cleanup aborts and invalidates old generations;
late responses cannot publish. Errors remain generic and retryable via refresh.

0056 active recovery is unchanged: not_started stays excluded, genuine in_progress
is included for the two principals, and reads do not write. Existing recovery
navigation remains need-only. Reveal retains its existing viewer/subject fields.
No identity, precise location, tracking, chat or notification surface is added.

Funds remain held throughout in_progress. Start writes no wallet transaction or
posting, balance, agreement economics, component, proposal, pricing, route evidence,
payment, release, refund, revenue, payout, settlement, provider, chat or notification.
Financial offer immutability and every legacy end/completion/settlement rejection
remain installed. Financial completed/cancelled/failed transitions are unavailable.

Future pre-start mutual cancellation requires reviewed held-funds release/refund
authority. After-start abnormal termination requires a separate disposition policy.
Successful completion requires exact 70/30 component settlement. This milestone
does not invent fees, penalties, forfeiture or partial settlement.

Before installation, behavioral source verification uses rollback-only DDL and
fixtures. Concurrent sessions see committed source solely in a disposable template0
schema clone. Ordinary ACLs are restored; only DEFAULT ACL archive entries are
excluded. Source definitions, signatures, owners, security attributes and ACLs are
verified in the clone. Installed mode rejects drift without replacing definitions.
Cleanup and application data/catalog/ACL/RLS/migration-history fingerprints run on
failure too. No persistent local install or migration-history write is performed.

Commands:

    node --test tests/financialMovementStart.test.cjs tests/meetingJourney.test.cjs
    node supabase/tests/0081_financial_movement_start_behavior.cjs
    node supabase/tests/0081_financial_movement_start_concurrency.cjs
    node --test
    node node_modules/typescript/bin/tsc --noEmit
    git diff --check

Installed-mode database verification requires a separately authorized normal local
installation. Historical migrations 0001–0080 are not changed or repaired.

Source verification passed 191 behavioral checks (96 normal and 95 zero-share),
21 concurrency scenarios with 22 observed blocking relationships, 206 targeted
portable checks, and the full Node suite (1,550 passed, one skipped). TypeScript
and whitespace checks passed. Clone cleanup and application fingerprints matched.
An earlier isolated confirmation rejection (23514, Exact offerer request required)
was not reproduced in eight subsequent complete behavioral runs; its cause remains
unproven. The checks
were retained unchanged and the behavioral fixture retains graph/clock diagnostics
for any recurrence. No persistent installation was performed.
