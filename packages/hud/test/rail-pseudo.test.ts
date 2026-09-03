import { describe, expect, test } from 'vite-plus/test'

import { headings, narrationPatch, thinkingHeading, thoughtPatch } from '../src/rail-pseudo.ts'

describe('headings', () => {
  test('finds an atx heading', () => {
    expect(headings('# First\nbody')).toEqual(['First'])
  })

  test('finds a bold line', () => {
    expect(headings('**Plan**\nbody')).toEqual(['Plan'])
  })

  test('finds a setext heading', () => {
    expect(headings('Title\n=====\nbody')).toEqual(['Title'])
  })

  test('finds an html heading', () => {
    expect(headings('<h2>Second</h2>')).toEqual(['Second'])
  })

  test('returns nothing for plain prose', () => {
    expect(headings('just a sentence')).toEqual([])
  })
})

describe('thinkingHeading', () => {
  test('takes the last heading while streaming', () => {
    expect(thinkingHeading('# One\ntext\n# Two', true)).toBe('Two')
  })

  test('takes the first heading once done', () => {
    expect(thinkingHeading('# One\ntext\n# Two', false)).toBe('One')
  })

  test('falls back to the first non empty line', () => {
    expect(thinkingHeading('\n\nweighing the options\nmore', false)).toBe('weighing the options')
  })

  test('caps the detail length', () => {
    expect(thinkingHeading('x'.repeat(200), false).length).toBeLessThanOrEqual(60)
  })
})

describe('thoughtPatch', () => {
  test('marks a streaming thought as pending', () => {
    expect(thoughtPatch('# Plan', true).status).toBe('pending')
  })

  test('marks a settled thought as done', () => {
    expect(thoughtPatch('# Plan', false).status).toBe('ok')
  })

  test('carries the thought kind and icon', () => {
    const patch = thoughtPatch('# Plan')
    expect([patch.kind, patch.iconKey, patch.doneLabel, patch.runningLabel]).toEqual([
      'thought',
      'thought',
      'Thought',
      'Thinking',
    ])
  })

  test('counts the lines in the summary', () => {
    expect(thoughtPatch('one\ntwo\nthree').summary).toBe('3 lines')
  })

  test('leaves the summary empty for a single line', () => {
    expect(thoughtPatch('one').summary).toBe('')
  })

  test('keeps the full text as output', () => {
    expect(thoughtPatch('one\ntwo').output).toBe('one\ntwo')
  })
})

describe('narrationPatch', () => {
  test('shows the first non empty line', () => {
    expect(narrationPatch('\n\nfound it\nmore detail').detail).toBe('found it')
  })

  test('carries the narration kind and icon', () => {
    const patch = narrationPatch('note')
    expect([patch.kind, patch.iconKey, patch.doneLabel]).toEqual(['narration', 'chat', 'Note'])
  })

  test('is always done', () => {
    expect(narrationPatch('note').status).toBe('ok')
  })

  test('caps the detail length', () => {
    expect((narrationPatch('y'.repeat(200)).detail ?? '').length).toBeLessThanOrEqual(60)
  })
})
