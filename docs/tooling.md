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
Keep the catalog at the minimum supported Pi version, which the root `README.md` names.
Pi loads extensions with its installed packages, so checks against another version do not represent users.

Use exact versions for Vite+, Oxlint, and the Oxlint plugin API.
Update the Vite override with the Vite+ version.

## Local Pi bundle

The root `package.json` also acts as a local Pi package.
Its resource globs discover extension entrypoints and standard resource directories under `packages/`.
Packages keep their independent publication metadata and can still load individually.

Run `bun run pi:install` to register the root bundle and remove legacy entries for packages in this checkout.
The installer uses Pi's package commands, preserves external package sources, and backs up existing settings before mutation.
Run `/reload` after installation or after adding a package with a standard entrypoint.

`bun run pi:remove` removes the bundle and configured legacy local entries, but leaves external packages untouched.
`bun run pi:profile` creates an isolated profile with one repository source rather than separate workspace sources.
All three commands accept an alternate agent directory or profile path as their existing optional argument.

## Editor support

The `.zed/settings.json` file configures Oxfmt and Oxlint.
Oxfmt formats supported files when Zed saves them.
Oxlint runs type-aware checks and safe fixes.
