import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vite-plus/test'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))

function skill(name) {
  return readFileSync(join(packageRoot, 'skills', name, 'SKILL.md'), 'utf8')
}

describe('verification skills', () => {
  it('ships complete feature-map examples', () => {
    const exampleRoot = join(
      packageRoot,
      'skills',
      'create-verification-skill',
      'references',
      'feature-map-example',
    )
    expect(readFileSync(join(exampleRoot, 'README.md'), 'utf8')).toContain(
      '# Notes verification map',
    )
    expect(readFileSync(join(exampleRoot, 'create-note.md'), 'utf8')).toContain('# Create a note')
    expect(readFileSync(join(exampleRoot, 'search.md'), 'utf8')).toContain('# Search notes')
  })

  it('creates project-local Pi skills with real capability gates', () => {
    const port = skill('create-verification-skill')
    expect(port).toContain('`.pi/skills/verify-<app>/`')
    expect(port).toContain('A generated skill that was never executed is a draft')
    expect(port).not.toMatch(/\.cursor\/skills|~\/\.cursor/)
  })

  it('maintains every feature through read-only source review and live control', () => {
    const port = skill('maintain-verification-skill')
    expect(port).toContain('`.pi/skills/verify-*/`')
    expect(port).toContain('One read-only `Task` per feature file')
    expect(port).toContain('`readonly: true`')
    expect(port).toContain('Required even when source looks clean.')
    expect(port).not.toMatch(/\.cursor\/skills|~\/\.cursor/)
  })
})
