---
name: setup-pstack
description: Configure which models pstack uses per role. Detects available models and writes the runtime policy that overrides skill defaults. Use for /setup-pstack, "configure pstack models", or changing pstack's model choices.
---

# Setup pstack

Write `~/.agents/rules/pstack-models.md`. The pstack extension reads this file at startup, before each root prompt, and before root `Task` calls. It publishes an enforced policy through the `pstack-planning` capability. It adds the parsed policy to root and nested prompts. Pi does not automatically load this file through `alwaysApply`. Missing files fall back to the agent default, then the parent. Omitted new roles use the compatibility derivation in step 6.

## Steps

### 1. Detect available models

Run `pi --list-models` to detect available `provider/model-id` values. A concrete `Task` selector uses `provider/model-id:effort [fast]`. Use `off` when the model does not support reasoning. For reasoning models, ask for `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`. Add `[fast]` only when the user selects it. If detection returns no models, ask the user for available model identifiers. Never write an identifier that detection does not confirm. The aliases `inherit-parent` and `auto` are always valid.

### 2. Load current state

The default role-to-model mapping is the rule shape shown in step 5 below. If `~/.agents/rules/pstack-models.md` already exists, read it and treat its values as the current choices. Otherwise start from those defaults.

`how critics`, `code review`, `runtime verification`, and `publication` are known legacy roles.
The runtime accepts their valid configuration but ignores their selectors and publishes no dispatch role for them.
Before confirmation, list each known legacy row that the rewrite will remove and explain that it has no runtime effect.
Preserve the choices of active roles.
Unknown roles remain errors, not legacy compatibility.
If unknown roles occur, report the errors and resolve them with the operator before confirmation or rewriting.

### 3. Map and confirm

Show every role with its current model. Mark each concrete selector whose `provider/model-id` is absent from the detected set. Ask whether to accept the valid choices or change specific roles. Offer concrete selectors plus `inherit-parent` and `auto`. Both aliases run the role on the parent model. Scalar dispatches can omit `Task.model`. Every list is an availability pool. The dispatching skill owns its count and explicitly selects each required entry when choices differ, including `model: "inherit-parent"` for an inherited entry. List length never causes fanout or sets a skill's count. Prefer AskQuestion over free text.

`judgment and prose` is only for prose or evidence synthesis, never code review or verification. A second opinion comes from `arena cross-judge pool` and verification from `swarm workers`. `arena cross-judge pool`, `arena runners`, `architect runners`, and `interrogate reviewers` are availability pools whose skills own selection and count. `swarm workers` is the default model for each worker unless a race or comparison explicitly selects another configured entry per arm.

### 4. Validate

Every concrete selector must contain a detected `provider/model-id` and an effort value. `inherit-parent` and `auto` always pass. If a concrete model is unavailable, stop and ask again. An unavailable model fails dispatches that select it. Malformed files block all fresh pstack dispatches, including explicit overrides, without blocking unrelated Tasks or the root session.

### 5. Write the rule

Write `~/.agents/rules/pstack-models.md` with one line per role, using the labels below. Optional frontmatter is metadata only, never prompt content. Lines that start with `#` and Markdown comments (`<!-- ... -->`) are ignored. Overwrite the whole file so re-runs stay idempotent. Shape:

```text
---
description: pstack per-role model choices (overrides skill defaults)
---
feature, refactoring: inherit-parent
bug-fix: inherit-parent
perf-issue: inherit-parent
hillclimb: inherit-parent
judgment and prose: inherit-parent
hardest tasks: inherit-parent
how explorer: inherit-parent
how explainer: inherit-parent
why investigators: inherit-parent
why synthesizer: inherit-parent
reflect tooling: inherit-parent
reflect judgment, divergent, synthesizer: inherit-parent
arena runners: inherit-parent
arena cross-judge pool: inherit-parent
swarm workers: inherit-parent
architect runners: inherit-parent
interrogate reviewers: inherit-parent
```

### 6. Confirm

After the updated extension is loaded, rule edits apply before the next root prompt or root `Task` call without another reload. Re-running this skill updates it.

Every dispatch must pass the selected role as `Task.role`, including inherited models. Use `feature` or `refactoring` for the active grouped role. Use `why synthesizer`, `how explorer`, or another exact role label for routed workers.

Every pstack Task must select `pstack-leaf`, or `pstack-nested` for a delegating owner, and pass an exact role. Registered pstack agents default to `pstack-leaf`. Missing and unknown dispatch roles fail clearly. Grouped file keys expand to exact roles. The configuration aliases `divergent` and `synthesizer` mean `reflect divergent` and `reflect synthesizer`; use the full names in Task calls.

Omit `Task.model` for scalar roles to use the runtime policy. Configured choices are mandatory, including effort and fast mode. An explicit selector outside the configured choices fails before execution. For different-family reviews, choose a configured entry or ask the user to update the policy. Roles without an explicit entry allow explicit models before the agent default and parent fallback.

A pool with distinct choices requires an explicit selection, never first-entry selection or hidden list-size fanout. Identical choices may omit the selector. Skills own all dispatch counts. Duplicate role definitions and invalid selectors make the file invalid. Resume preserves the stored model and role. Policy edits do not require reload.

The runtime preserves the role through execution and display. A role never grants capabilities or comes from a guessed model name.

Read [Task contracts](../poteto-mode/references/task-contracts.md) for capability and isolation requirements.

### 7. Offer a verification skill (optional)

Check whether the project has a way to drive the real app for proof (a `verify-*` skill, or an existing harness). If not, offer once: "want a project-local verification skill, so agents can drive the app the way a user does and prove changes work? I can generate one with /create-verification-skill." On yes, invoke `/create-verification-skill` using its canonical installed path. On no, move on without pushing.

### 8. Offer a formal verification skill (optional)

Check whether the project already has a formal verification skill (a project skill that runs a model checker, a proof, or another verifier against the code). If not, offer once: "want a formal verification skill, so agents can prove a key property of your code holds in every case in scope, not only the cases tests reach? I can generate one with /create-formal-verification-skill." On yes, invoke `/create-formal-verification-skill` using its canonical installed path. On no, move on without pushing.
