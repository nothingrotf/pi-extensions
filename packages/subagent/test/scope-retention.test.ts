import { describe, expect, it } from 'vite-plus/test'

import { DescendantScope } from '../src/workspace.ts'

describe('descendant scope retention', () => {
  it('keeps readiness without retaining completed output payloads', async () => {
    const scope = new DescendantScope('memory-probe')
    for (let index = 0; index < 1000; index += 1) {
      scope.register(`child-${index}`, Promise.resolve({ output: `Result ${index}`.repeat(10000) }))
    }
    const results = await Promise.all(scope.list().map((entry) => entry.completion))
    expect(results.every((value) => value === undefined)).toBe(true)
    expect(scope.list()).toHaveLength(1000)
    scope.markClosing()
    scope.markClosed()
    expect(scope.list()).toHaveLength(0)
    expect(() => scope.register('late', Promise.resolve())).toThrow('closure started')
  })
})
