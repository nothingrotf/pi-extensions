import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, expect, it } from 'vite-plus/test'

import { prepareLiveFixture } from './live-fixtures.js'

const execute = promisify(execFile)
const directories = []

async function base() {
  const directory = await mkdtemp(join(tmpdir(), 'pstack-fixture-'))
  directories.push(directory)
  await writeFile(join(directory, 'package.json'), '{"type":"module"}')
  await writeFile(
    join(directory, 'names.js'),
    'export function normalizeNames(values) { return values.map(value => value.trim()).filter(Boolean) }\n',
  )
  await writeFile(
    join(directory, 'cli.js'),
    'import { normalizeNames } from "./names.js"\nconsole.log(JSON.stringify(normalizeNames(process.argv.slice(2))))\n',
  )
  await writeFile(
    join(directory, 'names.test.js'),
    'import { expect, test } from "bun:test"\nimport { normalizeNames } from "./names.js"\ntest("trims", () => expect(normalizeNames([" Ada ", ""])).toEqual(["Ada"]))\n',
  )
  await execute('git', ['init', '--quiet'], { cwd: directory })
  await execute('git', ['add', '.'], { cwd: directory })
  await execute(
    'git',
    [
      '-c',
      'user.name=Local Verification',
      '-c',
      'user.email=local@example.test',
      'commit',
      '--quiet',
      '-m',
      'Initial fixture',
    ],
    { cwd: directory },
  )
  return directory
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

it('supplies executable historical evidence for the bug investigation', async () => {
  const directory = await base()
  const goal = await prepareLiveFixture(directory, { id: 'bug-source' })
  expect(goal).toContain('regression')
  const history = await execute('git', ['log', '--format=%s'], { cwd: directory })
  expect(history.stdout).toContain('Preserve first-seen names')
  const current = await execute('bun', ['cli.js', 'Ada', 'Ada'], { cwd: directory })
  expect(JSON.parse(current.stdout)).toEqual(['Ada', 'Ada'])
  const previous = await execute('git', ['show', 'HEAD~1:names.js'], { cwd: directory })
  expect(previous.stdout).toContain('new Set')
})

it('preserves existing behavior for a refactoring goal', async () => {
  const directory = await base()
  const goal = await prepareLiveFixture(directory, { id: 'refactoring' })
  expect(goal).toContain('duplicate preservation')
  const checked = JSON.parse(await readFile(join(directory, 'baseline-check.json'), 'utf8'))
  expect(checked.success).toBe(true)
  expect(checked.stderr).toContain('preserves current duplicate behavior')
})

it('captures real measured profile evidence for dump forensics', async () => {
  const directory = await base()
  const goal = await prepareLiveFixture(directory, { id: 'dump-forensics-reader' })
  expect(goal).toContain('Do not rerun')
  const baseline = JSON.parse(await readFile(join(directory, 'baseline.json'), 'utf8'))
  expect(baseline.samples).toHaveLength(5)
  expect(baseline.medianMs).toBeGreaterThan(0)
  const profile = JSON.parse(await readFile(join(directory, 'normalization.cpuprofile'), 'utf8'))
  expect(profile.nodes.some((node) => node.callFrame.functionName === 'normalizeNames')).toBe(true)
}, 20000)

it('provides a real changed patch and passing regression to shipping verification', async () => {
  const directory = await base()
  await prepareLiveFixture(directory, { id: 'shipping-verifier' })
  const diff = await execute('git', ['diff', 'HEAD~1', 'HEAD', '--', 'names.js'], {
    cwd: directory,
  })
  expect(diff.stdout).toContain('new Set')
  const checked = JSON.parse(await readFile(join(directory, 'baseline-check.json'), 'utf8'))
  expect(checked.success).toBe(true)
  expect(checked.stderr).toContain('deduplicates trimmed names stably')
})

it('documents all executable local maintenance routes without claiming deduplication', async () => {
  const directory = await base()
  await prepareLiveFixture(directory, { id: 'maintenance-source-reader' })
  const root = join(directory, '.pi/skills/verify-name-list')
  const features = await readFile(join(root, 'features/README.md'), 'utf8')
  expect(features).toContain('duplicates.md')
  const duplicates = await readFile(join(root, 'features/duplicates.md'), 'utf8')
  expect(duplicates).toContain('["Ada","Ada"]')
  const checked = await execute('bun', ['cli.js', 'Ada', 'Ada'], { cwd: directory })
  expect(duplicates).toContain(checked.stdout.trim())
})

it('isolates ticket and chat evidence instead of repeating source-control input', async () => {
  const ticket = await base()
  const chat = await base()
  const ticketGoal = await prepareLiveFixture(ticket, { id: 'why-tickets' })
  const chatGoal = await prepareLiveFixture(chat, { id: 'why-chat' })
  const ticketEvidence = await readFile(join(ticket, 'category-evidence.md'), 'utf8')
  const chatEvidence = await readFile(join(chat, 'category-evidence.md'), 'utf8')
  expect(ticketEvidence).toContain('Fictional ticket')
  expect(chatEvidence).toContain('Fictional conversation')
  expect(ticketEvidence).not.toBe(chatEvidence)
  expect(ticketGoal).toContain('Assigned Why category: tickets')
  expect(chatGoal).toContain('Assigned Why category: chat')
  expect(ticketEvidence).toContain('No external category service was queried')
})

it('captures a real local failing assertion for the error investigator', async () => {
  const directory = await base()
  await prepareLiveFixture(directory, { id: 'why-errors' })
  const evidence = await readFile(join(directory, 'category-evidence.md'), 'utf8')
  expect(evidence).toContain('Actual local assertion failed with exit 1')
  expect(evidence).toContain('ERR_ASSERTION')
  expect(evidence).toContain('Ada')
})

it('bounds bulk evidence while preserving actual error positions', async () => {
  const directory = await base()
  await prepareLiveFixture(directory, { id: 'bulk-parser' })
  const lines = (await readFile(join(directory, 'import.log'), 'utf8')).trim().split('\n')
  const errors = lines.filter((line) => line.includes('\tERROR\t'))
  expect(lines).toHaveLength(1500)
  expect(errors).toHaveLength(11)
  expect(errors[0]).toBe('1\tERROR\tname-0')
  expect(errors.at(-1)).toBe('1371\tERROR\tname-1370')
})
