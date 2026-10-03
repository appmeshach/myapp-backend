# Requester movement funding hold (0078)

The member RPC `hold_my_movement_funds(agreement_id, expected_version)` is an
explicit user action. It moves existing requester NGN balance from available to
held. It does not create money, activate an alignment, pay a provider, recognize
revenue, settle an obligation, release funds, or credit the offering member.

Only `requester_platform_share` and `movement_contribution` components from the
exact accepted materialized agreement supply amounts. A positive component gets
one deterministic `movement_hold:<component UUID>` transaction and exactly two
postings: requester available debit and requester held credit. A partial unique
index independently prevents a second initial hold of that component. Zero
components need no transaction or posting.

An immutable agreement completion receipt prevents partial history from being
silently repaired and represents a zero-only obligation if a future supported
agreement can contain one. `fully_held_at` is the latest positive hold transaction
creation time; for a zero-only obligation it is the persisted receipt completion
time. Current trusted pricing permits a zero requester platform share; a zero-only
pair is not produced by the current positive occupied-seat policy.

Authorization uses auth.uid(), exact requester/need ownership, exact version,
immutable proposal provenance, and the existing 0077 complete graph validator.
First funding requires a current pre-activation alignment/agreement and a complete
active existing wallet. No provisioning occurs in this RPC. Required sums and
ledger balances accumulate as numeric; unsupported bigint range or insufficient
available funds fail before writes. Held and withdrawable balances are checked
for corrupt negative/overflow states as well.

Lock order is immutable discovery, alignment SHARE, offer SHARE, agreement SHARE,
then requester member UPDATE, then existing wallet accounts UPDATE by UUID. The
0077 validator supplies the first shared locks; no proposal or need UPDATE is
introduced. Agreement SHARE is compatible with the 0020 deferred validator's
alignment SHARE; lifecycle changes take alignment UPDATE before the member gate.
Provisioning/top-up take member UPDATE before wallet account locks. Account
closure serializes on the locked account. The read projection takes member SHARE
at the same gate before reading the receipt so it cannot report intermediate
construction across a commit.

Historical replay requires the exact persisted receipt, component transactions,
account identities, amounts, currencies, directions and two balanced postings per
positive component. It never uses current aggregate balance as hold evidence and
does not require accounts still active, a proposal still unexpired, or alignment
still pre-activation. It accepts 0077's supported lifecycle states and the exact
linked superseded agreement. It creates no new rows.

`get_my_movement_funding_status(agreement_id)` exposes the same eight-field shape,
with only `not_held` or `held`. It is requester-only and creates nothing. The client
seam validates selectors and exact safe responses; no UI or automatic invocation
has been added.

Verification commands:

    node --test tests/requesterMovementFundingHold.test.cjs
    node supabase/tests/0078_requester_movement_funding_hold_behavior.cjs
    node supabase/tests/0078_requester_movement_funding_hold_concurrency.cjs

Behavioral verification temporarily loads 0078 inside an outer rollback transaction
and compares application data/catalog/ACL/history fingerprints afterward.
Concurrency verification installs source only into a disposable schema-only clone,
preserves ordinary ACLs, excludes only archive DEFAULT ACL records, requires actual
PostgreSQL lock waits, drops the clone, and verifies the application fingerprint.
Neither runner installs 0078 persistently or changes migration history.
