# Stack backends

Poteto supports Graphite and GitHub Stacked Pull Requests. Select one backend before a stack workflow changes repository state.

## Selection

Run these checks in order:

1. Read `POTETO_STACK_BACKEND` when it is set to `graphite` or `github`.
2. Use Graphite when `gt` exists and no backend is selected.
3. Use GitHub when `gh stack --version` succeeds and Graphite is absent.
4. If `gh stack --version` fails but `gh` exists, ask whether to install `github/gh-stack` with `AskQuestion`.
5. If the user approves, run `gh extension install github/gh-stack`.
6. Verify the installation with `gh stack --version`.
7. If the user declines, stop the stack workflow or offer ordinary independent pull requests.

Never install an extension without approval. Never change the selected backend after a stack mutation starts.

Set the backend for bundled commands:

```bash
export POTETO_STACK_BACKEND=graphite
```

or:

```bash
export POTETO_STACK_BACKEND=github
```

The `auto` default prefers Graphite when both backends exist.

## Prerequisites

Graphite requires an authenticated `gt` installation and an initialized repository.

GitHub requires:

- An authenticated GitHub CLI.
- The `github/gh-stack` extension.
- GitHub Stacked Pull Requests enabled for the repository.
- `git config rerere.enabled true`.
- A configured `remote.pushDefault` when the repository has multiple remotes.

If `gh stack` exits with code 9, the repository does not support GitHub stacks. Do not retry a mutating command with Graphite. Ask whether to use ordinary pull requests or stop.

## Command map

| Operation | Graphite | GitHub |
|---|---|---|
| Inspect | `gt log short --stack --reverse` and `gt info <branch>` | `gh stack view --json` |
| Initialize existing branches | `gt track -p <parent>` | `gh stack init --base <trunk> <branches...>` |
| Submit | `gt submit --no-interactive --stack` | `gh stack submit --auto --open` |
| Rebase | `gt restack` | `gh stack rebase` |
| Synchronize | `gt sync` | `gh stack sync` |
| Merge | `gt submit --merge-when-ready --always --update-only --no-interactive` | `gh stack merge --yes` from the initialized worktree |

Always pass `--remote <name>` to supported `gh stack` commands when multiple remotes exist.

Always use `gh stack view --json`. The command without `--json` opens an interactive interface.

Always use `gh stack submit --auto`. The command without `--auto` can prompt for titles.

## Frontier

The bundled `orch frontier set` command supports both backends. It reads `POTETO_STACK_BACKEND` and normalizes the selected backend into the same frontier record.

The GitHub adapter consumes `gh stack view --json`. It does not modify the stack.

## Merge semantics

Graphite Merge When Ready arms an asynchronous stack drain. GitHub `gh stack merge --yes` requests an atomic stack merge when branch rules permit it.

A numeric `gh stack merge` argument is ambiguous because the extension resolves stack numbers before pull request numbers. Never pass a numeric target.

GitHub landing requires passing verdicts through the top pull request. Run the argument-free command from the stacker's initialized worktree.

If the repository uses a GitHub merge queue, `gh stack merge --yes` adds the stack to that queue. The queue can merge pull requests in separate groups.

Do not describe GitHub stack merge as Graphite Merge When Ready. Preserve the same independent verification gate before either command.

## Independent pull requests

Autopilot-full uses independent pull requests. When Graphite is selected, keep the existing Graphite registration.

When GitHub is selected, create each independent pull request with `gh pr create`. Do not create a one-item GitHub stack.
