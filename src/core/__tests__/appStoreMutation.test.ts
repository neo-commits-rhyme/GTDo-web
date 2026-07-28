import { describe, it, expect } from 'vitest'
import { AppStore } from '../store'
import { MemoryAdapter } from '../../storage/memoryAdapter'
import { BuiltIn, type TaskItem } from '../models'
import { atNoon } from '../calendar'

/**
 * Ports AppStoreMutationTests.swift, AtomicCreateTests.swift and
 * TrashPurgeTests.swift, plus the thirteen AppStore-driven tests from
 * CompletionHoldTests.swift that Task 5 deferred.
 */

const NOW = new Date(2026, 6, 28, 9, 0, 0)
const day = (y: number, m: number, d: number) => atNoon(new Date(y, m - 1, d))

/** Scheduler that queues instead of firing, so a hold window can be held open. */
function manual() {
  const queued: (() => void)[] = []
  return {
    schedule: (_ms: number, fn: () => void) => { queued.push(fn) },
    fireAll: () => { const q = [...queued]; queued.length = 0; q.forEach((f) => f()) },
  }
}

async function store(now: Date = NOW, scheduler = (_m: number, f: () => void) => f()) {
  return AppStore.create({ adapter: new MemoryAdapter(), now: () => now, scheduler })
}

let seq = 0
function task(over: Partial<TaskItem> = {}): TaskItem {
  seq += 1
  return {
    id: `10000000-0000-0000-0000-${String(seq).padStart(12, '0')}`,
    title: `task ${seq}`, note: '', dueDate: null, reminderDate: null,
    listID: BuiltIn.inbox, isCompleted: false, completedAt: null, isTrashed: false,
    createdAt: NOW, order: seq, repeatRule: null, trashedAt: null,
    ...over,
  }
}

describe('Task field mutations', () => {
  it('setDueDatePinsToNoon', async () => {
    const s = await store()
    const t = task()
    s.data.tasks = [t]
    s.setDueDate(t.id, new Date(2026, 7, 3, 23, 30))
    expect(s.task(t.id)!.dueDate!.getHours()).toBe(12)
    expect(s.task(t.id)!.dueDate!.getDate()).toBe(3)
  })

  it('clearingDueDateClearsRule', async () => {
    const s = await store()
    const t = task({ dueDate: day(2026, 8, 1), repeatRule: { unit: 'week', interval: 1 } })
    s.data.tasks = [t]
    s.setDueDate(t.id, null)
    expect(s.task(t.id)!.dueDate).toBeNull()
    expect(s.task(t.id)!.repeatRule).toBeNull()
  })

  it('clearingRuleDoesNotClearDueDate', async () => {
    // Asymmetric with setDueDate(null) on purpose.
    const s = await store()
    const t = task({ dueDate: day(2026, 8, 1), repeatRule: { unit: 'week', interval: 1 } })
    s.data.tasks = [t]
    s.setRepeatRule(t.id, null)
    expect(s.task(t.id)!.repeatRule).toBeNull()
    expect(s.task(t.id)!.dueDate).not.toBeNull()
  })

  it('settingRuleOnDatelessTaskSetsDueToday', async () => {
    const s = await store()
    const t = task()
    s.data.tasks = [t]
    s.setRepeatRule(t.id, { unit: 'day', interval: 1 })
    expect(s.task(t.id)!.dueDate!.getDate()).toBe(28)
    expect(s.task(t.id)!.dueDate!.getHours()).toBe(12)
  })

  it('intervalClampedToOne', async () => {
    const s = await store()
    const t = task()
    s.data.tasks = [t]
    s.setRepeatRule(t.id, { unit: 'day', interval: 0 })
    expect(s.task(t.id)!.repeatRule!.interval).toBe(1)
  })

  it('addToTodaySkipsTrashedTasks', async () => {
    const s = await store()
    const live = task()
    const trashed = task({ isTrashed: true })
    s.data.tasks = [live, trashed]
    s.addToToday(live.id)
    s.addToToday(trashed.id)
    expect(s.task(live.id)!.dueDate).not.toBeNull()
    expect(s.task(trashed.id)!.dueDate).toBeNull()
  })

  it('setReminderStoresTheInstantWithoutNoonPinning', async () => {
    const s = await store()
    const t = task()
    s.data.tasks = [t]
    const at = new Date(2026, 7, 3, 7, 45)
    s.setReminder(t.id, at)
    expect(s.task(t.id)!.reminderDate).toEqual(at)
  })

  it('noteIsStoredVerbatimAndMayBeEmpty', async () => {
    const s = await store()
    const t = task()
    s.data.tasks = [t]
    s.setNote(t.id, '  spaced\n\nnote  ')
    expect(s.task(t.id)!.note).toBe('  spaced\n\nnote  ')
    s.setNote(t.id, '')
    expect(s.task(t.id)!.note).toBe('')
  })

  it('renameRejectsBlankButTrimsOtherwise', async () => {
    const s = await store()
    const t = task({ title: 'original' })
    s.data.tasks = [t]
    s.renameTask(t.id, '   ')
    expect(s.task(t.id)!.title).toBe('original')
    s.renameTask(t.id, '  renamed  ')
    expect(s.task(t.id)!.title).toBe('renamed')
  })

  it('mutatingAnUnknownIDIsANoOp', async () => {
    const s = await store()
    expect(() => {
      s.setNote('99999999-0000-0000-0000-000000000000', 'x')
      s.renameTask('99999999-0000-0000-0000-000000000000', 'x')
      s.setDueDate('99999999-0000-0000-0000-000000000000', NOW)
    }).not.toThrow()
  })
})

describe('Completion', () => {
  it('togglingSetsAndClearsCompletedAt', async () => {
    const s = await store()
    const t = task()
    s.data.tasks = [t]
    s.toggleCompleted(t.id)
    expect(s.task(t.id)!.isCompleted).toBe(true)
    expect(s.task(t.id)!.completedAt).toEqual(NOW)
    s.toggleCompleted(t.id)
    expect(s.task(t.id)!.isCompleted).toBe(false)
    expect(s.task(t.id)!.completedAt).toBeNull()
  })

  it('trashedTasksAreNotHeldAndCannotBeHeldCompleted', async () => {
    const s = await store()
    const t = task({ isTrashed: true })
    s.data.tasks = [t]
    s.toggleCompleted(t.id)
    expect(s.task(t.id)!.isCompleted).toBe(false)
    s.toggleCompletedHolding(t.id)
    expect(s.recentlyCompleted.size).toBe(0)
  })

  it('completingRecurringSpawnsNextOccurrence', async () => {
    const s = await store()
    const t = task({ dueDate: day(2026, 7, 28), repeatRule: { unit: 'day', interval: 1 } })
    s.data.tasks = [t]
    s.toggleCompleted(t.id)
    expect(s.data.tasks.length).toBe(2)
    const spawn = s.data.tasks[1]!
    expect(spawn.title).toBe(t.title)
    expect(spawn.isCompleted).toBe(false)
    expect(spawn.dueDate!.getDate()).toBe(29)
    expect(spawn.dueDate!.getHours()).toBe(12)
    expect(spawn.repeatRule).toEqual({ unit: 'day', interval: 1 })
  })

  it('spawnDoesNotCopyReminderOrCompletionState', async () => {
    const s = await store()
    const t = task({
      dueDate: day(2026, 7, 28), reminderDate: new Date(2026, 6, 28, 8),
      repeatRule: { unit: 'day', interval: 1 },
    })
    s.data.tasks = [t]
    s.toggleCompleted(t.id)
    const spawn = s.data.tasks[1]!
    expect(spawn.reminderDate).toBeNull()
    expect(spawn.completedAt).toBeNull()
    expect(spawn.trashedAt).toBeNull()
    expect(spawn.order).toBeGreaterThan(t.order)
  })

  it('unCompletingDoesNotSpawnOrRetract', async () => {
    const s = await store()
    const t = task({ dueDate: day(2026, 7, 28), repeatRule: { unit: 'day', interval: 1 } })
    s.data.tasks = [t]
    s.toggleCompleted(t.id)
    s.toggleCompleted(t.id)
    // The spawn survives, and re-completing makes another — ported as-is.
    expect(s.data.tasks.length).toBe(2)
    s.toggleCompleted(t.id)
    expect(s.data.tasks.length).toBe(3)
  })

  it('ruleLessTaskDoesNotSpawn', async () => {
    const s = await store()
    const t = task({ dueDate: day(2026, 7, 28) })
    s.data.tasks = [t]
    s.toggleCompleted(t.id)
    expect(s.data.tasks.length).toBe(1)
  })

  it('trashedTaskDoesNotSpawn', async () => {
    const s = await store()
    const t = task({ isTrashed: true, dueDate: day(2026, 7, 28), repeatRule: { unit: 'day', interval: 1 } })
    s.data.tasks = [t]
    s.toggleCompleted(t.id)
    expect(s.data.tasks.length).toBe(1)
  })
})

describe('Completion hold, through the store', () => {
  it('completedRowStaysInTheListUntilTheWindowCloses', async () => {
    const m = manual()
    const s = await store(NOW, m.schedule)
    const t = task({ dueDate: day(2026, 7, 28) })
    s.data.tasks = [t]

    s.toggleCompletedHolding(t.id)
    expect(s.task(t.id)!.isCompleted).toBe(true) // stored state changed at once
    expect(s.todayTasks.map((x) => x.id)).toEqual([t.id]) // but it has not moved
    expect(s.todayCompletedTasks).toEqual([])

    m.fireAll()
    expect(s.todayTasks).toEqual([])
    expect(s.todayCompletedTasks.map((x) => x.id)).toEqual([t.id])
  })

  it('aRunDownTheColumnMigratesInOneGo', async () => {
    const m = manual()
    const s = await store(NOW, m.schedule)
    const a = task({ dueDate: day(2026, 7, 28) })
    const b = task({ dueDate: day(2026, 7, 28) })
    const c = task({ dueDate: day(2026, 7, 28) })
    s.data.tasks = [a, b, c]

    s.toggleCompletedHolding(a.id)
    s.toggleCompletedHolding(b.id)
    s.toggleCompletedHolding(c.id)
    expect(s.todayTasks.length).toBe(3) // nothing reflows mid-run

    m.fireAll() // only the newest generation releases; earlier ones no-op
    expect(s.todayTasks).toEqual([])
    expect(s.todayCompletedTasks.length).toBe(3)
  })

  it('reTappingInsideTheWindowCostsNoReflow', async () => {
    const m = manual()
    const s = await store(NOW, m.schedule)
    const t = task({ dueDate: day(2026, 7, 28) })
    s.data.tasks = [t]
    s.toggleCompletedHolding(t.id)
    s.toggleCompletedHolding(t.id)
    expect(s.task(t.id)!.isCompleted).toBe(false)
    expect(s.recentlyCompleted.size).toBe(0) // pin cancelled, nothing held
    expect(s.todayTasks.map((x) => x.id)).toEqual([t.id])
  })

  it('unCompletingFromTheCompletedSectionHoldsToo', async () => {
    const m = manual()
    const s = await store(NOW, m.schedule)
    const t = task({ dueDate: day(2026, 7, 28), isCompleted: true, completedAt: NOW })
    s.data.tasks = [t]
    s.toggleCompletedHolding(t.id)
    expect(s.todayCompletedTasks.map((x) => x.id)).toEqual([t.id]) // still shown as done
    m.fireAll()
    expect(s.todayTasks.map((x) => x.id)).toEqual([t.id])
  })

  it('theCompletedSectionDoesNotResortUnderAHeldRow', async () => {
    const m = manual()
    const s = await store(NOW, m.schedule)
    const older = task({ dueDate: day(2026, 7, 20), isCompleted: true, completedAt: new Date(2026, 6, 20) })
    const newer = task({ dueDate: day(2026, 7, 25), isCompleted: true, completedAt: new Date(2026, 6, 25) })
    s.data.tasks = [older, newer]
    s.toggleCompletedHolding(older.id) // un-completes, but stays pinned as done
    expect(s.completedTasks.map((x) => x.id)).toEqual([newer.id, older.id])
  })

  it('aRecurrenceSpawnDoesNotAppearUntilTheWindowCloses', async () => {
    const m = manual()
    const s = await store(NOW, m.schedule)
    const t = task({ dueDate: day(2026, 7, 28), repeatRule: { unit: 'day', interval: 1 } })
    s.data.tasks = [t]

    s.toggleCompletedHolding(t.id)
    expect(s.data.tasks.length).toBe(2) // the spawn exists in the data…
    expect(s.calendarTasks('Tomorrow')).toEqual([]) // …but is hidden from views
    m.fireAll()
    expect(s.calendarTasks('Tomorrow').length).toBe(1)
  })

  it('smartViewsAndCountsRespectTheHold', async () => {
    const m = manual()
    const s = await store(NOW, m.schedule)
    const t = task({ dueDate: day(2026, 7, 28) })
    s.data.tasks = [t]
    s.toggleCompletedHolding(t.id)
    expect(s.incompleteTasks(BuiltIn.inbox).map((x) => x.id)).toEqual([t.id])
    expect(s.completedTasksIn(BuiltIn.inbox)).toEqual([])
    m.fireAll()
    expect(s.incompleteTasks(BuiltIn.inbox)).toEqual([])
    expect(s.completedTasksIn(BuiltIn.inbox).map((x) => x.id)).toEqual([t.id])
  })

  it('fullSwipeCompletionMigratesImmediately', async () => {
    const m = manual()
    const s = await store(NOW, m.schedule)
    const t = task({ dueDate: day(2026, 7, 28) })
    s.data.tasks = [t]
    s.toggleCompleted(t.id) // the direct path, no hold
    expect(s.todayTasks).toEqual([])
    expect(s.todayCompletedTasks.map((x) => x.id)).toEqual([t.id])
  })

  it('flushReleasesEverythingImmediately', async () => {
    const m = manual()
    const s = await store(NOW, m.schedule)
    const t = task({ dueDate: day(2026, 7, 28) })
    s.data.tasks = [t]
    s.toggleCompletedHolding(t.id)
    expect(s.flushCompletionHold()).toBe(true)
    expect(s.todayTasks).toEqual([])
    expect(s.flushCompletionHold()).toBe(false)
  })

  it('trashingAHeldRowRemovesItImmediately', async () => {
    const m = manual()
    const s = await store(NOW, m.schedule)
    const t = task({ dueDate: day(2026, 7, 28) })
    s.data.tasks = [t]
    s.toggleCompletedHolding(t.id)
    s.trashTask(t.id)
    expect(s.todayTasks).toEqual([])
    expect(s.trashedTasks.map((x) => x.id)).toEqual([t.id])
  })

  it('reorderUsesTheHeldOrderNotTheMigratedOne', async () => {
    const m = manual()
    const s = await store(NOW, m.schedule)
    const a = task({ order: 1 })
    const b = task({ order: 2 })
    s.data.tasks = [a, b]
    s.toggleCompletedHolding(a.id)
    // The pinned row still participates in the list's slot set.
    expect(s.incompleteTasks(BuiltIn.inbox).map((x) => x.id)).toEqual([a.id, b.id])
  })

  it('macOSPathIsUntouchedWhenNothingEverHolds', async () => {
    const s = await store()
    const t = task({ dueDate: day(2026, 7, 28) })
    s.data.tasks = [t]
    expect(s.rendersCompleted(t)).toBe(false)
    s.toggleCompleted(t.id)
    expect(s.recentlyCompleted.size).toBe(0)
    expect(s.flushCompletionHold()).toBe(false)
  })
})

describe('Trash', () => {
  it('trashKeepsListIDAndCompletionState', async () => {
    const s = await store()
    const t = task({ listID: BuiltIn.someday, isCompleted: true, completedAt: NOW })
    s.data.tasks = [t]
    s.trashTask(t.id)
    expect(s.task(t.id)!.listID).toBe(BuiltIn.someday) // the restore destination
    expect(s.task(t.id)!.isCompleted).toBe(true)
    expect(s.task(t.id)!.trashedAt).toEqual(NOW)
  })

  it('trashingAnAlreadyTrashedTaskResetsThePurgeClock', async () => {
    const s = await store()
    const t = task({ isTrashed: true, trashedAt: new Date(2026, 0, 1) })
    s.data.tasks = [t]
    s.trashTask(t.id)
    expect(s.task(t.id)!.trashedAt).toEqual(NOW)
  })

  it('trashClearsTheSelectionWhenItWasSelected', async () => {
    const s = await store()
    const t = task()
    s.data.tasks = [t]
    s.selectedTaskID = t.id
    s.trashTask(t.id)
    expect(s.selectedTaskID).toBeNull()
  })

  it('restoreBypassesSomedayAndDeadlineRules', async () => {
    const s = await store()
    const t = task({ listID: BuiltIn.nextActions, isTrashed: true, trashedAt: NOW })
    s.data.tasks = [t]
    s.restoreTask(t.id)
    expect(s.task(t.id)!.isTrashed).toBe(false)
    expect(s.task(t.id)!.trashedAt).toBeNull()
    // Restored into a deadline-required list with no deadline — allowed.
    expect(s.task(t.id)!.listID).toBe(BuiltIn.nextActions)
    expect(s.task(t.id)!.dueDate).toBeNull()
  })

  it('restoreFallsBackToInboxWhenTheListIsGone', async () => {
    const s = await store()
    const t = task({ listID: '44444444-0000-0000-0000-000000000000', isTrashed: true, trashedAt: NOW })
    s.data.tasks = [t]
    s.restoreTask(t.id)
    expect(s.task(t.id)!.listID).toBe(BuiltIn.inbox)
  })

  it('deleteTaskPermanentlyHasNoGuard', async () => {
    const s = await store()
    const live = task()
    s.data.tasks = [live]
    s.deleteTaskPermanently(live.id) // works on a non-trashed task
    expect(s.data.tasks).toEqual([])
    expect(() => s.deleteTaskPermanently('99999999-0000-0000-0000-000000000000')).not.toThrow()
  })

  it('emptyTrashRemovesOnlyTrashedTasks', async () => {
    const s = await store()
    const live = task()
    const gone = task({ isTrashed: true, trashedAt: NOW })
    s.data.tasks = [live, gone]
    s.emptyTrash()
    expect(s.data.tasks.map((t) => t.id)).toEqual([live.id])
  })

  it('emptyTrashLeavesADanglingSelectedTaskID', async () => {
    const s = await store()
    const gone = task({ isTrashed: true, trashedAt: NOW })
    s.data.tasks = [gone]
    s.selectedTaskID = gone.id
    s.emptyTrash()
    expect(s.selectedTaskID).toBe(gone.id) // the UI must tolerate this
    expect(s.task(gone.id)).toBeNull()
  })
})

describe('Trash purge', () => {
  it('purgeNeverTouchesTasksWithNullTrashedAt', async () => {
    const s = await store()
    const legacy = task({ isTrashed: true, trashedAt: null })
    s.data.tasks = [legacy]
    s.purgeTrash(30)
    expect(s.data.tasks.length).toBe(1)
  })

  it('purgeUsesAStrictCutoff', async () => {
    const s = await store()
    const exactly30 = task({ isTrashed: true, trashedAt: new Date(2026, 5, 28, 9, 0, 0) })
    s.data.tasks = [exactly30]
    s.purgeTrash(30)
    expect(s.data.tasks.length).toBe(1) // not strictly older
  })

  it('purgeRemovesOlderThanCutoffOnly', async () => {
    const s = await store()
    const old = task({ isTrashed: true, trashedAt: new Date(2026, 4, 1) })
    const recent = task({ isTrashed: true, trashedAt: new Date(2026, 6, 27) })
    const live = task()
    s.data.tasks = [old, recent, live]
    s.purgeTrash(30)
    expect(s.data.tasks.map((t) => t.id).sort()).toEqual([recent.id, live.id].sort())
  })

  it('purgeEarlyReturnsWithoutSavingWhenNothingIsDue', async () => {
    const s = await store()
    s.data.tasks = [task()]
    let notified = 0
    s.subscribe(() => { notified += 1 })
    s.purgeTrash(30)
    expect(notified).toBe(0) // no save, no backup, on every launch
  })
})

describe('Reorder within a list', () => {
  it('redistributesOnlyTheSlotsThatListOwned', async () => {
    const s = await store()
    const a = task({ order: 10 })
    const b = task({ order: 20 })
    const c = task({ order: 30 })
    const other = task({ listID: BuiltIn.notes, order: 15 })
    s.data.tasks = [a, b, c, other]

    // SwiftUI onMove semantics: moving item 0 down one needs destination 2.
    s.moveIncompleteTasks(BuiltIn.inbox, [0], 2)
    expect(s.incompleteTasks(BuiltIn.inbox).map((t) => t.id)).toEqual([b.id, a.id, c.id])
    // The slots themselves are unchanged, and no other task moved.
    expect(s.incompleteTasks(BuiltIn.inbox).map((t) => t.order)).toEqual([10, 20, 30])
    expect(s.task(other.id)!.order).toBe(15)
  })

  it('completedAndTrashedTasksKeepTheirSlots', async () => {
    const s = await store()
    const a = task({ order: 1 })
    const done = task({ order: 2, isCompleted: true, completedAt: NOW })
    const b = task({ order: 3 })
    s.data.tasks = [a, done, b]
    s.moveIncompleteTasks(BuiltIn.inbox, [0], 2)
    expect(s.task(done.id)!.order).toBe(2)
  })
})
