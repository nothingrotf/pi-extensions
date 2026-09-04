import { describe, expect, test } from 'vite-plus/test'

import {
  parseBudgetInput,
  parseGoalStartOptions,
  parseGoalSubcommand,
  parseToggle,
} from '../src/commands.ts'

describe('goal command parsing', () => {
  test('returns no subcommand for an empty input', () => {
    expect(parseGoalSubcommand('   ')).toEqual({ sub: undefined, rest: '' })
  })

  test('treats a leading known word as the subcommand', () => {
    expect(parseGoalSubcommand('SET ship the release')).toEqual({
      sub: 'set',
      rest: 'ship the release',
    })
    expect(parseGoalSubcommand('budget 100')).toEqual({ sub: 'budget', rest: '100' })
    expect(parseGoalSubcommand('pause')).toEqual({ sub: 'pause', rest: '' })
  })

  test('keeps unknown leading words in the objective', () => {
    expect(parseGoalSubcommand('publish the package')).toEqual({
      sub: undefined,
      rest: 'publish the package',
    })
  })

  test('keeps multi-line objectives intact', () => {
    expect(parseGoalSubcommand('set line one\nline two')).toEqual({
      sub: 'set',
      rest: 'line one\nline two',
    })
  })

  test('parses start configuration flags', () => {
    expect(
      parseGoalStartOptions(
        'Ship the release --max=8 --review-model=openai/gpt-5 --review-fallback=anthropic/opus --runtime-probe',
      ),
    ).toEqual({
      kind: 'valid',
      objective: 'Ship the release',
      options: {
        maxIterations: 8,
        reviewModel: 'openai/gpt-5',
        reviewFallbackModel: 'anthropic/opus',
        runtimeProbe: true,
      },
    })
    expect(parseGoalStartOptions('Ship --max=0')).toMatchObject({ kind: 'invalid' })
    expect(parseGoalStartOptions('Ship --review-model=broken')).toMatchObject({ kind: 'invalid' })
  })

  test('parses budget inputs and toggles', () => {
    expect(parseBudgetInput(' OFF ')).toEqual({ kind: 'off' })
    expect(parseBudgetInput('250')).toEqual({ kind: 'value', value: 250 })
    expect(parseBudgetInput('0')).toEqual({ kind: 'invalid' })
    expect(parseBudgetInput('-5')).toEqual({ kind: 'invalid' })
    expect(parseBudgetInput('12abc')).toEqual({ kind: 'invalid' })
    expect(parseToggle('ON')).toBe(true)
    expect(parseToggle('off')).toBe(false)
    expect(parseToggle('maybe')).toBeUndefined()
  })
})
