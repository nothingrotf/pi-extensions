### Shipping

**You own what lands. Verify each PR independently, land only the verified run from the root, then keep your hands off the queue.** For "land the stack", "ship it", "enable merge when ready", or the second half of a stack that **Babysit** already drove to green.

This is the half after `playbooks/babysit.md`. Babysit makes a stack mergeable. Shipping decides what is actually safe to merge through the selected stack backend. Green is not safe, and the gap between those two words is where this playbook lives. Select and verify the backend through `../references/stack-backends.md` before any stack mutation.

1. **Verify every PR independently before arming anything.** Use one independent `Task` verifier per PR. Use read-only mode for static checks. A live `control-ui` or `control-cli` verifier runs as mutable background work with managed isolation, because Pi read-only mode removes shell access. Point its `cwd` at a worktree for the exact head, and never join its incidental patch. Exercise the real surface against parent versus head. Each verifier returns `PASS`, `PASS+NOTES` or `FAIL` and posts that verdict on its own PR so the record outlives the chat. Safe means a verdict from an agent that did not write the code. CI green is not a verdict, and an approving bot review is not a verdict.
2. **Land only the contiguous verified run rooted at the bottom.** Walk up from the lowest unmerged PR and stop at the first one without a passing verdict, where both `PASS` and `PASS+NOTES` pass. A verified PR sitting above an unverified one is not landable, because merging it would pull the gap in underneath it. Report the ceiling as a PR number and say what breaks the chain.
3. **Re-check that the verdicts still describe the code.** A restack rewrites every SHA above it and silently invalidates every verdict without touching a single check. Compare `git patch-id` at the verdict SHA against the current head before trusting an older verdict, and re-verify anything that actually drifted. Twenty-one verdicts went stale this way in one run with no signal at all.
4. **Use the selected backend's landing operation.** For Graphite, arm merge-when-ready and pass `--always`. A no-op submit skips the Graphite update and silently arms nothing.
   ```bash
   gt submit --merge-when-ready --always --update-only --no-interactive
   ```
   For GitHub, require a passing verdict through the top PR. If the verified ceiling is below the top, stop without merging. From the stacker's initialized worktree, choose the repository's required merge method.
   ```bash
   gh stack merge --yes --squash
   ```
   GitHub stack merge is not Graphite Merge When Ready. It requests an atomic full-stack merge or enters the repository merge queue.
5. **Never enable per-PR GitHub auto-merge on a stack.** Only the root targets protected trunk. Every child targets its parent branch. Per-PR auto-merge can collapse the stack into itself. If a previous agent armed it, disarm with `gh pr merge <n> --disable-auto` and verify that the field is off.
6. **Verify backend state through its own surface.** For Graphite, do not read `autoMergeRequest` as proof that MWR is armed. Confirm arming from Graphite. For GitHub, inspect `gh stack view --json` and the merge queue. If verification is unavailable, report that fact and do not infer success.
7. **After landing starts, stop touching the stack.** Do not synchronize, rebase, submit, or push the selected stack. Each operation can rewrite heads or retarget bases. Independent work gets re-parented onto trunk and shipped on its own.
8. **Watch the landing operation, do not drive it.** Arm the watcher in queued mode over the verified run and hold it under the installed `loop` skill. Re-arm it after any verdict you act on until COMPLETE at the ceiling. ADVANCE is progress, not termination. Graphite can retarget bases and create `graphite-base/*` refs. A GitHub merge queue can land pull requests in separate groups. Report each merge and the new ceiling. If the queue stalls, diagnose before any mutation.
9. **Stop at the ceiling.** When the verified run is merged, report what landed, what the next unverified PR is, and what verifying it would take. Extending the run is a new pass through step 1, not a judgment call you make at 3am.

**Reply:** the verified run and its ceiling, each PR's verdict and who produced it, what you armed and how you confirmed it, what landed, and what the next gap needs.
