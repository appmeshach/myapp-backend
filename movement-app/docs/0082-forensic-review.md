# Historical 0082 pre-install forensic review

This report records the pre-fix source with SHA-256
`b0f4c6270c43b9c059ac6e0f9ed176041d24477fa02200fdf9b6fab9c1b85442`.
The subsequent architectural fix and its new verification results are documented
in `0082-constraint-mode-fix.md`; the explicit probe now runs a preservation matrix.

Classification: **B — NOT CLEARED**. Production source is unchanged. No persistent
installation, migration-history manipulation, staging, commit, push or remote
operation occurred.

## Retained evidence and location-fixture timeline

The workspace search excluded `.git`, `node_modules`, build, coverage, Expo cache
and Supabase temporary output. No raw concurrency failure log, dump, diagnostic
artifact or earlier 0082 source copy was found. The existing completion document
contains a summary. The prior tool transcript preserves this exact failure:

```
23514: Trusted provider resolution timestamps are invalid
public.record_attested_location_resolution_for_server(...), line 202
completion_fixture_6.snapshot_state_endpoint(...), line 6
inline_code_block, line 72
fresh() -> wrongRace(false)
```

It occurred after five scenarios passed, while constructing scenario six, before
that scenario's 0082 request or confirmation. Cleanup and application fingerprint
verification passed. The rejected timestamp values were not printed, so which
predicate failed cannot be determined from that record.

`0082_financial_movement_completion_behavior.cjs:10` inherits fixtures through
0081. `0081_financial_movement_start_behavior.cjs:17–30` replaces the older 0073
endpoint helper with the normal selected-location and resolution producers.
That exact helper is copied into the clone's fresh fixture schema. No 0082
timestamp rewrite occurs.

1. `fresh()` executes the inherited fixture in a transaction and commits it.
   It then executes `prepare_completion()` in a separate transaction.
2. The selected-location producer receives selection time `clock_timestamp()-1
   minute` and expiry `clock_timestamp()+4 hours`. Its intake captures a new
   `clock_timestamp()` for the selected location's `created_at` and receipt.
3. After that producer returns, the resolution call supplies a new
   `clock_timestamp()` as `p_resolved_at`, and another clock plus four hours as
   expiry. 0050 captures its own `v_now` after source validation/locking.
4. The exact rejection predicates are nonfinite resolution, resolution before
   selected `created_at`, resolution after `v_now`, and a supplied nonfinite or
   already-expired expiry (`0050:731–749`). With a nondecreasing wall clock,
   selection creation <= resolution argument <= producer validation clock.
5. Route and match helpers use fresh clock times with three-hour and two-hour
   expiries. Need/intent departure declarations use `statement_timestamp()+1/2
   hours`. `now()`/`transaction_timestamp()` remain transaction-start values;
   `statement_timestamp()` is statement-start, not refreshed within its DO block.
   None substitutes for the endpoint resolution's clock arguments.
6. Race sessions are started only after `fresh()` returns. Their blocking tests
   therefore cannot delay that scenario's location validation. Old sessions are
   closed before the next fixture. The clone also has no source application rows.
   There is no artificial sleep between endpoint selection and resolution.
7. Ordinary bounded harness waits cannot invert the endpoint timestamps. A wait
   exceeding the four-hour TTL could invalidate expiry in principle, but this
   runner's command/session deadlines are seconds, not hours. A wall-clock step
   could also break ordering; neither event is demonstrated by the transcript.

The prior timestamp failure remains **unproven/transient**. No 0082 settlement
ordering coupling was found. No fixture workaround or production timestamp rule
was changed. Strong non-reproduction evidence requested in this review was not
completed because the mode probe below stopped DB execution.

## Wallet modes: original defect, current fix, remaining gap

0064 defines both wallet balance triggers `DEFERRABLE INITIALLY DEFERRED`
(`0064:294–303`). The original 0082 defect left them IMMEDIATE after draining
settlement. A later normal `record_wallet_top_up_for_server()` in the same outer
transaction inserted a transaction before its postings and failed with:

```
23514: Wallet transaction must contain balanced debit and credit postings
```

The current confirmation function defers the selected constraints at `0082:429`,
forces them IMMEDIATE at `0082:447` after full graph construction/assertion, then
re-defers **only the two wallet balance constraints** at `0082:452`. This matches
the normal 0078 construction convention and fixes the default-mode top-up case.
The existing behavioral regression covers a top-up after confirmation.

However, this restores catalog defaults, not every caller's actual mode. The
new rollback-only explicit probe sets both wallet constraints IMMEDIATE, proves
that mode using failing unbalanced inserts in rollback subtransactions, performs
genuine requester confirmation, and measures again without retaining probe rows:

```
before_transaction = immediate
before_posting     = immediate
after_transaction  = deferred
after_posting      = deferred
P0001: 0082 changed caller wallet constraint mode from IMMEDIATE to DEFERRED
```

The diagnostic graph was printed in full before raising. It showed one exact
request and completion receipt; both lifecycle rows completed; R=3704, C=20986,
O=3703; three settlement transactions with six postings at the completion instant;
requester held=0, offerer withdrawable=17283, platform revenue=7407. Thus this
reproduces **caller-mode non-preservation**, not partial settlement or a deadlock.
The probe exited 1 and application data/catalog/ACL/RLS/history fingerprint
restoration passed. Production source was not modified.

All source mode-changing paths:

| Path | Mode changes / later caller-visible mode |
| --- | --- |
| Status / request replay / confirmation replay | No SET CONSTRAINTS; incoming modes unchanged |
| First request (`0082:360–364`) | Request completeness and start journey completeness DEFERRED, then IMMEDIATE; a caller's prior DEFERRED setting is not preserved |
| First confirmation (`0082:429–452`) | Final receipt, settlement transaction/posting graph, start journey/alignment and both wallet balance checks DEFERRED; all drained IMMEDIATE; wallet checks then DEFERRED |
| Positive components | Same unconditional mode sequence; loop creates only positive components |
| Zero components | Same unconditional mode sequence; zero iterations skipped; therefore same mode-preservation gap |
| Exception inside construction block | Subtransaction abort restores incoming modes and setup/receipt/ledger/lifecycle writes; exception re-raised |
| Earlier validation failure | No construction mode change has occurred |
| Error after construction during return projection | Error propagates; transaction abort or caller exception subtransaction rollback handles changes |

The new completion and existing start graph constraints are initially IMMEDIATE.
Default entry modes are restored on success. Arbitrary incoming caller settings
are **not** restored on success. PostgreSQL SET CONSTRAINTS is transaction state,
not a function-local variable. Therefore the requested all-exits no-mode-leak
proof cannot be given. No source fix was attempted during this forensic review.

## Exact confirmation visibility and atomicity

Actual source sequence (`0082:371–457`):

| Step | Trigger/validator visibility |
| --- | --- |
| 1–3 | Selector discovers exact identities, locks agreement SHARE then alignment UPDATE; funding agreement validation takes the accepted-offer shared lock and validates historical materialization/activation/start |
| 4 | Journey UPDATE lock, exact requester check and complete pre-state graph; existing completion returns read-only before wallet work |
| 5–6 | Both member UPDATE gates sorted by UUID; all existing member NGN accounts UPDATE sorted by account UUID; validate requester/offerer shape and all balances |
| 7 | Construction subtransaction begins; normal offerer provisioning under those gates, with no ledger writes yet |
| 8 | System revenue INSERT ON CONFLICT, UPDATE lock and active/range preflight; no receipt or settlement yet |
| 9 | Capture one completion clock after waits and setup |
| 10 | Defer selected graph/balance checks; insert receipt. BEFORE actor trigger validates exact existing in-progress start/request graph before the new receipt exists. AFTER completeness is queued |
| 11 | Positive R transaction BEFORE guard sees exact receipt, component, requester, kind/key/currency/time. Posting BEFORE checks validate account/direction. Full balance/graph checks remain queued |
| 12 | Positive C transaction and two postings; same guards. Requester held has been partially drained inside this transaction; external sessions cannot see it |
| 13 | Positive O transaction and two postings; contribution credited first, preflight includes intermediate C balance and final C−O. Zero components omit transaction and postings entirely |
| 14 | Journey BEFORE guard sees matching final receipt and complete ledger; journey becomes completed while alignment remains in progress internally; completeness remains deferred |
| 15 | Alignment BEFORE guard sees receipt; alignment becomes completed. Both lifecycle states now match |
| 16 | Explicit full graph assertion checks exact receipts, start/request chronology, all three component histories, exact postings and absence of legacy settlement/extra transactions |
| 17 | Force selected constraints IMMEDIATE. Every queued financial graph validator and wallet balance validator sees the completed graph, regardless of their firing order |
| 18 | Re-defer wallet balance constraints, then return authoritative projection under retained locks |

Partial internal states intentionally exist during construction. BEFORE guards
observe only the prerequisites relevant at their stage; full graph validators
are deferred. It would be incorrect to claim no trigger ever observes a partial
internal state. The enforced property is that no partial settlement/lifecycle
graph can successfully pass the final assertion/drain or become externally
visible through commit. Exceptions roll back provisioning as well as ledger and
lifecycle writes. No partial-commit defect was demonstrated by this probe.

## Execution boundary and results

Per the instruction to stop immediately on the first unexpected result, DB
execution stopped at the caller-mode failure. There was no retry. Consequently:

- 50 complete behavioral stress executions: **not run**.
- 50 focused normal settlements: **not run**; one genuine normal path in the
  mode probe completed internally before its deliberate failure/rollback.
- 30 focused zero-component paths: **not run**.
- Three complete clone concurrency reruns: **not run**.

Earlier passing results are historical evidence only and do not satisfy this
review's stress requirements. The existing focused top-up races remain in the
concurrency runner unchanged.

Only this report and the explicit constraint-mode probe were added during this
review. Final portable/full Node/TypeScript/whitespace and source integrity results
are recorded in the final response. Installation remains blocked under the
user's stated no-mode-leak criterion.
