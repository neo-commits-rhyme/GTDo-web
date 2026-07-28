import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { ACCENTS, ACCENT_KEY } from '../accents'
import { TOKENS } from '../tokens'
import { THEME_KEY, THEME_COLOR_OVERRIDE_ATTR } from '../useTheme'

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

/**
 * The head the stamp actually runs into, lifted from index.html so the two
 * cannot drift: the stamp has to insert itself IN FRONT of this pair.
 */
function seedThemeColorMetas(): void {
  document.head.querySelectorAll('meta[name="theme-color"]').forEach((m) => { m.remove() })
  for (const tag of html.match(/<meta name="theme-color"[^>]*>/g) ?? []) {
    document.head.insertAdjacentHTML('beforeend', tag)
  }
}

const themeColors = () => [...document.head.querySelectorAll('meta[name="theme-color"]')]

beforeEach(() => {
  localStorage.clear()
  root().removeAttribute('data-theme')
  root().removeAttribute('style')
  seedThemeColorMetas()
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

  it('areStampedWithTheChosenSchemeBeforeFirstPaint', () => {
    // Stamping data-theme alone left the pair above answering for the OS, so
    // the browser and PWA chrome painted the system scheme and flipped once
    // syncThemeColor ran from its effect — 9 ms warm, ~400 ms throttled cold.
    for (const scheme of ['light', 'dark'] as const) {
      seedThemeColorMetas()
      localStorage.setItem(THEME_KEY, scheme)
      runPrePaint()
      const first = themeColors()[0]
      expect(first?.getAttribute('content'), scheme).toBe(TOKENS.paper[scheme])
      expect(first?.getAttribute('media'), 'the override must match unconditionally').toBeNull()
    }
  })

  it('carryTheSamePaperHexesTheStampWrites', () => {
    // The stamp cannot import tokens.ts any more than it can import accents.ts,
    // so it duplicates both paper values; this is what keeps them in step.
    const source = prePaintSource()
    expect(source).toContain(TOKENS.paper.light)
    expect(source).toContain(TOKENS.paper.dark)
  })

  it('stayWithTheMediaQueryWhenNoSchemeIsStored', () => {
    for (const value of ['system', 'chartreuse']) {
      seedThemeColorMetas()
      localStorage.setItem(THEME_KEY, value)
      runPrePaint()
      expect(themeColors(), value).toHaveLength(2)
      expect(themeColors()[0]?.getAttribute('media'), value).toBe('(prefers-color-scheme: light)')
    }
  })

  it('handTheOverrideToUseThemeRatherThanLeaveASecondOne', () => {
    // syncThemeColor rewrites the meta carrying this attribute. Without it the
    // effect would insert its own override in front and the two would drift.
    localStorage.setItem(THEME_KEY, 'dark')
    runPrePaint()
    expect(prePaintSource()).toContain(THEME_COLOR_OVERRIDE_ATTR)
    expect(themeColors()[0]?.hasAttribute(THEME_COLOR_OVERRIDE_ATTR)).toBe(true)
    expect(themeColors()).toHaveLength(3)
  })
})

describe('The installed app chrome', () => {
  const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8')) as {
    theme_color?: string
    background_color?: string
  }

  it('leavesTheTitleBarToTheDocumentInsteadOfPinningItLight', () => {
    // A manifest cannot be media-conditional, so theme_color: paper-light gave
    // every dark install light chrome from launch. The document's theme-color
    // meta overrides it anyway and the stamp above now has that right before
    // the first paint, so the key could only ever be wrong or redundant.
    expect(manifest.theme_color).toBeUndefined()
  })

  it('keepsAFixedSplashBecauseNothingRunsBeforeIt', () => {
    // background_color paints the splash, before any document exists — no
    // script can reach it, and dropping it trades a warm launch for whatever
    // the UA picks. So the light paper stands, deliberately.
    expect(manifest.background_color).toBe(TOKENS.paper.light)
  })
})
