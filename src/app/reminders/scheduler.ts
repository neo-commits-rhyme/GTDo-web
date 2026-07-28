/**
 * Reminder scheduling.
 *
 * A web page cannot wake itself: firing while the app is closed needs a push
 * server, and this project has none by design. So a scheduled reminder is a
 * timer inside the open tab, and everything about the closed case is handled by
 * catch-up instead. See spec §1.
 *
 * Every browser call is wrapped. Notifications are a garnish — a browser that
 * refuses one must never break the mutation that asked for it.
 */

export interface ReminderSink {
  schedule(id: string, title: string, at: Date): void
  cancel(id: string): void
  cancelAll(): void
}

/** Used by default so every existing test constructs a store unchanged. */
export const noopReminderSink: ReminderSink = {
  schedule: () => {},
  cancel: () => {},
  cancelAll: () => {},
}

export type PermissionState = 'granted' | 'denied' | 'default' | 'unsupported'

export function notificationPermission(): PermissionState {
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission as PermissionState
}

/**
 * Requested on the user's FIRST reminder, never on load — a prompt before the
 * user has asked for anything is the one people deny reflexively, and a denial
 * here is effectively permanent.
 */
export async function requestNotificationPermission(): Promise<PermissionState> {
  if (typeof Notification === 'undefined') return 'unsupported'
  if (Notification.permission !== 'default') return Notification.permission as PermissionState
  try {
    return (await Notification.requestPermission()) as PermissionState
  } catch {
    return 'denied'
  }
}

export type SchedulerDeps = {
  now: () => Date
  setTimer: (fn: () => void, ms: number) => number
  clearTimer: (handle: number) => void
  notify: (title: string, body: string) => void
}

function defaultNotify(title: string, body: string): void {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    new Notification(title, { body, tag: 'gtdo-reminder' })
  } catch {
    // Some browsers throw on construction in some contexts. A missed
    // notification must never surface as an app error.
  }
}

/**
 * setTimeout's delay is an IDL long, so the browser truncates anything past
 * this to signed 32-bit: a wait of 25 to 50 days comes out negative and fires
 * the moment it is armed, and a longer one comes out positive but short — a
 * yearly reminder fired a fortnight early. Since App re-arms every live
 * reminder on load, that bogus notification came back on every single launch
 * until the real date drew close. Long waits are walked in legs this size.
 */
const MAX_TIMER_MS = 2 ** 31 - 1

export class TimerReminderSink implements ReminderSink {
  private timers = new Map<string, number>()
  private readonly deps: SchedulerDeps

  constructor(deps: Partial<SchedulerDeps> = {}) {
    this.deps = {
      now: deps.now ?? (() => new Date()),
      setTimer: deps.setTimer ?? ((fn, ms) => window.setTimeout(fn, ms)),
      clearTimer: deps.clearTimer ?? ((h) => { window.clearTimeout(h) }),
      notify: deps.notify ?? defaultNotify,
    }
  }

  schedule(id: string, title: string, at: Date): void {
    // Replace rather than stack: the store calls cancel-then-schedule, but a
    // caller that forgot would otherwise get two notifications.
    this.cancel(id)
    // The store already refuses past reminders; this is the second guard,
    // because a negative delay in setTimeout fires immediately.
    if (at.getTime() - this.deps.now().getTime() <= 0) return
    this.arm(id, title, at)
  }

  /** One leg of the wait. Re-entered on each wake until `at` actually arrives. */
  private arm(id: string, title: string, at: Date): void {
    const remaining = at.getTime() - this.deps.now().getTime()
    if (remaining > MAX_TIMER_MS) {
      const handle = this.deps.setTimer(() => {
        // The clock is re-read rather than the legs counted off, so a machine
        // that slept through one lands on the real date and not before it.
        this.timers.delete(id)
        this.arm(id, title, at)
      }, MAX_TIMER_MS)
      this.timers.set(id, handle)
      return
    }
    const handle = this.deps.setTimer(() => {
      this.timers.delete(id)
      try {
        this.deps.notify('GTDo', title)
      } catch {
        // A notifier that throws must not escape into whatever the timer
        // interrupted. Missing a notification is a garnish failing; an
        // uncaught throw is the app failing.
      }
    }, Math.max(remaining, 0))
    this.timers.set(id, handle)
  }

  cancel(id: string): void {
    const handle = this.timers.get(id)
    if (handle === undefined) return
    this.deps.clearTimer(handle)
    this.timers.delete(id)
  }

  cancelAll(): void {
    for (const handle of this.timers.values()) this.deps.clearTimer(handle)
    this.timers.clear()
  }

  /** Test-only view of what is currently armed. */
  get pendingIDs(): string[] {
    return [...this.timers.keys()]
  }
}
