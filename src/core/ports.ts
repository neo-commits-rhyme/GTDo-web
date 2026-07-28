/**
 * The interfaces core/ depends on, owned by core/.
 *
 * Layering: app → storage → core, dependencies pointing downward only. The
 * store needs *a* place to persist bytes, but it must not know that place is
 * IndexedDB — so the port is declared here and implemented in storage/.
 * (The lint rule in eslint.config.js enforces this; it caught the first draft
 * of store.ts importing storage/ directly.)
 */

/**
 * Why a load produced no data. The caller MUST distinguish "first run" from
 * "the record is there but unreadable", because only the first may safely be
 * overwritten with seeded data.
 */
export type LoadResult =
  /** No record yet: a genuine first run. */
  | { kind: 'absent' }
  | { kind: 'ok'; raw: string }
  /** The record exists but could not be read. NOT safe to overwrite. */
  | { kind: 'unreadable'; error: Error }

export type SnapshotMeta = {
  /** UTC stamp `yyyy-MM-dd-HHmmss`, sortable as text. */
  id: string
  at: Date
  bytes: number
}

export interface StoragePort {
  load(): Promise<LoadResult>
  /** Rejects on quota exhaustion, eviction, or a corrupt store. */
  persist(raw: string): Promise<void>
  /**
   * Returns true when a snapshot for `at` now exists — either just written or
   * already present. False means the caller should retry rather than assume it
   * is covered.
   */
  writeSnapshot(raw: string, at: Date): Promise<boolean>
  /** Newest first. */
  listSnapshots(): Promise<SnapshotMeta[]>
  readSnapshot(id: string): Promise<string>
  /**
   * Keeps bytes that failed to decode. Nothing is ever deleted — the web has no
   * Finder to recover from.
   */
  quarantine(raw: string, reason: string): Promise<void>
}
