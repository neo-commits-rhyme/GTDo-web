import { describe, it, expect } from 'vitest'
import { AppStore } from '../store'
import { MemoryAdapter } from '../../storage/memoryAdapter'
import { BuiltIn } from '../models'
import { UndoCenter, undoLabel, UNDO_WINDOW_MS } from '../undo'

const NOW = new Date(2026, 6, 28, 9, 0, 0)
const store = async () =>
  AppStore.create({ adapter: new MemoryAdapter(), now: () => NOW, scheduler: (_m, f) => f() })
/** A store whose clock the test can advance — "days later, undo" needs two nows. */
const movingStore = async (clock: () => Date) =>
  AppStore.create({ adapter: new MemoryAdapter(), now: clock, scheduler: (_m, f) => f() })
/** Never fires, so a pending action stays pending for the assertions. */
const held = () => new UndoCenter(() => {})

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
    const undo = held()
    undo.perform('trashed', [t.id], s, () => s.trashTask(t.id))
    expect(s.task(t.id)!.isTrashed).toBe(true)
    undo.undo(s)
    expect(s.task(t.id)!.isTrashed).toBe(false)
  })

  it('restoresBeforeMoving', async () => {
    // Rule 1: moveTask is a no-op on a trashed task, so restoreTask must run
    // first or the original list never comes back.
    const s = await store()
    const t = s.addTask('thing', { kind: 'list', id: BuiltIn.notes })!
    const undo = held()
    undo.perform('trashed', [t.id], s, () => {
      s.trashTask(t.id)
      s.data.tasks[0]!.listID = BuiltIn.inbox // as if filed elsewhere afterwards
    })
    undo.undo(s)
    expect(s.task(t.id)!.isTrashed).toBe(false)
    expect(s.task(t.id)!.listID).toBe(BuiltIn.notes)
  })

  it('movesBeforeRestoringTheDeadline', async () => {
    // Rule 2: moving into Someday re-clears a deadline, so the move must
    // happen before setDueDate or the date is lost a second time.
    const s = await store()
    const t = s.addTask('thing', { kind: 'list', id: BuiltIn.notes })!
    s.setDueDate(t.id, new Date(2026, 7, 5))
    const undo = held()
    undo.perform('moved', [t.id], s, () => s.moveTask(t.id, BuiltIn.someday))
    expect(s.task(t.id)!.dueDate).toBeNull() // the Someday rule stripped it
    undo.undo(s)
    expect(s.task(t.id)!.listID).toBe(BuiltIn.notes)
    expect(s.task(t.id)!.dueDate!.getDate()).toBe(5)
  })

  it('setsTheDeadlineBeforeTheRepeatRule', async () => {
    // Rule 3: setDueDate(null) also nils the rule, and setRepeatRule on an
    // undated task back-fills today. The wrong order loses one or the other.
    const s = await store()
    const t = s.addTask('thing', { kind: 'list', id: BuiltIn.notes })!
    s.setDueDate(t.id, new Date(2026, 7, 5))
    s.setRepeatRule(t.id, { unit: 'week', interval: 2 })
    const undo = held()
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
    const undo = held()
    undo.perform('completed', [t.id], s, () => s.toggleCompleted(t.id))
    expect(s.data.tasks.length).toBe(2)
    undo.undo(s)
    expect(s.data.tasks.length).toBe(1)
    expect(s.task(t.id)!.isCompleted).toBe(false)
    expect(s.task(t.id)!.repeatRule).toEqual({ unit: 'week', interval: 1 })
  })

  it('undoingAnUnCompleteDoesNotSpawnAnExtraOccurrence', async () => {
    // The other direction of the same bug: re-completing through
    // toggleCompleted spawns a SECOND occurrence, and reverse() only deletes
    // the ids the original mutation created, so the new one survives forever.
    const s = await store()
    const t = s.addTask('water plants', { kind: 'list', id: BuiltIn.notes })!
    s.setDueDate(t.id, new Date(2026, 6, 20))
    s.setRepeatRule(t.id, { unit: 'week', interval: 1 })
    s.toggleCompleted(t.id)
    expect(s.data.tasks.length).toBe(2) // the original plus next Monday's

    const undo = held()
    undo.perform('reopened', [t.id], s, () => s.toggleCompleted(t.id))
    undo.undo(s)
    expect(s.data.tasks.length).toBe(2)
    expect(s.task(t.id)!.isCompleted).toBe(true)
  })

  it('undoingAnUnCompleteRestoresTheOriginalCompletionDate', async () => {
    // completedAt is what Completed sorts by, so a re-stamped date silently
    // moves an eight-day-old task to the top of the list.
    let now = new Date(2026, 6, 20, 9, 0, 0)
    const s = await movingStore(() => now)
    const t = s.addTask('file the receipts', { kind: 'list', id: BuiltIn.notes })!
    s.toggleCompleted(t.id)
    const completedAt = s.task(t.id)!.completedAt!

    now = new Date(2026, 6, 28, 9, 0, 0)
    const undo = held()
    undo.perform('reopened', [t.id], s, () => s.toggleCompleted(t.id))
    undo.undo(s)
    expect(s.task(t.id)!.completedAt!.getTime()).toBe(completedAt.getTime())
  })

  it('undoingARestoreDoesNotRestartThePurgeClock', async () => {
    // trashTask deliberately refreshes trashedAt, so routing undo through it
    // hands a week-old item a brand new thirty days in the Trash.
    let now = new Date(2026, 6, 20, 9, 0, 0)
    const s = await movingStore(() => now)
    const t = s.addTask('old receipt', { kind: 'list', id: BuiltIn.notes })!
    s.trashTask(t.id)
    const trashedAt = s.task(t.id)!.trashedAt!

    now = new Date(2026, 6, 28, 9, 0, 0)
    const undo = held()
    undo.perform('restored', [t.id], s, () => s.restoreTask(t.id))
    undo.undo(s)
    expect(s.task(t.id)!.isTrashed).toBe(true)
    expect(s.task(t.id)!.trashedAt!.getTime()).toBe(trashedAt.getTime())
    s.purgeTrash(7)
    expect(s.task(t.id)).toBeNull() // still eight days old, so still due to go
  })

  it('undoingARestoreDropsTheSelectionTheWayTrashingDoes', async () => {
    // Undo must land on the state trashing produces, and trashTask clears the
    // selection — otherwise the detail pane keeps showing a binned task.
    const s = await store()
    const t = s.addTask('old receipt', { kind: 'list', id: BuiltIn.notes })!
    s.trashTask(t.id)
    s.setSelectedTask(t.id)
    const undo = held()
    undo.perform('restored', [t.id], s, () => s.restoreTask(t.id))
    undo.undo(s)
    expect(s.selectedTaskID).toBeNull()
  })

  it('restoresTheTitleAndNote', async () => {
    const s = await store()
    const t = s.addTask('original', { kind: 'list', id: BuiltIn.notes })!
    s.setNote(t.id, 'context that matters')
    const undo = held()
    undo.perform('edited', [t.id], s, () => {
      s.renameTask(t.id, 'changed')
      s.setNote(t.id, '')
    })
    undo.undo(s)
    expect(s.task(t.id)!.title).toBe('original')
    expect(s.task(t.id)!.note).toBe('context that matters')
  })

  it('skipsATaskDeletedSinceTheSnapshot', async () => {
    const s = await store()
    const t = s.addTask('thing', { kind: 'list', id: BuiltIn.notes })!
    const undo = held()
    undo.perform('trashed', [t.id], s, () => s.trashTask(t.id))
    s.deleteTaskPermanently(t.id)
    expect(() => undo.undo(s)).not.toThrow()
    expect(s.task(t.id)).toBeNull() // not resurrected
  })

  it('holdsAtMostOnePending', async () => {
    const s = await store()
    const a = s.addTask('a', { kind: 'list', id: BuiltIn.notes })!
    const b = s.addTask('b', { kind: 'list', id: BuiltIn.notes })!
    const undo = held()
    undo.perform('trashed', [a.id], s, () => s.trashTask(a.id))
    undo.perform('trashed', [b.id], s, () => s.trashTask(b.id))
    expect(undo.pending!.snapshots[0]!.id).toBe(b.id)
    undo.undo(s)
    expect(s.task(a.id)!.isTrashed).toBe(true) // superseded, still trashed
    expect(s.task(b.id)!.isTrashed).toBe(false)
  })

  it('recordsNothingWhenTheMutationTouchedNothing', async () => {
    const s = await store()
    const undo = held()
    undo.perform('trashed', ['99999999-0000-0000-0000-000000000000'], s, () => {})
    expect(undo.pending).toBeNull()
  })

  it('undoingClearsThePending', async () => {
    const s = await store()
    const t = s.addTask('thing', { kind: 'list', id: BuiltIn.notes })!
    const undo = held()
    undo.perform('trashed', [t.id], s, () => s.trashTask(t.id))
    undo.undo(s)
    expect(undo.pending).toBeNull()
    expect(() => undo.undo(s)).not.toThrow()
  })

  it('expiresAfterTheWindow', async () => {
    const s = await store()
    const t = s.addTask('thing', { kind: 'list', id: BuiltIn.notes })!
    const queued: (() => void)[] = []
    const undo = new UndoCenter((_ms, fn) => { queued.push(fn) })
    undo.perform('trashed', [t.id], s, () => s.trashTask(t.id))
    expect(undo.pending).not.toBeNull()
    queued.forEach((f) => f())
    expect(undo.pending).toBeNull()
  })

  it('aSupersededExpiryDoesNotClearTheNewerAction', async () => {
    const s = await store()
    const a = s.addTask('a', { kind: 'list', id: BuiltIn.notes })!
    const b = s.addTask('b', { kind: 'list', id: BuiltIn.notes })!
    const queued: (() => void)[] = []
    const undo = new UndoCenter((_ms, fn) => { queued.push(fn) })
    undo.perform('trashed', [a.id], s, () => s.trashTask(a.id))
    undo.perform('trashed', [b.id], s, () => s.trashTask(b.id))
    queued[0]!() // the first action's expiry, now stale
    expect(undo.pending).not.toBeNull()
  })

  it('notifiesSubscribersOnPresentAndClear', async () => {
    const s = await store()
    const t = s.addTask('thing', { kind: 'list', id: BuiltIn.notes })!
    const undo = held()
    let ticks = 0
    undo.subscribe(() => { ticks += 1 })
    undo.perform('trashed', [t.id], s, () => s.trashTask(t.id))
    undo.undo(s)
    expect(ticks).toBeGreaterThanOrEqual(2)
  })
})

describe('Undoing a project conversion', () => {
  it('removesTheListItCreated', async () => {
    // Reported: undo restored the task to the Inbox but left the empty project
    // behind. convertToProject makes a LIST as well as moving the task, and
    // spawnedIDs only ever tracked tasks.
    const s = await store()
    const t = s.addTask('Redesign the site', { kind: 'list', id: BuiltIn.inbox })!
    const undo = held()

    undo.perform('filed', [t.id], s, () => { s.convertToProject(t.id) })
    const project = s.data.lists.find((l) => l.name === 'Redesign the site')!
    expect(project).toBeDefined()
    expect(s.task(t.id)!.listID).toBe(project.id)

    undo.undo(s)
    expect(s.task(t.id)!.listID).toBe(BuiltIn.inbox)
    expect(s.data.lists.find((l) => l.name === 'Redesign the site')).toBeUndefined()
  })

  it('doesNotTrashTheTaskItIsRestoring', async () => {
    // deleteList trashes whatever still lives in the list, so the order of
    // restore-then-delete is load-bearing.
    const s = await store()
    const t = s.addTask('Redesign the site', { kind: 'list', id: BuiltIn.inbox })!
    const undo = held()
    undo.perform('filed', [t.id], s, () => { s.convertToProject(t.id) })
    undo.undo(s)
    expect(s.task(t.id)!.isTrashed).toBe(false)
  })

  it('leavesListsItDidNotCreateAlone', async () => {
    const s = await store()
    const existing = s.addList('Work', null)!
    const t = s.addTask('thing', { kind: 'list', id: BuiltIn.inbox })!
    const undo = held()
    undo.perform('moved', [t.id], s, () => s.moveTask(t.id, existing.id))
    undo.undo(s)
    expect(s.list(existing.id)).not.toBeNull()
  })

  it('recordsNothingWhenAMutationCreatesNeitherTaskNorList', async () => {
    const s = await store()
    const undo = held()
    undo.perform('trashed', ['99999999-0000-0000-0000-000000000000'], s, () => {})
    expect(undo.pending).toBeNull()
  })
})
