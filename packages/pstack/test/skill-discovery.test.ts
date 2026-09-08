import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadSkillsFromDir } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vite-plus/test'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const skillRoot = join(packageRoot, 'skills')

function principles(source: string): string[] {
  return [...new Set(source.match(/principle-[a-z-]+/g))].sort()
}

describe('bundled skill discovery', () => {
  it('loads the new principles as explicitly invoked Pi skills', () => {
    const result = loadSkillsFromDir({ dir: skillRoot, source: 'pstack' })
    expect(result.diagnostics).toEqual([])
    expect(
      result.skills
        .filter((skill) =>
          ['principle-attack-the-premise', 'principle-test-behavior-not-implementation'].includes(
            skill.name,
          ),
        )
        .map((skill) => ({ name: skill.name, manual: skill.disableModelInvocation }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    ).toEqual([
      { name: 'principle-attack-the-premise', manual: true },
      { name: 'principle-test-behavior-not-implementation', manual: true },
    ])
  })

  it('keeps the principle catalog and relative skill links resolvable', () => {
    const { skills } = loadSkillsFromDir({ dir: skillRoot, source: 'pstack' })
    const catalog = skills
      .filter((skill) => skill.name.startsWith('principle-'))
      .map((skill) => skill.name)
      .sort()
    expect(principles(readFileSync(join(packageRoot, 'README.md'), 'utf8'))).toEqual(catalog)
    expect(principles(readFileSync(join(skillRoot, 'poteto-mode', 'SKILL.md'), 'utf8'))).toEqual(
      catalog,
    )
    for (const skill of skills) {
      const source = readFileSync(skill.filePath, 'utf8')
      for (const match of source.matchAll(/\]\(([^)]+\/SKILL\.md)\)/g)) {
        const target = match[1]
        if (!target || !target.startsWith('.')) continue
        expect(skills.map((entry) => entry.filePath)).toContain(resolve(skill.baseDir, target))
      }
    }
  })
})
