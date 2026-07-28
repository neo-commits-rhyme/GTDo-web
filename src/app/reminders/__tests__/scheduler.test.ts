import { describe, it, expect, vi } from 'vitest'
import { TimerReminderSink, noopReminderSink, notificationPermission } from '../scheduler'

const NOW = new Date(2026, 6, 28, 9, 0, 0)

/** A fake timer table, so nothing waits on real time. */
function harness() {
  const timers = new Map<number, { fn: () => void; ms: number }>()
  let next = 1
  const notified: { title: string; body: string }[] = []
  const sink = new TimerReminderSink({
    now: () => NOW,
    setTimer: (fn, ms) => { const h = next++; timers.set(h, { fn, ms }); return h },
    clearTimer: (h) => { timers.delete(h) },
    notify: (title, body) => { notified.push({ title, body }) },
  })
  return {
    sink, notified, timers,
    fireAll: () => { const all = [...timers.values()]; timers.clear(); all.forEach((t) => t.fn()) },
  }
}

const inMinutes = (n: number) => new Date(NOW.getTime() + n * 60_000)

describe('TimerReminderSink', () => {
  it('schedulesWithTheDelayComputedFromTheInjectedClock', () => {
    const h = harness()
    h.sink.schedule('a', 'buy milk', inMinutes(5))
    expect([...h.timers.values()][0]!.ms).toBe(5 * 60_000)
  })

  it('firesWithTheTaskTitleAsTheBody', () => {
    const h = harness()
    h.sink.schedule('a', 'buy milk', inMinutes(5))
    h.fireAll()
    expect(h.notified).toEqual([{ title: 'GTDo', body: 'buy milk' }])
  })

  it('neverSchedulesAPastOrPresentTime', () => {
    // A negative delay in setTimeout fires immediately, which would notify for
    // something already due the moment the app opened.
    const h = harness()
    h.sink.schedule('a', 'late', inMinutes(-5))
    h.sink.schedule('b', 'now', NOW)
    expect(h.timers.size).toBe(0)
    expect(h.sink.pendingIDs).toEqual([])
  })

  it('cancelClearsAPendingTimer', () => {
    const h = harness()
    h.sink.schedule('a', 'x', inMinutes(5))
    h.sink.cancel('a')
    expect(h.sink.pendingIDs).toEqual([])
    h.fireAll()
    expect(h.notified).toEqual([])
  })

  it('reschedulingTheSameIDReplacesRatherThanStacks', () => {
    const h = harness()
    h.sink.schedule('a', 'first', inMinutes(5))
    h.sink.schedule('a', 'second', inMinutes(9))
    expect(h.timers.size).toBe(1)
    h.fireAll()
    expect(h.notified).toEqual([{ title: 'GTDo', body: 'second' }])
  })

  it('cancelAllClearsEverything', () => {
    const h = harness()
    h.sink.schedule('a', 'x', inMinutes(5))
    h.sink.schedule('b', 'y', inMinutes(6))
    h.sink.cancelAll()
    expect(h.sink.pendingIDs).toEqual([])
    h.fireAll()
    expect(h.notified).toEqual([])
  })

  it('cancellingSomethingUnknownIsSafe', () => {
    const h = harness()
    expect(() => h.sink.cancel('nope')).not.toThrow()
  })

  it('aFiredTimerStopsBeingPending', () => {
    const h = harness()
    h.sink.schedule('a', 'x', inMinutes(5))
    h.fireAll()
    expect(h.sink.pendingIDs).toEqual([])
  })

  it('aThrowingNotifierNeverEscapes', () => {
    // Some browsers throw on Notification construction in some contexts; a
    // missed notification must not surface as an app error.
    const sink = new TimerReminderSink({
      now: () => NOW,
      setTimer: (fn) => { fn(); return 1 },
      clearTimer: () => {},
      notify: () => { throw new Error('refused') },
    })
    expect(() => sink.schedule('a', 'x', inMinutes(5))).not.toThrow()
  })
})

describe('Permission', () => {
  it('reportsUnsupportedWhereNotificationDoesNotExist', () => {
    vi.stubGlobal('Notification', undefined)
    expect(notificationPermission()).toBe('unsupported')
    vi.unstubAllGlobals()
  })

  it('reportsTheBrowsersCurrentState', () => {
    vi.stubGlobal('Notification', { permission: 'denied' })
    expect(notificationPermission()).toBe('denied')
    vi.unstubAllGlobals()
  })
})

describe('The no-op sink', () => {
  it('doesNothingAndThrowsNothing', () => {
    expect(() => {
      noopReminderSink.schedule('a', 'x', NOW)
      noopReminderSink.cancel('a')
      noopReminderSink.cancelAll()
    }).not.toThrow()
  })
})
