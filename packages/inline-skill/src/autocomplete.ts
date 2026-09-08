import { type AutocompleteProvider, fuzzyFilter } from '@earendil-works/pi-tui'

import { completionPrefix, type Skill } from './skills.ts'

export function createAutocomplete(
  getSkills: () => Skill[],
  current: AutocompleteProvider,
): AutocompleteProvider {
  return {
    triggerCharacters: [...new Set([...(current.triggerCharacters ?? []), '$'])],
    async getSuggestions(lines, line, col, options) {
      const prefix = completionPrefix(lines, line, col)
      if (!prefix) return current.getSuggestions(lines, line, col, options)
      const skills = getSkills()
      const query = prefix.slice(1)
      const names = fuzzyFilter(skills, query, (skill) => skill.name)
      const matched = new Set(names.map((skill) => skill.name))
      const descriptions = query
        ? fuzzyFilter(skills, query, (skill) => skill.description).filter(
            (skill) => !matched.has(skill.name),
          )
        : []
      const items = [...names, ...descriptions].map((skill) => ({
        value: `$${skill.name}`,
        label: `$${skill.name}`,
        description: skill.description,
      }))
      return items.length ? { prefix, items } : null
    },
    applyCompletion(lines, line, col, item, prefix) {
      if (!prefix.startsWith('$') || !item.value.startsWith('$')) {
        return current.applyCompletion(lines, line, col, item, prefix)
      }
      const text = lines[line] ?? ''
      const start = col - prefix.length
      const tail = text.slice(col).replace(/^[A-Za-z0-9_-]*/, '')
      const space = tail.length === 0 || !/^[\s.,;:!?)\]}]/.test(tail) ? ' ' : ''
      const replacement = item.value + space
      const result = [...lines]
      result[line] = text.slice(0, start) + replacement + tail
      return { lines: result, cursorLine: line, cursorCol: start + replacement.length }
    },
    shouldTriggerFileCompletion(lines, line, col) {
      if (completionPrefix(lines, line, col)) return false
      return current.shouldTriggerFileCompletion?.(lines, line, col) ?? true
    },
  }
}
