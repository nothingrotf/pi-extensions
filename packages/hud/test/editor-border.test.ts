import {
  CombinedAutocompleteProvider,
  Container,
  CURSOR_MARKER,
  Editor,
  type Terminal,
  Text,
  truncateToWidth,
  TuiMainScreen,
  visibleWidth,
} from '@earendil-works/pi-tui'
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

function realEditor(EditorType = Editor): Editor {
  const tui = new TuiMainScreen(new SilentTerminal())
  return new EditorType(tui, {
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

  test.each([false, true])('removes the bottom border while working=%s', (working) => {
    const editor = realEditor()
    editor.setText('hello')
    patchEditorBorder(editor, theme, () => working)
    const frame = editor.render(20)

    expect(frame[0]).toBe((working ? theme.fg('borderMuted', '─') : idle('─')).repeat(20))
    expect(frame).toHaveLength(3)
    expect(frame[1]).toContain('hello')
    expect(frame[2]).toBe('')
  })

  test.each(['hello', 'first\nsecond', 'a long input that wraps across several lines'])(
    'keeps a blank row below input %s',
    (text) => {
      const editor = realEditor()
      editor.borderColor = identity
      editor.setText(text)
      patchEditorBorder(editor, theme, () => false)

      const frame = editor.render(20)
      expect(frame.at(-1)).toBe('')
      expect(frame.at(-2)?.trim()).not.toBe('')
    },
  )

  test('preserves editable and submitted text without a prompt glyph', () => {
    const editor = realEditor()
    editor.borderColor = identity
    editor.focused = true
    patchEditorBorder(editor, theme, () => false)

    expect(editor.render(20)[1]).toContain(CURSOR_MARKER)
    expect(editor.render(20)[1]).not.toContain('›')
    editor.handleInput('hello')
    editor.handleInput('\x01')
    editor.handleInput('\x7f')
    expect(editor.render(20)[1]).toContain(CURSOR_MARKER)
    expect(editor.getText()).toBe('hello')
    let submitted = ''
    editor.onSubmit = (text) => {
      submitted = text
    }
    editor.handleInput('\r')
    expect(submitted).toBe('hello')
    editor.setText('first\nsecond')
    const frame = editor.render(20)
    expect(frame[1]).toMatch(/^first/)
    expect(frame[2]).toMatch(/^second/)
    expect(frame.join('')).not.toContain('›')
  })

  test('shows up in the rendered frame', () => {
    const editor = realEditor()
    patchEditorBorder(editor, theme, () => true)
    const [top = ''] = editor.render(20)

    expect(top).toContain('<muted>')
    expect(top).not.toContain('<idle>')
  })

  test.each([2, 8, 20, 80])('preserves content, cursor and padding at width %s', (width) => {
    for (const padding of [0, 2]) {
      const editor = realEditor()
      editor.borderColor = (text) => `\x1b[35m${text}\x1b[39m`
      editor.setPaddingX(padding)
      editor.setText('first line\n────────\nlast')
      editor.focused = true
      const before = editor.render(width)
      const cursor = editor.getCursor()
      patchEditorBorder(editor, theme, () => false)
      const after = editor.render(width)

      expect(after).toEqual([...before.slice(0, -1), ''])
      expect(after).toHaveLength(before.length)
      expect(after.some((line) => line.includes(CURSOR_MARKER))).toBe(true)
      expect(after.every((line) => visibleWidth(line) <= width)).toBe(true)
      expect(editor.getCursor()).toEqual(cursor)
      expect(editor.getText()).toBe('first line\n────────\nlast')
    }
  })

  test('preserves wide characters and cursor navigation across renders', () => {
    const editor = realEditor()
    editor.borderColor = identity
    editor.focused = true
    editor.setText('界🙂 é text')
    patchEditorBorder(editor, theme, () => false)
    editor.render(20)
    editor.handleInput('\x1b[D')
    const frame = editor.render(20)

    expect(frame[1]).toContain(`tex${CURSOR_MARKER}\x1b[7mt\x1b[0m`)
    expect(frame[1]).toContain('界🙂 é')
    expect(frame.at(-2)).toContain('界🙂 é')
    expect(frame.every((line) => visibleWidth(line) <= 20)).toBe(true)
  })

  test.each([4, 20])('preserves both scroll indicators at width %s', (width) => {
    const editor = realEditor()
    editor.setPaddingX(0)
    editor.setText(Array.from({ length: 30 }, (_, index) => String(index)).join('\n'))
    editor.render(width)
    for (let index = 0; index < 10; index++) editor.handleInput('\x1b[A')
    const before = editor.render(width)
    patchEditorBorder(editor, theme, () => false)

    expect(editor.render(width)).toEqual(before)
    if (width === 20) {
      expect(before[0]).toContain('↑')
      expect(before.at(-1)).toContain('↓')
    }
    for (let index = 0; index < 30; index++) editor.handleInput('\x1b[B')
    const bottom = editor.render(width)
    expect(bottom.at(-1)).not.toBe(' '.repeat(width))
    expect(bottom[0]).not.toBe(' '.repeat(width))
  })

  test('keeps autocomplete below the separator and applies its selection', async () => {
    const editor = realEditor()
    editor.focused = true
    editor.setAutocompleteProvider(
      new CombinedAutocompleteProvider([{ name: 'hello' }, { name: 'help' }], process.cwd()),
    )
    editor.handleInput('/')
    await expect.poll(() => editor.isShowingAutocomplete()).toBe(true)
    editor.setPaddingX(0)
    const before = editor.render(40)
    patchEditorBorder(editor, theme, () => false)
    const frame = editor.render(40)

    expect(frame[2]).toBe('')
    expect(frame.slice(3)).toEqual(before.slice(3))
    expect(frame.slice(2).join('\n')).toContain('hello')
    expect(frame.slice(2).join('\n')).toContain('help')
    expect(frame[1]).toContain(CURSOR_MARKER)
    editor.handleInput('\x1b[B')
    editor.handleInput('\t')
    expect(editor.getText()).toBe('/help ')
    expect(editor.isShowingAutocomplete()).toBe(false)
    expect(editor.render(40).at(-1)).not.toBe(' '.repeat(40))
  })

  test('does not rewrite custom renderer content or labeled borders', () => {
    class LabeledEditor extends Editor {
      override render(width: number): string[] {
        const lines = super.render(width)
        const bottom = lines.length - 1
        lines[bottom] = truncateToWidth(lines[bottom] ?? '', width - 7, '') + ' INSERT'
        return [...lines, '─'.repeat(width), 'custom content']
      }
    }
    const editor = realEditor(LabeledEditor)
    editor.borderColor = identity
    editor.setText('text')
    const before = editor.render(20)
    patchEditorBorder(editor, theme, () => false)

    expect(editor.render(20)).toEqual(before)
    expect(editor.render(20).at(-3)).toContain('INSERT')
  })

  test('does not mistake one-column input for a separator', () => {
    const editor = realEditor()
    editor.borderColor = identity
    editor.setText('─\nx')
    const before = editor.render(1)
    patchEditorBorder(editor, theme, () => false)

    expect(editor.render(1)).toEqual(before)
  })

  test('updates rendered borders after repainting and reinstalling', () => {
    const editor = realEditor()
    patchEditorBorder(editor, theme, () => true)
    editor.borderColor = later
    expect(editor.render(20)[0]).toBe(theme.fg('borderMuted', '─').repeat(20))
    const replacement = { fg: (_color: 'borderMuted', text: string) => `<new>${text}</new>` }
    patchEditorBorder(editor, replacement, () => true)
    expect(editor.render(20)[0]).toBe(replacement.fg('borderMuted', '─').repeat(20))
    patchEditorBorder(editor, replacement, () => false)
    expect(editor.render(20)[0]).toBe(later('─').repeat(20))
    expect(editor.render(20)).toHaveLength(3)
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
