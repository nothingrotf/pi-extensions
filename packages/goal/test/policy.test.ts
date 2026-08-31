import { describe, expect, test } from 'vite-plus/test'

import { parseGoalCommand } from '../src/policy.ts'

describe('goal command policy', () => {
  test('requires an objective', () => {
    expect(parseGoalCommand('   ')).toEqual({ kind: 'empty' })
  })

  test('removes a leading compact time limit', () => {
    expect(parseGoalCommand('30m publish the package')).toEqual({
      kind: 'objective',
      objective: 'publish the package',
      removedTimeLimit: true,
    })
  })

  test('removes a leading word time limit', () => {
    expect(parseGoalCommand('for 2 hours: finish migration')).toEqual({
      kind: 'objective',
      objective: 'finish migration',
      removedTimeLimit: true,
    })
  })

  test('routes recurring objectives to the loop', () => {
    expect(parseGoalCommand('check CI every 5m')).toEqual({ kind: 'recurring' })
  })

  test('recognizes user controls', () => {
    expect(parseGoalCommand('pause')).toEqual({ kind: 'control', control: 'pause' })
    expect(parseGoalCommand('resume')).toEqual({ kind: 'control', control: 'resume' })
    expect(parseGoalCommand('clear')).toEqual({ kind: 'control', control: 'clear' })
  })
})
