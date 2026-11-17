import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vite-plus/test'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))

describe('architect', () => {
  it('routes large designs to arena without retired runner policy', () => {
    const skill = readFileSync(join(packageRoot, 'skills', 'architect', 'SKILL.md'), 'utf8')
    expect(skill).toContain('run the **arena** skill')
    expect(skill).not.toContain('architect runners')
    expect(skill).not.toMatch(/~\/\.cursor|claude-fable|claude-opus-5/)
  })
})
