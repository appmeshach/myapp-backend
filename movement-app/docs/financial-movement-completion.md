# Successful financial movement completion

0083 is a forward migration only, following 0082 trusted temporal evidence hardening. We do not create journeys: it completes the
already intended movement whose funded activation, coordination and confirmed
start have immutable evidence from 0077–0081. No cancellation, abnormal end,
refund, payment provider, external withdrawal or notification is introduced.

The exact offerer explicitly requests completion. The exact primary requester
explicitly confirms it. Public RPCs accept only the movement need UUID and use
`auth.uid()`; only authenticated execution is granted. Invited participants and
service-role API callers cannot act. Read/refresh/recovery never initiates either
mutation. Completion has its own bounded six-field safe projection, without
internal identifiers or monetary amounts.

Private append-only completion-request and completion receipts bind the exact
agreement, alignment and journey. Timestamps are finite and checked against the
exact start/request history. Both receipts have unique agreement and journey
bindings, RLS and no API table privileges. The final completion receipt and
journey share one `clock_timestamp()` instant captured after all lock waits.

Settlement uses the three immutable stored components, never a new percentage
calculation. With requester share R, contribution C and offering share O:

| Transaction | Debit | Credit | Amount |
| --- | --- | --- | --- |
| requester_platform_charge | requester member_held | platform platform_revenue | R |
| movement_contribution_settlement | requester member_held | offerer member_withdrawable | C |
| offering_platform_charge | offerer member_withdrawable | platform platform_revenue | O |

Requester held decreases by R+C; offerer withdrawable increases by C-O=G-F;
platform revenue increases by R+O=F. Contribution is posted before the offering
charge. Numeric balance preflight includes the intermediate C credit, final
nonnegative balances and bigint bounds. The initial component-specific hold
transactions remain historical authority, even after their held balance is spent.
An aggregate balance alone is insufficient evidence. Zero components produce no
transactions or postings.

The offerer can have no wallet yet. Existing malformed, partial or closed NGN
wallets fail; the trusted provisioning primitive creates only a wholly absent
three-account wallet. Provisioning and platform-account setup are in the same
exception subtransaction as completion, so failure restores them. The existing
system-account partial unique index and ON CONFLICT serialize creation of one
NGN platform-revenue account, with no fake member. A closed account is not repaired.

The request receipt and journey request timestamp are constructed in one SQL
statement. Confirmation likewise uses one writable-CTE statement for the final
receipt, component transactions, exact postings and both completed lifecycle
rows. RETURNING dependencies carry identities between writes; the journey update
exhausts the postings stage before the alignment update consumes its result.
Immediate constraint triggers see the complete graph at statement end. Deferred
callers retain their selected timing, and every confirmation still explicitly
asserts the complete graph (including historical wallet balance checks) before
returning. Neither public completion writer executes SET CONSTRAINTS. Arbitrary
incoming wallet/completion/start constraint modes remain unchanged, including on
replay and rollback. Historical multi-statement top-up producers continue to
require their normal DEFERRED wallet mode; completion no longer changes it.
Any exception rolls back this construction. No legacy movement_settlements row is
created. Existing old financial start/end/completion/settlement paths remain
blocked. Nonfinancial paths retain their behavior.

The historical validator proves both the uncompleted graph and the completed
graph. Completed provenance requires exact deterministic component keys, kinds,
currency, parties, alignment, null provider fields, timestamps, exactly two exact
postings per positive component and balanced transactions. Zero components must
have neither transactions nor key collisions. Competing transactions and partial
graphs fail closed. Current balances, proposal expiry, face freshness and account
closure are not historical replay authority. Consent-preserving agreement
supersession remains valid. Request, confirmation and 0081/entry replay write
nothing and return authoritative persisted state.

Completed recovery keeps the legacy branch and adds a separate financial branch
through the normal canonical coordination context and validated completion
receipt. A financial movement leaves active recovery and returns as settled
without fabricating legacy end evidence or settlement rows. Existing safe recovery
response fields remain unchanged.

## Lock order

Completion uses agreement SHARE → alignment UPDATE → accepted offer SHARE →
journey UPDATE → both member UPDATE gates in UUID order → existing member accounts
UPDATE in UUID order → offerer provisioning → platform-revenue UPDATE. All waits
precede the completion clock. Provisioning's member UPDATE and account SHARE are
reentrant under those stronger locks; an absent wallet's new accounts belong to
the same transaction. There is no competing SHARE-to-UPDATE upgrade.

0077 historical replay takes proposal UPDATE → alignment SHARE → offer SHARE →
agreement SHARE; completion never takes proposal UPDATE. 0077 construction drops
its live construction locks before historical replay. 0078 funding takes the
historical alignment/offer/agreement shared locks before the requester member
gate. 0079 activation and 0080/0081 operations use compatible agreement →
alignment → offer ordering. Agreement supersession takes agreement UPDATE before
its deferred alignment SHARE validation, so it waits before conflicting with
completion's alignment lock.

Top-up takes its event lock → member UPDATE → member account/provisioning locks
→ provider-clearing SHARE → available UPDATE; it acquires no financial graph
locks. Provisioning likewise never acquires graph locks. Completion does not use
provider clearing. Shared members serialize at the sorted member gates; system
revenue is last, after member account locks. Direct row guards take no reversed
graph locks. Queued wallet/replay/agreement and offer/reveal/completion/agreement
scenarios test these dependencies with actual `pg_blocking_pids` relationships.

## Verification

Behavioral source mode loads 0083 only inside rollback transactions with fresh
normal producer fixtures. Installed mode compares function bodies, signatures,
owners, security attributes and ACLs and refuses drift. Both modes fingerprint
application data/catalog/ACL/RLS/migration history. Concurrency uses a template0
disposable schema clone with committed verified source visible to all sessions.
The archive filter excludes only DEFAULT ACL; ordinary ACLs remain. Sessions,
database and temporary archive/list files are cleaned on failure too.

Run the explicit behavioral/concurrency scripts, focused portable tests, full
`node --test`, TypeScript and whitespace checks before installation. Installed
mode and persistent installation require a separately authorized later step.
Historical migrations 0001–0081 remain normalized-byte unchanged.

No new paid dependencies or services are introduced.

### Pre-fix source verification results

The following results precede the caller-mode fix and are historical evidence.
Current fix verification is recorded separately in `0082-constraint-mode-fix.md`.

- PostgreSQL behavioral: 75 normal and 74 zero-component checks passed.
- Disposable-clone concurrency: 25 scenarios passed, with 27 actual PostgreSQL
  blocking relationships and no deadlock. Clone cleanup and application
  data/catalog/ACL/RLS/migration-history fingerprint verification passed.
- Targeted portable suites: 255 passed, none failed or skipped; final focused
  completion rerun: 51 passed.
- Full Node suite: 1,599 passed, none failed, one skipped (1,600 total).
- TypeScript and tracked/new-file whitespace checks passed.

An earlier concurrency attempt stopped in inherited location fixture setup after
five scenarios because the trusted producer rejected its resolution timestamps.
Cleanup/fingerprint verification passed. A complete unchanged rerun passed; the
transient timestamp failure was not reproduced or conclusively diagnosed.
Installed-mode verification and native-device UI execution remain unperformed.
0082 was not persistently installed and migration history was not changed.
