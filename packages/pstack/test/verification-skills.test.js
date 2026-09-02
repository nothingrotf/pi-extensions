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
    expect(port).toContain('`.agents/skills/verify-<app>/`')
    expect(port).toContain('`AskQuestion`')
    expect(port).toContain('return `BLOCKED`')
    expect(port).toContain('Do not replace live verification with unit tests.')
    expect(port).toContain('`control-ui` or `control-cli`')
    expect(port).not.toMatch(/\.cursor\/skills|~\/\.cursor/)
  })

  it('maintains every feature through read-only source review and live control', () => {
    const port = skill('maintain-verification-skill')
    expect(port).toContain('`.pi/skills/verify-*/`')
    expect(port).toContain('`.agents/skills/verify-*/`')
    expect(port).toContain('use `AskQuestion` to select one')
    expect(port).toContain('one concurrent read-only `Task` node per feature file')
    expect(port).toContain('`readonly: true`')
    expect(port).toContain('Live verification is mandatory.')
    expect(port).toContain('Do not substitute unit tests for the live pass.')
    expect(port).not.toMatch(/\.cursor\/skills|~\/\.cursor/)
  })
})
