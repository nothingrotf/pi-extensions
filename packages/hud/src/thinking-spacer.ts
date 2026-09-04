import { type Component, stripTerminalSequences, type TUI } from '@earendil-works/pi-tui'
import { Type, type Static } from 'typebox'
import { Value } from 'typebox/value'

import { walkComponents } from './component-tree.ts'

const patched = new WeakSet<Component>()
const AssistantContentBlockSchema = Type.Object({ type: Type.String() })
const RenderableAssistantMessageSchema = Type.Object({
  content: Type.Array(AssistantContentBlockSchema),
  timestamp: Type.Number(),
})
const UpdatableAssistantSchema = Type.Object({
  isStreaming: Type.Boolean(),
  lastMessage: RenderableAssistantMessageSchema,
  updateContent: Type.Function([], Type.Unknown()),
})
const MessageTimestampSchema = Type.Object({
  lastMessage: Type.Object({ timestamp: Type.Number() }),
})

export function isBlankLine(line: string): boolean {
  return stripTerminalSequences(line).trim().length === 0
}

export function collapseLeadingBlank(lines: readonly string[]): string[] {
  if (lines.every(isBlankLine)) return []
  const first = lines[0]
  const second = lines[1]
  if (first === undefined || second === undefined) return [...lines]
  if (!isBlankLine(first) || !isBlankLine(second)) return [...lines]
  return [first, ...lines.slice(2)]
}

type AssistantMessageLike = Component & { contentContainer: object; hideThinkingBlock: boolean }
type RenderableAssistantMessage = Static<typeof RenderableAssistantMessageSchema>
type UpdatableAssistant = AssistantMessageLike & {
  isStreaming: boolean
  lastMessage: RenderableAssistantMessage
  updateContent: (message: RenderableAssistantMessage, isStreaming?: boolean) => void
}

export type AssistantVisibility = (timestamp: number | undefined, contentIndex?: number) => boolean
export type AssistantSuffix = (timestamp: number | undefined, width: number) => readonly string[]

function isAssistantMessage(component: Component): component is AssistantMessageLike {
  if (!('contentContainer' in component) || !('hideThinkingBlock' in component)) return false
  return component.hideThinkingBlock === true || component.hideThinkingBlock === false
}

function isUpdatableAssistant(component: AssistantMessageLike): component is UpdatableAssistant {
  return Value.Check(UpdatableAssistantSchema, component)
}

function messageTimestamp(component: Component): number | undefined {
  return Value.Check(MessageTimestampSchema, component)
    ? component.lastMessage.timestamp
    : undefined
}

function visibilityKey(message: RenderableAssistantMessage, visible: AssistantVisibility): string {
  return message.content
    .map((block, index) =>
      block.type === 'text' && !visible(message.timestamp, index) ? '0' : '1',
    )
    .join('')
}

function filterMessage(
  message: RenderableAssistantMessage,
  visible: AssistantVisibility,
): RenderableAssistantMessage {
  const content = message.content.filter(
    (block, index) => block.type !== 'text' || visible(message.timestamp, index),
  )
  return content.length === message.content.length ? message : { ...message, content }
}

function patchAssistant(
  component: AssistantMessageLike,
  active: () => boolean,
  visible: AssistantVisibility,
  suffix: AssistantSuffix,
): boolean {
  if (patched.has(component)) return false
  patched.add(component)
  const originalRender = component.render.bind(component)
  let refreshVisibility = () => undefined
  let filtersContent = false

  if (isUpdatableAssistant(component)) {
    filtersContent = true
    const originalUpdate = component.updateContent.bind(component)
    let source: RenderableAssistantMessage | undefined = component.lastMessage
    let streaming: boolean | undefined = component.isStreaming
    let key: string | undefined
    refreshVisibility = () => {
      if (source === undefined) return
      const nextKey = visibilityKey(source, visible)
      if (nextKey === key) return
      key = nextKey
      originalUpdate(filterMessage(source, visible), streaming)
    }
    component.updateContent = (
      message: RenderableAssistantMessage,
      isStreaming?: boolean,
    ): void => {
      const internalRefresh = message === component.lastMessage && isStreaming === undefined
      if (!internalRefresh || source === undefined) source = message
      if (isStreaming !== undefined) streaming = isStreaming
      key = undefined
      refreshVisibility()
    }
    refreshVisibility()
  }

  component.render = (width: number): string[] => {
    refreshVisibility()
    if (!filtersContent && !visible(messageTimestamp(component))) return []
    const lines = originalRender(width)
    const body = active() ? collapseLeadingBlank(lines) : lines
    return body.some((line) => !isBlankLine(line))
      ? [...body, ...suffix(messageTimestamp(component), width)]
      : body
  }
  return true
}

export function sweepAssistantMessages(
  root: Component,
  active: () => boolean,
  visible: AssistantVisibility = () => true,
  suffix: AssistantSuffix = () => [],
): number {
  let count = 0
  walkComponents(root, (component) => {
    if (!isAssistantMessage(component)) return false
    if (patchAssistant(component, active, visible, suffix)) count += 1
    return true
  })
  return count
}

export type ThinkingSpacerFix = {
  dispose: () => void
  markDirty: () => void
}

type InstalledThinkingFix = ThinkingSpacerFix & {
  setSources: (active: () => boolean, visible: AssistantVisibility, suffix: AssistantSuffix) => void
}

const installed = new WeakMap<TUI, InstalledThinkingFix>()

export function installThinkingSpacerFix(
  tui: TUI,
  active: () => boolean,
  visible: AssistantVisibility = () => true,
  suffix: AssistantSuffix = () => [],
): ThinkingSpacerFix {
  const current = installed.get(tui)
  if (current !== undefined) {
    current.setSources(active, visible, suffix)
    current.markDirty()
    return current
  }

  let activeSource = active
  let visibleSource = visible
  let suffixSource = suffix
  let enabled = true
  let dirty = true
  let retries = 0
  const fix: InstalledThinkingFix = {
    dispose: () => {
      enabled = false
      dirty = true
      retries = 0
      tui.requestRender()
    },
    markDirty: () => {
      dirty = true
      retries = 1
    },
    setSources: (nextActive, nextVisible, nextSuffix) => {
      activeSource = nextActive
      visibleSource = nextVisible
      suffixSource = nextSuffix
      enabled = true
      dirty = true
      retries = 0
    },
  }
  const isActive = () => enabled && activeSource()
  const isVisible: AssistantVisibility = (timestamp, contentIndex) =>
    !enabled || visibleSource(timestamp, contentIndex)
  const appendSuffix: AssistantSuffix = (timestamp, width) =>
    enabled ? suffixSource(timestamp, width) : []
  installed.set(tui, fix)
  const original = tui.requestRender.bind(tui)
  tui.requestRender = (...args: Parameters<TUI['requestRender']>): void => {
    if (dirty) {
      sweepAssistantMessages(tui, isActive, isVisible, appendSuffix)
      if (retries > 0) retries -= 1
      else dirty = false
    }
    original(...args)
  }
  return fix
}
