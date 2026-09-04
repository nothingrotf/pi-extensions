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

type BorderSources = {
  theme: BorderTheme
  working: () => boolean
}

const patched = new WeakMap<Component, BorderSources>()

export function isEditorLike(component: Component): component is EditorLike {
  if (!('borderColor' in component) || !('getText' in component)) return false
  return component.borderColor instanceof Function && component.getText instanceof Function
}

export function patchEditorBorder(
  editor: EditorLike,
  theme: BorderTheme,
  working: () => boolean,
): void {
  const current = patched.get(editor)
  if (current !== undefined) {
    current.theme = theme
    current.working = working
    return
  }
  const sources = { theme, working }
  patched.set(editor, sources)
  let idle = editor.borderColor
  const busy: BorderPainter = (text) => sources.theme.fg('borderMuted', text)
  Object.defineProperty(editor, 'borderColor', {
    configurable: true,
    enumerable: true,
    get: (): BorderPainter => (sources.working() ? busy : idle),
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
