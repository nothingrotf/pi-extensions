# Repository instructions

Read `docs/package-conventions.md` before you add or change a package.
Read `docs/tooling.md` before you change repository tools or scripts.

Use Bun for dependency and workspace commands.
Use Vite+ for checks, tests, formatting, and workspace tasks.
Keep every package as a direct child of `packages/`.
Use the root catalog for shared Pi dependency versions.
Do not add React or Effect dependencies.
Do not add a package-level lockfile.
Do not use type assertions, `any`, broad records, or module mocks.
Import relative TypeScript modules with explicit file extensions.
Run `bun run check` and `bun run test` before each commit.
Use Conventional Commits.
Never add an agent name as a commit coauthor.
Never write code comments unless the user requests comments with the exact phrase "add comments".
Never use an em dash.
