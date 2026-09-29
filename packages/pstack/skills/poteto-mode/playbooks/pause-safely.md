### Pause safely

**You own a clean stop. Leave a checkpoint a cold-start agent can resume from.** For "pause safely", "I need to go offline", "restart Pi", or "board my flight", and when context is about to compact or summarize. This is explicit only. On "keep going", "going to bed, keep going", or "don't stop", do not pause. Those mean continue, and Autonomous run already checkpoints per iteration.

1. Stop at an atomic boundary without expanding the work to repair an incomplete state. Cancel isolated writers before snapshotting. Start nothing new, and cancel any nested subagents.
2. Take no irreversible action to pause. No PR and no push unless you already had one out.
3. Make the work durable. Run the required precommit checks before considering a commit. If repository rules permit a WIP commit and required checks pass without bypass, commit only task edits with `wip:`. Otherwise, retain a patch and untracked task files in a durable checkpoint directory. Record any broken state, failed checks, and the first repair step. A broken WIP checkpoint is not acceptance.
4. Write the resume note off-context. Capture intent, what you were doing, progress and what's verified, current state, next steps, key files, and gotchas. For the compaction trigger write it to a file like `/tmp/<slug>-resume.md`. If a show-me-your-work trail exists, point at it instead of duplicating it.

**Reply:** where you are in the loop, what's on disk versus still in your head (paths, no diff dumps), the commits you made and whether the tree is clean, and the first action on resume. This is a pause, not a final report.
