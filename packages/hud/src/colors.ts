export type Rgb = { b: number; g: number; r: number }

export type RailTint =
  | 'agent'
  | 'arg'
  | 'ask'
  | 'branch'
  | 'caret'
  | 'dim'
  | 'fail'
  | 'head'
  | 'headFail'
  | 'native'
  | 'neutral'
  | 'ok'
  | 'read'
  | 'shell'
  | 'text'
  | 'web'

export type RailPalette = { [K in RailTint]: string }

const empryoAgent: Rgb = { b: 172, g: 105, r: 128 }
const empryoArg: Rgb = { b: 148, g: 119, r: 125 }
const empryoAsk: Rgb = { b: 114, g: 80, r: 123 }
const empryoBranch: Rgb = { b: 68, g: 43, r: 48 }
const empryoCaret: Rgb = { b: 167, g: 138, r: 123 }
const empryoDim: Rgb = { b: 84, g: 62, r: 66 }
const empryoFail: Rgb = { b: 116, g: 109, r: 169 }
const empryoHead: Rgb = { b: 192, g: 164, r: 170 }
const empryoHeadFail: Rgb = { b: 168, g: 153, r: 207 }
const empryoNative: Rgb = { b: 84, g: 130, r: 119 }
const empryoOk: Rgb = { b: 131, g: 161, r: 128 }
const empryoRead: Rgb = { b: 83, g: 129, r: 96 }
const empryoShell: Rgb = { b: 114, g: 80, r: 123 }
const empryoText: Rgb = { b: 242, g: 228, r: 232 }
const empryoUser: Rgb = { b: 232, g: 203, r: 151 }

export function parseTrueColor(ansi: string): Rgb | undefined {
  const match = /38;2;(\d+);(\d+);(\d+)m/u.exec(ansi)
  if (match === null) return undefined
  const [, r, g, b] = match
  if (r === undefined || g === undefined || b === undefined) return undefined
  return { b: Number(b), g: Number(g), r: Number(r) }
}

export function ansiForeground(rgb: Rgb): string {
  return `\x1b[38;2;${rgb.r};${rgb.g};${rgb.b}m`
}

export function buildRailPalette(): RailPalette {
  return {
    agent: ansiForeground(empryoAgent),
    arg: ansiForeground(empryoArg),
    ask: ansiForeground(empryoAsk),
    branch: ansiForeground(empryoBranch),
    caret: ansiForeground(empryoCaret),
    dim: ansiForeground(empryoDim),
    fail: ansiForeground(empryoFail),
    head: ansiForeground(empryoHead),
    headFail: ansiForeground(empryoHeadFail),
    native: ansiForeground(empryoNative),
    neutral: ansiForeground(empryoHead),
    ok: ansiForeground(empryoOk),
    read: ansiForeground(empryoRead),
    shell: ansiForeground(empryoShell),
    text: ansiForeground(empryoText),
    web: ansiForeground(empryoUser),
  }
}

export function railPaletteFromAnsi(): RailPalette {
  return buildRailPalette()
}

export function assistantAnsi(): string {
  return ansiForeground(empryoAgent)
}

export function userAnsi(): string {
  return ansiForeground(empryoUser)
}

export const ansiReset = '\x1b[39m'

export function tint(palette: RailPalette, key: RailTint, text: string): string {
  const ansi = palette[key]
  return ansi.length === 0 ? text : `${ansi}${text}${ansiReset}`
}
