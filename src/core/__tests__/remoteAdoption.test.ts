import { describe, it, expect, vi } from 'vitest'
import { AppStore } from '../store'
import { MemoryAdapter } from '../../storage/memoryAdapter'
import { FailingAdapter } from '../../storage/failingAdapter'
import type { StoragePort } from '../ports'
import { decodeAppData, encodeAppData } from '../codec'
import { makeSampleData } from '../seed'

const NOW = new Date(2026, 10, 12, 9, 0, 0)
const immediate = (_ms: number, fn: () => void) => fn()

const deps = (adapter: StoragePort = new MemoryAdapter(), hasPendingUndo = () => false) => ({
  adapter,
  now: () => NOW,
  scheduler: immediate,
  hasPendingUndo,
})

const remote = () => encodeAppData(makeSampleData(NOW))

describe('Document change signal', () => {
  it('testFiresForAnEditButNotForViewState', async () => {
    const s = await AppStore.create(deps())
    const changed = vi.fn()
    s.onDocumentChange = changed

    s.setSelection({ kind: 'smart', view: 'calendar' })
    s.setSearchQuery('milk')
    expect(changed).not.toHaveBeenCalled()

    s.addList('Errands', null)
    expect(changed).toHaveBeenCalledOnce()
  })

  it('testASaveThatChangesNothingIsNotAnEdit', async () => {
    // An idle device that looked dirty would outrank a newer copy in the cloud.
    const s = await AppStore.create(deps())
    s.addList('Errands', null)
    await s.flushWrites()
    const changed = vi.fn()
    s.onDocumentChange = changed
    s.persist()
    s.purgeTrash(30)
    expect(changed).not.toHaveBeenCalled()
  })
})

describe('Remote adoption', () => {
  it('testReplacesTheDocumentAndSavesItWithoutCountingAsAnEdit', async () => {
    const adapter = new MemoryAdapter()
    const s = await AppStore.create(deps(adapter))
    const changed = vi.fn()
    s.onDocumentChange = changed

    expect(s.adoptRemote(remote())).toBe(true)
    await s.flushWrites()

    expect(encodeAppData(s.data)).toBe(remote())
    expect(changed).not.toHaveBeenCalled()
    const stored = await adapter.load()
    expect(stored.kind === 'ok' && stored.raw).toBe(remote())
  })

  it('testTheReplacedDocumentStaysRestorable', async () => {
    const adapter = new MemoryAdapter()
    const s = await AppStore.create(deps(adapter))
    s.addList('Only here', null)
    await s.flushWrites()
    const before = encodeAppData(s.data)

    s.adoptRemote(remote())
    await s.flushWrites()

    const snapshots = await s.listSnapshots()
    const kept = await Promise.all(snapshots.map((m) => s.readSnapshot(m.id)))
    expect(kept).toContain(before)
  })

  it('testKeepsTheSelectionWhenItStillExistsAndDropsItWhenItDoesNot', async () => {
    const s = await AppStore.create(deps())
    const mine = s.addList('Only here', null)!
    s.setSelection({ kind: 'list', id: mine.id })
    s.adoptRemote(remote())
    expect(s.selection).toEqual({ kind: 'smart', view: 'today' })

    const theirs = decodeAppData(remote()).lists.find((l) => !l.isBuiltIn)!
    s.setSelection({ kind: 'list', id: theirs.id })
    s.adoptRemote(remote())
    expect(s.selection).toEqual({ kind: 'list', id: theirs.id })
  })

  it('testDeclinesWhileAnUndoIsOnOffer', async () => {
    // The undo holds tasks as they were; adopting underneath it would let the
    // undo write that stale copy back over the cloud's document.
    let pending = true
    const s = await AppStore.create(deps(new MemoryAdapter(), () => pending))
    const before = encodeAppData(s.data)
    expect(s.adoptRemote(remote())).toBe(false)
    expect(encodeAppData(s.data)).toBe(before)
    pending = false
    expect(s.adoptRemote(remote())).toBe(true)
  })

  it('testDeclinesWhenTheStoreIsGuardingUnreadableBytes', async () => {
    const s = await AppStore.create(deps(new FailingAdapter()))
    expect(s.adoptRemote(remote())).toBe(false)
  })

  it('testAnUndecodableDocumentThrowsAndChangesNothing', async () => {
    const s = await AppStore.create(deps())
    const before = encodeAppData(s.data)
    expect(() => s.adoptRemote('{"tasks": 1}')).toThrow()
    expect(encodeAppData(s.data)).toBe(before)
  })
})
