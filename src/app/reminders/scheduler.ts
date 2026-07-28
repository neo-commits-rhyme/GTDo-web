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
    const delay = at.getTime() - this.deps.now().getTime()
    // The store already refuses past reminders; this is the second guard,
    // because a negative delay in setTimeout fires immediately.
    if (delay <= 0) return
    const handle = this.deps.setTimer(() => {
      this.timers.delete(id)
      try {
        this.deps.notify('GTDo', title)
      } catch {
        // A notifier that throws must not escape into whatever the timer
        // interrupted. Missing a notification is a garnish failing; an
        // uncaught throw is the app failing.
      }
    }, delay)
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
