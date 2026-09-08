import { readFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { stripFrontmatter } from '@earendil-works/pi-coding-agent'

import { aliases, type Skill } from './skills.ts'

function escapeAttribute(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

export async function expandAliases(text: string, skills: Skill[]): Promise<string | undefined> {
  const byName = new Map(skills.map((skill) => [skill.name, skill]))
  const references = aliases(text).filter((alias) => byName.has(alias.name))
  const selected = [...new Set(references.map((alias) => alias.name))].flatMap((name) => {
    const skill = byName.get(name)
    return skill ? [skill] : []
  })
  if (!selected.length) return undefined
  let prompt = text
  for (const alias of references.toReversed()) {
    prompt = prompt.slice(0, alias.start) + alias.name + prompt.slice(alias.end)
  }
  const first = selected[0]
  if (selected.length === 1 && first) return `/skill:${first.name} ${prompt}`
  const blocks = await Promise.all(
    selected.map(async (skill) => {
      const body = stripFrontmatter(await readFile(skill.path, 'utf8')).trim()
      return `<skill name="${escapeAttribute(skill.name)}" location="${escapeAttribute(skill.path)}">\nReferences are relative to ${dirname(skill.path)}.\n\n${body}\n</skill>`
    }),
  )
  return `${blocks.join('\n\n')}\n\n${prompt}`
}
