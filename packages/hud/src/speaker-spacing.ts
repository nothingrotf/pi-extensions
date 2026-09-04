import { stripTerminalSequences, type Component, type TUI } from '@earendil-works/pi-tui'
import { type Static, Type } from 'typebox'
import { Value } from 'typebox/value'

import { childrenOf, maxTreeDepth } from './component-tree.ts'

const osc = String.fromCharCode(27)
const bell = String.fromCharCode(7)
const osc133ZoneStart = `${osc}]133;A${bell}`
const osc133ZoneEnd = `${osc}]133;B${bell}`
const osc133ZoneFinal = `${osc}]133;C${bell}`

const patchedAssistants = new WeakSet<Component>()
const patchedEntries = new WeakSet<Component>()
const patchedSpacers = new WeakSet<Component>()
const patchedUsers = new WeakSet<Component>()

const CustomEntrySchema = Type.Object({ entry: Type.Object({ customType: Type.String() }) })
const RoleEntrySchema = Type.Object({
  entry: Type.Object({
    customType: Type.Literal('hud-role'),
    data: Type.Object({ role: Type.Union([Type.Literal('assistant'), Type.Literal('user')]) }),
  }),
})
const SpacerSchema = Type.Object({ lines: Type.Number() })
const UserMessageSchema = Type.Object({ outputPad: Type.Number(), text: Type.String() })

type AssistantMessageLike = Component & { contentContainer: object; hideThinkingBlock: boolean }
type UserMessageLike = Component & Static<typeof UserMessageSchema>

function isBlank(line: string): boolean {
  return stripTerminalSequences(line).trim().length === 0
}

function isAssistantMessage(component: Component): component is AssistantMessageLike {
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
  return Value.Check(UserMessageSchema, component)
}

function patchUser(component: UserMessageLike, active: () => boolean): void {
  if (patchedUsers.has(component)) return
  patchedUsers.add(component)
  const original = component.render.bind(component)
  component.render = (width: number): string[] => {
    const lines = original(width)
    if (!active()) return lines
    let first = 0
    while (first < lines.length && isBlank(lines[first] ?? '')) first += 1
    let last = lines.length - 1
    while (last >= first && isBlank(lines[last] ?? '')) last -= 1
    const visible = lines.slice(first, last + 1)
    if (visible.length === 0) return visible
    if (lines.slice(0, first).some((line) => line.includes(osc133ZoneStart))) {
      visible[0] = `${osc133ZoneStart}${visible[0] ?? ''}`
    }
    const trailing = lines.slice(last + 1)
    const end = visible.length - 1
    if (trailing.some((line) => line.includes(osc133ZoneEnd))) {
      visible[end] = `${visible[end] ?? ''}${osc133ZoneEnd}`
    }
    if (trailing.some((line) => line.includes(osc133ZoneFinal))) {
      visible[end] = `${visible[end] ?? ''}${osc133ZoneFinal}`
    }
    return visible
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

function patchAssistant(component: AssistantMessageLike, active: () => boolean): void {
  if (patchedAssistants.has(component)) return
  patchedAssistants.add(component)
  const original = component.render.bind(component)
  component.render = (width: number): string[] => {
    const lines = original(width)
    if (!active()) return lines
    let first = 0
    while (first < lines.length && isBlank(lines[first] ?? '')) first += 1
    const visible = lines.slice(first)
    if (visible.length === 0) return visible
    if (lines.slice(0, first).some((line) => line.includes(osc133ZoneStart))) {
      visible[0] = `${osc133ZoneStart}${visible[0] ?? ''}`
    }
    return visible
  }
}

export function sweepSpeakerSpacing(root: Component, active: () => boolean, depth = 0): void {
  if (depth > maxTreeDepth) return
  const children = childrenOf(root)
  let pendingAssistant = false
  let pendingUser = false
  children.forEach((child, index) => {
    const customType = customTypeOf(child)
    if (customType === 'hud-role' || customType === 'timestamp-pi') patchEntry(child, active)
    const role = roleOf(child)
    if (role === 'assistant') {
      pendingAssistant = true
      pendingUser = false
    } else if (role === 'user') {
      pendingAssistant = false
      pendingUser = true
    } else if (isUserMessage(child)) {
      if (pendingUser) {
        patchUser(child, active)
        const previous = children[index - 1]
        if (previous !== undefined && isSpacer(previous)) patchSpacer(previous, active)
      }
      pendingUser = false
    } else if (isAssistantMessage(child)) {
      if (pendingAssistant) patchAssistant(child, active)
      pendingAssistant = false
    }
    sweepSpeakerSpacing(child, active, depth + 1)
  })
}

export type SpeakerSpacingFix = {
  markDirty: () => void
}

type InstalledSpacingFix = SpeakerSpacingFix & {
  setActive: (active: () => boolean) => void
}

const installed = new WeakMap<TUI, InstalledSpacingFix>()

export function installSpeakerSpacingFix(tui: TUI, active: () => boolean): SpeakerSpacingFix {
  const current = installed.get(tui)
  if (current !== undefined) {
    current.setActive(active)
    current.markDirty()
    return current
  }

  let activeSource = active
  let dirty = true
  const fix: InstalledSpacingFix = {
    markDirty: () => {
      dirty = true
    },
    setActive: (next) => {
      activeSource = next
      dirty = true
    },
  }
  const isActive = () => activeSource()
  installed.set(tui, fix)
  const original = tui.requestRender.bind(tui)
  tui.requestRender = (...args: Parameters<TUI['requestRender']>): void => {
    if (dirty) {
      dirty = false
      sweepSpeakerSpacing(tui, isActive)
    }
    original(...args)
  }
  return fix
}
