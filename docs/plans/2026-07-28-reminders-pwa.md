# GTDo Web — Reminders and PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reminders that fire while the app is open, honest about the fact that they cannot fire while it is closed — plus an installable app that works with no network.

**Architecture:** The store's two no-op reminder hooks get a real scheduler, injected the way the clock already is so tests assert what *would* fire without real timers. Catch-up is pure logic over the task list and a `lastSeenAt` stamp. The PWA is a manifest plus a build-keyed service worker.

**Tech Stack:** Notifications API, `setTimeout`, Service Worker, Vite, Vitest, Playwright.

**Spec:** `docs/specs/2026-07-28-reminders-pwa-design.md`. Read §1 before writing any copy.

## Global Constraints

- **No behaviour changes.** All 476 tests from sub-projects 1–4 must still pass.
- **`syncReminder`'s rules do not change** — future only (strict `>`), not completed, not trashed. This sub-project fills in the hooks it already calls.
- **Permission is requested on first reminder set, never on load.**
- **Denied permission must leave every other feature working**, catch-up included.
- **Catch-up fires no notifications.** It is a banner.
- **The service worker's cache name is keyed to the build**, with `skipWaiting` and `clients.claim`.
- **The limit is stated in the detail pane**, not only in the README.
- Colours from tokens; the no-colour-literals test still applies.
- Conventional commits, one per task.

---

### Task 1: The scheduler

**Files:**
- Create: `src/app/reminders/scheduler.ts`
- Test: `src/app/reminders/__tests__/scheduler.test.ts`

**Interfaces:**
- Produces: `interface ReminderSink { schedule(id, title, at): void; cancel(id): void; cancelAll(): void }`, `class TimerReminderSink implements ReminderSink`, `notificationPermission(): 'granted' | 'denied' | 'default' | 'unsupported'`, `requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'>`

- [ ] **Step 1: Write the failing test**

Cover: scheduling computes the delay from an injected clock; a past time never schedules; cancel clears a pending timer; re-scheduling the same id replaces rather than duplicates; `cancelAll` clears everything; firing calls the injected notifier with the task's title; a browser with no `Notification` at all reports `unsupported` and never throws; and a `Notification` constructor that throws does not break the caller.

- [ ] **Step 2: Run it to verify it fails** — expect FAIL.
- [ ] **Step 3: Implement.** `TimerReminderSink` takes `now`, a `setTimeout`/`clearTimeout` pair and a notifier, all injected. Every browser call is wrapped: notifications are a garnish and must never break a mutation.
- [ ] **Step 4: Run it to verify it passes.**
- [ ] **Step 5: Commit**

```bash
git add src/app/reminders
git commit -m "feat: injectable reminder scheduler"
```

---

### Task 2: Wiring the store's hooks

**Files:**
- Modify: `src/core/store.ts` (make the two hooks injectable), `src/App.tsx`
- Test: `src/core/__tests__/reminders.test.ts`

**Interfaces:**
- Consumes: `ReminderSink` from Task 1.
- Produces: `StoreDeps` gains an optional `reminders?: ReminderSink`.

- [ ] **Step 1: Write the failing test**

Cover, through the store rather than the sink: setting a future reminder schedules; a reminder exactly at `now` does not (strict `>`); completing a task cancels; trashing cancels; renaming re-schedules, because the notification body carries the title; clearing the reminder cancels; and `importData` re-arms every reminder while `resetAllData` and `loadSampleData` deliberately do not — the asymmetry ported in sub-project 1.

- [ ] **Step 2: Run it to verify it fails** — expect FAIL.
- [ ] **Step 3: Implement.** `StoreDeps.reminders` defaults to a no-op sink, so every existing test constructs a store unchanged.
- [ ] **Step 4: Run it to verify it passes** — including all 476 existing tests.
- [ ] **Step 5: Commit**

```bash
git add src/core src/App.tsx
git commit -m "feat: wire the store's reminder hooks to a real scheduler"
```

---

### Task 3: Catch-up

**Files:**
- Create: `src/core/catchUp.ts`, `src/app/reminders/CatchUpBanner.tsx`
- Modify: `src/app/RootShell.tsx`, `src/app/styles.css`
- Test: `src/core/__tests__/catchUp.test.ts`, `src/app/reminders/__tests__/catchUpBanner.test.tsx`

**Interfaces:**
- Produces: `missedReminders(data: AppData, since: Date | null, now: Date): TaskItem[]`, `LAST_SEEN_KEY = 'gtdo.lastSeenAt'`

- [ ] **Step 1: Write the failing test**

Pure first: a reminder in the window is collected; one before `since` is not; one in the future is not; completed and trashed tasks are excluded; a null `since` collects everything past (first run); results are ordered by reminder time. Then the banner: it names the tasks, is a polite `status` not an `alert`, dismissing advances the stamp so the same items never reappear, and it does not render when there is nothing missed.

- [ ] **Step 2: Run it to verify it fails** — expect FAIL.
- [ ] **Step 3: Implement.** The banner fires no notifications — notifying about events that already happened is how an app teaches people to ignore it.
- [ ] **Step 4: Run it to verify it passes.**
- [ ] **Step 5: Commit**

```bash
git add src/core/catchUp.ts src/app/reminders src/app/RootShell.tsx src/app/styles.css
git commit -m "feat: catch-up banner for reminders missed while closed"
```

---

### Task 4: Permission, and saying so at the point of use

**Files:**
- Modify: `src/app/DetailPane.tsx`, `src/app/SettingsSheet.tsx`
- Test: `src/app/__tests__/reminderCopy.test.tsx`

- [ ] **Step 1: Write the failing test**

Cover: the reminder field states the limit; setting a first reminder requests permission exactly once; no permission is requested on load; a denial shows a plain explanation and leaves the field usable; and Settings reports the current permission state without a second prompt.

- [ ] **Step 2: Run it to verify it fails** — expect FAIL.
- [ ] **Step 3: Implement.** Copy states the limit in one line, without apology and without jargon.
- [ ] **Step 4: Run it to verify it passes.**
- [ ] **Step 5: Commit**

```bash
git add src/app
git commit -m "feat: request permission on first use and state the limit where it applies"
```

---

### Task 5: PWA

**Files:**
- Create: `public/manifest.webmanifest`, `src/sw.ts` (or `public/sw.js`), `src/app/registerSW.ts`
- Modify: `index.html`, `vite.config.ts`
- Test: `src/app/__tests__/pwa.test.ts`, `e2e/offline.spec.ts`

- [ ] **Step 1: Write the failing test**

Cover: the manifest exists with `scope` and `start_url` under `/GTDo-web/`, `display: standalone`, and at least one icon; the service worker's cache name is derived from the build so two builds differ; and the worker calls `skipWaiting` and `clients.claim`. Then an E2E that loads the app, goes offline, reloads, and still sees the task list.

- [ ] **Step 2: Run it to verify it fails** — expect FAIL.
- [ ] **Step 3: Implement.** Precache the built shell only; data is already in IndexedDB.
- [ ] **Step 4: Run it to verify it passes.**
- [ ] **Step 5: Commit**

```bash
git add public src index.html vite.config.ts e2e
git commit -m "feat: installable, and fully usable offline"
```

---

### Task 6: Verify and ship

- [ ] **Step 1: Run everything** — `npx tsc --noEmit && npx eslint . && npx vitest run && npx vite build && npx playwright test`.
- [ ] **Step 2: Look at the running app.** Set a reminder a few seconds out and watch it fire; deny permission and confirm nothing else breaks. Every sub-project has had a bug that appeared only this way.
- [ ] **Step 3: Update the README** — reminders and their limit, and the install instructions.
- [ ] **Step 4: Commit and push.**

---

## Verification against the spec

| Spec section | Task |
|---|---|
| §1 the limit | 3 (catch-up), 4 (copy) |
| §2 existing hooks | 2 |
| §3 honesty in three places | 4 |
| §4 catch-up | 3 |
| §5 PWA | 5 |
| §6 testing | every task |
| §8 success criteria | 1–2 (1), 4 (2), 3 (3), 5 (4, 5), 4 (6) |
