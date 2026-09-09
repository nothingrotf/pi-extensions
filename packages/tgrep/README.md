# @nothingrotf/tgrep

Replace Pi's native `grep` tool with [Microsoft tgrep](https://github.com/microsoft/tgrep).
The package preserves the native arguments and renderers. It does not rewrite shell commands or fall back to ripgrep.
HUD uses its fallback action rail for grep calls and does not register a competing grep tool.
Both extensions can load in either order. Rail toggles preserve the tgrep registration.
Use the HUD source from this repository when both packages are installed.

## Install

Install tgrep separately. Version 1.0.5 is tested.

```sh
brew install tgrep
```

From this repository, install the local package:

```sh
pi install ./packages/tgrep
```

Restart Pi or run `/reload` after installation.
For a temporary session, use `pi -e ./packages/tgrep/src/index.ts`.

## Search modes

Fresh mode is the default. It uses `--no-index --hidden --no-max-filesize` to search current files, including nonignored hidden files.
Normal tgrep ignore and binary rules still apply. No server or index is required.

Indexed mode opts into tgrep's server and on-disk index discovery:

```sh
tgrep index . --no-max-filesize
tgrep serve . --no-max-filesize
```

Run the server in a separate terminal. Add `.tgrep/` to the project's `.gitignore`.
Start Pi from the same search root:

```sh
pi --tgrep-indexed
```

Indexed mode excludes hidden files and can miss new files or recent edits.
A cold server can return incomplete results during its initial build. An offline index reflects its last build.
Search results include an indexed-mode warning. Restart Pi without `--tgrep-indexed` when current, exhaustive results matter.
The extension does not create indexes, start servers, or modify ignore files.

## Compatibility and limits

The tool accepts `pattern`, `path`, `glob`, `ignoreCase`, `literal`, `context`, and `limit`.
Paths resolve against the current session directory. Absolute paths, `@` prefixes, and home-directory paths are supported.
Patterns and paths pass directly to the executable without a shell.

- Default limit: 100 matching lines across all files.
- Output cap: 50KB or 2000 lines, plus notices.
- Long lines: 500 characters.
- Search timeout: 120 seconds.
- Cancellation terminates the search client, not an external server.

Narrow the search or increase `limit` for additional matches. Use `read` for full lines.
Context uses tgrep's merged context blocks, rather than repeating overlapping blocks for each match.
Warnings from tgrep appear in results. Missing executables, invalid patterns, and process failures produce tool errors.
Other behavior follows tgrep, including regex support, binary detection, and ignore-rule differences from ripgrep.

## Development

```sh
bun run check
bun run test
```

Integration tests execute the installed tgrep binary. They skip when tgrep is unavailable.
