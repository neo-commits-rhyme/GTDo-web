# GTDo Web — Visual Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the shipped app the *Paper* identity — warm neutrals, serif view titles, amber completion — without changing a single behaviour.

**Architecture:** Tokens land in one CSS file as custom properties with `prefers-color-scheme` defaults and a `data-theme` override. Components consume tokens only; no component hard-codes a colour. A contrast test computes every ratio from the token values, so the palette cannot regress silently.

**Tech Stack:** CSS custom properties, one self-hosted variable `woff2`, Web Audio (synthesised, no asset), Vitest + Testing Library.

**Spec:** `docs/specs/2026-07-28-visual-identity-design.md`. Read §2 before touching any colour.

## Global Constraints

- **No behaviour changes.** All 302 tests from sub-project 1 must still pass, untouched. If one breaks, this plan changed something it should not have.
- **Components never hard-code a colour.** Every colour is `var(--…)`. A lint-style grep in Task 1 enforces it.
- **Measured, never asserted.** Any new colour pair gets a computed ratio added to the contrast test *before* it appears in CSS.
- **`Ink-tertiary` may not carry information** — 3.48:1 light, 3.78:1 dark. Disabled glyphs and placeholders only.
- **Never colour alone.** Overdue = word change + weight + colour + `!` glyph. Completed = filled circle + strikethrough + secondary ink + section.
- **Interop vocabulary is closed.** The web may write only the 16 SF Symbol names and 12 hexes listed in spec §5. A 17th of either is a data-damage bug, not a feature.
- **No CDN.** The font is served from our own origin, subset, `woff2`, `font-display: swap`.
- **Conventional commits**, one per task.

---

### Task 1: Tokens, both schemes, and the contrast test that guards them

The test comes first deliberately: §2.1 of the spec exists because computing a ratio caught a value that looked fine.

**Files:**
- Create: `src/app/theme/tokens.ts`, `src/app/theme/tokens.css`, `src/app/theme/contrast.ts`
- Test: `src/app/theme/__tests__/contrast.test.ts`
- Modify: `src/app/styles.css` (import tokens, replace hard-coded colours)

**Interfaces:**
- Produces: `TOKENS: Record<string, { light: string; dark: string }>`, `contrastRatio(a: string, b: string): number`, `relativeLuminance(hex: string): number`

- [ ] **Step 1: Write the failing test**

`src/app/theme/__tests__/contrast.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { contrastRatio } from '../contrast'
import { TOKENS } from '../tokens'

const L = (name: string) => TOKENS[name]!.light
const D = (name: string) => TOKENS[name]!.dark

/** Every pair from spec §2, with the floor it must clear. */
const PAIRS: [name: string, fg: string, bg: string, floor: number][] = [
  ['ink on paper (light)', 'ink', 'paper', 4.5],
  ['ink on paper (dark)', 'ink', 'paper', 4.5],
  ['secondary on paper (light)', 'inkSecondary', 'paper', 4.5],
  ['secondary on paper (dark)', 'inkSecondary', 'paper', 4.5],
  ['done on paper (light)', 'done', 'paper', 4.5],
  ['done on paper (dark)', 'done', 'paper', 4.5],
  ['overdue on paper (light)', 'overdue', 'paper', 4.5],
  ['overdue on paper (dark)', 'overdue', 'paper', 4.5],
]

describe('Contrast', () => {
  it('computesKnownRatios', () => {
    // Sanity anchors: pure black on pure white is exactly 21:1.
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 2)
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5)
  })

  it.each(PAIRS)('%s clears its floor', (label, fg, bg, floor) => {
    const scheme = label.includes('dark') ? D : L
    const ratio = contrastRatio(scheme(fg), scheme(bg))
    expect(ratio, `${label}: ${scheme(fg)} on ${scheme(bg)} = ${ratio.toFixed(2)}:1`)
      .toBeGreaterThanOrEqual(floor)
  })

  it('theAmberThatFailedStaysFixed', () => {
    // #A8621B measured 4.50:1 — exactly on the threshold. Regression guard.
    expect(contrastRatio('#A8621B', '#FAF9F6')).toBeLessThan(4.51)
    expect(contrastRatio(L('done'), L('paper'))).toBeGreaterThan(5.0)
  })

  it('tertiaryIsUsableOnlyForNonInformationalContent', () => {
    // Legal for a disabled glyph (3:1), NOT legal as body text (4.5:1).
    for (const scheme of [L, D]) {
      const r = contrastRatio(scheme('inkTertiary'), scheme('paper'))
      expect(r).toBeGreaterThanOrEqual(3.0)
      expect(r).toBeLessThan(4.5)
    }
  })

  it('thePanelBoundaryIsDrawnNotInferred', () => {
    // Panel vs paper is ~1.08:1 in both schemes — nowhere near a perceivable
    // edge on its own, which is why the sidebar carries an explicit border.
    for (const scheme of [L, D]) {
      expect(contrastRatio(scheme('panel'), scheme('paper'))).toBeLessThan(1.2)
    }
    // The border itself must at least be visible as a hairline.
    for (const scheme of [L, D]) {
      expect(contrastRatio(scheme('rule'), scheme('paper'))).toBeGreaterThan(1.3)
    }
  })

  it('everyTokenIsDefinedInBothSchemes', () => {
    for (const [name, value] of Object.entries(TOKENS)) {
      expect(value.light, `${name} light`).toMatch(/^#[0-9A-F]{6}$/i)
      expect(value.dark, `${name} dark`).toMatch(/^#[0-9A-F]{6}$/i)
    }
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/app/theme`
Expected: FAIL — `Cannot find module '../contrast'`.

- [ ] **Step 3: Implement the tokens and the ratio maths**

`src/app/theme/contrast.ts`:

```ts
/** WCAG 2.1 relative luminance and contrast ratio. Used by the test that
 *  guards the palette, so the numbers in the spec are computed, not claimed. */

function channel(value: number): number {
  const c = value / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

export function relativeLuminance(hex: string): number {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const hi = Math.max(la, lb)
  const lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}
```

`src/app/theme/tokens.ts` — the single source of truth, mirrored into CSS in step 4:

```ts
/**
 * Paper. Every value here is measured in
 * src/app/theme/__tests__/contrast.test.ts — change one and the test tells you
 * what it did.
 */
export const TOKENS = {
  paper:        { light: '#FAF9F6', dark: '#191817' },
  panel:        { light: '#F2F0EA', dark: '#201F1D' },
  ink:          { light: '#24221D', dark: '#ECEBE7' },
  inkSecondary: { light: '#6B655A', dark: '#A29C92' },
  inkTertiary:  { light: '#8B8578', dark: '#79736A' },
  done:         { light: '#96570F', dark: '#D99441' },
  overdue:      { light: '#A8331B', dark: '#F0866A' },
  rule:         { light: '#D6D0C2', dark: '#3A3631' },
  selection:    { light: '#E4E0D4', dark: '#2B2926' },
} as const satisfies Record<string, { light: string; dark: string }>

export type TokenName = keyof typeof TOKENS

/** kebab-case custom-property name for a token. */
export function cssVar(name: TokenName): string {
  return `--${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`
}
```

- [ ] **Step 4: Write the stylesheet**

`src/app/theme/tokens.css` — values must match `tokens.ts` exactly:

```css
/* Paper. Mirrors src/app/theme/tokens.ts — keep the two in step. */
:root {
  --paper: #FAF9F6;
  --panel: #F2F0EA;
  --ink: #24221D;
  --ink-secondary: #6B655A;
  --ink-tertiary: #8B8578;
  --done: #96570F;
  --overdue: #A8331B;
  --rule: #D6D0C2;
  --selection: #E4E0D4;

  --serif: 'GTDo Serif', ui-serif, Georgia, serif;
  --sans: ui-sans-serif, -apple-system, system-ui, 'Segoe UI', sans-serif;
  --mono: ui-monospace, SFMono-Regular, Menlo, monospace;

  --spring-standard: 350ms cubic-bezier(0.22, 1, 0.36, 1);
  --spring-press: 250ms cubic-bezier(0.34, 1.56, 0.64, 1);
  --press-scale: 0.86;
}

@media (prefers-color-scheme: dark) {
  :root {
    --paper: #191817;
    --panel: #201F1D;
    --ink: #ECEBE7;
    --ink-secondary: #A29C92;
    --ink-tertiary: #79736A;
    --done: #D99441;
    --overdue: #F0866A;
    --rule: #3A3631;
    --selection: #2B2926;
  }
}

/* The manual switch must win in BOTH directions, so each scheme is stated
   explicitly rather than relying on the media query for one of them. */
:root[data-theme='light'] {
  --paper: #FAF9F6; --panel: #F2F0EA; --ink: #24221D;
  --ink-secondary: #6B655A; --ink-tertiary: #8B8578;
  --done: #96570F; --overdue: #A8331B; --rule: #D6D0C2; --selection: #E4E0D4;
}

:root[data-theme='dark'] {
  --paper: #191817; --panel: #201F1D; --ink: #ECEBE7;
  --ink-secondary: #A29C92; --ink-tertiary: #79736A;
  --done: #D99441; --overdue: #F0866A; --rule: #3A3631; --selection: #2B2926;
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --spring-standard: 150ms ease-in-out;
    --spring-press: 150ms ease-in-out;
    --press-scale: 1;
  }
}
```

- [ ] **Step 5: Rewrite `src/app/styles.css` to consume tokens**

Replace every hard-coded colour. Specifically: `--line` becomes `var(--rule)`; `.banner`'s `#ffe9e9`/`#7a0010` become `color-mix(in srgb, var(--overdue) 12%, var(--paper))` and `var(--overdue)`; `.row__gutter--overdue`'s `#b3000f` and `.detail__destructive`'s `#b3000f` become `var(--overdue)`; `.prompt__panel`'s `Canvas` becomes `var(--paper)`; `.nav__item--selected` and `.row--selected` use `var(--selection)`. Add to `body`: `background: var(--paper); color: var(--ink); font-family: var(--sans);`.

- [ ] **Step 6: Prove no hard-coded colours remain**

Run:

```bash
grep -nE '#[0-9a-fA-F]{3,6}|rgb\(|hsl\(' src/app/styles.css
```

Expected: no output. Any hit is a colour that escapes the token system and will be wrong in one of the two schemes.

- [ ] **Step 7: Run the tests**

Run: `npx vitest run && npx tsc --noEmit && npx eslint .`
Expected: PASS — the new contrast suite plus all 302 existing tests.

- [ ] **Step 8: Commit**

```bash
git add src/app/theme src/app/styles.css
git commit -m "feat: Paper tokens in both schemes, guarded by a contrast test"
```

---

### Task 2: Theme switch (System / Light / Dark)

**Files:**
- Create: `src/app/theme/useTheme.ts`
- Modify: `src/app/SettingsSheet.tsx`
- Test: `src/app/theme/__tests__/useTheme.test.tsx`

**Interfaces:**
- Consumes: `tokens.css` from Task 1.
- Produces: `type ThemeChoice = 'system' | 'light' | 'dark'`, `useTheme(): [ThemeChoice, (c: ThemeChoice) => void]`, `THEME_KEY = 'gtdo.theme'`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useTheme, THEME_KEY } from '../useTheme'

function Harness() {
  const [choice, setChoice] = useTheme()
  return (
    <>
      <span data-testid="choice">{choice}</span>
      <button onClick={() => setChoice('dark')}>dark</button>
      <button onClick={() => setChoice('system')}>system</button>
    </>
  )
}

beforeEach(() => { cleanup(); localStorage.clear(); document.documentElement.removeAttribute('data-theme') })

describe('useTheme', () => {
  it('defaultsToSystemAndSetsNoAttribute', () => {
    render(<Harness />)
    expect(screen.getByTestId('choice').textContent).toBe('system')
    // System means "let prefers-color-scheme decide" — no override present.
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('choosingDarkStampsTheRootAndPersists', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByText('dark'))
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(localStorage.getItem(THEME_KEY)).toBe('dark')
  })

  it('returningToSystemRemovesTheOverride', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByText('dark'))
    await user.click(screen.getByText('system'))
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    expect(localStorage.getItem(THEME_KEY)).toBe('system')
  })

  it('restoresAStoredChoiceOnMount', () => {
    localStorage.setItem(THEME_KEY, 'light')
    render(<Harness />)
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('ignoresAJunkStoredValue', () => {
    localStorage.setItem(THEME_KEY, 'chartreuse')
    render(<Harness />)
    expect(screen.getByTestId('choice').textContent).toBe('system')
  })
})
```

- [ ] **Step 2: Run it to verify it fails** — `npx vitest run src/app/theme`, expect FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
import { useCallback, useEffect, useState } from 'react'

export const THEME_KEY = 'gtdo.theme'
export type ThemeChoice = 'system' | 'light' | 'dark'

const VALID: ThemeChoice[] = ['system', 'light', 'dark']

function stored(): ThemeChoice {
  const raw = localStorage.getItem(THEME_KEY)
  return VALID.includes(raw as ThemeChoice) ? (raw as ThemeChoice) : 'system'
}

/** `system` removes the attribute entirely so prefers-color-scheme decides;
 *  the explicit choices stamp data-theme, which wins in both directions. */
function apply(choice: ThemeChoice): void {
  if (choice === 'system') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', choice)
}

export function useTheme(): [ThemeChoice, (c: ThemeChoice) => void] {
  const [choice, setChoice] = useState<ThemeChoice>(stored)
  useEffect(() => { apply(choice) }, [choice])

  const set = useCallback((next: ThemeChoice) => {
    localStorage.setItem(THEME_KEY, next)
    setChoice(next)
  }, [])

  return [choice, set]
}
```

- [ ] **Step 4: Add the control to Settings**

In `SettingsSheet.tsx`, above "Your data", add a radio group labelled `Appearance` with System / Light / Dark, driven by `useTheme()`.

- [ ] **Step 5: Run the tests** — `npx vitest run`, expect PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/theme src/app/SettingsSheet.tsx
git commit -m "feat: System/Light/Dark theme switch persisted in localStorage"
```

---

### Task 3: The serif, subset and self-hosted

**Files:**
- Create: `public/fonts/gtdo-serif.woff2`, `scripts/subset-font.sh`
- Modify: `src/app/theme/tokens.css`, `src/app/styles.css`
- Test: `src/app/theme/__tests__/typography.test.ts`

**Interfaces:**
- Produces: the `GTDo Serif` family, used only by `.list__title`.

- [ ] **Step 1: Fetch and subset the font**

`scripts/subset-font.sh` downloads Source Serif 4 Variable (SIL Open Font License) and subsets it with `pyftsubset`:

```bash
#!/usr/bin/env bash
# Subsets the variable serif to what the UI actually renders. Run once; the
# result is committed, so a build never depends on the network.
#
#   pip install fonttools brotli
#   ./scripts/subset-font.sh
set -euo pipefail
cd "$(dirname "$0")/.."

SRC="${1:-SourceSerif4Variable-Roman.ttf}"
[ -f "$SRC" ] || { echo "Place $SRC in the repo root first (SIL OFL)."; exit 1; }

mkdir -p public/fonts
pyftsubset "$SRC" \
  --output-file=public/fonts/gtdo-serif.woff2 \
  --flavor=woff2 \
  --layout-features='kern,liga,onum,tnum' \
  --unicodes='U+0020-007E,U+00A0-00FF,U+2018-201D,U+2026,U+2013,U+2014' \
  --name-IDs='' --drop-tables+=DSIG

ls -lh public/fonts/gtdo-serif.woff2
```

Expected: a file well under 100KB. Commit the `woff2`, not the source `ttf`.

- [ ] **Step 2: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync, statSync, existsSync } from 'node:fs'

describe('Typography', () => {
  it('theSerifIsSelfHostedAndSubset', () => {
    const path = 'public/fonts/gtdo-serif.woff2'
    expect(existsSync(path), 'run scripts/subset-font.sh').toBe(true)
    // A full variable serif is ~250KB; a correct subset is a fraction of that.
    expect(statSync(path).size).toBeLessThan(120_000)
  })

  it('theFontFaceIsLocalWithNoCDN', () => {
    const css = readFileSync('src/app/theme/tokens.css', 'utf8')
    expect(css).toContain('@font-face')
    expect(css).toContain('/fonts/gtdo-serif.woff2')
    expect(css).toContain('font-display: swap')
    // A strict CSP blocks third-party origins; the font must be ours.
    expect(css).not.toMatch(/https?:\/\//)
  })

  it('theSerifIsReservedForViewTitles', () => {
    const css = readFileSync('src/app/styles.css', 'utf8')
    const serifUsers = [...css.matchAll(/^\.([\w-]+)[^{]*\{[^}]*var\(--serif\)/gms)]
      .map((m) => m[1])
    expect(serifUsers).toEqual(['list__title'])
  })
})
```

- [ ] **Step 3: Run it to verify it fails** — expect FAIL on the missing `@font-face`.

- [ ] **Step 4: Declare the face and apply it**

Add to the top of `tokens.css`:

```css
@font-face {
  font-family: 'GTDo Serif';
  src: url('/GTDo-web/fonts/gtdo-serif.woff2') format('woff2-variations');
  font-weight: 200 900;
  font-style: normal;
  font-display: swap;
}
```

In `styles.css`, `.list__title` gets `font-family: var(--serif); font-weight: 600; letter-spacing: 0;`.

- [ ] **Step 5: Run the tests and build** — `npx vitest run && npx vite build`, expect PASS and the font copied into `dist/fonts/`.

- [ ] **Step 6: Commit**

```bash
git add public/fonts scripts/subset-font.sh src/app/theme/tokens.css src/app/styles.css
git commit -m "feat: self-hosted subset serif for view titles"
```

---

### Task 4: The 16 list icons

**Files:**
- Create: `src/app/ListIcon.tsx`, `src/app/theme/listPalette.ts`
- Test: `src/app/__tests__/listPalette.test.tsx`

**Interfaces:**
- Produces: `LIST_COLORS: { name: string; hex: string }[]` (12), `LIST_SYMBOLS: { name: string; label: string }[]` (16), `<ListIcon symbol={string} />`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { LIST_COLORS, LIST_SYMBOLS } from '../theme/listPalette'
import { ListIcon } from '../ListIcon'

/** Copied from Sources/GTDo/Theme/ListPalette.swift. The web may write only
 *  these values — anything else round-trips to macOS as an unknown symbol and
 *  renders as nothing. */
const SWIFT_HEXES = ['#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#00C7BE', '#30B0C7',
  '#007AFF', '#5856D6', '#AF52DE', '#FF2D55', '#A2845E', '#8E8E93']
const SWIFT_SYMBOLS = ['list.bullet', 'star', 'flag', 'tag', 'bookmark', 'bolt', 'flame',
  'leaf', 'heart', 'cart', 'briefcase', 'book', 'house', 'airplane',
  'graduationcap', 'dollarsign.circle']

describe('List palette', () => {
  it('theColourVocabularyIsExactlyTheSwiftOne', () => {
    expect(LIST_COLORS.map((c) => c.hex)).toEqual(SWIFT_HEXES)
  })

  it('theSymbolVocabularyIsExactlyTheSwiftOne', () => {
    expect(LIST_SYMBOLS.map((s) => s.name)).toEqual(SWIFT_SYMBOLS)
  })

  it('everySymbolRendersAGlyph', () => {
    for (const s of SWIFT_SYMBOLS) {
      const { container } = render(<ListIcon symbol={s} />)
      const svg = container.querySelector('svg')
      expect(svg, `${s} has no glyph`).not.toBeNull()
      expect(svg!.querySelector('path, circle, rect, line, polyline'), `${s} is empty`).not.toBeNull()
    }
  })

  it('anUnknownSymbolFallsBackRatherThanRenderingNothing', () => {
    // A file from a future macOS version may carry a symbol we do not draw.
    const { container } = render(<ListIcon symbol="sparkles" />)
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('iconsAreDecorativeAndNotAnnouncedTwice', () => {
    // The list name is already the accessible label.
    const { container } = render(<ListIcon symbol="star" />)
    expect(container.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true')
  })
})
```

- [ ] **Step 2: Run it to verify it fails** — expect FAIL (modules not found).

- [ ] **Step 3: Implement `listPalette.ts`**

```ts
/**
 * The closed interop vocabulary. Mirrors Sources/GTDo/Theme/ListPalette.swift.
 *
 * The web may write ONLY these values into list.colorHex and list.symbol. A
 * thirteenth colour or seventeenth icon would round-trip to macOS as an
 * unknown value — silent one-way data damage from a feature that looked like
 * it worked.
 */
export const LIST_COLORS = [
  { name: 'Red', hex: '#FF3B30' }, { name: 'Orange', hex: '#FF9500' },
  { name: 'Yellow', hex: '#FFCC00' }, { name: 'Green', hex: '#34C759' },
  { name: 'Mint', hex: '#00C7BE' }, { name: 'Teal', hex: '#30B0C7' },
  { name: 'Blue', hex: '#007AFF' }, { name: 'Indigo', hex: '#5856D6' },
  { name: 'Purple', hex: '#AF52DE' }, { name: 'Pink', hex: '#FF2D55' },
  { name: 'Brown', hex: '#A2845E' }, { name: 'Gray', hex: '#8E8E93' },
] as const

export const LIST_SYMBOLS = [
  { name: 'list.bullet', label: 'List' }, { name: 'star', label: 'Star' },
  { name: 'flag', label: 'Flag' }, { name: 'tag', label: 'Tag' },
  { name: 'bookmark', label: 'Bookmark' }, { name: 'bolt', label: 'Bolt' },
  { name: 'flame', label: 'Flame' }, { name: 'leaf', label: 'Leaf' },
  { name: 'heart', label: 'Heart' }, { name: 'cart', label: 'Cart' },
  { name: 'briefcase', label: 'Briefcase' }, { name: 'book', label: 'Book' },
  { name: 'house', label: 'House' }, { name: 'airplane', label: 'Airplane' },
  { name: 'graduationcap', label: 'Graduation Cap' },
  { name: 'dollarsign.circle', label: 'Money' },
] as const
```

- [ ] **Step 4: Implement `ListIcon.tsx`**

A `Record<string, ReactNode>` of 16 inline SVG path sets on a `0 0 16 16` viewBox, `stroke="currentColor"`, `fill="none"`, `stroke-width="1.5"`, `stroke-linecap="round"`, `stroke-linejoin="round"`. Unknown names fall back to the `list.bullet` glyph. The `<svg>` carries `aria-hidden="true"` and `focusable="false"` — the list name is already the accessible label.

- [ ] **Step 5: Run the tests** — expect PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add src/app/ListIcon.tsx src/app/theme/listPalette.ts src/app/__tests__/listPalette.test.tsx
git commit -m "feat: 16 list icons drawn against the SF Symbol vocabulary"
```

---

### Task 5: The list editor

**Files:**
- Create: `src/app/ListEditor.tsx`
- Modify: `src/app/Sidebar.tsx` (icon + colour in rows, an Edit affordance)
- Test: `src/app/__tests__/listEditor.test.tsx`

**Interfaces:**
- Consumes: `LIST_COLORS`, `LIST_SYMBOLS`, `ListIcon` from Task 4; `store.renameList`, `store.setListColor`, `store.setListSymbol` from sub-project 1.

- [ ] **Step 1: Write the failing test**

```tsx
it('offersExactlyTwelveColoursAndSixteenIcons', …)
it('choosingAColourStoresTheSwiftHex', …)          // #007AFF, not "blue"
it('choosingAnIconStoresTheSFSymbolName', …)       // "briefcase", not a path
it('renamingTrimsAndRejectsBlank', …)
it('builtInListsHaveNoEditAffordance', …)          // Inbox, Notes, Someday…
it('theSidebarRowShowsTheIconTintedByTheListColour', …)
it('aListWithNoCustomisationRendersTheDefaultGlyph', …)
it('theColourSwatchIsNotTheOnlyCueForTheSelectedSwatch', …)  // checkmark too
```

Port each assertion literally — the vocabulary tests are the interop guard, so
they must compare against the hex and symbol strings, never against a label.

- [ ] **Step 2: Run it to verify it fails** — expect FAIL.

- [ ] **Step 3: Implement.** The editor is a dialog with a name field, a 12-swatch grid and a 16-icon grid. A selected swatch carries a checkmark as well as a ring — colour alone may not indicate selection. Built-in lists never reach the editor, matching the Swift guards.

- [ ] **Step 4: Run the tests** — expect PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/ListEditor.tsx src/app/Sidebar.tsx src/app/__tests__/listEditor.test.tsx
git commit -m "feat: list editor with the closed colour and icon vocabulary"
```

---

### Task 6: Accent themes

**Files:**
- Create: `src/app/theme/useAccent.ts`
- Modify: `src/app/theme/tokens.css`, `src/app/SettingsSheet.tsx`
- Test: `src/app/theme/__tests__/useAccent.test.tsx`

**Interfaces:**
- Produces: `ACCENTS: { id: string; label: string; light: string; dark: string }[]` (7), `useAccent(): [string, (id: string) => void]`, `ACCENT_KEY = 'gtdo.accent'`

- [ ] **Step 1: Write the failing test**

```ts
it('offersSevenAccentsAndNotTheMacOSSystemOne', …)
  // macOS's eighth followed the OS accent colour; it has no web meaning and is
  // dropped rather than faked.
it('everyAccentClearsFourPointFiveOnPaperInBothSchemes', …)
  // Computed with contrastRatio, not eyeballed.
it('choosingAnAccentSetsTheCustomPropertyAndPersists', …)
it('defaultsToPaperAmberWhenNothingIsStored', …)
it('ignoresAJunkStoredValue', …)
```

- [ ] **Step 2: Run it to verify it fails** — expect FAIL.

- [ ] **Step 3: Implement.** Seven accents, each with a light and dark hex chosen to clear 4.5:1 against `paper` in its own scheme — the test computes it, so a value that does not clear fails before it ships. Applying one sets `--accent` on the root.

- [ ] **Step 4: Run the tests** — expect PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/theme src/app/SettingsSheet.tsx
git commit -m "feat: seven contrast-checked accent themes"
```

---

### Task 7: Completion feedback — motion and sound

**Files:**
- Create: `src/app/sound.ts`
- Modify: `src/app/TaskRow.tsx`, `src/app/styles.css`, `src/app/SettingsSheet.tsx`
- Test: `src/app/__tests__/completionFeedback.test.tsx`

**Interfaces:**
- Produces: `playCompletionSound(): void`, `SOUND_KEY = 'gtdo.completionSound'`, `completionSoundEnabled(): boolean`

- [ ] **Step 1: Write the failing test**

```ts
it('soundDefaultsOnMatchingMacOS', …)
it('completingPlaysExactlyOneToneUnCompletingPlaysNone', …)   // AudioContext spy
it('soundRespectsTheSettingsToggle', …)
it('aFailedAudioContextNeverBreaksCompletion', …)
  // Some browsers refuse an AudioContext outright; the task must still complete.
it('theCompletedCircleUsesTheDoneTokenNotAHardCodedColour', …)
it('reducedMotionRemovesTheScaleTransform', …)
```

- [ ] **Step 2: Run it to verify it fails** — expect FAIL.

- [ ] **Step 3: Implement `sound.ts`**

A lazily-created `AudioContext`, an `OscillatorNode` at ~880Hz through a `GainNode` with a 180ms exponential decay. Wrapped in try/catch: audio is a garnish, and a browser that refuses an `AudioContext` must not stop a task being completed. No asset file, so nothing to load and nothing to 404.

- [ ] **Step 4: Add the motion**

`.row__circle` gets `transition: transform var(--spring-press), background-color var(--spring-standard)` and `:active { transform: scale(var(--press-scale)) }`. Under reduced motion `--press-scale` is already `1` and the durations are already 150ms, so no separate rule is needed — that is the point of putting them in tokens.

- [ ] **Step 5: Run the tests** — expect PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/sound.ts src/app/TaskRow.tsx src/app/styles.css src/app/SettingsSheet.tsx
git commit -m "feat: completion spring and synthesised tone"
```

---

### Task 8: Visual verification and ship

**Files:**
- Modify: `e2e/smoke.spec.ts`, `README.md`
- Create: `e2e/appearance.spec.ts`

- [ ] **Step 1: Write the appearance E2E**

```ts
import { test, expect } from '@playwright/test'

test('renders in both colour schemes', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/GTDo-web/')
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible()
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible()
})

test('the serif actually loads', async ({ page }) => {
  await page.goto('/GTDo-web/')
  const loaded = await page.evaluate(async () => {
    await document.fonts.ready
    return document.fonts.check('16px "GTDo Serif"')
  })
  expect(loaded).toBe(true)
})

test('reduced motion removes the scale transform', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/GTDo-web/')
  const scale = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--press-scale').trim())
  expect(scale).toBe('1')
})
```

- [ ] **Step 2: Run everything**

Run: `npx tsc --noEmit && npx eslint . && npx vitest run && npx vite build && npx playwright test`
Expected: all PASS, including the 302 tests from sub-project 1 untouched.

- [ ] **Step 3: Look at the running app**

Run `npm run dev`, load sample data, and check by eye in both schemes: the sidebar edge is visible, no completed row is red, the gutter aligns, and the serif is rendering rather than falling back. Tests do not catch a rendering that is technically compliant and visually wrong — two of sub-project 1's bugs were found exactly this way.

- [ ] **Step 4: Update the README** — replace the "Not here yet" line for sub-project 2 with what shipped, and note the appearance setting.

- [ ] **Step 5: Commit and push**

```bash
git add -A
git commit -m "feat: ship the Paper identity"
git push origin main
```

---

## Verification against the spec

| Spec section | Task |
|---|---|
| §2 palette, measured | 1 |
| §2.1 the amber that failed | 1 (regression test) |
| §2.2 the panel boundary | 1 (border + test) |
| §2.3 constraining rules | 1, 5, 7 |
| §3 type | 3 |
| §4 motion | 1 (tokens), 7 (application) |
| §5 theme switch | 2 |
| §5 list icons | 4 |
| §5 list editor | 5 |
| §5 accents | 6 |
| §5 completion feedback | 7 |
| §5.1 the interop rule | 4, 5 |
| §6 testing | every task |
| §8 success criteria | 1 (1, 2), 5 (3), 7 (4), 8 (5) |
