# @nothingrotf/pstack

`@nothingrotf/pstack` ports pstack workflow skills to Pi with minimal source changes.

## Install

Install the required tools first:

```sh
pi install npm:@nothingrotf/ask
pi install npm:@nothingrotf/goal
pi install npm:@nothingrotf/loop
pi install npm:@nothingrotf/session-history
pi install npm:@nothingrotf/subagent
pi install npm:@nothingrotf/todo
```

Install pstack:

```sh
pi install npm:@nothingrotf/pstack
```

Restart Pi after installation.

## Resources

The package provides 46 upstream skills and four Pi compatibility skills. `make-bot-ui` remains outside the project by explicit decision.

- `architect`
- `arena`
- `automate-me`
- `blast-radius`
- `bro`
- `control-cli`
- `control-ui`
- `create-skill`
- `create-verification-skill`
- `deslop`
- `figure-it-out`
- `how`
- `interrogate`
- `maintain-verification-skill`
- `no-comments`
- `principle-attack-the-premise`
- `principle-boundary-discipline`
- `principle-build-the-lever`
- `principle-encode-lessons-in-structure`
- `principle-exhaust-the-design-space`
- `principle-experience-first`
- `principle-fix-root-causes`
- `principle-foundational-thinking`
- `principle-guard-the-context-window`
- `principle-laziness-protocol`
- `principle-make-operations-idempotent`
- `principle-migrate-callers-then-delete-legacy-apis`
- `principle-minimize-reader-load`
- `principle-model-the-domain`
- `principle-never-block-on-the-human`
- `principle-outcome-oriented-execution`
- `principle-prove-it-works`
- `principle-redesign-from-first-principles`
- `principle-separate-before-serializing-shared-state`
- `principle-sequence-verifiable-units`
- `principle-subtract-before-you-add`
- `principle-test-behavior-not-implementation`
- `principle-type-system-discipline`
- `poteto-mode`
- `recall`
- `reflect`
- `setup-pstack`
- `show-me-your-work`
- `swarm`
- `tdd`
- `teach`
- `technical-writing`
- `typescript-best-practices`
- `unslop`
- `why`

The package registers the `Comment Sicko` and `poteto-agent` agents with `@nothingrotf/subagent` through the shared Pi event bus.

It also registers the `pstack-nested` capability profile. The profile permits three local Task levels.

The `poteto-agent` defaults to background mode. Mutable background work runs in automatic writer isolation.

Inspect a completed writer with `TaskControl`. Use `action: "join"` only when the parent workspace must receive its accepted patch.

Background results arrive as follow-up messages. The skills do not poll. When the parent is blocked with no other work, it calls `TaskControl` with `action: "wait"`, which streams the job tree until the first Task settles.

## Upstream synchronization

This port incorporates these upstream changes:

- [cursor/plugins#329](https://github.com/cursor/plugins/pull/329) at `c57a66799701c3e533568b0667bf1560bbd3b503` reduces prose and updates workflows.
- [cursor/plugins#331](https://github.com/cursor/plugins/pull/331) at `9ed271d798099a9c0c7982a9a8b170f18cb37cd2` adjusts prose punctuation and terminology.
- [cursor/plugins#341](https://github.com/cursor/plugins/pull/341) at `2336018ca979f8662e804139ecf1b316cb159323` requires evidence or uncertainty labels alongside claims and agent-run verification when possible.

The sync preserves Pi tools, Task contracts, model selection, and stack backends.

`how` now explains architecture without a Critique mode.
Existing `how critics:` configuration lines remain valid but no longer publish a dispatch role.
`poteto-mode` starts its task list with the matched playbook steps and cites only principles read during the session.
The new principles cover questioning a shared premise after repeated failed fixes and testing observable behavior.

## Task roles and workspace contracts

Each workflow passes an explicit `Task.role`, such as `feature`, `refactoring`, or `why synthesizer`.
The runner preserves this label beside the model without inferring it from the model name.
With a pstack capability profile, the role enforces the configured model choices. It never grants capabilities.

The extension reads `~/.agents/rules/pstack-models.md` at startup, before each root prompt, and before root `Task` calls. It publishes the parsed policy through `pstack-planning` and renders it into root and nested context. Policy edits do not require reload. Pi does not interpret `alwaysApply`; the extension applies this policy directly without asking the model to read the file.

Configured selectors are mandatory, including effort and fast mode. An explicit `Task.model` outside the configured choices fails before execution. Scalar roles can omit `model`. Distinct panel or pool choices require an explicit selector, including `inherit-parent` for an inherited entry. Identical choices can omit it. Skills determine panel counts; the runtime never picks the first model or fans out.

Delivery roles separate technical acceptance from prose. `code review` and `runtime verification` are selector pools for one scoped reviewer or verifier. `publication` is a scalar role for destination Git and PR operations. `judgment and prose` remains for prose and evidence synthesis.

Absent review and verification roles inherit `arena cross-judge pool`, then `judgment and prose`. Absent `publication` inherits `judgment and prose`. Explicit settings override these compatibility defaults. Missing files and otherwise absent documented roles fall back to the agent default, then the parent. Fresh pstack dispatches require an exact `role` and a pstack capability profile. Registered pstack agents default to `pstack-leaf`. Unknown roles, malformed files, and duplicate role definitions fail clearly. Invalid files do not kill root sessions or affect unrelated Tasks. Unavailable models and unsupported effort or fast settings fail affected selections.

Use `/setup-pstack` to configure the file. For different-family reviews, select a permitted entry from another family than the implementation model. If no permitted model qualifies, report a blocker and request a policy update. Unconfigured roles allow explicit models before the agent default and parent fallback. Resume preserves the stored model rather than applying a newer policy.

Runtime verifiers use `isolation: { mode: "worktree", integration: "manual" }`.
Their artifacts remain inspectable, but the runtime rejects `join`.
Omitted runtime-verification isolation defaults to `manual`. Explicit `apply`, `branch`, or read-only execution fails before dispatch.
Managed reviewer and verifier resumes inherit their recorded directory and isolation when omitted.
Repository writers use relative paths in the effective child workspace.
An isolated worktree separates Git state but is not an OS sandbox.
Never bypass it through an absolute source-checkout path or push its synthetic history as a product branch.

Read [Task contracts](skills/poteto-mode/references/task-contracts.md) for executable dispatch examples and coordinator decisions.

After updating, reload Pi before new dispatches. Before adding the three new role keys to the global policy, reload every older session that reads it. Older loaded registries reject those keys and block fresh pstack Tasks. Stage the new policy separately when active sessions cannot reload yet. Later edits to recognized role selectors do not require another reload.
Existing child contracts do not gain tools automatically.
If a retained capability contract changed, start a fresh child from its saved brief and evidence instead of weakening resume validation.
Older records without a role remain unlabeled rather than receiving a guessed role.

## Delivery throughput

Bounded work uses an accepted design, one persistent implementer, and one independent reviewer.
Assign the implementer before reproduction or discovery, not after a separate investigation handoff.
Run `how` and `why` in that owner's session by default. Delegate only independent slices or explicitly required perspectives.
Scoped workers load their assigned workflow instead of the coordinator's full routing catalog.
Compatible corrections retain those owners instead of restarting design or duplicating verification. Plan combined reviewers with runtime tools and manual isolation from their first dispatch. Reviewers return one complete verdict with static, comment, deslop, and runtime findings. The implementer applies corrections. Publication includes commit and PR text without a separate prose-preparation worktree.
New or contested architecture defaults to two candidates and one independent judge.
A configured model pool does not determine fanout.

Two independent issue lanes form the initial pilot when files, dependencies, and mutable resources are disjoint.
Early probes exercise risky runtime boundaries before extensive implementation.
Reusable harnesses and artifact-bound receipts avoid repeated setup without removing required checks.

Read the [delivery contract](skills/poteto-mode/references/delivery-contract.md) for routing, ownership, preflight, and evidence invalidation.
Read [throughput and pilot](skills/poteto-mode/references/throughput.md) for the measurement format and interpretation limits.
Read the [continuity pilot](skills/poteto-mode/references/continuity-pilot.md) for controlled comparison and the concurrency decision.
Read [delivery operations](skills/poteto-mode/references/delivery-operations.md) for compact checkpoints, completion-driven waiting, artifact reconstruction, and browser preflight.
Two incomplete returns without meaningful progress trigger diagnosis, not an identical redispatch or automatic acceptance.
Candidates require a passing criterion matrix before independent verification.
Structural diagnosis uses the configured `hardest tasks` role without reopening accepted design automatically.
The root session model remains separate from Task model policy.

## Managed delivery protocol

Use `pstack_delivery` to open an issue and record a terminal Task. The ledger stores only entries owned by the current session. The reader skips corrupt entries from other sessions before it decodes their full delivery data.

`open`, `record`, `refresh`, `repair`, and default `read` responses return compact checkpoints with owner identities, criteria, artifact state, recent attempts, and evidence references.
Use `view: "submissions"` or `view: "criteria"` with `offset` and `limit` for retained records.
The default page size is five, and the maximum is twenty. Byte budgets can shorten a page. Follow the returned `nextOffset`.
Oversized submissions return a `detail` locator instead of broken JSON. Open that locator with `view: "submission"`, `agentId`, and `attempt`.
Exact submission pages contain JSON text in `content`, with UTF-16 offsets and a maximum `limit` of 4096 characters.
Pages preserve complete Unicode characters. Follow `nextOffset` rather than adding `limit` to the previous offset.
Pass the returned `sha256` on continuation pages. A changed submission rejects stale pages. Restart at offset zero after a change.
Concatenate the chunks before parsing the submission. Tool content and details each remain within 32 KiB, including escaped Unicode.
Checkpoint previews expose counts and omission markers. They never replace the full artifact or evidence.
Ready-to-use `repair` locators appear in the checkpoint's `recentAttempts`, `view: "submissions"` entries, and the `view: "submission"` paging envelope. Spread that locator into a `pstack_delivery` call and add only the corrected `report`. It pins the issue, agent, attempt, next revision, current report digest, evidence digest, and artifact digest, so callers never hash a guess or inspect raw session JSONL.
Reading a checkpoint does not reverify its evidence or change acceptance.

New records append only their submission to a linked delivery journal. Integration refresh appends only the attempt identity and integration state.
Replay preserves immutable reports, evidence, and original timestamps. It rejects disconnected events, corrupt authority, and legacy checkpoints after journal activation.
Normal Pi compaction retains the journal on the active branch. Compaction summaries never replace its acceptance evidence.
Legacy checkpoints remain readable before journal activation. The selected session branch and owner determine the visible records.
Reload the extension before continuing an existing delivery. Do not alternate older and newer extension versions within an active journal.

A dispatch binding retains the issue and agent identity from the real Task result, including report-less failures.
Bind managed work with `delivery: { kind: "managed", issue: "<open issue id>" }` on the Task or graph node.
Use `delivery: { kind: "independent" }` for unrelated work, even when another issue has an open ledger.
Independent work does not inherit managed acceptance or authorization for publication.
When the session has a managed ledger, publication still requires an accepted managed issue.
Legacy dispatches can use one exact `issue: <id>` prompt line or the resumed agent's retained binding.
This rule covers implementation roles, `code review`, `runtime verification`, `publication`, and `hardest tasks` diagnosis.
Conflicting, duplicate, unknown, or prose-only bindings fail before execution. The protocol never selects the first ledger issue.
The runtime persists the binding in the execution contract and preserves it on resume.
Read-only investigation Tasks outside those delivery roles remain ordinary Tasks. Sessions with no managed ledger remain ordinary unless they explicitly request an issue that is not open.
An unrelated plain resume does not enter managed delivery.
Managed publication must identify its accepted issue and cannot escape its gates through an independent resume.
Unusable retained evidence records WIP with a reason instead of blocking diagnosis indefinitely.
Evidence failures preserve registered criteria and reported findings without treating unverified evidence as proof.
Duplicate findings remain conservatively open. Invalid criterion IDs remain outside the acceptance matrix.
A failed review vetoes publication even when its artifact identity is unavailable.

Managed implementations, reviews, and diagnoses receive the exact `DeliveryOutputSchema`, every exact criterion ID and full description, prior findings with severity and disposition, exact candidate identity, digest-addressable retained receipt metadata, prior command and log locators, and current-attempt receipt instructions during Pi's `tool_call` preflight. The same supported JSON schema validates the child output. Retained locators are never presented as current aliases or proof-reuse authorization. A managed resume requires the stored delivery schema and accepts only a semantically identical schema. Record the prior terminal attempt before resuming. A changed schema requires a fresh Task contract. Terminal JSON-looking prose never supplies a binding or substitutes for structured output.

Before terminal settlement, pstack applies the full authoritative `DeliveryReportSchema`, exact criterion set, current receipt existence and status, role, and candidate artifact identity. Invalid reports receive at most two report-only turns in the same child session with no tools. Each raw report remains in terminal evidence. Exhaustion fails the Task while retaining captured WIP and specific diagnostics.

Three deterministic repairs settle without a correction turn. A passing criterion that cites a failed receipt loses that reference when at least one successful cited receipt remains, and the report is rejected when no successful proof remains. A report that claims no failure, passes every criterion, and leaves no open finding receives `failureClass: "none"` when the field is absent. An oversized `reason` is truncated to the 4096-character limit with an explicit truncation marker. Both repairs replace the terminal output, so the persisted report and structured output stay identical to the accepted verdict. A repair never promotes readiness, criterion outcomes, or finding dispositions, and a correction may still lower them. An implementation candidate or acceptance requires at least one successful shell receipt from its own attempt; read receipts never satisfy that proof.

`action: "repair"` revises only a persisted report over the pinned immutable attempt. It never starts a Task, model, shell, or worktree. The original report remains unchanged and each correction carries its journaled timestamp as an auditable revision. Repair accepts a failed Task only when trusted runtime metadata identifies report-contract exhaustion after otherwise intact execution. It rejects execution or tool failure, aborts, stale digests, candidate switching, implementation-to-review conversion, promoted criterion outcomes, and erased or weakened findings. A correction may conservatively downgrade readiness, passing criteria, or closed findings to WIP, non-passing outcomes, or open blockers when immutable proof is unavailable. When retained raw semantics do not establish the intended verdict, repair fails closed or remains WIP.

A command receipt uses the deterministic `command:1`, `command:2`, and later aliases in shell execution order. Reports cite those aliases only when the receipts exist. Read-only static reviews and diagnoses may cite recorded read receipts as `read:1`, `read:2`, and later values. Read receipts cannot replace the shell proof required for runtime verification. To bound the record, runs retain the first and final 128 shell or read receipts plus any cited intermediate receipt. A receipt proves that Pi ran and retained the tool output. It does not prove that the tool tested the right behavior.

A static reviewer runs read-only and identifies the candidate tree. A runtime verifier runs with a writable shell in worktree isolation with `integration: "manual"`. It starts from the integrated candidate tree and must leave its product tree unchanged. Put verifier caches and scratch output outside the product tree or in ignored paths. Manual isolation never integrates verifier output.

Record every terminal attempt that reports an issue before another implementation dispatch. This rule applies to unlisted implementation roles. Two incomplete implementation returns without new proven criteria block the next dispatch. Record a `hardest tasks` diagnosis before the next correction. Failed runs without a report remain recordable WIP when the runtime retained no artifact.

Use `pstack_delivery` with `action: "refresh"` after trusted integration changes a recorded attempt from captured, pending, or conflict to integrated. Refresh preserves the recorded report, artifact, evidence, and time. It rejects a changed immutable attempt.

Publication sets `run_in_background: false`. It requires independent acceptance and integration of the current candidate. The preflight compares repository root, relative path, and tree identity. It does not trust a moving base branch or an empty destination HEAD.

The protocol governs direct Task calls from a coordinator that loads this extension.
Delegated coordinators do not inherit this session's ledger or managed preflight hooks.
`TaskControl` can steer, cancel, join, or inspect a Task. Parent-session shell commands are also outside the managed delivery boundary. Neither action creates a managed command receipt or changes delivery acceptance.
Managed preflight removes a `wait` deadline shorter than 15 minutes, because a completion-driven wait settles on the child and a short window only spends coordinator turns. An explicit longer deadline is preserved.
For the personal Sol-based coordinator policy, start a new session with `pi --model openai-codex/gpt-5.6-sol:medium`.
Existing sessions, global defaults, and active children remain unchanged.

Run the report from the package directory:

```sh
bun src/throughput-cli.ts /absolute/path/to/measurements.json
```

The report groups acceptance time by implementation model and complexity.
It retains unfinished work and rejects unsupported comparisons.
Synthetic tests validate the reporting tool, not actual savings for a product backlog.

Derive per-session latency directly from a recorded session:

```sh
bun src/session-metrics-cli.ts /absolute/path/to/session.jsonl
bun src/session-metrics-cli.ts --json /absolute/path/to/session.jsonl
```

The report separates generation time from tool time, counts turns that carried a single tool call,
and totals read output, cache reads, cost, and terminal report rejections.
Generation time is the wall gap before each assistant message and tool time is the wall gap before
each tool result, so concurrent tool calls count once instead of once per call.
Only the active branch is measured, so a fork, a rewind, or a compaction does not inflate the totals.

This report reads a session file path directly and stays outside the project scope, because delivery
reviews compare sessions across repositories. Use `session_history` instead for model-facing,
project-scoped retrieval with stable references, redaction, and pagination.

### Tool definition cost

Every registered tool definition is serialized into each model request, so a verbose description is
paid on every turn of every session. Rank that fixed overhead:

```sh
bun src/tool-cost-cli.ts ../subagent/src/index.ts ../pstack/src/index.ts
bun src/tool-cost-cli.ts --json ../filetools/src/index.ts
```

The report loads the named extensions beside the Pi built-in tools and ranks each tool by the
characters it contributes, separating the serialized definition from its system prompt snippet and
guidelines. Characters are not tokenizer counts.

## Stack backends

Poteto supports Graphite `gt` and GitHub `github/gh-stack`.

If only `gh` exists, Poteto asks for approval before it runs:

```sh
gh extension install github/gh-stack
```

Set `POTETO_STACK_BACKEND=graphite` or `POTETO_STACK_BACKEND=github` to select a backend. The automatic mode prefers GitHub when both exist. Graphite remains an explicit selection and an automatic fallback.

GitHub stack workflows require GitHub Stacked Pull Requests on the repository.
