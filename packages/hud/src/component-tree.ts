import type { Component } from '@earendil-works/pi-tui'

export const maxTreeDepth = 12

export function childrenOf(component: Component): readonly Component[] {
  if (!('children' in component) || !Array.isArray(component.children)) return []
  const found: Component[] = []
  for (const child of component.children) {
    if (child instanceof Object && 'render' in child) found.push(child)
  }
  return found
}

export function walkComponents(
  root: Component,
  visit: (component: Component) => boolean,
  depth = 0,
): void {
  if (depth > maxTreeDepth) return
  for (const child of childrenOf(root)) {
    if (visit(child)) continue
    walkComponents(child, visit, depth + 1)
  }
}
