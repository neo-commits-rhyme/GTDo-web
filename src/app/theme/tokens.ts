/**
 * Paper — warm neutrals, amber completion.
 *
 * Every value here is measured in __tests__/contrast.test.ts. Change one and
 * the test tells you what it did, including the two bounds on `inkTertiary`
 * that stop it being promoted to carrying information.
 *
 * tokens.css mirrors these values; the test suite keeps the two in step.
 */
export const TOKENS = {
  paper: { light: '#FAF9F6', dark: '#191817' },
  /** Sidebar surface. Only 1.08:1 against paper — see the explicit border. */
  panel: { light: '#F2F0EA', dark: '#201F1D' },
  ink: { light: '#24221D', dark: '#ECEBE7' },
  inkSecondary: { light: '#6B655A', dark: '#A29C92' },
  /** 3.48 / 3.78 — disabled glyphs and placeholders ONLY. */
  inkTertiary: { light: '#8B8578', dark: '#79736A' },
  /** Completion. Light was #A8621B at exactly 4.50:1; now 5.44:1. */
  done: { light: '#96570F', dark: '#D99441' },
  overdue: { light: '#A8331B', dark: '#F0866A' },
  /** Hairlines. Decorative — never the only separator between information. */
  rule: { light: '#D6D0C2', dark: '#3A3631' },
  selection: { light: '#E4E0D4', dark: '#2B2926' },
} as const satisfies Record<string, { light: string; dark: string }>

export type TokenName = keyof typeof TOKENS

/** kebab-case custom-property name for a token. */
export function cssVar(name: TokenName): string {
  return `--${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`
}
