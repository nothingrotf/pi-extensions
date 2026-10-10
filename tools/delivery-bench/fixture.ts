export const criteria = [
  {
    id: 'bulk',
    description:
      'priceOf(sku, quantity) applies the 10% bulk discount when quantity is 10 or more, and a test covers quantity 10',
  },
  {
    id: 'unknown',
    description:
      'priceOf throws UnknownSkuError, exported from src/pricing.ts, for a SKU that the catalog lacks, and a test covers it',
  },
  { id: 'suite', description: 'bun test passes' },
]

export const fixtureFiles: ReadonlyArray<readonly [string, string]> = [
  [
    'package.json',
    `${JSON.stringify(
      {
        name: 'pricing-bench',
        private: true,
        type: 'module',
        scripts: { setup: 'bun scripts/setup.ts', test: 'bun test' },
      },
      null,
      2,
    )}\n`,
  ],
  ['.gitignore', '.data/\nnode_modules/\n'],
  [
    'AGENTS.md',
    [
      '# Pricing service',
      '',
      'Tests read the catalog database in `.data/catalog.json`.',
      'Run `bun run setup` once in each new checkout before `bun test`. It migrates and seeds the database, which takes a while.',
      '',
    ].join('\n'),
  ],
  ['.pstack/worktree-setup.sh', 'bun run setup\n'],
  [
    'scripts/setup.ts',
    [
      "import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'",
      '',
      "const seconds = Number(process.env.BENCH_SETUP_SECONDS ?? '20')",
      'await Bun.sleep(seconds * 1000)',
      "mkdirSync('.data', { recursive: true })",
      "writeFileSync('.data/catalog.json', JSON.stringify({ apple: 120, pear: 80, plum: 45 }))",
      'const log = process.env.BENCH_LOG',
      'if (log) appendFileSync(log, `${new Date().toISOString()} ${process.cwd()}\\n`)',
      "console.log('Catalog database ready.')",
      '',
    ].join('\n'),
  ],
  [
    'src/catalog.ts',
    [
      "import { readFileSync } from 'node:fs'",
      "import { join } from 'node:path'",
      '',
      'export function loadCatalog(root = process.cwd()): Map<string, number> {',
      '  let text: string',
      '  try {',
      "    text = readFileSync(join(root, '.data', 'catalog.json'), 'utf8')",
      '  } catch {',
      "    throw new Error('The catalog database is missing. Run `bun run setup` first.')",
      '  }',
      '  return new Map(Object.entries(JSON.parse(text)))',
      '}',
      '',
    ].join('\n'),
  ],
  [
    'src/pricing.ts',
    [
      "import { loadCatalog } from './catalog.ts'",
      '',
      'export function priceOf(sku: string, quantity: number, catalog = loadCatalog()): number {',
      '  const unit = catalog.get(sku) ?? 0',
      '  const total = unit * quantity',
      '  return quantity > 10 ? Math.round(total * 0.9) : total',
      '}',
      '',
    ].join('\n'),
  ],
  [
    'test/pricing.test.ts',
    [
      "import { expect, test } from 'bun:test'",
      '',
      "import { priceOf } from '../src/pricing.ts'",
      '',
      "test('prices a single item', () => {",
      "  expect(priceOf('apple', 1)).toBe(120)",
      '})',
      '',
      "test('discounts large orders', () => {",
      "  expect(priceOf('pear', 20)).toBe(1440)",
      '})',
      '',
    ].join('\n'),
  ],
]

export const acceptanceTestName = '.bench-acceptance.test.ts'

export const acceptanceTest = [
  "import { expect, test } from 'bun:test'",
  '',
  "import { priceOf, UnknownSkuError } from './src/pricing.ts'",
  '',
  "test('discounts exactly ten items', () => {",
  "  expect(priceOf('apple', 10)).toBe(1080)",
  '})',
  '',
  "test('keeps nine items at full price', () => {",
  "  expect(priceOf('plum', 9)).toBe(405)",
  '})',
  '',
  "test('rejects an unknown SKU', () => {",
  "  expect(() => priceOf('kiwi', 1)).toThrow(UnknownSkuError)",
  '})',
  '',
].join('\n')
