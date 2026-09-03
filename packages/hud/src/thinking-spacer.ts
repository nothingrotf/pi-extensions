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

const hooked = new WeakSet<TUI>()

export type ThinkingSpacerFix = {
  markDirty: () => void
}

export function installThinkingSpacerFix(tui: TUI, active: () => boolean): ThinkingSpacerFix {
  const markDirty = () => {
    dirty = true
  }
  let dirty = true
  if (hooked.has(tui)) return { markDirty }
  hooked.add(tui)
  const original = tui.requestRender.bind(tui)
  tui.requestRender = (...args: Parameters<TUI['requestRender']>): void => {
    if (dirty && active()) {
      dirty = false
      sweepAssistantMessages(tui, active)
    }
    original(...args)
  }
  return { markDirty }
}
