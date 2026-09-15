# Mutual no-travel closure (0019, local draft)

0019 is lifecycle-only. It does not implement refunds, payment allocation,
completion UI, or movement-ID wrappers. Installed migrations 0001–0018 stay intact.

Both `request_movement_end(uuid,text)` and `confirm_movement_end(uuid)` retain
their signatures and authenticated grants. After two distinct principal consents:

| Locked state | Outcome |
| --- | --- |
| activated / not_started, no start/completion timestamp | cancelled / cancelled; mutual no-travel audit; no settlement |
| in_progress / in_progress | existing completed / completed and pending_amount settlement |

A pending start request is not a journey start. No-travel clears it and records
its old timestamp privately. No started_at or completed_at is fabricated. Payment
rows and activated_at remain untouched. Inconsistent existing settlement or
timestamp data causes rejection, not automatic historical repair.
The helper also requires a succeeded payment with a success timestamp and matching
alignment, offering-member payer, amount and currency, as in 0014. An activated
status alone cannot create this audit outcome. It reads payment evidence without
taking a reverse-order payment lock; trusted administrative payment changes remain
outside the client lifecycle contract.

The private audit table records journey_id, first_principal_id,
second_principal_id, first_consented_at, closed_at (also the second consent time),
invalidated_start_requested_at, and the fixed reason
`mutual_no_travel_after_activation`. Alignment is derivable through the journey.
Principal IDs preserve consent identity independently of later roster changes;
this is not a snapshot of every traveller. No client can read the table. Service
role has SELECT only; the owner-executed private helper writes it. No direct helper
execution is granted to service_role or clients.

First End remains pending. Same-person repeats do not add consent. Both terminal
End retries return safely without inserting again. Decline still clears pending
intent but cannot clear completed/cancelled/failed history. The existing status
RPC recognizes mutual_no_travel with no action required. Its existing signature
is retained; no new client surface is added.

Terminal journey and alignment guards prevent retained legacy server lifecycle
functions from reopening no-travel closure. Foreign keys retain the audit's
journey and principals. Database administrators remain trusted. No historical
settlements, payments, or verification events are rewritten.

## Concurrency and privacy

End and start confirmation use journey FOR UPDATE, then alignment FOR UPDATE.
Lifecycle decisions happen after these locks. Under READ COMMITTED a waiting
caller sees the winning update; stricter isolation may require retry after a
serialization error. If start wins, End completes normally. If closure wins,
both legacy and movement-ID start confirmation reject. Pending consent does not
reserve the unstarted state. No network call occurs inside this decision.

Cancellation retains the existing denial of photo/plate/coordination reveal.
0014 reveal helpers and 0018 start functions are not replaced. Cancellation also
falls outside 0016's active-roster freeze predicate; audit principals do not rely
on mutable movement_participants rows, and no reveal is reopened.
The current `MeetingJourney` component displays unavailable status after closure.
A future movement-ID terminal-status wrapper can provide "Movement closed" without
restoring photo/plate access. The legacy End status signature still returns its
existing journey ID; this task adds no wrapper or client exposure of audit records.

## Deferred financial and safety work

0007 does not separately represent platform matching/activation fees and
offering-member contributions. No-travel therefore creates no normal offering
settlement, but records no contribution-refund eligibility or execution. Trusted
component accounting (including actual payer, captured amount, currency and
idempotency) must precede contribution refunds. Historical payments are not split.
No amounts, fake refunded/refund_pending states, or provider operations are added.

The intended platform-fee policy is generally retention after activation, with
possible exceptional platform/system-fault refunds. This migration does not make
that fee permanently non-refundable. Contribution refunds remain future work.

The right to refuse physical travel does not depend on mutual agreement. This
migration handles only uncontested mutual closure. A separate unilateral
refusal/dispute workflow is still required. The recorded start handshake is not
independent proof of physical movement.

## Validation and installation boundary

Run the local static suite with `node supabase/tests/no_travel.test.cjs`.
The rollback SQL expects migrations 0001–0019 to be available in its transaction.
It uses actual role/JWT calls, trusted face/payment fixtures, BEGIN/ROLLBACK, and
no disabled triggers or replaced functions. It must be run in full; on an
unexpected SQL error issue ROLLBACK. Do not install anything as part of this task.

The rollback scenarios exercise both End entry points and both serial orderings
of start versus closure. They are NOT a two-connection concurrency test. Static
checks inspect the shared lock order; real PostgreSQL execution and a controlled
multi-session concurrency check remain required before claiming live race proof.
Earlier rollback tests encode their migration-era behavior (including 0014's
pre-start completion expectation); they are not rewritten by this migration.
Any review/remediation of historically completed journeys without started_at is a
separate operation. Installation itself changes no historical rows.

The second-pass rollback coverage additionally checks preactivation with an
administrator-created inconsistent journey, missing valid payment evidence,
decline authorization for nonprincipals, cancelled payment/start rejection,
completed decline rejection, exact overloads, PUBLIC privileges, and service audit
write denial. Invalid payment evidence is contained in a rolled-back fixture
subtransaction. These SQL assertions are not claimed as executed PostgreSQL tests.
