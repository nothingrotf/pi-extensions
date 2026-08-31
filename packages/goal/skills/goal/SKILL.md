---
name: goal
description: Set a durable goal that Pi will pursue to completion.
disable-model-invocation: true
---

# Goal

Use the same durable, tool-driven flow in local environments.

## Parse

Accept `/goal <objective>`.

- If the objective is empty, show `Usage: /goal <objective>`.
- A goal has no deadline, token budget, or turn budget.
- If the request starts with a time limit, remove the limit before goal creation.
- State that time-limited goals do not have support yet.
- If the objective uses "every" for recurring work, use `/loop` instead.

## Start

1. Restate the full objective and all required evidence.
2. Call `create_goal` exactly once with the objective.
3. If creation fails, report that no goal exists.
4. Perform the first concrete work unit in the same turn.

Goal state lives in the Pi session. Do not create a goal file for continuation.

## Continue

The goal persists across turns. Keep the full objective intact until completion.

Use the current workspace and external state as authoritative evidence. Inspect the current state before use of prior context.

Optimize each turn for progress toward the requested final state. Do not substitute a narrower or easier result.

If the next work has multiple meaningful steps, keep a concise plan. A plan does not replace concrete work.

## Complete

Treat completion as unproven before the audit.

1. Derive each requirement from the objective and referenced sources.
2. Identify the authoritative evidence for each requirement.
3. Inspect current files, command output, tests, runtime behavior, or external state.
4. Verify that the evidence covers the full scope of each requirement.
5. Continue work if evidence is missing, indirect, uncertain, or contradictory.
6. Call `update_goal` with status `complete` only when no required work remains.

Do not use intent, partial progress, memory, or a plausible final response as proof.

Do not call `update_goal` unless the goal is complete or the user asks to resume a paused goal.
