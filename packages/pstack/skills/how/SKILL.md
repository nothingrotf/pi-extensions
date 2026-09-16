---
name: how
description: "Explains runtime behavior, subsystem architecture, and ownership. Use for 'how does X work', code walkthroughs, or placement questions. Use why for motivation."
disable-model-invocation: true
---

# How

Build the mental model in the agent that needs it.
Run this skill in the current session by default, including inside a leaf Task.
Do not create an explainer merely to read code or rewrite findings.
An accepted design carries its grounding. Revisit only stale, missing, or contested evidence.

## 1. Frame

State the question, relevant entrypoints, and unresolved decisions.
For a narrow question, inspect the smallest relevant surface.
For a subsystem, identify its independent boundaries before deciding whether delegation helps.
Keep the existing issue owner through investigation and implementation.

## 2. Trace

Use `find`, `grep`, and `read` to trace inputs, decisions, state changes, failures, and observable results.
Run independent tool calls in parallel when their inputs do not depend on each other.
Keep decisive evidence and rejected explanations with source references, not only a summary.
If runtime behavior matters, execute the smallest representative probe within the current authorization.
Read-only investigations do not authorize code changes.

## 3. Delegate only independent work

Delegate only when a named independent slice exceeds the owner's practical context or benefits from parallel investigation.
State the slice, expected evidence, and reason before dispatch.
A large model pool or multiple source files does not establish that reason.
Preserve an explicit user request for parallel perspectives.
If required delegation is unavailable, report the missing capability instead of silently replacing the requested review.

Before dispatch, read [Task contracts](../poteto-mode/references/task-contracts.md).
Use `subagent_type: "generalPurpose"`, `capability_profile: "pstack-leaf"`, `role: "how explorer"`, and `readonly: true` for explorers.
Omit `Task.model` for the scalar policy. Concrete selectors use `provider/model-id:effort [fast]` and must match the configured role.
Use `references/explorer-prompt.md` for the bounded question, relevant paths, and evidence requirements.
The current owner checks the returned evidence and writes the synthesis without another Task.
The `how explainer` role remains available for explicitly delegated standalone explanations, not automatic synthesis stages.
Use [Explainer prompt](references/explainer-prompt.md) for that explicit assignment.

## 4. Explain

Write Overview, Key Concepts, How It Works, Where Things Live, and Gotchas when those sections help.
Link claims to source ranges or executed evidence. Distinguish observations from inferences and unresolved questions.
Use a diagram when it clarifies ownership or data flow.
Do not dump annotated source or duplicate the complete investigation transcript.
For a pending change, retain the original question, decisive evidence, constraints, and open questions for the same owner.
