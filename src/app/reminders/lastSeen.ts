/**
 * When the user last had GTDo open. Bounds the catch-up window so the banner
 * reports what was missed since the last visit rather than everything
 * historical.
 *
 * Lives here rather than in core/ because it is browser storage — the purity
 * lint rule caught the first draft putting it in core/catchUp.ts.
 */

export const LAST_SEEN_KEY = 'gtdo.lastSeenAt'

export function readLastSeen(): Date | null {
  try {
    const raw = localStorage.getItem(LAST_SEEN_KEY)
    if (raw === null) return null
    const parsed = new Date(raw)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  } catch {
    return null
  }
}

export function writeLastSeen(at: Date): void {
  try {
    localStorage.setItem(LAST_SEEN_KEY, at.toISOString())
  } catch {
    // Best-effort. Losing the stamp costs one repeated banner, not data.
  }
}
