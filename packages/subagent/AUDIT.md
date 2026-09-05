# Subagent coordination audit

## Original failure

The inspected session delayed 24 child notices for roughly 2 hours 23 minutes to 2 hours 52 minutes.
The notices entered the parent transcript immediately after its final answer.

A deterministic agent-loop reproduction confirmed that `followUp` waited behind the parent turn.
The replacement uses `steer` at the next safe context boundary.

## Delivery and authority

The delivery journal persists receipts before dispatch and separates context delivery from acknowledgment.
Receipts include the child generation, owner session, send time, delivery time, and settlement state.

Regressions cover these cases:

- A child notice reaches parent context before the parent final answer.
- Restore replays an undelivered notice without immediately starting a turn.
- Acknowledged, cancelled, and stale-generation notices do not replay.
- Manual compaction defers dispatch until completion or cancellation.
- Dispatch errors preserve queued receipts for the next context boundary.
- History pruning preserves unresolved receipts and suppresses evicted settled references.
- Completion overflow records a delivery failure without replacing the task outcome.

`ask_parent` now labels side-model output as advisory guidance, not coordinator authorization.
Its snapshot preserves recognized coordination contracts within a bounded, redacted context.

`request_parent` waits for an explicit `TaskControl reply` from the actual root coordinator.
Only direct background Tasks can wait for this reply.
Foreground, nested, and graph Tasks fail closed instead of blocking the coordinator.

Decision regressions cover matching replies, stale ownership, cancellation, deadlines, duplicate replies, and listener cleanup.
An integrated provider fixture verifies the coordinator reply without an advisory side turn.

## Lifecycle

Runtime and controller regressions cover these cases:

- Cancellation after the parent model stops while descendants still run.
- Owner invalidation while a nested extension factory remains blocked.
- Concurrent joins and resume attempts for the same child.
- Invalidated joins that must not apply their patches.
- Closed controller admission during shutdown and replacement.
- Terminal event deduplication across unrelated child updates.
- Abort listener removal after a completed wait.
- Persisted aggregate failure after a real Git integration conflict.
- Owner and cancellation checks before aggregate root application.
- Shutdown that waits for admitted aggregate operations.
- Completion cleanup after coordination setup errors.

Physical integration defines a cancellation boundary.
Once application starts, cancellation cannot promise a zero-write result or undo existing writes.

## Interface verification

A temporary deterministic provider exercised the actual Pi TUI under tmux without external inference.
The probe ran a background Task, sent a warning, requested a coordinator decision, and received an explicit reply.

The first run exposed stale cards that remained `queued` after delivery.
The corrected renderer reads the current receipt during rendering.
A real SDK `CustomMessageComponent` regression verifies queued, delivered, and acknowledged transitions.

The corrected TUI probe displayed delivered warnings and acknowledged decisions at 100 columns.
A 60-column expanded view also displayed the decision question and reply result.
The probe used installed Pi 0.85.0. Package integration tests use the workspace SDK dependency.
The temporary terminal session and harness were removed after inspection.

## Extended audit closure

The follow-up audit added and closed these findings:

| Finding                                                    | Correction and regression evidence                                                                                                           |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Invalidated handles still expose draining children         | Compare owner identity and current generation before snapshots or waits. The real controller regression rejects old handles during shutdown. |
| Nested cancellation returns a false receipt                | Honor the cancellation result and report `integration-started` when application already begins.                                              |
| Admission callbacks strand sessions                        | Establish completion ownership before callbacks and settle callback exceptions through normal finalization.                                  |
| Cleanup exceptions retain timers and listeners             | Release resources unconditionally, retain cleanup debt, and preserve the committed task outcome.                                             |
| Pre-admission allocation failures leak workspaces          | Cover allocation, registration, session creation, transcript validation, and state admission with one cleanup boundary.                      |
| Pruning invalidates unresolved delivery authority          | Pin required records before restore pruning and release pins when deliveries settle.                                                         |
| Large descendant scopes fail after record pruning          | Pin records through parent closure. A real SDK regression completes 257 descendants successfully.                                            |
| Scope promises retain completed payloads                   | Retain void completion signals and clear closed scopes.                                                                                      |
| Failed appends leak ghost state into later snapshots       | Roll back record, run, workspace, root, and pin mutations when persistence fails.                                                            |
| Full snapshots amplify history storage                     | Persist incremental changes with linked predecessors and size-aware checkpoints.                                                             |
| Repeated snapshot construction causes quadratic event work | Build snapshots directly for the requested record and avoid full session-statistics scans.                                                   |
| Output validation performs quadratic property searches     | Use Map and Set lookups with own-key semantics.                                                                                              |
| Advisory snapshots process discarded history               | Materialize recent text within the byte budget and return immediately for zero budget.                                                       |
| JSON decoding loses special property names                 | Preserve `__proto__`, `constructor`, and `toString` through output parsing, Task dispatch, gates, and state replay.                          |

## Measured improvements

These measurements use controlled local fixtures, not production-wide memory estimates.

| Probe                                                                  |     Before |                         After |
| ---------------------------------------------------------------------- | ---------: | ----------------------------: |
| Snapshot constructions per event with 32 real blocked children         |      1,024 |                            32 |
| Usage-property reads in that snapshot probe                            |     21,504 |                           576 |
| JSONL bytes for 128 records with 8 KiB output                          | 70,644,000 |                     1,139,018 |
| Historical record slots in that JSONL probe                            |      8,256 |                           128 |
| Retained payload bytes in a 1,000-promise scope probe                  | 65,536,000 |                             0 |
| Advisory UTF-8 allocation bytes for 1,000 messages and an 80 KB budget | 16,165,960 |                       320,020 |
| Advisory text reads for that probe                                     |      2,000 |                            20 |
| Equality predicate comparisons for 512 object keys                     |    131,328 | 0 array predicate comparisons |

The scope probe used weak references and forced Bun garbage collection across separate event-loop turns.
It retained all 1,000 scope entries during measurement. Required task state has a separate lifetime and remains pinned while necessary.

The latest full-suite history measurement recorded 94.2 ms versus 11.6 ms for appends.
Reopen and restore took 1,561.7 ms versus 877.0 ms. Timing varies with machine load and is not a test assertion.

Tests assert deterministic operation counts, retained payload behavior, output equivalence, journal size, rollback, and replay correctness.
Stress-test deadlines permit concurrent suite load without weakening those assertions.

## Independent review corrections

The first independent review identified three additional session-history integrity failures.
Malformed JSON after a valid session header no longer produces a normal listing entry.
Discovery counts the rejected file and preserves `MALFORMED_SESSION` for authorized direct reads.

Tool-result pairing now records ambiguity when multiple calls share the same message, tool name, and call identifier.
Ambiguous evidence produces `unknown`, without a successful result or completion timestamp attributed to an arbitrary call.

All three failures have executable regressions. Focused discovery, pairing, and quality suites pass.
A full parallel run exposed a stress-test timeout, not an assertion failure.
The affected journal stress test now permits concurrent load while preserving its state and pruning assertions.

The second review exposed quadratic pairing when tool identifiers repeat.
An iterative ancestor traversal now indexes calls by identifier and tool name, restoring bindings at branch boundaries.
Pairing yields every 256 operations and checks cancellation and the elapsed-time budget.
A separate request-wide counter limits pairing to 100,000 entries across selected sessions.
Ambiguous duplicate groups are marked once rather than rescanned for every result.

| Sequential calls sharing one ID | Previous name lookups | Current name lookups |
| ------------------------------- | --------------------- | -------------------- |
| 256                             | 65,536                | 256                  |
| 512                             | 262,144               | 512                  |
| 1,024                           | 1,048,576             | 1,024                |

Regressions cover sibling branches, duplicate groups, cancellation during indexing and traversal, and cumulative pairing budgets.
The optional 32 MiB discovery-cancellation evaluation also passes.

## Final automated checks

- `bun run check`: passed for all 317 formatted files and 271 lint/type-checked files.
- `bun run test`: 1,237 passed and 4 skipped across the repository.
- Focused package suite: 260 passed across 19 files.
- `git diff --check -- packages/subagent`: passed.

Earlier global formatting and concurrent HUD failures no longer reproduce in the final full run.
No unrelated source changes were required.

## Limits

Delivery means that the context hook supplied a message to the model. It does not prove model attention.
Steering cannot interrupt an in-flight tool or model request.

The journal permits 256 unresolved receipts and retains 512 receipt records in memory.
Completion overflow remains inspectable through `inbox` and `status`, without automatic retry.

An interrupted process cannot retain a live decision promise.
Restore does not grant authorization or continue an interrupted child automatically.

Validation uses deterministic local providers and real SDK, session, Git, and TUI interfaces.
It does not reproduce hours of live cloud-provider traffic or provider-specific transport failures.

Historical version 1 through version 6 snapshots still require full validation during replay.
Incremental journaling reduces future amplification but does not rewrite existing session files or make history storage constant-sized.

Pins retain task state while an active scope or unresolved delivery needs it. They do not impose a concurrency or descendant-count budget.

New version 7 journal entries require the updated runtime. Backward replay by older runtimes is unsupported.
