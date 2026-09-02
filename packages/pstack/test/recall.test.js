import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vite-plus/test'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const skillPath = join(packageRoot, 'skills', 'recall', 'SKILL.md')

function skill() {
  return readFileSync(skillPath, 'utf8')
}

describe('recall', () => {
  it('uses bounded project session history', () => {
    const port = skill()
    for (const value of [
      'session_history',
      '`list`',
      '`search`',
      '`read`',
      '`timeline`',
      '`tool_activity`',
      'pi-session://',
    ])
      expect(port).toContain(value)
    expect(port).toContain('Keep the current session and child sessions excluded.')
    expect(port).toContain('`view: "audit"`')
  })

  it('keeps evidence collection with the parent', () => {
    const port = skill()
    expect(port).toContain('parent prepares bounded evidence slices')
    expect(port).toContain('`readonly: true`')
    expect(port).toContain('do not receive physical session paths or ambient source tools')
    expect(port).toContain('Do not treat an assistant statement as proof.')
  })

  it('contains no Cursor transcript assumptions', () => {
    const port = skill()
    expect(port).not.toMatch(/~\/\.cursor|agent-transcripts|\.jsonl|ls -t/)
    expect(port).not.toMatch(/grok-4\.6|gpt-5\.6|claude-fable|claude-opus-5/)
  })
})
