/**
 * Snapshot-based undo. Port of ios/GTDoiOS/Support/{UndoAction,UndoCenter}.swift.
 *
 * A reversible mutation is captured as *the state before*, never as a
 * description of what happened. Descriptions do not survive the store's side
 * effects: moveTask into Someday nils both dueDate and repeatRule, and
 * completing a repeating task spawns its next occurrence. An "undo the move"
 * that only moved the task back would silently destroy a weekly recurrence.
 * Snapshots cannot have that bug.
 */

import type { AppStore } from './store'
import { sameID, type TaskItem } from './models'

/**
 * Eight seconds, and deliberately not a preference: nobody may configure
 * themselves into an irreversible one-gesture move.
 *
 * iOS uses five, doubled when VoiceOver or Switch Control is running — an
 * accommodation, not a setting. The web has no reliable screen-reader
 * detection API, so that mechanism is unavailable and the generous window is
 * the only window. The keyboard path (Cmd/Ctrl+Z) covers the whole of it, so
 * nobody has to hit a moving target.
 */
export const UNDO_WINDOW_MS = 8000

export type UndoAction = {
  label: string
  /** The affected tasks exactly as they were. */
  snapshots: TaskItem[]
  /**
   * Tasks the mutation *created*. Un-completing a repeating task does not
   * remove the occurrence completing it spawned, so undo has to.
   */
  spawnedIDs: string[]
  /**
   * Lists the mutation *created*. convertToProject makes a list as well as
   * moving the task, and restoring the task alone left the empty project
   * behind.
   */
  spawnedListIDs: string[]
}

export function undoLabel(verb: string, count: number): string {
  return `${count} ${count === 1 ? 'task' : 'tasks'} ${verb}`
}

/**
 * Order is load-bearing, and every step re-reads the store because each call
 * mutates it:
 *
 *   1. restoreTask first — moveTask is a no-op on a trashed task.
 *   2. moveTask before the deadline — moving into Someday would re-clear a
 *      deadline we had just restored.
 *   3. setDueDate before setRepeatRule — setDueDate(null) also nils the rule,
 *      and setRepeatRule on an undated task back-fills a deadline of today.
 *   4. restoreFlags last, so nothing above runs against a task the store
 *      considers finished or binned.
 */
function restore(snapshot: TaskItem, store: AppStore): void {
  if (store.task(snapshot.id) === null) return // permanently deleted since

  if (store.task(snapshot.id)!.isTrashed && !snapshot.isTrashed) {
    store.restoreTask(snapshot.id)
  }
  if (!sameID(store.task(snapshot.id)!.listID, snapshot.listID)) {
    store.moveTask(snapshot.id, snapshot.listID)
  }

  const nowDue = store.task(snapshot.id)!.dueDate
  const sameDue = nowDue?.getTime() === snapshot.dueDate?.getTime()
  if (!sameDue) store.setDueDate(snapshot.id, snapshot.dueDate)

  const nowRule = store.task(snapshot.id)!.repeatRule
  const sameRule = JSON.stringify(nowRule) === JSON.stringify(snapshot.repeatRule)
  if (!sameRule) store.setRepeatRule(snapshot.id, snapshot.repeatRule)

  restoreFlags(snapshot, store)
  // Reorder has no inverse of its own — moveIncompleteTasks redistributes
  // slots — so the slot is restored from the snapshot directly.
  if (store.task(snapshot.id)!.order !== snapshot.order) {
    store.setTaskOrder(snapshot.id, snapshot.order)
  }
  if (store.task(snapshot.id)!.note !== snapshot.note) {
    store.setNote(snapshot.id, snapshot.note)
  }
  if (store.task(snapshot.id)!.title !== snapshot.title) {
    store.renameTask(snapshot.id, snapshot.title)
  }
}

/**
 * Completion and trash come back as raw fields, because the store's mutators
 * for them are not inverses. toggleCompleted re-stamps completedAt with now —
 * resorting an old task to the top of Completed — and re-spawns a repeating
 * task's next occurrence, which reverse() cannot delete because it was created
 * during the undo, not during the mutation. trashTask likewise refreshes
 * trashedAt, handing a nearly-purged item a fresh thirty days.
 *
 * The un-trash direction still goes through restoreTask above: moveTask is a
 * no-op on a trashed task, so it has to happen before the move, and it already
 * writes exactly what a non-trashed snapshot holds.
 */
function restoreFlags(snapshot: TaskItem, store: AppStore): void {
  const task = store.data.tasks.find((t) => sameID(t.id, snapshot.id))
  if (task === undefined) return
  if (
    task.isCompleted === snapshot.isCompleted &&
    task.completedAt?.getTime() === snapshot.completedAt?.getTime() &&
    task.isTrashed === snapshot.isTrashed &&
    task.trashedAt?.getTime() === snapshot.trashedAt?.getTime()
  ) return

  task.isCompleted = snapshot.isCompleted
  task.completedAt = snapshot.completedAt
  task.isTrashed = snapshot.isTrashed
  task.trashedAt = snapshot.trashedAt
  // The two things trashTask/toggleCompleted do that the undo still wants:
  // whether a reminder is live depends on both flags, and a re-binned task must
  // not stay selected behind the detail pane.
  if (task.isTrashed && store.selectedTaskID !== null && sameID(store.selectedTaskID, task.id)) {
    store.setSelectedTask(null)
  }
  store.syncReminder(snapshot.id)
  store.persist()
}

export function reverse(action: UndoAction, store: AppStore): void {
  // Spawned tasks go first: restoring the original may re-run the logic that
  // made them, and a leftover occurrence is the exact bug snapshots exist to
  // avoid.
  for (const id of action.spawnedIDs) store.deleteTaskPermanently(id)

  for (const snapshot of action.snapshots) restore(snapshot, store)

  // Spawned lists go LAST, once the snapshots have moved their tasks back out.
  // deleteList trashes whatever still lives in the list, so removing a project
  // before restoring its task would trash the very task we are restoring.
  for (const id of action.spawnedListIDs) store.deleteList(id)
}

/**
 * Holds at most one pending undo and expires it. One slot is the whole model —
 * only one bar is ever on screen.
 */
export class UndoCenter {
  private action: UndoAction | null = null
  private generation = 0
  private subscribers = new Set<() => void>()

  constructor(
    private readonly scheduler: (ms: number, fn: () => void) => void = (ms, fn) => {
      setTimeout(fn, ms)
    },
  ) {}

  get pending(): UndoAction | null {
    return this.action
  }

  subscribe(fn: () => void): () => void {
    this.subscribers.add(fn)
    return () => this.subscribers.delete(fn)
  }

  private notify(): void {
    for (const fn of this.subscribers) fn()
  }

  /**
   * Snapshot -> mutate -> record, in one call, so a caller cannot forget the
   * snapshot and ship an undo that does nothing.
   */
  perform(label: string, ids: string[], store: AppStore, mutate: () => void): void {
    const snapshots = ids
      .map((id) => store.task(id))
      .filter((t): t is Readonly<TaskItem> => t !== null)
      .map((t) => ({ ...t }))
    const before = new Set(store.data.tasks.map((t) => t.id))
    const listsBefore = new Set(store.data.lists.map((l) => l.id))

    mutate()

    const spawnedIDs = store.data.tasks.map((t) => t.id).filter((id) => !before.has(id))
    const spawnedListIDs = store.data.lists.map((l) => l.id).filter((id) => !listsBefore.has(id))
    if (snapshots.length === 0 && spawnedIDs.length === 0 && spawnedListIDs.length === 0) return

    this.present({ label, snapshots, spawnedIDs, spawnedListIDs })
  }

  private present(action: UndoAction): void {
    this.action = action
    this.generation += 1
    const generation = this.generation
    this.notify()
    // Staleness disarms an old expiry; no timer is ever cancelled.
    this.scheduler(UNDO_WINDOW_MS, () => {
      if (generation === this.generation) this.dismiss()
    })
  }

  undo(store: AppStore): void {
    if (this.action === null) return
    reverse(this.action, store)
    this.dismiss()
  }

  dismiss(): void {
    if (this.action === null) return
    this.action = null
    this.generation += 1
    this.notify()
  }
}
