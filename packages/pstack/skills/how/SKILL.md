---
name: how
description: "Use for \"how does X work\", code walkthroughs before changing something, and placement / ownership / layering questions (\"where should this live\", \"which package owns this\", \"is this the right layer\"). Explains subsystem architecture, runtime flow, onboarding mental models. Use why for motivation."
disable-model-invocation: true
---

# How

Explore the codebase to answer "how does X work?" questions.

If the scope is ambiguous, state your interpretation and explore. The user can redirect.

## 1. Explain

Spawn one read-only Task that explores and explains in one pass. Read [Task contracts](../poteto-mode/references/task-contracts.md) before dispatch. Use `subagent_type: "generalPurpose"`, `capability_profile: "pstack-leaf"`, `role: "judgment and prose"`, and `readonly: true`. Omit `Task.model` to use the configured selector. Give it the user's question and this brief:

> You are writing an architectural explanation for a senior engineer. Explore the codebase and write an explanation that a senior engineer unfamiliar with this area could read and walk away with a solid mental model. They should understand the architecture well enough to start working in it confidently. You have read-only access to the codebase.

When you run as a leaf Task without `Task` access, explore and write the explanation yourself in the current session.

## 2. Present

Present the subagent's output. Light edits for clarity or context from the conversation are fine. Do not substantially rewrite it.
