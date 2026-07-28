import { describe, it, expect, beforeEach } from 'vitest'
import { MemoryAdapter, MemoryBacking } from '../memoryAdapter'
import { FailingAdapter } from '../failingAdapter'
import { StaleWriteError } from '../../core/ports'
import type { StoragePort } from '../../core/ports'

/**
 * One suite, run against every adapter. Task 14 imports this and runs it
 * against IndexedDbAdapter, so a behavioural difference between the adapter
 * the tests use and the adapter the app uses cannot hide.
 */
export function adapterContract(name: string, openGroup: () => () => StoragePort) {
  describe(`${name} contract`, () => {
    // openGroup() opens one storage; calling what it returns opens another
    // adapter over THAT SAME storage — a second tab. Compare-and-swap is a
    // guarantee between writers over one record, so it cannot be stated, let
    // alone tested, against a factory that hands out isolated stores.
    let openTab: () => StoragePort
    let a: StoragePort
    beforeEach(() => {
      openTab = openGroup()
      a = openTab()
    })

    it('loadOnEmptyIsAbsent', async () => {
      expect((await a.load()).kind).toBe('absent')
    })

    it('persistThenLoadReturnsSameBytes', async () => {
      await a.persist('{"x":1}')
      expect(await a.load()).toEqual({ kind: 'ok', raw: '{"x":1}' })
    })

    it('persistOverwrites', async () => {
      await a.persist('first')
      await a.persist('second')
      expect(await a.load()).toEqual({ kind: 'ok', raw: 'second' })
    })

    it('snapshotsListNewestFirst', async () => {
      await a.writeSnapshot('a', new Date(Date.UTC(2026, 0, 1)))
      await a.writeSnapshot('b', new Date(Date.UTC(2026, 0, 2)))
      const list = await a.listSnapshots()
      expect(list.map((s) => s.id)).toEqual(['2026-01-02-000000', '2026-01-01-000000'])
      expect(await a.readSnapshot(list[0]!.id)).toBe('b')
    })

    it('duplicateStampDoesNotDoubleWrite', async () => {
      // Mirrors `if !fm.fileExists(atPath:)` — the first snapshot of a stamp wins.
      const at = new Date(Date.UTC(2026, 0, 1))
      expect(await a.writeSnapshot('a', at)).toBe(true)
      expect(await a.writeSnapshot('b', at)).toBe(true)
      expect(await a.readSnapshot('2026-01-01-000000')).toBe('a')
      expect((await a.listSnapshots()).length).toBe(1)
    })

    it('snapshotMetaCarriesByteCount', async () => {
      await a.writeSnapshot('hello', new Date(Date.UTC(2026, 0, 1)))
      expect((await a.listSnapshots())[0]!.bytes).toBe(5)
    })

    it('quarantineIsNotTheDataRecord', async () => {
      await a.quarantine('not json', 'undecodable')
      expect((await a.load()).kind).toBe('absent')
    })

    it('quarantineSurvivesASubsequentPersist', async () => {
      await a.quarantine('the users bytes', 'undecodable')
      await a.persist('{"fresh":true}')
      expect(await a.load()).toEqual({ kind: 'ok', raw: '{"fresh":true}' })
    })

    it('pruningKeepsTheSnapshotSetBounded', async () => {
      for (let i = 0; i < 60; i++) {
        await a.writeSnapshot(`s${i}`, new Date(Date.UTC(2026, 0, 1, 0, 0, i)))
      }
      const list = await a.listSnapshots()
      // 60 stamps inside one day: newest 20 plus that day's oldest = 21.
      expect(list.length).toBe(21)
      expect(list.at(-1)!.id).toBe('2026-01-01-000000')
    })

    // Two tabs is ordinary usage. Before this, every save blindly rewrote the
    // whole document from a copy loaded at boot, so the second tab to save
    // deleted everything the first one did — silently, with no error anywhere.
    describe('two writers over one record', () => {
      it('refusesAWriteFromATabThatNeverSawTheOtherTabsSave', async () => {
        const b = openTab()
        await a.load()
        await b.load()
        await a.persist('written by A')
        // b still holds what it loaded at boot; its save must not win.
        await expect(b.persist('written by B')).rejects.toThrow(StaleWriteError)
        expect(await a.load()).toEqual({ kind: 'ok', raw: 'written by A' })
      })

      it('letsThatTabWriteOnceItHasReadTheNewerRecord', async () => {
        // The refusal is about unseen bytes, not about the tab. Reading clears
        // it — otherwise a rejected tab could never save again.
        const b = openTab()
        await a.load()
        await b.load()
        await a.persist('written by A')
        await b.load()
        await b.persist('written by B')
        expect(await a.load()).toEqual({ kind: 'ok', raw: 'written by B' })
      })

      it('doesNotRefuseAWriterThatIsAloneWithTheRecord', async () => {
        // The guard must key on an unseen revision, not on the mere existence
        // of a second adapter, or every ordinary save would start failing.
        const b = openTab()
        await b.load()
        await a.load()
        await a.persist('one')
        await a.persist('two')
        await a.persist('three')
        expect(await a.load()).toEqual({ kind: 'ok', raw: 'three' })
      })

      it('refusesAFirstWriteAgainstARecordItNeverLoaded', async () => {
        // A tab that boots, never reads, and saves is the same hazard: it has
        // seen nothing, so it must not be allowed to flatten what is there.
        await a.load()
        await a.persist('written by A')
        const b = openTab()
        await expect(b.persist('written by B')).rejects.toThrow(StaleWriteError)
      })
    })
  })
}

adapterContract('MemoryAdapter', () => {
  const backing = new MemoryBacking()
  return () => new MemoryAdapter(backing)
})

describe('FailingAdapter', () => {
  it('persistRejectsWithQuotaExceeded', async () => {
    await expect(new FailingAdapter().persist('{}')).rejects.toThrow(/QuotaExceededError/)
  })

  it('loadReportsUnreadableNotAbsent', async () => {
    // The distinction that stops seeded data from clobbering recoverable bytes.
    const r = await new FailingAdapter().load()
    expect(r.kind).toBe('unreadable')
  })

  it('writeSnapshotReportsFailureRatherThanThrowing', async () => {
    // A backup is best-effort and must never block a save.
    expect(await new FailingAdapter().writeSnapshot('x', new Date())).toBe(false)
  })
})
