import { describe, it, expect, beforeEach } from 'vitest'
import { MemoryAdapter } from '../memoryAdapter'
import { FailingAdapter } from '../failingAdapter'
import type { StoragePort } from '../../core/ports'

/**
 * One suite, run against every adapter. Task 14 imports this and runs it
 * against IndexedDbAdapter, so a behavioural difference between the adapter
 * the tests use and the adapter the app uses cannot hide.
 */
export function adapterContract(name: string, make: () => StoragePort) {
  describe(`${name} contract`, () => {
    let a: StoragePort
    beforeEach(() => {
      a = make()
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
  })
}

adapterContract('MemoryAdapter', () => new MemoryAdapter())

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
