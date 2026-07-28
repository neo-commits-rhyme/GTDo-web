import { describe, it, expect } from 'vitest'
import { readFileSync, statSync, existsSync } from 'node:fs'

describe('Typography', () => {
  it('theSerifIsSelfHostedAndSubset', () => {
    const path = 'public/fonts/gtdo-serif.woff2'
    expect(existsSync(path), 'run scripts/subset-font.sh').toBe(true)
    // The unsubset variable TTF is 1.1MB; a correct subset is a fraction.
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

  it('theFontPathCarriesTheePagesBasePrefix', () => {
    // Without /GTDo-web/ the font 404s on a project Pages site.
    const css = readFileSync('src/app/theme/tokens.css', 'utf8')
    expect(css).toContain("url('/GTDo-web/fonts/gtdo-serif.woff2')")
  })

  it('theSerifIsReservedForViewTitles', () => {
    // Spec §3: view titles only. A dialog heading is not a view title.
    const css = readFileSync('src/app/styles.css', 'utf8')
    const users = [...css.matchAll(/\.([\w-]+)\s*\{[^}]*var\(--serif\)/g)].map((m) => m[1])
    expect(users).toEqual(['list__title'])
  })

  it('theGutterUsesTabularFiguresSoItAlignsDownTheColumn', () => {
    const css = readFileSync('src/app/styles.css', 'utf8')
    expect(css).toMatch(/\.row__gutter\s*\{[^}]*var\(--mono\)/)
    expect(css).toMatch(/\.row__gutter\s*\{[^}]*tabular-nums/)
  })
})
