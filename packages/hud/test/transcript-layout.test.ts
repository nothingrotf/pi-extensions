import { type Component, Container } from '@earendil-works/pi-tui'
import { describe, expect, test } from 'vite-plus/test'

import { railEntryType } from '../src/rail-entry.ts'
import { placeRailsAfterOpening } from '../src/transcript-layout.ts'

class RailEntry implements Component {
  readonly entry: { customType: string; data: { turn: number } }

  constructor(turn: number) {
    this.entry = { customType: railEntryType, data: { turn } }
  }

  invalidate(): void {}

  render(): string[] {
    return ['rail']
  }
}

class AssistantEntry implements Component {
  readonly lastMessage: { timestamp: number }

  constructor(timestamp: number) {
    this.lastMessage = { timestamp }
  }

  invalidate(): void {}

  render(): string[] {
    return ['assistant']
  }
}

class FinalEntry implements Component {
  invalidate(): void {}

  render(): string[] {
    return ['final']
  }
}

describe('placeRailsAfterOpening', () => {
  test('moves a rail directly after its opening assistant message', () => {
    const root = new Container()
    const transcript = new Container()
    const rail = new RailEntry(3)
    const opening = new AssistantEntry(17)
    const final = new FinalEntry()
    transcript.addChild(rail)
    transcript.addChild(opening)
    transcript.addChild(final)
    root.addChild(transcript)

    expect(placeRailsAfterOpening(root, new Map([[3, 17]]))).toBe(1)
    expect(transcript.children).toEqual([opening, rail, final])
  })

  test('leaves the rail in place without an opening timestamp', () => {
    const root = new Container()
    const rail = new RailEntry(1)
    const assistant = new AssistantEntry(8)
    root.addChild(rail)
    root.addChild(assistant)

    expect(placeRailsAfterOpening(root, new Map())).toBe(0)
    expect(root.children).toEqual([rail, assistant])
  })

  test('moves a restored rail back before the final response', () => {
    const root = new Container()
    const opening = new AssistantEntry(8)
    const final = new AssistantEntry(9)
    const rail = new RailEntry(1)
    root.addChild(opening)
    root.addChild(final)
    root.addChild(rail)

    expect(placeRailsAfterOpening(root, new Map([[1, 8]]))).toBe(1)
    expect(root.children).toEqual([opening, rail, final])
  })
})
