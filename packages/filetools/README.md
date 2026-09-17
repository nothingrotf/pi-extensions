# @nothingrotf/filetools

Bounded file reads and multi-file patches for Pi sessions and their subagents.

## Why

A coding agent spends most of its clock on reading whole files it does not need and on one edit call per file.
This package removes both costs without changing the tool names a session already records.

## Tools

### `read`

The package replaces Pi's native `read` tool.
The behavior is identical for a small file or for any call that passes `offset` or `limit`.

A file larger than 20 KB read without an explicit window returns:

- the first 200 lines,
- the total line count and byte count,
- a map of declarations, headings, and methods with their line numbers.

The map lists at most 60 distinct entries and collapses repeated lines, so a generated file stays readable.
The notice names the next step, so the model requests the exact window it needs instead of the whole file.

### `patch`

`patch` applies changes to many files in one call.
Each file entry takes either exact-match `edits` or full `content`.

The call is all or nothing.
A patch that fails to match uniquely writes nothing, so a partial edit never reaches an isolated workspace or a captured artifact.

```json
{
  "files": [
    { "path": "src/a.ts", "edits": [{ "oldText": "const a = 1", "newText": "const a = 2" }] },
    { "path": "src/b.ts", "content": "export const b = 3\n" }
  ]
}
```

The result reports the touched files, the applied edit count, and the line delta per file.

## System prompt

Both tools contribute a snippet and guidelines to the session system prompt, in the root session and in every child that receives the capability:

```text
Available tools:
- patch: Edit several files in one call

Guidelines:
- Use read to examine files instead of cat or sed.
- Search before reading, and read a bounded window of a large file.
- After a bounded head and file map, request the exact window with offset and limit.
- Read a whole file only when the work depends on its full content.
- Use patch to change several files in one call instead of one edit call per file.
- Give each file either exact-match edits or full content, never both.
- A patch writes nothing when any edit fails to match exactly once.
```

## Subagents

The extension publishes a `filetools` capability to `@nothingrotf/subagent`.
The `pstack-leaf` and `pstack-nested` profiles list it as an optional registration, so pstack workers receive both tools when this package is installed and keep working when it is absent.

The capability declares `read` as an intentional override of the built-in tool.
Read-only children keep `read` and lose `patch`.

## Installation

```sh
bun add -g @nothingrotf/filetools
```

Pi loads the extension from the package `pi.extensions` entry.
