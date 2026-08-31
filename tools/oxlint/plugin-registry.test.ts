import { readFile } from 'node:fs/promises'

import { expect, test } from 'vite-plus/test'

const configuredRules = [
  'anti-slop/no-chained-type-assertions',
  'anti-slop/no-conditional-empty-object-spread',
  'anti-slop/no-module-mocking',
  'anti-slop/no-object-parameters',
  'anti-slop/no-record-type',
  'anti-slop/no-reflect-apply',
  'anti-slop/no-reflect-get',
  'anti-slop/no-runtime-typeof',
  'anti-slop/no-shape-in-symbol-names',
  'anti-slop/no-unknown-parameters',
  'anti-slop/no-unknown-type-aliases',
  'anti-slop/no-unsafe-dictionary-type',
  'hygiene/no-async-context-enter-with',
  'hygiene/no-foreign-directive',
  'hygiene/no-vacuous-throw-assertion',
  'hygiene/no-void-operator',
  'hygiene/require-suppression-reason',
]

const pluginSpecifiers = ['./tools/oxlint/anti-slop-plugin.ts', './tools/oxlint/hygiene-plugin.ts']

async function readConfiguration() {
  const configuration = await readFile(new URL('../../vite.config.ts', import.meta.url), 'utf8')
  return configuration.replaceAll("'", '"')
}

test('registers every local lint rule', async () => {
  const configuration = await readConfiguration()

  for (const specifier of pluginSpecifiers) {
    expect(configuration).toContain(specifier)
  }

  for (const rule of configuredRules) {
    expect(configuration).toContain(`"${rule}": "error"`)
  }
})
