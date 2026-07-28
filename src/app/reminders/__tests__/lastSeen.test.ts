import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  HEARTBEAT_MS, LAST_SEEN_KEY, markCaughtUp, readLastSeen, resetLastSeenSession,
  sinceLastOpen, startLastSeenHeartbeat, writeLastSeen,
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

describe('The last-open heartbeat', () => {
  afterEach(() => { vi.useRealTimers() })

  it('advancesTheStoredStampAsSoonAsTheAppOpens', () => {
    // The stamp used to be written only when someone dismissed a catch-up
    // banner, so it meant "last dismissal", not "last time GTDo was open" —
    // and a reminder that fired live, on screen, came back next launch as
    // something missed while the app was closed.
    localStorage.setItem(LAST_SEEN_KEY, at(9).toISOString())
    const stop = startLastSeenHeartbeat(() => NOW)
    expect(readLastSeen()!.getTime()).toBe(NOW.getTime())
    stop()
  })

  it('keepsTheOldStampForCatchUpEvenAfterAdvancingTheStoredOne', () => {
    localStorage.setItem(LAST_SEEN_KEY, at(9).toISOString())
    const stop = startLastSeenHeartbeat(() => NOW)
    expect(sinceLastOpen()!.getTime()).toBe(at(9).getTime())
    stop()
  })

  it('latchesNullOnAFirstRunRatherThanTheStampItJustWrote', () => {
    const stop = startLastSeenHeartbeat(() => NOW)
    expect(sinceLastOpen()).toBeNull()
    stop()
  })

  it('refreshesTheStampWhileTheTabStaysOpen', () => {
    // pagehide does not run when the browser is killed or the machine dies,
    // so the window of wrongly-reported reminders is bounded by this instead.
    vi.useFakeTimers()
    let clock = NOW.getTime()
    const stop = startLastSeenHeartbeat(() => new Date(clock))
    clock += HEARTBEAT_MS
    vi.advanceTimersByTime(HEARTBEAT_MS)
    expect(readLastSeen()!.getTime()).toBe(clock)
    stop()
  })

  it('stampsOnTheWayOut', () => {
    let clock = NOW.getTime()
    const stop = startLastSeenHeartbeat(() => new Date(clock))
    clock += 5_000
    window.dispatchEvent(new Event('pagehide'))
    expect(readLastSeen()!.getTime()).toBe(clock)
    stop()
  })

  it('stopsTouchingTheStampOnceStopped', () => {
    vi.useFakeTimers()
    let clock = NOW.getTime()
    const stop = startLastSeenHeartbeat(() => new Date(clock))
    stop()
    clock += HEARTBEAT_MS * 3
    vi.advanceTimersByTime(HEARTBEAT_MS * 3)
    window.dispatchEvent(new Event('pagehide'))
    expect(readLastSeen()!.getTime()).toBe(NOW.getTime())
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
