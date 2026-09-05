import { type Component, Editor } from '@earendil-works/pi-tui'

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
  let frame: { border?: string; width: number } | undefined
  const capture: BorderPainter = (text) => {
    const painted = (sources.working() ? busy : idle)(text)
    if (frame !== undefined) {
      if (text === '─') frame.border = painted.repeat(frame.width)
      else if (text === '─'.repeat(frame.width)) frame.border = painted
    }
    return painted
  }
  Object.defineProperty(editor, 'borderColor', {
    configurable: true,
    enumerable: true,
    get: (): BorderPainter => (frame !== undefined ? capture : sources.working() ? busy : idle),
    set: (painter: BorderPainter) => {
      idle = painter
    },
  })
  if (!(editor instanceof Editor) || editor.render !== Editor.prototype.render) return
  const render = editor.render.bind(editor)
  editor.render = (width) => {
    const current: { border?: string; width: number } = { width }
    frame = current
    let lines: string[]
    try {
      lines = render(width)
    } finally {
      frame = undefined
    }
    if (width < 2 || current.border === undefined) return lines
    const bottom = lines.findIndex((line, index) => index > 0 && line === current.border)
    if (bottom !== -1) lines[bottom] = ''
    return lines
  }
}

export function sweepEditors(root: Component, theme: BorderTheme, working: () => boolean): void {
  walkComponents(root, (component) => {
    if (!isEditorLike(component)) return false
    patchEditorBorder(component, theme, working)
    return true
  })
}
