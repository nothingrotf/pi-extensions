# Repository tooling

## Vite+

Vite+ owns repository checks and workspace tasks.
The root `vite.config.ts` defines format, lint, test, staged-file, and cache settings.

Use these commands:

```sh
bun run check
bun run lint
bun run test
bun run fix
bun run format
```

`bun run check` verifies formatting, type-aware lint rules, and TypeScript types.

## Git hooks

`bun install` runs `vp config --no-agent` and configures `.vite-hooks/`.
The pre-commit hook checks staged files.
The commit message hook enforces Conventional Commits.

Verify the hook path:

```sh
git config --get core.hooksPath
```

## Dependencies

Bun owns the root lockfile.
Do not commit package-level lockfiles.
Use the root catalog for shared Pi packages.
Keep the catalog at the minimum supported Pi version, which the root `README.md` names.
Pi loads extensions with its installed packages, so checks against another version do not represent users.

Use exact versions for Vite+, Oxlint, and the Oxlint plugin API.
Update the Vite override with the Vite+ version.

## Delivery benchmark

`bun run bench:delivery` compares two managed delivery flows on the same task with the real `pi` CLI.
It uses your Pi login, settings, and pstack model policy, so each run costs real model usage.

- `baseline` uses the earlier flow: isolated writer copies, a fresh owner for the correction, and a verifier with manual isolation.
- `workspace` uses the issue workspace: one prepared worktree, a resumed owner, and an in-place verifier.

Each run creates a fresh repository from `tools/delivery-bench/fixture.ts`.
The fixture tests need a catalog database that `bun run setup` builds in `--setup-seconds`, which stands in for migrations, seeding, or containers.
The coordinator follows a fixed script with one forced correction round, then dispatches static review and runtime verification together.
After each run, a hidden acceptance test checks the final tree.

```sh
bun run bench:delivery --runs 3
bun run bench:delivery --arms workspace --setup-seconds 60 --out /tmp/bench
```

`--task <id>` replays a real fix from this repository instead of the fixture.
Each replay clones the repository at the parent of the fix commit and gives the coordinator the issue text and criteria.
The coordinator follows the `next` field of each checkpoint without forced rounds, and stops after four implementation submissions.
After the run, the fix commit's test files replace the candidate's versions, and the replay's acceptance command must pass.
`tools/delivery-bench/replays.ts` defines the replay tasks.

`--owner name=selector` adds an implementation owner variant, and the option can repeat.
Each variant copies your model policy, sets the owner roles to the selector, and points `PSTACK_MODEL_POLICY` at the copy.
The coordinator and both reviewers keep the same models in every variant.
`--reviewer name=selector` adds a code review variant the same way. Each variant sets the `code review` role and the static reviewer model to the selector.

```sh
bun run bench:delivery --task diagnosis-owner --runs 2 --owner sol="openai-codex/gpt-6.1-sol:high [fast]" --owner opus=anthropic/claude-opus-5-5:medium
```

`--revision name=rev` adds a variant that runs pi with the packages of another pi-extensions revision, and the option can repeat.
Each variant checks out `rev` in a worktree under the output directory and runs `bun install` there.
The variant then points `PI_CODING_AGENT_DIR` at a copy of your agent directory whose packages resolve into that worktree.
The copy links your other agent files, including logins, and the benchmark removes the copies and worktrees at the end.

```sh
bun run bench:delivery --task workspace-setup --runs 3 --revision base=main --revision candidate=HEAD
```

Replay tasks accept `--arms workspace,engine`. The `workspace` arm has the coordinator follow each `next` field by hand.
The `engine` arm has the coordinator call `pstack_deliver` once with the same brief, criteria, and review models.
The engine stops after nine dispatches, which covers four owner rounds, their reviews, and one diagnosis.

The output directory keeps each run's repository, sessions, prompt, `pi.log`, and `metrics.json`.
`report.md` lists every run and the median of each arm, with execution time split by owner, static review, and runtime verification.
It also counts `pstack_gate` calls, reused gate passes, and `bash` or gate commands that ran for 45 seconds or more.
Run at least three runs per arm before you draw a conclusion, because model latency varies between runs.

## Editor support

The `.zed/settings.json` file configures Oxfmt and Oxlint.
Oxfmt formats supported files when Zed saves them.
Oxlint runs type-aware checks and safe fixes.
