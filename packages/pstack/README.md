# @nothingrotf/pstack

`@nothingrotf/pstack` ports pstack workflow skills to Pi with minimal source changes.

## Install

Install the required tools first:

```sh
pi install npm:@nothingrotf/ask
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

## Activation

Pstack is opt-in. Invoke `/skill:poteto-mode` or explicitly request a pstack workflow to activate it.
Ordinary coding requests do not activate managed delivery or pstack delegation.
Installation, model configuration, and references to pstack in logs or bug reports do not authorize activation.
The root prompt states this boundary before the model policy. Delivery tool descriptions repeat it.
The extension enforces model selection and delivery contracts, but activation remains a model instruction rather than a runtime authorization gate.

## Resources

The package provides 55 upstream skills, four Pi compatibility skills, and the local `pr` skill. Publication uses `pr` for every PR body. `make-bot-ui` remains outside the project by explicit decision.

- `architect`
- `arena`
- `automate-me`
- `benchmark-checklist`
- `blast-radius`
- `bro`
- `control-cli`
- `control-ui`
- `correct`
- `create-formal-verification-skill`
- `create-skill`
- `create-verification-skill`
- `deslop`
- `figure-it-out`
- `how`
- `in-your-own-words`
- `interrogate`
- `ketchup`
- `maintain-formal-verification-skill`
- `maintain-verification-skill`
- `no-comments`
- `principle-attack-the-premise`
- `principle-boundary-discipline`
- `principle-build-the-lever`
- `principle-encode-lessons-in-structure`
- `principle-exhaust-the-design-space`
- `principle-experience-first`
- `principle-explain-the-number`
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
- `pr`
- `recall`
- `reflect`
- `setup-pstack`
- `sharpen`
- `show-me-your-work`
- `statechart`
- `swarm`
- `tdd`
- `teach`
- `technical-writing`
- `typescript-best-practices`
- `unslop`
- `why`

The package registers the `Comment Sicko` and `poteto-agent` agents with `@nothingrotf/subagent` through the shared Pi event bus.

The chat that receives `/poteto-mode` runs the playbook and owns its todo list. `poteto-agent` is the wrapper for delegates of that run. Do not spawn it to run the playbook itself.

It also registers the `pstack-nested` capability profile. The profile permits three local Task levels.

The `pstack-leaf` and `pstack-nested` profiles list `codemode` in `defaultTools`.
Every pstack child therefore receives Pi's `codemode` tool unless its Task lists explicit `tools`.
Scripts can batch reads and searches in parallel and return only the part of a large result the child needs.
Their nested calls keep their own tool receipts, so a `bash` command inside a script still counts as command evidence.

The `poteto-agent` defaults to background mode. Mutable background work runs in automatic writer isolation.

Inspect a completed writer with `TaskControl`. Use `action: "join"` only when the parent workspace must receive its accepted patch.

Background results arrive as follow-up messages. The skills do not poll. When the parent is blocked with no other work, it calls `TaskControl` with `action: "wait"`, which streams the job tree until the first Task settles.

## Upstream synchronization

This port incorporates these upstream changes:

- [cursor/plugins#329](https://github.com/cursor/plugins/pull/329) at `c57a66799701c3e533568b0667bf1560bbd3b503` reduces prose and updates workflows.
- [cursor/plugins#331](https://github.com/cursor/plugins/pull/331) at `9ed271d798099a9c0c7982a9a8b170f18cb37cd2` adjusts prose punctuation and terminology.
- [cursor/plugins#341](https://github.com/cursor/plugins/pull/341) at `2336018ca979f8662e804139ecf1b316cb159323` requires evidence or uncertainty labels alongside claims and agent-run verification when possible.

The following reviewed heads provide the baseline for selective synchronization:

- [#414](https://github.com/cursor/plugins/pull/414) at `88886d41a9e921d02f70b0044741ba86681f81fe` supplies log initialization, quiet audits, evidence identity, and pause checkpoints.
- [#419](https://github.com/cursor/plugins/pull/419) at `773258b8233e6cc09c1894a76cd855f639281793` supplies quota-free reflection, traced security findings, and local prompt deduplication.
- [#422](https://github.com/cursor/plugins/pull/422) at `be6bcd1805535bc426d46bd5caf4650d998d01be` supplies append-only audits, authorized babysit boundaries, and retired-role notices.

The port preserves configured model defaults, panel sizes, Pi tools, Task contracts, and stack backends.
[#416](https://github.com/cursor/plugins/pull/416) at `e6773141c087933005b2a8e3f6cb28a637bda142` only updates upstream documentation.

These later upstream commits are also synchronized:

- [`23e4138d`](https://github.com/cursor/plugins/commit/23e4138daa01c42d4969f7a5465f82704e64f798) adds `principle-explain-the-number`, `benchmark-checklist`, fresh subagents by default, the hourly audit loop, PR body headings, and a schema-first cast example.
- [#494](https://github.com/cursor/plugins/pull/494) at `9511e60321f7e533a187d62854a3d53a53752874` adds `correct`.
- [#495](https://github.com/cursor/plugins/pull/495) at `a58628271271837ef5f386adca29c0812683a19a` makes `architect` judge candidates as an agent contributor would change them.
- [#496](https://github.com/cursor/plugins/pull/496) at `e43c7ee26e0038c6c1fa8380dd34ce86ff94cb2a` replaces the Perf issue strategy families with the performance mantras.

The Pi port adapts these commits:

- A fix round, a follow-up, a retry, and the next queue item go to a fresh agent. The managed delivery ledger supplies the consolidated scope. The implementation owner of an issue with an issue workspace is the exception: it resumes for each correction.
- Autopilots arm `/loop 1h` with event watchers instead of `/goal`.
- Isolated owners do not push. In Autopilot-full, the root publishes each verifiable unit as a WIP snapshot on a `wip/<issue>` branch.
- In Autopilot-stack, the root publishes each WIP snapshot to the layer's draft pull request in the stack. Publication marks it ready only after independent acceptance.
- The root keeps one destination worktree per issue in flight and releases it after publication with `scripts/release-worktree.sh`.
- Autopilot-stack starts a dependent layer only after its parent layer is accepted and published.
- The built-in PR tool rule is omitted because Pi has no built-in PR tool.
- The guide, the swarm respawn wording, and the plain-words autonomy default have no local counterpart.

These upstream changes after [#496](https://github.com/cursor/plugins/pull/496) are also synchronized:

- [#538](https://github.com/cursor/plugins/pull/538) at `00b14f1df36b32a8dd1529324a3a459f6563b127` shortens skill prompts.
- [#539](https://github.com/cursor/plugins/pull/539), [#570](https://github.com/cursor/plugins/pull/570), and [#595](https://github.com/cursor/plugins/pull/595) add `ketchup`. It catches the user up since their last message with visual evidence.
- [#571](https://github.com/cursor/plugins/pull/571) removes unneeded sections from seven skills.
- [#536](https://github.com/cursor/plugins/pull/536) makes `check-plan.mjs` respect indented, tilde, and longer code fences.
- [#484](https://github.com/cursor/plugins/pull/484) makes the bundled `watch-pr` read every page of review threads.
- [#572](https://github.com/cursor/plugins/pull/572) removes "Must always apply." from the `unslop` description.
- [#574](https://github.com/cursor/plugins/pull/574) adds `-b <ref>` to `worktree-audit.sh` and replaces `POTETO_TRUNK`.
- [#573](https://github.com/cursor/plugins/pull/573) defines verification readiness as a usable app.
- [#575](https://github.com/cursor/plugins/pull/575), [#577](https://github.com/cursor/plugins/pull/577), and [#597](https://github.com/cursor/plugins/pull/597) keep the `/poteto-mode` chat as the runner and `poteto-agent` as a delegate.
- [#602](https://github.com/cursor/plugins/pull/602) and [#606](https://github.com/cursor/plugins/pull/606) add `in-your-own-words`.
- [#604](https://github.com/cursor/plugins/pull/604) proposes a cheap always-on signal after a deep debugging dig.

The Pi port adapts or omits these parts:

- `poteto-mode` keeps explicit principle skill names, so the catalog test can resolve each leaf.
- `how` and `why` keep their in-session Pi flow, so the shortened upstream delegation steps have no counterpart.
- `poteto-agent` receives the skill base path from the extension, so it does not search `~/.cursor/plugins/`.
- `ketchup` draws charts with an available tool instead of `/visualize`.
- `Comment Sicko` keeps its agent name. [#486](https://github.com/cursor/plugins/pull/486) renames it only because Grok cannot spawn an id with a space, and Pi accepts that id.
- `poteto-help`, the guide, the Agent Plugins manifest, and the version bumps have no local counterpart.

`how` now explains architecture without a Critique mode.
Existing `how critics:` configuration lines remain valid but no longer publish a dispatch role.
`setup-pstack` announces which known legacy rows its rewrite removes before confirmation.
`poteto-mode` starts its task list with the matched playbook steps and cites only principles read during the session.
The new principles cover questioning a shared premise after repeated failed fixes and testing observable behavior.

These upstream changes through [#634](https://github.com/cursor/plugins/pull/634) at `99743e9c151c8537cbbf1f98bb38f34ef3368453` are also synchronized:

- [#609](https://github.com/cursor/plugins/pull/609) and [#628](https://github.com/cursor/plugins/pull/628) make `ketchup` read like `bro` in about 150 words and explain changes with screenshots, videos, and small diagrams.
- [#613](https://github.com/cursor/plugins/pull/613) resolves the orchestration frontier from the pull request base chain instead of Graphite. It also trims the autopilot, shipping, orchestrate, and plan playbooks, and the bundled `watch-pr` no longer fails a Code Review Gate that waits on an owner approval.
- [#615](https://github.com/cursor/plugins/pull/615) adds `sharpen`.
- [#616](https://github.com/cursor/plugins/pull/616) makes autopilot audit ticks and replies catch the operator up with `ketchup`.
- [#633](https://github.com/cursor/plugins/pull/633) restates four principles as reasoning instead of rules.
- [#634](https://github.com/cursor/plugins/pull/634) removes marginal sections from four skills.

The Pi port adapts or omits these parts:

- The runtime model policy fixes the model, effort, and speed of each role. The upstream rule that picks a reasoning level and speed for each subagent has no counterpart.
- The playbooks keep the Graphite and GitHub stack backends, the delivery engine, and one independent reviewer per round. They take the principles from #613 without its base-chain landing steps or the Origin forge.
- The delivery contract invalidates a code verdict on any patch change, so the upstream rule that carries a lane result across a test-only patch change has no counterpart.
- The bundled `orch` keeps the upstream `--forge origin` choice. The Pi playbooks use the default `gh` forge.
- The orchestration frontier no longer needs a backend adapter, so the `gt` compatibility shim is removed.
- `ketchup` still draws charts with an available tool instead of `/visualize`.
- `worktree-audit.sh` keeps its `gh` pull request lookup, so the Origin lookup has no counterpart.
- `poteto-help` and the version bumps have no local counterpart.

These upstream changes through [#779](https://github.com/cursor/plugins/pull/779) at `4ec7ffa173eaa70d3d9467a627baf0954645a353` are also synchronized:

- [#692](https://github.com/cursor/plugins/pull/692) and [#708](https://github.com/cursor/plugins/pull/708) make `ketchup` list every item that waits on the user, with what the user needs to decide it from the reply alone. The reply grows with the number of items and never drops one to meet a word count.
- [#700](https://github.com/cursor/plugins/pull/700) makes `typescript-best-practices` create a brand with a verifying type guard instead of `as`.
- [#709](https://github.com/cursor/plugins/pull/709) and [#721](https://github.com/cursor/plugins/pull/721) add `create-formal-verification-skill`, with TLA+ as the default and a fallback when no verifier runs on the language.
- [#716](https://github.com/cursor/plugins/pull/716) adds `maintain-formal-verification-skill`.
- [#715](https://github.com/cursor/plugins/pull/715) makes `setup-pstack` offer a formal verification skill once.
- [#712](https://github.com/cursor/plugins/pull/712) and [#729](https://github.com/cursor/plugins/pull/729) restore the original `sharpen` prompt. It returns only the rewritten prompt and does not do the task.
- [#741](https://github.com/cursor/plugins/pull/741), [#776](https://github.com/cursor/plugins/pull/776), and [#779](https://github.com/cursor/plugins/pull/779) add `statechart`. It draws what a user sees as a Mermaid statechart checked by a TLA+ model, with each bug as a numbered path.

The Pi port adapts or omits these parts:

- `ketchup` still draws charts with an available tool instead of `/visualize`, and reads each `Task` state with `TaskControl`.
- `setup-pstack` invokes `create-formal-verification-skill` through its canonical installed path.
- The `statechart` scripts keep their upstream `node:test` suite. The package test runs it, and TLC cases skip when `TLA2TOOLS` and Java are absent.
- [#702](https://github.com/cursor/plugins/pull/702) names each skill after its folder. The local skills already use those names.
- The Claude Code plugin from [#637](https://github.com/cursor/plugins/pull/637) and [#705](https://github.com/cursor/plugins/pull/705), the docs check from [#704](https://github.com/cursor/plugins/pull/704), `make-bot-ui`, `poteto-help`, the guide, and the version bumps have no local counterpart.

## Task roles and workspace contracts

Each workflow passes an explicit `Task.role`, such as `feature`, `refactoring`, or `why synthesizer`.
The runner preserves this label beside the model without inferring it from the model name.
With a pstack capability profile, the role enforces the configured model choices. It never grants capabilities.

The extension reads `~/.agents/rules/pstack-models.md` at startup, before each root prompt, and before root `Task` calls. It publishes the parsed policy through `pstack-planning` and renders it into root and nested context. Policy edits do not require reload. Pi does not interpret `alwaysApply`; the extension applies this policy directly without asking the model to read the file. Set `PSTACK_MODEL_POLICY` to a file path to read another policy, for example in a benchmark arm.

Configured selectors are mandatory, including effort and fast mode. An explicit `Task.model` outside the configured choices fails before execution.
Selectors for the `openai` and `openai-codex` providers match each other for the same model, effort, and fast mode. Scalar roles can omit `model`. Distinct panel or pool choices require an explicit selector, including `inherit-parent` for an inherited entry. Identical choices can omit it. Skills determine panel counts; the runtime never picks the first model or fans out.

Delivery roles separate technical acceptance from prose. `code review` and `runtime verification` are selector pools for one scoped reviewer or verifier. `publication` is a scalar role for destination Git and PR operations. `judgment and prose` remains for prose and evidence synthesis.

Absent review and verification roles inherit `arena cross-judge pool`, then `judgment and prose`. Absent `publication` inherits `judgment and prose`. Explicit settings override these compatibility defaults. Missing files and otherwise absent documented roles fall back to the agent default, then the parent. Fresh pstack dispatches require an exact `role` and a pstack capability profile. Registered pstack agents default to `pstack-leaf`. Unknown roles, malformed files, and duplicate role definitions fail clearly. Invalid files do not kill root sessions or affect unrelated Tasks. Unavailable models and unsupported effort or fast settings fail affected selections.

Use `/setup-pstack` to configure the file. For different-family reviews, select a permitted entry from another family than the implementation model. If no permitted model qualifies, report a blocker and request a policy update. Unconfigured roles allow explicit models before the agent default and parent fallback. Resume preserves the stored model rather than applying a newer policy.

In an issue workspace, runtime verifiers run in place. Otherwise, they use `isolation: { mode: "worktree", integration: "manual" }`.
Their artifacts remain inspectable, but the runtime rejects `join`.
Omitted runtime-verification isolation defaults to `manual`. Explicit `apply`, `branch`, or read-only execution fails before dispatch.
Managed reviewer and verifier resumes inherit their recorded directory and isolation when omitted.
Repository writers use relative paths in the effective child workspace.
An isolated worktree separates Git state but is not an OS sandbox.
Use the optional `pstack-sandbox` profile for OS-sandboxed runtime verification.
Never bypass it through an absolute source-checkout path or push its synthetic history as a product branch.

Read [Task contracts](skills/poteto-mode/references/task-contracts.md) for executable dispatch examples and coordinator decisions.

After updating, reload Pi before new dispatches. Before adding the three new role keys to the global policy, reload every older session that reads it. Older loaded registries reject those keys and block fresh pstack Tasks. Stage the new policy separately when active sessions cannot reload yet. Later edits to recognized role selectors do not require another reload.
Existing child contracts do not gain tools automatically.
If a retained capability contract changed, start a fresh child from its saved brief and evidence instead of weakening resume validation.
Older records without a role remain unlabeled rather than receiving a guessed role.

## Verification sandbox

Select `capability_profile: "pstack-sandbox"` for a Task with `role: "runtime verification"` and `readonly: false`.
The existing verifier isolation contract still requires a private worktree or the dedicated issue worktree.
The profile does not permit nested delegation.

For managed delivery, pass `review: { sandbox: true }` to `pstack_deliver`.
Only the runtime verifier receives the sandbox profile. Owners and static reviewers keep their existing profiles.
Sandboxing remains opt-in. A requested sandbox fails closed when the host cannot enforce it; no command runs unsandboxed automatically.

The command backend uses macOS Seatbelt through `/usr/bin/sandbox-exec`, or Bubblewrap on Linux.
Install `bwrap` separately on Linux and enable the user namespaces that it requires.
Both `bash` and `pstack_gate` deny network and writes outside the effective workspace and a private temporary directory.
Git metadata remains read-only. Direct mutation tools and other execution tools are blocked, including calls through codemode.
Commands retain shell syntax, so `bun run test`, `bun run check`, and `vp test run` need no command whitelist.
Dependencies must already exist. Shared dependency symlinks remain read-only when their targets are outside the workspace.
Test caches and generated files must stay within the private workspace or `$TMPDIR`.
Temporary files are removed after execution, failure, or cancellation.
Sandbox and ordinary gate receipts use separate cache identities.

The backend inherits only basic path, locale, home, terminal, CI, and Node environment settings.
It redirects temporary and package cache paths into the private temporary directory.
Other environment variables, including credential variables and shell startup overrides, are not inherited.
Project checks that need additional environment configuration must supply it explicitly inside their authorized workspace.

This contains command execution, not the Pi process, model-provider requests, or trusted extension code.
Read access is not confined, so readable credential files remain accessible.
Seatbelt does not provide resource quotas or prevent all same-user process signals.
Timeouts stop the ordinary process group, but commands that deliberately escape that group are outside that cleanup guarantee.
macOS `sandbox-exec` is deprecated, and Linux support depends on the host's Bubblewrap and namespace policy.

Run `PSTACK_SANDBOX_REQUIRED=1 bun run test packages/pstack/test/verification-sandbox.test.js` to require real sandbox coverage.
Without that flag, unsupported hosts report the backend limitation and skip the containment tests.

## Delivery throughput

Bounded work uses an accepted design, one implementer role, and one independent reviewer.
Each round, including every correction, goes to a fresh agent with consolidated scope. In an issue workspace, the implementation owner resumes for each correction instead, and reviewers stay fresh.
Assign the implementer before reproduction or discovery, not after a separate investigation handoff.
Run `how` and `why` in that owner's session by default. Delegate only independent slices or explicitly required perspectives.
Scoped workers load their assigned workflow instead of the coordinator's full routing catalog.
Corrections carry the accepted design, harness, and findings into fresh agents instead of restarting design or duplicating verification. Plan combined reviewers with runtime tools from their first dispatch, in place in the issue workspace or with manual isolation without one. Reviewers return one complete verdict with static, comment, deslop, and runtime findings. The implementer applies corrections. Publication includes commit and PR text without a separate prose-preparation worktree.
New or contested architecture defaults to two candidates and one independent judge.
A configured model pool does not determine fanout.

Two independent issue lanes form the initial pilot when files, dependencies, and mutable resources are disjoint.
Early probes exercise risky runtime boundaries before extensive implementation.
Reusable harnesses and artifact-bound receipts avoid repeated setup without removing required checks.

[Light mode](skills/poteto-mode/references/light-mode.md) is an operator-selected setting. It keeps the issue workspace, every landing gate, and one independent review. It cuts design panels to one runner, limits runtime verification to criteria that static review cannot observe, and skips optional fan-out. An issue escalates to full mode on a high-risk path, two rejected verdicts, or a contested design.

Read the [delivery contract](skills/poteto-mode/references/delivery-contract.md) for routing, ownership, preflight, and evidence invalidation.
Read [throughput and pilot](skills/poteto-mode/references/throughput.md) for the measurement format and interpretation limits.
Read the [continuity pilot](skills/poteto-mode/references/continuity-pilot.md) for controlled comparison and the concurrency decision.
Read [delivery operations](skills/poteto-mode/references/delivery-operations.md) for compact checkpoints, completion-driven waiting, artifact reconstruction, and browser preflight.
Two incomplete returns without meaningful progress trigger diagnosis, not an identical redispatch or automatic acceptance.
Candidates require a passing criterion matrix before independent verification.
Structural diagnosis uses the configured `hardest tasks` role without reopening accepted design automatically.
The root session model remains separate from Task model policy.

## Local footprint

The remote stack holds delivered state. Local worktrees, branches, and services exist only while an issue is in flight.
The [delivery operations](skills/poteto-mode/references/delivery-operations.md) reference defines the resource ledger and the release triggers.

A completed managed publication Task result ends with a release notice for its destination.
The notice names `scripts/release-worktree.sh` from the `poteto-mode` skill.
That script removes the worktree and its local branch only when the worktree is clean and the remote branch contains `HEAD`.
Otherwise, it prints `held` with the reason and exits with status 1.

`scripts/worktree-audit.sh` compares merge state with `origin/HEAD`, then `origin/main`, then `origin/master`. Pass `-b <ref>` when pull requests target another branch.

## Managed delivery protocol

Use `pstack_delivery` to open an issue and record a terminal Task. Its schema declares every action field at the top level, so providers that read only top-level properties still receive typed `criteria` and `runtimeRequired` fields. The ledger stores only entries owned by the current session. The reader skips corrupt entries from other sessions before it decodes their full delivery data.

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

Every checkpoint carries `next`, a deterministic next step derived from the ledger, the workspace, and the runtime records bound to the issue.
The order is: record settled attempts, wait for running ones, prepare the workspace, implement, review in parallel, correct, diagnose after two incomplete returns, refresh, and publish.
A `correct` step names the owner to resume when the issue has a workspace and the owner completed its attempt. It names `null` when a fresh owner must take the correction.
A `review` step names only the review roles that the current candidate still lacks.
A `repair` step names a review of the current candidate that failed only its report contract. Repair that report before a replacement review.

### Delivery engine

`pstack_deliver` runs that order in code for one open issue. The [engine ADR](../../docs/adr/0003-delivery-engine.md) records the design.

- The coordinator passes the owner role and brief, the reviewer models, and optional reviewer guidance.
- The engine prepares the workspace, dispatches the owner, records every attempt, and dispatches static review and runtime verification in one batch.
- It resumes the owner with the unresolved criteria, the open findings, and the reviewer reports. After a diagnosis, it gives the brief and the diagnosis to a fresh owner.
- Every engine Task passes the same managed preflight and dispatch binding as a model-issued `Task`. Records and workspace calls run through `pstack_delivery`.
- The engine stops at acceptance, at a running background Task, at a report repair, at a rejected dispatch or protocol step, after a repeated protocol step, or after `maxDispatches` Tasks. The default is 8.
- The result lists every step with its agents and duration, and it ends with the compact checkpoint.
- Abort the tool call to cancel the running Task. Call `pstack_deliver` for several issues in one turn to run them in parallel.

The engine dispatches through the `@nothingrotf/subagent/execute-task` event. A subagent version without that event rejects the first dispatch before any Task starts.

Managed Task preflight appends a delivery packet of at most 32 KiB of UTF-8.
The packet always carries every registered criterion with its exact description.
It also carries every registered finding ID, the open criteria, and the open blocking findings.
The current implementation owner, the candidate artifact, and the exact terminal packet are always present.
Retained findings, receipts, and command locators fill the remaining budget from the most recent attempt backward.
Commands and references longer than 512 characters appear as marked previews.
`Omitted retained history` reports included and omitted counts with exact `read` inputs for the omitted rows.
These inputs resolve only in the coordinator session that owns the issue ledger.
A leaf Task gains no ledger access from them. It asks its coordinator for omitted detail.
Retained rows remain prior-attempt locators, not current receipt aliases or proof.
Preflight rejects the dispatch before any Task starts when the required contract alone exceeds the budget.

`pstack_delivery` declares an output schema for codemode scripts.
A script receives `{ issue, truncated, page }`, where `page` is the parsed JSON of the text result.
A script can page through a submission and return only the verdict instead of every chunk.

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

A static reviewer runs read-only and identifies the candidate tree. When the issue requires runtime verification, a static review can return `candidate` with each execution-only criterion `pending`. It endorses the candidate when it passes every other criterion with proof and leaves no open blocking finding. Acceptance then requires an accepted runtime verdict on the same candidate. Without an issue workspace, a runtime verifier runs with a writable shell in worktree isolation with `integration: "manual"`. It starts from the integrated candidate tree and must leave its product tree unchanged. Put verifier caches and scratch output outside the product tree or in ignored paths. Manual isolation never integrates verifier output.

### Issue workspaces

`action: "workspace"` gives an open issue one persistent Git worktree. The [issue workspace ADR](../../docs/adr/0001-issue-workspaces.md) records the design.

- The worktree lives under `~/.pi/worktrees/<repository>-<id>/<issue>` on branch `pstack/<issue>`. Set `PSTACK_WORKTREE_ROOT` to move it.
- The branch starts at `base`, or at the session `HEAD` when `base` is absent. An existing branch is reused.
- The branch records its base in the Git config key `branch.<branch>.pstackbase`. A reused worktree or branch reports that base, or the merge base with the requested commit when the record is absent or stale.
- Preparation copies ignored files listed in `.worktreeinclude`, copies `node_modules` directories with copy-on-write clones when the file system supports them, and runs `.pstack/worktree-setup.sh` once. The script receives `PSTACK_ISSUE`, `PSTACK_SOURCE_ROOT`, and `PSTACK_WORKTREE`.
- The setup script writes to the log file directly, so a background service that it starts cannot block the call.
- Setup times out after 15 minutes. Set `PSTACK_SETUP_TIMEOUT_SECONDS` to change the limit. A timeout kills the whole setup process group.
- A failed setup script returns its exit code, its timeout state, and its log path, and the worktree remains for correction.
- After setup passes, writer Tasks in the workspace cannot rerun the setup script or one of its command lines. The block names the log. Prefix `PSTACK_SETUP_RERUN=1` when a changed dependency or a missing environment requires a rerun.
- Later calls return the recorded workspace. When the worktree is gone, the call prepares it again.
- The result carries `next`, like every checkpoint.

After the workspace exists, managed preflight changes fresh Tasks for that issue:

- An omitted `cwd` becomes the worktree. A `cwd` outside the worktree fails before dispatch.
- Implementation owners, runtime verifiers, and publication receive `isolation: { mode: "in-place" }` when they omit isolation. They write in the worktree under an exclusive writer lease.
- Read-only reviewers read the worktree directly, so static review and runtime verification can start together on the same tree.
- Each fresh Task prompt gains a workspace brief with the branch, the base, and the setup result. A passed setup tells the agent to reuse the environment instead of running setup again.

An in-place attempt captures its base and result trees as the artifact and counts as integrated, so `refresh` and patch joins are unnecessary.
A runtime verifier must finish with the candidate tree unchanged. A changed tree rejects its verdict.
Resume a recorded implementation owner for a correction. It keeps its context and continues in the same worktree.

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
bun src/session-metrics-cli.ts --compare /path/to/baseline.jsonl /path/to/candidate.jsonl
```

The report separates generation time from tool time, counts turns that carried a single tool call,
and totals read output, cache reads, cost, and terminal report rejections.
Codemode calls count once as tool calls. Their nested calls appear separately as nested calls per tool.
The cost includes usage that tool results report, such as classifier calls from codemode scripts.
Generation time is the wall gap before each assistant message and tool time is the wall gap before
each tool result, so concurrent tool calls count once instead of once per call.
Only the active branch is measured, so a fork, a rewind, or a compaction does not inflate the totals.

The comparison mode places a candidate session beside a frozen baseline and reports the signed change
of every counter, including calls per tool. It reports an absent baseline value as unavailable rather
than as an improvement, so a workflow change is judged against measured numbers instead of estimates.

This report reads a session file path directly and stays outside the project scope, because delivery
reviews compare sessions across repositories. Use `session_history` instead for model-facing,
project-scoped retrieval with stable references, redaction, and pagination.

### Gates

Mutable pstack Tasks receive `pstack_gate` through the `pstack-gates` registration. The [gate ADR](../../docs/adr/0002-tree-keyed-gates.md) records the design.

- The tool runs a deterministic check, such as a full suite, type check, lint, or build, with `bash -c` in the session directory.
- It keys each result by the tree of every repository in the workspace, the repository root, the working directory, and the exact command.
- A pass for an unchanged key returns at once without running the command. `fresh: true` forces a run. Failures and timeouts are never reused.
- A run that changes the tree is reported but not reused.
- Concurrent calls for one key share one run. A caller that aborts leaves the run to the others, and the run stops only when every caller aborts. `fresh: true` never joins a run in flight. Set `PSTACK_GATE_CONCURRENCY` to change the number of gates that run at once. The default is a quarter of the CPU count, with a minimum of one.
- A gate stops after 30 minutes. Set `PSTACK_GATE_TIMEOUT_SECONDS` to change the limit. A timeout or an abort kills the whole process group.
- Records and logs live in `<git common dir>/pstack/gates`. The tool keeps the newest 256 records and 512 logs.
- Each call is a tool receipt, and the delivery ledger counts it as command evidence.

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

A second table runs a real session with a local fake model for each codemode mode:

- `off`: the default tools and the named extensions.
- `on`: the same tools with codemode declarations appended, plus the `codemode` tool.
- `only`: the `codemode` tool alone, with every callable tool listed in its description.

It counts the declarations and the system prompt that the model request actually carries.
Compare the totals before you change the `codemode.mode` setting.

## Stack backends

Poteto supports Graphite `gt` and GitHub `github/gh-stack`.

If only `gh` exists, Poteto asks for approval before it runs:

```sh
gh extension install github/gh-stack
```

Set `POTETO_STACK_BACKEND=graphite` or `POTETO_STACK_BACKEND=github` to select a backend. The automatic mode prefers GitHub when both exist. Graphite remains an explicit selection and an automatic fallback.

The bundled `orch frontier set` command needs neither backend. It walks the pull request base chain from the current branch with `gh pr list`, so it reads stacks from both backends.

GitHub stack workflows require GitHub Stacked Pull Requests on the repository.
