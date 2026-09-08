import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  CombinedAutocompleteProvider,
  CURSOR_MARKER,
  fuzzyFilter,
  ProcessTerminal,
  stripTerminalSequences,
  TuiMainScreen,
  visibleWidth,
} from '@earendil-works/pi-tui'
import { describe, expect, it } from 'vite-plus/test'

import { patchEditorBorder } from '../../hud/src/editor-border.ts'
import { KeybindingsManager } from '../node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.js'
import { createAutocomplete } from '../src/autocomplete.ts'
import { SkillEditor } from '../src/editor.ts'
import { expandAliases } from '../src/input.ts'
import { aliases, completionPrefix, type Skill } from '../src/skills.ts'

const skills: Skill[] = [
  { name: 'agent-browser', description: 'Browse websites', path: '/skills/browser/SKILL.md' },
  {
    name: 'add-dark-mode',
    description: 'Adapt colors for nighttime',
    path: '/skills/dark/SKILL.md',
  },
  ...Array.from({ length: 30 }, (_, i) => ({
    name: `test-${i}`,
    description: 'Test fixture',
    path: `/skills/test-${i}/SKILL.md`,
  })),
]
const native = new CombinedAutocompleteProvider(
  skills.map((skill) => ({ name: `skill:${skill.name}`, description: skill.description })),
  '/tmp',
)

async function suggestions(text: string) {
  return createAutocomplete(() => skills, native).getSuggestions([text], 0, text.length, {
    force: false,
    signal: new AbortController().signal,
  })
}

describe('inline completion', () => {
  it('uses native fuzzy ordering without the old twenty-item cap', async () => {
    expect((await suggestions('$'))?.items).toHaveLength(skills.length)
    for (const query of ['browser', 'agbr', 'DARK', 'tst']) {
      const expected = fuzzyFilter(skills, query, (skill) => skill.name).map(
        (skill) => `$${skill.name}`,
      )
      expect(
        (await suggestions(`use $${query}`))?.items
          .slice(0, expected.length)
          .map((item) => item.value),
      ).toEqual(expected)
    }
    expect((await suggestions('$nighttime'))?.items[0]?.value).toBe('$add-dark-mode')
  })

  it('delegates slash commands and keeps unknown aliases out of file completion', async () => {
    const text = '/skill:browser'
    expect(await suggestions(text)).toEqual(
      await native.getSuggestions([text], 0, text.length, {
        force: false,
        signal: new AbortController().signal,
      }),
    )
    expect(await suggestions('$nonexistent')).toBeNull()
  })

  it('replaces the whole token at the cursor without deleting surrounding text', () => {
    const provider = createAutocomplete(() => skills, native)
    const item = { value: '$agent-browser', label: '$agent-browser' }
    expect(provider.applyCompletion(['use $broWRONG now'], 0, 8, item, '$bro')).toEqual({
      lines: ['use $agent-browser now'],
      cursorLine: 0,
      cursorCol: 18,
    })
    expect(provider.applyCompletion(['$bro'], 0, 4, item, '$bro')).toEqual({
      lines: ['$agent-browser '],
      cursorLine: 0,
      cursorCol: 15,
    })
    expect(provider.applyCompletion(['use ($bro)'], 0, 9, item, '$bro').lines).toEqual([
      'use ($agent-browser)',
    ])
  })

  it('reads the live catalog for every completion', async () => {
    let current = skills
    const provider = createAutocomplete(() => current, native)
    current = [{ name: 'new-skill', description: 'New', path: '/new/SKILL.md' }]
    expect(
      (
        await provider.getSuggestions(['$'], 0, 1, {
          force: false,
          signal: new AbortController().signal,
        })
      )?.items.map((item) => item.value),
    ).toEqual(['$new-skill'])
  })
})

describe('alias recognition and expansion', () => {
  it('shares boundaries across completion, highlighting, and expansion', () => {
    expect(
      aliases('use ($agent-browser), then $add-dark-mode.').map((alias) => alias.name),
    ).toEqual(['agent-browser', 'add-dark-mode'])
    for (const text of [
      '\\$agent-browser',
      '$$agent-browser',
      'x$agent-browser',
      '`$agent-browser`',
      '```sh\n$agent-browser\n```',
      '~~~sh\n$agent-browser\n~~~',
      '!echo $agent-browser',
      '/skill:test $agent-browser',
      '$agent-browser/path',
    ]) {
      expect(aliases(text), text).toEqual([])
    }
    expect(completionPrefix(['use', '$BRO'], 1, 4)).toBe('$BRO')
    expect(completionPrefix(['`$bro'], 0, 5)).toBeUndefined()
  })

  it('leaves unknown skills unchanged and routes one skill through native expansion', async () => {
    expect(await expandAliases('$unknown', skills)).toBeUndefined()
    expect(await expandAliases('use $agent-browser then $agent-browser', skills)).toBe(
      '/skill:agent-browser use agent-browser then agent-browser',
    )
  })

  it('loads distinct skills once, strips frontmatter, and preserves relative reference roots', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'inline-skill-'))
    try {
      const selected = ['one', 'two'].map((name) => ({
        name,
        description: name,
        path: join(dir, `${name}.md`),
      }))
      await Promise.all(
        selected.map((skill) =>
          writeFile(skill.path, `---\nname: ${skill.name}\n---\nInstructions ${skill.name}\n`),
        ),
      )
      const expanded = await expandAliases('use $one and $two then $one', selected)
      expect(expanded?.match(/<skill name=/g)).toHaveLength(2)
      expect(expanded).toContain(`References are relative to ${dir}.`)
      expect(expanded).toContain('Instructions one')
      expect(expanded).not.toContain('---')
      expect(expanded).toContain('use one and two then one')
      await rm(selected[1]?.path ?? '', { force: true })
      await expect(expandAliases('$one $two', selected)).rejects.toThrow('ENOENT')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

class TestTerminal extends ProcessTerminal {
  override write(_data: string): void {}
  override hideCursor(): void {}
  override get rows() {
    return 20
  }
  override get columns() {
    return 80
  }
}

function editor() {
  const identity = (text: string) => text
  const instance = new SkillEditor(
    new TuiMainScreen(new TestTerminal()),
    {
      borderColor: identity,
      selectList: {
        selectedPrefix: identity,
        selectedText: identity,
        description: identity,
        scrollInfo: identity,
        noMatch: identity,
      },
    },
    new KeybindingsManager(),
    { embedWorkingStatus: true },
  )
  instance.getSkillNames = () => new Set(skills.map((skill) => skill.name))
  instance.colorSkill = (text) => `\x1b[35m${text}\x1b[39m`
  instance.focused = true
  return instance
}

function coloredText(rows: string[]): string {
  return (
    rows
      .join('')
      .match(new RegExp(`${String.fromCharCode(27)}\\[35m([^${String.fromCharCode(27)}]*)`, 'g'))
      ?.map((part) => part.slice(5))
      .join('') ?? ''
  )
}

describe('real Pi editor rendering', () => {
  it.each([false, true])('keeps the HUD separator blank while working=%s', (working) => {
    const instance = editor()
    instance.setText('$agent-browser')
    instance.handleInput('\x1b[D')
    const before = instance.render(40)
    const theme = { fg: (_color: 'borderMuted', text: string) => text }
    patchEditorBorder(instance, theme, () => working)
    patchEditorBorder(instance, theme, () => working)
    const after = instance.render(40)
    expect(after).toEqual([...before.slice(0, -1), ''])
    expect(coloredText(after)).toBe('$agent-browser')
    expect(after.join('')).toContain(CURSOR_MARKER)
    instance.setText('界😀 $agent-browser')
    for (const width of [12, 20, 40]) {
      const rows = instance.render(width)
      expect(rows.at(-1)).toBe('')
      expect(coloredText(rows)).toBe('$agent-browser')
    }
  })

  it('preserves inline completion below the blank HUD separator', async () => {
    const instance = editor()
    instance.setAutocompleteProvider(createAutocomplete(() => skills, native))
    patchEditorBorder(instance, { fg: (_color, text) => text }, () => false)
    instance.handleInput('$browser')
    await expect.poll(() => instance.isShowingAutocomplete()).toBe(true)
    const rows = instance.render(60)
    expect(rows[2]).toBe('')
    expect(rows.slice(3).join('')).toContain('$agent-browser')
    instance.handleInput('\t')
    expect(instance.getText()).toBe('$agent-browser ')
    expect(instance.render(60).at(-1)).toBe('')
    expect(coloredText(instance.render(60))).toBe('$agent-browser')
  })

  it('keeps highlighting at every cursor position without changing text, width, or IME markers', () => {
    const instance = editor()
    instance.setText('$agent-browser')
    for (let i = 0; i <= '$agent-browser'.length; i++) {
      const rows = instance.render(40)
      expect(coloredText(rows)).toBe('$agent-browser')
      expect(rows.join('')).toContain(CURSOR_MARKER)
      expect(rows.every((row) => visibleWidth(row) <= 40)).toBe(true)
      expect(stripTerminalSequences(rows[1] ?? '').trim()).toBe('$agent-browser')
      instance.handleInput('\x1b[D')
    }
    expect(instance.getText()).toBe('$agent-browser')
  })

  it('handles narrow wrapping, padding, Unicode, scrolling, and live colors', () => {
    const instance = editor()
    for (const padding of [0, 1, 2]) {
      instance.setPaddingX(padding)
      instance.setText('界😀 $agent-browser')
      for (const width of [12, 20, 40]) {
        const rows = instance.render(width)
        expect(coloredText(rows)).toBe('$agent-browser')
        expect(rows.every((row) => visibleWidth(row) <= width)).toBe(true)
      }
    }
    instance.setText('first\n'.repeat(12) + '$agent-browser')
    expect(coloredText(instance.render(40))).toBe('$agent-browser')
    instance.colorSkill = (text) => `\x1b[36m${text}\x1b[39m`
    expect(instance.render(40).join('')).not.toContain('\x1b[35m')
    expect(instance.render(40).join('')).toContain('\x1b[36m')
  })

  it('maps repeated rows and collapsed pastes without coloring literal occurrences', () => {
    const instance = editor()
    instance.setText('`$agent-browser`\n\n$agent-browser\n\n`$agent-browser`')
    expect(coloredText(instance.render(40))).toBe('$agent-browser')
    instance.setText('')
    instance.handleInput(`\x1b[200~${'large pasted text\n'.repeat(20)}\x1b[201~`)
    instance.insertTextAtCursor(' $agent-browser')
    expect(instance.getText()).toContain('[paste #')
    for (const width of [12, 20, 40]) {
      expect(coloredText(instance.render(width))).toBe('$agent-browser')
    }
    expect(instance.getExpandedText()).toContain('large pasted text')
  })

  it('keeps a partially offscreen alias highlighted while scrolling and resizing', () => {
    const instance = editor()
    instance.setText('$agent-browser')
    for (const width of [3, 5, 10]) {
      const rows = instance.render(width)
      const visible = rows
        .slice(1, -1)
        .map((row) => stripTerminalSequences(row).trim())
        .join('')
      expect(coloredText(rows)).toBe(visible)
      instance.handleInput('\x1b[D')
    }
  })

  it('does not highlight literal code, shell commands, or unknown aliases', () => {
    const instance = editor()
    for (const text of ['`$agent-browser`', '!echo $agent-browser', '$unknown']) {
      instance.setText(text)
      expect(coloredText(instance.render(40))).toBe('')
    }
  })
})
