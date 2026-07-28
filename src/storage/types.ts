/**
 * The storage seam. core/ never imports this; the store receives an adapter.
 *
 * Splitting Persistence.swift here is deliberate: encoding is pure and lives in
 * core/codec.ts, I/O is async and platform-bound and lives behind this interface.
 * Future sync (bring-your-own-GitHub, a server) plugs in here without core/
 * knowing anything changed.
 */

/**
 * Why a load produced no data. The caller MUST distinguish "first run" from
 * "your file is there but unreadable", because only the first may safely be
 * overwritten with seeded data.
 */
export type LoadResult =
  /** No record yet: a genuine first run. */
  | { kind: 'absent' }
  | { kind: 'ok'; raw: string }
  /** The record exists but could not be read. NOT safe to overwrite. */
  | { kind: 'unreadable'; error: Error }
  /** The record was read but did not decode. Quarantined before replacement. */
  | { kind: 'undecodable'; raw: string; error: Error }

export type SnapshotMeta = {
  /** UTC stamp `yyyy-MM-dd-HHmmss`, sortable as text. */
  id: string
  at: Date
  bytes: number
}

export interface StorageAdapter {
  load(): Promise<LoadResult>
  /** Rejects on quota exhaustion, eviction, or a corrupt store. */
  persist(raw: string): Promise<void>
  /** Returns true when a snapshot for `at` now exists — either just written or
   *  already present. False means the caller should retry rather than assume
   *  it is covered. */
  writeSnapshot(raw: string, at: Date): Promise<boolean>
  /** Newest first. */
  listSnapshots(): Promise<SnapshotMeta[]>
  readSnapshot(id: string): Promise<string>
  /** Keeps bytes that failed to decode. Nothing is ever deleted — the web has
   *  no Finder to recover from. */
  quarantine(raw: string, reason: string): Promise<void>
}
