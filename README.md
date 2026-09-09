# @nothingrotf Pi extensions

This repository contains independently published extensions for [Pi](https://github.com/earendil-works/pi).
Bun manages one lockfile and every workspace under `packages/*`.

## Repository layout

```text
packages/
└── <extension>/
    ├── src/
    ├── test/
    ├── LICENSE
    ├── README.md
    ├── package.json
    └── tsconfig.json
```

Each extension owns its source, tests, documentation, and npm metadata.
The root owns shared dependency versions, checks, formatting, and Git hooks.

## Packages

| Package                                                    | Purpose                                                                           |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [`@nothingrotf/ask`](packages/ask)                         | Interactive question forms with selectable and freeform answers                   |
| [`@nothingrotf/compact`](packages/compact)                 | Structured compaction with optional semantic enrichment and history recall        |
| [`@nothingrotf/fast-mode`](packages/fast-mode)             | Catalog-aware Fast Mode for OpenAI Codex sessions and subagents                   |
| [`@nothingrotf/goal`](packages/goal)                       | Durable autonomous goal lifecycle for Pi sessions                                 |
| [`@nothingrotf/hud`](packages/hud)                         | Compact one-line footer with workspace, Git, model, quota, goal, and context data |
| [`@nothingrotf/loop`](packages/loop)                       | Session loop for recurring and self-paced prompts or skills                       |
| [`@nothingrotf/pstack`](packages/pstack)                   | Workflow skills and Pi compatibility helpers                                      |
| [`@nothingrotf/session-history`](packages/session-history) | Scoped search, audit views, timelines, and tool evidence from Pi sessions         |
| [`@nothingrotf/subagent`](packages/subagent)               | In-process Task runtime with isolated, persistent Pi child sessions               |
| [`@nothingrotf/tgrep`](packages/tgrep)                     | Microsoft tgrep search with fresh and opt-in indexed modes                        |
| [`@nothingrotf/todo`](packages/todo)                       | Structured todo lifecycle with session state and a persistent tree                |

## Content search

The `tgrep` package replaces Pi's native `grep` tool with Microsoft tgrep.
Install the executable separately with `brew install tgrep` before using the full stack.
Fresh searches include nonignored hidden files and do not require an index or server.
Use `pi --tgrep-indexed` to opt into indexes, which can omit hidden files and recent changes.
The HUD leaves `grep` registration to the search provider and displays its calls through the fallback action rail.

Read the [package documentation](packages/tgrep/README.md) for setup, limits, and compatibility.

## Workflow skills

The `pstack` package provides 50 skills with Pi-specific tools, Task contracts, and model policies.
The latest upstream sync requires evidence or uncertainty labels alongside claims and checks performed by the agent when possible.
Read the [synchronization notes](packages/pstack/README.md#upstream-synchronization) for source revisions.

## Structured compaction

The `compact` package replaces the default `/compact` summarizer and handles automatic threshold and overflow compaction.
Deterministic mode preserves source-linked evidence without model calls.
Optional hybrid mode adds validated semantic interpretations through the active model.

Run `/compact-mode` to open the native settings picker, or use `/compact-mode deterministic` and `/compact-mode hybrid` directly.
Mode changes persist on the active session branch.
The `compact_recall` tool retrieves omitted source evidence.

Use only one default compaction provider.
If pi-vcc remains installed, disable its `overrideDefaultCompaction` setting.

Read the [package documentation](packages/compact/README.md) for configuration and the [evaluation report](packages/compact/evaluation/README.md) for measured tradeoffs.
The initial synthetic comparison found no accuracy gain from hybrid mode, so deterministic mode remains the default.

## Development

Install Bun 1.4 or later.

```sh
bun install
bun run check
bun run test
```

Use `bun run fix` to apply safe lint and format fixes.
Use `bun run format` to format every supported file.

## Run the full stack locally

Create an isolated Pi profile that loads every workspace package from source:

```sh
bun run pi:profile
PI_CODING_AGENT_DIR=$PWD/.pi-local/agent pi
```

The profile lives in `.pi-local/agent`. It links `auth.json`, `models.json`, `themes`, and `trust.json` from `~/.pi/agent`. It copies the global settings and replaces `packages` with the workspace packages.

The profile does not touch the global Pi settings. Delete `.pi-local` to remove it.

Add the workspace packages to the global Pi settings instead:

```sh
bun run pi:install
```

Remove them again:

```sh
bun run pi:remove
```

The `subagent` package registers `Task` and `TaskControl`. The `pstack` package provides 50 skills. Remove `npm:pi-subagents` and `git:github.com/nothingrotf/oh-my-pstack` from the global settings before `pi:install`. Otherwise both stacks load at the same time.

Vite+ provides Oxfmt, Oxlint, TypeScript checks, tests, workspace tasks, and staged-file checks.
The local Oxlint plugins reject unsafe type shortcuts, module mocks, invalid suppressions, and stale tool directives.

## Add a package

Create one direct child under `packages/`.
Follow [`docs/package-conventions.md`](docs/package-conventions.md) for the package manifest and TypeScript configuration.

## Commits

Use Conventional Commits.
The `commit-msg` hook runs Commitlint.
The `pre-commit` hook checks staged files with Vite+.

## License

[MIT](LICENSE)
