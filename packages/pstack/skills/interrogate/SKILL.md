---
name: interrogate
description: "Use for \"interrogate\", \"adversarial review\", \"multi-model review\", \"challenge this\", \"stress test this code\", \"find blind spots\", or \"tear this apart\". Multiple LLM reviewers challenge changes from independent angles."
disable-model-invocation: true
---

# Interrogate

Run TWO distinct, independently executed reviewer perspectives by default. Prefer distinct configured models so the adversarial signal comes from model diversity, not assigned personas. The deliverable is a synthesized verdict. Do NOT auto-apply changes. After presenting it, wait for explicit user approval before any fix work.

## Step 1, Scope

Identify what to review from context:

- If the user points at specific files or a diff, use that.
- If on a feature branch, run `git diff main...HEAD` (or the appropriate base branch) for the full changeset.
- If the user's message references recent work, gather the relevant files.

Package the diff or file contents with any surrounding context files the reviewers need to understand the code.

## Step 2, Intent

Before spawning reviewers, state the intent in one clear paragraph from the user's message, commit messages, the PR description if one exists, and the code. If you're unsure about the intent, ask the user before proceeding.

## Step 3, Spawn Reviewers

Launch the two reviewers in a single message using the Task tool. Use the parsed `interrogate reviewers` runtime policy as an availability pool. The skill owns the count. Never launch one reviewer per list entry.

Use more than two reviewers only when the user gives an explicit count or when you state a concrete coverage justification before dispatch. Select the smallest justified set. If the role is absent, run exactly two inherited reviewer perspectives, Reviewer A and Reviewer B. There is no four-reviewer inherited fallback.

Concrete configured models use `provider/model-id:effort [fast]`. Prefer two distinct configured entries. If the configured pool cannot supply the requested model diversity, report that limitation and use only configured choices. Never invent or substitute an unconfigured selector.

Read [Task contracts](../poteto-mode/references/task-contracts.md) before dispatch.

For each reviewer:
- `role`: `interrogate reviewers`
- `capability_profile`: `pstack-leaf`
- `subagent_type`: `generalPurpose`
- `model`: the explicitly selected `interrogate reviewers` entry, including `auto` or `inherit-parent`; omit only when the role is unconfigured or all configured choices are identical
- `readonly`: `true`

If Pi rejects a selected concrete model, mark that perspective `BLOCKED` and report the invalid configuration. Continue with the remaining reviewer. Do not substitute a different model. Explicitly pass inherited selections as `model: "inherit-parent"` or `model: "auto"` when the pool contains distinct choices. Never treat those aliases as invalid selectors.

Read `references/reviewer-prompt.md` and fill in the same template for every reviewer with the stated intent, the diff or file contents, the rubric from `references/rubric.md`, and the code-quality lens from `references/code-quality-review.md`.

## Step 4, Synthesize

As results come back, build a unified picture. Parse every reviewer's findings. Merge findings that describe the same issue differently, and note which models raised each one. Findings two or more models raised independently are the highest signal. Read a lone model's finding, but weight it accordingly. Note disagreements. If one model flags something and another explicitly says the opposite, that is context for the verdict.

## Step 5, Lead Judgment

You are the lead reviewer, a pragmatic senior engineer, not a neutral aggregator. Read `references/lead-judgment.md` for the full framework. Put every finding in one of four buckets, with the model(s) that raised it and a one-line rationale.

- **Act on**. Real issues affecting correctness, security, or maintainability given the actual goals. They would block a real PR.
- **Consider**. Legitimate, but you're not sure they outweigh the cost of addressing them now. Worth the user's attention.
- **Noted**. Technically valid but not actionable. Context-dependent, premature optimization, or low-impact at this stage.
- **Dismissed**. Wrong, nitpicky, or missing context, with a brief reason.

## Output Format

### Intent
> [The stated intent paragraph from Step 2]

### Reviewers
- Reviewer [label]: [model name], [N findings] (one bullet per reviewer)

### Act On
[Each: description, which models raised it, why it matters.]

### Consider
[Each: description, which models raised it, the tradeoff.]

### Noted
[Brief list.]

### Dismissed
[Each with a brief rationale.]

### Agreement Map
[Where models agreed and diverged, and what that pattern tells us.]
