import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type IconSet = {
  agent: string
  ask: string
  branch: string
  edit: string
  fail: string
  find: string
  ok: string
  pending: string
  read: string
  search: string
  shell: string
  todo: string
  tool: string
  web: string
}

export type IconKey = keyof IconSet

export type IconMode = 'ascii' | 'auto' | 'nerd'

const nerdIcons: IconSet = {
  agent: '\uF096',
  ask: '\uF059',
  branch: '\uF126',
  edit: '\uF044',
  fail: '✗',
  find: '\uF07C',
  ok: '✓',
  pending: '○',
  read: '\uF15C',
  search: '\uF002',
  shell: '\uF120',
  todo: '\uF0AE',
  tool: '\uF0AD',
  web: '\uF0AC',
}

const asciiIcons: IconSet = {
  agent: '▹',
  ask: '?',
  branch: '⑂',
  edit: '✎',
  fail: '✗',
  find: '△',
  ok: '✓',
  pending: '○',
  read: '□',
  search: '⊙',
  shell: '$',
  todo: '▤',
  tool: '⚒',
  web: '⊕',
}

const nerdTerminals = ['alacritty', 'ghostty', 'hyper', 'iterm', 'kitty', 'rio', 'wezterm']

function fontDirectories(): string[] {
  const home = homedir()
  if (process.platform === 'darwin') {
    return [join(home, 'Library', 'Fonts'), '/Library/Fonts', '/System/Library/Fonts']
  }
  if (process.platform === 'win32') {
    const windows = process.env.WINDIR ?? 'C:\\Windows'
    return [join(windows, 'Fonts'), join(home, 'AppData', 'Local', 'Microsoft', 'Windows', 'Fonts')]
  }
  return [join(home, '.local', 'share', 'fonts'), join(home, '.fonts'), '/usr/share/fonts']
}

export function hasNerdFontFile(directories: readonly string[]): boolean {
  for (const directory of directories) {
    if (!existsSync(directory)) continue
    try {
      for (const name of readdirSync(directory)) {
        if (/nerdfont|nerd font|symbolsnerd|NF\.(ttf|otf)$/iu.test(name)) return true
      }
    } catch {
      continue
    }
  }
  return false
}

export function terminalSuggestsNerdFont(program: string | undefined): boolean {
  const value = (program ?? '').toLowerCase()
  return value.length > 0 && nerdTerminals.some((name) => value.includes(name))
}

function detectNerdFont(): boolean {
  return hasNerdFontFile(fontDirectories()) || terminalSuggestsNerdFont(process.env.TERM_PROGRAM)
}

let mode: IconMode = 'auto'
let resolved: boolean | undefined

export function setIconMode(next: IconMode): void {
  mode = next
  resolved = undefined
}

export function usesNerdIcons(): boolean {
  if (mode === 'ascii') return false
  if (mode === 'nerd') return true
  resolved ??= detectNerdFont()
  return resolved
}

export function icon(key: IconKey): string {
  return usesNerdIcons() ? nerdIcons[key] : asciiIcons[key]
}
