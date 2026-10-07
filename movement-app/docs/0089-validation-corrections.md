# Validation corrections

No production ranking/security invariant was weakened to accommodate a test.

The first behavior attempt reached the old 0048 fixtures and rejected their missing trusted state evidence. Those fixtures predate 0050. Current tests add complete provider-bound Lagos state evidence through the existing guarded private constructor; all matching validators remain active. The original 0048/0049 regression assertions remain unchanged and receive the same fixture augmentation.

The next attempt tried to instrument an explicit clock call in create_requester_movement_interest. That RPC uses the server-side timestamp default instead. Waiting fixtures now use the complete trusted insertion pattern already used by 0048's equal-time tie test, with immutable observations supplied at construction and all production triggers active. No existing timestamp is updated and public RPC arguments are unchanged.

A subsequent expanded run timed out during disposable pg_restore before candidate execution. Cleanup and persistent fingerprint checks passed. The exact same guarded harness was retried without changing its timeout/baseline checks; the failure log is 0089-schema-restore-timeout.txt.

The display-forgery test initially tried rating 99, which overflows numeric(3,2) before reaching the reputation guard. It now supplies a valid five-star value and requires the actual guard's 23514 rejection, rather than accepting a broader error class. The first expanded-run log is 0089-initial-display-forgery-fixture-error.txt.

All execution evidence and integrity audits here were produced by Codex. They are actual PostgreSQL/Node/TypeScript executions, but there has been no separate independent external review and no persistent installation of 0089.
