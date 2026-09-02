### Shipping

**You own what lands. Verify each PR independently, land only the verified run from the root, then leave the queue unchanged.** For "land the stack", "ship it", "enable merge when ready", or the second half of a stack that **Babysit** already drove to green.

This playbook follows `playbooks/babysit.md`. Babysit makes a stack mergeable. Shipping decides what is safe through the selected stack backend. Select and verify that backend through `../references/stack-backends.md` before any stack mutation.

1. **Verify every PR independently before any landing operation.** Use one independent `Task` verifier per PR. Use read-only mode for static checks. A live `control-ui` or `control-cli` verifier runs as mutable background work with managed isolation. Point its `cwd` at a worktree for the exact head. Never join its incidental patch. Exercise the real surface against the parent and head. Each verifier returns `PASS`, `PASS+NOTES`, or `FAIL`. Post that verdict on its own PR. Safe means that an agent that did not write the code produced a passing verdict. CI green and bot approval are not verdicts.
2. **Find the contiguous verified run from the bottom.** Walk upward from the lowest unmerged PR. Stop at the first PR without `PASS` or `PASS+NOTES`. A verified PR above an unverified PR is not landable. Report the verified ceiling and the gap.
3. **Confirm that each verdict still describes its patch.** Record the verdict base SHA, head SHA, and stable patch-id. Calculate the patch-id from that PR's base-to-head diff.
   ```bash
   git diff --binary <base-sha>..<head-sha> | git patch-id --stable
   ```
   Before landing, calculate the current base-to-head patch-id. Re-verify the PR when that patch changed. If it did not change, keep the code verdict and re-run mergeability and CI at the current head. Re-run the live regression lane when base drift affects load-bearing behavior. Never substitute matching commit messages or checks from an older SHA.
4. **Arm only the verified prefix with Graphite.** Visit each branch from the root through the verified ceiling. Confirm its PR and branch through Graphite. Run this command once on each verified branch.
   ```bash
   gt submit --merge-when-ready --always --update-only --no-stack --no-interactive
   ```
   Do not arm a branch above the ceiling. The `--no-stack` flag prevents one invocation from submitting the unverified suffix.
5. **Merge only a fully verified GitHub stack.** GitHub stack merge operates on the complete initialized stack. If the verified ceiling is below the top, stop without a merge. From the stacker's initialized worktree, choose the repository's required merge method.
   ```bash
   gh stack merge --yes --squash
   ```
   GitHub stack merge requests an atomic full-stack merge or enters the repository merge queue.
6. **Never enable per-PR GitHub auto-merge on a stack.** Only the root targets protected trunk. Each child targets its parent branch. Per-PR auto-merge can collapse the stack into itself. Disable prior auto-merge with `gh pr merge <n> --disable-auto`. Then verify that the field is off.
7. **Verify the landing state through the selected backend.** For Graphite, confirm Merge When Ready on each verified prefix PR. Do not treat GitHub `autoMergeRequest` as Graphite proof. For GitHub, inspect `gh stack view --json` and the merge queue. If the backend cannot report state, report that fact. Do not infer success.
8. **Leave the stack unchanged after landing starts.** Do not synchronize, rebase, submit, or push the selected stack. These operations can rewrite heads or retarget bases. Re-parent independent work onto trunk and ship it separately.
9. **Watch the exact landing set.** Capture the armed PR numbers from bottom to top. Run the bundled watcher with that frozen list.
   ```bash
   scripts/watch-pr/watch-pr --queued-stack --stack-prs <bottom-to-top-prs>
   ```
   Hold the watcher under the installed `loop` skill. `WAITING` and `ADVANCE` are progress, not completion. `BLOCKER` requires diagnosis before a new landing mutation. Stop the watch only at `COMPLETE`, an explicit operator stop, or a diagnosed blocker. Report each merge and the new frontier.
10. **Stop at the ceiling.** Report the landed PRs and the next unverified PR. State what the next verification requires. A larger verified run requires a new pass through step 1.

**Reply:** the verified run and ceiling, each verdict and verifier, the selected backend, the armed operation, the observed landing state, and the next gap.
