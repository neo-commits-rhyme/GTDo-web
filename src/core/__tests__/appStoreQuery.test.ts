import { describe, it, expect } from 'vitest'
import { AppStore } from '../store'
import { MemoryAdapter } from '../../storage/memoryAdapter'
import { BuiltIn, type TaskItem } from '../models'
import { atNoon } from '../calendar'

/** Ports AppStoreQueryTests.swift. */

const NOW = new Date(2026, 6, 28, 9, 0, 0) // Tue 28 July 2026

const store = async () =>
  AppStore.create({ adapter: new MemoryAdapter(), now: () => NOW, scheduler: (_m, f) => f() })

let seq = 0
function task(over: Partial<TaskItem> = {}): TaskItem {
  seq += 1
  return {
    id: `00000000-0000-0000-0000-${String(seq).padStart(12, '0')}`,
    title: `task ${seq}`,
    note: '',
    dueDate: null,
    reminderDate: null,
    listID: BuiltIn.inbox,
    isCompleted: false,
    completedAt: null,
    isTrashed: false,
    createdAt: NOW,
    order: seq,
    repeatRule: null,
    trashedAt: null,
    ...over,
  }
}

const day = (y: number, m: number, d: number) => atNoon(new Date(y, m - 1, d))

describe('AppStore queries', () => {
  it('addTaskInListContext', async () => {
    const s = await store()
    const t = s.addTask('  buy milk  ', { kind: 'list', id: BuiltIn.someday })
    expect(t).not.toBeNull()
    expect(t!.title).toBe('buy milk') // trimmed
    expect(t!.listID).toBe(BuiltIn.someday)
    expect(t!.dueDate).toBeNull()
  })

  it('addTaskInTodayGoesToInboxDueToday', async () => {
    const s = await store()
    const t = s.addTask('x', { kind: 'smart', view: 'today' })!
    expect(t.listID).toBe(BuiltIn.inbox)
    expect(t.dueDate!.getHours()).toBe(12) // pinned to noon
    expect(t.dueDate!.getDate()).toBe(28)
  })

  it('addTaskInCalendarGoesToInboxDueToday', async () => {
    const s = await store()
    const t = s.addTask('x', { kind: 'smart', view: 'calendar' })!
    expect(t.listID).toBe(BuiltIn.inbox)
    expect(t.dueDate!.getDate()).toBe(28)
  })

  it('addTaskRejectsEmptyAndForbiddenContexts', async () => {
    const s = await store()
    expect(s.addTask('   ', { kind: 'list', id: BuiltIn.inbox })).toBeNull()
    expect(s.addTask('x', { kind: 'smart', view: 'completed' })).toBeNull()
    expect(s.addTask('x', { kind: 'smart', view: 'trash' })).toBeNull()
    expect(s.addTask('x', null)).toBeNull()
  })

  it('addTaskOrdersSequentially', async () => {
    const s = await store()
    // The max is taken over ALL tasks, including trashed and completed ones,
    // so a new task always lands last globally.
    s.data.tasks = [task({ order: 41, isTrashed: true }), task({ order: 12, isCompleted: true })]
    const a = s.addTask('a', { kind: 'list', id: BuiltIn.inbox })!
    const b = s.addTask('b', { kind: 'list', id: BuiltIn.inbox })!
    expect(a.order).toBe(42)
    expect(b.order).toBe(43)
  })

  it('todayAndOverdueQueries', async () => {
    const s = await store()
    const today = task({ dueDate: day(2026, 7, 28), order: 2 })
    const overdue = task({ dueDate: day(2026, 7, 25), order: 1 })
    const future = task({ dueDate: day(2026, 8, 1) })
    const undated = task({})
    s.data.tasks = [today, overdue, future, undated]

    expect(s.todayTasks.map((t) => t.id)).toEqual([today.id])
    expect(s.overdueTasks.map((t) => t.id)).toEqual([overdue.id])
    // Undated tasks never appear in Today; overdue is a separate list.
    expect(s.todayTasks.map((t) => t.id)).not.toContain(undated.id)
  })

  it('overdueSortsByOrderNotByHowOverdue', async () => {
    const s = await store()
    const veryLate = task({ dueDate: day(2026, 7, 1), order: 9 })
    const slightlyLate = task({ dueDate: day(2026, 7, 27), order: 1 })
    s.data.tasks = [veryLate, slightlyLate]
    expect(s.overdueTasks.map((t) => t.id)).toEqual([slightlyLate.id, veryLate.id])
  })

  it('activeTasksSortByOrderNotCreatedAt', async () => {
    const s = await store()
    const late = task({ order: 1, createdAt: new Date(2026, 0, 1), dueDate: day(2026, 7, 28) })
    const early = task({ order: 0, createdAt: new Date(2026, 5, 1), dueDate: day(2026, 7, 28) })
    s.data.tasks = [late, early]
    expect(s.todayTasks.map((t) => t.id)).toEqual([early.id, late.id])
  })

  it('completedAndTrashedExcludedFromTodayViews', async () => {
    const s = await store()
    s.data.tasks = [
      task({ dueDate: day(2026, 7, 28), isCompleted: true, completedAt: NOW }),
      task({ dueDate: day(2026, 7, 28), isTrashed: true }),
      task({ dueDate: day(2026, 7, 25), isTrashed: true }),
    ]
    expect(s.todayTasks).toEqual([])
    expect(s.overdueTasks).toEqual([])
  })

  it('calendarBuckets', async () => {
    const s = await store()
    const earlier = task({ dueDate: day(2026, 7, 20) })
    const today = task({ dueDate: day(2026, 7, 28) })
    const tomorrow = task({ dueDate: day(2026, 7, 29) })
    const later = task({ dueDate: day(2026, 8, 15) })
    const undated = task({})
    s.data.tasks = [later, undated, today, earlier, tomorrow]

    expect(s.calendarTasks('Earlier').map((t) => t.id)).toEqual([earlier.id])
    expect(s.calendarTasks('Today').map((t) => t.id)).toEqual([today.id])
    expect(s.calendarTasks('Tomorrow').map((t) => t.id)).toEqual([tomorrow.id])
    expect(s.calendarTasks('Later').map((t) => t.id)).toEqual([later.id])
  })

  it('calendarIsTheOnlyViewSortedByDueDate', async () => {
    const s = await store()
    const soon = task({ dueDate: day(2026, 8, 2), order: 99 })
    const sooner = task({ dueDate: day(2026, 8, 1), order: 1 })
    const soonest = task({ dueDate: day(2026, 7, 30), order: 50 })
    s.data.tasks = [soon, sooner, soonest]
    expect(s.calendarTasks('Later').map((t) => t.id)).toEqual([soonest.id, sooner.id, soon.id])
  })

  it('completedListSortsNewestFirst', async () => {
    const s = await store()
    const old = task({ isCompleted: true, completedAt: new Date(2026, 6, 1) })
    const recent = task({ isCompleted: true, completedAt: new Date(2026, 6, 27) })
    const dateless = task({ isCompleted: true, completedAt: null })
    s.data.tasks = [old, dateless, recent]
    // Dateless completions sort to the very bottom (distantPast).
    expect(s.completedTasks.map((t) => t.id)).toEqual([recent.id, old.id, dateless.id])
  })

  it('perListSplitsIncompleteAndCompleted', async () => {
    const s = await store()
    const open = task({ listID: BuiltIn.someday })
    const done = task({ listID: BuiltIn.someday, isCompleted: true, completedAt: NOW })
    const elsewhere = task({ listID: BuiltIn.notes })
    s.data.tasks = [open, done, elsewhere]
    expect(s.incompleteTasks(BuiltIn.someday).map((t) => t.id)).toEqual([open.id])
    // Swift overloads completedTasks / completedTasks(in:); TypeScript cannot
    // overload a getter with a method, so the per-list one is completedTasksIn.
    expect(s.completedTasksIn(BuiltIn.someday).map((t) => t.id)).toEqual([done.id])
  })

  it('moveTargetsExcludesCurrentListAndStaysUnsorted', async () => {
    const s = await store()
    const targets = s.moveTargets(BuiltIn.someday)
    expect(targets.map((l) => l.id)).not.toContain(BuiltIn.someday)
    // Raw insertion order, not alphabetical.
    expect(targets.map((l) => l.name)).toEqual(['Inbox', 'Next actions', 'Waiting for...', 'Notes'])
    expect(s.moveTargets(null).length).toBe(5)
  })

  it('todayCompletedIncludesTodayAndOverdueNotFuture', async () => {
    const s = await store()
    // Filters on DUE date, not completion date.
    const dueTodayDone = task({ dueDate: day(2026, 7, 28), isCompleted: true, completedAt: NOW })
    const dueLastMonthDone = task({ dueDate: day(2026, 6, 1), isCompleted: true, completedAt: new Date(2026, 5, 2) })
    const dueNextWeekDone = task({ dueDate: day(2026, 8, 5), isCompleted: true, completedAt: NOW })
    const undatedDone = task({ isCompleted: true, completedAt: NOW })
    s.data.tasks = [dueTodayDone, dueLastMonthDone, dueNextWeekDone, undatedDone]

    const ids = s.todayCompletedTasks.map((t) => t.id)
    expect(ids).toContain(dueTodayDone.id)
    expect(ids).toContain(dueLastMonthDone.id)
    expect(ids).not.toContain(dueNextWeekDone.id)
    expect(ids).not.toContain(undatedDone.id)
  })

  it('trashedIgnoresCompletionAndTheHold', async () => {
    const s = await store()
    const trashedDone = task({ isTrashed: true, isCompleted: true, completedAt: NOW, order: 1 })
    const trashedOpen = task({ isTrashed: true, order: 0 })
    s.data.tasks = [trashedDone, trashedOpen]
    expect(s.trashedTasks.map((t) => t.id)).toEqual([trashedOpen.id, trashedDone.id])
  })

  it('firstLaunchIsSeeded', async () => {
    const s = await store()
    expect(s.data.tasks).toEqual([])
    expect(s.data.lists.map((l) => l.name)).toEqual([
      'Inbox', 'Next actions', 'Waiting for...', 'Someday', 'Notes',
    ])
    expect(s.todayTasks).toEqual([])
    expect(s.completedTasks).toEqual([])
    expect(s.trashedTasks).toEqual([])
  })
})

describe('completion hold visibility', () => {
  it('rendersCompletedFallsBackToStoredValue', async () => {
    const s = await store()
    const t = task({ isCompleted: true, completedAt: NOW })
    s.data.tasks = [t]
    expect(s.rendersCompleted(t)).toBe(true)
    expect(s.renderedCompletionDate(t)).toEqual(NOW)
    expect(s.isHeldHidden(t)).toBe(false)
  })
})
