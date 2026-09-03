import { buildRailPalette, type RailPalette } from '../src/colors.ts'

export function blankPalette(): RailPalette {
  const blank = buildRailPalette()
  for (const key of Object.keys(blank)) {
    Reflect.set(blank, key, '')
  }
  return blank
}
