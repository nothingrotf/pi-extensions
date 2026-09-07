import type { Theme, ThemeColor } from '@earendil-works/pi-coding-agent'

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

export const hudBrand: Rgb = { b: 172, g: 105, r: 128 }
export const hudBrandAlt: Rgb = { b: 240, g: 199, r: 167 }
export const hudBrandDim: Rgb = { b: 69, g: 40, r: 46 }
export const hudTextDim: Rgb = { b: 114, g: 88, r: 93 }
export const hudTextFaint: Rgb = { b: 84, g: 62, r: 66 }
export const hudTextMuted: Rgb = { b: 148, g: 119, r: 125 }
export const hudTextPrimary: Rgb = { b: 242, g: 228, r: 232 }
export const hudTextSecondary: Rgb = { b: 192, g: 164, r: 170 }
export const hudSuccess: Rgb = { b: 171, g: 216, r: 159 }
export const hudInfo: Rgb = { b: 232, g: 203, r: 151 }
export const hudWarning: Rgb = { b: 143, g: 196, r: 240 }
export const hudError: Rgb = { b: 154, g: 140, r: 239 }
export const hudBackground: Rgb = { b: 28, g: 18, r: 20 }

export type HudPalette = {
  background: Rgb
  brand: Rgb
  brandAlt: Rgb
  brandDim: Rgb
  error: Rgb
  file: Rgb
  genome: Rgb
  info: Rgb
  shell: Rgb
  success: Rgb
  textDim: Rgb
  textFaint: Rgb
  textMuted: Rgb
  textPrimary: Rgb
  textSecondary: Rgb
  user: Rgb
  warning: Rgb
  web: Rgb
}

export type PaletteSource = Pick<Theme, 'getFgAnsi'> & Partial<Pick<Theme, 'getBgAnsi'>>

type Hsl = { h: number; l: number; s: number }

function toHsl(color: Rgb): Hsl {
  const r = color.r / 255
  const g = color.g / 255
  const b = color.b / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return { h: 0, l, s: 0 }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return { h: h * 60, l, s }
}

function fromHsl(color: Hsl): Rgb {
  const c = (1 - Math.abs(2 * color.l - 1)) * color.s
  const sector = (((color.h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((sector % 2) - 1))
  let [r, g, b] = [0, 0, 0]
  if (sector < 1) [r, g, b] = [c, x, 0]
  else if (sector < 2) [r, g, b] = [x, c, 0]
  else if (sector < 3) [r, g, b] = [0, c, x]
  else if (sector < 4) [r, g, b] = [0, x, c]
  else if (sector < 5) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const m = color.l - c / 2
  const channel = (value: number) => Math.max(0, Math.min(255, Math.round((value + m) * 255)))
  return { b: channel(b), g: channel(g), r: channel(r) }
}

const categoryOffsets = { file: 210, genome: 175, shell: 55, web: 250 }

export function categoryColors(
  brand: Rgb,
  error: Rgb,
): Pick<HudPalette, keyof typeof categoryOffsets> {
  const base = toHsl(brand)
  const avoid = toHsl(error)
  const s = Math.min(0.5, Math.max(0.3, base.s * 0.7))
  const l = Math.min(0.68, Math.max(0.52, base.l))
  const derive = (offset: number): Rgb => {
    let h = (base.h + offset) % 360
    const distance = Math.min(Math.abs(h - avoid.h), 360 - Math.abs(h - avoid.h))
    if (distance < 20) h = (h + 30) % 360
    return fromHsl({ h, l, s })
  }
  return {
    file: derive(categoryOffsets.file),
    genome: derive(categoryOffsets.genome),
    shell: derive(categoryOffsets.shell),
    web: derive(categoryOffsets.web),
  }
}

export const defaultHudPalette: HudPalette = {
  background: hudBackground,
  brand: hudBrand,
  brandAlt: hudBrandAlt,
  brandDim: hudBrandDim,
  error: hudError,
  info: hudInfo,
  success: hudSuccess,
  textDim: hudTextDim,
  textFaint: hudTextFaint,
  textMuted: hudTextMuted,
  textPrimary: hudTextPrimary,
  textSecondary: hudTextSecondary,
  user: hudInfo,
  warning: hudWarning,
  ...categoryColors(hudBrand, hudError),
}

const paletteTokens = [
  'accent',
  'error',
  'syntaxType',
  'mdLink',
  'borderMuted',
  'success',
  'dim',
  'mdQuoteBorder',
  'muted',
  'text',
  'toolOutput',
  'warning',
] as const satisfies readonly ThemeColor[]

const tierTolerance = 0.08
const tierStep = 0.04

const paletteCache = new WeakMap<PaletteSource, { fingerprint: string; palette: HudPalette }>()

export function paletteFromTheme(theme: PaletteSource | undefined): HudPalette {
  if (theme === undefined) return defaultHudPalette
  const backgroundAnsi = theme.getBgAnsi === undefined ? '' : theme.getBgAnsi('userMessageBg')
  const fingerprint = `${paletteTokens.map((token) => theme.getFgAnsi(token)).join('|')}|${backgroundAnsi}`
  const cached = paletteCache.get(theme)
  if (cached !== undefined && cached.fingerprint === fingerprint) return cached.palette
  const fg = (token: ThemeColor, fallback: Rgb) =>
    parseTrueColor(theme.getFgAnsi(token)) ?? fallback
  const background = parseTrueColor(backgroundAnsi) ?? hudBackground
  const textPrimary = fg('text', hudTextPrimary)
  let previousTier = oklabLightness(textPrimary)
  const tier = (token: ThemeColor, fallback: Rgb, amount: number): Rgb => {
    const expected = mixOklab(textPrimary, background, amount)
    const declared = parseTrueColor(theme.getFgAnsi(token))
    let chosen = declared ?? fallback
    if (declared !== undefined) {
      const lightness = oklabLightness(declared)
      const drift = Math.abs(lightness - oklabLightness(expected))
      const ordered = previousTier - lightness >= tierStep
      if (drift > tierTolerance || !ordered) chosen = expected
    }
    previousTier = oklabLightness(chosen)
    return chosen
  }
  const tiers = {
    secondary: tier('toolOutput', hudTextSecondary, 0.26),
    muted: tier('muted', hudTextMuted, 0.46),
    dim: tier('dim', hudTextDim, 0.61),
    faint: tier('mdQuoteBorder', hudTextFaint, 0.745),
  }
  const brand = fg('accent', hudBrand)
  const brandDim = (() => {
    const expected = mixOklab(brand, background, 0.72)
    const declared = parseTrueColor(theme.getFgAnsi('borderMuted'))
    if (declared === undefined) return hudBrandDim
    const drift = Math.abs(oklabLightness(declared) - oklabLightness(expected))
    return drift <= tierTolerance ? declared : expected
  })()
  const error = fg('error', hudError)
  const info = fg('syntaxType', hudInfo)
  const palette: HudPalette = {
    background,
    brand,
    brandAlt: fg('mdLink', hudBrandAlt),
    brandDim,
    error,
    info,
    success: fg('success', hudSuccess),
    textDim: tiers.dim,
    textFaint: tiers.faint,
    textMuted: tiers.muted,
    textPrimary,
    textSecondary: tiers.secondary,
    user: info,
    warning: fg('warning', hudWarning),
    ...categoryColors(brand, error),
  }
  paletteCache.set(theme, { fingerprint, palette })
  return palette
}

export function parseTrueColor(ansi: string): Rgb | undefined {
  const match = /[34]8;2;(\d+);(\d+);(\d+)m/u.exec(ansi)
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

export function oklabLightness(color: Rgb): number {
  return toOklab(color).l
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

export function buildRailPalette(
  bodyOpacity = 1,
  palette: HudPalette = defaultHudPalette,
): RailPalette {
  const body = (color: Rgb) => ansiForeground(applyOpacity(color, bodyOpacity))
  const caret = mixOklab(palette.brandAlt, palette.background, 0.3)
  const headFail = mixOklab(palette.error, palette.textSecondary, 0.35)
  return {
    agent: body(palette.brand),
    arg: body(palette.textSecondary),
    ask: body(palette.shell),
    branch: body(palette.textFaint),
    caret: ansiForeground(caret),
    dim: body(palette.textDim),
    duration: body(palette.textDim),
    fail: body(palette.error),
    faint: body(palette.textFaint),
    genome: body(palette.genome),
    groupCaret: body(palette.textMuted),
    head: ansiForeground(palette.textSecondary),
    headFail: ansiForeground(headFail),
    native: body(palette.file),
    neutral: body(palette.textMuted),
    ok: body(palette.success),
    pseudo: body(palette.brandDim),
    pseudoBody: body(palette.textDim),
    read: body(palette.file),
    shell: body(palette.shell),
    text: body(palette.textPrimary),
    web: body(palette.web),
  }
}

export function railPaletteFromAnsi(
  bodyOpacity = 1,
  palette: HudPalette = defaultHudPalette,
): RailPalette {
  return buildRailPalette(bodyOpacity, palette)
}

export function assistantAnsi(palette: HudPalette = defaultHudPalette): string {
  return ansiForeground(palette.brand)
}

export function userAnsi(palette: HudPalette = defaultHudPalette): string {
  return ansiForeground(palette.user)
}

export const ansiReset = '\x1b[39m'

export function tint(palette: RailPalette, key: RailTint, text: string): string {
  const ansi = palette[key]
  return ansi.length === 0 ? text : `${ansi}${text}${ansiReset}`
}
