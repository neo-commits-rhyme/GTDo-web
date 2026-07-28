/**
 * How far the user has been TOLD about, which bounds the catch-up window.
 *
 * Not "when was GTDo last open". That was tried, via a load/heartbeat/pagehide
 * stamp, and it is a different question with a different answer: with
 * notifications blocked a reminder's timer fires and draws nothing, so a tab
 * merely being alive marked as seen a reminder the user never saw, and the
 * banner then dropped it for good. Firing is not telling. Only two things
 * advance this stamp — a notification the browser actually put on screen, and
 * the user dismissing the catch-up banner.
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

let sessionSince: Date | null | undefined

/**
 * The stamp as it stood when this tab opened.
 *
 * Anything asking "what did the user miss" wants this and never readLastSeen():
 * a notification delivered during this session moves the stored stamp forward,
 * and a banner reading that would erase its own contents mid-session.
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
 * Records that a reminder due at `dueAt` was actually put in front of the user.
 *
 * Only ever moves forward, and forward of BOTH the stored stamp and this tab's
 * latch: a reminder delivered out of order must not rewind the window and
 * re-report everything after it.
 */
export function markReported(dueAt: Date): void {
  const stored = readLastSeen()
  if (stored !== null && stored >= dueAt) return
  if (sessionSince != null && sessionSince >= dueAt) {
    // The latch is already past this, so only the stored stamp needs catching
    // up. Writing through markCaughtUp would drag the latch backwards.
    writeLastSeen(dueAt)
    return
  }
  markCaughtUp(dueAt)
}

/** Test-only: forgets the latched stamp so the next read starts a fresh session. */
export function resetLastSeenSession(): void {
  sessionSince = undefined
}
