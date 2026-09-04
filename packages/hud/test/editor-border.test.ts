import { Container, Editor, type Terminal, Text, TuiMainScreen } from '@earendil-works/pi-tui'
import { describe, expect, test } from 'vite-plus/test'

import { isEditorLike, patchEditorBorder, sweepEditors } from '../src/editor-border.ts'

class SilentTerminal implements Terminal {
  columns = 80
  rows = 24
  kittyProtocolActive = false
  start(): void {}
  stop(): void {}
  drainInput(): Promise<void> {
    return Promise.resolve()
  }
  write(): void {}
  moveBy(): void {}
  hideCursor(): void {}
  showCursor(): void {}
  clearLine(): void {}
  clearFromCursor(): void {}
  clearScreen(): void {}
  setTitle(): void {}
  setProgress(): void {}
}

const idle = (text: string) => `<idle>${text}</idle>`
const later = (text: string) => `<later>${text}</later>`
const theme = { fg: (_color: 'borderMuted', text: string) => `<muted>${text}</muted>` }
const identity = (text: string) => text

function realEditor(): Editor {
  const tui = new TuiMainScreen(new SilentTerminal())
  return new Editor(tui, {
    borderColor: idle,
    selectList: {
      selectedPrefix: identity,
      selectedText: identity,
      description: identity,
      scrollInfo: identity,
      noMatch: identity,
    },
  })
}

describe('isEditorLike', () => {
  test('recognises the real pi-tui editor', () => {
    expect(isEditorLike(realEditor())).toBe(true)
  })

  test('rejects components without an editor surface', () => {
    expect(isEditorLike(new Text('x', 0, 0))).toBe(false)
    expect(isEditorLike(new Container())).toBe(false)
  })
})

describe('patchEditorBorder', () => {
  test('paints the border muted while the agent works', () => {
    const editor = realEditor()
    let working = false
    patchEditorBorder(editor, theme, () => working)

    expect(editor.borderColor('─')).toBe('<idle>─</idle>')
    working = true
    expect(editor.borderColor('─')).toBe('<muted>─</muted>')
    working = false
    expect(editor.borderColor('─')).toBe('<idle>─</idle>')
  })

  test('keeps a border set by pi as the idle painter', () => {
    const editor = realEditor()
    let working = true
    patchEditorBorder(editor, theme, () => working)

    editor.borderColor = later
    expect(editor.borderColor('─')).toBe('<muted>─</muted>')
    working = false
    expect(editor.borderColor('─')).toBe('<later>─</later>')
  })

  test('shows up in the rendered frame', () => {
    const editor = realEditor()
    patchEditorBorder(editor, theme, () => true)
    const [top = ''] = editor.render(20)

    expect(top).toContain('<muted>')
    expect(top).not.toContain('<idle>')
  })

  test('rebinds the working state when the HUD is reinstalled', () => {
    const editor = realEditor()
    patchEditorBorder(editor, theme, () => true)
    patchEditorBorder(editor, theme, () => false)

    expect(editor.borderColor('─')).toBe('<idle>─</idle>')
  })
})

describe('sweepEditors', () => {
  test('finds editors nested inside containers', () => {
    const root = new Container()
    const middle = new Container()
    const editor = realEditor()
    middle.addChild(editor)
    root.addChild(middle)
    sweepEditors(root, theme, () => true)

    expect(editor.borderColor('─')).toBe('<muted>─</muted>')
  })
})
