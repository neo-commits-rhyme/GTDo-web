import { describe, it, expect } from 'vitest'
import { CompletionHold } from '../completionHold'

/**
 * Ports the pure half of CompletionHoldTests.swift. The remaining 13 tests in
 * that file drive the hold through AppStore (completedRowStaysInTheList,
 * aRunDownTheColumnMigratesInOneGo, aRecurrenceSpawnDoesNotAppear…, and the
 * trash/reorder interactions) and are ported in Task 8 alongside
 * toggleCompletedHolding.
 */

const A = '00000000-0000-0000-0000-00000000000A'
const B = '00000000-0000-0000-0000-00000000000B'
const SPAWN = '00000000-0000-0000-0000-00000000000C'

describe('CompletionHold', () => {
  it('pinAndReleaseByGeneration', () => {
    const hold = new CompletionHold()
    const g = hold.pin(A, false, null)
    expect(hold.pinnedIDs).toEqual(new Set([A]))
    expect(hold.pinFor(A)?.rendersCompleted).toBe(false)

    expect(hold.release(g - 1)).toBe(false) // stale, ignored
    expect(hold.pinnedIDs).toEqual(new Set([A]))

    expect(hold.release(g)).toBe(true)
    expect(hold.isEmpty).toBe(true)
    expect(hold.release(g)).toBe(false) // nothing left to do
  })

  it('aSecondPinInvalidatesTheFirstRelease', () => {
    const hold = new CompletionHold()
    const first = hold.pin(A, false, null)
    const second = hold.pin(B, false, null)
    expect(hold.release(first)).toBe(false) // debounced away
    expect(hold.pinnedIDs).toEqual(new Set([A, B]))
    expect(hold.release(second)).toBe(true)
  })

  it('repinningTheSameIDUnpinsIt', () => {
    const hold = new CompletionHold()
    hold.pin(A, false, null)
    hold.pin(A, true, new Date(2026, 6, 21))
    expect(hold.pinnedIDs.size).toBe(0)
    expect(hold.pinFor(A)).toBeNull()
  })

  it('releaseNowIgnoresGenerationAndInvalidatesPendingReleases', () => {
    const hold = new CompletionHold()
    const g = hold.pin(A, false, null)
    expect(hold.releaseNow()).toBe(true)
    expect(hold.isEmpty).toBe(true)
    expect(hold.release(g)).toBe(false)
  })

  it('suppressionIsIndependentOfPins', () => {
    const hold = new CompletionHold()
    hold.suppress([SPAWN])
    expect(hold.isSuppressed(SPAWN)).toBe(true)
    expect(hold.isEmpty).toBe(false) // a suppression is a hold

    // recentlyCompleted exposes PINS only — a suppression-only hold reports no
    // pinned ids while still being releasable. Spec §5.4.
    expect(hold.pinnedIDs.size).toBe(0)

    hold.pin(B, false, null)
    expect(hold.releaseNow()).toBe(true)
    expect(hold.isSuppressed(SPAWN)).toBe(false)
  })

  it('pinKeepsThePreToggleCompletionDateEvenWhenNull', () => {
    // `.map` on the Pin returns the pin's completedAt even when nil, rather
    // than falling through to the stored value — spec §5.4.
    const hold = new CompletionHold()
    hold.pin(A, true, null)
    expect(hold.pinFor(A)).not.toBeNull()
    expect(hold.pinFor(A)?.completedAt).toBeNull()
    expect(hold.pinFor(A)?.rendersCompleted).toBe(true)
  })

  it('releaseOnAnEmptyHoldIsFalse', () => {
    const hold = new CompletionHold()
    expect(hold.release(hold.generation)).toBe(false)
    expect(hold.releaseNow()).toBe(false)
  })

  it('everyPinBumpsTheGenerationSoNoTimerIsEverCancelled', () => {
    const hold = new CompletionHold()
    const g1 = hold.pin(A, false, null)
    const g2 = hold.pin(B, false, null)
    const g3 = hold.pin(A, false, null) // unpins A, still bumps
    expect(g2).toBe(g1 + 1)
    expect(g3).toBe(g2 + 1)
  })

  it('suppressionDoesNotBumpTheGeneration', () => {
    // Matches Swift: suppress() is not an event that restarts the window.
    const hold = new CompletionHold()
    const before = hold.generation
    hold.suppress([SPAWN])
    expect(hold.generation).toBe(before)
  })

  it('pinnedIDsIsACopyNotALiveView', () => {
    const hold = new CompletionHold()
    hold.pin(A, false, null)
    const snapshot = hold.pinnedIDs
    hold.releaseNow()
    expect(snapshot).toEqual(new Set([A]))
  })
})
