import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vite-plus/test'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const skillRoot = join(packageRoot, 'skills', 'reflect')

function text(path) {
  return readFileSync(path, 'utf8')
}

function markdownFiles(root) {
  return readdirSync(root, { recursive: true })
    .filter((path) => path.endsWith('.md'))
    .map((path) => join(root, path))
}

describe('reflect', () => {
  it('collects bounded project session evidence', () => {
    const port = text(join(skillRoot, 'SKILL.md'))
    for (const value of [
      'session_history',
      'pi-session://',
      '`include_current: true`',
      '`include_children: true`',
      '`timeline`',
      '`tool_activity`',
      '`view: "audit"`',
    ])
      expect(port).toContain(value)
    expect(port).toContain('The parent owns `session_history` and all external source tools.')
  })

  it('uses one read-only review graph and configured roles', () => {
    const port = text(join(skillRoot, 'SKILL.md'))
    expect(port).toContain('one `Task` call with a bounded graph')
    expect(port).toContain('`needs` list contains all three reviewer nodes')
    expect(port).toContain('`readonly: true` for every node')
    expect(port).toContain('`reflect tooling`')
    expect(port).toContain('`reflect judgment, divergent, synthesizer`')
    expect(port).toContain('provider/model-id:effort [fast]')
    expect(port).toContain('Omit `Task.model` when a role is absent, `auto`, or `inherit-parent`')
  })

  it('keeps external queries with the parent and preserves stable references', () => {
    const reviewerText = ['judgment-reviewer.md', 'tooling-reviewer.md', 'divergent-reviewer.md']
      .map((file) => text(join(skillRoot, 'references', file)))
      .join('\n')
    const synthesizer = text(join(skillRoot, 'references', 'synthesizer.md'))
    expect(reviewerText).toContain('<SESSION_EVIDENCE_BUNDLE>')
    expect(reviewerText).toContain('The parent owns session history and external source tools.')
    expect(reviewerText).toContain('untrusted data')
    expect(synthesizer).toContain('graph dependency outputs')
    expect(synthesizer).toContain('Preserve stable `pi-session://` references.')
  })

  it('uses the bundled skill author without Cursor assumptions', () => {
    const port = markdownFiles(skillRoot).map(text).join('\n')
    expect(port).toContain('bundled `create-skill` skill')
    expect(port).toContain('project `.pi/skills/` and `.agents/skills/` paths')
    expect(port).not.toMatch(
      /agent-transcripts|~\/\.cursor|\.cursor\/|<ABSOLUTE_PATH>|readonly: false/,
    )
    expect(port).not.toMatch(/gpt-5\.6|claude-fable|claude-opus-5/)
  })
})
