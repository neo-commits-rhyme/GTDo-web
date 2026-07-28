# GTDo Web — sub-project 3: direct manipulation

**Date:** 2026-07-28 · **Status:** approved design, ready for implementation planning.
**Builds on:** sub-project 1 (core + shell) and 2 (visual identity), both shipped.

Drag, swipe and undo. Everything here is an **accelerator over paths that already
work** — sub-project 1 shipped `[`/`]` and menu-based reordering on the explicit
premise that drag would layer over them, and this sub-project keeps that promise
rather than quietly making reordering mouse-only.

## 1. Decisions

1. **`dnd-kit`** for drag. Chosen over native HTML5 drag-and-drop (no touch
   support at all, unstyleable drag images) and over hand-rolled Pointer Events
   (rebuilding collision detection, auto-scroll and keyboard operability is the
   heaviest and most bug-prone part of this work).
2. **Fixed swipe actions, not the iOS six-context configuration.** On iPhone
   swipe is the primary interaction and the preferences earn their keep; on the
   web it is a secondary accelerator over drag, menus and keyboard.
3. **Undo is snapshot-based**, ported from `ios/GTDoiOS/Support/UndoAction.swift`.
4. **An ~8-second window plus a keyboard path**, rather than the iOS 5 seconds.
   See §4.1 — this is the one part of the iOS design that must not be copied
   verbatim.

## 2. Undo

### 2.1 Why snapshots, not descriptions

Ported verbatim from the Swift, because the reasoning is unchanged:

> Descriptions do not survive the store's side effects: `moveTask` into Someday
> nils both `dueDate` and `repeatRule`, and completing a repeating task spawns
> its next occurrence. An "undo the move" that only moved the task back would
> silently destroy a weekly recurrence.

So an `UndoAction` carries **the affected tasks exactly as they were**, plus the
ids of any tasks the mutation *created* — un-completing a repeating task does
not remove the occurrence completing it spawned, so undo has to.

### 2.2 The API that makes the snapshot un-forgettable

```ts
perform(label: string, ids: string[], mutate: () => void): void
```

Snapshot → mutate → record, in one call. A caller cannot forget the snapshot and
ship an undo that does nothing, because there is no separate "record" step to
skip.

### 2.3 Restore order is load-bearing

Every step re-reads the store, because each call mutates it:

1. **`restoreTask` first** — `moveTask` is a no-op on a trashed task.
2. **`moveTask` before the deadline** — moving into Someday would re-clear a
   deadline we had just restored.
3. **`setDueDate` before `setRepeatRule`** — `setDueDate(null)` also nils the
   rule, and `setRepeatRule` on an undated task back-fills a deadline of today.
4. **`toggleCompleted` last**, so nothing above runs against a task the store
   considers finished.

A task permanently deleted since the snapshot is skipped, not resurrected.

Each of these four gets a test that fails if the order changes.

### 2.4 What is undoable

Complete (via swipe), trash, move (drag or menu), reorder, empty trash, delete
permanently.

**Not** undoable: import, reset and load-sample. Those already take a forced
snapshot before running, which is a stronger and longer-lived guarantee than a
transient bar.

## 3. Drag

Three surfaces, all through `dnd-kit`, all routed to store methods that already
exist and are already tested:

| Surface | Store call | Note |
|---|---|---|
| Task reorder within a list | `moveIncompleteTasks(listID, [from], to)` | Redistributes only that list's own slots |
| Task onto a sidebar list | `requestMove([id], listID)` | **Not** `moveTask` — see below |
| Sidebar entry reorder | `moveGTDEntries` / `moveUserEntries` / `moveListsInGroup` | |

**Dropping a task onto Next actions or Waiting for… must raise the deadline
prompt**, which is why the drop handler calls `requestMove` and never `moveTask`.
`moveTask` does not enforce the deadline-required lists — that is deliberate in
the store and documented in sub-project 1 — so a drop wired to it would silently
produce an undated task in a list whose entire purpose is that everything in it
is dated.

`KeyboardSensor` is enabled on every surface. The `[`/`]` shortcuts and the ↑/↓
menu buttons from sub-project 1 stay exactly as they are.

A drop that lands on no valid target is a **no-op**, never a move to the end of
the list.

Drop-target resolution is written as pure functions over ids and indices, so the
index arithmetic — which is where `onMove`'s pre-removal semantics bite — is
testable without a DOM.

## 4. Swipe

Touch only. Leading swipe completes; trailing swipe trashes.

**No full swipe in Completed or Trash.** The only commits available on those two
screens are un-complete, which is already one tap, and permanent deletion. A
reflex must never do something unrecoverable.

Pointer-driven swipe is deliberately not enabled: a mouse drag is a drag, and
overloading the same gesture would make reordering ambiguous.

Every swipe goes through `perform`, so nothing a reflex does is unrecoverable.

### 4.1 The window, and why it differs from iOS

iOS uses a 5-second window, doubled when VoiceOver or Switch Control is running
— documented there as "a sighted-thumb budget" with an explicit accommodation.

**The web has no reliable screen-reader detection API, deliberately, for
privacy.** The mechanism that makes the iOS window fair is unavailable.

So the window is **8 seconds for everyone**, and `⌘Z` / `Ctrl+Z` undoes the
pending action for that entire window without requiring anyone to hit a toast in
time. Shipping the 5-second budget without the accommodation it depends on is
the one part of the iOS design it would be wrong to copy verbatim.

The window is fixed and not a preference, matching iOS: nobody may configure
themselves into an irreversible one-gesture move.

## 5. What gets built

- `src/core/undo.ts` — `UndoAction`, restore order, `UndoCenter` with one slot.
- `src/app/undo/UndoBar.tsx` — the transient bar, `role="status"`, with the
  action's label and an Undo button.
- `src/app/dnd/` — sensors, drop-target resolution as pure functions, and the
  three drag surfaces.
- `src/app/swipe/` — a touch-only swipe wrapper around `TaskRow`.
- `⌘Z` / `Ctrl+Z` added to `useShortcuts`. This is one of the few chords worth
  attempting: unlike `⌘N`, browsers do not own `⌘Z` outside a text field, and
  the handler already suppresses itself while one is focused.

## 6. Testing

- **Restore order**: one test per rule in §2.3, each failing if the order changes.
- **The recurrence case**: completing a repeating task then undoing removes the
  spawned occurrence. This is the test that justifies the whole snapshot design.
- **Permanently-deleted-since**: undo skips it rather than resurrecting it.
- **Drop resolution**: pure-function tests over indices, including the
  pre-removal `onMove` semantics and the drop-on-nothing no-op.
- **Deadline enforcement on drop**: dropping an undated task on Next actions
  raises the prompt and does not move the task.
- **Swipe barred**: no full swipe in Completed or Trash.
- **Keyboard operability**: reordering by keyboard still works, and the
  sub-project 1 shortcuts are unchanged.
- **All 372 existing tests keep passing.** This sub-project adds gestures; it
  changes no behaviour.

## 7. Out of scope

Inbox Review (sub-project 4), reminders and PWA (5).

## 8. Success criteria

1. Every reorder and move reachable by drag is also reachable by keyboard.
2. Dropping onto a deadline-required list raises the prompt.
3. Undo restores a completed repeating task without leaving its spawn behind.
4. No full swipe in Completed or Trash.
5. All 372 existing tests still pass.
