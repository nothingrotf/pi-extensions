import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vite-plus/test'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))

describe('why', () => {
  it('answers from the record without retired investigator roles', () => {
    const skill = readFileSync(join(packageRoot, 'skills', 'why', 'SKILL.md'), 'utf8')
    expect(skill).toContain('Answer from the record, not the code')
    expect(skill).not.toMatch(/why investigators|why synthesizer|~\/\.cursor|mcps\//)
  })
})
