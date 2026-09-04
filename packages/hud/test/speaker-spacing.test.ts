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

class UsageEntryFixture implements Component {
  readonly entry = { customType: 'timestamp-pi' }

  invalidate(): void {}

  render(_width: number): string[] {
    return ['', 'usage']
  }
}

class UserMessageFixture implements Component {
  readonly outputPad = 3
  readonly text = 'prompt'
  readonly children: Component[]

  constructor() {
    const box = new Box(0, 1)
    box.addChild(new Text('prompt', 0, 0))
    this.children = [box]
  }

  invalidate(): void {
    for (const child of this.children) child.invalidate?.()
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

  invalidate(): void {}

  render(_width: number): string[] {
    return [osc133ZoneStart, '', `${osc133ZoneEnd}${osc133ZoneFinal}answer`]
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
    expect(compact(user.render(40))).toEqual(['prompt'])
  })

  test('preserves user and assistant terminal zones', () => {
    const { assistant, root, user } = fixture()
    sweepSpeakerSpacing(root, () => true)
    const userLine = user.render(40)[0] ?? ''
    expect(userLine.startsWith(osc133ZoneStart)).toBe(true)
    expect(userLine.endsWith(`${osc133ZoneEnd}${osc133ZoneFinal}`)).toBe(true)
    expect(stripTerminalSequences(userLine).trim()).toBe('prompt')
    expect(assistant.render(40)).toEqual([
      `${osc133ZoneStart}${osc133ZoneEnd}${osc133ZoneFinal}answer`,
    ])
  })

  test('restores native spacing when headers are disabled', () => {
    let active = true
    const { assistant, root, spacer, user } = fixture()
    sweepSpeakerSpacing(root, () => active)
    expect(compact(user.render(40))).toEqual(['prompt'])
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

  test('keeps later assistant messages unchanged', () => {
    const { assistant, root } = fixture()
    const later = new AssistantMessageFixture()
    root.addChild(later)
    sweepSpeakerSpacing(root, () => true)
    expect(assistant.render(40)).toEqual([
      `${osc133ZoneStart}${osc133ZoneEnd}${osc133ZoneFinal}answer`,
    ])
    expect(later.render(40)).toEqual([
      osc133ZoneStart,
      '',
      `${osc133ZoneEnd}${osc133ZoneFinal}answer`,
    ])
  })

  test('patches each component once', () => {
    const { assistant, root, spacer, user } = fixture()
    sweepSpeakerSpacing(root, () => true)
    sweepSpeakerSpacing(root, () => true)
    expect(spacer.render(40)).toEqual([])
    expect(compact(user.render(40))).toEqual(['prompt'])
    expect(assistant.render(40)).toEqual([
      `${osc133ZoneStart}${osc133ZoneEnd}${osc133ZoneFinal}answer`,
    ])
  })
})
