---
name: swarm
description: "Fan out N parallel workers, drain them, and return one report. Use for /swarm, 'swarm this', or parallel coverage, races, gauntlets, and exploration."
disable-model-invocation: true
---

# Swarm

## Start

Use `todo_write` to create one item per phase before you launch anything.

1. Frame
2. Fan out
3. Aggregate
4. Report

## Phase A: Frame

1. State the done predicate and the artifact or report the swarm must return.
2. Choose the shape. Partition into slices, race N workers on identical briefs, or mix both. For a race or mixed shape, declare `first pass`, `rank all`, or `best-of` before spawning.
3. Pick the worker model from the parsed `swarm workers` runtime policy. When the role has one selector or is absent, omit `model`. When it lists several, pass the chosen entry. If Pi rejects a selector, use another configured entry and say so. For a model race, name each arm's model up front. Pick each subagent's reasoning level for the job, per the Subagents section of the **poteto-mode** skill.
4. Give each worker its own writable output when it writes: `isolation: { mode: "worktree", integration: "branch" }` for a repository writer, or its own `/tmp/swarm-<slug>/worker-<n>/` directory. When workers verify or measure commits, each brief names the exact SHAs. A measurement brief also names the method (sample count, what one sample is, order). The worker records both in its result.

## Phase B: Fan out

Spawn all N workers in one message with parallel `Task` calls: `subagent_type: "generalPurpose"`, `role: "swarm workers"`, `capability_profile: "pstack-leaf"`, `run_in_background: true`, and the step 3 model. Use `readonly: true` for static work. A worker that runs shell verification uses `isolation: { mode: "worktree", integration: "manual" }`, and its patch is never joined. Follow [Task contracts](../poteto-mode/references/task-contracts.md).

When a worker must start from a non-default branch, set its `cwd` to a worktree of that branch.

Every brief stands alone. Include the goal, scope, exact slice or race arm, how to verify, and what to report. Reports use `PASS`, `ISSUES`, or `BLOCKED` with evidence. A worker that can prove a defect reports `ISSUES` and lists every issue it can prove, not only the first.

If a worker drops out, proceed with N-1 and note it.

## Phase C: Aggregate

Read the terminal results. Drop a result that does not record the SHAs and method its brief names, and respawn that worker once. After a second miss, record a gap. A gap does not count as a pass. For coverage, every required slice needs a result. For a race, apply the selection rule declared up front. Use first pass, rank all, or best-of. Do not paste raw worker dumps.

## Phase D: Report

Return one consolidated in-chat report with a result table, issue one-liners, gaps or dropouts, and the race rule when used.
