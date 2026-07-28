# GTDo Web — sub-project 5: reminders and PWA

**Date:** 2026-07-28 · **Status:** approved design, ready for implementation planning.
**Builds on:** sub-projects 1–4, all shipped.

The only sub-project that **cannot reach parity with the macOS app**, and the
design says so out loud rather than shipping a promise it cannot keep.

## 1. The limit, stated first

A web page cannot wake itself up. Firing a notification while the app is closed
requires a push server holding VAPID keys, and this project decided in its first
conversation to have no server at all — that decision is what makes the app free
to host, private by construction, and usable by anyone who opens the URL.

So:

- **Tab open** → the notification fires at its scheduled time.
- **Tab closed** → nothing fires. On next open, a catch-up banner lists what came
  due while you were away.

The second case is the **normal** one, not an edge case, and the design treats
it as such. A reminder that arrives late is honest; one that never arrives at
all, after you trusted it, is worse than no reminder feature.

## 2. What already exists

`syncReminder` was ported and tested in sub-project 1 and is unchanged: cancel
then reschedule, live only when the date is in the future (strict `>`), the task
is not completed, and not trashed. It calls two protected hooks that have been
no-ops since:

```ts
protected cancelReminder(id: string): void {}
protected scheduleReminder(id: string, title: string, at: Date): void {}
```

This sub-project fills them in. No scheduling rule changes.

## 3. Honesty in three places

1. **At the point of use.** The reminder field in the detail pane carries a
   one-line note that reminders fire only while GTDo is open in a tab. You learn
   the limit when you are relying on it, not from a README you will never read.
2. **Permission on first use.** The browser prompt appears when you set your
   first reminder, never on load. A prompt before the user has asked for
   anything is the pattern people deny reflexively, and a denial here is
   effectively permanent.
3. **Denial is survivable.** If permission is denied or dismissed, the field
   says so plainly and **catch-up still works** — it needs no permission at all.
   The feature degrades to something rather than nothing.

## 4. Catch-up

On open, collect every task whose `reminderDate` has passed, which is still
incomplete and untrashed, and which came due since the user was last here. A
dismissible banner names them.

- A `lastSeenAt` stamp in `localStorage` bounds the window, so the banner
  reports what you missed *since your last visit* rather than everything
  historical.
- **Catch-up fires no notifications.** It is a banner. Notifying someone about
  events that already happened is how an app teaches them to ignore it.
- Dismissing it advances the stamp, so the same items never reappear.

## 5. PWA

- **Manifest**: the existing app icon, `display: standalone`, `scope` and
  `start_url` both under `/GTDo-web/`, theme colours from the Paper tokens.
- **Service worker**: precaches the built shell. The cache name is keyed to the
  build, and the worker calls `skipWaiting()` and `clients.claim()` so a deploy
  can never strand someone on stale JavaScript — the classic PWA failure.
- **No data caching.** The data already lives in IndexedDB, so offline is
  complete rather than partial. Nothing is fetched from a server at runtime.

## 6. Testing

Scheduling is injected the same way the clock already is, so tests assert what
*would* fire and when, with no real timers and no real `Notification`.

- The strict `>` boundary: a reminder exactly at *now* does not schedule.
- Cancel-then-reschedule when a reminder or title is edited.
- Nothing scheduled for a completed or trashed task.
- Permission denied leaves every other feature working, and catch-up still runs.
- Catch-up collects only tasks genuinely missed since `lastSeenAt`, and excludes
  completed and trashed ones.
- Dismissing catch-up advances the stamp so items do not reappear.
- The service worker's cache name changes between builds.
- **All 476 existing tests keep passing.**

## 7. Out of scope

Push notifications, and therefore any reminder that fires with the app closed.
Reaching that requires a server, which would undo the first decision this
project made. If it is ever wanted, it is a new sub-project with its own spec —
and its own privacy consequences, since a push server sees who is reminded and
when.

## 8. Success criteria

1. A reminder set for two minutes from now fires while the tab is open.
2. Denying permission leaves the app fully usable and catch-up working.
3. Reminders that came due while closed are surfaced on next open, once.
4. The app opens and works with the network disabled.
5. A new deploy takes effect on next load, with no stale-cache trap.
6. The limit is stated where the reminder is set, not only in the README.
