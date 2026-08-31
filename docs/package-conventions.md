# Package conventions

Each package is a direct child of `packages/`.
Each package publishes independently under the `@nothingrotf` npm scope.

## Required files

Create these files in every package:

- `LICENSE`
- `README.md`
- `package.json`
- `src/index.ts`
- `tsconfig.json`

Add a `test/` directory when the package contains executable behavior.
Do not add a package lockfile inside a workspace.

## Package manifest

Use this manifest as the base:

```json
{
  "name": "@nothingrotf/pi-example",
  "version": "0.1.0",
  "description": "A specific description of the extension behavior.",
  "type": "module",
  "license": "MIT",
  "main": "./src/index.ts",
  "files": ["src", "README.md", "LICENSE"],
  "scripts": {
    "check": "vp check",
    "test": "vp test run"
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*"
  },
  "devDependencies": {
    "@earendil-works/pi-coding-agent": "catalog:"
  },
  "pi": {
    "extensions": ["./src/index.ts"]
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/nothingrotf/pi-extensions",
    "directory": "packages/pi-example"
  },
  "publishConfig": {
    "access": "public",
    "provenance": true,
    "registry": "https://registry.npmjs.org/"
  }
}
```

Add only the Pi peer packages that the source imports.
Use `*` for host packages in `peerDependencies`.
Use `catalog:` for their matching `devDependencies`.

## TypeScript configuration

Extend the root configuration:

```json
{
  "extends": "../../tsconfig.json",
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

Import relative TypeScript modules with explicit `.ts` extensions.
Export the extension from `src/index.ts`.
Do not use type assertions or `any`.

## Verification

Run the repository checks before each commit:

```sh
bun run check
bun run test
```

Inspect the package archive before publication:

```sh
cd packages/pi-example
bun pm pack
```

Verify that the archive contains only the files declared in `files`.
