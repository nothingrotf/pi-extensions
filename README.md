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
| [`@nothingrotf/goal`](packages/goal)                       | Durable autonomous goal lifecycle for Pi sessions                                 |
| [`@nothingrotf/hud`](packages/hud)                         | Compact one-line footer with workspace, Git, model, quota, goal, and context data |
| [`@nothingrotf/loop`](packages/loop)                       | Session loop for recurring and self-paced prompts or skills                       |
| [`@nothingrotf/session-history`](packages/session-history) | Scoped search, audit views, timelines, and tool evidence from Pi sessions         |
| [`@nothingrotf/subagent`](packages/subagent)               | In-process Task runtime with isolated, persistent Pi child sessions               |
| [`@nothingrotf/todo`](packages/todo)                       | Structured todo lifecycle with session state and a persistent tree                |

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

The `subagent` package registers `Task` and `TaskControl`. The `pstack` package registers 48 skills. Remove `npm:pi-subagents` and `git:github.com/nothingrotf/oh-my-pstack` from the global settings before `pi:install`. Otherwise both stacks load at the same time.

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
