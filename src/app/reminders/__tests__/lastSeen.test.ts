import { describe, it, expect, beforeEach } from 'vitest'
import {
  LAST_SEEN_KEY, markCaughtUp, markReported, readLastSeen, resetLastSeenSession,
  sinceLastOpen, writeLastSeen,
} from '../lastSeen'

const NOW = new Date(2026, 6, 28, 12, 0, 0)
const at = (h: number) => new Date(2026, 6, 28, h, 0, 0)

beforeEach(() => { localStorage.clear(); resetLastSeenSession() })

describe('The lastSeen stamp', () => {
  it('roundTripsThroughLocalStorage', () => {
    writeLastSeen(NOW)
    expect(readLastSeen()?.getTime()).toBe(NOW.getTime())
  })

  it('isNullWhenAbsent', () => {
    expect(readLastSeen()).toBeNull()
  })

  it('isNullWhenTheStoredValueIsJunk', () => {
    localStorage.setItem(LAST_SEEN_KEY, 'not a date')
    expect(readLastSeen()).toBeNull()
  })
})

describe('Only what the user was actually shown advances the stamp', () => {
  it('advancesWhenAReminderIsDelivered', () => {
    // The original bug: the stamp moved only on banner dismissal, so a
    // reminder that fired live, on screen, came back next launch as something
    // missed while the app was closed.
    localStorage.setItem(LAST_SEEN_KEY, at(9).toISOString())
    markReported(at(12))
    expect(readLastSeen()!.getTime()).toBe(at(12).getTime())
  })

  it('doesNotAdvanceMerelyBecauseTheTabWasAlive', () => {
    // The regression this replaced: a load/heartbeat/pagehide stamp marked as
    // seen a reminder that fired with notifications blocked and drew nothing,
    // so catch-up dropped it for good. Nothing here writes on its own.
    localStorage.setItem(LAST_SEEN_KEY, at(9).toISOString())
    sinceLastOpen()
    expect(readLastSeen()!.getTime()).toBe(at(9).getTime())
  })

  it('neverMovesTheStampBackwards', () => {
    // A late or out-of-order delivery must not rewind the window and
    // re-report everything after it.
    localStorage.setItem(LAST_SEEN_KEY, at(14).toISOString())
    markReported(at(11))
    expect(readLastSeen()!.getTime()).toBe(at(14).getTime())
  })

  it('advancesFromNothingOnAFirstRun', () => {
    markReported(at(12))
    expect(readLastSeen()!.getTime()).toBe(at(12).getTime())
  })

  it('doesNotDragThisTabsLatchBackwards', () => {
    // The latch is what the open banner is rendered from. A delivery older
    // than it must still catch the stored stamp up without changing what the
    // user is currently looking at.
    localStorage.setItem(LAST_SEEN_KEY, at(9).toISOString())
    sinceLastOpen()
    markCaughtUp(at(15))
    markReported(at(12))
    expect(sinceLastOpen()!.getTime()).toBe(at(15).getTime())
  })
})

describe('Marking catch-up as seen', () => {
  it('movesBothTheStoredStampAndThisTabsViewOfIt', () => {
    // Only moving the stored one would let a remount of the banner read the
    // still-old latch and put the same list straight back on screen.
    localStorage.setItem(LAST_SEEN_KEY, at(9).toISOString())
    expect(sinceLastOpen()!.getTime()).toBe(at(9).getTime())
    markCaughtUp(NOW)
    expect(readLastSeen()!.getTime()).toBe(NOW.getTime())
    expect(sinceLastOpen()!.getTime()).toBe(NOW.getTime())
  })
})
