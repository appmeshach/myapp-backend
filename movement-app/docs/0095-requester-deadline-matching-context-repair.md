# 0095 requester deadline matching-context repair

Development-only forward repair; not deployed. Baseline: `d204bed` on `feature/0092-shared-segment-suitability`.

## Defect and exact replacement

The trusted matching context was defined in 0036, replaced for same-state validation in 0050, given two requester departure guards in 0052, and replaced for roster freeze in 0091. The 0091 body preserved state and mature evidence validation but lost both 0052 deadline guards. 0039/0046 wrappers and the 0037 assertion / 0082 route-match writer delegate to that effective body. 0051 discovery filtering is not a substitute for action-time enforcement. 0089/0090 priority consumers retain their existing eligibility dependencies.

0095 starts with the complete 0091 definition and adds exactly the two original 0052 guards. The first follows the locked movement need and discoverable-status check. The second follows all dependency and same-state validation immediately before return. Removing only these two blocks reproduces the full historical 0091 definition byte-for-byte after line-ending normalization.

The unchanged signature is `public.get_trusted_matching_context_for_server(uuid,uuid,uuid)` with 23 result columns. SECURITY DEFINER, empty search_path, postgres ownership, service_role-only execution, READ COMMITTED, parent/dependency lock order, roster rejection, and existing state/authorization checks remain intact. No other function is replaced.

## Time and authority

`COALESCE(latest_departure_at, earliest_departure_at) <= clock_timestamp()` rejects with SQLSTATE `23514` and `Movement need is not available for matching`. Latest is authoritative when present; earliest is the fallback. Equality is unavailable. Tests combine an exact source assertion of the inclusive comparison with naturally elapsed future deadlines; execution observes the boundary after actual database time passes it, without clock hooks.

The final guard reads database wall-clock time anew. Transaction/statement start time cannot substitute: a requester can expire while the function waits on a later intent or route lock. The need SHARE lock retains the selected deadline fields while the final clock advances. No new lock, clock override, client time, TTL, or route-expiry substitution is introduced.

This restores current-use temporal unavailability only. It creates no geographic eligibility, interest, offer, alignment, journey, capacity consumption, exclusivity, ranking or financial effect. Existing historical/accepted relationships are not rewritten. Shared-segment assessment is not implemented; the next expected assessment milestone is 0096, with admission integration separately reviewed.

## Validation protocol

The fresh reset uses a temporary config copy with local DB port 55432/shadow 55431. Tracked config is unchanged. All SQL fixtures run in schema-only disposable clones through the existing local Docker harness, with application data/catalog/ACL/RLS/history fingerprints checked before/after. No production URL or provider is used.

Focused SQL reuses the unchanged 0052 production-producer fixtures and runs both the new 0095 matrix and all 25 original 0052 assertions. Forward replacement verification checks OID, signature, result, owner, ACL and every recorded function attribute. Installed final source is checked exactly.

Genuine concurrency uses independent PostgreSQL sessions and `pg_blocking_pids` barriers. Need, intent and route waits begin with a future deadline and release only after actual database time crosses it. Intent/route cases exercise the final guard; a live wait control must succeed. No clocks or guards are modified in these new tests.

Current-schema regression composition reuses 0091's mature fixture construction and assertions without its old commit/branch/catalog preconditions or reinstalling 0090/0091. Original upgrade-only tests remain untouched. Existing regression instrumentation, where used by historical temporal/priority tests, remains confined to disposable clones. Regression result files are redirected to the OS temporary directory.

## Results

Final local validation on 2026-10-10 (Pacific time):

| Check | Result |
|---|---|
| Fresh local reset | Exit 0; all 0001?0095 applied; history 95 / 0001 / 0095 |
| 0095 focused SQL | 13/13, repeated after the final successful reset |
| Original 0052 SQL | 25/25, repeated after final reset |
| 0095 genuine deadline concurrency | 7/7, repeated after final reset |
| 0082 temporal ingestion | 15/15 |
| 0089 priority behavior | 75/75 |
| 0089 priority concurrency | 8 scenarios; 19 read assertions; zero deadlocks |
| 0089 regression | 86 inbox, 52 continuation, 34 reputation, 203 legacy assertions, plus generic completion/review exclusion checks |
| 0090 requester priority | 89 behavior assertions; 11 concurrency scenarios; six blocking and six lock-release proofs; zero deadlocks |
| 0091 current-policy roster | 99 behavior assertions; 22 concurrency scenarios / 18 actual blocking proofs / six continuation proofs; 17 temporal assertions; zero deadlocks |
| 0092 / 0093 / 0094 SQL | 24/24 / 49/49 / 26/26, repeated after final reset |
| 0093 / 0094 genuine concurrency | 16/16 / 9/9 in isolated post-reset runs |
| 0032 quota / 0033 offerer claim | 56/56 / 29/29, repeated after final reset |
| 0044?0049 admission/context | 44 / 62 / 26 / 70 / 86 / 52 assertions, all pass |
| 0054?0056 recovery | 35 / 26 / 29 assertions, all pass |
| Same-state regression | 14/14 |
| Full Supabase Node | 1,052 pass, zero failures/skips; 63 files |
| Full root Node | 957 tests, 956 pass, one existing optional integration skip, zero failures; 47 files |
| App / Edge typecheck | Both exit 0 |
| Installed/source | Exact repaired context plus all 0089/0090/0091 bodies; final seven 0093 bodies and 0094 context also match source |
| Identity/security preservation | OID, signature, 23-column result, owner, ACL, definer, search_path, volatility, strictness and parallel flags preserved by forward replacement |
| Historical integrity | All 94 historical migrations equal HEAD modulo CRLF/LF; existing pinned hash guards retained |
| Application fingerprint | Unchanged after each disposable SQL/concurrency/regression harness |
| git diff --check | Exit 0 |

The first reset applied all migrations but hit a transient storage-container post-reset health timeout. Storage became healthy; the final reset was rerun without competing fixtures and succeeded with exit 0. An initial 0093 active-lease assertion ran after its real fixed lease elapsed during concurrent fixture load; the unchanged suite passed 16/16 when rerun sequentially after the clean reset. No lease or source guard was weakened.

New fixture corrections respected live guards: past-departure assignment was replaced with natural expiry, and the roster fixture was aligned with the 0052 family's exact provider state reference. The source-placement test ignores existing SQL comments when checking adjacency. The migration itself required no change after its two-guard implementation.

The current-policy roster run excludes the original historical upgrade preflight hook and three pre-existing-terminal-parent assertions that require the pre-0091 catalog. Their source remains intact; all 99 current-policy behavior assertions ran against final 0095.

Commands: new 0095 harness (default SQL; admission; state; 0082; priority; roster-behavior; roster-concurrency; roster-temporal), new 0095 concurrency runner, existing 0094 harness and existing 0093/0094 concurrency runners; full Node patterns over supabase/tests and tests; npm.cmd run typecheck and npm.cmd run typecheck:edge. Fresh reset: node_modules/.bin/supabase.cmd --workdir .0095-local-reset db reset --local --yes. Temporary artifacts are archived outside the worktree after validation.

No historical migration, tracked config, application/Edge code, geometry algorithm or priority equation changed. No production access, live provider call, deployment, staging, commit or push occurred.
