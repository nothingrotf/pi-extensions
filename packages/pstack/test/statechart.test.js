import { execFile } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vite-plus/test'

const exec = promisify(execFile)
const scripts = join(
  dirname(dirname(fileURLToPath(import.meta.url))),
  'skills',
  'statechart',
  'scripts',
)

describe('statechart skill scripts', () => {
  it('pass the bundled upstream suite', async () => {
    const result = await exec(process.execPath, ['--test', 'test/statechart.test.mjs'], {
      cwd: scripts,
      maxBuffer: 16 * 1024 * 1024,
      timeout: 600_000,
    })
    expect(result.stdout).toMatch(/^ℹ fail 0$/m)
    expect(result.stdout).toMatch(/^ℹ pass [1-9]\d*$/m)
  }, 610_000)

  it('prints usage without TLC', async () => {
    const result = await exec(process.execPath, [join(scripts, 'statechart.mjs'), '--help'])
    expect(result.stdout).toContain('from-spec')
    expect(result.stdout).toContain('from-chart')
  })
})
