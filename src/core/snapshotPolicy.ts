/** Port of the rotation rules in Persistence.swift:9-18 and keepSet(from:). */

import type { SnapshotMeta } from './ports'

/** How many recent rotating snapshots to keep. */
export const BACKUPS_KEPT = 20
/**
 * Days for which the oldest snapshot of that day is also kept, so a mistake
 * noticed tomorrow is still recoverable — 20 recent snapshots alone can cover
 * less than two hours of active use.
 */
export const DAILY_BACKUPS_KEPT = 30
/**
 * Minimum gap between snapshots, so a burst of edits doesn't write a copy per
 * keystroke. The data record itself still saves on every change, and
 * destructive actions force a snapshot regardless.
 */
export const BACKUP_INTERVAL_MS = 5 * 60 * 1000

/**
 * Sortable, filename-safe, and UTC. A local-time stamp would sort backwards
 * after DST or a westward timezone change, making rotation prune the newest
 * snapshots.
 */
export function snapshotStamp(at: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    `${at.getUTCFullYear()}-${p(at.getUTCMonth() + 1)}-${p(at.getUTCDate())}-` +
    `${p(at.getUTCHours())}${p(at.getUTCMinutes())}${p(at.getUTCSeconds())}`
  )
}

/** The `yyyy-MM-dd` prefix a stamp belongs to, or null when malformed. */
function dayOf(id: string): string | null {
  return /^\d{4}-\d{2}-\d{2}-/.test(id) ? id.slice(0, 10) : null
}

/**
 * Keep the newest BACKUPS_KEPT, PLUS the oldest snapshot of each of the most
 * recent DAILY_BACKUPS_KEPT days. Deletes only what neither rule keeps.
 *
 * @param newestFirst snapshots ordered newest first (stamps sort as text)
 */
export function keepSet(newestFirst: SnapshotMeta[]): Set<string> {
  const keep = new Set(newestFirst.slice(0, BACKUPS_KEPT).map((s) => s.id))

  // Group by day; newest-first order means the LAST one seen for a day is its
  // oldest, which is the state that day started from.
  const oldestPerDay = new Map<string, string>()
  for (const s of newestFirst) {
    const day = dayOf(s.id)
    if (day === null) continue
    oldestPerDay.set(day, s.id)
  }

  const recentDays = [...oldestPerDay.keys()].sort().reverse().slice(0, DAILY_BACKUPS_KEPT)
  for (const day of recentDays) {
    const id = oldestPerDay.get(day)
    if (id !== undefined) keep.add(id)
  }
  return keep
}
