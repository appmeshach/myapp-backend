# 0104 local child and execution-reader foundations

This is local/synthetic implementation work, with no live qualification authorized.
Normal run.cjs, operator evidence v3 and all 99 migrations retain their contracts.
No adapter is installed by default and there is no qualification CLI or crash switch.

## Child architecture and authority

qualification-child-adapter.cjs forks exactly one fixed qualification-child-entry.cjs
with process.execPath, an argument array, shell:false and empty execArgv. Operator
executable/script/argument/environment overrides reject. Fork injection is trusted
test code, not JSON configuration. Stdin is ignored. There is no HTTP/TCP listener,
public socket, eval or arbitrary module loader. Direct execution without inherited
IPC rejects. The reviewed parent-created Node IPC channel is the only command path.

Fixed-entry validation no longer compares raw Windows path strings. The narrow
qualification-child-entry-identity helper has no caller-selected path. It reuses the
repositoryRoot/within boundary, checks the expected canonical location using platform
path semantics (including Windows namespace normalization), and rejects symlinks or
junctions in the file/ancestor chain. Both lexical and resolved paths must identify
the same actual regular file. The adapter pins its device/inode identity, ancestor
directory identities and SHA-256 of the opened file at construction, then rechecks
them plus the full report-bound worker source hash immediately before fork. Even a
byte-identical replacement with a different identity rejects; changed contents reject.
Windows casing/namespace equivalence is accepted only when physical identity agrees.
Unsupported file identities fail closed. Node still executes the hard-coded pathname;
these checks do not claim an atomic filesystem-to-exec transaction. The reviewed
source filesystem must remain protected against external replacement during launch.

0103 mints its existing WeakMap capability only after fault_authorized is journaled
and fsynced. The adapter consumes it IN THE PARENT, checking run, supervisor nonce
hash, job, execution, worker source and migrations. The object is never serialized.
The child has already registered attempt zero, claimed attempt one, loaded the exact
fixture and sent preparation evidence before release. Only the supervisor can send
that one-shot release through this adapter. Nonce, boolean, journal and serialized
fake capability cannot invoke parent fire. Duplicate/replayed messages and wrong
bindings fail closed.

Child sequence: hello -> initialized/ready -> registered -> prepared receipt sent ->
release received -> fault receipt sent -> parent acknowledgement -> self-termination.
Backend register/claim/load requests use exact fixture arguments and three consecutive
request IDs, relayed privately to an explicitly supplied parent backend. The child
has no live DB client. Existing controlledWorker validates preparation; channel release
then invokes existing controlledFailure with private cached backend results, without
another register/claim. The child cannot self-authorize through its outbound messages;
the parent rejects release messages from the child. The inherited channel is process
ownership/transport authority under reviewed code, not cryptographic global identity
or distributed one-shot authority. Arbitrary local code replacing the parent/child is
outside this trust boundary; message hashes alone are not authorization.

Before SIGKILL, the child waits for the parent to validate and persist its fault receipt
and acknowledge it. Parent success requires that exact sequence AND actual Node exit
fields code:null and signal:SIGKILL. Clean/numeric exit, other/missing signal, missing
receipt, unsolicited messages or early disconnect reject. No exitCode is invented.
Windows may lack POSIX self-termination signal fields; such exits fail closed and
Windows signal correlation remains unqualified. Positive real self-termination testing
is POSIX-only. Actual local IPC tests reject early release and no-channel execution;
synthetic transports exercise portable conservative exit validation and correlation.

Exact IPC schemas have a 256 KiB JSON size limit. Parent command timeout is 30 seconds
by default (bounded override for synthetic tests), child idle phases are bounded to
30 seconds and both ends enforce a 120-second total lifetime. Backend calls and the
existing controlled observer have five-second bounds. Any stdout/stderr data rejects,
with a 256 KiB ceiling; it is never evidence. Errors are fixed and sanitized. Supervisor
completion/failure cancels its owned adapter through a private cleanup registry.
Cleanup termination cannot count as the expected fault.

Only SystemRoot/TEMP/TMP may be inherited. No secret appears in argv, execArgv or
inherited env. The minimum qualification plan and existing-boundary validation values
(service-role value, fixture key/capsule), plus private backend results, travel only
through IPC and stay in memory. Provider session/token, DB password, private signing
key and ambient credentials are excluded. Persisted/returned supervisor evidence
remains sanitized hashes/times/enums. This work uses only synthetic material and never
reads the preserved capsule file or real keys.

## Provider reader: live schema blocked

Local code/documentation/saved-schema searches found no exact input type/fields,
returned container or pagination definition for deploymentInstanceExecutions. The
user-supplied query name and environment/service binding are insufficient to invent
it. No fixed execution GraphQL document or live traversal is implemented. The existing
Railway CLI fixed QUERY allowlist is unchanged; no live discovery call was made.

qualification-execution-reader.cjs provides only an injected-code read boundary and
strict validator. Its input is a NORMALIZATION CONTRACT, not a Railway wire envelope:
`{ provider, projectId, instance, executions: [one execution] }`. Expected project,
environment, service, instance, deployment and region bind exactly. Zero/multiple/
duplicate candidates reject. Shapes, known enums, retry budget, canonical timestamps,
chronology and the one-hour window validate strictly. The output is `{instance,
execution}` for 0103. observedAt is LOCAL acceptance time, separate from provider
createdAt/updatedAt/completedAt. Provider-supplied observedAt, exitCode, restart cause
and deploymentMeta prose reject. The injected call has a five-second timeout/abort bound.

This makes no pagination, provider-authentication or completeness claim. A future
reviewed upstream reader must establish complete unambiguous selection using exact
authenticated schema traversal. Unknown pagination remains a blocker; no guessed page
size or operator completeness boolean substitutes. No default reader, query setter,
endpoint, log/rendered-variable query or mutation method exists.

## Evidence and live prerequisites

The adapter proves only the reviewed parent/child process protocol and local source
identity. It does NOT prove that this child corresponds to the Railway service
execution named by executionId / DeploymentInstanceExecution. Child-to-Railway
execution identity and host topology remain unresolved. The child is not described
as a verified Railway worker, and child termination cannot grant platformRestart PASS.
A future live qualification still requires a reviewed topology/identity binding.

Child self-termination, execution lifecycle, restart policy and DB attempt-one ->
attempt-two recovery/fencing/single publication establish correlation only. Outside
operator restart remains indistinguishable. platformRestart stays null with
restart_origin_unattributable; no process gate, operator measurement or technically
qualified host is promoted. The journal remains a directory-local supervisor
reservation; cross-workstation one-shot authority remains unresolved.

Before separately authorized fresh disposable use: obtain/review exact execution
input/response/pagination schema and an authenticated reader; qualify child-to-provider
execution identity and host IPC/process behavior; resolve cross-workstation one-shot
authority; arrange unused fixture sequencing and capture cadence; and resolve automatic
restart-origin evidence. No live use is authorized or operationally qualified. The old
disposable project/fixtures/run must not be reused.

Entry-identity review validation: child adapter 57 PASS plus two OS-specific skips
(POSIX self-termination on Windows and unavailable file-symlink permission); injected
reader 50 PASS (109 focused tests total, zero failures). The 11 targeted identity
cases had 10 PASS and only the unavailable file-symlink case skipped; the actual
directory-junction and Windows canonical casing/namespace cases PASS. Combined
0104/0103/0102/0101/0099, worker-process and migration-integrity suite: 561 PASS,
three OS-specific skips, zero failures (564 total). All 97 supervisor, 136
Railway and 71 operator tests are included. App, Edge and worker typechecks PASS.
The 639-file source/test/documentation secret-pattern scan excluded sensitive files,
credential caches and the capsule; matches were synthetic test literals only.
Diff and nine new-file whitespace checks PASS. All 99 migrations, normal worker,
Railway sealed proof, operator v3 and pinned trust identity are unchanged. No live
Railway/Supabase/provider/production action or stage/commit/push/deploy/restart/redeploy
occurred. No fresh project was created or deleted; the capsule remains unread/untracked.
