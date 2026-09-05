import { describe, expect, test } from 'vite-plus/test'

import {
  formatCacheLabel,
  formatCount,
  formatCwd,
  prettyEffort,
  prettyModel,
  sanitizeScalar,
} from '../src/format.ts'

describe('HUD formatting', () => {
  test('counts cache writes as input without treating them as cache hits', () => {
    expect(formatCacheLabel({ input: 100, cacheRead: 800, cacheWrite: 100 })).toBe('⛁ 80% cached')
    expect(formatCacheLabel({ input: 100, cacheRead: 0, cacheWrite: 900 })).toBe('⛁ 0% cached')
    expect(formatCacheLabel({ input: 0, cacheRead: 100, cacheWrite: 0 })).toBe('⛁ 100% cached')
  })

  test('hides unavailable or invalid cache usage', () => {
    expect(formatCacheLabel(undefined)).toBe('')
    for (const input of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(formatCacheLabel({ input, cacheRead: 0, cacheWrite: 0 })).toBe('')
    }
    expect(formatCacheLabel({ input: 100, cacheRead: Number.NaN, cacheWrite: 0 })).toBe('')
  })

  test('formats model and effort labels', () => {
    expect(prettyModel('anthropic/claude-opus-4-8')).toBe('Opus 4.8')
    expect(prettyModel('openai-codex/gpt-5-6-codex')).toBe('GPT 5.6 Codex')
    expect(prettyModel('openai-codex/gpt-6-astra')).toBe('GPT 6 Astra')
    expect(prettyEffort('xhigh')).toBe('XHigh')
    expect(prettyEffort('off')).toBe('')
  })

  test('formats counts without invalid numeric labels', () => {
    expect(formatCount(999)).toBe('999')
    expect(formatCount(1_500)).toBe('1.5k')
    expect(formatCount(1_500_000)).toBe('1.5M')
    expect(formatCount(Number.NaN)).toBe('--')
  })

  test('shows only the current folder across path styles', () => {
    expect(formatCwd('/opt/projects/pi-extensions')).toBe('pi-extensions')
    expect(formatCwd('/opt/projects/pi-extensions/')).toBe('pi-extensions')
    expect(formatCwd('C:\\work')).toBe('work')
    expect(formatCwd('C:\\projects\\pi-extensions\\packages\\hud')).toBe('hud')
    expect(formatCwd('\\\\server\\share')).toBe('share')
    expect(formatCwd('\\\\server\\share\\projects\\pi-extensions\\packages\\hud')).toBe('hud')
    expect(formatCwd('relative/folder')).toBe('folder')
    expect(formatCwd('/')).toBe('/')
    expect(formatCwd('C:\\')).toBe('C:/')
    expect(formatCwd('')).toBe('--')
  })

  test('sanitizes external status text', () => {
    expect(sanitizeScalar('goal\nactive\x1b[2J\x07')).toBe('goal active')
  })
})
