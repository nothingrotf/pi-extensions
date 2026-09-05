import { describe, expect, it } from 'vite-plus/test'

import { invalidRelationships } from '../src/relationships.ts'

describe('relationship isolation', () => {
  it('isolates self cycles and all dependent descendants regardless of ordering', () => {
    const records = [
      { id: 'grandchild', parentId: 'child' },
      { id: 'child', parentId: 'cycle' },
      { id: 'cycle', parentId: 'cycle' },
      { id: 'healthy', parentId: null },
      { id: 'orphan', parentId: 'missing' },
    ]
    expect(invalidRelationships(records)).toEqual(new Set(['cycle', 'child', 'grandchild']))
    expect(invalidRelationships([...records].reverse())).toEqual(
      new Set(['cycle', 'child', 'grandchild']),
    )
  })

  it('quarantines duplicate identifiers and descendants without rejecting healthy roots', () => {
    expect(
      invalidRelationships([
        { id: 'duplicate', parentId: null },
        { id: 'duplicate', parentId: null },
        { id: 'child', parentId: 'duplicate' },
        { id: 'healthy', parentId: null },
      ]),
    ).toEqual(new Set(['duplicate', 'child']))
  })

  it('walks deep ancestry without recursive stack growth', () => {
    const records = Array.from({ length: 20000 }, (_, index) => ({
      id: `${index}`,
      parentId: index === 0 ? null : `${index - 1}`,
    })).reverse()
    expect(invalidRelationships(records).size).toBe(0)
  })
})
