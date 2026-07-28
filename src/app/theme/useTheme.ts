import { useCallback, useEffect, useState } from 'react'

/**
 * System / Light / Dark, persisted in localStorage.
 *
 * Not part of data.json, so there is no interop consequence — the macOS app
 * keeps its own appearance setting and neither reads the other's.
 */

export const THEME_KEY = 'gtdo.theme'
export type ThemeChoice = 'system' | 'light' | 'dark'

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

/**
 * `system` removes the attribute entirely so prefers-color-scheme decides.
 * The explicit choices stamp data-theme, which tokens.css defines for both
 * schemes so the override wins in either direction.
 */
function apply(choice: ThemeChoice): void {
  if (choice === 'system') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', choice)
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
