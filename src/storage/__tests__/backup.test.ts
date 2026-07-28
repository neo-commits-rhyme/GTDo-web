import { describe, it, expect } from 'vitest'
import { snapshotStamp, keepSet, BACKUPS_KEPT, DAILY_BACKUPS_KEPT, BACKUP_INTERVAL_MS } from '../snapshotPolicy'
import type { SnapshotMeta } from '../types'

const meta = (id: string): SnapshotMeta => ({ id, at: new Date(0), bytes: 1 })
/** Newest first, matching Persistence.backups(in:) which sorts stamps as text. */
const newestFirst = (ids: string[]) => ids.map(meta).sort((a, b) => (a.id > b.id ? -1 : 1))

describe('Backup', () => {
  it('testStampIsUTCAndSortable', () => {
    // A local-time stamp sorts backwards after DST or a westward timezone
    // change, which would make rotation prune the NEWEST snapshots.
    expect(snapshotStamp(new Date(Date.UTC(2026, 6, 28, 9, 5, 3)))).toBe('2026-07-28-090503')
    expect(snapshotStamp(new Date(Date.UTC(2026, 0, 1, 0, 0, 0)))).toBe('2026-01-01-000000')
  })

  it('testStampsSortChronologicallyAsText', () => {
    const a = snapshotStamp(new Date(Date.UTC(2026, 6, 28, 9, 0, 0)))
    const b = snapshotStamp(new Date(Date.UTC(2026, 6, 28, 10, 0, 0)))
    expect(a < b).toBe(true)
  })

  it('testIntervalMatchesSwift', () => {
    expect(BACKUP_INTERVAL_MS).toBe(5 * 60 * 1000)
    expect(BACKUPS_KEPT).toBe(20)
    expect(DAILY_BACKUPS_KEPT).toBe(30)
  })

  it('testKeepsNewestTwenty', () => {
    const ids = Array.from({ length: 40 }, (_, i) => `2026-07-28-${String(100000 + i)}`)
    const keep = keepSet(newestFirst(ids))
    expect(keep.has('2026-07-28-100039')).toBe(true) // newest
    expect(keep.has('2026-07-28-100020')).toBe(true) // 20th newest
  })

  it('testKeepsOldestOfEachRecentDay', () => {
    // 25 snapshots today, so the newest-20 rule alone covers under one day.
    const today = Array.from({ length: 25 }, (_, i) => `2026-07-28-${String(100000 + i)}`)
    const earlier = [
      '2026-07-27-080000', '2026-07-26-080000', '2026-07-25-080000',
      '2026-07-24-080000', '2026-07-23-080000',
    ]
    const keep = keepSet(newestFirst([...today, ...earlier]))
    for (const id of earlier) expect(keep.has(id)).toBe(true)
    expect(keep.has('2026-07-28-100000')).toBe(true) // oldest of today
  })

  it('testKeepsOldestNotNewestWithinADay', () => {
    // Within a day, the OLDEST entry is the state that day started from.
    const ids = ['2026-07-20-090000', '2026-07-20-100000', '2026-07-20-110000']
    const extras = Array.from({ length: 25 }, (_, i) => `2026-07-28-${String(100000 + i)}`)
    const keep = keepSet(newestFirst([...ids, ...extras]))
    expect(keep.has('2026-07-20-090000')).toBe(true)
    expect(keep.has('2026-07-20-100000')).toBe(false)
  })

  it('testPrunesBeyondThirtyDays', () => {
    // 40 consecutive days, one snapshot each. The newest-20 rule covers the 20
    // most recent; the daily rule covers the 30 most recent. So the oldest 10
    // fall outside both and are pruned.
    const ids = Array.from({ length: 40 }, (_, i) =>
      snapshotStamp(new Date(Date.UTC(2026, 4, 1 + i, 8, 0, 0))),
    )
    const keep = keepSet(newestFirst(ids))
    expect(keep.size).toBe(DAILY_BACKUPS_KEPT)
    expect(keep.size).toBeLessThanOrEqual(BACKUPS_KEPT + DAILY_BACKUPS_KEPT)
    expect(keep.has(ids[39]!)).toBe(true) // newest survives
    expect(keep.has(ids[10]!)).toBe(true) // 30th most recent day survives
    expect(keep.has(ids[9]!)).toBe(false) // 31st is beyond both rules
    expect(keep.has(ids[0]!)).toBe(false) // oldest
  })

  it('testEmptyInputKeepsNothing', () => {
    expect(keepSet([]).size).toBe(0)
  })

  it('testFewerThanTwentyKeepsAll', () => {
    const ids = ['2026-07-28-100000', '2026-07-28-100001', '2026-07-27-090000']
    expect(keepSet(newestFirst(ids)).size).toBe(3)
  })

  it('testMalformedStampsAreIgnoredNotCrashed', () => {
    const keep = keepSet([meta('junk'), meta('2026-07-28-100000')])
    expect(keep.has('2026-07-28-100000')).toBe(true)
  })
})
