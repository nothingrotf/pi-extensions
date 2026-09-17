# Delivery latency plan

Ranked by wall-clock gain. Effort, confidence, and risk are separate columns, not part of the order.

## Method

Measured from the recorded sessions of SPT-189 and SPT-191 in `/Users/nothing/Workspaces/spice-target`.
Every number below comes from session JSONL timestamps, not from estimation of model behavior.

Wall clock decomposes as `turns x per-turn latency`, because generation dominates execution:

| Session                | Window   | Model time     | Tool time | Turns | Model s/turn |
| ---------------------- | -------- | -------------- | --------- | ----- | ------------ |
| Implementation (sol)   | 25.8 min | 22.6 min (88%) | 3.2 min   | 117   | 11.6         |
| Verification (opus)    | 16.1 min | 12.0 min (75%) | 4.1 min   | 43    | 16.7         |
| Correction fix (sol)   | 4.6 min  | -              | 1.8 min   | 23    | -            |
| Re-verification (opus) | 9.6 min  | -              | 3.1 min   | 39    | -            |

Baseline for every percentage in this document is the SPT-189 main issue: **45.7 min** from `delivery open` to `accepted`.

| Segment                 | Duration | Share |
| ----------------------- | -------- | ----- |
| Dispatch and setup      | 1.1 min  | 2%    |
| Implementation          | 26.7 min | 58%   |
| Integration and refresh | 1.0 min  | 2%    |
| Verification            | 16.8 min | 37%   |

Consequence: any lever that does not reduce turn count or per-turn latency cannot move the clock.
Native in-process tooling, faster shells, and faster search change 12% of the clock at most.

## Observed defects

| ID  | Gap                                       | Measured evidence                                                                               |
| --- | ----------------------------------------- | ----------------------------------------------------------------------------------------------- |
| G1  | Serial single-call turns                  | 104 of 117 implementation turns carried exactly one tool call                                   |
| G2  | Dead grounding in context                 | 59 reads without a limit, 56 of 77 read files never edited, 481k chars read, 226k final context |
| G3  | Coordinator overhead                      | 14 waits with `timeout_ms: 300000`, 8 expired; one lost dispatch required human input           |
| G4  | Serial and monolithic verification        | 29 verifier commands almost fully serialized; static and runtime checks in one opus agent       |
| G5  | No pipelining across issues               | Nothing ran during the 16.8 min verification                                                    |
| G6  | Violations corrected instead of prevented | SPT-191 spent 11m22s plus 3m48s on one correction round                                         |
| G7  | Manual measurement                        | `throughput.ts` consumes a hand-written JSON; every analysis in this effort was ad hoc          |

## Master list

Gain is the expected reduction of the 45.7 min issue clock. Program-level items are marked separately.

| #   | Item                                                           | Gap   | Where                                   | Gain                  | Share             | Confidence  | Effort      | Risk           |
| --- | -------------------------------------------------------------- | ----- | --------------------------------------- | --------------------- | ----------------- | ----------- | ----------- | -------------- |
| I1  | Multi-file `patch` tool for workers                            | G1    | new `filetools` package plus capability | 11.7 min              | 26%               | medium-high | medium      | low            |
| I2  | Bounded `read` replacement with a file outline                 | G2    | new `filetools` package plus capability | 3.9 min               | 8%                | medium      | medium      | medium         |
| I2b | Publish tgrep to workers as a capability                       | G2    | `tgrep` plus capability                 | 0.4 min               | 1%                | medium      | low         | low            |
| I3  | Static review and runtime verification dispatched in parallel  | G4    | poteto playbooks                        | 5.8 min               | 13%               | medium      | low         | low            |
| I4  | Independent gates grouped into one command inside the verifier | G4    | `worker.md`                             | 1.8 min               | 4%                | medium-high | low         | low            |
| I5  | Wait normalization in the managed preflight                    | G3    | `pstack` preflight                      | 0.8 min               | 2%                | high        | low         | low            |
| I5b | Lost dispatch recovery                                         | G3    | undetermined                            | 0.5 min               | 1%                | none yet    | unknown     | high           |
| I6  | Fast mode on implementation roles, measured                    | extra | `pstack-models.md`                      | 3.4 min               | 7%                | low         | trivial     | usage cost     |
| I7  | Cheap model for re-verification after a correction             | extra | policy plus contract                    | 2.5 min               | 5%                | medium      | trivial     | low            |
| I8  | Stream rules that abort and inject on violation                | G6    | new extension                           | 5-7 min expected      | 11-15%            | low         | medium-high | medium         |
| I9  | Package-scoped type check during implementation                | G4    | `worker.md`                             | 0.3 min               | 0.7%              | high        | trivial     | none           |
| I10 | Verifier harness retained and reused across rounds             | G4    | delivery contract                       | 2.0 min               | 4%                | low-medium  | low         | low            |
| I11 | Workspace prewarm before dispatch                              | G3    | `subagent`                              | 0.5 min               | 1%                | medium      | low         | low            |
| I12 | Session metrics extractor                                      | G7    | `pstack` throughput                     | 0                     | 0%                | high        | low         | none           |
| I13 | Two independent lanes across issues                            | G5    | operator decision                       | program-level         | 35-45% of program | medium      | none        | lane conflicts |
| I14 | Code mode `exec` tool with nested tool bridge                  | G1    | new package                             | 9 min after I1 and I2 | 20% of residual   | medium      | high        | high           |
| I15 | Nested tool receipts                                           | G1    | `subagent`                              | 0                     | 0%                | high        | medium      | medium         |
| I16 | Action tree in the HUD for nested calls                        | G1    | `hud`                                   | 0                     | 0%                | medium      | medium      | low            |
| I17 | Phase compaction inside the child                              | G2    | `subagent`                              | 0-3 min               | 0-6%              | low         | medium      | high           |
| I18 | Reasoning effort tuning per phase                              | extra | policy                                  | unknown               | unknown           | low         | trivial     | quality        |

Items I1 through I11 overlap by roughly 15%. Applying that discount, the issue clock moves from **45.7 min to about 25 min**.

## Why each choice beats its alternatives

### I1, serial turns

Prose rules failed. The batching guidance was active during SPT-189 and the model still produced 104 single-call turns.
Blocking a call after generation does not return the turn.
Code mode solves the same problem structurally but requires a JS runtime, a tool bridge, nested receipts, and new UI, and it does not apply to the opus verifier.
A multi-file patch tool plus multi-target read and search collapses the dominant call families in every model:
55 edit calls, 94 reads, and 23 searches become roughly 40 calls.
Each call remains one receipt, so managed delivery is unaffected.

### I2, context

Replacing the tool beats intercepting its result. `packages/tgrep` already replaces the native `grep` by re-registering the same name with `createGrepToolDefinition` and its own `execute`, so the pattern is proven in this repository.
Keeping the name `read` also preserves evidence: managed receipts are mapped by tool name, and only `bash`, `powershell`, and `read` produce them.
A read without a limit against a large file becomes a bounded read plus a file outline, with an explicit escape for full content.
Phase compaction inside the child was rejected as the primary option because it destroys retained evidence ordering.

Child sessions build their own resource loader with `noExtensions: true` and load only capability extensions, so an installed extension never reaches a worker.
Worker-facing tools must ship as a subagent capability registration, which `pstack-leaf` and `pstack-nested` reference by id.
The same gap means the workers of SPT-189 searched with the native `grep` rather than tgrep, which is item I2b.

### I3 and I4, verification

Replacing opus with a cheaper model regresses quality: the opus verifier found the capacity reservation leak that the sol verifier of SPT-191 would not have caught.
Splitting static review from runtime verification turns a sum into a maximum.
Grouping independent gates into one command removes serial shell time without removing any executed proof.

### I5, coordinator

Documentation already carries the rule and it still failed, because the coordinator held the previous contract in context and `/reload` does not rewrite context.
Normalizing the arguments in the managed preflight is immune to stale context.

The lost dispatch stays unsolved. The session records an assistant `Task` call at 03:17:36 and a pending dispatch entry, with no tool result and no error entry, followed by a human `continue`.
A user interrupt and a runtime stall are indistinguishable in that record, and an automatic redispatch risks a duplicate managed attempt.
I5b needs a reproducible cause before any code.

### I8, prevention

Pi exposes `message_update`, `abort()`, and `sendUserMessage` with steering delivery, so an abort-and-inject rule engine is implementable here.
It pays one partial turn to avoid a correction round measured at 15 min.
Risk: aborting mid-stream interacts with provider prompt caching and needs bounded retries.

### I14, code mode, parked

After I1 and I2 the residual turn count is already low, and the remaining gain applies only to `code_mode_only` models.
The catalog marks `gpt-5.6-sol` and `gpt-5.6-luna` as `code_mode_only`, so the option stays open, but it now ranks below cheaper work.
It also requires I15 and I16 before it can be used by a managed worker.

## Execution order

### Tranche 1, low risk and immediate. Delivered.

- I5, wait normalization in the managed preflight: `packages/pstack/src/delivery-tools.ts`.
- I3, parallel static and runtime verification: `references/delivery-contract.md`.
- I4, grouped gates: `references/worker.md`.
- I9, package-scoped type check: `references/worker.md`.
- I12, session metrics extractor and CLI: `packages/pstack/src/session-metrics.ts`.

I5b stays open pending a reproducible cause.
The extractor reproduces the manual SPT-189 analysis exactly: 117 turns, 104 single-call turns, 22.8 min of generation, 481090 read characters, 20.6M cache reads, and 14.16 USD.
It measures the active branch with the same lineage rule as `session-history`, so a fork, a rewind, or a compaction cannot inflate a total.
It stays in `pstack` rather than in `session-history`, because delivery reviews compare sessions across repositories while `session_history` is project-scoped by design.
Expected: about 8 min per issue, plus automatic measurement for every later tranche.

### Tranche 2, the main lever

- I1, multi-file `patch` tool.
- I2, bounded `read` replacement with a file outline.
- I2b, tgrep published to workers.

These ship as one new package, `packages/filetools`, registered in the root session like `tgrep` and published to workers as a subagent capability.
`pstack` only adds the capability id to its two profiles.
Search stays in `tgrep`; this package never registers a competing search tool.
Expected: about 15 min per issue.

### Tranche 3, decisions rather than engineering

- I6, fast mode experiment with before and after measurement from I12.
- I7, re-verification model selection.
- I10, retained verifier harness.
- I13, two lanes, operator decision.

### Parked

- I14, I15, I16: code mode and its required receipt and UI work.
- I17, phase compaction.
- I18, reasoning effort tuning.

## Invariants

No item may reduce executed proof, criterion coverage, independent acceptance, or finding severity.
Receipt identity stays stable: one tool call remains one receipt with its own alias.
Read receipts stay available for diagnosis and static review roles after I2.
Every gain claim is verified against the extractor from I12 before the item is considered complete.

## Already delivered

- Terminal report repairs: inferred failure class, truncated reason, pruned failed proof.
- Stable tool set during report-only correction.
- Deferred dependency materialization with a product-repository barrier.
- Shared task cache per repository.
- Phase-scoped gate contract in the worker reference.

Measured effect between SPT-191 and SPT-189: report rejections 1 to 0, implementation correction rounds 1 to 0, full repository gates 3 to 1, implementation shell time 5.3 min to 2.6 min.
