# GTDo for the web — sub-project 1: core + shell

**Date:** 2026-07-28 · **Status:** approved design, ready for implementation planning.
**Repo:** `GTDo-web` (new, public, GitHub Pages).
**Ports from:** `GTDo` — macOS SwiftUI app, `Sources/GTDo/{Models,Store}`, 191 tests.

Every claim in §3 about the JSON wire format was produced by running Swift against the real
`Models.swift`, not by reading it. The §5 behavior requirements were extracted from a full
enumeration of the 140 members of the shared core. Where a fact could not be verified, it is
listed in §11 as an assumption rather than stated as a fact.

---

## 1. Context and constraints

The macOS app and its iPhone port share one core by reference (`Sources/GTDo/{Models,Store,Theme}`),
so they cannot drift. A web version cannot share Swift source, so it is a **reimplementation of the
core in TypeScript** with a new UI on top.

Decisions settled during brainstorming, not to be re-litigated:

1. **Separate repo** `GTDo-web`, not a `web/` directory in `GTDo`.
2. **Browser-local storage only.** No accounts, no backend, no server-side data. Anyone can open the
   URL and use it; their data is theirs and stays in their browser.
3. **Full parity is the destination**, reached across five sub-projects. This spec is #1.
4. **React + TypeScript + Vite + Vitest.**
5. **IndexedDB.**
6. **Three-pane shell** mirroring macOS, chosen from three wireframed candidates.
7. **Hash routing.**

The separate repo removes the structural guarantee that kept macOS and iOS honest. §3 and §10
replace it with a pinned fixture and a CI drift job. This is the single most important structural
risk in the project.

## 2. Scope

**In:** the TypeScript core (models, store, queries, smart views, recurrence, completion hold, trash
purge, reorder logic, search, deadline-required-list prompting, project conversion, the Someday
rule), the storage layer (IndexedDB, snapshots, quarantine, write-failure surfacing), Export/Import
of `data.json`, the responsive three-pane shell, task and list CRUD, groups, keyboard shortcuts,
hash routing, accessibility, a Vitest suite mirroring the Swift suites, CI, and Pages deploy.

**Out, with its sub-project:** visual identity, list colour/symbol customization, accent themes,
completion sound (#2) · drag-and-drop, swipe actions, undo (#3) · Inbox Review (#4) · reminders,
PWA (#5).

**Deliberately not ported:** `GitHubSync.swift` (shells out to the `gh` CLI; macOS-only).

Two clarifications on the boundary, both from the audit:

- `setListColor` / `setListSymbol` and the `colorHex` / `symbol` fields are **core mutations**, so
  they are implemented and tested in #1. Only their *UI* defers to #2. The fields must round-trip
  through `data.json` from day one or a macOS export loses them.
- `reorder.ts` (`moveIncompleteTasks`, `moveGTDEntries`, `moveUserEntries`, `moveListsInGroup`, and
  the `gtdOrder` / `userOrder` self-healing) is **core logic in #1**, tested headlessly. Only the
  drag *gesture* defers to #3. Sub-project 1 exposes these through menu commands
  ("Move up" / "Move down"), which is also the accessible path that #3's drag layers over.

## 3. The wire format — verified, not assumed

`Persistence.encode` uses `JSONEncoder` with `.iso8601` dates and
`[.prettyPrinted, .sortedKeys]` (`Sources/GTDo/Store/Persistence.swift:73-78`). Running it produces:

```json
{
  "groups" : [
    {
      "id" : "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE",
      "isBuiltIn" : false,
      "name" : "Areas",
      "order" : 1
    }
  ],
  "lists" : [
    {
      "colorHex" : "#FF8800",
      "groupID" : "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE",
      "id" : "11111111-2222-3333-4444-555555555555",
      "isBuiltIn" : false,
      "name" : "Work\/Home",
      "order" : 2,
      "symbol" : "star.fill"
    }
  ],
  "tasks" : [
    {
      "createdAt" : "2023-11-14T22:13:20Z",
      "id" : "00000000-0000-0000-0000-00000000000B",
      "isCompleted" : false,
      "isTrashed" : false,
      "listID" : "11111111-2222-3333-4444-555555555555",
      "note" : "",
      "order" : 0,
      "title" : "bare\/slashed title"
    }
  ]
}
```

### 3.1 Encoder rules the TypeScript codec must reproduce byte-for-byte

| Rule | Value |
|---|---|
| Date format | `yyyy-MM-dd'T'HH:mm:ss'Z'` — 20 chars, **no fractional seconds**, always literal `Z` |
| UUID case | **UPPERCASE**, hyphenated 8-4-4-4-12 |
| Forward slashes | **escaped** as `\/` (`.withoutEscapingSlashes` is not set) |
| Indentation | 2 spaces per level |
| Key separator | `" : "` — a space **before and after** the colon (Foundation's pretty-printer) |
| Key order | byte-wise ASCII under `.sortedKeys`: uppercase-initial keys sort before lowercase-initial |
| Trailing newline | **none** — last byte is `}` |
| Nil optionals | **key omitted entirely**, never `"key": null` |
| `RepeatRule` | nested object `{"interval": Int, "unit": String}`, unit lowercase raw value |

### 3.2 The decode contract — the data-loss trap

**Swift's synthesized `init(from:)` does not honor property default values.** Verified by removing
each key individually from an encoder-produced document:

```
[FAIL] TaskItem missing 'note'        -> DecodingError.keyNotFound ... ("note")
[FAIL] TaskItem missing 'isCompleted' -> keyNotFound, Path: tasks[0]
[FAIL] TaskItem missing 'isTrashed'   -> keyNotFound, Path: tasks[0]
[FAIL] TaskItem missing 'createdAt'   -> keyNotFound, Path: tasks[0]
[FAIL] TaskItem missing 'order'       -> keyNotFound, Path: tasks[0]
[FAIL] TaskItem missing 'title' / 'listID' / 'id' -> keyNotFound
[FAIL] TaskList missing 'isBuiltIn' / 'order' / 'name' / 'id' -> keyNotFound
[FAIL] AppData missing 'tasks' / 'lists' / 'groups' -> keyNotFound
```

Defaults like `note: String = ""` serve only the memberwise initializer. **Every non-optional field
is a hard requirement of the wire format.**

Why this matters beyond a failed import: when `loadOrFail` cannot decode, it *moves the user's file
aside* (`Persistence.swift:83-93`). A TypeScript export that omits one non-optional field would, on
the next macOS launch, present the user with an empty app and a renamed `data.json.corrupt-<stamp>`.
That is the worst outcome this project can produce, and it is one missing key away.

**Rule for the codec: emit every non-optional field always; omit optional fields when nil.**

### 3.3 Decoder tolerances (useful, but not to be relied on when writing)

- Explicit `null` is accepted for optional fields; **rejected** for non-optional ones.
- Lowercase/mixed-case UUIDs are accepted and normalized to uppercase; unhyphenated is rejected.
- Fractional seconds are accepted on input though never written — **asymmetric**, and it means
  encoding is lossy for sub-second precision. `Date` values carrying a fraction do not survive a
  round trip, so round-trip equality tests must construct whole-second dates.
- Date offsets `+00:00` and `+0000` are accepted; a timezone-less string, lowercase `t`/`z`, and a
  numeric timestamp are all rejected.
- Unknown keys are ignored, so additive schema changes are forward-compatible.

### 3.4 Fixtures

`fixtures/macos-data.json` is a real file exported from the macOS app (one exists today at
`~/Library/Application Support/GTDo/data.json`, 14725 bytes, decoding cleanly). Note the real file
**omits `gtdOrder` and `userOrder` entirely** — the codec must treat their absence as the normal
case, not an edge case.

Three tests guard the contract:

1. `decode(fixture)` then `encode(...)` is **byte-identical** to the fixture.
2. A synthetic `AppData` exercising every optional, `/` in strings, and all five `RepeatRule` units
   encodes to bytes the Swift decoder accepts (CI, §10).
3. Each non-optional field, removed individually from our own output, must make our decoder throw —
   so we fail loudly on the same inputs Swift fails on rather than silently healing.

## 4. Architecture

Three layers; dependencies point downward only.

```
app/       React + TSX — the only layer that knows about a browser
   ▲  reads state, calls methods
storage/   StorageAdapter interface · IndexedDb / Memory / Failing · snapshots · writeQueue
   ▲  persist(data), listSnapshots(), restore(id)
core/      pure TypeScript — no React, no DOM, no IndexedDB, no ambient clock
```

`core/` has no I/O and no wall clock: `now` and `completionHoldScheduler` are injected exactly as in
Swift, so the ported tests freeze time instead of sleeping.

### Port map

| Swift | TypeScript |
|---|---|
| `Models/Models.swift` | `core/models.ts` |
| `Store/AppStore.swift` | `core/store.ts` |
| `Store/AppStore+Mutations.swift` | `core/mutations.ts` |
| `Store/AppStore+Search.swift` | `core/search.ts` |
| `Store/AppStore+Reorder.swift` | `core/reorder.ts` |
| `Store/CompletionHold.swift` | `core/completionHold.ts` |
| `Store/SampleData.swift` | `core/seed.ts` |
| `Store/Persistence.swift` | split: `core/codec.ts` (pure encode/decode) + `storage/` (I/O, snapshots, rotation) |
| `Store/GitHubSync.swift` | not ported |

Splitting `Persistence` is deliberate: encoding is pure and must be tested byte-wise against a real
file; I/O is async and platform-bound.

### Store shape

`core/store.ts` is a plain class holding `AppData` plus view state, with a subscribe/notify list.
React binds through a single `useStore()` hook backed by `useSyncExternalStore`. Mutations stay
**synchronous in memory** — the UI is correct before anything touches disk — and enqueue a debounced
write.

Two Swift behaviors that constrain the TypeScript design:

- `task(_:)` and `list(_:)` return **copies**. `toggleCompletedHolding` snapshots `before` and reads
  it after mutating; returning a live reference would silently break it. The TS accessors return
  frozen shallow copies.
- `SidebarItem` is compared **by value** (`deleteList` tests `selection == .list(id)`), so it is a
  discriminated union compared structurally, never by reference.

## 5. Core behavior requirements

The audit enumerated all 140 members. Below are the behaviors a reimplementation gets wrong by
default. Each is a test in §9.

### 5.1 Time and dates

- **Deadlines are days pinned to local noon**; `today` is midnight. Every day comparison goes through
  `startOfDay`, never a raw instant. Noon gives ±11h of slack so a deadline never serializes to the
  previous day in UTC. Applied in `setDueDate`, `addTask` into Today, `setRepeatRule`'s default, and
  `spawnNextOccurrence`.
- **Reminders are instants**, stored exactly as given, never noon-pinned.
- `syncReminder` uses strict `>`, so a reminder exactly at `now` is not scheduled.

### 5.2 Ordering

- `activeTasks` sorts by `order`, **not** `createdAt`.
- `addTask` and `spawnNextOccurrence` assign `order = max(order over ALL tasks) + 1`, including
  trashed and completed ones, so new tasks always land last globally.
- `calendarTasks` is the **only** view sorted by `dueDate`; every other view sorts by `order`.
- `completedTasks` starts from `data.tasks`, not `activeTasks`, so it has **no** stable secondary
  order — tests must not assume one.
- `completionSortKey` returns `distantPast` for a completed-but-dateless task, so those sort to the
  bottom of every descending Completed list.
- `moveIncompleteTasks` redistributes **only the slots that list already owned** — no renumbering, no
  compaction, no other task's `order` changes. `destination` follows SwiftUI `onMove` semantics: an
  insertion index into the **pre-removal** array, so moving item 0 down one requires `destination 2`.
- `TaskList.order` has two regimes: `addList` / `convertToProject` assign global `max+1`, while
  `moveListsInGroup` renumbers `0..n` **within one group**. Orders therefore tie across groups. Safe
  only because every read sorts within a single group scope — preserve that invariant.
- `moveTargets` returns lists **unsorted**, in raw insertion order.

### 5.3 List rules

- **The Someday rule:** moving a task into Someday silently strips both `dueDate` and `repeatRule`.
  No other list mutates fields on move.
- **Deadline-required lists** are Next actions and Waiting for… only. Someday is the *opposite* rule.
  Inbox and Notes are unconstrained. Enforcement lives in `submitNewTask` / `requestMove`, **not** in
  `moveTask` or `addTask` — a programmatic move into Next actions with no deadline is allowed and
  produces an undated task there.
- `restoreTask` deliberately bypasses both rules.
- **Project conversion moves, never deletes.** The task keeps every field including its live
  reminder, and the operation is reversible by moving the task back out. An earlier macOS version
  destroyed the task here; the comment in the source records it as a bug worth not repeating.
- Built-in list names are load-bearing (search matches list names): `"Inbox"`, `"Next actions"`
  (lowercase a), `"Waiting for..."` (three literal dots), `"Someday"`, `"Notes"`, `"Projects"`.

### 5.4 Completion and the hold window

- Window is **500 ms**, debounced: every tap bumps a generation and earlier scheduled releases become
  no-ops. **No timer is ever cancelled** — that is the whole mechanism.
- `rendersCompleted` / `renderedCompletionDate` / `isHeldHidden` are what views read. **Search
  deliberately does not use them**, so a just-completed pinned task still appears in
  `incompleteTasks(in:)` and not in `completedTasks` until the window closes.
- `renderedCompletionDate` returns the pin's `completedAt` **even when nil** — a pinned row sorts as
  `distantPast` rather than falling through to the stored value.
- `recentlyCompleted` exposes pins only, not recurrence-spawn suppressions: a hold containing only
  suppressions reports `recentlyCompleted` empty while `flushCompletionHold()` still returns `true`.
- `releaseCompletionHold` does **not** persist — the hold is pure view state.
- Un-completing does not delete a previously spawned occurrence and does not restore the old
  `dueDate`; the original keeps its `repeatRule`, so re-completing spawns **another** occurrence.
  This is existing macOS behavior and is ported as-is.
- Trashed tasks cannot be toggled at all.

### 5.5 Recurrence

- `nextOccurrence` is a do-while: it **always advances at least once**, even from a future date, and
  loops while `<= today` (midnight) — skip-missed.
- `weekday` means "next Mon–Fri day" and **ignores `interval` entirely**; `displayName` prints
  "Weekdays" for any interval because that case precedes the generic ones.
- `week` is implemented as `7 * interval` days.
- `spawnNextOccurrence` copies title, note and list only — **not** `reminderDate`, not the deadline's
  time-of-day, not completion state, not `order` (it takes `max+1`). It does not persist; the calling
  `toggleCompleted` does.
- `setRepeatRule` can silently **create** a deadline of today-noon; clearing the rule does **not**
  clear the deadline. Asymmetric with `setDueDate(nil)`, which *does* clear the rule.
- Month clamping and the weekend definition come from the system calendar. TypeScript has no
  `Calendar`, so `core/calendar.ts` implements `startOfDay`, `addDays/Months/Years` and `isWeekend`
  against the host locale, and is tested against the Swift `RecurrenceTests` expectations.

### 5.6 Trash

- `purgeTrash` **never** purges tasks with `trashedAt == nil` (trashed before the stamp existed).
  Strict `<` cutoff. Its early return prevents a save+backup on every launch.
- It runs **at launch only**, once, with `days = 30`, and only when the `autoEmptyTrash` preference
  is on — **default off**. There is no timer.
- `trashTask` on an already-trashed task refreshes `trashedAt`, resetting its purge clock.
- `emptyTrash` is unconditional: it persists and force-backs-up even when the trash was empty, and
  does **not** clear `selectedTaskID`, leaving a dangling selection id the UI must tolerate.
- `deleteTaskPermanently` has no guard at all — it works on non-trashed tasks and unknown ids.

### 5.7 Sidebar order

- `gtdOrder` / `userOrder` healing is **read-time only**: a stale order stays stale on disk until an
  explicit reorder writes it back. Both keys must tolerate being absent (the real `data.json` omits
  them).
- Inbox is deliberately **not** part of the reorderable GTD block.
- `BuiltIn.projectsGroup` uses uppercase `AA` in its literal, so UUID comparison must be
  case-insensitive or normalized.

### 5.8 Persistence semantics

- Every mutation ends in `persist()`; destructive ones pass `forceBackup: true`.
- The backup snapshots **the file already on disk**, before the write — so a snapshot is always a
  state the app previously considered good.
- Negative elapsed time (clock moved backwards: DST, NTP, manual change) is treated as **due**, not
  as "too soon", so backups don't suspend until real time catches up.
- A failed backup leaves `lastBackupAt` unchanged so the next save retries rather than being
  throttled away.
- `saveError` is assigned unconditionally by `persist()`, so a successful save **clears** a previous
  error — except in the refusing-to-overwrite path, which re-sets it every time.
- `refusingToOverwrite` is **never cleared** once set: no save happens for the life of that store.
- `healingBuiltIns` **appends** healed built-ins (so their seeded `order` 0..4 can collide with user
  list orders) and matches **by id only** — a list carrying the Inbox id under a different name is
  considered present and is not renamed. It never rejects an import.
- `importData` is the only whole-store replacement that re-arms reminders and the only one that
  clears `pendingDeadline`; `resetAllData` and `loadSampleData` deliberately do not.

## 6. Storage layer

```ts
interface StorageAdapter {
  load(): Promise<LoadResult>              // absent | ok | unreadable | undecodable
  persist(data: AppData): Promise<void>    // rejects on quota/eviction/corruption
  writeSnapshot(raw: string, at: Date): Promise<boolean>
  listSnapshots(): Promise<SnapshotMeta[]>
  readSnapshot(id: string): Promise<string>
  quarantine(raw: string, reason: string): Promise<void>
}
```

Implementations: `IndexedDbAdapter` (app), `MemoryAdapter` (tests), `FailingAdapter` (failure paths).
One contract test suite runs against all three.

**Object stores:** `data` (single record), `snapshots` (keyed by UTC stamp), `quarantine`,
`meta` (schema version, `lastBackupAt`).

**Snapshot policy is `Persistence.keepSet` verbatim:** newest 20, plus the oldest snapshot of each of
the most recent 30 days, 5-minute throttle, forced before destructive operations. Stamps are UTC
`yyyy-MM-dd-HHmmss` — a local-time stamp sorts backwards after DST and would prune the newest
snapshots.

**Write queue** coalesces bursts into one write, preserves ordering, and surfaces the first rejection
without dropping later writes.

## 7. Shell

### Breakpoints

| Width | Shape |
|---|---|
| ≥1100 | Sidebar 240 · task list flex (min 360) · detail 320 when a task is selected |
| 700–1099 | Sidebar collapsible; detail **overlays** rather than reflowing |
| <700 | Stacked push navigation: Lists → list → detail sheet, as the iPhone port |

The list carries a `min-width` so opening the detail pane never re-wraps row titles, and the hold pin
is keyed on task id in `core/`, never on DOM position — a reflow mid-window cannot drop it.

### Routing

Hash routes: `#/today`, `#/calendar`, `#/completed`, `#/trash`, `#/list/<uuid>`. Hash rather than
paths because GitHub Pages cannot rewrite. An unknown or deleted list id falls back to `#/today`
rather than rendering an empty pane.

### Components

`RootShell`, `Sidebar`, `TaskList`, `TaskRow`, `DetailPane`, `AddBar`, `SearchField`,
`DeadlinePrompt`, `SaveFailureBanner`, `SettingsSheet`, `ListEditor`, `MoveMenu`.

Settings in #1: auto-empty Trash after 30 days (default **off**, matching macOS), Export, Import,
Restore from snapshot, Reset all data, Load sample data.

### Keyboard

Bare keys, suppressed while focus is in a text field: `n` new task · `/` or `f` search · `1`/`2`/`3`
Today/Calendar/Inbox · `Delete`/`Backspace` trash · `Escape` close detail or clear search · `Enter`
commit add bar · `,` settings · `[`/`]` move selected task up/down within its list.

This diverges from the macOS `⌘`-prefixed shortcuts. See §11 — the divergence is assumed necessary,
and the assumption is tested in task 1 of the plan before the map is finalized.

### Accessibility

Rows are buttons with `aria-checked`. Completion-hold release fires an `aria-live` announcement (the
web equivalent of the `LayoutChanged` notification macOS posts). Focus returns to the originating row
when the detail pane closes. Reorder is reachable from the keyboard and from a menu — #3's drag
gestures layer over this, never replace it.

## 8. Error handling and data safety

Three load outcomes, ported from `AppStore.init`:

| Outcome | Behavior |
|---|---|
| **absent** | Seed built-ins, no tasks (`AppData.seeded()` seeds no sample tasks) |
| **unreadable** | Seed in memory, set `refusingToOverwrite`, banner up, **never write** |
| **undecodable** | Copy the raw record into `quarantine` **before** anything replaces it |

Nothing is ever deleted. The web has no Finder to recover from, so quarantine is the only route back.

Save failures a browser actually produces — `QuotaExceededError`, Safari private-mode eviction,
corrupt DB after a crash — all set `saveError` and raise the banner, which carries an **Export now**
button so the only copy can leave the browser immediately.

On first successful save the app calls `navigator.storage.persist()`. If it is denied, the README
says so plainly and Export is the answer. See §11.

The launch backup happens **only on a successful load**, before this session can change anything.

## 9. Testing

Vitest, files named to mirror the Swift suites so coverage can be diffed by eye. The Swift suite is
**191 tests across 23 files**.

**Ports into #1 — 148 tests:**

| Swift suite | Tests |
|---|---|
| `CompletionHoldTests` | 18 |
| `RecurrenceTests` | 18 |
| `BackupTests` | 16 |
| `AppStoreMutationTests` | 14 |
| `AppStoreQueryTests` | 13 |
| `DeadlineMoveTests` | 11 |
| `ReorderSidebarTests` | 11 |
| `SearchScopeTests` | 9 |
| `AtomicCreateTests` | 8 |
| `ProjectConversionTests` | 6 |
| `SampleAndResetTests` | 5 |
| `SearchTests` | 5 |
| `PersistenceTests` | 4 |
| `TrashPurgeTests` | 4 |
| `SomedayRuleTests` | 3 |
| `ReorderTests` | 2 |
| `ModelsTests` | 1 |

`ListCustomizationTests` (7) is **split**, consistent with §2: the assertions covering
`setListColor` / `setListSymbol` / `addGroup` / `moveList` semantics and their `data.json`
round-trip port into #1; the assertions covering rendered swatches and palette selection defer to #2.
The split is decided per test when the suite is ported, and the count is reconciled then.

**Defers:** `CompletionSoundTests` (5) → #2 · `InboxReviewTests` (5) and `ReviewKeymapTests` (5) →
#4 · `ReminderTests` (10) → #5. **Does not port:** `GitHubSyncTests` (11).

**Web-only suites added:** storage-adapter contract (run against all three adapters), quota and
eviction failure paths, IndexedDB round-trip, fixture byte-identity (§3.4), Swift-decoder acceptance
(§10), hash routing, keyboard map, accessibility smoke via Testing Library.

Plus one thin Playwright run — load, add, complete, reload, still there. It is the only test that
proves a real browser actually persisted.

## 10. Repo, CI, deploy

Vite with `base: '/GTDo-web/'`, hash router, static output.

- **ci** — typecheck, Vitest, Playwright smoke, build.
- **drift** — clones `GTDo` at a **pinned commit**, runs a Swift script in the `swift:6` Linux
  container that decodes TypeScript-encoded output using the real `Models.swift`, and re-encodes to
  compare bytes. Fails loudly on divergence. This is the entire answer to the separate-repo risk, and
  the pinned commit is bumped deliberately, never automatically.
- **deploy** — `actions/deploy-pages` on green `main`.

README: what it is, live link, that data is browser-local, Export/Import for moving to and from the
macOS app, the keyboard divergence, and the storage-eviction caveat. MIT.

## 11. Assumptions not yet verified

The browser-platform audit did not complete. These are **assumptions**, and the plan's first task
verifies each before the affected code is written:

1. `⌘N`, `⌘F` and `⌘,` cannot be reliably intercepted by a web page in current Safari, Chrome and
   Firefox — hence the bare-key map in §7. If any of the three *is* interceptable, that shortcut
   returns to the macOS binding.
2. IndexedDB has materially higher quota than localStorage's ~5MB, and Safari's 7-day eviction of
   script-writable storage applies to it.
3. `navigator.storage.persist()` is implemented widely enough to be worth calling, and denial is
   silent rather than throwing.
4. Hash routing avoids a back-button defect that the `404.html` SPA fallback introduces on Pages.
5. A project Pages site requires `base: '/GTDo-web/'`.
6. IndexedDB is available in Safari private browsing and Chrome incognito, with a distinguishable
   failure mode.

Assumption 1 changes the keyboard map. Assumptions 2, 3 and 6 change how loudly §8 must warn the
user. None of them change the architecture.

## 12. Success criteria

1. All 148 ported tests pass, named to match their Swift originals.
2. `decode → encode` of the real macOS `data.json` is byte-identical.
3. The drift job proves Swift accepts our output.
4. A task created in the web app, exported, and opened by the macOS app appears intact — and the
   reverse.
5. The app is reachable at the Pages URL and survives a hard reload with data intact.
6. Every reorder and every task action is reachable from the keyboard.
