import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'

import { getAgentDir } from '@earendil-works/pi-coding-agent'
import { Type, type Static } from 'typebox'
import { Value } from 'typebox/value'

const PatternSchema = Type.Union([
  Type.String(),
  Type.Object({
    pattern: Type.String(),
    replace: Type.Optional(Type.String()),
    flags: Type.Optional(Type.String()),
  }),
])
const RuleSchema = Type.Object({
  filePattern: Type.Union([Type.String(), Type.Array(Type.String())]),
  cloakPattern: Type.Union([PatternSchema, Type.Array(PatternSchema)]),
  replace: Type.Optional(Type.String()),
})
const ConfigSchema = Type.Object({
  enabled: Type.Optional(Type.Boolean()),
  cloakCharacter: Type.Optional(Type.String()),
  cloakLength: Type.Optional(
    Type.Union([Type.Null(), Type.Integer({ minimum: 0, maximum: 1_000_000 })]),
  ),
  tryAllPatterns: Type.Optional(Type.Boolean()),
  patterns: Type.Optional(Type.Array(RuleSchema)),
})

export type CloakConfig = Static<typeof ConfigSchema>
interface CloakRule {
  files: RegExp[]
  patterns: { regex: RegExp; replace: string | undefined }[]
}
export interface CloakState {
  configPath: string
  config: CloakConfig
  rules: CloakRule[]
  error: string | undefined
}

function normalizePath(path: string): string {
  const clean = path.trim().replace(/^@/, '').replaceAll('\\', '/')
  if (clean === '~') return homedir()
  return clean.startsWith('~/') ? join(homedir(), clean.slice(2)) : clean
}

function fileRegex(glob: string): RegExp {
  const normalized = normalizePath(glob)
  let source = '^'
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index] ?? ''
    if (char === '*' && normalized[index + 1] === '*') {
      const directory = normalized[index + 2] === '/'
      source += directory ? '(?:.*/)?' : '.*'
      index += directory ? 2 : 1
    } else if (char === '*') source += '[^/]*'
    else if (char === '?') source += '[^/]'
    else source += char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
  }
  return new RegExp(source + '$')
}

function compileRule(rule: Static<typeof RuleSchema>): CloakRule {
  const files = Array.isArray(rule.filePattern) ? rule.filePattern : [rule.filePattern]
  const patterns = Array.isArray(rule.cloakPattern) ? rule.cloakPattern : [rule.cloakPattern]
  return {
    files: files.map(fileRegex),
    patterns: patterns.map((spec) => {
      if (Value.Check(Type.String(), spec)) {
        return { regex: new RegExp(spec, 'g'), replace: rule.replace }
      }
      const flags = [...new Set((spec.flags ?? '') + 'g')].join('')
      return { regex: new RegExp(spec.pattern, flags), replace: spec.replace ?? rule.replace }
    }),
  }
}

export function loadState(configPath = join(getAgentDir(), 'cloak.json')): CloakState {
  try {
    const parsed: unknown = JSON.parse(readFileSync(configPath, 'utf8'))
    if (!Value.Check(ConfigSchema, parsed)) {
      return {
        configPath,
        config: {},
        rules: [],
        error: `pi-cloak invalid config at ${configPath}`,
      }
    }
    const config = {
      enabled: true,
      cloakCharacter: '*',
      cloakLength: null,
      tryAllPatterns: true,
      ...parsed,
    }
    return { configPath, config, rules: (config.patterns ?? []).map(compileRule), error: undefined }
  } catch (error) {
    const missing = error instanceof Error && 'code' in error && error.code === 'ENOENT'
    return {
      configPath,
      config: {},
      rules: [],
      error: missing
        ? `pi-cloak config not found at ${configPath}`
        : `pi-cloak failed to load ${configPath}: invalid JSON, regular expression, or unreadable file`,
    }
  }
}

function matchingRules(path: string, cwd: string, state: CloakState): CloakRule[] {
  const clean = normalizePath(path)
  const absolute = resolve(cwd, clean).replaceAll('\\', '/')
  const candidates = [clean, absolute, basename(clean), basename(absolute)]
  return state.rules.filter((rule) =>
    candidates.some((candidate) => rule.files.some((regex) => regex.test(candidate))),
  )
}

function maskMatch(
  match: RegExpExecArray,
  template: string | undefined,
  config: CloakConfig,
): string {
  const original = match[0]
  const visible = template
    ? template.replace(/\$(\$|&|\d{1,2})/g, (_token: string, group: string) => {
        if (group === '$') return '$'
        if (group === '&') return original
        const index = Number(group)
        return index > 0 ? (match[index] ?? '') : ''
      })
    : original.slice(0, 1)
  const length = config.cloakLength ?? Math.max(original.length, visible.length)
  const prefix = visible.slice(0, length)
  const remaining = length - prefix.length
  const character = config.cloakCharacter ?? '*'
  return (
    prefix +
    (character ? character.repeat(Math.ceil(remaining / character.length)).slice(0, remaining) : '')
  )
}

function maskLine(line: string, rules: CloakRule[], config: CloakConfig): string {
  let updated = line
  for (const rule of rules) {
    for (const pattern of rule.patterns) {
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags)
      let next = ''
      let offset = 0
      for (const match of updated.matchAll(regex)) {
        next += updated.slice(offset, match.index) + maskMatch(match, pattern.replace, config)
        offset = match.index + match[0].length
      }
      next += updated.slice(offset)
      const changed = next !== updated
      updated = next
      if (changed && config.tryAllPatterns === false) break
    }
  }
  return updated
}

export function cloakText(text: string, path: string, cwd: string, state: CloakState): string {
  if (state.config.enabled === false) return text
  const rules = matchingRules(path, cwd, state)
  if (rules.length === 0) return text
  return text
    .split(/(\r?\n)/)
    .map((line, index) => (index % 2 === 0 ? maskLine(line, rules, state.config) : line))
    .join('')
}
