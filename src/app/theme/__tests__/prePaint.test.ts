import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { ACCENTS, ACCENT_KEY } from '../accents'
import { TOKENS } from '../tokens'
import { THEME_KEY } from '../useTheme'

const html = readFileSync('index.html', 'utf8')

/** The one attribute-less <script> in the head — the pre-paint stamp. */
function prePaintSource(): string {
  const match = /<script>([\s\S]*?)<\/script>/.exec(html)
  expect(match, 'index.html must carry an inline pre-paint script').not.toBeNull()
  return match![1]!
}

function runPrePaint(): void {
  new Function(prePaintSource())()
}

const root = () => document.documentElement

beforeEach(() => {
  localStorage.clear()
  root().removeAttribute('data-theme')
  root().removeAttribute('style')
})

afterEach(() => { vi.restoreAllMocks() })

describe('The pre-paint stamp', () => {
  it('runsInTheHeadBeforeTheAppScript', () => {
    // Applied from an effect instead, the default paint lands first and the
    // whole app flips once React mounts — every load, for anyone whose choice
    // differs from their OS.
    const head = /<head>([\s\S]*?)<\/head>/.exec(html)?.[1] ?? ''
    expect(head, 'the stamp must be in <head>').toContain('<script>')
    expect(html.indexOf('<script>')).toBeLessThan(html.indexOf('src/main.tsx'))
  })

  it('stampsAStoredThemeBeforeReactMounts', () => {
    localStorage.setItem(THEME_KEY, 'dark')
    runPrePaint()
    expect(root().getAttribute('data-theme')).toBe('dark')
  })

  it('leavesSystemToTheMediaQuery', () => {
    localStorage.setItem(THEME_KEY, 'system')
    runPrePaint()
    expect(root().hasAttribute('data-theme')).toBe(false)
  })

  it('ignoresAJunkStoredTheme', () => {
    localStorage.setItem(THEME_KEY, 'chartreuse')
    runPrePaint()
    expect(root().hasAttribute('data-theme')).toBe(false)
  })

  it('stampsEveryAccentWithExactlyTheValuesUseAccentWouldHaveWritten', () => {
    // The stamp cannot import accents.ts, so it carries its own copy of the
    // palette. This is the only thing keeping the two in step.
    for (const accent of ACCENTS) {
      root().removeAttribute('style')
      localStorage.setItem(ACCENT_KEY, accent.id)
      runPrePaint()
      expect(root().style.getPropertyValue('--accent-light'), accent.label).toBe(accent.light)
      expect(root().style.getPropertyValue('--accent-dark'), accent.label).toBe(accent.dark)
    }
  })

  it('ignoresAJunkStoredAccent', () => {
    // `constructor` is the one that matters: a plain object lookup finds it on
    // the prototype and hands back a truthy value that is not a colour pair.
    for (const junk of ['chartreuse', 'constructor', 'toString']) {
      root().removeAttribute('style')
      localStorage.setItem(ACCENT_KEY, junk)
      runPrePaint()
      expect(root().style.getPropertyValue('--accent-light'), junk).toBe('')
    }
  })

  it('neverThrowsWhenStorageIsBlocked', () => {
    // It runs before everything else, so anything it throws takes the app with
    // it — and localStorage throws outright in some privacy modes.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('The operation is insecure.')
    })
    expect(() => { runPrePaint() }).not.toThrow()
  })
})

describe('The browser chrome metas', () => {
  it('carryThePaperColourOfEachScheme', () => {
    // An installed PWA paints its title bar from these; a value that drifts
    // from paper leaves a visible seam above the app.
    expect(html).toContain(`content="${TOKENS.paper.light}" media="(prefers-color-scheme: light)"`)
    expect(html).toContain(`content="${TOKENS.paper.dark}" media="(prefers-color-scheme: dark)"`)
  })
})
