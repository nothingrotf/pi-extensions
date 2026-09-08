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

Missing files and absent documented roles fall back to the agent default, then the parent. Fresh pstack dispatches require an exact `role` and a pstack capability profile. Registered pstack agents default to `pstack-leaf`. Unknown roles, malformed files, and duplicate role definitions fail clearly. Invalid files do not kill root sessions or affect unrelated Tasks. Unavailable models and unsupported effort or fast settings fail affected selections.

Use `/setup-pstack` to configure the file. For different-family reviews, select a configured entry or update the policy with user approval. Unconfigured roles allow explicit models before the agent default and parent fallback. Resume preserves the stored model rather than applying a newer policy.

Runtime verifiers use `isolation: { mode: "worktree", integration: "manual" }`.
Their artifacts remain inspectable, but the runtime rejects `join`.
Repository writers use relative paths in the effective child workspace.
An isolated worktree separates Git state but is not an OS sandbox.
Never bypass it through an absolute source-checkout path or push its synthetic history as a product branch.

Read [Task contracts](skills/poteto-mode/references/task-contracts.md) for executable dispatch examples and coordinator decisions.

After updating, reload Pi before new dispatches.
Existing child contracts do not gain tools automatically.
If a retained capability contract changed, start a fresh child from its saved brief and evidence instead of weakening resume validation.
Older records without a role remain unlabeled rather than receiving a guessed role.

## Stack backends

Poteto supports Graphite `gt` and GitHub `github/gh-stack`.

If only `gh` exists, Poteto asks for approval before it runs:

```sh
gh extension install github/gh-stack
```

Set `POTETO_STACK_BACKEND=graphite` or `POTETO_STACK_BACKEND=github` to select a backend. The automatic mode prefers GitHub when both exist. Graphite remains an explicit selection and an automatic fallback.

GitHub stack workflows require GitHub Stacked Pull Requests on the repository.
