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
Ordinary coding requests do not activate pstack delegation.
Installation, model configuration, and references to pstack in logs or bug reports do not authorize activation.
The root prompt states this boundary before the model policy.
The extension enforces model selection, but activation remains a model instruction rather than a runtime authorization gate.

## Resources

The package provides 56 upstream skills, four Pi compatibility skills, and the local `pr` skill. Every PR body uses `pr`. `make-bot-ui` remains outside the project by explicit decision.

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
- `ketchup-video`
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

- A fix round, a follow-up, a retry, and the next queue item go to a fresh agent with consolidated scope.
- Autopilots arm `/loop 1h` with event watchers instead of `/goal`.
- Each owner works in place in a linked worktree on its own branch, so it pushes and opens its own PR.
- The root removes each linked worktree after its PR lands or closes with `scripts/release-worktree.sh`.
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
- The playbooks keep the Graphite and GitHub stack backends. They take the principles from #613 without its base-chain landing steps or the Origin forge.
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

These upstream changes through [#807](https://github.com/cursor/plugins/pull/807) at `e73df471cd4bd918367e99f3dd9c51bd53ddf5f0` are also synchronized:

- [#791](https://github.com/cursor/plugins/pull/791) updates `statechart` for any system that moves between states. It renders PNGs with Pele and resvg, installs TLC and Java with mise when `TLA2TOOLS` is unset, and removes the bundled `OutputFolder` model.
- [#794](https://github.com/cursor/plugins/pull/794) makes generated TLA+ verification skills read each model-check result with `statechart`.
- [#797](https://github.com/cursor/plugins/pull/797) adds `ketchup-video`. It shows the `ketchup` catch-up as a short silent video of slides, with the waiting calls as text under it.
- [#800](https://github.com/cursor/plugins/pull/800) makes `reflect` copy an installed skill to a user or project skill directory and edit the copy. It never opens a PR or pushes.
- [#801](https://github.com/cursor/plugins/pull/801) and [#802](https://github.com/cursor/plugins/pull/802) make the bundled `watch-pr` distinguish fork heads during stack discovery and cap polling sleeps at the deadline.
- [#803](https://github.com/cursor/plugins/pull/803) makes `check-plan.mjs` match inline code spans by delimiter length.
- [#804](https://github.com/cursor/plugins/pull/804) makes the bundled `orch` prefer the open pull request of a branch over closed or merged ones.
- [#807](https://github.com/cursor/plugins/pull/807) makes the `swarm` report ask for a result table.

The Pi port adapts or omits these parts:

- The `orch` and `watch-pr` bundles are built with `bun build --target bun --minify --packages external` from the upstream sources without the dependency bootstrap.
- `reflect` targets the Pi and Agent Skills directories instead of `plugins/cache/` and `.cursor/skills/`. It reports a name collision when Pi keeps the package skill.
- The `statechart` suite installs Pele and resvg with npm into the user cache on its first run. It skips PNG cases when that install fails and TLC cases when neither `TLA2TOOLS` nor mise can supply TLC.
- The `swarm` Phase A numbering from [#807](https://github.com/cursor/plugins/pull/807) already holds locally.
- [#805](https://github.com/cursor/plugins/pull/805) has no local counterpart because the local `worktree-audit.sh` does not read transcript times.
- The Claude Code auto-update note from [#806](https://github.com/cursor/plugins/pull/806), `poteto-help`, the guide, and the version bumps have no local counterpart.

## Task roles and workspace contracts

Each workflow passes an explicit `Task.role`, such as `feature`, `refactoring`, or `why synthesizer`.
The runner preserves this label beside the model without inferring it from the model name.
With a pstack capability profile, the role enforces the configured model choices. It never grants capabilities.

The extension reads `~/.agents/rules/pstack-models.md` at startup, before each root prompt, and before root `Task` calls. It publishes the parsed policy through `pstack-planning` and renders it into root and nested context. Policy edits do not require reload. Pi does not interpret `alwaysApply`; the extension applies this policy directly without asking the model to read the file. Set `PSTACK_MODEL_POLICY` to a file path to read another policy, for example in a benchmark arm. Lines that start with `#` and Markdown comments (`<!-- ... -->`) are ignored.

Configured selectors are mandatory, including effort and fast mode. An explicit `Task.model` outside the configured choices fails before execution.
Selectors for the `openai` and `openai-codex` providers match each other for the same model, effort, and fast mode. Scalar roles can omit `model`. Distinct panel or pool choices require an explicit selector, including `inherit-parent` for an inherited entry. Identical choices can omit it. Skills determine panel counts; the runtime never picks the first model or fans out.

Pstack uses the upstream roles. A second opinion selects one entry of `arena cross-judge pool` from another model family. Verification uses `swarm workers`. The branch owner publishes its own PR. `judgment and prose` remains for prose and evidence synthesis.

The parser ignores older `how critics`, `code review`, `runtime verification`, and `publication` lines, so those files stay valid. Missing files and absent documented roles fall back to the agent default, then the parent. Fresh pstack dispatches require an exact `role` and a pstack capability profile. Registered pstack agents default to `pstack-leaf`. Unknown roles, malformed files, and duplicate role definitions fail clearly. Invalid files do not kill root sessions or affect unrelated Tasks. Unavailable models and unsupported effort or fast settings fail affected selections.

Use `/setup-pstack` to configure the file. For different-family reviews, select a permitted entry from another family than the implementation model. If no permitted model qualifies, report a blocker and request a policy update. Unconfigured roles allow explicit models before the agent default and parent fallback. Resume preserves the stored model rather than applying a newer policy.

Runtime verifiers use `isolation: { mode: "worktree", integration: "manual" }`.
Their artifacts remain inspectable, but the runtime rejects `join`.
Repository writers use relative paths in the effective child workspace.
An isolated worktree separates Git state but is not an OS sandbox.
Use the optional `pstack-sandbox` profile for OS-sandboxed runtime verification.
Never bypass it through an absolute source-checkout path or push its synthetic history as a product branch.

Read [Task contracts](skills/poteto-mode/references/task-contracts.md) for executable dispatch examples and coordinator decisions.

After updating, reload Pi before new dispatches. Later edits to recognized role selectors do not require another reload.
Existing child contracts do not gain tools automatically.
If a retained capability contract changed, start a fresh child from its saved brief and evidence instead of weakening resume validation.
Older records without a role remain unlabeled rather than receiving a guessed role.

## Verification sandbox

Select `capability_profile: "pstack-sandbox"` for a mutable verifier Task with `readonly: false`.
The verifier isolation contract still requires a private worktree.
The profile does not permit nested delegation.
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

## Delivery

`/poteto-mode` follows the upstream flow.
The coordinator owns the design, the review, and the verdict. One `poteto-agent` owner per issue builds the change in place in a linked worktree on its own branch, then commits, pushes, and opens the PR.
The owner proves each unit with focused checks and runs the repository-required gates once on the finished head. It never runs a full suite for a WIP report. A slow suite that CI already runs stays in CI unless the brief names a local reason.
The coordinator reads the diff, gets one `arena cross-judge pool` second opinion from another model family, and verifies load-bearing behavior on the matching surface. A fresh owner takes each correction.
Autopilot-full and Autopilot-stack follow their upstream playbooks with these owners. Shipping keeps its independent per-PR verdict before landing.

## Local footprint

The remote stack holds delivered state. Local worktrees, branches, and services exist only while an issue is in flight.

Release a linked worktree with `scripts/release-worktree.sh` from the `poteto-mode` skill after its PR lands or closes.
That script removes the worktree and its local branch only when the worktree is clean and the remote branch contains `HEAD`.
Otherwise, it prints `held` with the reason and exits with status 1.

`scripts/worktree-audit.sh` compares merge state with `origin/HEAD`, then `origin/main`, then `origin/master`. Pass `-b <ref>` when pull requests target another branch.

## Gates

Mutable pstack Tasks receive `pstack_gate` through the `pstack-gates` registration. The [gate ADR](../../docs/adr/0002-tree-keyed-gates.md) records the design.

- The tool runs a deterministic check, such as a full suite, type check, lint, or build, with `bash -c` in the session directory.
- It keys each result by the tree of every repository in the workspace, the repository root, the working directory, and the exact command.
- A pass for an unchanged key returns at once without running the command. `fresh: true` forces a run. Failures and timeouts are never reused.
- A run that changes the tree is reported but not reused.
- Concurrent calls for one key share one run. A caller that aborts leaves the run to the others, and the run stops only when every caller aborts. `fresh: true` never joins a run in flight. Set `PSTACK_GATE_CONCURRENCY` to change the number of gates that run at once. The default is a quarter of the CPU count, with a minimum of one.
- A gate stops after 30 minutes of awake time. Time while the machine sleeps does not count. Set `PSTACK_GATE_TIMEOUT_SECONDS` to change the limit. A timeout or an abort kills the whole process group.
- Records and logs live in `<git common dir>/pstack/gates`. The tool keeps the newest 256 records and 512 logs.
- Each call is a tool receipt.

## Session metrics

Derive per-session latency directly from a recorded session:

```sh
bun src/session-metrics-cli.ts /absolute/path/to/session.jsonl
bun src/session-metrics-cli.ts --json /absolute/path/to/session.jsonl
bun src/session-metrics-cli.ts --compare /path/to/baseline.jsonl /path/to/candidate.jsonl
```

The report separates generation time from tool time, counts turns that carried a single tool call,
and totals read output, cache reads, and cost.
Codemode calls count once as tool calls. Their nested calls appear separately as nested calls per tool.
The cost includes usage that tool results report, such as classifier calls from codemode scripts.
Generation time is the wall gap before each assistant message and tool time is the wall gap before
each tool result, so concurrent tool calls count once instead of once per call.
Only the active branch is measured, so a fork, a rewind, or a compaction does not inflate the totals.

The comparison mode places a candidate session beside a frozen baseline and reports the signed change
of every counter, including calls per tool. It reports an absent baseline value as unavailable rather
than as an improvement, so a workflow change is judged against measured numbers instead of estimates.

This report reads a session file path directly and stays outside the project scope, because reviews
compare sessions across repositories. Use `session_history` instead for model-facing,
project-scoped retrieval with stable references, redaction, and pagination.

## Tool definition cost

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
