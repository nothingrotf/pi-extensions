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

The output directory keeps each run's repository, sessions, prompt, `pi.log`, and `metrics.json`.
`report.md` lists every run and the median of each arm.
Run at least three runs per arm before you draw a conclusion, because model latency varies between runs.

## Editor support

The `.zed/settings.json` file configures Oxfmt and Oxlint.
Oxfmt formats supported files when Zed saves them.
Oxlint runs type-aware checks and safe fixes.
