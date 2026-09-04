import { Container, Text } from '@earendil-works/pi-tui'
import { describe, expect, test } from 'vite-plus/test'

import { observeTranscript } from '../src/transcript-observer.ts'

class RenderTree extends Container {
  requests = 0

  requestRender(): void {
    this.requests += 1
  }
}

describe('transcript observer', () => {
  test('coalesces invalidations and stops inspecting an unchanged transcript', async () => {
    const tui = new RenderTree()
    const document = new Container()
    const transcript = new Container()
    document.addChild(transcript)
    tui.addChild(document)
    for (let index = 0; index < 1_000; index += 1) {
      transcript.addChild(new Text('history', 0, 0))
    }
    let sweeps = 0
    const subscription = observeTranscript(tui, 10, () => {
      sweeps += 1
    })
    for (let index = 0; index < 100; index += 1) subscription.markDirty()
    await Promise.resolve()
    expect(tui.requests).toBe(1)
    expect(sweeps).toBe(1)
    for (let index = 0; index < 100; index += 1) tui.requestRender()
    expect(sweeps).toBe(1)

    transcript.addChild(new Text('live', 0, 0))
    tui.requestRender()
    expect(sweeps).toBe(2)
    subscription.dispose()
  })

  test('finds messages mounted after the initial session render', async () => {
    const tui = new RenderTree()
    const document = new Container()
    tui.addChild(document)
    let sweeps = 0
    const subscription = observeTranscript(tui, 10, () => {
      sweeps += 1
    })
    await Promise.resolve()
    const transcript = new Container()
    document.addChild(transcript)
    tui.requestRender()
    transcript.addChild(new Text('restored', 0, 0))
    tui.requestRender()
    expect(sweeps).toBe(3)
    subscription.dispose()
  })

  test('detects session replacement with the same number of messages', () => {
    const tui = new RenderTree()
    const transcript = new Container()
    tui.addChild(transcript)
    transcript.addChild(new Text('old', 0, 0))
    let sweeps = 0
    const subscription = observeTranscript(tui, 10, () => {
      sweeps += 1
    })
    tui.requestRender()
    transcript.clear()
    transcript.addChild(new Text('new', 0, 0))
    tui.requestRender()
    expect(sweeps).toBe(2)
    subscription.dispose()
  })

  test('orders layout before message patches and releases disposed callbacks', async () => {
    const tui = new RenderTree()
    const calls: string[] = []
    const spacing = observeTranscript(tui, 30, () => calls.push('spacing'))
    const layout = observeTranscript(tui, 10, () => calls.push('layout'))
    const thinking = observeTranscript(tui, 20, () => calls.push('thinking'))
    await Promise.resolve()
    expect(calls).toEqual(['layout', 'thinking', 'spacing'])
    spacing.markDirty()
    spacing.dispose()
    layout.dispose()
    thinking.dispose()
    const requests = tui.requests
    await Promise.resolve()
    expect(tui.requests).toBe(requests)
    expect(calls).toHaveLength(3)
    const next = observeTranscript(tui, 10, () => calls.push('next session'))
    await Promise.resolve()
    expect(calls.at(-1)).toBe('next session')
    next.dispose()
  })
})
