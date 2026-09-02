import { describe, expect, test } from 'vite-plus/test'

import { parseBudgetInput, parseGoalSubcommand } from '../src/commands.ts'

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

  test('parses budget inputs', () => {
    expect(parseBudgetInput(' OFF ')).toEqual({ kind: 'off' })
    expect(parseBudgetInput('250')).toEqual({ kind: 'value', value: 250 })
    expect(parseBudgetInput('0')).toEqual({ kind: 'invalid' })
    expect(parseBudgetInput('-5')).toEqual({ kind: 'invalid' })
    expect(parseBudgetInput('12abc')).toEqual({ kind: 'invalid' })
  })
})
