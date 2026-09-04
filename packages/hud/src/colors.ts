export type Rgb = { b: number; g: number; r: number }

type Oklab = { a: number; b: number; l: number }

export type RailTint =
  | 'agent'
  | 'arg'
  | 'ask'
  | 'branch'
  | 'caret'
  | 'dim'
  | 'faint'
  | 'duration'
  | 'fail'
  | 'head'
  | 'genome'
  | 'groupCaret'
  | 'headFail'
  | 'native'
  | 'neutral'
  | 'ok'
  | 'pseudo'
  | 'pseudoBody'
  | 'read'
  | 'shell'
  | 'text'
  | 'web'

export type RailPalette = { [K in RailTint]: string }

export const empryoBrand: Rgb = { b: 172, g: 105, r: 128 }
export const empryoBrandAlt: Rgb = { b: 240, g: 199, r: 167 }
export const empryoBrandDim: Rgb = { b: 69, g: 40, r: 46 }
export const empryoTextDim: Rgb = { b: 114, g: 88, r: 93 }
export const empryoTextFaint: Rgb = { b: 84, g: 62, r: 66 }
export const empryoTextMuted: Rgb = { b: 148, g: 119, r: 125 }
export const empryoTextPrimary: Rgb = { b: 242, g: 228, r: 232 }
export const empryoTextSecondary: Rgb = { b: 192, g: 164, r: 170 }

const empryoBackground: Rgb = { b: 28, g: 18, r: 20 }
const empryoError: Rgb = { b: 154, g: 140, r: 239 }
const empryoFile: Rgb = { b: 104, g: 173, r: 115 }
const empryoGenome: Rgb = { b: 104, g: 173, r: 155 }
const empryoShell: Rgb = { b: 155, g: 104, r: 173 }
const empryoSuccess: Rgb = { b: 171, g: 216, r: 159 }
const empryoUser: Rgb = { b: 232, g: 203, r: 151 }
const empryoWeb: Rgb = { b: 139, g: 173, r: 104 }

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

function linearChannel(value: number): number {
  const channel = value / 255
  const magnitude = Math.abs(channel)
  return magnitude <= 0.04045
    ? channel / 12.92
    : Math.sign(channel) * ((magnitude + 0.055) / 1.055) ** 2.4
}

function gammaChannel(value: number): number {
  const magnitude = Math.abs(value)
  const channel =
    magnitude > 0.0031308
      ? Math.sign(value) * (1.055 * magnitude ** (1 / 2.4) - 0.055)
      : value * 12.92
  return Math.max(0, Math.min(255, Math.round(channel * 255)))
}

function toOklab(color: Rgb): Oklab {
  const r = linearChannel(color.r)
  const g = linearChannel(color.g)
  const b = linearChannel(color.b)
  const l = Math.cbrt(0.412221469470763 * r + 0.5363325372617348 * g + 0.0514459932675022 * b)
  const m = Math.cbrt(0.2119034958178252 * r + 0.6806995506452344 * g + 0.1073969535369406 * b)
  const s = Math.cbrt(0.0883024591900564 * r + 0.2817188391361215 * g + 0.6299787016738222 * b)
  if (color.r === color.g && color.g === color.b) {
    return {
      a: 0,
      b: 0,
      l: 0.210454268309314 * l + 0.7936177747023054 * m - 0.0040720430116193 * s,
    }
  }
  return {
    a: 1.9779985324311684 * l - 2.42859224204858 * m + 0.450593709617411 * s,
    b: 0.0259040424655478 * l + 0.7827717124575296 * m - 0.8086757549230774 * s,
    l: 0.210454268309314 * l + 0.7936177747023054 * m - 0.0040720430116193 * s,
  }
}

function fromOklab(color: Oklab): Rgb {
  const l = (color.l + 0.3963377773761749 * color.a + 0.2158037573099136 * color.b) ** 3
  const m = (color.l - 0.1055613458156586 * color.a - 0.0638541728258133 * color.b) ** 3
  const s = (color.l - 0.0894841775298119 * color.a - 1.2914855480194092 * color.b) ** 3
  return {
    b: gammaChannel(-0.0041960761386756 * l - 0.7034186179359362 * m + 1.7076146940746117 * s),
    g: gammaChannel(-1.2684379732850317 * l + 2.6097573492876887 * m - 0.3413193760026573 * s),
    r: gammaChannel(4.076741636075957 * l - 3.3077115392580616 * m + 0.2309699031821044 * s),
  }
}

export function mixOklab(first: Rgb, second: Rgb, amount: number): Rgb {
  const clamped = Math.max(0, Math.min(1, amount))
  const from = toOklab(first)
  const to = toOklab(second)
  return fromOklab({
    a: from.a + (to.a - from.a) * clamped,
    b: from.b + (to.b - from.b) * clamped,
    l: from.l + (to.l - from.l) * clamped,
  })
}

export function applyOpacity(color: Rgb, opacity: number): Rgb {
  const alpha = Math.max(0, Math.min(255, Math.floor(opacity * 255)))
  return {
    b: Math.round((color.b * alpha) / 255),
    g: Math.round((color.g * alpha) / 255),
    r: Math.round((color.r * alpha) / 255),
  }
}

export function buildRailPalette(bodyOpacity = 1): RailPalette {
  const body = (color: Rgb) => ansiForeground(applyOpacity(color, bodyOpacity))
  const caret = mixOklab(empryoBrandAlt, empryoBackground, 0.3)
  const headFail = mixOklab(empryoError, empryoTextSecondary, 0.35)
  return {
    agent: body(empryoBrand),
    arg: body(empryoTextSecondary),
    ask: body(empryoShell),
    branch: body(empryoTextFaint),
    caret: ansiForeground(caret),
    dim: body(empryoTextDim),
    duration: body(empryoTextDim),
    fail: body(empryoError),
    faint: body(empryoTextFaint),
    genome: body(empryoGenome),
    groupCaret: body(empryoTextMuted),
    head: ansiForeground(empryoTextSecondary),
    headFail: ansiForeground(headFail),
    native: body(empryoFile),
    neutral: body(empryoTextMuted),
    ok: body(empryoSuccess),
    pseudo: body(empryoBrandDim),
    pseudoBody: body(empryoTextDim),
    read: body(empryoFile),
    shell: body(empryoShell),
    text: body(empryoTextPrimary),
    web: body(empryoWeb),
  }
}

export function railPaletteFromAnsi(bodyOpacity = 1): RailPalette {
  return buildRailPalette(bodyOpacity)
}

export function assistantAnsi(): string {
  return ansiForeground(empryoBrand)
}

export function userAnsi(): string {
  return ansiForeground(empryoUser)
}

export const ansiReset = '\x1b[39m'

export function tint(palette: RailPalette, key: RailTint, text: string): string {
  const ansi = palette[key]
  return ansi.length === 0 ? text : `${ansi}${text}${ansiReset}`
}
