---
name: interrogate
description: "Use for \"interrogate\", \"adversarial review\", \"multi-model review\", \"challenge this\", \"stress test this code\", \"find blind spots\", or \"tear this apart\". Adversaries try to break a change or design, and only findings proven by a run survive."
disable-model-invocation: true
---

# Interrogate

Adversaries try to break a change or a design. A finding survives only when a run proves it. Report the findings. Do not apply fixes.

## Frame

The scope is what the user names. Otherwise it is the branch diff from its merge base with the base branch, through the working tree. State the intent with the **in-your-own-words** skill, from the user's message, the commits, and the PR description. Ask the user with `AskQuestion` when the intent is unclear.

## Fan out

Read [Task contracts](../poteto-mode/references/task-contracts.md) before dispatch. Run Phase A steps 3 and 4 and Phase B of the **arena** skill, with these changes:

- Read the parsed `interrogate reviewers` runtime policy in place of `arena runners`. One adversary runs per entry, so the list length sets the count. If the role is absent, run three adversaries on the parent model.
- Each adversary passes its entry as `Task.model`, including `inherit-parent` or `auto`. A rejected selector follows arena step 3.
- Dispatch each adversary with `role: "interrogate reviewers"`, `capability_profile: "pstack-leaf"`, `subagent_type: "generalPurpose"`, `readonly: false`, `run_in_background: true`, and `isolation: { mode: "worktree", integration: "manual" }`. Set its `cwd` to the checkout that holds the scope, so its private worktree carries the uncommitted changes. Never join its incidental patch.
- In place of the arena task and rationale, give each adversary the scope, the intent, and this brief:

> Break this change. Prove each finding with a run against the real code, such as a failing test, a repro script, or command output that shows the wrong behavior. For a design or plan, run a prototype or probe the current tree. Keep repros in your own worktree. Report each finding with a title, the exact command, the output it printed, and the output the intent requires. Leave out anything you did not run. That covers style, naming, structure, and risks that need a future change to matter. No findings is a valid result.

## Verify

Verify each finding per arena Phase F by rerunning its command. Keep a finding when the output shows the failure and the failure breaks the intent. Drop the rest. Merge findings that share a root cause.

Skip arena Phases C, D, and E. Adversaries find different failures, so the verdict keeps every verified finding, not one adversary's list.

## Output

- **Intent**: the restatement.
- **Findings**: for each verified finding, the command, its output, how it breaks the intent, and the adversaries that found it. Say "no verified findings" when none survive.
- **Dropped**: for each adversary, the count of dropped findings and why.
