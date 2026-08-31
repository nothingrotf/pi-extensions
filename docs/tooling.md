# Repository tooling

## Vite+

Vite+ owns repository checks and workspace tasks.
The root `vite.config.ts` defines format, lint, test, staged-file, and cache settings.

Use these commands:

```sh
bun run check
bun run lint
bun run test
bun run fix
bun run format
```

`bun run check` verifies formatting, type-aware lint rules, and TypeScript types.

## Git hooks

`bun install` runs `vp config --no-agent` and configures `.vite-hooks/`.
The pre-commit hook checks staged files.
The commit message hook enforces Conventional Commits.

Verify the hook path:

```sh
git config --get core.hooksPath
```

## Dependencies

Bun owns the root lockfile.
Do not commit package-level lockfiles.
Use the root catalog for shared Pi packages.

Use exact versions for Vite+, Oxlint, and the Oxlint plugin API.
Update the Vite override with the Vite+ version.

## Editor support

The `.zed/settings.json` file configures Oxfmt and Oxlint.
Oxfmt formats supported files when Zed saves them.
Oxlint runs type-aware checks and safe fixes.
