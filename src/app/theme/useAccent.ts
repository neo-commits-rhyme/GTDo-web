import { useCallback, useEffect, useState } from 'react'
import { ACCENTS, ACCENT_KEY, DEFAULT_ACCENT, accentByID, type AccentID } from './accents'

/**
 * The accent is applied by writing --accent on the root, so every component
 * that already uses var(--accent) follows without knowing this hook exists.
 *
 * Both schemes are written at once: the media query cannot pick between two
 * inline values, so the light one is set and the dark one is exposed as
 * --accent-dark for tokens.css to prefer under a dark scheme.
 */
export function useAccent(): [AccentID, (id: AccentID) => void] {
  const [id, setID] = useState<AccentID>(() => {
    try {
      const raw = localStorage.getItem(ACCENT_KEY)
      return ACCENTS.some((a) => a.id === raw) ? (raw as AccentID) : DEFAULT_ACCENT
    } catch {
      return DEFAULT_ACCENT
    }
  })

  useEffect(() => {
    const accent = accentByID(id)
    const root = document.documentElement
    root.style.setProperty('--accent-light', accent.light)
    root.style.setProperty('--accent-dark', accent.dark)
  }, [id])

  const set = useCallback((next: AccentID) => {
    try {
      localStorage.setItem(ACCENT_KEY, next)
    } catch {
      // Best-effort; the choice still applies for this session.
    }
    setID(next)
  }, [])

  return [id, set]
}
