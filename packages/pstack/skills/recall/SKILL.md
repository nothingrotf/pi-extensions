---
name: recall
description: "Reconstruct your recent working context from your own chat history, live state, and the shared record (user reports, prior fixes, incidents), then hand back a tight current-state brief. Use for 'recall my work on X', 'catch me up', 'what have I been working on', 'where did I leave off', before starting or resuming work."
disable-model-invocation: true
---

# Recall

**Before you start or resume work, rebuild the user's recent working context. Return a tight capsule of the current state and next action.**

Keep it tight and on-topic. Read only what the in-scope threads need, then stop. The heavy review can fan out to parallel read-only subagents. The main thread keeps only findings and the final brief.

Context lives in two records. Project-scoped Pi session history holds prior work and decisions. The shared record holds related reports, fixes, incidents, and current errors. The **why** skill searches the shared record through parent-owned source tools.

1. Classify, then route. One specific prior chat to resume belongs to the `session-pickup` playbook. Turning habits into a durable skill belongs to `automate-me`. Recall loads context across recent sessions. If the user supplied a complete state capsule, use it and skip the mining.
2. Lock the scope before searching. Pin the time window, topic, and workspace. The default window is seven days. The default workspace is the active project. State the scope. Never turn "all" into a recent subset.
3. Search project sessions. Use `session_history` `list` and `search`. Keep the current session and child sessions excluded. Order sessions by returned modification time, not by identifier. Search the topic first. Use bounded `read` calls with `view: "audit"` only for relevant regions. Use `timeline` for flow and `tool_activity` for command evidence. Preserve each `pi-session://` reference. If `session_history` is unavailable, return `BLOCKED`.
4. Fan out only when the result set is large. The parent prepares bounded evidence slices. Spawn parallel `Task` children with `subagent_type: "generalPurpose"` and `readonly: true`. Children analyze supplied evidence only. They do not receive physical session paths or ambient source tools. Each returns one block per session: topic, user goal, decisions, open threads, struggles, corrections, and artifacts. Require stable session references. For one or two sessions, analyze directly.
5. Sweep the shared record whenever the topic names a feature, file, subsystem, area, or bug. Use the **why** skill with this question: "What is the current state, what failed before, and what do users still report?" Run this sweep in parallel with session review. Preserve its source gaps and citations. Skip it only for pure activity recall without a named target.
6. Verify against live state. History is not current truth. Check surfaced pull requests, branches, and tickets with available parent tools such as `git`, `gh`, and issue tools. Use recorded `tool_activity` results when the answer depends on prior execution. Do not treat an assistant statement as proof.
7. Write the brief to the contract below. Group by thread. Stay on the named topic.

## Output contract

Lead with the capsule, then thread status, problems, and the next move.

- **Capsule.** Use at most five bullets. State what the work is and where it stands.
- **Threads.** Prefix each line with `[merged #N]`, `[open PR #N]`, `[in flight <branch>]`, `[verified, uncommitted]`, `[reverted #N]`, or `[planned, not started]`.
- **Problems.** Use at most five recurring problems. Include recurring symptoms and reverted fixes.
- **Next move.** State the single most useful concrete action.

Exclude adjacent work unless it blocks the named topic. Cut detail before you cut threads. Apply the **unslop** skill. Cite session findings with `pi-session://` references. Cite shared-record findings with their source identifiers. Sanitize private context before public output.

**Reply:** the brief, to the contract above.
