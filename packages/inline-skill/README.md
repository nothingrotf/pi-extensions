# Inline Skill

Use `$skill-name` anywhere in a normal Pi prompt.

## Behavior

- Search skill names with Pi's native fuzzy filter, including subsequences and case-insensitive queries.
- Search descriptions after name matches.
- Browse all matches without a fixed result limit.
- Press Tab or Enter to complete the selected alias.
- Replace the whole alias token, including the suffix after the cursor.
- Highlight known aliases across cursor movement, wrapping, and theme changes.
- Expand one skill through Pi's native `/skill:name` pipeline.
- Expand multiple distinct skills once each, with their source paths and relative reference directories.

The catalog comes from `pi.getCommands()`. Pi owns discovery, precedence, trust, disabled resources, and reloads.
Unknown aliases remain unchanged. Fuzzy matching selects suggestions, not skills during submission.

Slash commands, shell commands, escaped dollar signs, and Markdown code remain literal.
Extension-generated input remains unchanged. Submitted aliases retain their names without the dollar sign.

```text
Use $browser to inspect the page.
Use $agent-browser and $add-dark-mode to check the theme.
```

Complete `$browser` to `$agent-browser` before submission.

## Installation

```sh
pi install /absolute/path/to/pi-extensions/packages/inline-skill
```

Remove `npm:@pi-kaush/pi-inline-skill-identifier` from the global Pi package list before enabling this extension.
Restart Pi after migration to remove the old extension's process-wide editor patch.

## Compatibility

This package uses a session-local `CustomEditor`, not an `Editor.prototype` patch.
Another custom editor takes precedence when it loads first. Autocomplete remains available, with a warning about unavailable highlighting.
A later extension that replaces the editor can also replace highlighting.

Rendering maps native editor rows back to source text through the cursor position.
The extension uses Pi 0.85.1 editor hooks and public runtime imports.
Pi updates that change editor layout require compatibility checks.
Collapsed paste placeholders do not expose their contents for highlighting.

## Comparison

The inspected upstream implementation is `pi-kaush/pi-inline-skill-identifier` at `9f184c423a038b2cd1d5a2fd5fcfe7e0f3ee3897`.

| Behavior            | Upstream                     | Inline Skill                                |
| ------------------- | ---------------------------- | ------------------------------------------- |
| Skill discovery     | `pi.getCommands()`           | Same native catalog                         |
| Search              | Case-sensitive prefix        | Native fuzzy names, then descriptions       |
| Result limit        | 20                           | No extension limit                          |
| Completion          | Generic path insertion       | Whole alias replacement                     |
| Highlight           | Regex over ANSI output       | Source ranges mapped to rendered characters |
| Cursor within alias | Can interrupt matching       | Preserves cursor and highlight              |
| Theme changes       | Color captured at startup    | Current theme during rendering              |
| Editor mutation     | Process-wide prototype patch | Session-local custom editor                 |
| Multiple skills     | No expansion                 | Deduplicated skill blocks                   |

Pi's native slash completion uses fuzzy command-name matching. It does not search skill descriptions.
The smaller upstream list results from its prefix filter and result cap, not a separate discovery mechanism.

## Checks

```sh
bun run check
bun run test
```
