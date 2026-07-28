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
  /**
   * Set by the store to receive a document another tab just wrote, returning
   * whether it took it. Only an adapter backed by shared storage can know this
   * happened, so it is optional — the store works against the ones that cannot.
   *
   * Refusing matters as much as accepting: a tab that kept its own document has
   * still not seen the other's, and its next save must fail the adapter's
   * compare-and-swap rather than overwrite work it never read.
   */
  onExternalWrite?: ((raw: string, revision: number) => boolean) | null
}

/**
 * Where a scheduled reminder goes. Declared here for the same reason
 * StoragePort is: the store needs *a* scheduler and must not know it is a
 * browser timer feeding the Notifications API.
 */
export interface ReminderPort {
  schedule(id: string, title: string, at: Date): void
  cancel(id: string): void
  cancelAll(): void
}

/** The default, so a store constructed without one behaves exactly as before. */
export const noopReminderPort: ReminderPort = {
  schedule: () => {},
  cancel: () => {},
  cancelAll: () => {},
}
