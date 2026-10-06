### Opening a PR

Invoked at the end of every other playbook.

**Worktree.** Follow [Task contracts](../references/task-contracts.md). Repository writers use managed isolation and return patches for acceptance. Publication uses a separately scoped foreground Task in the destination worktree after acceptance and verification. Never publish synthetic snapshot history or reset unrelated work. If the destination contains unrelated changes, create a clean destination worktree without deleting the original. Release each destination worktree after publication, per Local footprint in [Delivery operations](../references/delivery-operations.md).

**Commits.** Commit liberally. Rebase into small, ordered commits before opening PRs. Each commit is a future PR: landable, ordered to tell the story. Amend when the fix belongs in a just-made commit. New commit when separable.

**PRs.** Run `/deslop` over the diff before commit. Run `/no-comments` before review. Write every PR title, PR description, and commit body with `/technical-writing`, then apply `/unslop`. Apply every technical-writing layer except Diátaxis. Use one word for each action, keep articles, and avoid `-ing` when a plain verb works.

**Titles.** Use Conventional Commits in the form `type(scope): subject`. Use `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, or `perf` as the type. Use the changed area, such as `pstack` or `poteto-mode`, as the scope. Keep the subject short and imperative. Name a real symbol when one carries the change. For example, `fix(pstack): retarget opening-a-pr babysit trigger`. Do not add a trailing period.

**Descriptions.** Load the bundled `pr` skill from `../pr/SKILL.md` before you write or update a PR body. Follow its workflow, template, evidence rules, and screenshot reference for every PR body and PR media attachment. The `pr` skill owns the body structure. Do not add a separate pstack body template.

Do not paste full SHAs, swarm or arena lane recitals, lever-correction essays, file-by-file checklists, or "CLEAN" verdicts. Put these details in a linked artifact. Use native `gh --attach` for local proof assets. Repeat `--attach` for each file, with a maximum of 50 files. Use `<file>#<alt text>` for image alt text, and quote the argument. Put a local Markdown reference in the body when placement matters. `gh` replaces that reference with the uploaded asset. It appends an asset that the body does not reference.

Use `gh pr create --attach <file>` for a new independent PR. Use `gh pr edit <number> --attach <file>` for an existing or stacked PR. Use `gh pr comment <number> --attach <file>` for later evidence. `gh stack submit` does not accept `--attach`, so attach assets after submission. Do not use `--attach` with `--web` or `--dry-run` during creation.

An upload can fail after a partial success. `gh` preserves successful uploads, prints a recoverable URL, and exits with a nonzero status. Inspect the PR before a retry so that the retry does not duplicate assets.

A commit body does not restate its subject.

**Size and stacks.** Prefer five narrow PRs to one large PR. Stack follow-ups through `../references/stack-backends.md`, and keep the ordered stack visible to reviewers. In Autopilot-stack, open each layer as its own draft PR at its first WIP snapshot, and mark it ready when it is accepted. Never accumulate layers locally for a later split. Branch from main only for independent work. Rebase on `main` before substantial stack work.

**Readiness.** Open every PR ready, never as a draft. Autopilot-stack layer PRs are the one exception. They open as drafts at the first WIP snapshot, and publication marks each one ready after independent acceptance. Set `draft: false` on API or tool calls. Omit `--draft` from `gh pr create`. If a PR still opens as a draft, run `gh pr ready <number>`. Run `gh pr view <number>` before you refer to PR status.

**Babysit.** Opening a PR alone does not authorize babysit.
For ordinary publication, return the URL and continue the build until a separate user request starts babysit.
In Autopilot-full or Autopilot-stack, an explicit lifecycle assignment authorizes the root to start babysit after publication returns the PR URL.
Follow `playbooks/babysit.md` for the active frontier and watcher ownership.
Do not wait for unrelated PRs or the whole stack when that assignment already authorizes the loop.
The root owns this lifecycle, not the publication Task.
Push back when feedback drifts from intent.

Publication Tasks pass `role: "publication"`, `capability_profile: "pstack-leaf"`, and `run_in_background: false`. Their prompt requires the `pr` skill for the PR body. Draft commit and PR text within this same destination-scoped Task. Do not create a separate preparation owner or worktree for prose alone. Reuse the independent reviewer's complete verdict, including `/deslop` and `/no-comments` findings. Apply their checklists inline without child delegation. Run `interrogate` only for unresolved contested design or an explicit review gate, not for every publication.

Publication receives only the accepted artifact and destination scope. Its prompt carries the issue, phase `publication`, accepted design and evidence refs, base and head identity, and verification owner. Follow the [Delivery contract](../references/delivery-contract.md). Publication never merges, deploys, or pushes synthetic snapshot history. Its foreground Task returns the URL immediately. A wider Autopilot owner continues its explicitly assigned lifecycle through the root coordinator, not inside the publication Task.
