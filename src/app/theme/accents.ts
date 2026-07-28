import { contrastRatio } from './contrast'
import { TOKENS } from './tokens'

/**
 * Seven accents. macOS has an eighth, `system`, which followed the OS accent
 * colour — that has no web meaning, so it is dropped rather than faked.
 *
 * Each pair is chosen to clear 4.5:1 against `paper` in its own scheme; the
 * test computes it, so a value that does not clear fails before it ships.
 * Stored in localStorage, never in data.json — no interop consequence.
 */
export const ACCENTS = [
  { id: 'amber', label: 'Amber', light: '#96570F', dark: '#D99441' },
  { id: 'ink', label: 'Ink', light: '#3B3830', dark: '#D8D4CB' },
  { id: 'rust', label: 'Rust', light: '#A8331B', dark: '#F0866A' },
  { id: 'olive', label: 'Olive', light: '#4F5D28', dark: '#A9BF6B' },
  { id: 'teal', label: 'Teal', light: '#0C6B63', dark: '#5FCFC2' },
  { id: 'indigo', label: 'Indigo', light: '#3A3E9E', dark: '#9AA0F0' },
  { id: 'plum', label: 'Plum', light: '#7A2E63', dark: '#DF93C4' },
] as const

export type AccentID = (typeof ACCENTS)[number]['id']
export const DEFAULT_ACCENT: AccentID = 'amber'
export const ACCENT_KEY = 'gtdo.accent'

export function accentByID(id: string): (typeof ACCENTS)[number] {
  return ACCENTS.find((a) => a.id === id) ?? ACCENTS[0]
}

/** Exposed for the test — the same computation it asserts against. */
export function accentRatios(accent: (typeof ACCENTS)[number]): { light: number; dark: number } {
  return {
    light: contrastRatio(accent.light, TOKENS.paper.light),
    dark: contrastRatio(accent.dark, TOKENS.paper.dark),
  }
}
