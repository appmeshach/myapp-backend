# Wallet foundations: 0067 correction and resumed audit

The local baseline was advanced from 0065 through 0067 with the normal Supabase
CLI `migration up --local` command. Both 0066 and 0067 applied successfully. The
audit uses the actual installed functions, including the corrected 0066 deferred
dispatcher; it never replaces production functions inside the harness. No hosted
Supabase connection, application change, or provider integration is involved.

## Reproduce

From `movement-app/`, using an available Supabase CLI and the existing local
`supabase_db_movement-app` Docker container:

```sh
supabase migration up --local
node supabase/tests/wallet_foundations_behavior.cjs
node supabase/tests/0067_wallet_provisioning_concurrency.cjs
node --test tests/walletProvisioningFailClosed.test.cjs tests/walletAccessFoundation.test.cjs tests/walletTopUpFoundation.test.cjs
node --test
node node_modules/typescript/bin/tsc --noEmit
git diff --check
```

The ordinary portable Node suite does not discover these integration runners.
The behavioral runner requires migration history through 0067. All test users,
member accounts, postings, transactions, and temporary helper functions exist
only in a rollback transaction. Expected-error probes use subtransactions; an
unexpected result raises immediately. Deferred constraints are flushed before
the final rollback. Fresh-connection fingerprints confirm every row in auth.users,
public.members, and the three wallet tables, plus public/private function
definitions and ACLs, matches the pre-run state even after a SQL failure. A closed
psql connection also rolls back an aborted run. Do not run unrelated local writes
at the same time as this whole-table fingerprint comparison.

## 0067 design and results

Only `public.ensure_ngn_wallet_accounts_for_server(uuid)` is replaced, preserving
its existing return contract and service-only ACL. A member-row `FOR UPDATE`
lock precedes ordered account `FOR SHARE` locks. Total account count, active
count, and the distinct required kinds are checked before insertion. The INSERT
is entered only for zero accounts. The existing post-insert completeness check
remains as a final guard.

The PostgreSQL harness passed all **16 0067 checks**:

| Contract | Observed result |
|---|---|
| Service-role first provisioning | Succeeds with exactly three active NGN kinds |
| Repeat provisioning | Identical return values and IDs; entire account rows unchanged |
| One-account partial wallet | `23514`; unchanged, no repair |
| Two-account partial wallet | `23514`; unchanged, no repair |
| One closed account among three | `23514`; unchanged, no reopening or replacement |
| Missing/null member | `23503` / `22004` |
| anon/authenticated provisioning | Actual execution denied with `42501` |
| PUBLIC provisioning | No EXECUTE grant in effective function ACL |
| Provisioned zero balance response | Same five public fields and zero balances |

## Resumed 0064 matrix

All **61 0064 checks** passed, including the two explicit behavior observations.

| Requested coverage | Observed result |
|---|---|
| PUBLIC table access | No table ACL privileges on all three tables |
| anon direct access | Actual SELECT denied; all direct privileges absent, all three tables |
| authenticated direct access | Actual SELECT denied; all direct privileges absent, all three tables |
| service_role SELECT | Actual SELECT succeeds on all three tables |
| service_role INSERT | Actual INSERT denied with `42501`, all three tables |
| service_role UPDATE | Actual UPDATE denied with `42501`, all three tables |
| service_role DELETE | Actual DELETE denied with `42501`, all three tables |
| service_role TRUNCATE | Actual TRUNCATE denied with `42501`, all three tables |
| Balanced transaction | Two postings pass the actual deferred-trigger flush |
| Transaction with no postings | Deferred flush rejects with `23514` |
| Unbalanced postings | Deferred flush rejects with `23514` |
| Posting/account currency mismatch | Rejects with `23514` |
| Posting to closed account | Rejects with `23514` |
| Account identity | Mutations of id, member, kind, currency, and created_at each reject |
| Closed account reopening | Rejects with `23514` |
| Transaction immutability | UPDATE, DELETE, TRUNCATE each reject with `23514` |
| Posting immutability | UPDATE, DELETE, TRUNCATE each reject with `23514` |
| Duplicate idempotency key | Rejects with `23505` |
| Duplicate nonnull provider/reference | Rejects with `23505` |
| Required alignment | All six movement-relevant kinds reject a null alignment |
| Required financial component | All three financial kinds reject a null component |
| Numeric accumulation | Balanced debit/credit totals of 18,446,744,073,709,551,614 pass |
| Rollback cleanliness | Shared post-run fingerprint check passes |
| Nonzero account closure | Permitted to the privileged owner; see limitations |
| Multiple postings to same account | Second posting rejects with `23505`; see limitations |

## Resumed 0065 matrix

All **14 balance-specific 0065 checks** passed. The corrected provisioning checks
are deliberately counted once under 0067 rather than repeated under 0065.

| Requested coverage | Observed result |
|---|---|
| authenticated/anon/PUBLIC provisioning | Denied; covered by 0067 checks above |
| Service provisioning, three active accounts | Pass; covered by 0067 |
| Same account IDs on second call | Pass; covered by 0067 |
| Unprovisioned real member | `wallet_ready=false`, NGN, all balances zero |
| Provisioned member | `wallet_ready=true`; exact zero and funded projections tested |
| Own-member isolation | First member sees 720/180/100; second sees its own zero balances |
| Unauthenticated read | Missing subject and actual anon execution both rejected |
| Nonexistent auth member | Rejects with `42501` |
| Read creates no accounts | Account count unchanged after unprovisioned read |
| Credit/debit projection | Real postings produce available 720, held 180, withdrawable 100 |
| Partial wallet | Both one- and two-account reads reject with `23514` |
| Closed wallet | Read rejects with `23514` |
| Negative balance | Read rejects with `23514` |
| Bigint boundary | 9,223,372,036,854,775,807 projects exactly; one more rejects with `23514` |
| Response shape | Exactly currency, wallet_ready, available_minor, held_minor, withdrawable_minor |
| Rollback cleanliness | Shared post-run fingerprint check passes |

## Limitations and future work

1. An owner-level writer can close a nonzero account. The balance projection then
   rejects the closed wallet. No client or service role gains direct closure
   permission. A future closure operation needs an explicit zero-balance policy
   if that is the desired lifecycle; 0067 does not change closure rules.
2. `UNIQUE(transaction_id, account_id)` allows only one posting per account per
   transaction. Future compound postings must aggregate each account's amount or
   separately review a forward schema change; this audit does not relax the key.
3. Ledger balance and member spendability are separate checks. Balanced owner-level
   test postings can produce negative or above-bigint member projections; the
   reader correctly fails closed. Future operation-specific writers must enforce
   their own balance and lifecycle rules, as the 0066 top-up writer already does.

No additional failure of the tested deployed contracts was found. **0068 is not
required by this audit.** Changing the documented limitations would be a separate
future design decision, not an extra fix folded into 0067.

## Concurrency scope

The opt-in concurrency runner copies schema only from the normally migrated local
database into a random `wallet0067_race_*` database. Independent PostgreSQL sessions
exercise two simultaneous first-time provisioning calls at READ COMMITTED and
verify an actual wait through `pg_blocking_pids`. One case commits the first call
and requires the same IDs for the waiter; the other rolls it back and requires a
successful new three-account set. Neither case permits a deadlock, timeout, or
duplicate account set.

The commit case necessarily commits fixtures inside the disposable database;
the entire scratch database is removed in `finally`. No fixtures are committed
to the application test database. Ownership/ACL copying is omitted because the
local role cannot restore Supabase auth-admin defaults. The runner applies 0067's
ACL normally; real baseline permission checks run in the original rollback-only
harness. If forcibly terminated, inspect and remove only the specifically named
scratch database, never the application's `postgres` database.
