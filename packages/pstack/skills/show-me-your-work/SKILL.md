---
name: show-me-your-work
description: "Keep a reviewable decision trail for long-running or unattended work: a TSV log with one row per decision (what, why, evidence, result). Local by default; commit it when a reviewer needs the trail to trust the result. Use for /show-me-your-work, autonomous or multi-phase runs, or work a human reviews after stepping away."
disable-model-invocation: true
---

# Show me your work

Keep one canonical log.

## The format

A single TSV file, one row per decision. Cells stay single-line. Evidence is a pointer, not prose.

Copy `references/decision-log-template.tsv` (the header row) to start a clean log. Columns:

- **ts.** ISO8601 timestamp.
- **phase.** The phase or workstream.
- **decision.** What was chosen or done, one line.
- **why.** The reason in plain words. If a principle drove it, say it plainly, not as a jargon tag.
- **evidence.** A link or path that proves it: commit SHA, PR number, `file:line`, or an artifact, trace, or screenshot path. Never a paragraph.
- **result.** The outcome or predicate state: `tests green`, `reverted`, `pixel-diff 0`, `INCONCLUSIVE`, `open`.

An example, plain-spoken so a reviewer reads it at a glance. This is illustration only. Don't copy these rows into a real log.

```
ts	phase	decision	why	evidence	result
2026-05-24T09:02:00Z	frame	counted the work first, about 100 components and roughly 75 hours	wanted to know the size before starting a long run	commit 3a9f1c2	found 5 things to sort out before starting
2026-05-24T09:40:00Z	harness	took screenshots of the old version before changing anything	so we can compare old against new and catch any visual change	scripts/snapshot.sh, baseline/	saved 120 reference screenshots
2026-05-24T11:15:00Z	widget	moved the widget styles over without changing how it looks	keep the change small and the result identical	commit 7c21e0a, pixel-diff 0	looks identical, tests pass
2026-05-24T12:30:00Z	widget	threw out a helper's work because its screenshots were blank	checked the real files instead of trusting its summary	worktree reset	reverted, tightened the instructions for next time
```

## Logging a row

Write each entry the way you'd tell a teammate what you did. Plain words, concrete actions, no AI speak or abstract jargon (the **unslop** skill applies to log text too).

Use the helper `scripts/log.sh <logfile> <phase> <decision> <why> <evidence> <result>`. It stamps `ts`, writes the header on first use, strips stray tabs/newlines, and prefixes any cell starting with `=`, `+`, `-`, or `@` with a single quote. A bare `printf` appending a row works too, but mind those same bytes if cells come from generated or user-supplied text.

Log decision points and checkpoints, not every action: a fork chosen, a unit completed with its verification result, a pivot or revert with its trigger, a blocker surfaced, a gate fixed. For loop runs, one row per iteration. Skip the trivial and self-evident.

A run is one Pi session, including resumed turns and compaction.
A pickup in another session or a replacement agent starts a new run.
Before the first row, resolve this run's stable `pi-session://` reference through `session_history`.
Use `action: "list"` with `include_current: true` and select the entry with `isCurrent: true`.
If the tool is unavailable, use the recorded reference supplied by the parent.
If no reference exists, keep a separate log until the parent binds it to recorded session evidence.
Do not append to a shared log without that identity.
Begin each identified run with a row with phase `start`.
Write another `start` row when this run returns after another run's `start` row.
Before returning to a shared log, read its last rows.
The `start` row names the earlier timestamp range that this run did not write.
Its evidence identifies this run with its stable `pi-session://` reference.
Use phase `start` only for these run boundaries.
Give concurrent writers separate logs and serialize handoffs to a shared log.

## Where it lives

By default the log is a working artifact, not committed. Keep it at `decisions.tsv` in the work dir, or `.audit/<task-slug>.tsv` when several efforts run at once, and leave it out of git.

Commit it only when the work is ambitious enough that a reviewer needs the trail to trust the result.

## Rules

- One row is one decision or checkpoint.
- Append-only. A wrong call gets a new row that supersedes it. Never edit or delete history.
- Prefer evidence produced by committed scripts over hand-made one-offs (the **encode-lessons-in-structure** principle skill).

## Audit the log against the transcript

At the end of the run, before handoff, check that the log tells the truth. Use `session_history` to inspect the current Pi session. First call `list` with `include_current: true` and `include_children: true`. Select the result with `isCurrent: true`, and preserve its `pi-session://` reference. Call `timeline` and `tool_activity` for that session with `include_children: true`. When an entry needs context, call `read` with `view: "audit"`. Treat a recorded tool result as execution proof. Do not treat an assistant statement as execution proof. Audit only this run's rows against what actually happened.
Each stretch starts at this run's `start` row, or the first row when this run created the log.
It ends before another run's next `start` row.

- Check that every row maps to a real decision or action.
- Check that each evidence pointer resolves and proves the row's claim.
- Add missing forks, pivots, or abandoned approaches that shaped this run.

Never edit or remove a row during the audit, even an invented or padded row.
Append a correction that supersedes the wrong claim and describes what actually happened.
Identify the original row by line number and timestamp, and cite the recorded evidence for the correction.
Do not audit other runs' rows.
If this run's evidence disproves an earlier row, supersede it without rewriting that history.

## Cross-model review of the trail

Before handing back, spawn a subagent on another vendor's model than the one that did the work. Self-review is not a substitute. Use one read-only `Task` with `subagent_type: "generalPurpose"`, `role: "arena cross-judge pool"`, an explicit `model` from that pool, and `capability_profile: "pstack-leaf"`, per [Task contracts](../poteto-mode/references/task-contracts.md). The parent owns `session_history`, so pass the log path and the bounded timeline and tool activity with their stable references. The subagent reads that evidence, then flags what the user should pay attention to. Not a redo of the work, a scan for what's suboptimal or risky. Pick each subagent's reasoning level for the job, per the Subagents section of the **poteto-mode** skill. If no entry comes from another vendor, return `BLOCKED` and request a policy update.

- Decisions logged with weak or absent evidence.
- Verification steps skipped or claimed without proof in the transcript.
- Choices that look risky in hindsight (premature, scope-creeping, papering over a symptom).
- Gaps the user would otherwise miss on a casual skim.

Every reply for a run that produced a trail ends with an "Attention" section. Lead with the reviewer's model on its own line (`reviewed by <model>`), then list each flag pointing to specific rows or moments. "No flags" is a valid value. The model name is not.

## Reviewing the trail

Read top to bottom, follow the evidence pointers, spot-check. GitHub renders a committed TSV as a table. `column -s$'\t' -t decisions.tsv` renders it in a terminal.

## Composing this skill

Other skills route their audit trail here instead of inventing one. Reference it by name and let it own the format. Don't restate the columns.
