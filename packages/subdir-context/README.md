# @nothingrotf/subdir-context

`@nothingrotf/subdir-context` loads the instruction files of subdirectories when Pi tools touch them.

Pi loads `AGENTS.md` or `CLAUDE.md` from the session directory and its ancestors at startup.
Work in `packages/app/src` does not load `packages/app/AGENTS.md`, because that directory is below the session directory.
This extension adds those files to the conversation when a tool first reaches the directory.

## Install

```sh
pi install npm:@nothingrotf/subdir-context
```

Restart Pi after installation.

## Behavior

- A successful `read`, `write`, `edit`, `ls`, `find`, `grep`, or `patch` call names the touched paths through its arguments.
- For each path, the extension collects the directories between the session directory and the path, outer first.
- Each directory contributes its first file among `AGENTS.override.md`, `AGENTS.md`, `AGENTS.MD`, `CLAUDE.md`, and `CLAUDE.MD`. This is the order Pi uses.
- New files arrive in one custom message after the tool results of the current turn, before the next model request.
- Calls from `codemode` scripts count like direct calls.
- `read` with `paths` from `@nothingrotf/filetools` loads the chain of every path.
- The transcript shows one line, for example `Loaded instructions: packages/app/AGENTS.md`.

The message states that each file applies to its directory and below, and that it does not approve actions that already ran.

## Deduplication

The extension delivers each file once per branch.
It reads earlier deliveries from the active branch, so resume, fork, and tree navigation keep the correct state.
A compaction that removes a delivery from the context makes the file eligible again.
A changed file arrives again with a `(changed since it was loaded)` heading.
A file whose content equals a file that Pi already loaded is skipped, for example the root file of a nested worktree.

## Limits

- Only directories inside the session directory count. Paths outside it and symlinks that resolve outside it load nothing.
- Listings and searches load the chain of the searched directory only, never the instructions of the children they return.
- Failed tool calls load nothing.
- `bash` commands load nothing, because the extension does not parse shell commands.
- The files arrive after the tool ran. They cannot change a call that already happened.
- An untrusted project loads nothing.
- When Pi runs with `--no-context-files` and the project has instruction files, the extension loads nothing. Without any project instruction file, the extension cannot detect that flag.
- Subagent Tasks do not load extensions by default, so their children do not receive these files.

## Session data

Each delivery is a `subdir-context` custom message with these details:

```json
{ "version": 1, "files": [{ "path": "packages/app/AGENTS.md", "sha256": "..." }] }
```
