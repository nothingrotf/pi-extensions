import type { Component } from '@earendil-works/pi-tui'

import { walkComponents } from './component-tree.ts'

type BorderPainter = (text: string) => string

export type EditorLike = Component & {
  borderColor: BorderPainter
  getText: () => string
}

export type BorderTheme = {
  fg: (color: 'borderMuted', text: string) => string
}

const patched = new WeakSet<Component>()

export function isEditorLike(component: Component): component is EditorLike {
  if (!('borderColor' in component) || !('getText' in component)) return false
  return component.borderColor instanceof Function && component.getText instanceof Function
}

export function patchEditorBorder(
  editor: EditorLike,
  theme: BorderTheme,
  working: () => boolean,
): void {
  if (patched.has(editor)) return
  patched.add(editor)
  let idle = editor.borderColor
  const busy: BorderPainter = (text) => theme.fg('borderMuted', text)
  Object.defineProperty(editor, 'borderColor', {
    configurable: true,
    enumerable: true,
    get: (): BorderPainter => (working() ? busy : idle),
    set: (painter: BorderPainter) => {
      idle = painter
    },
  })
}

export function sweepEditors(root: Component, theme: BorderTheme, working: () => boolean): void {
  walkComponents(root, (component) => {
    if (!isEditorLike(component)) return false
    patchEditorBorder(component, theme, working)
    return true
  })
}
