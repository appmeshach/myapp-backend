# Completion harness after temporal hardening

The final sequence is 0081 start → 0082 temporal hardening → 0083 completion. No production SQL is changed or reinstalled by this task.

## Stale instrumentation

Normal completion fixtures formerly injected timestampDiagnostics regardless of installed/source mode. Its four patches targeted pre-hardening location-resolution validation, movement-context created_at future validation, proposal consent/materialization fresh-clock validation, and discovery recorded_at parent/fresh-clock chronology. Temporal hardening replaced those historical predicates. The creation patch raised source drift before completion tests could begin.

The complete former instrumentation is preserved in 0082-prehardening-timestamp-diagnostics.txt. Existing investigation documents remain unchanged. timestampDiagnostics is now an empty compatibility export, and fixtures never inject it. Historical discovery/proposal diagnostic modes and the constraint probe's intentional old diagnostics throw explicitly before runtime patching. Ordinary stress, constraint-mode, behavioral and concurrency execution use hardened functions without replacement.

## Installed mode

Completion history version is 0083. Both receipt tables must exist. All 12 completion definitions must match source, including owner, ACL, language, signature, security-definer/search-path and function attributes. Installed 0083 requires installed 0082; its bigint ordinal column, sequence properties, validated constraints, index and enabled immutable trigger must exist. All 32 temporal-only function bodies and ACLs are checked. No partially installed persistent database is repaired automatically.

## Source mode and overlap

With through-0081 prerequisites, sourceBody concatenates the actual 0082 migration body before actual 0083 source. If 0082 is already completely installed but completion is absent, it validates 0082 and loads only completion. Rollback transactions or disposable clones contain all source DDL; history is never edited.

The one overlap is private.assert_funded_coordination_entry. Final catalog verification excludes this name from temporal expectations and includes its 0083 body among the 12 completion definitions: 32 temporal-only + 12 completion. An intermediate temporal overlap body is not accepted as the final completion body.

Source-only mutual-end denial calls use authenticated, the role granted by historical migrations. Historical 0012 revokes all app execution on obsolete one-sided journey completion RPCs; those source-only calls use the already-existing postgres owner to exercise the financial guard rather than fail at EXECUTE. Installed mode retains its original service_role caller. All require the same 23514 financial-lifecycle denial; no expected error is broadened to include permission errors. No role memberships or grants are added.

The standalone source-composition check clones platform schemas, reconstructs public/private through the 81 historical migrations, then applies 0082 and 0083. Storage is included only for reconstruction; only Movement policies identified from historical source are removed before normal historical recreation. All these operations are confined to a validated disposable database. The standard four-schema clone remains the default. Ordinary ACLs are preserved; only DEFAULT ACL archive records are omitted. Temporal replacements must preserve exact source-clone baseline ACLs (and never PUBLIC execution); installed verification retains the exact captured installed ACL expectations. This distinction matters because the freshly replayed face-status RPC has authenticated execution while the audited installed catalog additionally has service_role execution.

## Coverage and limits

Portable harness regressions cover installed fixture isolation, exact source ordering, partial installations, final overlap ownership and disabled historical patching. Database source composition validates the final catalog and both normal/zero completion behavior variants. Installed stress and concurrency results, production hashes, historical integrity and complete Git status are recorded in 0083-harness-validation.txt after execution finishes.

No lock/deadlock expectations, race scenarios, timeout values, production constraints, roles or client source were weakened. No paid dependency, staging, commit, push or remote change.
