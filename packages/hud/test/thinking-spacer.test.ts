import { type Component, Container, Text } from '@earendil-works/pi-tui'
import { describe, expect, test } from 'vite-plus/test'

import {
  collapseLeadingBlank,
  isBlankLine,
  sweepAssistantMessages,
} from '../src/thinking-spacer.ts'

function trimmed(lines: readonly string[]): string[] {
  return lines.map((line) => line.trimEnd())
}

class FakeAssistant extends Container {
  contentContainer = new Container()
  hideThinkingBlock = false
  lastMessage: { timestamp: number } | undefined

  constructor(lines: string[], timestamp?: number) {
    super()
    this.lastMessage = timestamp === undefined ? undefined : { timestamp }
    this.addChild(new Text(lines.join('\n'), 0, 0))
  }
}

type MessageBlock = { text?: string; type: string }
type TestMessage = { content: MessageBlock[]; timestamp: number }

class UpdatingAssistant implements Component {
  contentContainer = {}
  hideThinkingBlock = false
  isStreaming = true
  lastMessage: TestMessage

  constructor(message: TestMessage) {
    this.lastMessage = message
  }

  invalidate(): void {}

  render(): string[] {
    return this.lastMessage.content.flatMap((block) =>
      block.type === 'text' && block.text !== undefined ? [block.text] : [],
    )
  }

  updateContent(message: TestMessage, isStreaming = this.isStreaming): void {
    this.lastMessage = message
    this.isStreaming = isStreaming
  }
}

describe('isBlankLine', () => {
  test('treats whitespace and escape-only lines as blank', () => {
    expect(isBlankLine('')).toBe(true)
    expect(isBlankLine('   ')).toBe(true)
    expect(isBlankLine('\x1b[38;2;1;2;3m\x1b[39m')).toBe(true)
  })

  test('keeps visible text', () => {
    expect(isBlankLine('\x1b[1m x \x1b[0m')).toBe(false)
  })
})

describe('collapseLeadingBlank', () => {
  test('drops the second of two leading blank lines', () => {
    expect(collapseLeadingBlank(['', '', 'body'])).toEqual(['', 'body'])
  })

  test('keeps a single leading blank line', () => {
    expect(collapseLeadingBlank(['', 'body'])).toEqual(['', 'body'])
  })

  test('leaves blank lines inside the body alone', () => {
    expect(collapseLeadingBlank(['', 'a', '', 'b'])).toEqual(['', 'a', '', 'b'])
  })

  test('drops output that is entirely blank', () => {
    expect(collapseLeadingBlank([''])).toEqual([])
    expect(collapseLeadingBlank(['', '  ', '\x1b[39m'])).toEqual([])
    expect(collapseLeadingBlank([])).toEqual([])
  })
})

describe('sweepAssistantMessages', () => {
  test('patches assistant messages found anywhere in the tree', () => {
    const root = new Container()
    const middle = new Container()
    const assistant = new FakeAssistant(['', '', 'text'])
    middle.addChild(assistant)
    root.addChild(middle)
    sweepAssistantMessages(root, () => true)
    expect(trimmed(assistant.render(80))).toEqual(['', 'text'])
  })

  test('does nothing when the fix is inactive', () => {
    const root = new Container()
    const assistant = new FakeAssistant(['', '', 'text'])
    root.addChild(assistant)
    sweepAssistantMessages(root, () => false)
    expect(trimmed(assistant.render(80))).toEqual(['', '', 'text'])
  })

  test('honours a live toggle after patching', () => {
    let active = true
    const root = new Container()
    const assistant = new FakeAssistant(['', '', 'text'])
    root.addChild(assistant)
    sweepAssistantMessages(root, () => active)
    expect(trimmed(assistant.render(80))).toEqual(['', 'text'])
    active = false
    expect(trimmed(assistant.render(80))).toEqual(['', '', 'text'])
  })

  test('hides a thinking-only message when the label is empty', () => {
    const root = new Container()
    const assistant = new FakeAssistant([''])
    root.addChild(assistant)
    sweepAssistantMessages(root, () => true)
    expect(assistant.render(80)).toEqual([])
  })

  test('hides an assistant message classified as narration', () => {
    let hidden = true
    const root = new Container()
    const assistant = new FakeAssistant(['', 'intermediate text', ''], 7)
    root.addChild(assistant)
    sweepAssistantMessages(
      root,
      () => true,
      (timestamp) => timestamp !== 7 || !hidden,
    )
    expect(assistant.render(80)).toEqual([])
    hidden = false
    expect(trimmed(assistant.render(80))).toEqual(['', 'intermediate text', ''])
  })

  test('hides only the selected text block inside a mixed message', () => {
    const root = new Container()
    const assistant = new UpdatingAssistant({
      content: [
        { text: 'Opening', type: 'text' },
        { type: 'toolCall' },
        { text: 'Middle', type: 'text' },
        { type: 'toolCall' },
        { text: 'Answer', type: 'text' },
      ],
      timestamp: 7,
    })
    let hideMiddle = true
    root.addChild(assistant)
    sweepAssistantMessages(
      root,
      () => true,
      (timestamp, contentIndex) => timestamp !== 7 || contentIndex !== 2 || !hideMiddle,
    )
    expect(assistant.render()).toEqual(['Opening', 'Answer'])
    hideMiddle = false
    expect(assistant.render()).toEqual(['Opening', 'Middle', 'Answer'])
  })

  test('ignores components that do not look like assistant messages', () => {
    const root = new Container()
    const plain = new Text('\n\nx', 0, 0)
    root.addChild(plain)
    sweepAssistantMessages(root, () => true)
    expect(trimmed(plain.render(80))).toEqual(['', '', 'x'])
  })

  test('patches each instance only once', () => {
    const root = new Container()
    const assistant = new FakeAssistant(['', '', 'text'])
    root.addChild(assistant)
    sweepAssistantMessages(root, () => true)
    sweepAssistantMessages(root, () => true)
    expect(trimmed(assistant.render(80))).toEqual(['', 'text'])
  })
})
