import { keepSet, snapshotStamp } from '../core/snapshotPolicy'
import { StaleWriteError } from '../core/ports'
import type { LoadResult, SnapshotMeta, StoragePort } from '../core/ports'

/**
 * The storage two MemoryAdapters can share, so a test can model two tabs.
 *
 * A MemoryAdapter used to BE its own storage, which meant the shared contract
 * suite could not hold it to compare-and-swap: two instances had nothing in
 * common to race over, and the guarantee only exists between writers over one
 * record. Pulling the bytes into a separate object is what makes "another tab
 * saved" expressible without IndexedDB.
 */
export class MemoryBacking {
  record: { raw: string; revision: number } | null = null
  readonly snapshots = new Map<string, string>()
  readonly quarantined: { raw: string; reason: string }[] = []
  readonly adapters = new Set<MemoryAdapter>()
}

/**
 * In-memory adapter for tests. Shares the snapshot rotation logic with the
 * IndexedDB one, so the contract suite exercises the real policy.
 *
 * Constructed with no argument it owns private storage, which is what almost
 * every test wants. Pass one MemoryBacking to two adapters to get two tabs.
 */
export class MemoryAdapter implements StoragePort {
  private readonly backing: MemoryBacking
  /** The revision this adapter's caller last saw. 0 is also an empty store. */
  private seenRevision = 0

  /** Mirrors the IndexedDB adapter's hook — see StoragePort. */
  onExternalWrite: ((raw: string, revision: number) => boolean) | null = null

  constructor(backing: MemoryBacking = new MemoryBacking()) {
    this.backing = backing
    backing.adapters.add(this)
  }

  async load(): Promise<LoadResult> {
    const record = this.backing.record
    if (record === null) return { kind: 'absent' }
    this.seenRevision = record.revision
    return { kind: 'ok', raw: record.raw }
  }

  async persist(raw: string): Promise<void> {
    const storedRevision = this.backing.record?.revision ?? 0
    // Same rule as IndexedDB: refuse to overwrite a revision nobody here read.
    // With one adapter this can never fire, which is why the default backing
    // keeps every existing single-adapter test behaving exactly as before.
    if (storedRevision !== this.seenRevision) {
      throw new StaleWriteError(storedRevision, this.seenRevision)
    }
    const revision = storedRevision + 1
    this.backing.record = { raw, revision }
    this.seenRevision = revision
    this.announce(raw, revision)
  }

  /**
   * Stands in for the BroadcastChannel. Only an adapter that ADOPTED the
   * document may count it as seen — one that declined has still not read those
   * bytes, and its next save must fail the check above rather than clobber them.
   */
  private announce(raw: string, revision: number): void {
    for (const sibling of this.backing.adapters) {
      if (sibling === this) continue
      if (sibling.onExternalWrite?.(raw, revision) === true) sibling.seenRevision = revision
    }
  }

  async writeSnapshot(raw: string, at: Date): Promise<boolean> {
    const id = snapshotStamp(at)
    // The first snapshot of a stamp wins, mirroring `if !fm.fileExists`.
    if (!this.backing.snapshots.has(id)) this.backing.snapshots.set(id, raw)
    this.prune()
    return true
  }

  async listSnapshots(): Promise<SnapshotMeta[]> {
    return [...this.backing.snapshots.entries()]
      .map(([id, raw]) => ({ id, at: new Date(0), bytes: raw.length }))
      .sort((a, b) => (a.id > b.id ? -1 : a.id < b.id ? 1 : 0))
  }

  async readSnapshot(id: string): Promise<string> {
    const raw = this.backing.snapshots.get(id)
    if (raw === undefined) throw new Error(`no snapshot ${id}`)
    return raw
  }

  async quarantine(raw: string, reason: string): Promise<void> {
    this.backing.quarantined.push({ raw, reason })
  }

  /** Test-only view; nothing in the app reads this. */
  get quarantinedRecords(): readonly { raw: string; reason: string }[] {
    return this.backing.quarantined
  }

  private prune(): void {
    const newestFirst = [...this.backing.snapshots.keys()]
      .sort()
      .reverse()
      .map((id) => ({ id, at: new Date(0), bytes: 0 }))
    const keep = keepSet(newestFirst)
    for (const id of this.backing.snapshots.keys()) if (!keep.has(id)) this.backing.snapshots.delete(id)
  }
}
