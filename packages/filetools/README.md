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
The notice names the exact continuation offset, so the model requests the window it needs instead of the whole file.

Two bounded extensions reduce the number of calls:

- `paths` reads up to 32 files in one call, in order, under a 60,000 character budget. An optional `limit` caps the lines returned per file. The result names any file left for a separate call.
- `json` selects part of a JSON document before any truncation, for example `.report.verdict`, `.items[0:10]`, or `.items.length`.

The selector language stays small on purpose. A field, an index, a `start:end` slice, a quoted key, and `length` are supported. Anything else fails instead of returning a wrong value.
Incompatible combinations fail too: `path` with `paths`, `paths` with an `offset`, and `json` with a window.
A key that is not a plain identifier uses the quoted form, for example `.["test:domain"]`, and the error names that form.

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

Two guards protect the workspace:

- A structural check reports an unbalanced delimiter with its line, and invalid JSON, right in the patch result. It skips strings, templates, comments, and regular expressions, and it never replaces a type check.
- Content or replacement text that carries a bounded read marker is refused, because writing a bounded read back to disk deletes every line the read omitted.

## System prompt

Both tools contribute a snippet and guidelines to the session system prompt, in the root session and in every child that receives the capability:

```text
Available tools:
- patch: Edit several files in one call

Guidelines:
- Use read to examine files instead of cat or sed.
- Search before reading, and read a bounded window of a large file.
- After a bounded head and file map, continue at the offset the result names.
- Read several files in one call with paths instead of one read call per file.
- Select fields of a large JSON file with json instead of reading the whole document.
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
