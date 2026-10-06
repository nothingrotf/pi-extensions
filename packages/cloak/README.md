# @nothingrotf/cloak

Mask configured text patterns in Pi `read` results before the model receives them.
This package independently implements the behavior of [dmmulroy's pi-cloak](https://github.com/dmmulroy/.dotfiles/blob/main/home/.pi/agent/extensions/pi-cloak/index.ts).

## Load locally

```sh
pi -e ./packages/cloak/src/index.ts
```

## Configuration

Create `cloak.json` inside the Pi agent directory, normally `~/.pi/agent`.
`PI_CODING_AGENT_DIR` selects an alternate agent directory.

```json
{
  "enabled": true,
  "cloakCharacter": "*",
  "cloakLength": null,
  "tryAllPatterns": true,
  "patterns": [
    {
      "filePattern": [".env", ".env.*"],
      "cloakPattern": "^(\\s*[A-Za-z_][A-Za-z0-9_]*\\s*=\\s*).+",
      "replace": "$1"
    }
  ]
}
```

Run `/cloak-status` to reload the configuration and show its status.
Pi also loads the configuration at session startup.

- `enabled` defaults to `true`.
- `cloakCharacter` defaults to `*`. Multi-character masks repeat and truncate to the required length.
- `cloakLength` defaults to `null`, preserving match length. An integer sets the total replacement length, including visible text.
- `tryAllPatterns` defaults to `true`. Set it to `false` to stop after the first pattern that changes each line within a rule.
- `patterns` defaults to an empty list, which masks nothing.
- `filePattern` accepts a glob or an array. Globs support `*`, `**`, and `?`.
- File matching checks normalized relative paths, absolute paths, and basenames. Leading `@` and `~/` paths are supported.
- `cloakPattern` accepts a regex string, an object, or an array of either form.
- Objects accept `pattern`, optional `flags`, and optional `replace`. Matching always includes the global flag.
- A pattern's `replace` overrides the rule's replacement. Templates support `$1` through `$99`, `$&`, and `$$`.
- Without a nonempty replacement, masking preserves the first character of each match.

Patterns run separately on each line. Line endings remain unchanged.
The package supports native reads and filetools single-file, multi-file, and JSON projection reads.
It masks both text blocks and structured file text. A changed structured result omits the raw JSON projection `value`.

## Limits

This extension is not a security boundary. It does not mask `bash`, search tools, images, prompts, existing session messages, or files on disk.
Visible replacement templates can intentionally expose matched text.
Missing or invalid configuration disables masking and produces an interactive startup warning.
`/cloak-status` reports configuration failures in all modes.
Use trusted regex patterns, because expensive expressions can block the Pi process.
`cloakLength` accepts integers from zero through 1,000,000.

## Development

```sh
bun run check
bun run test
```
