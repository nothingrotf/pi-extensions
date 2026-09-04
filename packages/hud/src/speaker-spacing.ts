import {
  Box,
  Markdown,
  stripTerminalSequences,
  type Component,
  type TUI,
} from '@earendil-works/pi-tui'
import { type Static, Type } from 'typebox'
import { Value } from 'typebox/value'

import { ansiForeground, ansiReset, empryoTextPrimary } from './colors.ts'
import { childrenOf, maxTreeDepth, walkComponents } from './component-tree.ts'
import { RailComponent } from './rail-entry.ts'
import {
  frameTranscriptLine,
  speakerBodyIndent,
  transcriptCopyChipWidth,
  transcriptInsets,
} from './transcript-geometry.ts'
import { placeSpeakerEntries } from './transcript-layout.ts'

const osc = String.fromCharCode(27)
const bell = String.fromCharCode(7)
const osc133ZoneStart = `${osc}]133;A${bell}`
const osc133ZoneEnd = `${osc}]133;B${bell}`
const osc133ZoneFinal = `${osc}]133;C${bell}`

const patchedAssistants = new WeakSet<Component>()
const patchedEntries = new WeakSet<Component>()
const patchedMarkdown = new WeakSet<Component>()
const patchedRails = new WeakSet<Component>()
const patchedSpacers = new WeakSet<Component>()
const patchedTools = new WeakSet<Component>()
const patchedUsers = new WeakSet<Component>()

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

const primaryAnsi = ansiForeground(empryoTextPrimary)
const primaryTextStyle = {
  color: (text: string) => `${primaryAnsi}${text}${ansiReset}`,
}

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

function styleMarkdown(component: Component): void {
  walkComponents(component, (child) => {
    if (!(child instanceof Markdown) || patchedMarkdown.has(child)) return false
    patchedMarkdown.add(child)
    Reflect.set(child, 'defaultTextStyle', primaryTextStyle)
    child.invalidate()
    return true
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

function patchUser(component: UserMessageLike, active: () => boolean): void {
  if (patchedUsers.has(component)) return
  patchedUsers.add(component)
  const original = component.render.bind(component)
  const nativeOutputPad = component.outputPad
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
    styleMarkdown(component)
    const inner = transcriptMessageWidth(width, true)
    return normalizeMessageLines(original(inner)).map((line) =>
      frameTranscriptLine(line, width, speakerBodyIndent),
    )
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
): void {
  if (patchedAssistants.has(component)) return
  patchedAssistants.add(component)
  const original = component.render.bind(component)
  const nativeOutputPad = component.outputPad
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
    styleMarkdown(component)
    const inner = transcriptMessageWidth(width, false)
    return normalizeMessageLines(original(inner), needsLeadingGap()).map((line) =>
      frameTranscriptLine(line, width, speakerBodyIndent),
    )
  }
}

export function sweepSpeakerSpacing(
  root: Component,
  active: () => boolean,
  hideTools: (toolCallId: string) => boolean = () => active(),
  depth = 0,
): void {
  if (depth > maxTreeDepth) return
  placeSpeakerEntries(root)
  const children = childrenOf(root)
  let assistantTurn = false
  let pendingUser = false
  const hasEarlierRail = (component: Component) => {
    const index = childrenOf(root).indexOf(component)
    for (let prior = index - 1; prior >= 0; prior -= 1) {
      const candidate = childrenOf(root)[prior]
      if (candidate === undefined) continue
      if (customTypeOf(candidate) === 'hud-rail') return true
      if (roleOf(candidate) !== undefined) return false
    }
    return false
  }
  children.forEach((child, index) => {
    if (isToolExecution(child)) patchToolExecution(child, hideTools)
    const customType = customTypeOf(child)
    if (customType === 'hud-role' || customType === 'timestamp-pi') patchEntry(child, active)
    if (customType === 'hud-rail') {
      patchRail(child, active, () => {
        const current = childrenOf(root)
        const previous = current[current.indexOf(child) - 1]
        const component = childrenOf(child).find((entry) => entry instanceof RailComponent)
        return (
          (previous !== undefined && isAssistantMessage(previous)) ||
          component?.needsLeadingGap() === true
        )
      })
    }
    const role = roleOf(child)
    if (role === 'assistant') {
      assistantTurn = true
      pendingUser = false
    } else if (role === 'user') {
      assistantTurn = false
      pendingUser = true
    } else if (isUserMessage(child)) {
      if (pendingUser) {
        patchUser(child, active)
        const previous = children[index - 1]
        if (previous !== undefined && isSpacer(previous)) patchSpacer(previous, active)
      }
      pendingUser = false
    } else if (isAssistantMessage(child)) {
      if (assistantTurn) patchAssistant(child, active, () => hasEarlierRail(child))
    }
    sweepSpeakerSpacing(child, active, hideTools, depth + 1)
  })
}

export type SpeakerSpacingFix = {
  dispose: () => void
  markDirty: () => void
}

type InstalledSpacingFix = SpeakerSpacingFix & {
  setSources: (active: () => boolean, hideTools: (toolCallId: string) => boolean) => void
}

const installed = new WeakMap<TUI, InstalledSpacingFix>()

export function installSpeakerSpacingFix(
  tui: TUI,
  active: () => boolean,
  hideTools: (toolCallId: string) => boolean = () => active(),
): SpeakerSpacingFix {
  const current = installed.get(tui)
  if (current !== undefined) {
    current.setSources(active, hideTools)
    current.markDirty()
    return current
  }

  let activeSource = active
  let hideToolsSource = hideTools
  let installedActive = true
  let dirty = true
  let deadline = Date.now() + 3000
  let retryVersion = 0
  const retry = () => {
    const version = ++retryVersion
    const render = () => {
      if (!installedActive || !dirty || version !== retryVersion) return
      tui.requestRender()
      if (dirty) setTimeout(render, 50).unref()
    }
    queueMicrotask(render)
  }
  const fix: InstalledSpacingFix = {
    dispose: () => {
      installedActive = false
      dirty = false
      retryVersion += 1
      tui.requestRender()
    },
    markDirty: () => {
      deadline = Date.now() + 3000
      dirty = true
      retry()
    },
    setSources: (next, nextHideTools) => {
      activeSource = next
      hideToolsSource = nextHideTools
      installedActive = true
      deadline = Date.now() + 3000
      dirty = true
      retry()
    },
  }
  const isActive = () => installedActive && activeSource()
  const toolsHidden = (toolCallId: string) => installedActive && hideToolsSource(toolCallId)
  installed.set(tui, fix)
  const original = tui.requestRender.bind(tui)
  tui.requestRender = (...args: Parameters<TUI['requestRender']>): void => {
    if (installedActive && dirty) {
      sweepSpeakerSpacing(tui, isActive, toolsHidden)
      if (Date.now() >= deadline) dirty = false
    }
    original(...args)
  }
  retry()
  return fix
}
