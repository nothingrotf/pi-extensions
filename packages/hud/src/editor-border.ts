import { type Component } from '@earendil-works/pi-tui'

import { walkComponents } from './component-tree.ts'

type BorderPainter = (text: string) => string
type BorderRenderer = (width: number, hiddenLineCount: number) => string

const BOTTOM_MARKER = '\x1b_hud:bottom-border\x07'

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

function hasBottomBorder(
  editor: EditorLike,
): editor is EditorLike & { renderBottomBorder: BorderRenderer } {
  return 'renderBottomBorder' in editor && editor.renderBottomBorder instanceof Function
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
  if (!hasBottomBorder(editor)) return
  const renderBottomBorder = editor.renderBottomBorder.bind(editor)
  editor.renderBottomBorder = (width, hiddenLineCount) =>
    BOTTOM_MARKER + renderBottomBorder(width, hiddenLineCount)
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
    return lines.map((line) => {
      if (!line.includes(BOTTOM_MARKER)) return line
      const border = line.replaceAll(BOTTOM_MARKER, '')
      return width >= 2 && border === current.border ? '' : border
    })
  }
}

export function sweepEditors(root: Component, theme: BorderTheme, working: () => boolean): void {
  walkComponents(root, (component) => {
    if (!isEditorLike(component)) return false
    patchEditorBorder(component, theme, working)
    return true
  })
}
