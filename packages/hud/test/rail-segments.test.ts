import { describe, expect, test } from 'vite-plus/test'

import { splitSegments, type RailSegment } from '../src/rail-segments.ts'

const text = (content: string): RailSegment => ({ content, type: 'text' })
const reasoning = (content: string): RailSegment => ({ content, type: 'reasoning' })
const tools = (...toolCallIds: string[]): RailSegment => ({ toolCallIds, type: 'tools' })

describe('splitSegments', () => {
  test('prose without a tool call has no tree', () => {
    expect(splitSegments([text('hello'), text(' world')])).toBeUndefined()
  })

  test('an empty list has no tree', () => {
    expect(splitSegments([])).toBeUndefined()
  })

  test('merges two adjacent text blocks into one', () => {
    const zones = splitSegments([tools('a'), text('one.'), text(' two.'), tools('b')])
    const railText = zones?.railSegs.filter((segment) => segment.type === 'text') ?? []
    expect(railText).toHaveLength(1)
    expect(railText[0]?.type === 'text' ? railText[0].content : '').toBe('one. two.')
  })

  test('a reasoning block keeps two text blocks apart', () => {
    const zones = splitSegments([
      tools('a'),
      text('one.'),
      reasoning('why'),
      text('two.'),
      tools('b'),
    ])
    expect(zones?.railSegs.filter((segment) => segment.type === 'text')).toHaveLength(2)
  })

  test('text after the last tool call is the answer, not narration', () => {
    const zones = splitSegments([tools('a'), text('one.'), reasoning('why'), text('two.')])
    expect(zones?.railSegs.filter((segment) => segment.type === 'text')).toHaveLength(0)
    expect(zones?.finalSegs).toHaveLength(2)
  })

  test('text before the first tool call becomes the opening', () => {
    const zones = splitSegments([text('I will analyze.'), reasoning('plan'), tools('a')])
    expect(zones?.opening).toBe('I will analyze.')
    expect(zones?.railSegs.some((segment) => segment.type === 'text')).toBe(false)
  })

  test('reasoning before the first tool call stays in the tree', () => {
    const zones = splitSegments([text('lead'), reasoning('plan'), tools('a')])
    expect(zones?.railSegs.filter((segment) => segment.type === 'reasoning')).toHaveLength(1)
  })

  test('a partial turn keeps trailing text as narration', () => {
    const zones = splitSegments([tools('a'), text('interim')], { live: false, partial: true })
    expect(zones?.finalSegs).toHaveLength(0)
    expect(zones?.railSegs.filter((segment) => segment.type === 'text')).toHaveLength(1)
  })

  test('a settled turn moves trailing text to the answer', () => {
    const zones = splitSegments([tools('a'), text('answer')], { partial: false })
    expect(zones?.finalSegs).toHaveLength(1)
    expect(zones?.railSegs.filter((segment) => segment.type === 'text')).toHaveLength(0)
  })

  test('a live turn settles even while partial', () => {
    const zones = splitSegments([tools('a'), text('answer')], { live: true, partial: true })
    expect(zones?.finalSegs).toHaveLength(1)
  })

  test('tools and reasoning never leave the tree', () => {
    const zones = splitSegments([tools('a'), reasoning('thinking'), text('answer')])
    expect(zones?.railSegs.filter((segment) => segment.type === 'tools')).toHaveLength(1)
    expect(zones?.railSegs.filter((segment) => segment.type === 'reasoning')).toHaveLength(1)
    expect(zones?.finalSegs).toHaveLength(1)
  })

  test('joins several opening blocks with a blank line', () => {
    const zones = splitSegments([text('a'), reasoning('r'), text('b'), tools('t')])
    expect(zones?.opening).toBe('a\n\nb')
  })
})
