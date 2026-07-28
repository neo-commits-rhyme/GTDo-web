import { describe, it, expect } from 'vitest'
import { missedReminders } from '../catchUp'
import { seededAppData, BuiltIn, type AppData, type TaskItem } from '../models'

const NOW = new Date(2026, 6, 28, 12, 0, 0)
const at = (h: number) => new Date(2026, 6, 28, h, 0, 0)

let seq = 0
function task(over: Partial<TaskItem> = {}): TaskItem {
  seq += 1
  return {
    id: `50000000-0000-0000-0000-${String(seq).padStart(12, '0')}`,
    title: `task ${seq}`, note: '', dueDate: null, reminderDate: null,
    listID: BuiltIn.inbox, isCompleted: false, completedAt: null, isTrashed: false,
    createdAt: NOW, order: seq, repeatRule: null, trashedAt: null,
    ...over,
  }
}

const withTasks = (tasks: TaskItem[]): AppData => ({ ...seededAppData(), tasks })

describe('missedReminders', () => {
  it('collectsRemindersThatPassedSinceTheLastVisit', () => {
    const missed = task({ reminderDate: at(10) })
    const data = withTasks([missed])
    expect(missedReminders(data, at(9), NOW).map((t) => t.id)).toEqual([missed.id])
  })

  it('ignoresAnythingFromBeforeTheLastVisit', () => {
    // Already reported once; reporting it again teaches people to dismiss.
    const old = task({ reminderDate: at(8) })
    expect(missedReminders(withTasks([old]), at(9), NOW)).toEqual([])
  })

  it('ignoresFutureReminders', () => {
    const future = task({ reminderDate: at(15) })
    expect(missedReminders(withTasks([future]), at(9), NOW)).toEqual([])
  })

  it('treatsAReminderExactlyAtNowAsDue', () => {
    const exact = task({ reminderDate: NOW })
    expect(missedReminders(withTasks([exact]), at(9), NOW).length).toBe(1)
  })

  it('excludesCompletedAndTrashedTasks', () => {
    // The store would not have scheduled these live either.
    const done = task({ reminderDate: at(10), isCompleted: true, completedAt: at(10) })
    const gone = task({ reminderDate: at(10), isTrashed: true, trashedAt: at(10) })
    expect(missedReminders(withTasks([done, gone]), at(9), NOW)).toEqual([])
  })

  it('ignoresTasksWithNoReminder', () => {
    expect(missedReminders(withTasks([task()]), at(9), NOW)).toEqual([])
  })

  it('collectsEverythingPastOnAFirstRun', () => {
    // A null stamp means the user has never been told about any of it.
    const old = task({ reminderDate: at(3) })
    const recent = task({ reminderDate: at(11) })
    expect(missedReminders(withTasks([old, recent]), null, NOW).length).toBe(2)
  })

  it('ordersByReminderTime', () => {
    const late = task({ reminderDate: at(11) })
    const early = task({ reminderDate: at(10) })
    expect(missedReminders(withTasks([late, early]), at(9), NOW).map((t) => t.id))
      .toEqual([early.id, late.id])
  })
})
