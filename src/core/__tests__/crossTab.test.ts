import { describe, it, expect, vi } from 'vitest'
import { AppStore, type StoreDeps } from '../store'
import { MemoryAdapter, MemoryBacking } from '../../storage/memoryAdapter'
import { decodeAppData, encodeAppData } from '../codec'
import { seededAppData, BuiltIn, type AppData, type TaskItem } from '../models'
import { StaleWriteError, type LoadResult, type ReminderPort } from '../ports'
import { UndoCenter, undoLabel } from '../undo'

const NOW = new Date(2026, 6, 28, 9, 0, 0)
const later = (mins: number) => new Date(NOW.getTime() + mins * 60_000)
const immediate = (_ms: number, fn: () => void) => fn()

/**
 * MemoryAdapter carries onExternalWrite itself now, so this only adds the one
 * thing the real adapters cannot be asked to do on demand: fail a load.
 */
class CrossTabAdapter extends MemoryAdapter {
  loadFails = false

  override async load(): Promise<LoadResult> {
    return this.loadFails
      ? { kind: 'unreadable', error: new Error('unreadable') }
      : super.load()
  }
}

const FOREIGN_ID = '11111111-2222-3333-4444-555555555555'

const foreignTask = (title: string): TaskItem => ({
  id: FOREIGN_ID,
  title,
  note: '',
  dueDate: null,
  reminderDate: null,
  listID: BuiltIn.inbox,
  isCompleted: false,
  completedAt: null,
  isTrashed: false,
  createdAt: NOW,
  order: 1,
  repeatRule: null,
  trashedAt: null,
})

const foreignDocument = (title: string): AppData => ({ ...seededAppData(), tasks: [foreignTask(title)] })

const open = async (adapter: CrossTabAdapter, extra: Partial<StoreDeps> = {}) => {
  await adapter.persist(encodeAppData(seededAppData()))
  return AppStore.create({ adapter, now: () => NOW, scheduler: immediate, ...extra })
}

/** Records what the store asked for, without any timer or Notification. */
function reminderSpy() {
  const scheduled: { id: string; title: string; at: Date }[] = []
  let cancelAlls = 0
  const port: ReminderPort = {
    schedule: (id, title, at) => { scheduled.push({ id, title, at }) },
    cancel: () => {},
    cancelAll: () => { cancelAlls += 1 },
  }
  return { port, scheduled, get cancelAlls() { return cancelAlls } }
}

describe('AppStore cross-tab adoption', () => {
  it('testADocumentAnotherTabWroteIsAdopted', async () => {
    const a = new CrossTabAdapter()
    const s = await open(a)
    let renders = 0
    s.subscribe(() => { renders++ })

    expect(a.onExternalWrite!(encodeAppData(foreignDocument('theirs')), 2)).toBe(true)
    expect(s.data.tasks.map((t) => t.title)).toEqual(['theirs'])
    expect(renders).toBe(1)
  })

  it('testAdoptedBytesBecomeTheNextSnapshot', async () => {
    // The stale document must not survive as lastKnownGood: every later
    // rotating snapshot would then be a copy of data the user no longer has.
    const a = new CrossTabAdapter()
    const s = await open(a)
    const adopted = encodeAppData(foreignDocument('theirs'))
    a.onExternalWrite!(adopted, 2)

    const spy = vi.spyOn(a, 'writeSnapshot')
    s.persist({ forceBackup: true })
    expect(spy.mock.calls[0]![0]).toBe(adopted)
  })

  it('testAdoptionIsDeclinedWhileThisTabsOwnWriteIsOutstanding', async () => {
    const a = new CrossTabAdapter()
    const s = await open(a)
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => { release = r })
    vi.spyOn(a, 'persist').mockImplementationOnce(async () => { await gate })

    s.addTask('mine', { kind: 'smart', view: 'today' })
    expect(a.onExternalWrite!(encodeAppData(foreignDocument('theirs')), 2)).toBe(false)
    expect(s.data.tasks.map((t) => t.title)).toEqual(['mine'])
    release()
    await s.flushWrites()
  })

  it('testAdoptionIsDeclinedAfterASaveFailed', async () => {
    // The queue is idle again, but the failed write left this tab holding
    // changes that never reached disk — adopting would drop them silently,
    // which is the loss the whole mechanism exists to stop.
    const a = new CrossTabAdapter()
    const s = await open(a)
    vi.spyOn(a, 'persist').mockRejectedValueOnce(new Error('another tab got there first'))
    s.addTask('mine', { kind: 'smart', view: 'today' })
    await s.flushWrites()
    expect(s.saveError).not.toBeNull()

    expect(a.onExternalWrite!(encodeAppData(foreignDocument('theirs')), 2)).toBe(false)
    expect(s.data.tasks.map((t) => t.title)).toEqual(['mine'])
  })

  it('testAdoptionIsDeclinedWhileAnUndoIsStillOnOffer', async () => {
    // The undo holds the task as it was BEFORE the other tab's edits, and
    // adopting would advance this tab's revision — so the undo would then write
    // that stale copy over their work and pass the compare-and-swap. Declining
    // costs at most the 8 s window and makes the undo's save fail loudly.
    const backing = new MemoryBacking()
    const theirs = new MemoryAdapter(backing)
    const ours = new MemoryAdapter(backing)
    await theirs.persist(encodeAppData(foreignDocument('ring the dentist')))
    const tab1 = await AppStore.create({ adapter: theirs, now: () => NOW, scheduler: immediate })
    // Never expires inside the test: the window is the whole point.
    const undo = new UndoCenter(() => {})
    const tab2 = await AppStore.create({
      adapter: ours, now: () => NOW, scheduler: immediate,
      hasPendingUndo: () => undo.pending !== null,
    })

    undo.perform(undoLabel('trashed', 1), [FOREIGN_ID], tab2, () => { tab2.trashTask(FOREIGN_ID) })
    await tab2.flushWrites()

    // Tab 1 adopts the trash, then does real work on the task and saves.
    expect(tab1.task(FOREIGN_ID)!.isTrashed).toBe(true)
    tab1.restoreTask(FOREIGN_ID)
    tab1.renameTask(FOREIGN_ID, 'ring the dentist — Dr Pham')
    tab1.setNote(FOREIGN_ID, 'ask about the referral')
    tab1.setDueDate(FOREIGN_ID, NOW)
    tab1.moveTask(FOREIGN_ID, BuiltIn.nextActions)
    await tab1.flushWrites()

    expect(tab2.task(FOREIGN_ID)!.title).toBe('ring the dentist')

    undo.undo(tab2)
    await tab2.flushWrites()

    const stored = decodeAppData(backing.record!.raw).tasks[0]!
    expect(stored.title).toBe('ring the dentist — Dr Pham')
    expect(stored.note).toBe('ask about the referral')
    expect(stored.listID).toBe(BuiltIn.nextActions)
    expect(tab2.saveError).toBeInstanceOf(StaleWriteError)
  })

  it('testUndecodableBytesFromAnotherTabAreIgnored', async () => {
    const a = new CrossTabAdapter()
    const s = await open(a)
    expect(a.onExternalWrite!('{ not json', 2)).toBe(false)
    expect(s.data.tasks).toEqual([])
  })

  it('testATabRefusingToOverwriteDoesNotAdopt', async () => {
    // It is guarding bytes it could not read; swapping its document underfoot
    // changes nothing about that and only muddies what the user is looking at.
    const a = new CrossTabAdapter()
    a.loadFails = true
    const s = await AppStore.create({ adapter: a, now: () => NOW, scheduler: immediate })
    expect(a.onExternalWrite!(encodeAppData(foreignDocument('theirs')), 2)).toBe(false)
    expect(s.data.tasks).toEqual([])
  })
})

describe('AppStore cross-tab adoption and reminders', () => {
  const documentWithReminder = (title: string, at: Date | null, isTrashed = false): AppData => ({
    ...seededAppData(),
    tasks: [{ ...foreignTask(title), reminderDate: at, isTrashed, trashedAt: isTrashed ? NOW : null }],
  })

  it('testAReminderOnlyInTheAdoptedDocumentIsArmed', async () => {
    // Nothing else will arm it: the tab that created it may close, and this one
    // only arms at launch and on import.
    const a = new CrossTabAdapter()
    const r = reminderSpy()
    await open(a, { reminders: r.port })

    expect(a.onExternalWrite!(encodeAppData(documentWithReminder('theirs', later(30))), 2)).toBe(true)
    expect(r.scheduled).toEqual([{ id: FOREIGN_ID, title: 'theirs', at: later(30) }])
  })

  it('testATimerSurvivingIntoAnAdoptedDocumentIsTornDown', async () => {
    // The row goes away with the document; the timer does not, and would fire
    // at the due time for a task that is now in the Trash.
    const a = new CrossTabAdapter()
    const r = reminderSpy()
    const s = await open(a, { reminders: r.port })
    a.onExternalWrite!(encodeAppData(documentWithReminder('theirs', later(30))), 2)
    r.scheduled.length = 0

    expect(a.onExternalWrite!(encodeAppData(documentWithReminder('theirs', later(30), true)), 3)).toBe(true)
    expect(r.cancelAlls).toBe(2)
    expect(r.scheduled).toEqual([])
    expect(s.data.tasks[0]!.isTrashed).toBe(true)
  })
})
