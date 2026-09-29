import { homedir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, test } from 'vite-plus/test'

import {
  authFilePath,
  normalizePercent,
  parseClaudeWindows,
  parseCodexWindows,
  parseRateLimitEvent,
  parseRateLimitHeaders,
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

  test('parses Codex rate-limit headers from OpenAI responses', () => {
    const windows = parseRateLimitHeaders({
      'x-codex-primary-used-percent': '12.5',
      'x-codex-primary-window-minutes': '300',
      'x-codex-primary-reset-at': '1790000000',
      'x-codex-secondary-used-percent': '42',
      'x-codex-secondary-window-minutes': '10080',
      'x-codex-other-primary-used-percent': '99',
    })
    expect(windows.map((window) => [window.label, window.usedPercent])).toEqual([
      ['5h', 12.5],
      ['wk', 42],
    ])
    expect(windows[0]?.resetsIn).toBeDefined()
    expect(parseRateLimitHeaders({ 'x-codex-primary-used-percent': 'full' })).toEqual([])
    expect(parseRateLimitHeaders({ 'x-ratelimit-remaining-requests': '10' })).toEqual([])
  })

  test('parses Codex rate-limit stream events and ignores other events', () => {
    const event = {
      type: 'provider_stream_event' as const,
      provider: 'openai',
      api: 'openai-responses',
      model: 'gpt-6.1-sol',
    }
    const windows = parseRateLimitEvent({
      ...event,
      data: {
        type: 'codex.rate_limits',
        rate_limits: {
          primary: { used_percent: 20, window_minutes: 300, reset_at: 1_790_000_000 },
          secondary: { used_percent: 50, window_minutes: 10_080 },
        },
      },
    })
    expect(windows.map((window) => [window.label, window.usedPercent])).toEqual([
      ['5h', 20],
      ['wk', 50],
    ])
    expect(
      parseRateLimitEvent({
        ...event,
        data: {
          type: 'codex.rate_limits',
          metered_limit_name: 'codex_other',
          rate_limits: { primary: { used_percent: 90, window_minutes: 300 } },
        },
      }),
    ).toEqual([])
    expect(parseRateLimitEvent({ ...event, data: { type: 'response.completed' } })).toEqual([])
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
