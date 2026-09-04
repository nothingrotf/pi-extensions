import { type Component, Container, Spacer, VStack } from '@earendil-works/pi-tui'
import { describe, expect, test } from 'vite-plus/test'

import { railEntryType } from '../src/rail-entry.ts'
import { placeRailsAfterOpening, placeSpeakerEntries } from '../src/transcript-layout.ts'

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

class RoleEntry implements Component {
  readonly entry: {
    customType: 'hud-role'
    data: { role: 'assistant' | 'user' }
  }

  constructor(role: 'assistant' | 'user') {
    this.entry = { customType: 'hud-role', data: { role } }
  }

  invalidate(): void {}

  render(): string[] {
    return [this.entry.data.role]
  }
}

class UserEntry implements Component {
  outputPad = 1
  readonly text = 'prompt'

  invalidate(): void {}

  render(): string[] {
    return [this.text]
  }

  setOutputPad(value: number): void {
    this.outputPad = value
  }
}

class FinalEntry implements Component {
  invalidate(): void {}

  render(): string[] {
    return ['final']
  }
}

describe('placeSpeakerEntries', () => {
  test('restores each speaker header around its user message', () => {
    const root = new Container()
    const user = new RoleEntry('user')
    const assistant = new RoleEntry('assistant')
    const spacer = new Spacer(1)
    const message = new UserEntry()
    const final = new FinalEntry()
    root.addChild(user)
    root.addChild(assistant)
    root.addChild(spacer)
    root.addChild(message)
    root.addChild(final)

    expect(placeSpeakerEntries(root)).toBe(1)
    expect(root.children).toEqual([user, spacer, message, assistant, final])
  })

  test('does not attach later headers to an unlabeled message', () => {
    const root = new Container()
    const unlabeled = new UserEntry()
    const user = new RoleEntry('user')
    const assistant = new RoleEntry('assistant')
    const spacer = new Spacer(1)
    const labeled = new UserEntry()
    root.addChild(unlabeled)
    root.addChild(user)
    root.addChild(assistant)
    root.addChild(spacer)
    root.addChild(labeled)

    expect(placeSpeakerEntries(root)).toBe(1)
    expect(root.children).toEqual([unlabeled, user, spacer, labeled, assistant])
  })

  test('does not mutate layout containers with parallel metadata', () => {
    const user = new RoleEntry('user')
    const assistant = new RoleEntry('assistant')
    const message = new UserEntry()
    const root = new VStack([user, assistant, message])

    expect(placeSpeakerEntries(root)).toBe(0)
    expect(root.children).toEqual([user, assistant, message])
  })

  test('keeps live speaker entries in place', () => {
    const root = new Container()
    const user = new RoleEntry('user')
    const message = new UserEntry()
    const assistant = new RoleEntry('assistant')
    root.addChild(user)
    root.addChild(message)
    root.addChild(assistant)

    expect(placeSpeakerEntries(root)).toBe(0)
    expect(root.children).toEqual([user, message, assistant])
  })
})

describe('placeRailsAfterOpening', () => {
  test('keeps multiple restored rails at one opening in a stable order', () => {
    const root = new Container()
    const first = new RailEntry(1)
    const second = new RailEntry(2)
    const opening = new AssistantEntry(8)
    root.addChild(first)
    root.addChild(second)
    root.addChild(opening)
    const timestamps = new Map([
      [1, 8],
      [2, 8],
    ])
    placeRailsAfterOpening(root, timestamps)
    const placed = [...root.children]
    expect(placeRailsAfterOpening(root, timestamps)).toBe(0)
    expect(root.children).toEqual(placed)
    expect(root.children).toEqual([opening, first, second])
  })

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
