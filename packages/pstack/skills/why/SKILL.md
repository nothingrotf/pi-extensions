---
name: why
description: "Investigates design rationale, regressions, postmortems, and data-backed thresholds with cited evidence. Use for 'why does X work this way' or 'why we picked Y'. Use how for runtime behavior."
disable-model-invocation: true
---

# Why

Investigate motivation in the current session by default, including inside a leaf Task.
Keep the same issue owner from evidence collection through an authorized implementation.
Do not assign one agent per source category or create a separate synthesis Task by default.

Read [Epistemics](references/epistemics.md) before interpreting historical evidence.
Distinguish direct evidence, supported inference, speculation, and absence.

## 1. Anchor the question

State the target, relevant paths and symbols, and the decision that needs explanation.
Inspect recent source history and follow relevant commits, PRs, or tickets.
A code change establishes what changed, not why.
Preserve contrary evidence and rejected explanations instead of forcing a single narrative.

## 2. Select sources

Inspect available tool descriptors rather than guessed configuration files.
Use the matching guidance in [Source playbook](references/source-playbook.md) before querying a category.
For incident-related questions, also use [Incident and postmortem](references/sources/incident-postmortem.md).

Record these categories in a compact coverage map:

- Source control history.
- Issue or ticket tracker.
- Long-form documents.
- Real-time team chat.
- Infrastructure observability.
- Error tracking.
- Product analytics.

For each category, record consulted, unavailable, irrelevant with a reason, or not yet needed with a reason.
Start with sources most likely to answer the question. Expand when contradictions or missing decision evidence require it.
Preserve explicit user coverage requirements. An unsearched category is not a negative search result.
Record queries, bounded results, null results, and stable references for every consulted source.
Query independent sources in parallel through tools, without adding an interpretation agent for each tool.

The parent owns all source tools that its child cannot access.
A `Task` child does not inherit ambient extensions or generic MCP tools.
Use granted local tools and supplied evidence directly. Ask the actual coordinator for missing source queries when necessary.
An advisory intercom answer is not source evidence or authorization.

## 3. Delegate only justified evidence slices

Delegate a bounded slice only when its volume or independent question justifies another context.
State the reason before dispatch and keep synthesis with the current owner.
Honor explicitly requested independent perspectives and report capability blockers instead of silently removing them.

Before dispatch, read [Task contracts](../poteto-mode/references/task-contracts.md).
Use these settings for an investigator:

- `subagent_type`: `generalPurpose`
- `capability_profile`: `pstack-leaf`
- `role`: `why investigators`
- `readonly`: `true`

Omit `Task.model` for the scalar policy. Concrete selectors use `provider/model-id:effort [fast]` and must match the configured role.
Use [Investigator prompt](references/investigator-prompt.md) with the original question, code anchor, and bounded evidence bundle.
Resume the investigator only for necessary follow-up evidence. Check its citations through the original sources before accepting its findings.
The `why synthesizer` role remains available for explicitly delegated standalone synthesis, not an automatic handoff.
Use [Synthesizer prompt](references/synthesizer-prompt.md) for that explicit assignment.

## 4. Synthesize and preserve evidence

Write the answer yourself from the original evidence and any verified delegated findings.
Use these sections when relevant:

- The Question and The Code in Question.
- Direct Findings and Supported Inferences.
- Competing Hypotheses and Remaining Gaps.
- Sources Consulted and Confidence Summary.

For every claim, cite its source or label the inference and uncertainty.
State what each source actually establishes. Agreement between agents does not substitute for evidence.
Keep the coverage map, including unavailable and unsearched categories with their reasons.
Do not invent authors, dates, references, or a rationale from code style.

If implementation follows, retain a Preserve / Change / Avoid / Risk constraint set with source references.
Keep the original request, decisive observations, rejected hypotheses, reproduction, and open criteria with the issue.
A summary locates evidence. It does not replace evidence or authorize a code change.
