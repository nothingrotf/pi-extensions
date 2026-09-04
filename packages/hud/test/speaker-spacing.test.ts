import {
  Box,
  Container,
  Spacer,
  stripTerminalSequences,
  Text,
  type Component,
} from '@earendil-works/pi-tui'
import { describe, expect, test } from 'vite-plus/test'

import { sweepSpeakerSpacing } from '../src/speaker-spacing.ts'

const osc = String.fromCharCode(27)
const bell = String.fromCharCode(7)
const osc133ZoneStart = `${osc}]133;A${bell}`
const osc133ZoneEnd = `${osc}]133;B${bell}`
const osc133ZoneFinal = `${osc}]133;C${bell}`
const framedAssistant = [
  `${osc133ZoneStart}${osc133ZoneEnd}${osc133ZoneFinal}    answer${' '.repeat(30)}`,
]
const framedAssistantWithGap = [
  `${osc133ZoneStart}${' '.repeat(40)}`,
  `${osc133ZoneEnd}${osc133ZoneFinal}    answer${' '.repeat(30)}`,
]

class RoleEntryFixture implements Component {
  readonly entry: {
    customType: 'hud-role'
    data: { role: 'assistant' | 'user' }
  }

  constructor(role: 'assistant' | 'user') {
    this.entry = { customType: 'hud-role', data: { role } }
  }

  invalidate(): void {}

  render(_width: number): string[] {
    return ['header']
  }
}

class RailEntryFixture implements Component {
  readonly entry = { customType: 'hud-rail' }

  invalidate(): void {}

  render(_width: number): string[] {
    return ['', 'rail']
  }
}

class UsageEntryFixture implements Component {
  readonly entry = { customType: 'timestamp-pi' }

  invalidate(): void {}

  render(_width: number): string[] {
    return ['', 'usage']
  }
}

class UserMessageFixture implements Component {
  outputPad = 3
  readonly children: Component[]
  readonly text: string

  constructor(text = 'prompt') {
    this.text = text
    const box = new Box(0, 1)
    box.addChild(new Text(text, 0, 0))
    this.children = [box]
  }

  invalidate(): void {
    for (const child of this.children) child.invalidate?.()
  }

  setOutputPad(padding: number): void {
    this.outputPad = padding
  }

  render(width: number): string[] {
    const lines = this.children.flatMap((child) => child.render(width))
    if (lines.length === 0) return lines
    lines[0] = `${osc133ZoneStart}${lines[0] ?? ''}`
    const last = lines.length - 1
    lines[last] = `${osc133ZoneEnd}${osc133ZoneFinal}${lines[last] ?? ''}`
    return lines
  }
}

class AssistantMessageFixture implements Component {
  readonly contentContainer = {}
  readonly hideThinkingBlock = true
  outputPad = 1

  invalidate(): void {}

  setOutputPad(padding: number): void {
    this.outputPad = padding
  }

  render(_width: number): string[] {
    return [osc133ZoneStart, '', `${osc133ZoneEnd}${osc133ZoneFinal}answer`]
  }
}

class EmptyAssistantMessageFixture extends AssistantMessageFixture {
  override render(_width: number): string[] {
    return [osc133ZoneStart, '', `${osc133ZoneEnd}${osc133ZoneFinal}`]
  }
}

function compact(lines: readonly string[]): string[] {
  return lines.map((line) => stripTerminalSequences(line).trimEnd())
}

function fixture(): {
  assistant: AssistantMessageFixture
  assistantRole: RoleEntryFixture
  root: Container
  spacer: Spacer
  user: UserMessageFixture
  userRole: RoleEntryFixture
} {
  const root = new Container()
  const userRole = new RoleEntryFixture('user')
  root.addChild(userRole)
  const spacer = new Spacer(1)
  root.addChild(spacer)
  const user = new UserMessageFixture()
  root.addChild(user)
  const assistantRole = new RoleEntryFixture('assistant')
  root.addChild(assistantRole)
  const assistant = new AssistantMessageFixture()
  root.addChild(assistant)
  return { assistant, assistantRole, root, spacer, user, userRole }
}

describe('speaker spacing', () => {
  test('joins the user header directly to its body', () => {
    const { root, spacer, user } = fixture()
    sweepSpeakerSpacing(root, () => true)
    expect(spacer.render(40)).toEqual([])
    expect(compact(user.render(40))).toEqual(['    prompt'])
  })

  test('reserves wide edit and copy controls for user text', () => {
    const root = new Container()
    root.addChild(new RoleEntryFixture('user'))
    const user = new UserMessageFixture(
      'Read packages/hud/package.json and packages/hud/README.md as two separate read tool calls, then reply DONE. Do not modify files.',
    )
    root.addChild(user)
    root.addChild(new RoleEntryFixture('assistant'))
    sweepSpeakerSpacing(root, () => true)
    expect(compact(user.render(120))).toEqual([
      '       Read packages/hud/package.json and packages/hud/README.md as two separate read tool calls,',
      '       then reply DONE. Do not modify files.',
    ])
  })

  test('preserves user and assistant terminal zones', () => {
    const { assistant, root, user } = fixture()
    sweepSpeakerSpacing(root, () => true)
    const userLine = user.render(40)[0] ?? ''
    expect(userLine.startsWith(`${osc133ZoneStart}${osc133ZoneEnd}${osc133ZoneFinal}`)).toBe(true)
    expect(stripTerminalSequences(userLine).trim()).toBe('prompt')
    expect(assistant.render(40)).toEqual(framedAssistant)
  })

  test('removes the wrapper gap before a rail without opening prose', () => {
    const root = new Container()
    root.addChild(new RoleEntryFixture('assistant'))
    const rail = new RailEntryFixture()
    root.addChild(rail)
    sweepSpeakerSpacing(root, () => true)
    expect(rail.render(40)).toEqual(['rail'])
  })

  test('keeps the wrapper gap after opening prose', () => {
    const root = new Container()
    root.addChild(new RoleEntryFixture('assistant'))
    root.addChild(new AssistantMessageFixture())
    const rail = new RailEntryFixture()
    root.addChild(rail)
    sweepSpeakerSpacing(root, () => true)
    expect(rail.render(40)).toEqual(['', 'rail'])
  })

  test('keeps one gap before an answer that follows a rail', () => {
    const root = new Container()
    root.addChild(new RoleEntryFixture('assistant'))
    root.addChild(new RailEntryFixture())
    const assistant = new AssistantMessageFixture()
    root.addChild(assistant)
    sweepSpeakerSpacing(root, () => true)
    expect(assistant.render(40)).toEqual(framedAssistantWithGap)
  })

  test('removes empty assistant components between a rail and answer', () => {
    const root = new Container()
    root.addChild(new RoleEntryFixture('assistant'))
    root.addChild(new RailEntryFixture())
    const empty = new EmptyAssistantMessageFixture()
    root.addChild(empty)
    const assistant = new AssistantMessageFixture()
    root.addChild(assistant)
    sweepSpeakerSpacing(root, () => true)
    expect(empty.render(40)).toEqual([])
    expect(assistant.render(40)).toEqual(framedAssistantWithGap)
  })

  test('restores native spacing when headers are disabled', () => {
    let active = true
    const { assistant, root, spacer, user } = fixture()
    sweepSpeakerSpacing(root, () => active)
    expect(compact(user.render(40))).toEqual(['    prompt'])
    active = false
    expect(spacer.render(40)).toEqual([''])
    expect(compact(user.render(40))).toEqual(['', 'prompt', ''])
    expect(assistant.render(40)).toEqual([
      osc133ZoneStart,
      '',
      `${osc133ZoneEnd}${osc133ZoneFinal}answer`,
    ])
  })

  test('keeps messages without matching headers unchanged', () => {
    const root = new Container()
    const spacer = new Spacer(1)
    const user = new UserMessageFixture()
    const assistant = new AssistantMessageFixture()
    root.addChild(spacer)
    root.addChild(user)
    root.addChild(assistant)
    sweepSpeakerSpacing(root, () => true)
    expect(spacer.render(40)).toEqual([''])
    expect(compact(user.render(40))).toEqual(['', 'prompt', ''])
    expect(assistant.render(40)).toEqual([
      osc133ZoneStart,
      '',
      `${osc133ZoneEnd}${osc133ZoneFinal}answer`,
    ])
  })

  test('hides complete role entries when headers are disabled', () => {
    let active = true
    const { assistantRole, root, userRole } = fixture()
    sweepSpeakerSpacing(root, () => active)
    expect(userRole.render(40)).toEqual(['header'])
    expect(assistantRole.render(40)).toEqual(['header'])
    active = false
    expect(userRole.render(40)).toEqual([])
    expect(assistantRole.render(40)).toEqual([])
  })

  test('hides complete usage entries when headers are disabled', () => {
    let active = true
    const root = new Container()
    const usage = new UsageEntryFixture()
    root.addChild(usage)
    sweepSpeakerSpacing(root, () => active)
    expect(usage.render(40)).toEqual(['', 'usage'])
    active = false
    expect(usage.render(40)).toEqual([])
  })

  test('frames every assistant message in one turn', () => {
    const { assistant, root } = fixture()
    const later = new AssistantMessageFixture()
    root.addChild(later)
    sweepSpeakerSpacing(root, () => true)
    expect(assistant.render(40)).toEqual(framedAssistant)
    expect(later.render(40)).toEqual(framedAssistant)
  })

  test('patches each component once', () => {
    const { assistant, root, spacer, user } = fixture()
    sweepSpeakerSpacing(root, () => true)
    sweepSpeakerSpacing(root, () => true)
    expect(spacer.render(40)).toEqual([])
    expect(compact(user.render(40))).toEqual(['    prompt'])
    expect(assistant.render(40)).toEqual(framedAssistant)
  })
})
