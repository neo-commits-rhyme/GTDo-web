import { keepSet, snapshotStamp } from './snapshotPolicy'
import type { LoadResult, SnapshotMeta, StorageAdapter } from './types'

/**
 * In-memory adapter for tests. Shares the snapshot rotation logic with the
 * IndexedDB one, so the contract suite exercises the real policy.
 */
export class MemoryAdapter implements StorageAdapter {
  private record: string | null = null
  private snapshots = new Map<string, string>()
  private quarantined: { raw: string; reason: string }[] = []

  async load(): Promise<LoadResult> {
    return this.record === null ? { kind: 'absent' } : { kind: 'ok', raw: this.record }
  }

  async persist(raw: string): Promise<void> {
    this.record = raw
  }

  async writeSnapshot(raw: string, at: Date): Promise<boolean> {
    const id = snapshotStamp(at)
    // The first snapshot of a stamp wins, mirroring `if !fm.fileExists`.
    if (!this.snapshots.has(id)) this.snapshots.set(id, raw)
    this.prune()
    return true
  }

  async listSnapshots(): Promise<SnapshotMeta[]> {
    return [...this.snapshots.entries()]
      .map(([id, raw]) => ({ id, at: new Date(0), bytes: raw.length }))
      .sort((a, b) => (a.id > b.id ? -1 : a.id < b.id ? 1 : 0))
  }

  async readSnapshot(id: string): Promise<string> {
    const raw = this.snapshots.get(id)
    if (raw === undefined) throw new Error(`no snapshot ${id}`)
    return raw
  }

  async quarantine(raw: string, reason: string): Promise<void> {
    this.quarantined.push({ raw, reason })
  }

  /** Test-only view; nothing in the app reads this. */
  get quarantinedRecords(): readonly { raw: string; reason: string }[] {
    return this.quarantined
  }

  private prune(): void {
    const newestFirst = [...this.snapshots.keys()]
      .sort()
      .reverse()
      .map((id) => ({ id, at: new Date(0), bytes: 0 }))
    const keep = keepSet(newestFirst)
    for (const id of this.snapshots.keys()) if (!keep.has(id)) this.snapshots.delete(id)
  }
}
