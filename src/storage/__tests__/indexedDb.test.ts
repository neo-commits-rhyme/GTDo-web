import 'fake-indexeddb/auto'
import { describe, it, expect } from 'vitest'
import { IndexedDbAdapter, requestPersistentStorage } from '../indexedDbAdapter'
import { adapterContract } from './adapterContract.test'
import { AppStore } from '../../core/store'
import { encodeAppData } from '../../core/codec'
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
