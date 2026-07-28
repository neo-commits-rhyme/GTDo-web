import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within, cleanup } from '@testing-library/react'
import { AppStore } from '../../../core/store'
import { MemoryAdapter } from '../../../storage/memoryAdapter'
import { StoreContext } from '../../useStore'
import { SettingsSheet } from '../../SettingsSheet'
import { ACCENTS, type AccentID } from '../accents'
import { contrastRatio, readableInkOn } from '../contrast'
import { TOKENS } from '../tokens'
import type { ThemeChoice } from '../useTheme'

const NOW = new Date(2026, 6, 28, 9, 0, 0)

/** jsdom has no matchMedia at all, so the OS preference has to be supplied. */
function systemPrefers(scheme: 'light' | 'dark'): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: scheme === 'dark' && query.includes('dark'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

async function mountSettings(theme: ThemeChoice, accent: AccentID = 'amber') {
  const store = await AppStore.create({
    adapter: new MemoryAdapter(),
    now: () => NOW,
    scheduler: (_ms, fn) => { fn() },
  })
  render(
    <StoreContext.Provider value={store}>
      <SettingsSheet
        onClose={() => {}}
        theme={theme}
        setTheme={() => {}}
        accent={accent}
        setAccent={() => {}}
      />
    </StoreContext.Provider>,
  )
  return screen.findByRole('radiogroup', { name: 'Accent colour' })
}

beforeEach(() => { cleanup(); localStorage.clear() })
afterEach(() => { vi.unstubAllGlobals() })

describe('The accent picker', () => {
  it('showsTheColourTheActiveSchemeWillActuallyPaint', async () => {
    // tokens.css resolves --accent to --accent-dark under a dark scheme, so a
    // swatch hard-coded to the light value advertises a colour the app never
    // paints: clicking the deep-green Teal chip turned the app bright aqua.
    systemPrefers('light')
    const group = await mountSettings('dark')
    for (const accent of ACCENTS) {
      const swatch = within(group).getByRole('radio', { name: accent.label })
      expect(swatch.style.getPropertyValue('--swatch'), accent.label).toBe(accent.dark)
    }
  })

  it('showsTheLightValueUnderALightTheme', async () => {
    systemPrefers('dark')
    const group = await mountSettings('light')
    for (const accent of ACCENTS) {
      const swatch = within(group).getByRole('radio', { name: accent.label })
      expect(swatch.style.getPropertyValue('--swatch'), accent.label).toBe(accent.light)
    }
  })

  it('followsTheOSWhenTheChoiceIsSystem', async () => {
    // `system` is a preference, not an answer — resolving it needs the query.
    systemPrefers('dark')
    const group = await mountSettings('system')
    for (const accent of ACCENTS) {
      const swatch = within(group).getByRole('radio', { name: accent.label })
      expect(swatch.style.getPropertyValue('--swatch'), accent.label).toBe(accent.dark)
    }
  })

  it('drawsEverySwatchVisiblyAgainstTheSchemeItIsShownOn', async () => {
    // A swatch is a non-text graphical control (WCAG 1.4.11), so the floor is
    // 3:1. The light values on dark paper measured 1.52 for Ink — a dark blob
    // on a dark ground, six of the seven under the floor.
    for (const scheme of ['light', 'dark'] as const) {
      cleanup()
      systemPrefers(scheme)
      const group = await mountSettings('system')
      for (const accent of ACCENTS) {
        const swatch = within(group).getByRole('radio', { name: accent.label })
        const hex = swatch.style.getPropertyValue('--swatch')
        const ratio = contrastRatio(hex, TOKENS.paper[scheme])
        expect(ratio, `${accent.label} ${scheme} ${hex} = ${ratio.toFixed(2)}:1`)
          .toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('picksAnInkForTheTickThatReadsOnTheColourActuallyDrawn', async () => {
    // readableInkOn must be fed the shown colour, not the light one: white on
    // the light Ink swatch and white on the dark Ink swatch are opposite calls.
    for (const scheme of ['light', 'dark'] as const) {
      for (const accent of ACCENTS) {
        cleanup()
        systemPrefers(scheme)
        const group = await mountSettings('system', accent.id)
        const swatch = within(group).getByRole('radio', { name: accent.label })
        const hex = swatch.style.getPropertyValue('--swatch')
        const ink = swatch.style.getPropertyValue('--swatch-ink')
        expect(ink, `${accent.label} ${scheme}`).toBe(readableInkOn(accent[scheme]))
        const ratio = contrastRatio(ink, hex)
        expect(ratio, `${accent.label} ${scheme} ${ink} on ${hex} = ${ratio.toFixed(2)}:1`)
          .toBeGreaterThanOrEqual(3)
      }
    }
  })
})
