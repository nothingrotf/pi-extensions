### Opening a PR

Invoked at the end of every other playbook.

**Worktree.** Follow [Task contracts](../references/task-contracts.md). Repository writers use managed isolation and return patches for acceptance. Publication uses a separately scoped foreground Task in the destination worktree after acceptance and verification. Never publish synthetic snapshot history or reset unrelated work. If the destination contains unrelated changes, create a clean destination worktree without deleting the original.

**Commits.** Commit liberally. Rebase into small, ordered commits before opening PRs. Each commit is a future PR: landable, ordered to tell the story. Amend when the fix belongs in a just-made commit. New commit when separable.

**PRs.** Run `/deslop` over the diff before commit. Run `/no-comments` before review. Write every PR title, PR description, and commit body with `/technical-writing`, then apply `/unslop`. Apply every technical-writing layer except Diátaxis. Use one word for each action, keep articles, and avoid `-ing` when a plain verb works.

**Titles.** Use Conventional Commits in the form `type(scope): subject`. Use `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, or `perf` as the type. Use the changed area, such as `pstack` or `poteto-mode`, as the scope. Keep the subject short and imperative. Name a real symbol when one carries the change. For example, `fix(pstack): retarget opening-a-pr babysit trigger`. Do not add a trailing period.

**Descriptions.** The PR body is a briefing, not the lab notebook. A reviewer who has the diff should learn why the change exists, what is out of scope, and how you proved the change works. The squash commit body is the PR body. If the body would make the squash commit longer than about 40 lines, cut the body.

Use these sections in order. Drop a section when it has nothing to say.

- `## Why`. State the intent and approach in one or two short paragraphs. Do not list SHAs or rebase genealogy. Do not add a "based on main" preamble.
- `## Scope`. Use bullets to list real symbols and paths. Name both sides of a rename or retarget. State what is in and out only when the boundary matters. Do not write a file-by-file essay.
- `## Tradeoffs`. Name only rejected alternatives that a reviewer would otherwise ask about. Skip this section when there was no real choice.
- `## Blast Radius`. In one to three sentences, name who or what the change touches and why the change is safe or risky. State the continuing cost if main stays red without the fix.
- `## Verification`. Name each real run path and its outcome. For a performance change, report one primary number with its unit in `before → after` form. Link the arena or swarm directory for the remaining evidence. Do not include sample-size methodology, swarm recitals, or metric tables.

After these sections, attach videos or screenshots when they prove a claim. Do not paste full SHAs, swarm or arena lane recitals, lever-correction essays, file-by-file checklists, or "CLEAN" verdicts. Put these details in a linked artifact. Use native `gh --attach` for local proof assets. Repeat `--attach` for each file, with a maximum of 50 files. Use `<file>#<alt text>` for image alt text, and quote the argument. Put a local Markdown reference in the body when placement matters. `gh` replaces that reference with the uploaded asset. It appends an asset that the body does not reference.

Use `gh pr create --attach <file>` for a new independent PR. Use `gh pr edit <number> --attach <file>` for an existing or stacked PR. Use `gh pr comment <number> --attach <file>` for later evidence. `gh stack submit` does not accept `--attach`, so attach assets after submission. Do not use `--attach` with `--web` or `--dry-run` during creation.

An upload can fail after a partial success. `gh` preserves successful uploads, prints a recoverable URL, and exits with a nonzero status. Inspect the PR before a retry so that the retry does not duplicate assets.

Do not use `## Summary` or `## Test plan` boilerplate. A commit body does not restate its subject.

**Size and stacks.** Prefer five narrow PRs to one large PR. Stack follow-ups through `../references/stack-backends.md`, and keep the ordered stack visible to reviewers. Branch from main only for independent work. Rebase on `main` before substantial stack work.

**Readiness.** Open every PR ready, never as a draft. Set `draft: false` on API or tool calls. Omit `--draft` from `gh pr create`. If a PR still opens as a draft, run `gh pr ready <number>`. Run `gh pr view <number>` before you refer to PR status.

**Babysit.** Opening a PR does not start a babysit. Post the URL and keep building. Finish the phase or stack first. Run a separate babysit pass only when the user asks for one after the whole stack exists. A babysit for each new PR stalls the build and spends checks on commits that later waves restart. Push back when feedback drifts from intent.

Preparation and publication Tasks pass `role: "judgment and prose"`. Publication uses `capability_profile: "pstack-leaf"`. A preparation owner needs `capability_profile: "pstack-nested"` to run `interrogate`, `/deslop`, and `/no-comments`. Publication itself receives only the accepted artifact and destination scope. Its foreground Task returns the URL immediately. A wider Autopilot owner continues its explicitly assigned lifecycle through the root coordinator, not inside the publication Task.
