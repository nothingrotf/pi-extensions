import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

import { createAutocomplete } from './autocomplete.ts'
import { SkillEditor } from './editor.ts'
import { expandAliases } from './input.ts'
import { getSkills } from './skills.ts'

export default function inlineSkill(pi: ExtensionAPI): void {
  pi.on('session_start', (_event, ctx) => {
    if (ctx.mode !== 'tui') return
    ctx.ui.addAutocompleteProvider((current) => createAutocomplete(() => getSkills(pi), current))
    if (ctx.ui.getEditorComponent()) {
      ctx.ui.notify(
        'Inline skill: another custom editor owns highlighting. Skill completion remains available.',
        'warning',
      )
      return
    }
    ctx.ui.setEditorComponent((tui, _theme, keybindings) => {
      const editor = new SkillEditor(tui, _theme, keybindings, { embedWorkingStatus: true })
      editor.getSkillNames = () => new Set(getSkills(pi).map((skill) => skill.name))
      editor.colorSkill = (text) => ctx.ui.theme.fg('mdLink', text)
      return editor
    })
  })

  pi.on('input', async (event, ctx) => {
    if (event.source === 'extension') return { action: 'continue' }
    try {
      const text = await expandAliases(event.text, getSkills(pi))
      return text === undefined ? { action: 'continue' } : { action: 'transform', text }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!ctx.hasUI) throw error
      ctx.ui.notify(`Cannot load inline skills: ${message}`, 'error')
      ctx.ui.setEditorText(event.text)
      return { action: 'handled' }
    }
  })
}
