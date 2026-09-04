import { Container, type Component } from '@earendil-works/pi-tui'
import { describe, expect, test } from 'vite-plus/test'

import { sweepNativeStatusIndicators } from '../src/status-indicator.ts'

class NativeStatus implements Component {
  constructor(
    readonly kind: 'branchSummary' | 'compaction' | 'retry' | 'working',
    private readonly text: string,
  ) {}

  invalidate(): void {}

  render(): string[] {
    return [this.text]
  }
}

function tree() {
  const root = new Container()
  const status = new Container()
  root.addChild(status)
  return { root, status }
}

describe('native status suppression', () => {
  test('removes the compaction row without removing its component', () => {
    const { root, status } = tree()
    const compaction = new NativeStatus('compaction', 'Auto-compacting...')
    status.addChild(compaction)

    expect(sweepNativeStatusIndicators(root)).toBe(1)
    expect(status.children).toEqual([compaction])
    expect(status.render(80)).toEqual([])
  })

  test('keeps a compaction retry hidden until the status clears', () => {
    const { root, status } = tree()
    status.addChild(new NativeStatus('compaction', 'Compacting context...'))
    sweepNativeStatusIndicators(root)
    expect(status.render(80)).toEqual([])

    status.clear()
    status.addChild(new NativeStatus('retry', 'Retrying compaction...'))
    expect(status.render(80)).toEqual([])

    status.clear()
    expect(status.render(80)).toEqual([])
    status.addChild(new NativeStatus('retry', 'Retrying request...'))
    expect(status.render(80)).toEqual(['Retrying request...'])
  })

  test('preserves working and branch summary rows', () => {
    const { root, status } = tree()
    status.addChild(new NativeStatus('working', 'Working...'))
    expect(sweepNativeStatusIndicators(root)).toBe(0)
    expect(status.render(80)).toEqual(['Working...'])

    status.clear()
    status.addChild(new NativeStatus('branchSummary', 'Summarizing branch...'))
    expect(status.render(80)).toEqual(['Summarizing branch...'])
  })

  test('restores the native compaction row when suppression stops', () => {
    const { root, status } = tree()
    let enabled = true
    status.addChild(new NativeStatus('compaction', 'Compacting context...'))
    sweepNativeStatusIndicators(root, () => enabled)
    expect(status.render(80)).toEqual([])

    enabled = false
    expect(status.render(80)).toEqual(['Compacting context...'])
  })
})
