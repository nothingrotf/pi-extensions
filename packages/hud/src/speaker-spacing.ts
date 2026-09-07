import {
  Box,
  Container,
  Markdown,
  stripTerminalSequences,
  type Component,
  type TUI,
} from '@earendil-works/pi-tui'
import { type Static, Type } from 'typebox'
import { Value } from 'typebox/value'

import { defaultHudPalette, type HudPalette } from './colors.ts'
import { childrenOf, maxTreeDepth } from './component-tree.ts'
import type { FileResolver } from './prose-links.ts'
import { type ProseHighlighter, ProseMarkdown } from './prose-markdown.ts'
import { ProsePlain } from './prose-plain.ts'
import { RailComponent } from './rail-entry.ts'
import {
  frameTranscriptLine,
  speakerBodyIndent,
  transcriptCopyChipWidth,
  transcriptInsets,
} from './transcript-geometry.ts'
import { placeSpeakerEntries } from './transcript-layout.ts'
import { observeTranscript, type TranscriptSubscription } from './transcript-observer.ts'

const osc = String.fromCharCode(27)
const bell = String.fromCharCode(7)
const osc133ZoneStart = `${osc}]133;A${bell}`
const osc133ZoneEnd = `${osc}]133;B${bell}`
const osc133ZoneFinal = `${osc}]133;C${bell}`

const patchedAssistants = new WeakSet<Component>()
const patchedEntries = new WeakSet<Component>()
const patchedRails = new WeakSet<Component>()
const patchedSpacers = new WeakSet<Component>()
const patchedTools = new WeakSet<Component>()
const patchedUsers = new WeakSet<Component>()
const assistantsAfterRail = new WeakSet<Component>()
const railsAfterAssistant = new WeakSet<Component>()

const CustomEntrySchema = Type.Object({ entry: Type.Object({ customType: Type.String() }) })
const RoleEntrySchema = Type.Object({
  entry: Type.Object({
    customType: Type.Literal('hud-role'),
    data: Type.Object({ role: Type.Union([Type.Literal('assistant'), Type.Literal('user')]) }),
  }),
})
const SpacerSchema = Type.Object({ lines: Type.Number() })
const PaddedMessageSchema = Type.Object({
  outputPad: Type.Number(),
  setOutputPad: Type.Function([Type.Number()], Type.Undefined()),
})
const UserMessageSchema = Type.Object({ outputPad: Type.Number(), text: Type.String() })
const ToolExecutionComponentSchema = Type.Object({
  toolCallId: Type.String({ minLength: 1 }),
  toolName: Type.String({ minLength: 1 }),
})

type PaddedMessage = Static<typeof PaddedMessageSchema>
type AssistantMessageLike = Component &
  PaddedMessage & { contentContainer: object; hideThinkingBlock: boolean }
type UserMessageLike = Component & PaddedMessage & Static<typeof UserMessageSchema>
type ToolExecutionLike = Component & Static<typeof ToolExecutionComponentSchema>

export type ProseSources = {
  cwd: () => string
  highlight?: ProseHighlighter
  palette?: () => HudPalette
  resolve: FileResolver
  revision: () => number
  streaming: () => boolean
}

export const defaultProseSources: ProseSources = {
  cwd: () => process.cwd(),
  resolve: () => undefined,
  revision: () => 0,
  streaming: () => false,
}

const MarkdownSourceSchema = Type.Object({ text: Type.String() })
const ThinkingMarkdownSchema = Type.Object({
  defaultTextStyle: Type.Object({ italic: Type.Literal(true) }),
})

function isBlank(line: string): boolean {
  return stripTerminalSequences(line).trim().length === 0
}

function isPaddedMessage(component: Component): component is Component & PaddedMessage {
  return Value.Check(PaddedMessageSchema, component)
}

function isAssistantMessage(component: Component): component is AssistantMessageLike {
  if (!isPaddedMessage(component)) return false
  if (!('contentContainer' in component) || !('hideThinkingBlock' in component)) return false
  return component.hideThinkingBlock === true || component.hideThinkingBlock === false
}

function customTypeOf(component: Component): string | undefined {
  return Value.Check(CustomEntrySchema, component) ? component.entry.customType : undefined
}

function roleOf(component: Component): 'assistant' | 'user' | undefined {
  return Value.Check(RoleEntrySchema, component) ? component.entry.data.role : undefined
}

function isSpacer(component: Component): boolean {
  return Value.Check(SpacerSchema, component)
}

function isUserMessage(component: Component): component is UserMessageLike {
  return isPaddedMessage(component) && Value.Check(UserMessageSchema, component)
}

function isToolExecution(component: Component): component is ToolExecutionLike {
  return Value.Check(ToolExecutionComponentSchema, component)
}

function markdownSource(component: Component): string | undefined {
  const source: unknown = component
  return Value.Check(MarkdownSourceSchema, source) ? source.text : undefined
}

function isThinkingMarkdown(component: Component): boolean {
  return Value.Check(ThinkingMarkdownSchema, component)
}

function adoptProse(
  root: Component,
  build: (markdown: Markdown) => Component | undefined,
  depth = 0,
): void {
  if (depth > maxTreeDepth) return
  if (root instanceof Container || root instanceof Box) {
    root.children.forEach((child, index) => {
      if (!(child instanceof Markdown)) return
      const replacement = build(child)
      if (replacement !== undefined) root.children[index] = replacement
    })
  }
  for (const child of childrenOf(root)) adoptProse(child, build, depth + 1)
}

function adoptUserProse(component: UserMessageLike, prose: ProseSources): void {
  adoptProse(component, () => new ProsePlain(component.text, prose))
}

function adoptAssistantProse(component: AssistantMessageLike, prose: ProseSources): void {
  adoptProse(component, (markdown) => {
    if (isThinkingMarkdown(markdown)) return undefined
    const text = markdownSource(markdown)
    return text === undefined ? undefined : new ProseMarkdown(text, prose)
  })
}

function clearUserBackground(component: Component): void {
  for (const child of childrenOf(component)) {
    if (child instanceof Box) child.setBgFn(undefined)
  }
}

function normalizeMessageLines(lines: readonly string[], preserveLeadingBlank = false): string[] {
  const hasStart = lines.some((line) => line.includes(osc133ZoneStart))
  const hasEnd = lines.some((line) => line.includes(osc133ZoneEnd))
  const hasFinal = lines.some((line) => line.includes(osc133ZoneFinal))
  const clean = lines.map((line) =>
    line
      .replaceAll(osc133ZoneStart, '')
      .replaceAll(osc133ZoneEnd, '')
      .replaceAll(osc133ZoneFinal, ''),
  )
  let first = 0
  while (first < clean.length && isBlank(clean[first] ?? '')) first += 1
  let last = clean.length - 1
  while (last >= first && isBlank(clean[last] ?? '')) last -= 1
  if (last < first) return []
  const start = preserveLeadingBlank && first > 0 ? first - 1 : first
  const visible = clean.slice(start, last + 1)
  if (visible.length === 0) return visible
  const end = visible.length - 1
  const closing = `${hasEnd ? osc133ZoneEnd : ''}${hasFinal ? osc133ZoneFinal : ''}`
  visible[end] = `${closing}${visible[end] ?? ''}`
  if (hasStart) visible[0] = `${osc133ZoneStart}${visible[0] ?? ''}`
  return visible
}

function transcriptMessageWidth(width: number, editable: boolean): number {
  const inner = transcriptInsets(width, speakerBodyIndent).inner
  if (!editable) return inner
  const editChipWidth = width >= 80 ? 7 : 3
  return Math.max(1, inner - transcriptCopyChipWidth(width) - editChipWidth)
}

class MessageFrame {
  private source: readonly string[] = []
  private width = -1
  private leadingGap = false
  private lines: string[] = []

  render(source: readonly string[], width: number, leadingGap = false): string[] {
    if (
      this.width === width &&
      this.leadingGap === leadingGap &&
      this.source.length === source.length &&
      source.every((line, index) => line === this.source[index])
    )
      return this.lines
    this.source = [...source]
    this.width = width
    this.leadingGap = leadingGap
    this.lines = normalizeMessageLines(source, leadingGap).map((line) =>
      frameTranscriptLine(line, width, speakerBodyIndent),
    )
    return this.lines
  }
}

function patchUser(component: UserMessageLike, active: () => boolean, prose: ProseSources): void {
  if (patchedUsers.has(component)) return
  patchedUsers.add(component)
  const original = component.render.bind(component)
  const nativeOutputPad = component.outputPad
  const frame = new MessageFrame()
  let styled = false
  component.render = (width: number): string[] => {
    const enabled = active()
    if (enabled && !styled) {
      component.setOutputPad(0)
      styled = true
    } else if (!enabled && styled) {
      component.setOutputPad(nativeOutputPad)
      styled = false
    }
    if (!enabled) return original(width)
    clearUserBackground(component)
    adoptUserProse(component, prose)
    const inner = transcriptMessageWidth(width, true)
    return frame.render(original(inner), width)
  }
}

function patchEntry(component: Component, active: () => boolean): void {
  if (patchedEntries.has(component)) return
  patchedEntries.add(component)
  const original = component.render.bind(component)
  component.render = (width: number): string[] => (active() ? original(width) : [])
}

function patchSpacer(component: Component, active: () => boolean): void {
  if (patchedSpacers.has(component)) return
  patchedSpacers.add(component)
  const original = component.render.bind(component)
  component.render = (width: number): string[] => (active() ? [] : original(width))
}

function patchToolExecution(
  component: ToolExecutionLike,
  hidden: (toolCallId: string) => boolean,
): void {
  if (patchedTools.has(component)) return
  patchedTools.add(component)
  const original = component.render.bind(component)
  component.render = (width: number): string[] =>
    hidden(component.toolCallId) ? [] : original(width)
}

function patchRail(
  component: Component,
  active: () => boolean,
  needsLeadingGap: () => boolean,
): void {
  if (patchedRails.has(component)) return
  patchedRails.add(component)
  const original = component.render.bind(component)
  component.render = (width: number): string[] => {
    const lines = original(width)
    if (!active()) return lines
    if (lines.every(isBlank)) return []
    if (needsLeadingGap() || !isBlank(lines[0] ?? '')) return lines
    return lines.slice(1)
  }
}

function patchAssistant(
  component: AssistantMessageLike,
  active: () => boolean,
  needsLeadingGap: () => boolean,
  prose: ProseSources,
): void {
  if (patchedAssistants.has(component)) return
  patchedAssistants.add(component)
  const original = component.render.bind(component)
  const nativeOutputPad = component.outputPad
  const frame = new MessageFrame()
  let styled = false
  component.render = (width: number): string[] => {
    const enabled = active()
    if (enabled && !styled) {
      component.setOutputPad(0)
      styled = true
    } else if (!enabled && styled) {
      component.setOutputPad(nativeOutputPad)
      styled = false
    }
    if (!enabled) return original(width)
    adoptAssistantProse(component, prose)
    const inner = transcriptMessageWidth(width, false)
    return frame.render(original(inner), width, needsLeadingGap())
  }
}

export function sweepSpeakerSpacing(
  root: Component,
  active: () => boolean,
  hideTools: (toolCallId: string) => boolean = () => active(),
  prose: ProseSources = defaultProseSources,
  depth = 0,
): void {
  if (depth > maxTreeDepth) return
  placeSpeakerEntries(root)
  const children = childrenOf(root)
  let assistantTurn = false
  let pendingUser = false
  let earlierRail = false
  children.forEach((child, index) => {
    if (isToolExecution(child)) patchToolExecution(child, hideTools)
    const customType = customTypeOf(child)
    if (customType === 'hud-role' || customType === 'timestamp-pi') patchEntry(child, active)
    if (customType === 'hud-rail') {
      const previous = children[index - 1]
      if (previous !== undefined && isAssistantMessage(previous)) railsAfterAssistant.add(child)
      else railsAfterAssistant.delete(child)
      patchRail(child, active, () => {
        const component = childrenOf(child).find((entry) => entry instanceof RailComponent)
        return railsAfterAssistant.has(child) || component?.needsLeadingGap() === true
      })
      earlierRail = true
    }
    const role = roleOf(child)
    if (role === 'assistant') {
      assistantTurn = true
      pendingUser = false
      earlierRail = false
    } else if (role === 'user') {
      assistantTurn = false
      pendingUser = true
      earlierRail = false
    } else if (isUserMessage(child)) {
      if (pendingUser) {
        patchUser(child, active, prose)
        const previous = children[index - 1]
        if (previous !== undefined && isSpacer(previous)) patchSpacer(previous, active)
      }
      pendingUser = false
    } else if (isAssistantMessage(child)) {
      if (earlierRail) assistantsAfterRail.add(child)
      else assistantsAfterRail.delete(child)
      if (assistantTurn) {
        patchAssistant(child, active, () => assistantsAfterRail.has(child), prose)
      }
    }
    sweepSpeakerSpacing(child, active, hideTools, prose, depth + 1)
  })
}

export type SpeakerSpacingFix = {
  dispose: () => void
  markDirty: () => void
}

type InstalledSpacingFix = SpeakerSpacingFix & {
  setSources: (
    active: () => boolean,
    hideTools: (toolCallId: string) => boolean,
    prose: ProseSources,
  ) => void
}

const installed = new WeakMap<TUI, InstalledSpacingFix>()

export function installSpeakerSpacingFix(
  tui: TUI,
  active: () => boolean,
  hideTools: (toolCallId: string) => boolean = () => active(),
  prose: ProseSources = defaultProseSources,
): SpeakerSpacingFix {
  const current = installed.get(tui)
  if (current !== undefined) {
    current.setSources(active, hideTools, prose)
    current.markDirty()
    return current
  }

  let activeSource = active
  let hideToolsSource = hideTools
  let proseSource = prose
  let installedActive = true
  let subscription: TranscriptSubscription | undefined
  const isActive = () => installedActive && activeSource()
  const toolsHidden = (toolCallId: string) => installedActive && hideToolsSource(toolCallId)
  const liveProse: ProseSources = {
    cwd: () => proseSource.cwd(),
    highlight: (code, lang) => proseSource.highlight?.(code, lang),
    palette: () => proseSource.palette?.() ?? defaultHudPalette,
    resolve: (candidate) => proseSource.resolve(candidate),
    revision: () => proseSource.revision(),
    streaming: () => proseSource.streaming(),
  }
  const subscribe = () => {
    subscription ??= observeTranscript(tui, 30, () => {
      sweepSpeakerSpacing(tui, isActive, toolsHidden, liveProse)
    })
  }
  const fix: InstalledSpacingFix = {
    dispose: () => {
      installedActive = false
      subscription?.dispose()
      subscription = undefined
      tui.requestRender()
    },
    markDirty: () => subscription?.markDirty(),
    setSources: (next, nextHideTools, nextProse) => {
      activeSource = next
      hideToolsSource = nextHideTools
      proseSource = nextProse
      installedActive = true
      subscribe()
    },
  }
  installed.set(tui, fix)
  subscribe()
  return fix
}
