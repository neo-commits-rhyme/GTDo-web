# GTDo Web — Direct Manipulation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drag, swipe and undo — as accelerators over the keyboard and menu paths sub-project 1 already shipped, never as replacements for them.

**Architecture:** Undo lives in `core/` as pure snapshot logic with a single-slot centre. Drag routes to store methods that already exist and are already tested, with drop-target resolution written as pure functions so the index arithmetic is testable without a DOM. Swipe is a touch-only wrapper around `TaskRow`.

**Tech Stack:** `@dnd-kit/core` + `@dnd-kit/sortable`, Pointer Events for swipe, Vitest + Testing Library.

**Spec:** `docs/specs/2026-07-28-direct-manipulation-design.md`. Read §2.3 before writing a line of undo.

## Global Constraints

- **No behaviour changes.** All 372 tests from sub-projects 1–2 must still pass untouched.
- **Drag never replaces a keyboard path.** `[`/`]` and the ↑/↓ menu buttons stay. Every drag surface wires `KeyboardSensor`.
- **Drops route through `requestMove`, never `moveTask`** — `moveTask` does not enforce the deadline-required lists, by design.
- **A drop on no valid target is a no-op**, never a move to the end.
- **Undo is a snapshot, never a description.** See spec §2.1.
- **Restore order is fixed** (spec §2.3) and each rule carries its own test.
- **No full swipe in Completed or Trash.** A reflex must never do something unrecoverable.
- **Colours come from tokens.** The `styles.css` no-colour-literals test from sub-project 2 still applies.
- Conventional commits, one per task.

---

### Task 1: Undo core

**Files:**
- Create: `src/core/undo.ts`
- Test: `src/core/__tests__/undo.test.ts`
- Reference: `../GTDo/ios/GTDoiOS/Support/UndoAction.swift`, `UndoCenter.swift`

**Interfaces:**
- Produces: `type UndoAction = { label: string; snapshots: TaskItem[]; spawnedIDs: string[] }`, `undoLabel(verb: string, count: number): string`, `reverse(action: UndoAction, store: AppStore): void`, `class UndoCenter { perform(label, ids, store, mutate): void; get pending(): UndoAction | null; undo(store): void; dismiss(): void; subscribe(fn): () => void }`, `UNDO_WINDOW_MS = 8000`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { AppStore } from '../store'
import { MemoryAdapter } from '../../storage/memoryAdapter'
import { BuiltIn } from '../models'
import { UndoCenter, undoLabel, UNDO_WINDOW_MS } from '../undo'

const NOW = new Date(2026, 6, 28, 9, 0, 0)
const store = async () =>
  AppStore.create({ adapter: new MemoryAdapter(), now: () => NOW, scheduler: (_m, f) => f() })

describe('Undo', () => {
  it('theWindowIsEightSecondsAndNotAPreference', () => {
    // iOS uses 5s doubled for VoiceOver; the web cannot detect assistive tech,
    // so the generous path is the only path. Spec §4.1.
    expect(UNDO_WINDOW_MS).toBe(8000)
  })

  it('labelsCountCorrectly', () => {
    expect(undoLabel('completed', 1)).toBe('1 task completed')
    expect(undoLabel('moved', 3)).toBe('3 tasks moved')
  })

  it('performSnapshotsBeforeMutating', async () => {
    const s = await store()
    const t = s.addTask('thing', { kind: 'list', id: BuiltIn.notes })!
    const undo = new UndoCenter()
    undo.perform('trashed', [t.id], s, () => s.trashTask(t.id))
    expect(s.task(t.id)!.isTrashed).toBe(true)
    undo.undo(s)
    expect(s.task(t.id)!.isTrashed).toBe(false)
  })

  it('restoresBeforeMoving', async () => {
    // Rule 1: moveTask is a no-op on a trashed task, so restoreTask must run
    // first or the list never comes back.
    const s = await store()
    const t = s.addTask('thing', { kind: 'list', id: BuiltIn.notes })!
    const undo = new UndoCenter()
    undo.perform('trashed', [t.id], s, () => {
      s.trashTask(t.id)
      s.data.tasks[0]!.listID = BuiltIn.inbox // as if filed elsewhere after
    })
    undo.undo(s)
    expect(s.task(t.id)!.isTrashed).toBe(false)
    expect(s.task(t.id)!.listID).toBe(BuiltIn.notes)
  })

  it('movesBeforeRestoringTheDeadline', async () => {
    // Rule 2: moving into Someday re-clears a deadline, so the move must
    // happen before setDueDate or the date is lost again.
    const s = await store()
    const t = s.addTask('thing', { kind: 'list', id: BuiltIn.notes })!
    s.setDueDate(t.id, new Date(2026, 7, 5))
    const undo = new UndoCenter()
    undo.perform('moved', [t.id], s, () => s.moveTask(t.id, BuiltIn.someday))
    expect(s.task(t.id)!.dueDate).toBeNull() // the Someday rule stripped it
    undo.undo(s)
    expect(s.task(t.id)!.listID).toBe(BuiltIn.notes)
    expect(s.task(t.id)!.dueDate!.getDate()).toBe(5)
  })

  it('setsTheDeadlineBeforeTheRepeatRule', async () => {
    // Rule 3: setDueDate(null) also nils the rule, and setRepeatRule on an
    // undated task back-fills today. Wrong order loses one or the other.
    const s = await store()
    const t = s.addTask('thing', { kind: 'list', id: BuiltIn.notes })!
    s.setDueDate(t.id, new Date(2026, 7, 5))
    s.setRepeatRule(t.id, { unit: 'week', interval: 2 })
    const undo = new UndoCenter()
    undo.perform('moved', [t.id], s, () => s.moveTask(t.id, BuiltIn.someday))
    undo.undo(s)
    expect(s.task(t.id)!.dueDate!.getDate()).toBe(5)
    expect(s.task(t.id)!.repeatRule).toEqual({ unit: 'week', interval: 2 })
  })

  it('removesASpawnedOccurrence', async () => {
    // The test that justifies the entire snapshot design: un-completing does
    // not remove the occurrence completing spawned, so undo must.
    const s = await store()
    const t = s.addTask('water plants', { kind: 'list', id: BuiltIn.notes })!
    s.setDueDate(t.id, new Date(2026, 6, 28))
    s.setRepeatRule(t.id, { unit: 'week', interval: 1 })
    const undo = new UndoCenter()
    undo.perform('completed', [t.id], s, () => s.toggleCompleted(t.id))
    expect(s.data.tasks.length).toBe(2)
    undo.undo(s)
    expect(s.data.tasks.length).toBe(1)
    expect(s.task(t.id)!.isCompleted).toBe(false)
    expect(s.task(t.id)!.repeatRule).toEqual({ unit: 'week', interval: 1 })
  })

  it('skipsATaskDeletedSinceTheSnapshot', async () => {
    const s = await store()
    const t = s.addTask('thing', { kind: 'list', id: BuiltIn.notes })!
    const undo = new UndoCenter()
    undo.perform('trashed', [t.id], s, () => s.trashTask(t.id))
    s.deleteTaskPermanently(t.id)
    expect(() => undo.undo(s)).not.toThrow()
    expect(s.task(t.id)).toBeNull() // not resurrected
  })

  it('holdsAtMostOnePending', async () => {
    const s = await store()
    const a = s.addTask('a', { kind: 'list', id: BuiltIn.notes })!
    const b = s.addTask('b', { kind: 'list', id: BuiltIn.notes })!
    const undo = new UndoCenter()
    undo.perform('trashed', [a.id], s, () => s.trashTask(a.id))
    undo.perform('trashed', [b.id], s, () => s.trashTask(b.id))
    expect(undo.pending!.snapshots[0]!.id).toBe(b.id)
    undo.undo(s)
    expect(s.task(a.id)!.isTrashed).toBe(true) // superseded, still trashed
    expect(s.task(b.id)!.isTrashed).toBe(false)
  })

  it('recordsNothingWhenTheMutationTouchedNothing', async () => {
    const s = await store()
    const undo = new UndoCenter()
    undo.perform('trashed', ['99999999-0000-0000-0000-000000000000'], s, () => {})
    expect(undo.pending).toBeNull()
  })

  it('undoingClearsThePending', async () => {
    const s = await store()
    const t = s.addTask('thing', { kind: 'list', id: BuiltIn.notes })!
    const undo = new UndoCenter()
    undo.perform('trashed', [t.id], s, () => s.trashTask(t.id))
    undo.undo(s)
    expect(undo.pending).toBeNull()
    expect(() => undo.undo(s)).not.toThrow()
  })

  it('notifiesSubscribersOnPresentAndClear', async () => {
    const s = await store()
    const t = s.addTask('thing', { kind: 'list', id: BuiltIn.notes })!
    const undo = new UndoCenter()
    let ticks = 0
    undo.subscribe(() => { ticks += 1 })
    undo.perform('trashed', [t.id], s, () => s.trashTask(t.id))
    undo.undo(s)
    expect(ticks).toBeGreaterThanOrEqual(2)
  })
})
```

- [ ] **Step 2: Run it to verify it fails** — `npx vitest run src/core/__tests__/undo.test.ts`, expect FAIL (module not found).

- [ ] **Step 3: Implement `src/core/undo.ts`**

Port `UndoAction.reverse` with the four ordering rules from spec §2.3, each carrying the comment that says why. `UndoCenter` holds one slot, expires it through the injected scheduler, and exposes subscribe/pending/undo/dismiss. `perform` computes `spawnedIDs` by diffing the task-id set across the mutation.

- [ ] **Step 4: Run it to verify it passes** — expect PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/undo.ts src/core/__tests__/undo.test.ts
git commit -m "feat: snapshot-based undo with the load-bearing restore order"
```

---

### Task 2: The undo bar and ⌘Z

**Files:**
- Create: `src/app/UndoBar.tsx`
- Modify: `src/app/RootShell.tsx`, `src/app/useShortcuts.ts`, `src/app/styles.css`
- Test: `src/app/__tests__/undoBar.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it('showsTheLabelAndAnUndoButton', …)
it('undoingFromTheBarReversesTheMutation', …)
it('theBarDisappearsAfterTheWindow', …)           // injected scheduler
it('cmdZUndoesForTheWholeWindow', …)              // not just while hovering a toast
it('cmdZIsIgnoredWhileATextFieldHasFocus', …)     // the existing suppression rule
it('theBarIsAStatusRegionNotAnAlert', …)          // role="status", polite
it('aSecondActionSupersedesTheFirst', …)
```

- [ ] **Step 2: Run it to verify it fails** — expect FAIL.

- [ ] **Step 3: Implement.** `UndoBar` subscribes to the centre and renders `role="status"` with `aria-live="polite"`. `⌘Z`/`Ctrl+Z` is added to `useShortcuts` — one of the few chords worth attempting, since browsers do not own it outside a text field, and the handler already returns early when one is focused.

- [ ] **Step 4: Run it to verify it passes** — expect PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/UndoBar.tsx src/app/RootShell.tsx src/app/useShortcuts.ts src/app/styles.css src/app/__tests__/undoBar.test.tsx
git commit -m "feat: undo bar with a keyboard path for the whole window"
```

---

### Task 3: Drop-target resolution, as pure functions

Written before any `dnd-kit` wiring, because this is where the index arithmetic bites and it is far easier to get right without a DOM in the way.

**Files:**
- Create: `src/app/dnd/resolve.ts`
- Test: `src/app/dnd/__tests__/resolve.test.ts`

**Interfaces:**
- Produces: `type DropTarget = { kind: 'reorder-task'; listID: string; from: number; to: number } | { kind: 'move-task'; taskID: string; listID: string } | { kind: 'reorder-sidebar'; scope: 'gtd' | 'user'; from: number; to: number } | { kind: 'reorder-in-group'; groupID: string; from: number; to: number } | null`
- `resolveDrop(active: string, over: string | null, context: DndContextIDs): DropTarget`
- `toOnMoveDestination(from: number, to: number): number`

- [ ] **Step 1: Write the failing test**

```ts
it('aDropOnNothingIsANoOpNotAMoveToTheEnd', …)
it('aDropOnItselfIsANoOp', …)
it('convertsASortableIndexToOnMoveDestinationSemantics', …)
  // moving item 0 down one is destination 2, matching the store
it('resolvesATaskDroppedOnASidebarListAsAMove', …)
it('resolvesATaskDroppedOnAnotherTaskAsAReorder', …)
it('resolvesASidebarEntryDroppedInTheGTDBlock', …)
it('refusesToReorderATaskAcrossLists', …)  // that is a move, not a reorder
```

- [ ] **Step 2: Run it to verify it fails** — expect FAIL.
- [ ] **Step 3: Implement.** Pure; takes ids and index maps, returns a target or null. No React, no `dnd-kit` types.
- [ ] **Step 4: Run it to verify it passes** — expect PASS.
- [ ] **Step 5: Commit**

```bash
git add src/app/dnd
git commit -m "feat: drop-target resolution as pure functions"
```

---

### Task 4: Drag wiring

**Files:**
- Create: `src/app/dnd/DragProvider.tsx`
- Modify: `src/app/TaskList.tsx`, `src/app/TaskRow.tsx`, `src/app/Sidebar.tsx`
- Test: `src/app/__tests__/drag.test.tsx`
- Dependency: `npm i @dnd-kit/core @dnd-kit/sortable`

- [ ] **Step 1: Write the failing test**

```tsx
it('everyDragSurfaceWiresAKeyboardSensor', …)
it('theBracketShortcutsStillWork', …)          // drag layered over, not replacing
it('theReorderMenuButtonsStillExist', …)
it('droppingATaskOnNextActionsRaisesTheDeadlinePrompt', …)
  // requestMove, never moveTask — a drop wired to moveTask would silently
  // produce an undated task in a list whose whole point is that it is dated
it('droppingATaskOnAnUnconstrainedListMovesItImmediately', …)
it('aMoveByDragIsUndoable', …)
```

- [ ] **Step 2: Run it to verify it fails** — expect FAIL.
- [ ] **Step 3: Implement.** `DragProvider` holds the `DndContext` with `PointerSensor` and `KeyboardSensor`, resolves via Task 3, and routes every mutation through `UndoCenter.perform`.
- [ ] **Step 4: Run it to verify it passes** — expect PASS.
- [ ] **Step 5: Commit**

```bash
git add src/app package.json package-lock.json
git commit -m "feat: drag to reorder tasks, move tasks and reorder the sidebar"
```

---

### Task 5: Swipe

**Files:**
- Create: `src/app/swipe/SwipeRow.tsx`, `src/app/swipe/swipePlan.ts`
- Modify: `src/app/TaskRow.tsx`, `src/app/styles.css`
- Test: `src/app/swipe/__tests__/swipe.test.tsx`

**Interfaces:**
- Produces: `swipeActionsFor(selection: SidebarItem | null): { leading: 'complete' | null; trailing: 'trash' | null }`

- [ ] **Step 1: Write the failing test**

```ts
it('leadingCompletesAndTrailingTrashes', …)
it('noFullSwipeInCompletedOrTrash', …)
  // the only commits there are un-complete (already one tap) and permanent
  // deletion; a reflex must never do something unrecoverable
it('swipeIsTouchOnlyAndIgnoresAMouseDrag', …)   // a mouse drag is a drag
it('aSwipeBelowTheThresholdSnapsBackAndCommitsNothing', …)
it('everySwipeIsUndoable', …)
```

- [ ] **Step 2: Run it to verify it fails** — expect FAIL.
- [ ] **Step 3: Implement.** `swipePlan.ts` is pure — which actions a screen offers. `SwipeRow` listens for `pointerdown` with `pointerType === 'touch'` only, tracks displacement, and commits past a threshold through `UndoCenter.perform`.
- [ ] **Step 4: Run it to verify it passes** — expect PASS.
- [ ] **Step 5: Commit**

```bash
git add src/app/swipe src/app/TaskRow.tsx src/app/styles.css
git commit -m "feat: touch-only swipe, barred where it would be unrecoverable"
```

---

### Task 6: Verify and ship

- [ ] **Step 1: Add the E2E**

```ts
test('a task can be reordered by keyboard alone', …)
test('dragging a task onto Next actions raises the deadline prompt', …)
test('undo restores a trashed task', …)
```

- [ ] **Step 2: Run everything** — `npx tsc --noEmit && npx eslint . && npx vitest run && npx vite build && npx playwright test`. All 372 existing tests must still pass.
- [ ] **Step 3: Look at the running app.** Drag a task, drag it onto a list, swipe on a touch emulation, and undo each. Two bugs in sub-project 1 and three in sub-project 2 were found this way and by nothing else.
- [ ] **Step 4: Update the README** — move drag/swipe/undo out of "Not here yet".
- [ ] **Step 5: Commit and push.**

---

## Verification against the spec

| Spec section | Task |
|---|---|
| §2.1 snapshots not descriptions | 1 |
| §2.2 un-forgettable snapshot API | 1 |
| §2.3 restore order | 1 (one test per rule) |
| §2.4 what is undoable | 1, 4, 5 |
| §3 drag surfaces | 3 (resolution), 4 (wiring) |
| §3 `requestMove` not `moveTask` | 4 |
| §4 swipe | 5 |
| §4.1 the window and the keyboard path | 1, 2 |
| §5 what gets built | 1–5 |
| §6 testing | every task |
| §8 success criteria | 4 (1, 2), 1 (3), 5 (4), 6 (5) |
