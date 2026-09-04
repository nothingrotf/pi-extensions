import { type Component, stripTerminalSequences, type TUI } from '@earendil-works/pi-tui'

import { walkComponents } from './component-tree.ts'

const patched = new WeakSet<Component>()

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

function isAssistantMessage(component: Component): component is AssistantMessageLike {
  if (!('contentContainer' in component) || !('hideThinkingBlock' in component)) return false
  return component.hideThinkingBlock === true || component.hideThinkingBlock === false
}

function patchAssistant(component: AssistantMessageLike, active: () => boolean): void {
  if (patched.has(component)) return
  patched.add(component)
  const original = component.render.bind(component)
  component.render = (width: number): string[] => {
    const lines = original(width)
    return active() ? collapseLeadingBlank(lines) : lines
  }
}

export function sweepAssistantMessages(root: Component, active: () => boolean): void {
  walkComponents(root, (component) => {
    if (!isAssistantMessage(component)) return false
    patchAssistant(component, active)
    return true
  })
}

export type ThinkingSpacerFix = {
  markDirty: () => void
}

type InstalledThinkingFix = ThinkingSpacerFix & {
  setActive: (active: () => boolean) => void
}

const installed = new WeakMap<TUI, InstalledThinkingFix>()

export function installThinkingSpacerFix(tui: TUI, active: () => boolean): ThinkingSpacerFix {
  const current = installed.get(tui)
  if (current !== undefined) {
    current.setActive(active)
    current.markDirty()
    return current
  }

  let activeSource = active
  let dirty = true
  const fix: InstalledThinkingFix = {
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
    if (dirty && isActive()) {
      dirty = false
      sweepAssistantMessages(tui, isActive)
    }
    original(...args)
  }
  return fix
}
