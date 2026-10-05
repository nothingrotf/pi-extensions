### Opening a PR

Invoked at the end of every other playbook.

**Worktree.** Follow [Task contracts](../references/task-contracts.md). Repository writers use managed isolation and return patches for acceptance. Publication uses a separately scoped foreground Task in the destination worktree after acceptance and verification. Never publish synthetic snapshot history or reset unrelated work. If the destination contains unrelated changes, create a clean destination worktree without deleting the original.

**Commits.** Commit liberally. Rebase into small, ordered commits before opening PRs. Each commit is a future PR: landable, ordered to tell the story. Amend when the fix belongs in a just-made commit. New commit when separable.

**PRs.** Run `/deslop` over the diff before commit. Run `/no-comments` before review. Write every PR title, PR description, and commit body with `/technical-writing`, then apply `/unslop`. Apply every technical-writing layer except Diátaxis. Use one word for each action, keep articles, and avoid `-ing` when a plain verb works.

**Titles.** Use Conventional Commits in the form `type(scope): subject`. Use `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, or `perf` as the type. Use the changed area, such as `pstack` or `poteto-mode`, as the scope. Keep the subject short and imperative. Name a real symbol when one carries the change. For example, `fix(pstack): retarget opening-a-pr babysit trigger`. Do not add a trailing period.

**Descriptions.** The PR body is a briefing, not the lab notebook. A reviewer who has the diff should learn why the change exists, what it leaves out, what it could break, and how you proved it works, in under a minute. Write short, simple sentences with few identifiers. Do not write walls of text. The squash commit body is the PR body. If the body would make the squash commit longer than about 40 lines, cut the body.

Put each section under a `##` heading, not a bold lead-in, so the sections stand apart. Use these sections in order. Drop a section when it has nothing to say.

- `## Why` gives the problem and the approach in one to three short sentences. Do not list SHAs or rebase genealogy. Do not add a "based on main" preamble.
- `## What changed` has one to three short bullets. Name a real symbol or path only when it carries the change. Name both sides of a rename or retarget.
- `## Scope` always names what the PR covers and what it deliberately leaves out, for example a related follow-up or a known gap. Use one to three short items. Do not list symbols or paths, and do not write a file-by-file essay.
- `## Tradeoffs` names only rejected alternatives that a reviewer would otherwise ask about. Skip this section when there was no real choice.
- `## Blast Radius` gives one or two sentences on who or what the change touches and why that is safe or risky. If main is red, state the cost of leaving it red.
- `## Verification` has one to three bullets. Each bullet names a real run path and its outcome. For a performance change, report one primary number with its unit in `before → after` form. Link the arena or swarm directory for the remaining evidence. Do not include sample-size methodology, swarm recitals, or metric tables.

After these sections, attach videos or screenshots when they prove a claim. Do not paste full SHAs, swarm or arena lane recitals, lever-correction essays, file-by-file checklists, or "CLEAN" verdicts. Put these details in a linked artifact. Use native `gh --attach` for local proof assets. Repeat `--attach` for each file, with a maximum of 50 files. Use `<file>#<alt text>` for image alt text, and quote the argument. Put a local Markdown reference in the body when placement matters. `gh` replaces that reference with the uploaded asset. It appends an asset that the body does not reference.

Use `gh pr create --attach <file>` for a new independent PR. Use `gh pr edit <number> --attach <file>` for an existing or stacked PR. Use `gh pr comment <number> --attach <file>` for later evidence. `gh stack submit` does not accept `--attach`, so attach assets after submission. Do not use `--attach` with `--web` or `--dry-run` during creation.

An upload can fail after a partial success. `gh` preserves successful uploads, prints a recoverable URL, and exits with a nonzero status. Inspect the PR before a retry so that the retry does not duplicate assets.

A commit body does not restate its subject.

**Size and stacks.** Prefer five narrow PRs to one large PR. Stack follow-ups through `../references/stack-backends.md`, and keep the ordered stack visible to reviewers. Branch from main only for independent work. Rebase on `main` before substantial stack work.

**Readiness.** Open every PR ready, never as a draft. Set `draft: false` on API or tool calls. Omit `--draft` from `gh pr create`. If a PR still opens as a draft, run `gh pr ready <number>`. Run `gh pr view <number>` before you refer to PR status.

**Babysit.** Opening a PR alone does not authorize babysit.
For ordinary publication, return the URL and continue the build until a separate user request starts babysit.
In Autopilot-full or Autopilot-stack, an explicit lifecycle assignment authorizes the root to start babysit after publication returns the PR URL.
Follow `playbooks/babysit.md` for the active frontier and watcher ownership.
Do not wait for unrelated PRs or the whole stack when that assignment already authorizes the loop.
The root owns this lifecycle, not the publication Task.
Push back when feedback drifts from intent.

Publication Tasks pass `role: "publication"`, `capability_profile: "pstack-leaf"`, and `run_in_background: false`. Draft commit and PR text within this same destination-scoped Task. Do not create a separate preparation owner or worktree for prose alone. Reuse the independent reviewer's complete verdict, including `/deslop` and `/no-comments` findings. Apply their checklists inline without child delegation. Run `interrogate` only for unresolved contested design or an explicit review gate, not for every publication.

Publication receives only the accepted artifact and destination scope. Its prompt carries the issue, phase `publication`, accepted design and evidence refs, base and head identity, and verification owner. Follow the [Delivery contract](../references/delivery-contract.md). Publication never merges, deploys, or pushes synthetic snapshot history. Its foreground Task returns the URL immediately. A wider Autopilot owner continues its explicitly assigned lifecycle through the root coordinator, not inside the publication Task.
