---
name: swarm
description: "Fan out N parallel workers, drain them, and return one report. Use for /swarm, 'swarm this', or parallel coverage, races, gauntlets, and exploration."
disable-model-invocation: true
---

# Swarm

Fan out N parallel local Task workers. They can cover separate slices, race the same brief, or mix both. The parent waits, aggregates, and returns one report.

## Start

Use `todo_write` to create one item per phase before you launch anything.

1. Frame
2. Fan out
3. Aggregate
4. Report

## Phase A: Frame

1. State the done predicate and the artifact or report the swarm must return.
2. Choose the shape. Partition into slices, race N workers on identical briefs, or mix both. For a race or mixed shape, declare `first pass`, `rank all`, or `best-of` before spawning.
3. Set N from the user or derive it from the shape. N is total workers.
4. Pick worker models from `swarm workers` in `~/.agents/rules/pstack-models.md` when present. Concrete entries use `provider/model-id:effort [fast]`. Omit `Task.model` for `auto` or `inherit-parent`. If the role is absent, use inherited workers. For a model race, name each arm's model up front. Verify each concrete selector against the active Pi runtime. If Pi rejects it, mark that arm `BLOCKED`. Do not substitute a model.
5. Give each worker its own writable output when it writes. For repository writers, use `isolation: { mode: "worktree", integration: "branch" }`. For other artifacts, use `/tmp/swarm-<slug>/worker-<n>/` or another distinct output directory.

## Phase B: Fan out

Spawn all N workers in one message with parallel `Task` calls. Use `subagent_type: "generalPurpose"` and `run_in_background: true`. Native `Task` notifications report completion. Do not poll. If you are blocked with no other work, call `TaskControl` with `action: "wait"`.

Use `readonly: true` for static analysis. A worker that runs shell verification must be mutable and isolated. Keep its incidental patch unjoined unless the parent accepts it.

Every brief stands alone. Include the goal, scope, exact slice or race arm, verification method, and report contract. Require `outputSchema` with `schemaMode: "strict"`. The schema contains `status` with `PASS`, `ISSUES`, or `BLOCKED`, plus `summary`, `evidence`, and `gaps`. Require an output artifact and status, schema-valid, artifact-present, and `/status` membership gates.

If a worker drops out, proceed with N-1 and note it.

## Phase C: Aggregate

After native notifications arrive, inspect each terminal result with `TaskControl` `status`. Check the structured output, artifacts, gates, and isolation receipt. These checks validate the report contract, not the truth of its evidence.

For coverage, every required slice needs a result. For a race, apply the selection rule declared up front. Use first pass, rank all, or best-of. Do not paste raw worker dumps.

Keep a compact result table, one-line evidenced issues, and explicit gaps or dropouts.

## Phase D: Report

Return one consolidated in-chat report with the table, issue one-liners, gaps or dropouts, and the race rule when used.
