import { homedir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, test } from 'vite-plus/test'

import {
  authFilePath,
  normalizePercent,
  parseClaudeWindows,
  parseCodexWindows,
} from '../src/usage.ts'

describe('provider usage', () => {
  test('parses Anthropic quota windows', () => {
    const windows = parseClaudeWindows({
      five_hour: { utilization: 12 },
      seven_day: { utilization: 91 },
    })
    expect(windows.map((window) => [window.label, window.usedPercent])).toEqual([
      ['5h', 12],
      ['wk', 91],
    ])
  })

  test('parses Codex quota windows and derives labels', () => {
    const windows = parseCodexWindows({
      rate_limit: {
        primary_window: { used_percent: 8, limit_window_seconds: 18_000 },
        secondary_window: { used_percent: 77, limit_window_seconds: 604_800 },
      },
    })
    expect(windows.map((window) => [window.label, window.usedPercent])).toEqual([
      ['5h', 8],
      ['wk', 77],
    ])
  })

  test('clamps invalid percentages', () => {
    expect(normalizePercent(-20)).toBe(0)
    expect(normalizePercent(200)).toBe(100)
    expect(normalizePercent(Number.NaN)).toBe(0)
  })

  test('uses the configured Pi agent directory', () => {
    const original = process.env.PI_CODING_AGENT_DIR
    process.env.PI_CODING_AGENT_DIR = '/tmp/custom-pi-agent'
    expect(authFilePath()).toBe(join('/tmp/custom-pi-agent', 'auth.json'))
    process.env.PI_CODING_AGENT_DIR = '~/custom-pi-agent'
    expect(authFilePath()).toBe(join(homedir(), 'custom-pi-agent', 'auth.json'))
    if (original === undefined) {
      delete process.env.PI_CODING_AGENT_DIR
    } else {
      process.env.PI_CODING_AGENT_DIR = original
    }
  })
})
