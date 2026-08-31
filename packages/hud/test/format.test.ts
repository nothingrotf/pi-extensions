import { describe, expect, test } from 'vite-plus/test'

import { formatCount, formatCwd, prettyEffort, prettyModel, sanitizeScalar } from '../src/format.ts'

describe('HUD formatting', () => {
  test('formats model and effort labels', () => {
    expect(prettyModel('anthropic/claude-opus-4-8')).toBe('Opus 4.8')
    expect(prettyModel('openai-codex/gpt-5-6-codex')).toBe('5.6 Codex')
    expect(prettyEffort('xhigh')).toBe('XHigh')
    expect(prettyEffort('off')).toBe('')
  })

  test('formats counts without invalid numeric labels', () => {
    expect(formatCount(999)).toBe('999')
    expect(formatCount(1_500)).toBe('1.5k')
    expect(formatCount(1_500_000)).toBe('1.5M')
    expect(formatCount(Number.NaN)).toBe('--')
  })

  test('keeps the last two workspace segments', () => {
    expect(formatCwd('/opt/projects/pi-extensions')).toBe('…/projects/pi-extensions')
    expect(formatCwd('C:\\work')).toBe('C:/work')
    expect(formatCwd('C:\\projects\\pi-extensions\\packages\\hud')).toBe('C:/…/packages/hud')
    expect(formatCwd('\\\\server\\share')).toBe('//server/share')
    expect(formatCwd('\\\\server\\share\\projects\\pi-extensions\\packages\\hud')).toBe(
      '//server/share/…/packages/hud',
    )
  })

  test('sanitizes external status text', () => {
    expect(sanitizeScalar('goal\nactive\x1b[2J\x07')).toBe('goal active')
  })
})
