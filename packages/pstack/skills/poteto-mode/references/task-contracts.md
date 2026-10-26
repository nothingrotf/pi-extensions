# Task contracts

Read this contract before dispatching pstack work. Preserve it across single calls, graph nodes, and resumes.

## Task input

Pass scope, design, evidence, and acceptance context inside `prompt`, never as invented Task input fields.
A brief can name its ticket in an `issue:` line. That line is context for the worker and binds nothing.

## Identity and model selection

Set `Task.role` to the role whose model policy selected this worker. Keep `subagent_type` as the executable agent definition.

Use the labels from `setup-pstack`, including `feature`, `refactoring`, `how explorer`, and `why synthesizer`. Split grouped configuration labels into the active role.

Use one entry of `arena cross-judge pool` for an independent second opinion and `swarm workers` for verification. The branch owner commits, pushes, and opens its own PR. Reserve `judgment and prose` for prose and evidence synthesis. For a complex workflow owner without another named policy, use `hardest tasks`. Repository implementation keeps its active `feature`, `bug-fix`, `refactoring`, `perf-issue`, or `hillclimb` policy.

Set an exact `role` and `capability_profile` on every pstack Task, including inherited selections. Use `pstack-leaf` for leaves and `pstack-nested` for delegating owners. Registered pstack agents default to `pstack-leaf`.

The pstack extension loads `~/.agents/rules/pstack-models.md` and supplies a parsed runtime policy to root and nested context. Do not rely on an `alwaysApply` loader or copy raw file text into prompts. Omit `model` for scalar roles to use the configured selector. Configured selectors are mandatory, including effort and fast mode. An explicit selector outside the configured choices fails before execution.

For a panel or pool with distinct choices, pass the selected entry explicitly, including `model: "inherit-parent"` or `model: "auto"` for an inherited entry. Never silently use the first entry. Identical choices may omit `model`. The skill determines counts; the runtime never creates a panel or fans out.

Missing files and unconfigured documented roles fall back to the agent default, then the parent. Unknown or missing dispatch roles fail for pstack capabilities. Configuration shorthand `divergent` and `synthesizer` expands to `reflect divergent` and `reflect synthesizer`; Task roles always use the full names. Duplicate keys or malformed files block fresh pstack dispatches even with an explicit override. Unrelated Tasks remain unaffected.

For different-family reviews, choose a configured entry from another family than the implementation model. Independent context alone does not provide model-family diversity. If no permitted model meets the requirement, return `BLOCKED` and request a policy update. Review and verification pools supply availability, not fanout. Select one reviewer for bounded work. Unconfigured roles allow explicit models before the agent default and parent fallback. Unavailable models and unsupported effort or fast settings fail selection.

The extension refreshes the policy before each root prompt and root `Task` call without reload. New dispatches use the latest published policy. Resume preserves the stored model even when the policy changes.

Choose effort from the configured role policy, not the apparent importance of its title.
Before proposing higher effort, identify the unresolved reasoning failure and rule out missing context, unavailable tools, and environment failures.
Keep the active role when escalating implementation, review, or verification; never relabel that work as `hardest tasks` to bypass policy.
If the role permits no suitable selector, request a policy update instead of silently increasing effort.
A changed selector requires a fresh agent with the retained brief, artifact, harness, and evidence.

Task batches preflight every entry before starting children. An invalid role, unavailable selected model, or omitted distinct panel choice rejects the whole batch with zero child starts. Correct the invalid entry or submit a separate valid batch.

A role never grants permissions. The runtime never infers it from a model or prompt.

Preserve the role on resume. Plan the reviewer contract for the expected acceptance surface before its first dispatch. A combined static and runtime reviewer starts with `swarm workers`, shell access, and manual isolation. Static review alone uses one entry of `arena cross-judge pool` with read-only tools. Give code corrections and missing proof to a fresh agent with consolidated scope, per the poteto-mode Subagents section. Resume only when the new work strictly needs state that lives in the agent and is costly to move. A changed role, model family, capability set, or artifact access always requires a fresh agent. Carry the saved brief, harness, and evidence into each fresh agent. Never weaken resume validation.

Use the node schema for entries in `Task.tasks`. `run_in_background` belongs to single Task calls, not graph nodes. The graph scheduler owns node execution.
Codemode can dispatch a single Task only with explicit `run_in_background: true`, subject to the same role and model checks.
Return the Agent ID to the coordinator. Call foreground Tasks, batch graphs, and `TaskControl wait` directly, outside scripts.
Non-wait `TaskControl` actions retain their existing scope and acceptance requirements.
If a script fails after earlier calls execute, inspect the retained results instead of replaying the entire script.

## Capabilities

`poteto-agent` receives session-local `todo_write` and `todo_read` through its default `pstack-leaf` profile.

For routed `generalPurpose` workers, pass `capability_profile: "pstack-leaf"`. This adds planning tools without shell access to read-only workers.

Run `how` and `why` inside the current owner with `pstack-leaf` by default. Neither workflow requires delegation for ordinary investigation.
If an owner must execute `architect` or another explicitly delegating workflow, pass `capability_profile: "pstack-nested"`. The profile permits three Task levels.

Check the remaining depth before composing owners. A three-level budget cannot support an arbitrary chain of owners before its leaf workers. When a routed workflow needs more levels, return that workflow to the root coordinator for a fresh dispatch.

Nested `Task` accepts single calls. The root coordinator owns `tasks` dependency graphs, including Reflect and maintenance waves.

A leaf must not silently skip a required delegation. Return the missing capability to the coordinator for a fresh owner dispatch.

Neither profile grants `session_history`, MCP, Loop, or ambient source tools. The root coordinator collects external evidence and supplies bounded bundles before delegation. Owners that need unavailable evidence return a blocker with the required queries. Never impersonate the root through advisory intercom.

Use the canonical skill location supplied by the registered pstack agent. Never search unrelated directories or substitute a discarded skill copy.
Scoped workers read `worker.md` and their assigned workflow. Full coordinators read `../SKILL.md`.
Reuse unchanged readings within the same session when policy permits. Preserve explicit requirements to reread.

## Repository writer

Create a linked worktree on the issue branch before dispatch, such as `git worktree add -b <branch> <path> <base>`. Prepare its dependencies per the repository's setup.
Create the worktree in one tool call and dispatch the owner in a later call. A Task in the same parallel batch can start before the worktree exists.
Reuse that worktree across correction rounds. After the PR lands or closes, release it with `scripts/release-worktree.sh <path>` from the poteto-mode skill.

Dispatch the owner in place there. A mutable Task with its `cwd` in a linked worktree outside the session repository runs in place by default.
It commits, pushes its own branch, and opens its PR per Opening a PR. Its writes stay in the worktree without a join.
An isolated worktree has no remotes, so never assign push or PR work to a Task that runs there:

```json
{
  "description": "Implement the scoped feature",
  "prompt": "Read the repository brief. Implement the feature on this branch, prove it with focused checks, run the required gates once on the finished head, then push and open the PR. Return the PR URL, head SHA, and evidence.",
  "subagent_type": "poteto-agent",
  "role": "feature",
  "capability_profile": "pstack-leaf",
  "run_in_background": true,
  "cwd": "<linked worktree path>",
  "isolation": { "mode": "in-place" }
}
```

One in-place writer holds a worktree at a time. A correction goes to a fresh owner in the same worktree after the previous owner settles.
An in-place writer cannot stop with zero writes. Cancel keeps its partial edits in the worktree for the next round.

## Isolated writer

A writer that does not publish, such as an arena candidate, can run in a private worktree:

```json
{
  "description": "Sketch one candidate design",
  "prompt": "Read the brief. Build the candidate in the effective workspace. Return the diff and evidence.",
  "subagent_type": "poteto-agent",
  "role": "architect runners",
  "model": "<one configured entry>",
  "capability_profile": "pstack-leaf",
  "run_in_background": true,
  "isolation": { "mode": "worktree", "integration": "apply" }
}
```

Use relative product paths inside the effective child workspace. Treat absolute source paths in briefs as read-only references.

Never change into the source checkout to edit, commit, or push. A worktree separates Git state but is not an OS sandbox.

Inspect the terminal receipt and diff before `TaskControl join`. The runtime releases a staged writer's execution tree after capture, so read its result through the patch or result commit.

Do not push a synthetic snapshot history as a product branch.

## Runtime verifier

A runtime verifier uses `swarm workers` with shell access. It must never integrate incidental files, so pass `isolation: { mode: "worktree", integration: "manual" }` explicitly.
Point its `cwd` at the worktree for the exact head under test.
Include prior requirements in the verification plan, not only the latest change or the implementer's chosen tests.

```json
{
  "description": "Verify the exact head",
  "prompt": "Verify the change on the real surface. Check new behavior, prior requirements, and relevant negative and boundary cases. Do not modify product code. Return PASS, PASS+NOTES, or FAIL with evidence.",
  "subagent_type": "poteto-agent",
  "role": "swarm workers",
  "capability_profile": "pstack-leaf",
  "readonly": false,
  "run_in_background": true,
  "cwd": "<worktree path at the exact head>",
  "isolation": { "mode": "worktree", "integration": "manual" }
}
```

For optional OS containment, select `capability_profile: "pstack-sandbox"` instead of `pstack-leaf`.
Both shell commands and gates then deny network and writes outside the effective workspace and private temporary storage.
An unavailable backend blocks execution. Never retry with an unsandboxed profile without authorization.
This does not confine reads, trusted extension code, or the model-provider connection.

The runtime retains artifacts and rejects `join` for manual isolation. External reports may use an explicitly authorized path.

Use a disposable exact-head clone when verification requires pristine Git provenance. Never rewrite the source checkout or its dependencies.

## Second opinion

A second opinion is the same review against a different model. Use one read-only Task with one entry of `arena cross-judge pool` from another family than the implementation:

```json
{
  "description": "Review the finished head independently",
  "prompt": "Review the diff from <base> to <head> in <worktree path>. Return one complete verdict with findings, evidence, and blockers.",
  "subagent_type": "generalPurpose",
  "role": "arena cross-judge pool",
  "model": "<one configured entry from another family>",
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
Preflight rejects incompatible native artifact types, invalid JSON Pointer syntax, and structured-result gates without an output schema.
It also rejects supported schema contradictions before allocating a child, model session, or worktree.
For a batch, correct every invalid entry before retrying. No valid sibling starts when batch preflight fails.

## Decisions and completion

Use `request_parent` for a real coordinator decision. Use `ask_parent` only for non-authoritative advice within existing scope.

Only direct background Tasks can wait for a coordinator decision.
In a foreground or nested Task, `request_parent` returns an error and the worker keeps running.
The worker then finishes and retains its authorized work, and it reports the open decision instead of assuming authorization.

Use `TaskControl wait` only when no independent work remains. A `completed` status does not imply acceptance or a passing review.

```json
{
  "action": "wait",
  "agent_ids": ["<agent-id from the dispatch receipt>"]
}
```

Omit `timeout_ms`. The wait settles on the child's completion, so a short window only adds coordinator turns.
Each extra turn re-reads the whole coordinator context and can miss the provider prompt cache, which costs far more than the wait itself.
Set `timeout_ms` only for an explicit liveness deadline shorter than the default hour.

Use `agent_ids`, not `agent_id`, for wait.
Keep numbers, booleans, arrays, and isolation objects typed, not JSON-encoded strings.
The wait returns on a watched completion, decision request, timeout, or abort, not after all children finish.
On a decision request, inspect `inbox` and reply using its returned `request_id`.
On timeout, inspect bounded status once and wait again if no other work is ready.
Never replace wait with shell `sleep` or repeated status polling.
Call wait alone. A parallel shell `sleep` delays decision replies past their 5-minute deadline.

Preserve failed, blocked, and interrupted outcomes. Correct tool or environment failures before redispatch instead of weakening verification requirements.
