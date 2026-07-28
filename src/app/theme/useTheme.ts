import { useCallback, useEffect, useState } from 'react'
import { TOKENS } from './tokens'

/**
 * System / Light / Dark, persisted in localStorage.
 *
 * Not part of data.json, so there is no interop consequence — the macOS app
 * keeps its own appearance setting and neither reads the other's.
 */

export const THEME_KEY = 'gtdo.theme'
export type ThemeChoice = 'system' | 'light' | 'dark'
/** What is actually on screen once `system` has been resolved. */
export type Scheme = 'light' | 'dark'

const DARK_QUERY = '(prefers-color-scheme: dark)'

const VALID: ThemeChoice[] = ['system', 'light', 'dark']

function stored(): ThemeChoice {
  try {
    const raw = localStorage.getItem(THEME_KEY)
    return VALID.includes(raw as ThemeChoice) ? (raw as ThemeChoice) : 'system'
  } catch {
    // Storage can be unavailable (private mode, blocked cookies); appearance
    // is not worth failing a render over.
    return 'system'
  }
}

const OVERRIDE_ATTR = 'data-theme-override'

/**
 * The two media-keyed metas in index.html answer for the OS, and nothing ever
 * updated them: a PWA forced to dark kept light browser chrome around a dark
 * app, permanently rather than just until the first paint.
 *
 * The browser reads the FIRST theme-color meta whose media matches, so the
 * override has to go in front of that pair — and has to leave again when the
 * choice returns to system, or the media query never gets its turn back.
 */
function syncThemeColor(choice: ThemeChoice): void {
  const head = document.head
  const existing = head.querySelector(`meta[name="theme-color"][${OVERRIDE_ATTR}]`)
  if (choice === 'system') {
    existing?.remove()
    return
  }
  const meta = existing ?? document.createElement('meta')
  meta.setAttribute('name', 'theme-color')
  meta.setAttribute(OVERRIDE_ATTR, '')
  meta.setAttribute('content', TOKENS.paper[choice])
  if (existing !== null) return
  const first = head.querySelector('meta[name="theme-color"]')
  if (first === null) head.appendChild(meta)
  else head.insertBefore(meta, first)
}

/**
 * `system` removes the attribute entirely so prefers-color-scheme decides.
 * The explicit choices stamp data-theme, which tokens.css defines for both
 * schemes so the override wins in either direction.
 *
 * index.html stamps the same attribute before first paint; this runs from an
 * effect, which is far too late to be the only place it happens.
 */
function apply(choice: ThemeChoice): void {
  if (choice === 'system') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', choice)
  syncThemeColor(choice)
}

function systemScheme(): Scheme {
  // No matchMedia outside a browser (jsdom has none at all); light is what the
  // stylesheet falls back to anyway.
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light'
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
}

/**
 * The scheme actually on screen.
 *
 * Anything that has to name a colour in JS needs this rather than the
 * preference: the accent swatches drew the light value under a dark theme, so
 * the picker advertised a colour the app would never paint.
 */
export function useResolvedScheme(choice: ThemeChoice): Scheme {
  const [system, setSystem] = useState<Scheme>(systemScheme)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined
    const query = window.matchMedia(DARK_QUERY)
    const update = () => { setSystem(query.matches ? 'dark' : 'light') }
    update()
    query.addEventListener('change', update)
    return () => { query.removeEventListener('change', update) }
  }, [])

  return choice === 'system' ? system : choice
}

export function useTheme(): [ThemeChoice, (c: ThemeChoice) => void] {
  const [choice, setChoice] = useState<ThemeChoice>(stored)

  useEffect(() => {
    apply(choice)
  }, [choice])

  const set = useCallback((next: ThemeChoice) => {
    try {
      localStorage.setItem(THEME_KEY, next)
    } catch {
      // Persisting is best-effort; the choice still applies for this session.
    }
    setChoice(next)
  }, [])

  return [choice, set]
}
