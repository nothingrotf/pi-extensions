import type { Component, TUI } from '@earendil-works/pi-tui'
import { Type } from 'typebox'
import { Value } from 'typebox/value'

import { childrenOf } from './component-tree.ts'

const NativeStatusSchema = Type.Object({
  kind: Type.Union([
    Type.Literal('branchSummary'),
    Type.Literal('compaction'),
    Type.Literal('retry'),
    Type.Literal('working'),
  ]),
})
const NativeStatusHostSchema = Type.Object({
  statusContainer: Type.Object({
    invalidate: Type.Function([], Type.Unknown()),
    render: Type.Function([Type.Number()], Type.Array(Type.String())),
  }),
})

type NativeStatusKind = 'branchSummary' | 'compaction' | 'retry' | 'working'
type RenderHost = Component & { requestRender: TUI['requestRender'] }

const patched = new WeakSet<Component>()

function nativeStatusKind(component: Component): NativeStatusKind | undefined {
  return Value.Check(NativeStatusSchema, component) ? component.kind : undefined
}

function patchStatusContainer(component: Component, enabled: () => boolean): boolean {
  if (patched.has(component)) return false
  patched.add(component)
  const original = component.render.bind(component)
  let compactionFlow = false
  component.render = (width: number): string[] => {
    const kinds = childrenOf(component).flatMap((child) => {
      const kind = nativeStatusKind(child)
      return kind === undefined ? [] : [kind]
    })
    if (kinds.includes('compaction')) compactionFlow = true
    else if (kinds.length === 0 || kinds.some((kind) => kind !== 'retry')) compactionFlow = false
    if (
      enabled() &&
      compactionFlow &&
      kinds.some((kind) => kind === 'compaction' || kind === 'retry')
    ) {
      return []
    }
    return original(width)
  }
  return true
}

export function sweepNativeStatusIndicators(
  root: Component,
  enabled: () => boolean = () => true,
): number {
  if (Value.Check(NativeStatusHostSchema, root)) {
    return Number(patchStatusContainer(root.statusContainer, enabled))
  }
  const children = childrenOf(root)
  let count = children.some((child) => nativeStatusKind(child) === 'compaction')
    ? Number(patchStatusContainer(root, enabled))
    : 0
  for (const child of children) {
    if (childrenOf(child).some((indicator) => nativeStatusKind(indicator) === 'compaction')) {
      count += Number(patchStatusContainer(child, enabled))
    }
  }
  return count
}

export type NativeStatusFix = {
  dispose: () => void
}

type InstalledNativeStatusFix = NativeStatusFix & {
  enable: () => void
}

const installed = new WeakMap<RenderHost, InstalledNativeStatusFix>()

export function installNativeStatusFix(tui: RenderHost): NativeStatusFix {
  const current = installed.get(tui)
  if (current !== undefined) {
    current.enable()
    return current
  }

  let enabled = true
  let patchedContainer = false
  const fix: InstalledNativeStatusFix = {
    dispose: () => {
      enabled = false
      tui.requestRender()
    },
    enable: () => {
      enabled = true
      tui.requestRender()
    },
  }
  installed.set(tui, fix)
  const original = tui.requestRender.bind(tui)
  tui.requestRender = (...args: Parameters<TUI['requestRender']>): void => {
    if (enabled && !patchedContainer) {
      patchedContainer = sweepNativeStatusIndicators(tui, () => enabled) > 0
    }
    original(...args)
  }
  tui.requestRender()
  return fix
}
