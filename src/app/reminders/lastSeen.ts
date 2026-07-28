/**
 * When the user last had GTDo open. Bounds the catch-up window so the banner
 * reports what was missed since the last visit rather than everything
 * historical.
 *
 * Lives here rather than in core/ because it is browser storage — the purity
 * lint rule caught the first draft putting it in core/catchUp.ts.
 */

export const LAST_SEEN_KEY = 'gtdo.lastSeenAt'

/** How often the stamp is refreshed while the tab is open and visible. */
export const HEARTBEAT_MS = 30_000

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

let sessionSince: Date | null | undefined

/**
 * The stamp as it stood when this tab opened.
 *
 * Anything asking "what did the user miss" wants this and never readLastSeen():
 * the heartbeat below keeps moving the stored stamp forward, so by the time the
 * banner renders the stored value already says now and nothing looks missed.
 */
export function sinceLastOpen(): Date | null {
  if (sessionSince === undefined) sessionSince = readLastSeen()
  return sessionSince
}

/**
 * Records that the user has been shown everything up to `at`.
 *
 * Moves this tab's latched view too — advancing only the stored stamp would let
 * a remount read the still-old latch and put the same list straight back up.
 */
export function markCaughtUp(at: Date): void {
  sessionSince = at
  writeLastSeen(at)
}

/**
 * Keeps the stamp meaning what its name says: the last time GTDo was open.
 *
 * It used to be written in exactly one place — the catch-up banner's dismiss
 * button — so it really meant "last dismissal". A reminder that fired live,
 * with the app open in front of the user, came back on the next launch as
 * something missed while GTDo was closed, and for anyone who had never
 * dismissed a banner it came back on every launch after that as well.
 *
 * Stamped on start, on a heartbeat while visible, and on the way out, because
 * pagehide never runs for a browser that is killed or a machine that dies.
 *
 * Returns a stop function. Latches sinceLastOpen() before the first write: the
 * catch-up set has to be computed from the old stamp, so advancing it first
 * would suppress the very reminders the banner exists to report.
 */
export function startLastSeenHeartbeat(now: () => Date = () => new Date()): () => void {
  sinceLastOpen()
  const stamp = () => { writeLastSeen(now()) }
  const onVisibilityChange = () => { if (document.visibilityState === 'hidden') stamp() }
  stamp()

  const beat = window.setInterval(() => {
    if (document.visibilityState === 'visible') stamp()
  }, HEARTBEAT_MS)
  window.addEventListener('pagehide', stamp)
  document.addEventListener('visibilitychange', onVisibilityChange)

  return () => {
    window.clearInterval(beat)
    window.removeEventListener('pagehide', stamp)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }
}

/** Test-only: forgets the latched stamp so the next read starts a fresh session. */
export function resetLastSeenSession(): void {
  sessionSince = undefined
}
