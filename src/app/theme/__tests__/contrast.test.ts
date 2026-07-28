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
  // The destructive buttons are panel-filled, so paper says nothing about them.
  ['light', 'overdue', 'panel', 4.5],
  ['dark', 'overdue', 'panel', 4.5],
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

/**
 * Enough of a cascade to answer "what colour is actually painted".
 *
 * Reading a rule and assuming it wins is how `.detail__destructive` sat in the
 * stylesheet for months painting nothing: a lower-specificity rule loses no
 * matter how late it is declared, and nothing in the suite could see that.
 */
type Node = { tag: string; classes: string[] }

/** Top-level rules, flattened out of any @media wrapper, in source order. */
function rules(css: string): { selectors: string[]; body: string }[] {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '')
  return [...bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((m) => ({ selectors: m[1]!.split(',').map((s) => s.trim()), body: m[2]! }))
    .filter((r) => !r.selectors[0]!.startsWith('@'))
}

/**
 * One compound selector against one element. Any pseudo-class counts as a
 * non-match, which is correct for the resting, enabled elements asked about
 * below and stops the matcher pretending it understands :hover.
 */
function matchesCompound(compound: string, node: Node): boolean {
  const parts = compound.match(/\*|[a-zA-Z][\w-]*|\.[\w-]+|::?[\w-]+(?:\([^)]*\))?|\[[^\]]*\]/g) ?? []
  if (parts.join('') !== compound) return false
  return parts.every((p) => {
    if (p === '*') return true
    if (p.startsWith('.')) return node.classes.includes(p.slice(1))
    if (p.startsWith(':') || p.startsWith('[')) return false
    return p.toLowerCase() === node.tag
  })
}

/** Compounds and combinators, alternating, left to right. */
function sequence(selector: string): string[] {
  const seq: string[] = []
  for (const token of selector.trim().replace(/\s*([>+~])\s*/g, ' $1 ').split(/\s+/)) {
    if (!'>+~'.includes(token) && seq.length > 0 && !'>+~ '.includes(seq[seq.length - 1]!)) seq.push(' ')
    seq.push(token)
  }
  return seq
}

/** Rightmost-first, against an ancestor chain given outermost first. */
function matchesAt(seq: string[], si: number, chain: Node[], ci: number): boolean {
  if (ci < 0 || !matchesCompound(seq[si]!, chain[ci]!)) return false
  if (si === 0) return true
  const combinator = seq[si - 1]!
  if (combinator === '>') return matchesAt(seq, si - 2, chain, ci - 1)
  if (combinator !== ' ') return false
  for (let a = ci - 1; a >= 0; a--) if (matchesAt(seq, si - 2, chain, a)) return true
  return false
}

/** (ids, classes/attrs/pseudo-classes, types/pseudo-elements). */
function specificity(selector: string): [number, number, number] {
  const count = (re: RegExp) => selector.match(re)?.length ?? 0
  return [
    count(/#[\w-]+/g),
    count(/\.[\w-]+/g) + count(/\[[^\]]*\]/g) + count(/(?<!:):[\w-]+/g),
    count(/(?:^|[\s>+~])[a-zA-Z][\w-]*/g) + count(/::[\w-]+/g),
  ]
}

/** The declaration the cascade lands on: specificity first, source order last. */
function cascadedColor(css: string, chain: Node[]): string | null {
  let best: { spec: [number, number, number]; value: string } | null = null
  for (const rule of rules(css)) {
    const declared = [...rule.body.matchAll(/(?:^|;)\s*color:\s*([^;]+)/g)].pop()?.[1]?.trim()
    if (declared === undefined) continue
    for (const selector of rule.selectors) {
      const seq = sequence(selector)
      if (!matchesAt(seq, seq.length - 1, chain, chain.length - 1)) continue
      const spec = specificity(selector)
      const rank = (a: [number, number, number], b: [number, number, number]) =>
        a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
      if (best === null || rank(spec, best.spec) >= 0) best = { spec, value: declared }
    }
  }
  return best?.value ?? null
}

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

  it('theAccentReachesSurfacesThatNeedNoDataToExist', async () => {
    // The first version of the fix above routed the accent to completion only,
    // which measured 0 changed pixels on an app with no completed task — i.e.
    // the reported bug survived it for any new user. Completion is not enough:
    // at least one accent surface has to exist before the user has any data.
    //
    // Asserting the property is on the rule is all a static test can do; the
    // e2e counterpart (appearance.spec.ts) is what proves pixels actually move.
    const { readFileSync } = await import('node:fs')
    const styles = readFileSync('src/app/styles.css', 'utf8')

    // Exactly one .nav__item--selected exists at all times (the store's default
    // selection is the Today smart view), so this rail is unconditional.
    expect(styles, 'selected sidebar row must carry the accent').toMatch(
      /\.nav__item--selected::before \{[^}]*var\(--accent\)/,
    )
    // Below 700px the sidebar is not rendered, so the rail above is absent and
    // the title is the only surface left. TaskList renders it in every branch.
    expect(styles, 'list title must carry the accent').toMatch(
      /\.list__title \{[^}]*var\(--accent\)/,
    )
  })

  it('theDisabledListSelectDimsTheAffordanceNotTheDestination', async () => {
    // Chrome's UA sheet also puts opacity .7 on a disabled <select>, which the
    // computed colour does not show: --ink-tertiary painted the option at
    // 2.28:1 light / 2.48:1 dark, under even the 3:1 non-text floor that
    // tertiaryIsUsableOnlyForNonInformationalContent pins as the ceiling of its
    // legal use. The option text is the list a trashed task restores to — a
    // datum, not a label, so it is the one thing here that may not be greyed.
    const { readFileSync } = await import('node:fs')
    const css = readFileSync('src/app/styles.css', 'utf8')
    const offenders = rules(css)
      .filter((r) => /color:\s*var\(--ink-tertiary\)/.test(r.body))
      .flatMap((r) => r.selectors)
      .filter((s) => /\.detail__field\b.*\bselect\b/.test(s))
    expect(offenders, `these grey the list name itself: ${offenders.join(', ')}`).toEqual([])
  })

  it('theDestructiveRedOutranksTheContainerRulesThatMutedIt', async () => {
    // `.detail__destructive` is (0,1,0) and every container that holds one sets
    // --ink on the same element at (0,1,1), so source order never got a say:
    // "Move to trash", "Delete permanently" and "Reset all data" all painted
    // plain ink, leaving the wording as the only cue that they are one-way.
    const { readFileSync } = await import('node:fs')
    const css = readFileSync('src/app/styles.css', 'utf8')
    for (const container of ['detail__actions', 'settings__actions']) {
      const chain: Node[] = [
        { tag: 'div', classes: [container] },
        { tag: 'button', classes: ['detail__destructive'] },
      ]
      expect(cascadedColor(css, chain), container).toBe('var(--overdue)')
    }
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

  it('theSidebarRailIsVisibleForEveryAccent', async () => {
    // The rail sits on --selection, not on --paper, so clearing 4.5:1 against
    // paper says nothing about it. It is a non-text graphical indicator, so
    // the floor is 3:1 (WCAG 1.4.11) — and it is never the only cue, since the
    // selected row also carries a fill and a heavier weight.
    const { ACCENTS } = await import('../accents')
    for (const accent of ACCENTS) {
      const light = contrastRatio(accent.light, TOKENS.selection.light)
      const dark = contrastRatio(accent.dark, TOKENS.selection.dark)
      expect(light, `${accent.label} light = ${light.toFixed(2)}:1`).toBeGreaterThanOrEqual(3)
      expect(dark, `${accent.label} dark = ${dark.toFixed(2)}:1`).toBeGreaterThanOrEqual(3)
    }
  })

  it('theAddButtonStaysReadableForEveryAccent', async () => {
    // .addbar__submit is accent-on-panel, not accent-on-paper. It is a text
    // label, so the floor is the full 4.5:1.
    const { ACCENTS } = await import('../accents')
    for (const accent of ACCENTS) {
      const light = contrastRatio(accent.light, TOKENS.panel.light)
      const dark = contrastRatio(accent.dark, TOKENS.panel.dark)
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

  /**
   * The key cap's real ground, composed the way the stylesheet stacks it: the
   * rail's accent tint over paper, then whatever .review__key draws on top.
   * Read from the CSS rather than restated, so changing either rule moves the
   * number the test asserts.
   */
  function keyCapGround(css: string, accent: string, paper: string): string {
    const railRule = /\.review__choice \{([^}]*)\}/.exec(css)?.[1] ?? ''
    const railPct = /background: color-mix\(in srgb, var\(--accent\) (\d+)%/.exec(railRule)
    const rail = railPct === null ? paper : tint(accent, paper, Number(railPct[1]) / 100)

    const capRule = /\.review__key \{([^}]*)\}/.exec(css)?.[1] ?? ''
    const capPct = /background: color-mix\(in srgb, currentColor (\d+)%/.exec(capRule)
    if (capPct !== null) return tint(accent, rail, Number(capPct[1]) / 100)
    // An opaque token replaces the stack instead of deepening it.
    return /background: var\(--paper\)/.test(capRule) ? paper : rail
  }

  it('theShortcutKeyCapStaysReadableForEveryAccent', async () => {
    // The cap is a 10px <kbd> INSIDE .review__choice, so its own tint composes
    // with the rail's: 16% of currentColor over the rail's 10% landed at ~24%,
    // which put amber — the DEFAULT accent — at 3.87:1. Identical defect to the
    // 18% hover tint removed above, one level deeper in the stack. It is text,
    // so the floor is the full 4.5:1.
    const { readFileSync } = await import('node:fs')
    const { ACCENTS } = await import('../accents')
    const css = readFileSync('src/app/styles.css', 'utf8')
    for (const accent of ACCENTS) {
      for (const scheme of ['light', 'dark'] as const) {
        const ground = keyCapGround(css, accent[scheme], TOKENS.paper[scheme])
        const ratio = contrastRatio(accent[scheme], ground)
        expect(ratio, `${accent.label} ${scheme} on ${ground} = ${ratio.toFixed(2)}:1`)
          .toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})
