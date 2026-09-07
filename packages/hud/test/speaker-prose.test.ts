import {
  AssistantMessageComponent,
  initTheme,
  UserMessageComponent,
} from '@earendil-works/pi-coding-agent'
import { Container, setCapabilities, stripTerminalSequences } from '@earendil-works/pi-tui'
import { afterEach, beforeAll, describe, expect, test } from 'vite-plus/test'

import { ansiForeground, hudBrandAlt, hudInfo, hudTextPrimary } from '../src/colors.ts'
import type { FileCandidate } from '../src/prose-links.ts'
import { type ProseSources, sweepSpeakerSpacing } from '../src/speaker-spacing.ts'

const link = 'https://example.com/docs'
const osc8 = (url: string) => `\x1b]8;;${url}\x1b\\`

class RoleEntryFixture extends Container {
  readonly entry: { customType: 'hud-role'; data: { role: 'assistant' | 'user' } }

  constructor(role: 'assistant' | 'user') {
    super()
    this.entry = { customType: 'hud-role', data: { role } }
  }
}

function prose(streaming = false): ProseSources {
  return {
    cwd: () => '/repo',
    resolve: (candidate: FileCandidate) =>
      candidate.path === 'src/index.ts' ? candidate.path : undefined,
    revision: () => 1,
    streaming: () => streaming,
  }
}

function plain(lines: readonly string[]): string[] {
  return lines.map((line) => stripTerminalSequences(line).trimEnd()).filter((line) => line !== '')
}

function assistantMessage(text: string) {
  return new AssistantMessageComponent({
    api: 'anthropic-messages',
    content: [{ text, type: 'text' }],
    model: 'test',
    provider: 'test',
    role: 'assistant',
    stopReason: 'stop',
    timestamp: 0,
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
      input: 0,
      output: 0,
      totalTokens: 0,
    },
  })
}

beforeAll(() => {
  initTheme('dark')
})

afterEach(() => {
  setCapabilities({ hyperlinks: true, images: null, trueColor: true })
})

describe('speaker prose adoption', () => {
  test('renders assistant links with the label color and visible destination', () => {
    setCapabilities({ hyperlinks: true, images: null, trueColor: true })
    const root = new Container()
    root.addChild(new RoleEntryFixture('assistant'))
    const assistant = assistantMessage(`See [Docs](${link}) and src/index.ts.`)
    root.addChild(assistant)
    sweepSpeakerSpacing(
      root,
      () => true,
      () => true,
      prose(),
    )
    const lines = assistant.render(90)
    expect(plain(lines)).toEqual([`   See Docs (${link}) and src/index.ts.`])
    const line = lines.find((entry) => entry.includes('Docs')) ?? ''
    expect(line).toContain(`${osc8(link)}${ansiForeground(hudBrandAlt)}Docs\x1b[0m`)
    expect(line).not.toContain(`${ansiForeground(hudBrandAlt)}${ansiForeground(hudTextPrimary)}`)
    expect(line).toContain(
      `${osc8('file:///repo/src/index.ts')}${ansiForeground(hudBrandAlt)}src/index.ts`,
    )
  })

  test('keeps the user message literal with anchors', () => {
    setCapabilities({ hyperlinks: true, images: null, trueColor: true })
    const root = new Container()
    root.addChild(new RoleEntryFixture('user'))
    const user = new UserMessageComponent(`Read **src/index.ts** at ${link}`)
    root.addChild(user)
    sweepSpeakerSpacing(
      root,
      () => true,
      () => true,
      prose(),
    )
    const lines = user.render(120)
    expect(plain(lines)).toEqual([`   Read **src/index.ts** at ${link}`])
    const line = lines[0] ?? ''
    expect(line).toContain(
      `${osc8('file:///repo/src/index.ts')}\x1b[4m${ansiForeground(hudInfo)}src/index.ts`,
    )
    expect(line).toContain(`${osc8(link)}\x1b[4m${ansiForeground(hudInfo)}${link}`)
    expect(line).not.toContain('\x1b[48;')
  })

  test('re-adopts prose after the native component rebuilds', () => {
    const root = new Container()
    root.addChild(new RoleEntryFixture('assistant'))
    const assistant = assistantMessage('# First')
    root.addChild(assistant)
    sweepSpeakerSpacing(
      root,
      () => true,
      () => true,
      prose(),
    )
    expect(plain(assistant.render(40))).toEqual(['   First'])
    assistant.invalidate()
    expect(plain(assistant.render(40))).toEqual(['   First'])
  })

  test('leaves thinking markdown and native error text untouched', () => {
    const root = new Container()
    root.addChild(new RoleEntryFixture('assistant'))
    const assistant = new AssistantMessageComponent(
      {
        api: 'anthropic-messages',
        content: [
          { thinking: 'plan', type: 'thinking' },
          { text: 'done', type: 'text' },
        ],
        errorMessage: 'boom',
        model: 'test',
        provider: 'test',
        role: 'assistant',
        stopReason: 'error',
        timestamp: 0,
        usage: {
          cacheRead: 0,
          cacheWrite: 0,
          cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
          input: 0,
          output: 0,
          totalTokens: 0,
        },
      },
      false,
    )
    root.addChild(assistant)
    sweepSpeakerSpacing(
      root,
      () => true,
      () => true,
      prose(),
    )
    const lines = plain(assistant.render(40))
    expect(lines).toEqual(['   plan', '   done', '   Error: boom'])
    const thinking = assistant.render(40).find((line) => line.includes('plan')) ?? ''
    expect(thinking).not.toContain(ansiForeground(hudTextPrimary))
    expect(assistant.render(40).some((line) => line.includes('Error: boom'))).toBe(true)
  })

  test('restores native rendering when headers are disabled', () => {
    let active = true
    const root = new Container()
    root.addChild(new RoleEntryFixture('assistant'))
    const assistant = assistantMessage(`[Docs](${link})`)
    root.addChild(assistant)
    sweepSpeakerSpacing(
      root,
      () => active,
      () => true,
      prose(),
    )
    expect(plain(assistant.render(60))).toEqual([`   Docs (${link})`])
    active = false
    expect(plain(assistant.render(60))).toEqual([' Docs'])
  })
})
