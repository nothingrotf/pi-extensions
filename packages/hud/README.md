# @nothingrotf/hud

A compact one-line footer for [Pi](https://github.com/earendil-works/pi).
It replaces the default footer without changing the editor, theme, transcript, or notification behavior.

The left side shows:

- the current workspace
- the Git branch and working tree counters
- the provider, model, and reasoning effort
- the active Codex goal status

The right side shows provider quota windows and context use.
Quota windows support Anthropic and OpenAI Codex authentication from Pi.

## Install

```sh
pi install npm:@nothingrotf/hud
```

Try the local workspace without installation:

```sh
pi --no-extensions -e ./packages/hud/src/index.ts
```

## Development

```sh
bun install
bun run check
bun run test
```

## License

[MIT](LICENSE)
