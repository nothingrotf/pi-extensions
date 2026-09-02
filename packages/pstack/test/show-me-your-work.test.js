import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vite-plus/test'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const skillRoot = join(packageRoot, 'skills', 'show-me-your-work')
const temporaryDirectories = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { force: true, recursive: true })
})

describe('show-me-your-work', () => {
  it('ships the helper and template', () => {
    expect(readFileSync(join(skillRoot, 'scripts', 'log.sh'), 'utf8')).toContain(
      'ts\\tphase\\tdecision\\twhy\\tevidence\\tresult',
    )
    expect(readFileSync(join(skillRoot, 'references', 'decision-log-template.tsv'), 'utf8')).toBe(
      'ts\tphase\tdecision\twhy\tevidence\tresult\n',
    )
  })

  it('uses Pi session history without Cursor transcript paths', () => {
    const skill = readFileSync(join(skillRoot, 'SKILL.md'), 'utf8')
    expect(skill).toContain('`session_history`')
    expect(skill).toContain('`pi-session://`')
    expect(skill).toContain('`Task`')
    expect(skill).not.toContain('agent-transcripts/')
    expect(skill).not.toContain('~/.cursor/')
  })

  it('writes safe single-line TSV cells', () => {
    const directory = mkdtempSync(join(tmpdir(), 'pstack-show-me-'))
    temporaryDirectories.push(directory)
    const logfile = join(directory, 'nested', 'decisions.tsv')
    execFileSync(join(skillRoot, 'scripts', 'log.sh'), [
      logfile,
      'phase\none',
      '=decision',
      'why\ttext',
      'artifact\rpath',
      '-result',
    ])
    const [header, row] = readFileSync(logfile, 'utf8').trimEnd().split('\n')
    expect(header).toBe('ts\tphase\tdecision\twhy\tevidence\tresult')
    expect(row.split('\t').slice(1)).toEqual([
      'phase one',
      "'=decision",
      'why text',
      'artifact path',
      "'-result",
    ])
    expect(row.split('\t')[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
  })
})
