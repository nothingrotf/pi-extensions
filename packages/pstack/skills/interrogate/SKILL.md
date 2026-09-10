---
name: interrogate
description: "Use for \"interrogate\", \"adversarial review\", \"multi-model review\", \"challenge this\", \"stress test this code\", \"find blind spots\", or \"tear this apart\". Multiple LLM reviewers challenge changes from independent angles."
disable-model-invocation: true
---

# Interrogate

Run TWO distinct, independently executed reviewer perspectives by default. Each reviewer gets the same prompt and rubric. Prefer distinct configured models so the adversarial signal comes from model diversity, not assigned personas.

The deliverable is a synthesized verdict. Do NOT auto-apply changes. After presenting it, wait for explicit user approval before any fix work.

## Step 1, Determine Scope

Identify what to review from context:

- If the user points at specific files or a diff, use that
- If on a feature branch, run `git diff main...HEAD` (or the appropriate base branch) for the full changeset
- If the user's message references recent work, gather the relevant files

Package the diff (or file contents) plus any surrounding context files the reviewers need to understand the code.

## Step 2, State the Intent

Before spawning reviewers, state the intent explicitly. Derive this from:

- The user's message
- Commit messages
- PR description if one exists
- The code itself

Write one clear paragraph. If you're unsure about the intent, ask the user before proceeding.

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

Read `references/reviewer-prompt.md` and fill in the template with:
1. The stated intent
2. The diff or file contents
3. The review rubric from `references/rubric.md`
4. The code-quality lens from `references/code-quality-review.md`

The same filled template goes to all reviewers, so every model applies the code-quality lens.

## Step 4, Synthesize

As results come back, build a unified picture:

1. **Parse all findings** from the reviewers
2. **Identify consensus**. Findings raised by 2+ models independently are highest signal.
3. **Identify lone-model findings**. Still worth reading, but weight accordingly.
4. **Deduplicate**. Different models may describe the same issue differently. Merge these and note which models raised it.
5. **Note disagreements**. If one model flags something and another explicitly says the opposite, that's useful context for the verdict.

## Step 5, Lead Judgment

You are the lead reviewer, a pragmatic senior engineer, not a neutral aggregator.

Read `references/lead-judgment.md` for the full framework.

Categorize every finding using these buckets:

- **Act on**. Real issues affecting correctness, security, or maintainability given the actual goals. These would block a real PR.
- **Consider**. Legitimate points, but you're not sure they outweigh the cost of addressing them right now. Worth the user's attention.
- **Noted**. Technically valid but not actionable. Context-dependent, premature optimization, or low-impact given the current stage.
- **Dismissed**. Wrong, nitpicky, or missing context. Brief explanation why.

For each finding, include:
- Which model(s) raised it
- The category (act on / consider / noted / dismissed)
- A one-line rationale for the categorization

## Output Format

Present the verdict in this structure:

### Intent
> [The stated intent paragraph from Step 2]

### Reviewers
- Reviewer [label]: [model name], [N findings] (one bullet per reviewer)

### Act On
[Findings that should be addressed. For each: description, which models raised it, why it matters.]

### Consider
[Findings worth thinking about. For each: description, which models raised it, tradeoff involved.]

### Noted
[Valid but low-priority. Brief list.]

### Dismissed
[Rejected findings with brief rationale.]

### Agreement Map
[Where did models agree, where did they diverge, and what does the pattern of agreement/disagreement tell us?]
