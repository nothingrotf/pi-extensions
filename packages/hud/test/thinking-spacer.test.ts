import { Container, Text } from '@earendil-works/pi-tui'
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

  constructor(lines: string[]) {
    super()
    this.addChild(new Text(lines.join('\n'), 0, 0))
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
