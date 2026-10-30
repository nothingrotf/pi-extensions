---
name: interrogate
description: "Use for \"interrogate\", \"adversarial review\", \"multi-model review\", \"challenge this\", \"stress test this code\", \"find blind spots\", or \"tear this apart\". Adversaries try to break a change or design, and only findings proven by a run survive."
disable-model-invocation: true
---

# Interrogate

Adversaries try to break a change or a design. A finding survives only when a run proves it. Report the findings. Do not apply fixes. After you present them, wait for explicit user approval before any fix work.

## Frame

The scope is what the user names. Otherwise it is the branch diff from its merge base with the base branch, through the working tree. State the intent with the **in-your-own-words** skill, from the user's message, the commits, and the PR description. Ask the user with `AskQuestion` when the intent is unclear.

## Fan out

Read [Task contracts](../poteto-mode/references/task-contracts.md) before dispatch. Run Phase A steps 3 and 4 and Phase B of the **arena** skill, with these changes:

- Read the parsed `interrogate reviewers` runtime policy in place of `arena runners`. It is an availability pool. Never launch one adversary per list entry. Run TWO distinct, independently executed adversaries by default, and prefer distinct configured models. Use more only when the user gives an explicit count or when you state a concrete coverage justification before dispatch. If the role is absent, run exactly two inherited adversaries. There is no four-adversary inherited fallback.
- Concrete configured models use `provider/model-id:effort [fast]`. Never invent or substitute an unconfigured selector. Pass each selected entry explicitly when the pool has distinct choices, including `inherit-parent` or `auto`. If Pi rejects a selected concrete model, mark that adversary `BLOCKED`, report the invalid configuration, and continue with the rest.
- Dispatch each adversary with `role: "interrogate reviewers"`, `capability_profile: "pstack-leaf"`, `subagent_type: "generalPurpose"`, `readonly: false`, `run_in_background: true`, and `isolation: { mode: "worktree", integration: "manual" }`. Set its `cwd` to the checkout that holds the scope, so its private worktree carries the uncommitted changes. Never join its incidental patch.
- In place of the arena task and rationale, give each adversary the scope, the intent, and this brief:

> Break this change. Prove each finding with a run against the real code, such as a failing test, a repro script, or command output that shows the wrong behavior. For a design or plan, run a prototype or probe the current tree. Keep repros in your own worktree. Report each finding with a title, the exact command, the output it printed, and the output the intent requires. Leave out anything you did not run. That covers style, naming, structure, and risks that need a future change to matter. No findings is a valid result.

## Verify

Verify each finding per arena Phase F by rerunning its command against the scope. Keep a finding when the output shows the failure and the failure breaks the intent. Drop the rest. Merge findings that share a root cause.

Skip arena Phases C, D, and E. Adversaries find different failures, so the verdict keeps every verified finding, not one adversary's list.

## Output

- **Intent**: the restatement.
- **Adversaries**: each adversary's model, its finding count, and any `BLOCKED` seat.
- **Findings**: for each verified finding, the command, its output, how it breaks the intent, and the adversaries that found it. Say "no verified findings" when none survive.
- **Dropped**: for each adversary, the count of dropped findings and why.
