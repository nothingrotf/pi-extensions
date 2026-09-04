import { type Component, Container, type TUI } from '@earendil-works/pi-tui'
import { Type } from 'typebox'
import { Value } from 'typebox/value'

import { childrenOf, maxTreeDepth } from './component-tree.ts'
import { decodeRailEntry, railEntryType } from './rail-entry.ts'

const RoleEntryComponentSchema = Type.Object({
  entry: Type.Object({
    customType: Type.Literal('hud-role'),
    data: Type.Object({ role: Type.Union([Type.Literal('assistant'), Type.Literal('user')]) }),
  }),
})
const UserMessageComponentSchema = Type.Object({
  outputPad: Type.Number(),
  setOutputPad: Type.Function([Type.Number()], Type.Undefined()),
  text: Type.String(),
})
const SpacerComponentSchema = Type.Object({ lines: Type.Number() })
const RailEntryComponentSchema = Type.Object({
  entry: Type.Object({ customType: Type.Literal(railEntryType), data: Type.Unknown() }),
})
const AssistantMessageComponentSchema = Type.Object({
  lastMessage: Type.Object({ timestamp: Type.Number() }),
})

type RailPlacement = {
  matched: number
  moved: number
  unresolved: number
}

function roleOf(component: Component): 'assistant' | 'user' | undefined {
  return Value.Check(RoleEntryComponentSchema, component) ? component.entry.data.role : undefined
}

function isUserMessage(component: Component): boolean {
  return Value.Check(UserMessageComponentSchema, component)
}

function isSpacer(component: Component): boolean {
  return Value.Check(SpacerComponentSchema, component)
}

function railTurn(component: Component): number | undefined {
  if (!Value.Check(RailEntryComponentSchema, component)) return undefined
  return decodeRailEntry(component.entry.data)
}

function assistantTimestamp(component: Component): number | undefined {
  return Value.Check(AssistantMessageComponentSchema, component)
    ? component.lastMessage.timestamp
    : undefined
}

function isPlainContainer(component: Component): component is Container {
  return component.constructor === Container
}

function moveAfter(root: Component, component: Component, anchor: Component): boolean {
  if (!isPlainContainer(root)) return false
  const componentIndex = root.children.indexOf(component)
  const anchorIndex = root.children.indexOf(anchor)
  if (componentIndex < 0 || anchorIndex < 0 || componentIndex === anchorIndex + 1) return false
  root.children.splice(componentIndex, 1)
  root.children.splice(root.children.indexOf(anchor) + 1, 0, component)
  return true
}

function moveBefore(root: Component, component: Component, anchor: Component): boolean {
  if (!isPlainContainer(root)) return false
  const componentIndex = root.children.indexOf(component)
  const anchorIndex = root.children.indexOf(anchor)
  if (componentIndex < 0 || anchorIndex < 0 || componentIndex === anchorIndex - 1) return false
  root.children.splice(componentIndex, 1)
  root.children.splice(root.children.indexOf(anchor), 0, component)
  return true
}

export function placeSpeakerEntries(root: Component): number {
  if (!isPlainContainer(root)) return 0
  const entries = childrenOf(root)
  const userIndices = entries.flatMap((entry, index) => (roleOf(entry) === 'user' ? [index] : []))
  let moved = 0
  for (let index = 0; index < userIndices.length; index += 1) {
    const start = userIndices[index]
    const end = userIndices[index + 1] ?? entries.length
    if (start === undefined) continue
    const turn = entries.slice(start + 1, end)
    const message = turn.find(isUserMessage)
    const user = entries[start]
    const assistant = turn.find((entry) => roleOf(entry) === 'assistant')
    if (message === undefined || user === undefined || assistant === undefined) continue
    if (moveAfter(root, assistant, message)) moved += 1
    const messageIndex = root.children.indexOf(message)
    const previous = root.children[messageIndex - 1]
    const anchor = previous !== undefined && isSpacer(previous) ? previous : message
    if (moveBefore(root, user, anchor)) moved += 1
  }
  return moved
}

function placeDirectChildren(
  root: Component,
  openingTimestamps: ReadonlyMap<number, number>,
): RailPlacement {
  const placement: RailPlacement = { matched: 0, moved: 0, unresolved: 0 }
  if (!isPlainContainer(root)) return placement
  for (const rail of childrenOf(root).filter((child) => railTurn(child) !== undefined)) {
    const turn = railTurn(rail)
    if (turn === undefined) continue
    const timestamp = openingTimestamps.get(turn)
    if (timestamp === undefined) continue
    const assistant = childrenOf(root).find((child) => assistantTimestamp(child) === timestamp)
    if (assistant === undefined) {
      placement.unresolved += 1
      continue
    }
    placement.matched += 1
    const railIndex = root.children.indexOf(rail)
    const assistantIndex = root.children.indexOf(assistant)
    if (railIndex < 0 || assistantIndex < 0 || railIndex === assistantIndex + 1) continue
    root.children.splice(railIndex, 1)
    const nextAssistantIndex = root.children.indexOf(assistant)
    root.children.splice(nextAssistantIndex + 1, 0, rail)
    placement.moved += 1
  }
  return placement
}

function placeRails(
  root: Component,
  openingTimestamps: ReadonlyMap<number, number>,
  depth = 0,
): RailPlacement {
  if (depth > maxTreeDepth) return { matched: 0, moved: 0, unresolved: 0 }
  const placement = placeDirectChildren(root, openingTimestamps)
  for (const child of childrenOf(root)) {
    const nested = placeRails(child, openingTimestamps, depth + 1)
    placement.matched += nested.matched
    placement.moved += nested.moved
    placement.unresolved += nested.unresolved
  }
  return placement
}

export function placeRailsAfterOpening(
  root: Component,
  openingTimestamps: ReadonlyMap<number, number>,
): number {
  return placeRails(root, openingTimestamps).moved
}

export type TranscriptLayoutFix = {
  dispose: () => void
  markDirty: () => void
}

type InstalledTranscriptLayoutFix = TranscriptLayoutFix & {
  setSource: (openingTimestamps: ReadonlyMap<number, number>) => void
}

const installed = new WeakMap<TUI, InstalledTranscriptLayoutFix>()

export function installTranscriptLayoutFix(
  tui: TUI,
  openingTimestamps: ReadonlyMap<number, number>,
): TranscriptLayoutFix {
  const current = installed.get(tui)
  if (current !== undefined) {
    current.setSource(openingTimestamps)
    current.markDirty()
    return current
  }

  let source = openingTimestamps
  let active = true
  let dirty = true
  let deadline = Date.now() + 3000
  let retryVersion = 0
  const retry = () => {
    const version = ++retryVersion
    const render = () => {
      if (!active || !dirty || version !== retryVersion) return
      tui.requestRender()
      if (dirty) setTimeout(render, 50).unref()
    }
    queueMicrotask(render)
  }
  const fix: InstalledTranscriptLayoutFix = {
    dispose: () => {
      active = false
      dirty = false
      retryVersion += 1
    },
    markDirty: () => {
      deadline = Date.now() + 3000
      dirty = true
      retry()
    },
    setSource: (next) => {
      active = true
      deadline = Date.now() + 3000
      source = next
      dirty = true
    },
  }
  installed.set(tui, fix)
  const original = tui.requestRender.bind(tui)
  tui.requestRender = (...args: Parameters<TUI['requestRender']>): void => {
    if (active && dirty) {
      const placement = placeRails(tui, source)
      const complete = placement.unresolved === 0 && placement.matched >= source.size
      if (source.size === 0 || complete || Date.now() >= deadline) dirty = false
    }
    original(...args)
  }
  retry()
  return fix
}
