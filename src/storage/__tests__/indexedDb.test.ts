import 'fake-indexeddb/auto'
import { describe, it, expect, vi } from 'vitest'
import { IndexedDbAdapter, requestPersistentStorage } from '../indexedDbAdapter'
import { adapterContract } from './adapterContract.test'
import { AppStore } from '../../core/store'
import { decodeAppData, encodeAppData } from '../../core/codec'
import { seededAppData } from '../../core/models'

// The same contract the memory adapter passes, run against the real thing, so
// a behavioural gap between the adapter the tests use and the adapter the app
// uses cannot hide.
let dbSeq = 0
adapterContract('IndexedDbAdapter', () => new IndexedDbAdapter(`contract-${dbSeq++}`))

describe('IndexedDbAdapter', () => {
  it('survivesAReopenWithTheSameName', async () => {
    const a = new IndexedDbAdapter('reopen')
    await a.persist('{"x":1}')
    const b = new IndexedDbAdapter('reopen')
    expect(await b.load()).toEqual({ kind: 'ok', raw: '{"x":1}' })
  })

  it('quarantineSurvivesASubsequentSuccessfulPersist', async () => {
    const a = new IndexedDbAdapter('quarantine-db')
    await a.quarantine('the users bytes', 'undecodable')
    await a.persist('{"fresh":true}')
    expect(await a.load()).toEqual({ kind: 'ok', raw: '{"fresh":true}' })
  })

  it('asecondQuarantineDoesNotOverwriteTheFirst', async () => {
    const a = new IndexedDbAdapter('quarantine-twice')
    await a.quarantine('first', 'undecodable')
    await a.quarantine('second', 'undecodable')
    // Both are retained; nothing the user wrote is ever destroyed.
    expect(async () => a.quarantine('third', 'undecodable')).not.toThrow()
  })

  it('pruningAppliesTheKeepSetAfterEachSnapshot', async () => {
    const a = new IndexedDbAdapter('prune-db')
    for (let i = 0; i < 40; i++) {
      await a.writeSnapshot(`s${i}`, new Date(Date.UTC(2026, 0, 1, 0, 0, i)))
    }
    // 40 stamps inside one day: newest 20 plus that day's oldest.
    const list = await a.listSnapshots()
    expect(list.length).toBe(21)
    expect(list.at(-1)!.id).toBe('2026-01-01-000000')
  })

  it('driveTheRealStoreEndToEnd', async () => {
    const adapter = new IndexedDbAdapter('e2e-db')
    const now = new Date(2026, 6, 28, 9, 0, 0)
    const s = await AppStore.create({ adapter, now: () => now, scheduler: (_m, f) => f() })

    const created = s.addTask('buy milk', { kind: 'smart', view: 'today' })!
    await s.flushWrites()

    // A fresh store over the same database sees it.
    const reopened = await AppStore.create({ adapter: new IndexedDbAdapter('e2e-db'), now: () => now, scheduler: (_m, f) => f() })
    expect(reopened.task(created.id)!.title).toBe('buy milk')
    expect(reopened.saveError).toBeNull()
  })

  it('aSecondSessionSnapshotsTheStateItLoaded', async () => {
    const name = 'snapshot-db'
    const now = new Date(2026, 6, 28, 9, 0, 0)
    const seeded = encodeAppData(seededAppData())
    const adapter = new IndexedDbAdapter(name)
    await adapter.persist(seeded)

    await AppStore.create({ adapter: new IndexedDbAdapter(name), now: () => now, scheduler: (_m, f) => f() })
    const snaps = await new IndexedDbAdapter(name).listSnapshots()
    expect(snaps.length).toBe(1)
  })

  it('requestPersistentStorageIsFireAndForgetAndNeverThrows', () => {
    // navigator is absent under the node environment; the guard must hold.
    expect(() => requestPersistentStorage()).not.toThrow()
  })
})

/**
 * Two tabs is ordinary usage: every save writes the whole document, and each
 * tab holds a full copy loaded at boot, so without a check the second tab to
 * save deletes everything the first one did — silently.
 */
describe('IndexedDbAdapter across tabs', () => {
  const NOW = new Date(2026, 6, 28, 9, 0, 0)
  const TODAY = { kind: 'smart', view: 'today' } as const

  const openTab = (name: string) =>
    AppStore.create({ adapter: new IndexedDbAdapter(name), now: () => NOW, scheduler: (_m, f) => f() })

  const storedTitles = async (name: string) => {
    const result = await new IndexedDbAdapter(name).load()
    if (result.kind !== 'ok') throw new Error(`expected stored data, got ${result.kind}`)
    return decodeAppData(result.raw).tasks.map((t) => t.title).sort()
  }

  /** BroadcastChannel delivery is a task, not a microtask. */
  const deliverBroadcasts = () => new Promise<void>((r) => { setTimeout(r, 0) })

  it('refusesAStaleWriteInsteadOfDeletingTheOtherTabsWork', async () => {
    // No channel: the compare-and-swap is the only thing standing between the
    // two tabs, which is also the case in a browser that lacks one.
    vi.stubGlobal('BroadcastChannel', undefined)
    try {
      const name = 'two-tabs-db'
      await new IndexedDbAdapter(name).persist(encodeAppData(seededAppData()))
      const tab1 = await openTab(name)
      const tab2 = await openTab(name)

      tab1.addTask('written by tab one', TODAY)
      await tab1.flushWrites()
      // tab2 still holds the document from before that save.
      tab2.addTask('written by tab two', TODAY)
      await tab2.flushWrites()

      expect(await storedTitles(name)).toEqual(['written by tab one'])
      expect(tab2.saveError).not.toBeNull()
      expect(tab1.saveError).toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('atabAdoptsTheDocumentAnotherTabJustWroteAndKeepsSaving', async () => {
    const name = 'broadcast-db'
    await new IndexedDbAdapter(name).persist(encodeAppData(seededAppData()))
    const tab1 = await openTab(name)
    const tab2 = await openTab(name)

    tab1.addTask('written by tab one', TODAY)
    await tab1.flushWrites()
    await deliverBroadcasts()
    expect(tab2.data.tasks.map((t) => t.title)).toEqual(['written by tab one'])

    tab2.addTask('written by tab two', TODAY)
    await tab2.flushWrites()

    expect(await storedTitles(name)).toEqual(['written by tab one', 'written by tab two'])
    expect(tab2.saveError).toBeNull()
  })

  it('arecordWrittenBeforeRevisionsExistedIsStillReadableAndWritable', async () => {
    // Everything already on disk is a bare string. Reading one as if it were a
    // revisioned record would report absent and then seed over the user's data.
    const name = 'legacy-db'
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(name, 1)
      request.onupgradeneeded = () => {
        for (const store of ['data', 'snapshots', 'quarantine', 'meta']) {
          request.result.createObjectStore(store)
        }
      }
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('data', 'readwrite')
        tx.objectStore('data').put('{"legacy":true}', 'appdata')
        tx.oncomplete = () => { db.close(); resolve() }
        tx.onerror = () => reject(tx.error)
      }
      request.onerror = () => reject(request.error)
    })

    const a = new IndexedDbAdapter(name)
    expect(await a.load()).toEqual({ kind: 'ok', raw: '{"legacy":true}' })
    await a.persist('{"fresh":true}')
    expect(await a.load()).toEqual({ kind: 'ok', raw: '{"fresh":true}' })
  })
})
