---
name: principle-guard-the-context-window
description: "Apply when context fills with large outputs, long files, repeated reads, or fan-out plans. Keep bounded evidence and recoverable sources. Delegate only useful independent slices."
disable-model-invocation: true
---

# Guard the Context Window

The context window is finite. Compaction reduces context but can discard evidence, so retain recoverable sources.

**Why:** Context overflow degrades reasoning quality, creates compression artifacts, and halts progress.

**Pattern:**
- **Bound large payloads.** Keep raw logs and documents in durable artifacts with references. Load decisive passages instead of complete dumps.
- **Preserve evidence.** Summaries locate sources but never replace original observations, rejected hypotheses, or acceptance criteria.
- **Keep one owner.** Investigation and implementation share an owner. Delegate only a justified independent slice or required perspective.
- **Read selectively.** Load relevant skills and sources. Reuse unchanged documents already read when policy permits, preserving explicit rereading requirements.
- **Separate worker guidance.** Keep essential constraints in the worker contract and load the assigned workflow without unrelated coordinator instructions.
- **Size phases and cap scope.** Limit files per phase, set turn budgets, account for mechanism costs.
