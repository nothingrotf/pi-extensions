import { describe, expect, test } from 'vite-plus/test'

import { railPatchForCall } from '../src/rail-tools.ts'

describe('railPatchForCall tense', () => {
  test('a running call reads in the present continuous', () => {
    const patch = railPatchForCall({ arguments: { path: 'a.ts' }, toolName: 'read' }, '')
    expect(patch.runningLabel).toBe('Reading')
  })

  test('a finished call reads in the past', () => {
    const patch = railPatchForCall({ arguments: { path: 'a.ts' }, toolName: 'read' }, '')
    expect(patch.doneLabel).toBe('Read')
  })

  test('every built-in tool distinguishes the two tenses', () => {
    const names = ['read', 'write', 'edit', 'bash', 'grep', 'find', 'ls']
    for (const toolName of names) {
      const patch = railPatchForCall({ arguments: {}, toolName }, '')
      expect(patch.runningLabel).not.toBe(patch.doneLabel)
    }
  })

  test('maps each built-in tool to its pair', () => {
    const pairs: readonly (readonly [string, string, string])[] = [
      ['bash', 'Running', 'Ran'],
      ['edit', 'Editing', 'Edited'],
      ['find', 'Finding', 'Found'],
      ['grep', 'Searching', 'Searched'],
      ['ls', 'Listing', 'Listed'],
      ['read', 'Reading', 'Read'],
      ['write', 'Writing', 'Wrote'],
    ]
    for (const [toolName, running, done] of pairs) {
      const patch = railPatchForCall({ arguments: {}, toolName }, '')
      expect([toolName, patch.runningLabel, patch.doneLabel]).toEqual([toolName, running, done])
    }
  })

  test('an unknown tool keeps one label for both tenses', () => {
    const patch = railPatchForCall({ arguments: {}, toolName: 'custom_thing' }, '')
    expect(patch.runningLabel).toBe(patch.doneLabel)
  })
})
