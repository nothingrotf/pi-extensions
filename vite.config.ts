import { defineConfig } from 'vite-plus'

export default defineConfig({
  fmt: {
    printWidth: 100,
    semi: false,
    singleQuote: true,
    sortImports: true,
    sortPackageJson: true,
    trailingComma: 'all',
  },
  lint: {
    jsPlugins: [
      { name: 'vite-plus', specifier: 'vite-plus/oxlint-plugin' },
      { name: 'anti-slop', specifier: './tools/oxlint/anti-slop-plugin.ts' },
      { name: 'hygiene', specifier: './tools/oxlint/hygiene-plugin.ts' },
    ],
    rules: {
      'anti-slop/no-chained-type-assertions': 'error',
      'anti-slop/no-conditional-empty-object-spread': 'error',
      'anti-slop/no-module-mocking': 'error',
      'anti-slop/no-object-parameters': 'error',
      'anti-slop/no-record-type': 'error',
      'anti-slop/no-reflect-apply': 'error',
      'anti-slop/no-reflect-get': 'error',
      'anti-slop/no-runtime-typeof': 'error',
      'anti-slop/no-shape-in-symbol-names': 'error',
      'anti-slop/no-unknown-parameters': 'error',
      'anti-slop/no-unknown-type-aliases': 'error',
      'anti-slop/no-unsafe-dictionary-type': 'error',
      'hygiene/no-async-context-enter-with': 'error',
      'hygiene/no-foreign-directive': 'error',
      'hygiene/no-vacuous-throw-assertion': 'error',
      'hygiene/no-void-operator': 'error',
      'hygiene/require-suppression-reason': 'error',
      'no-console': 'error',
      'no-debugger': 'error',
      'typescript/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
      'typescript/no-explicit-any': 'error',
      'typescript/no-non-null-assertion': 'error',
      'typescript/no-unnecessary-type-assertion': 'error',
      'typescript/no-unsafe-type-assertion': 'error',
      'vite-plus/prefer-vite-plus-imports': 'error',
    },
    options: { typeAware: true, typeCheck: true },
    overrides: [
      {
        files: ['tools/oxlint/**/*.ts'],
        rules: {
          'anti-slop/no-runtime-typeof': 'off',
          'no-console': 'off',
        },
      },
    ],
  },
  staged: {
    '*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}': 'vp check --fix',
    '*.{css,html,json,jsonc,md,mdx,toml,yaml,yml}': 'vp fmt --write',
  },
  test: {
    exclude: ['**/node_modules/**'],
  },
  run: {
    cache: {
      scripts: false,
      tasks: true,
    },
  },
})
