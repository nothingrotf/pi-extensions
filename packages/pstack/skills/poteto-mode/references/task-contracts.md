# Task contracts

Read this contract before dispatching pstack work. Preserve it across single calls, graph nodes, and resumes.

## Delivery contract

Read the [Delivery contract](delivery-contract.md) for per-issue fields, phases, lanes, and ownership. Pass those fields inside the `prompt` string as plain text. They are prompt content, not Task input fields, so never turn them into invented Task call parameters.

## Identity and model selection

Set `Task.role` to the role whose model policy selected this worker. Keep `subagent_type` as the executable agent definition.

Use the labels from `setup-pstack`, including `feature`, `refactoring`, `how explorer`, and `why synthesizer`. Split grouped configuration labels into the active role.

Use `code review` for independent technical review and `runtime verification` for executable acceptance evidence. Use `publication` for destination Git and PR operations. Reserve `judgment and prose` for prose and evidence synthesis. For a complex workflow owner without another named policy, use `hardest tasks`. Repository implementation keeps its active `feature`, `bug-fix`, `refactoring`, `perf-issue`, or `hillclimb` policy.

Set an exact `role` and `capability_profile` on every pstack Task, including inherited selections. Use `pstack-leaf` for leaves and `pstack-nested` for delegating owners. Registered pstack agents default to `pstack-leaf`.

The pstack extension loads `~/.agents/rules/pstack-models.md` and supplies a parsed runtime policy to root and nested context. Do not rely on an `alwaysApply` loader or copy raw file text into prompts. Omit `model` for scalar roles to use the configured selector. Configured selectors are mandatory, including effort and fast mode. An explicit selector outside the configured choices fails before execution.

For a panel or pool with distinct choices, pass the selected entry explicitly, including `model: "inherit-parent"` or `model: "auto"` for an inherited entry. Never silently use the first entry. Identical choices may omit `model`. The skill determines counts; the runtime never creates a panel or fans out.

Absent delivery roles inherit existing choices for compatibility. `code review` and `runtime verification` inherit `arena cross-judge pool`, then `judgment and prose`. `publication` inherits `judgment and prose`. Explicit role settings override these defaults. Missing files and otherwise unconfigured documented roles fall back to the agent default, then the parent. Unknown or missing dispatch roles fail for pstack capabilities. Configuration shorthand `divergent` and `synthesizer` expands to `reflect divergent` and `reflect synthesizer`; Task roles always use the full names. Duplicate keys or malformed files block fresh pstack dispatches even with an explicit override. Unrelated Tasks remain unaffected.

For different-family reviews, choose a configured entry from another family than the implementation model. Independent context alone does not provide model-family diversity. If no permitted model meets the requirement, return `BLOCKED` and request a policy update. Review and verification pools supply availability, not fanout. Select one reviewer for bounded work. Unconfigured roles allow explicit models before the agent default and parent fallback. Unavailable models and unsupported effort or fast settings fail selection.

The extension refreshes the policy before each root prompt and root `Task` call without reload. New dispatches use the latest published policy. Resume preserves the stored model even when the policy changes.

Task batches preflight every entry before starting children. An invalid role, unavailable selected model, or omitted distinct panel choice rejects the whole batch with zero child starts. Correct the invalid entry or submit a separate valid batch.

A role never grants permissions. The runtime never infers it from a model or prompt.

Preserve the role on resume. Plan the reviewer contract for the expected acceptance surface before its first dispatch. A combined static and runtime reviewer starts with `runtime verification`, shell access, and manual isolation. Static review alone uses `code review` with read-only tools. Resume compatible owners for corrections and missing report details, rather than creating a context for each pass. Start a fresh agent only when the role, model family, required capabilities, or artifact access must change. Carry the saved brief, harness, and evidence into that replacement. Never weaken resume validation.

Use the node schema for entries in `Task.tasks`. `run_in_background` belongs to single Task calls, not graph nodes. The graph scheduler owns node execution.

## Capabilities

`poteto-agent` receives session-local `todo_write` and `todo_read` through its default `pstack-leaf` profile.

For routed `generalPurpose` workers, pass `capability_profile: "pstack-leaf"`. This adds planning tools without shell access to read-only workers.

If an owner must execute `how`, `architect`, or another delegating workflow, pass `capability_profile: "pstack-nested"`. The profile permits three Task levels.

Check the remaining depth before composing owners. A three-level budget cannot support an arbitrary chain of owners before its leaf workers. When a routed workflow needs more levels, return that workflow to the root coordinator for a fresh dispatch.

Nested `Task` accepts single calls. The root coordinator owns `tasks` dependency graphs, including Reflect and maintenance waves.

A leaf must not silently skip a required delegation. Return the missing capability to the coordinator for a fresh owner dispatch.

Neither profile grants `session_history`, MCP, Loop, or ambient source tools. The root coordinator collects external evidence and supplies bounded bundles before delegation. Owners that need unavailable evidence return a blocker with the required queries. Never impersonate the root through advisory intercom.

Use the canonical skill location supplied by the registered pstack agent. Never search unrelated directories or substitute a discarded skill copy.

## Repository writer

Create the destination branch in the coordinator workspace before dispatch. Use `cwd` to select the destination, not to bypass isolation.

```json
{
  "description": "Implement the scoped feature",
  "prompt": "Read the repository brief. Implement and verify the feature in the effective workspace. Return the diff and evidence.",
  "subagent_type": "poteto-agent",
  "role": "feature",
  "capability_profile": "pstack-nested",
  "run_in_background": true,
  "isolation": { "mode": "worktree", "integration": "apply" }
}
```

Use relative product paths inside the effective child workspace. Treat absolute source paths in briefs as read-only references.

Never change into the source checkout to edit, commit, or push. A worktree separates Git state but is not an OS sandbox.

Inspect the terminal receipt and diff before `TaskControl join`. After acceptance, delegate any required destination commit, push, or stack operation separately.

Do not push a synthetic snapshot history as a product branch. Foreground destination operations require explicit scope and completed verification.

## Runtime verifier

A runtime verifier needs shell access but must never integrate incidental files. Enforce this with `integration: "manual"`.

```json
{
  "description": "Verify the exact accepted artifact",
  "prompt": "Run the scoped runtime checks in the effective workspace. Do not modify product code. Return evidence and findings.",
  "subagent_type": "poteto-agent",
  "role": "runtime verification",
  "capability_profile": "pstack-leaf",
  "readonly": false,
  "run_in_background": true,
  "isolation": { "mode": "worktree", "integration": "manual" }
}
```

For a distinct selector pool, add `model` with one permitted entry from the current runtime policy to each review example. Select another model family when independent cross-family review is required.

The runtime retains artifacts and rejects `join` for manual isolation. External reports may use an explicitly authorized path.

Use a disposable exact-head clone when verification requires pristine Git provenance. Never rewrite the source checkout or its dependencies.

## Static reviewer

```json
{
  "description": "Review the accepted patch independently",
  "prompt": "Read the accepted patch and bounded evidence. Return one complete verdict with findings, evidence, and blockers.",
  "subagent_type": "generalPurpose",
  "role": "code review",
  "capability_profile": "pstack-leaf",
  "readonly": true
}
```

Use `readonly: true` only when built-in reads and approved read-only capabilities suffice. A shell-based verifier is not a static reviewer.

Inspect the result and transcript of a completed read-only child. Do not call `TaskControl join` for read-only work or a failed child. Read-only results contain no staged patch to integrate. A rejected join does not invalidate an otherwise usable analysis.

## Output artifacts and gates

The native Task output artifact uses `text/markdown`, including when its text contains JSON. `outputSchema` validates parsed JSON separately from that artifact's media type.

For structured results, use `schema-valid` and `json-pointer` gates. Use `artifact-present` without a media type, or with `text/markdown`, for the native output artifact.

A JSON file produced inside a worktree is a separate artifact. Inspect that captured file and its contents before acceptance. A reported path alone does not prove that the file exists or matches its claimed format.

Do not apply an `application/json` media-type gate to the native Markdown artifact. Preserve the intended JSON validation through the structured result and the actual captured file.

## Decisions and completion

Use `request_parent` for a real coordinator decision. Use `ask_parent` only for non-authoritative advice within existing scope.

Only direct background Tasks can wait for a coordinator decision. Other workers return a blocker instead of assuming authorization.

Use `TaskControl wait` only when no independent work remains. A `completed` status does not imply acceptance or a passing review.

Preserve failed, blocked, and interrupted outcomes. Correct tool or environment failures before redispatch instead of weakening verification requirements.
