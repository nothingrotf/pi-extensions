import { Container, type Component } from '@earendil-works/pi-tui'
import { describe, expect, test } from 'vite-plus/test'

import { installNativeStatusFix, sweepNativeStatusIndicators } from '../src/status-indicator.ts'

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

class TuiRoot extends Container {
  renders = 0

  requestRender(): void {
    this.renders += 1
  }
}

class TuiTree extends TuiRoot {
  readonly statusContainer = new Container()

  constructor() {
    super()
    this.addChild(this.statusContainer)
  }
}

describe('native status suppression', () => {
  test('finds a new dock status without scanning the transcript on each frame', () => {
    const tui = new TuiRoot()
    const document = new Container()
    const transcript = new Container()
    const status = new Container()
    document.addChild(transcript)
    tui.addChild(document)
    tui.addChild(status)
    const children = transcript.children
    let reads = 0
    Object.defineProperty(transcript, 'children', {
      get: () => {
        reads += 1
        return children
      },
    })
    installNativeStatusFix(tui)
    for (let index = 0; index < 100; index += 1) tui.requestRender()
    expect(reads).toBe(0)

    status.addChild(new NativeStatus('compaction', 'Compacting context...'))
    tui.requestRender()
    expect(status.render(80)).toEqual([])
    expect(reads).toBe(0)
  })

  test('patches the stable status container before compaction starts', () => {
    const tui = new TuiTree()
    tui.statusContainer.addChild({ invalidate: () => undefined, render: () => ['', ''] })
    installNativeStatusFix(tui)
    tui.clear()

    const compaction = new NativeStatus('compaction', 'Auto-compacting...')
    tui.statusContainer.clear()
    tui.statusContainer.addChild(compaction)
    for (let index = 0; index < 100; index += 1) tui.requestRender()

    expect(tui.renders).toBe(101)
    expect(tui.statusContainer.render(80)).toEqual([])
  })

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
