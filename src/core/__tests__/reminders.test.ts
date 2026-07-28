import { describe, it, expect } from 'vitest'
import { AppStore } from '../store'
import { MemoryAdapter } from '../../storage/memoryAdapter'
import { BuiltIn } from '../models'
import type { ReminderPort } from '../ports'

const NOW = new Date(2026, 6, 28, 9, 0, 0)
const later = (mins: number) => new Date(NOW.getTime() + mins * 60_000)

/** Records what the store asked for, without any timer or Notification. */
function spy() {
  const scheduled: { id: string; title: string; at: Date }[] = []
  const cancelled: string[] = []
  let cancelAlls = 0
  const port: ReminderPort = {
    schedule: (id, title, at) => { scheduled.push({ id, title, at }) },
    cancel: (id) => { cancelled.push(id) },
    cancelAll: () => { cancelAlls += 1 },
  }
  return { port, scheduled, cancelled, get cancelAlls() { return cancelAlls } }
}

const store = async (reminders: ReminderPort) =>
  AppStore.create({
    adapter: new MemoryAdapter(), now: () => NOW, scheduler: (_m, f) => f(), reminders,
  })

describe('Reminder scheduling through the store', () => {
  it('schedulesAFutureReminderWithTheTaskTitle', async () => {
    const s = spy()
    const st = await store(s.port)
    const t = st.addTask('call the bank', { kind: 'list', id: BuiltIn.inbox })!
    st.setReminder(t.id, later(30))
    expect(s.scheduled.at(-1)).toEqual({ id: t.id, title: 'call the bank', at: later(30) })
  })

  it('doesNotScheduleAReminderExactlyAtNow', async () => {
    // syncReminder uses a strict >, so "now" is already past.
    const s = spy()
    const st = await store(s.port)
    const t = st.addTask('x', { kind: 'list', id: BuiltIn.inbox })!
    st.setReminder(t.id, NOW)
    expect(s.scheduled).toEqual([])
  })

  it('doesNotScheduleAPastReminder', async () => {
    const s = spy()
    const st = await store(s.port)
    const t = st.addTask('x', { kind: 'list', id: BuiltIn.inbox })!
    st.setReminder(t.id, later(-30))
    expect(s.scheduled).toEqual([])
  })

  it('cancelsWhenTheTaskIsCompleted', async () => {
    const s = spy()
    const st = await store(s.port)
    const t = st.addTask('x', { kind: 'list', id: BuiltIn.inbox })!
    st.setReminder(t.id, later(30))
    s.scheduled.length = 0
    st.toggleCompleted(t.id)
    expect(s.cancelled).toContain(t.id)
    expect(s.scheduled).toEqual([])
  })

  it('cancelsWhenTheTaskIsTrashed', async () => {
    const s = spy()
    const st = await store(s.port)
    const t = st.addTask('x', { kind: 'list', id: BuiltIn.inbox })!
    st.setReminder(t.id, later(30))
    s.scheduled.length = 0
    st.trashTask(t.id)
    expect(s.cancelled).toContain(t.id)
    expect(s.scheduled).toEqual([])
  })

  it('reschedulesOnRenameBecauseTheBodyCarriesTheTitle', async () => {
    const s = spy()
    const st = await store(s.port)
    const t = st.addTask('old name', { kind: 'list', id: BuiltIn.inbox })!
    st.setReminder(t.id, later(30))
    st.renameTask(t.id, 'new name')
    expect(s.scheduled.at(-1)!.title).toBe('new name')
  })

  it('cancelsWhenTheReminderIsCleared', async () => {
    const s = spy()
    const st = await store(s.port)
    const t = st.addTask('x', { kind: 'list', id: BuiltIn.inbox })!
    st.setReminder(t.id, later(30))
    s.scheduled.length = 0
    st.setReminder(t.id, null)
    expect(s.cancelled).toContain(t.id)
    expect(s.scheduled).toEqual([])
  })

  it('reArmsEverythingOnImportButNotOnResetOrSample', async () => {
    // The asymmetry ported in sub-project 1: importData is the only
    // whole-store replacement that re-arms.
    const s = spy()
    const st = await store(s.port)
    const before = s.cancelAlls

    st.importData({ ...st.data })
    expect(s.cancelAlls).toBe(before + 1)

    st.resetAllData()
    st.loadSampleData()
    expect(s.cancelAlls).toBe(before + 1)
  })

  it('armAllSchedulesOnlyLiveReminders', async () => {
    const s = spy()
    const st = await store(s.port)
    const live = st.addTask('live', { kind: 'list', id: BuiltIn.inbox })!
    const done = st.addTask('done', { kind: 'list', id: BuiltIn.inbox })!
    const past = st.addTask('past', { kind: 'list', id: BuiltIn.inbox })!
    st.setReminder(live.id, later(30))
    st.setReminder(done.id, later(30))
    st.setReminder(past.id, later(-30))
    st.toggleCompleted(done.id)

    s.scheduled.length = 0
    st.armAllReminders()
    expect(s.scheduled.map((x) => x.id)).toEqual([live.id])
  })

  it('aStoreWithNoReminderPortStillWorks', async () => {
    // Every test written before this sub-project constructs one this way.
    const st = await AppStore.create({
      adapter: new MemoryAdapter(), now: () => NOW, scheduler: (_m, f) => f(),
    })
    const t = st.addTask('x', { kind: 'list', id: BuiltIn.inbox })!
    expect(() => st.setReminder(t.id, later(30))).not.toThrow()
    expect(st.task(t.id)!.reminderDate).toEqual(later(30))
  })
})
