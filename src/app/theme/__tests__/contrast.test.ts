import { describe, it, expect } from 'vitest'
import { contrastRatio } from '../contrast'
import { TOKENS, type TokenName } from '../tokens'

const L = (name: TokenName) => TOKENS[name].light
const D = (name: TokenName) => TOKENS[name].dark

/** Every pair from spec §2, with the floor it must clear. */
const PAIRS: [scheme: 'light' | 'dark', fg: TokenName, bg: TokenName, floor: number][] = [
  ['light', 'ink', 'paper', 4.5],
  ['dark', 'ink', 'paper', 4.5],
  ['light', 'inkSecondary', 'paper', 4.5],
  ['dark', 'inkSecondary', 'paper', 4.5],
  ['light', 'done', 'paper', 4.5],
  ['dark', 'done', 'paper', 4.5],
  ['light', 'overdue', 'paper', 4.5],
  ['dark', 'overdue', 'paper', 4.5],
  // Ink on the sidebar panel, not just on the canvas.
  ['light', 'ink', 'panel', 4.5],
  ['dark', 'ink', 'panel', 4.5],
  ['light', 'inkSecondary', 'panel', 4.5],
  ['dark', 'inkSecondary', 'panel', 4.5],
  // The selected sidebar row is a fill with a label on it.
  ['light', 'ink', 'selection', 4.5],
  ['dark', 'ink', 'selection', 4.5],
]

describe('Contrast', () => {
  it('computesKnownRatios', () => {
    // Anchors: pure black on pure white is exactly 21:1.
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 2)
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5)
    expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 1)
  })

  it.each(PAIRS)('%s: %s on %s clears %f', (scheme, fg, bg, floor) => {
    const pick = scheme === 'light' ? L : D
    const ratio = contrastRatio(pick(fg), pick(bg))
    expect(
      ratio,
      `${scheme} ${fg} on ${bg}: ${pick(fg)} on ${pick(bg)} = ${ratio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(floor)
  })

  it('theAmberThatFailedStaysFixed', () => {
    // #A8621B measured 4.50:1 — exactly on the threshold, where rounding puts
    // it under. Regression guard so it never comes back.
    expect(contrastRatio('#A8621B', '#FAF9F6')).toBeLessThan(4.51)
    expect(contrastRatio(L('done'), L('paper'))).toBeGreaterThan(5.0)
  })

  it('amberWorksAsAFillWithAMarkOnIt', () => {
    // The completed circle is a filled disc; whatever sits on it must read.
    expect(contrastRatio(L('paper'), L('done'))).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(D('paper'), D('done'))).toBeGreaterThanOrEqual(4.5)
  })

  it('tertiaryIsUsableOnlyForNonInformationalContent', () => {
    // Legal for a disabled glyph (3:1), NOT legal as body text (4.5:1). The
    // test asserts BOTH bounds so nobody promotes it to carrying information.
    for (const pick of [L, D]) {
      const r = contrastRatio(pick('inkTertiary'), pick('paper'))
      expect(r).toBeGreaterThanOrEqual(3.0)
      expect(r).toBeLessThan(4.5)
    }
  })

  it('thePanelBoundaryIsDrawnNotInferred', () => {
    // Panel vs paper is ~1.08:1 — nowhere near a perceivable edge on its own,
    // which is exactly why the sidebar carries an explicit border.
    for (const pick of [L, D]) {
      expect(contrastRatio(pick('panel'), pick('paper'))).toBeLessThan(1.2)
      expect(contrastRatio(pick('rule'), pick('paper'))).toBeGreaterThan(1.3)
    }
  })

  it('everyTokenIsDefinedInBothSchemes', () => {
    // A token defined in light but not dark is a black-on-black bug waiting
    // for nightfall.
    for (const [name, value] of Object.entries(TOKENS)) {
      expect(value.light, `${name} light`).toMatch(/^#[0-9A-F]{6}$/i)
      expect(value.dark, `${name} dark`).toMatch(/^#[0-9A-F]{6}$/i)
    }
  })
})

describe('Stylesheet discipline', () => {
  it('noComponentStylesheetNamesAColour', async () => {
    // Every colour must be a token, or one of the two schemes will be wrong.
    const { readFileSync } = await import('node:fs')
    const css = readFileSync('src/app/styles.css', 'utf8')
    const literals = css.match(/#[0-9a-fA-F]{3,8}\b|\brgb\(|\bhsl\(/g) ?? []
    expect(literals, `found colour literals: ${literals.join(', ')}`).toEqual([])
  })

  it('tokensCSSMatchesTokensTS', async () => {
    const { readFileSync } = await import('node:fs')
    const css = readFileSync('src/app/theme/tokens.css', 'utf8')
    for (const [name, value] of Object.entries(TOKENS)) {
      // `done` is derived from the accent rather than declared literally; its
      // TOKENS entry is the default, and the accent fallbacks in tokens.css
      // carry those exact values.
      if (name === 'done') {
        expect(css).toContain(`--accent: var(--accent-light, ${value.light})`)
        expect(css).toContain(`--accent: var(--accent-dark, ${value.dark})`)
        expect(css).toContain('--done: var(--accent)')
        continue
      }
      const prop = `--${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`
      expect(css, `${prop} light`).toContain(`${prop}: ${value.light}`)
      expect(css, `${prop} dark`).toContain(`${prop}: ${value.dark}`)
    }
  })

  it('theAccentReachesSomethingThatIsActuallyDrawn', async () => {
    // The bug this guards: the accent changed a token nothing rendered, so
    // choosing a colour did nothing you could see. Completion is where this
    // design puts colour, so that is what it drives.
    const { readFileSync } = await import('node:fs')
    const css = readFileSync('src/app/theme/tokens.css', 'utf8')
    expect(css).toContain('--done: var(--accent)')

    const styles = readFileSync('src/app/styles.css', 'utf8')
    // Completed rows are on screen in normal use, unlike a focus ring.
    expect(styles).toMatch(/\.row--done \.row__circle \{[^}]*var\(--done\)/)
  })
})

describe('Swatch legibility', () => {
  it('everySwatchCheckmarkClearsNonTextContrast', async () => {
    // A fixed white tick fails badly on the yellow and mint swatches;
    // readableInkOn picks per swatch.
    //
    // The floor is 3:1, not 4.5:1: the tick is a non-text graphical indicator
    // of state (WCAG 1.4.11), and it is never the only one — the swatch also
    // carries a ring. Blue #007AFF is the worst case in the palette and clears
    // neither 4.5:1 option, which is how the right standard got identified.
    const { LIST_COLORS } = await import('../listPalette')
    const { readableInkOn } = await import('../contrast')
    for (const c of LIST_COLORS) {
      const ink = readableInkOn(c.hex)
      const ratio = contrastRatio(ink, c.hex)
      expect(ratio, `${c.name} ${c.hex} with ${ink} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3.0)
    }
  })

  it('readableInkPicksTheBetterOfTheTwoEveryTime', async () => {
    const { LIST_COLORS } = await import('../listPalette')
    const { readableInkOn } = await import('../contrast')
    for (const c of LIST_COLORS) {
      const chosen = contrastRatio(readableInkOn(c.hex), c.hex)
      const other = Math.min(contrastRatio('#FFFFFF', c.hex), contrastRatio('#1A1A1A', c.hex))
      expect(chosen, c.name).toBeGreaterThanOrEqual(other)
    }
  })

  it('aFixedWhiteTickWouldHaveFailed', () => {
    // Documents why readableInkOn exists rather than a constant.
    expect(contrastRatio('#FFFFFF', '#FFCC00')).toBeLessThan(2)
  })
})

describe('Accent-on-accent surfaces', () => {
  /** color-mix(in srgb, fg pct%, transparent) composited over bg. */
  function tint(fg: string, bg: string, pct: number): string {
    const parse = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
    const [fr, fg2, fb] = parse(fg)
    const [br, bg2, bb] = parse(bg)
    const c = (f: number, b: number) => Math.round(f * pct + b * (1 - pct))
    return `#${[c(fr!, br!), c(fg2!, bg2!), c(fb!, bb!)]
      .map((n) => n.toString(16).padStart(2, '0'))
      .join('')}`
  }

  it('reviewChoicesStayReadableForEveryAccent', async () => {
    // The rail draws accent text on a 10% tint of the same accent. Hover used
    // to deepen that to 18%, which put amber — the DEFAULT accent — at 4.24:1.
    // Hover is now a ring, so the only tint to check is the resting one.
    const { ACCENTS } = await import('../accents')
    for (const accent of ACCENTS) {
      const light = contrastRatio(accent.light, tint(accent.light, TOKENS.paper.light, 0.1))
      const dark = contrastRatio(accent.dark, tint(accent.dark, TOKENS.paper.dark, 0.1))
      expect(light, `${accent.label} light = ${light.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
      expect(dark, `${accent.label} dark = ${dark.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('hoverDoesNotDeepenTheTint', async () => {
    const { readFileSync } = await import('node:fs')
    const css = readFileSync('src/app/styles.css', 'utf8')
    const hover = /\.review__choice:hover \{([^}]*)\}/.exec(css)
    expect(hover, '.review__choice:hover must exist').not.toBeNull()
    expect(hover![1], 'hover must not change the background tint').not.toContain('background')
  })
})
