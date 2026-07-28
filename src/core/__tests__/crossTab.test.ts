import { describe, it, expect, vi } from 'vitest'
import { AppStore } from '../store'
import { MemoryAdapter } from '../../storage/memoryAdapter'
import { encodeAppData } from '../codec'
import { seededAppData, BuiltIn, type AppData, type TaskItem } from '../models'
import type { LoadResult } from '../ports'

const NOW = new Date(2026, 6, 28, 9, 0, 0)
const immediate = (_ms: number, fn: () => void) => fn()

/**
 * The hook the IndexedDB adapter offers and the memory one does not — the
 * store must work either way, so the stand-in carries it explicitly.
 */
class CrossTabAdapter extends MemoryAdapter {
  onExternalWrite: ((raw: string, revision: number) => boolean) | null = null
  loadFails = false

  override async load(): Promise<LoadResult> {
    return this.loadFails
      ? { kind: 'unreadable', error: new Error('unreadable') }
      : super.load()
  }
}

const foreignTask = (title: string): TaskItem => ({
  id: '11111111-2222-3333-4444-555555555555',
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

const open = async (adapter: CrossTabAdapter) => {
  await adapter.persist(encodeAppData(seededAppData()))
  return AppStore.create({ adapter, now: () => NOW, scheduler: immediate })
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
