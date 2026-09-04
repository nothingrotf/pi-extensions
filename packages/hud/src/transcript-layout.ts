import { type Component, Container, type TUI } from '@earendil-works/pi-tui'
import { Type } from 'typebox'
import { Value } from 'typebox/value'

import { childrenOf, maxTreeDepth } from './component-tree.ts'
import { decodeRailEntry, railEntryType } from './rail-entry.ts'
import { observeTranscript, type TranscriptSubscription } from './transcript-observer.ts'

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
): number {
  if (!isPlainContainer(root) || openingTimestamps.size === 0) return 0
  const entries = childrenOf(root)
  const assistants = new Map<number, Component>()
  for (const child of entries) {
    const timestamp = assistantTimestamp(child)
    if (timestamp !== undefined && !assistants.has(timestamp)) assistants.set(timestamp, child)
  }
  const anchored = new Map<Component, Component[]>()
  const rails = new Set<Component>()
  for (const child of entries) {
    const turn = railTurn(child)
    const timestamp = turn === undefined ? undefined : openingTimestamps.get(turn)
    const assistant = timestamp === undefined ? undefined : assistants.get(timestamp)
    if (assistant === undefined) continue
    const siblings = anchored.get(assistant) ?? []
    siblings.push(child)
    anchored.set(assistant, siblings)
    rails.add(child)
  }
  if (rails.size === 0) return 0
  const ordered: Component[] = []
  for (const child of entries) {
    if (rails.has(child)) continue
    ordered.push(child)
    for (const rail of anchored.get(child) ?? []) ordered.push(rail)
  }
  const moved = ordered.reduce(
    (count, child, index) => count + Number(rails.has(child) && entries[index] !== child),
    0,
  )
  if (moved > 0) root.children = ordered
  return moved
}

function placeRails(
  root: Component,
  openingTimestamps: ReadonlyMap<number, number>,
  depth = 0,
): number {
  if (depth > maxTreeDepth) return 0
  let moved = placeDirectChildren(root, openingTimestamps)
  for (const child of childrenOf(root)) {
    moved += placeRails(child, openingTimestamps, depth + 1)
  }
  return moved
}

export function placeRailsAfterOpening(
  root: Component,
  openingTimestamps: ReadonlyMap<number, number>,
): number {
  return placeRails(root, openingTimestamps)
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
  let subscription: TranscriptSubscription | undefined
  const subscribe = () => {
    subscription ??= observeTranscript(tui, 10, () => {
      placeRails(tui, source)
    })
  }
  const fix: InstalledTranscriptLayoutFix = {
    dispose: () => {
      subscription?.dispose()
      subscription = undefined
    },
    markDirty: () => subscription?.markDirty(),
    setSource: (next) => {
      source = next
      subscribe()
    },
  }
  installed.set(tui, fix)
  subscribe()
  return fix
}
