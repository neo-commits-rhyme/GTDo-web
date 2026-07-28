/**
 * Single source of truth. Port of Sources/GTDo/Store/AppStore.swift.
 *
 * Every mutation goes through a method here and ends with persist(). Mutations
 * are synchronous in memory — the UI is correct before anything touches
 * storage — and the write is coalesced by the WriteQueue.
 */

import { atNoon, startOfDay } from './calendar'
import { decodeAppData, encodeAppData } from './codec'
import { CompletionHold } from './completionHold'
import { sameID, seededAppData, type AppData, type PendingDeadline, type SidebarItem, type TaskItem, type TaskList } from './models'
import { BACKUP_INTERVAL_MS } from './snapshotPolicy'
import type { StoragePort } from './ports'
import { WriteQueue } from './writeQueue'

export type StoreDeps = {
  adapter: StoragePort
  /** Injected clock — core/ never reads the wall clock itself. */
  now: () => Date
  /**
   * Injected scheduler for the completion-hold window. A second clock hook,
   * because this one schedules rather than reads; tests fire it by hand.
   */
  scheduler: (delayMs: number, fn: () => void) => void
}

/** How long a completed row is held in place after the last tap. */
export const COMPLETION_HOLD_WINDOW_MS = 500

export class AppStore {
  data: AppData
  selection: SidebarItem | null = { kind: 'smart', view: 'today' }
  selectedTaskID: string | null = null
  searchQuery = ''
  /** A move/create into a deadline-required list awaiting the user's deadline. */
  pendingDeadline: PendingDeadline | null = null
  /**
   * Set when the last save failed — the UI surfaces this, because silently
   * running with unsaved changes is how notes disappear.
   */
  saveError: Error | null = null

  private readonly adapter: StoragePort
  private readonly queue: WriteQueue
  readonly now: () => Date
  readonly scheduler: (delayMs: number, fn: () => void) => void

  /** When the last rotating backup was taken (throttles the next one). */
  private lastBackupAt: Date | null = null
  /**
   * True when the record exists but couldn't be read at launch. Saving would
   * overwrite bytes that are probably still recoverable, so we don't — and it
   * is never cleared, matching the Swift.
   */
  private refusingToOverwrite = false

  protected hold = new CompletionHold()
  private subscribers = new Set<() => void>()

  protected constructor(deps: StoreDeps, data: AppData) {
    this.adapter = deps.adapter
    this.now = deps.now
    this.scheduler = deps.scheduler
    this.data = data
    this.queue = new WriteQueue(deps.adapter)
    this.queue.onError = (e) => {
      this.saveError = e
      this.notify()
    }
    this.queue.onSuccess = () => {
      // What is now on disk becomes the state a future snapshot copies.
      if (this.pendingEncoded !== null) this.lastKnownGood = this.pendingEncoded
      // A successful save clears a previous error, matching Swift's
      // unconditional assignment of saveError in persist().
      if (this.saveError !== null) {
        this.saveError = null
        this.notify()
      }
    }
  }

  /**
   * Load, then construct. Async because storage is; the three-way outcome is
   * the whole data-safety guarantee (spec §8).
   */
  static async create(deps: StoreDeps): Promise<AppStore> {
    const result = await deps.adapter.load()

    if (result.kind === 'unreadable') {
      // The record is there but unreadable. Start empty so the app runs, but
      // never write over it — those bytes are the user's data.
      const store = new AppStore(deps, seededAppData())
      store.refusingToOverwrite = true
      store.saveError = result.error
      return store
    }

    if (result.kind === 'ok') {
      try {
        const data = decodeAppData(result.raw)
        const store = new AppStore(deps, data)
        // A restore point per session, before this run can change anything.
        store.lastKnownGood = result.raw
        const at = deps.now()
        if (await deps.adapter.writeSnapshot(result.raw, at)) store.lastBackupAt = at
        return store
      } catch (e) {
        // Readable but undecodable. Keep the bytes before anything replaces
        // them — the web has no Finder to recover from.
        const error = e instanceof Error ? e : new Error(String(e))
        try {
          await deps.adapter.quarantine(result.raw, `undecodable: ${error.message}`)
        } catch {
          // Quarantine is best-effort; failing it must not stop the app booting.
        }
        const store = new AppStore(deps, seededAppData())
        store.saveError = error
        return store
      }
    }

    // Absent: a genuine first run.
    return new AppStore(deps, seededAppData())
  }

  // MARK: - Subscription

  subscribe(fn: () => void): () => void {
    this.subscribers.add(fn)
    return () => this.subscribers.delete(fn)
  }

  protected notify(): void {
    for (const fn of this.subscribers) fn()
  }

  // MARK: - Persistence

  /**
   * Saves the current state. `forceBackup` snapshots regardless of the
   * throttle — destructive operations must always leave a way back.
   */
  persist(opts: { forceBackup?: boolean } = {}): void {
    this.notify()
    if (this.refusingToOverwrite) {
      // Saving would destroy recoverable bytes. Refuse, and keep saying so.
      this.saveError ??= new Error('The stored data could not be read; saving is disabled.')
      return
    }

    const encoded = encodeAppData(this.data)

    // Snapshot the last-known-good record BEFORE overwriting it, throttled so a
    // burst of edits doesn't write a copy per keystroke.
    const elapsed = this.lastBackupAt === null ? null : this.now().getTime() - this.lastBackupAt.getTime()
    // Negative elapsed means the clock moved backwards (DST, NTP, manual
    // change); treat it as due rather than suspending backups until real time
    // catches up.
    if (opts.forceBackup || elapsed === null || elapsed >= BACKUP_INTERVAL_MS || elapsed < 0) {
      this.takeBackup()
    }

    this.pendingEncoded = encoded
    this.queue.enqueue(encoded)
    void this.queue.flush()
  }

  /** Awaits the pending write. Tests and the export path use this. */
  async flushWrites(): Promise<void> {
    await this.queue.flush()
  }

  /**
   * Snapshots the last-known-good bytes — the state already persisted, never
   * the state we are about to write. A snapshot is therefore always something
   * the app previously considered good.
   *
   * With nothing good yet (first run) there is nothing to copy, mirroring
   * writeBackup returning false when the data file does not exist.
   */
  private takeBackup(): void {
    if (this.lastKnownGood === null) return
    const at = this.now()
    const snapshot = this.lastKnownGood
    void this.adapter.writeSnapshot(snapshot, at).then((written) => {
      // Only remember a backup that actually happened, so a failed copy is
      // retried on the next save instead of being throttled away.
      if (written) this.lastBackupAt = at
    })
  }

  /** The bytes last successfully loaded or written — the pre-mutation state. */
  private lastKnownGood: string | null = null
  /** The bytes currently being written, promoted to lastKnownGood on success. */
  private pendingEncoded: string | null = null

  /**
   * A backup that is valid JSON but missing the built-in lists would leave no
   * Inbox to file into and an empty sidebar. Restore any that are absent rather
   * than rejecting the import or leaving the app unusable.
   *
   * Appends, and matches by id only — a list carrying the Inbox id under a
   * different name counts as present and is not renamed.
   */
  healingBuiltIns(imported: AppData): AppData {
    const healed: AppData = { ...imported, lists: [...imported.lists], groups: [...imported.groups] }
    const seed = seededAppData()

    const present = new Set(healed.lists.map((l) => l.id.toUpperCase()))
    for (const l of seed.lists) if (!present.has(l.id.toUpperCase())) healed.lists.push(l)

    const groupsPresent = new Set(healed.groups.map((g) => g.id.toUpperCase()))
    for (const g of seed.groups) if (!groupsPresent.has(g.id.toUpperCase())) healed.groups.push(g)

    return healed
  }

  /**
   * Replace everything with an imported document, backing up first so the
   * import itself is undoable from the snapshot list.
   */
  importData(imported: AppData): void {
    this.takeBackup()
    this.data = this.healingBuiltIns(imported)
    this.selection = { kind: 'smart', view: 'today' }
    this.selectedTaskID = null
    this.searchQuery = ''
    this.pendingDeadline = null
    this.persist()
  }

  // MARK: - Lookup

  /** Local midnight — deadlines are stored at noon, so every day comparison
   *  goes through startOfDay rather than comparing instants. */
  get today(): Date {
    return startOfDay(this.now())
  }

  /** The given date's day, pinned to local noon. */
  deadlineDay(date: Date): Date {
    return atNoon(date)
  }

  /**
   * Frozen copies, not live references: callers snapshot a task and read it
   * back after mutating.
   */
  task(id: string): Readonly<TaskItem> | null {
    const t = this.data.tasks.find((t) => sameID(t.id, id))
    return t === undefined ? null : Object.freeze({ ...t })
  }

  list(id: string): Readonly<TaskList> | null {
    const l = this.data.lists.find((l) => sameID(l.id, id))
    return l === undefined ? null : Object.freeze({ ...l })
  }

  protected taskIndex(id: string): number {
    return this.data.tasks.findIndex((t) => sameID(t.id, id))
  }
}
