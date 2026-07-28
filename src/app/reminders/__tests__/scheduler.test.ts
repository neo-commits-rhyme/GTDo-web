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
    notify: (title, body) => { notified.push({ title, body }); return true },
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

/**
 * A fake timer table whose clock advances by the leg it just ran, so a wait
 * walked in several legs converges the way real time does.
 */
function chainHarness() {
  let clock = NOW.getTime()
  const timers = new Map<number, { fn: () => void; ms: number }>()
  let next = 1
  const legs: number[] = []
  const notified: { title: string; body: string }[] = []
  const sink = new TimerReminderSink({
    now: () => new Date(clock),
    setTimer: (fn, ms) => { legs.push(ms); const h = next++; timers.set(h, { fn, ms }); return h },
    clearTimer: (h) => { timers.delete(h) },
    notify: (title, body) => { notified.push({ title, body }); return true },
  })
  return {
    sink, notified, legs, timers,
    /** Runs the one armed timer, moving the clock forward by its own delay. */
    runLeg: () => {
      const entry = [...timers.entries()][0]
      if (entry === undefined) return false
      timers.delete(entry[0])
      clock += entry[1].ms
      entry[1].fn()
      return true
    },
  }
}

const INT32_MAX = 2 ** 31 - 1
const inDays = (n: number) => new Date(NOW.getTime() + n * 86_400_000)

describe('Waits longer than a browser timer can hold', () => {
  it('neverHandsTheBrowserADelayItCannotRepresent', () => {
    // setTimeout's delay is an IDL long: a delay past ~24.8 days wraps to a
    // negative (fires the instant the app opens) or to a smaller positive
    // (fires days early). Both used to happen, on every launch, because the
    // app re-arms every reminder on load.
    const h = chainHarness()
    h.sink.schedule('a', 'annual review', inDays(365))
    while (h.runLeg()) { /* walk the whole chain */ }
    expect(h.legs.length).toBeGreaterThan(1)
    expect(Math.max(...h.legs)).toBeLessThanOrEqual(INT32_MAX)
  })

  it('firesOnlyOnceTheRealDateArrives', () => {
    const h = chainHarness()
    h.sink.schedule('a', 'renew passport', inDays(60))
    h.runLeg()
    expect(h.notified).toEqual([])
    while (h.runLeg()) { /* walk the whole chain */ }
    expect(h.notified).toEqual([{ title: 'GTDo', body: 'renew passport' }])
    expect(h.sink.pendingIDs).toEqual([])
  })

  it('cancelStopsAChainedTimerPartWayThrough', () => {
    const h = chainHarness()
    h.sink.schedule('a', 'renew passport', inDays(60))
    h.runLeg()
    expect(h.sink.pendingIDs).toEqual(['a'])
    h.sink.cancel('a')
    expect(h.sink.pendingIDs).toEqual([])
    while (h.runLeg()) { /* nothing should be left to run */ }
    expect(h.notified).toEqual([])
  })

  it('doesNotFireImmediatelyThroughTheRealBrowserTimer', async () => {
    // Every other test here injects setTimer, so the platform's own truncation
    // of an over-long delay was never exercised — which is how this shipped.
    const notified: string[] = []
    const sink = new TimerReminderSink({ notify: (_t, body) => { notified.push(body); return true } })
    sink.schedule('a', 'renew passport', new Date(Date.now() + 60 * 86_400_000))
    await new Promise((resolve) => { setTimeout(resolve, 20) })
    expect(notified).toEqual([])
    sink.cancelAll()
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

describe('Delivery is reported, firing is not', () => {
  /** A wheel whose one timer can be fired by hand. */
  const wheel = () => {
    let fn: (() => void) | null = null
    return {
      setTimer: (f: () => void) => { fn = f; return 1 },
      clearTimer: () => { fn = null },
      fire: () => { const f = fn; fn = null; f?.() },
    }
  }

  it('reportsAReminderTheBrowserActuallyDrew', () => {
    const w = wheel()
    const delivered: Date[] = []
    const due = new Date(NOW.getTime() + 60_000)
    const sink = new TimerReminderSink({
      now: () => NOW,
      setTimer: w.setTimer,
      clearTimer: w.clearTimer,
      notify: () => true,
      onDelivered: (at) => delivered.push(at),
    })
    sink.schedule('a', 'take the pills', due)
    w.fire()
    // The instant it was DUE for, not the instant it happened to fire: the
    // stamp is a window boundary, and a leg that wakes late must not skip
    // anything that came due in between.
    expect(delivered.map((d) => d.getTime())).toEqual([due.getTime()])
  })

  it('reportsNothingWhenNotificationsAreBlocked', () => {
    // The regression that made this necessary: catch-up used to advance on a
    // stamp that only meant "the tab was alive", so a reminder whose timer ran
    // while notifications were blocked — drawing nothing at all — was marked
    // as seen and never reported. Firing is not telling.
    const w = wheel()
    const delivered: Date[] = []
    const sink = new TimerReminderSink({
      now: () => NOW,
      setTimer: w.setTimer,
      clearTimer: w.clearTimer,
      notify: () => false,
      onDelivered: (at) => delivered.push(at),
    })
    sink.schedule('a', 'take the pills', new Date(NOW.getTime() + 60_000))
    w.fire()
    expect(delivered).toEqual([])
  })

  it('reportsNothingWhenTheNotifierThrows', () => {
    const w = wheel()
    const delivered: Date[] = []
    const sink = new TimerReminderSink({
      now: () => NOW,
      setTimer: w.setTimer,
      clearTimer: w.clearTimer,
      notify: () => { throw new Error('construction refused') },
      onDelivered: (at) => delivered.push(at),
    })
    sink.schedule('a', 'take the pills', new Date(NOW.getTime() + 60_000))
    expect(() => { w.fire() }).not.toThrow()
    expect(delivered).toEqual([])
  })
})
