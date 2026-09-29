import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

  it('initializes an existing empty log without losing its first decision', () => {
    const directory = mkdtempSync(join(tmpdir(), 'pstack-show-me-'))
    temporaryDirectories.push(directory)
    const logfile = join(directory, 'decisions.tsv')
    writeFileSync(logfile, '')
    execFileSync(join(skillRoot, 'scripts', 'log.sh'), [
      logfile,
      'verify',
      'first decision',
      'existing empty log',
      'pi-session://current',
      'open',
    ])
    const lines = readFileSync(logfile, 'utf8').trimEnd().split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe('ts\tphase\tdecision\twhy\tevidence\tresult')
    expect(lines[1].split('\t').slice(1)).toEqual([
      'verify',
      'first decision',
      'existing empty log',
      'pi-session://current',
      'open',
    ])
  })

  it('preserves earlier runs and appends a superseding decision', () => {
    const directory = mkdtempSync(join(tmpdir(), 'pstack-show-me-'))
    temporaryDirectories.push(directory)
    const logfile = join(directory, 'decisions.tsv')
    const header = 'ts\tphase\tdecision\twhy\tevidence\tresult'
    const previous = `${header}\n2026-09-23T00:00:00Z\tverify\tclaimed pass\twrong evidence\tpi-session://earlier\tpass\n`
    writeFileSync(logfile, previous)
    for (const row of [
      [
        'start',
        'resume audit',
        'earlier rows end at 2026-09-23T00:00:00Z',
        'pi-session://current',
        'open',
      ],
      [
        'audit',
        'supersede claimed pass at 2026-09-23T00:00:00Z',
        'no executed proof',
        'pi-session://current',
        'INCONCLUSIVE',
      ],
    ])
      execFileSync(join(skillRoot, 'scripts', 'log.sh'), [logfile, ...row])
    const output = readFileSync(logfile, 'utf8')
    expect(output.startsWith(previous)).toBe(true)
    const lines = output.trimEnd().split('\n')
    expect(lines).toHaveLength(4)
    expect(lines.filter((line) => line === header)).toHaveLength(1)
    expect(lines[2].split('\t')[1]).toBe('start')
    expect(lines[3].split('\t').slice(1)).toEqual([
      'audit',
      'supersede claimed pass at 2026-09-23T00:00:00Z',
      'no executed proof',
      'pi-session://current',
      'INCONCLUSIVE',
    ])
  })

  it('scopes append-only audits to identified session runs', () => {
    const skill = readFileSync(join(skillRoot, 'SKILL.md'), 'utf8')
    expect(skill).toContain('A run is one Pi session')
    expect(skill).toContain(
      "Before the first row, resolve this run's stable `pi-session://` reference",
    )
    expect(skill).toContain('recorded reference supplied by the parent')
    expect(skill).toContain('keep a separate log until the parent binds it')
    expect(skill).toContain('Do not append to a shared log without that identity')
    expect(skill).toContain('phase `start`')
    expect(skill).toContain('Never edit or remove a row during the audit')
    expect(skill).toContain("this run's rows")
    expect(skill).not.toContain('Cut invented or aspirational entries')
    expect(skill).not.toContain('Drop padding')
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
