/**
 * Store lifecycle, persistence and queries — the base half of
 * Sources/GTDo/Store/AppStore.swift. Mutations live in store.ts, mirroring the
 * Swift split across AppStore.swift and AppStore+Mutations.swift.
 *
 * Every mutation goes through a method here and ends with persist(). Mutations
 * are synchronous in memory — the UI is correct before anything touches
 * storage — and the write is coalesced by the WriteQueue.
 */

import { atNoon, startOfDay } from './calendar'
import { decodeAppData, encodeAppData } from './codec'
import { CompletionHold } from './completionHold'
import { BuiltIn, sameID, seededAppData, type AppData, type CalendarBucket, type PendingDeadline, type SidebarItem, type TaskItem, type TaskList } from './models'
import * as Q from './queries'
import type { QueryContext } from './queries'
import { BACKUP_INTERVAL_MS } from './snapshotPolicy'
import { noopReminderPort, type ReminderPort, type SnapshotMeta, type StoragePort } from './ports'
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
  /** Optional: without one, reminders are stored but never scheduled. */
  reminders?: ReminderPort
}


/** What AppStore.create resolves before constructing the store. */
export type InitialState = {
  data: AppData
  lastKnownGood: string | null
  lastBackupAt: Date | null
  saveError: Error | null
  refusingToOverwrite: boolean
}

/**
 * The three-way load outcome, which is the whole data-safety guarantee
 * (spec §8): absent seeds, unreadable refuses to ever write, undecodable
 * quarantines the user's bytes before anything replaces them.
 */
export async function loadInitialState(deps: StoreDeps): Promise<InitialState> {
  const base = { lastKnownGood: null, lastBackupAt: null, saveError: null, refusingToOverwrite: false }
  const result = await deps.adapter.load()

  if (result.kind === 'unreadable') {
    // The record is there but unreadable. Start empty so the app runs, but
    // never write over it — those bytes are the user's data.
    return { ...base, data: seededAppData(), saveError: result.error, refusingToOverwrite: true }
  }

  if (result.kind === 'ok') {
    try {
      const data = decodeAppData(result.raw)
      // A restore point per session, before this run can change anything.
      const at = deps.now()
      const written = await deps.adapter.writeSnapshot(result.raw, at)
      return { ...base, data, lastKnownGood: result.raw, lastBackupAt: written ? at : null }
    } catch (e) {
      // Readable but undecodable. Keep the bytes before anything replaces them
      // — the web has no Finder to recover from.
      const error = e instanceof Error ? e : new Error(String(e))
      try {
        await deps.adapter.quarantine(result.raw, `undecodable: ${error.message}`)
      } catch {
        // Quarantine is best-effort; failing it must not stop the app booting.
      }
      return { ...base, data: seededAppData(), saveError: error }
    }
  }

  // Absent: a genuine first run.
  return { ...base, data: seededAppData() }
}

/** How long a completed row is held in place after the last tap. */
export const COMPLETION_HOLD_WINDOW_MS = 500

export class StoreBase {
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
  protected readonly reminders: ReminderPort

  /** When the last rotating backup was taken (throttles the next one). */
  protected lastBackupAt: Date | null = null
  /**
   * True when the record exists but couldn't be read at launch. Saving would
   * overwrite bytes that are probably still recoverable, so we don't — and it
   * is never cleared, matching the Swift.
   */
  protected refusingToOverwrite = false

  protected hold = new CompletionHold()
  private subscribers = new Set<() => void>()

  constructor(deps: StoreDeps, init: InitialState) {
    this.adapter = deps.adapter
    this.now = deps.now
    this.scheduler = deps.scheduler
    this.reminders = deps.reminders ?? noopReminderPort
    this.data = init.data
    this.lastKnownGood = init.lastKnownGood
    this.lastBackupAt = init.lastBackupAt
    this.saveError = init.saveError
    this.refusingToOverwrite = init.refusingToOverwrite
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
    // Optional on the port: an adapter with no shared backing has no siblings
    // to hear from, and must still work.
    if ('onExternalWrite' in deps.adapter) {
      deps.adapter.onExternalWrite = (raw) => this.adoptExternalWrite(raw)
    }
  }

  /**
   * Take the document another tab just persisted, reporting whether we did.
   *
   * Safe only because every mutation persists immediately: with the queue idle,
   * memory and disk agree and there is nothing of ours to lose. With a write
   * outstanding there is, so we decline — and that write's compare-and-swap
   * then fails loudly instead of deleting the other tab's work.
   */
  private adoptExternalWrite(raw: string): boolean {
    // This tab is guarding bytes it could not read. Swapping its document
    // underfoot changes nothing about that and only muddies what it shows.
    if (this.refusingToOverwrite) return false
    if (!this.queue.isIdle) return false
    // A save that failed leaves the queue idle but this tab's changes off disk.
    // Cleared by the next successful save, so this is a pause, not a latch.
    if (this.saveError !== null) return false

    let data: AppData
    try {
      data = decodeAppData(raw)
    } catch {
      // Not ours to quarantine — the tab that wrote them holds the same bytes —
      // and adopting them would break a tab that is currently fine.
      return false
    }

    this.data = data
    // What is on disk now, so a later snapshot copies this rather than the
    // document this tab loaded at launch — which no longer exists anywhere.
    this.lastKnownGood = raw
    this.notify()
    return true
  }

  // MARK: - Subscription

  subscribe(fn: () => void): () => void {
    this.subscribers.add(fn)
    return () => this.subscribers.delete(fn)
  }

  protected notify(): void {
    for (const fn of this.subscribers) fn()
  }

  // MARK: - View state
  //
  // These are plain fields, but the UI needs a render when they change, so the
  // setters exist rather than exposing notify().

  setSelection(item: SidebarItem | null): void {
    this.selection = item
    this.selectedTaskID = null
    this.notify()
  }

  setSelectedTask(id: string | null): void {
    this.selectedTaskID = id
    this.notify()
  }

  setSearchQuery(query: string): void {
    this.searchQuery = query
    this.notify()
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

  /** The rotating snapshots available to restore from, newest first. */
  listSnapshots(): Promise<SnapshotMeta[]> {
    return this.adapter.listSnapshots()
  }

  readSnapshot(id: string): Promise<string> {
    return this.adapter.readSnapshot(id)
  }

  /** Awaits the pending write. Tests use this; the export path does not — it
   *  encodes from memory and never waits for disk. */
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
  protected lastKnownGood: string | null = null
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
    // The only whole-store replacement that re-arms reminders. resetAllData
    // and loadSampleData deliberately do not — sample reminders are metadata,
    // not alerts to fire.
    this.armAllReminders()
  }

  /** Overridden in AppStore, which owns syncReminder. */
  protected armAllReminders(): void {}

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

  // MARK: - Completion hold

  /**
   * The completion state a *view* should render: the pinned value while the
   * hold window is open, the stored value otherwise. Every query goes through
   * this instead of reading isCompleted directly — except search, deliberately.
   */
  rendersCompleted(task: TaskItem): boolean {
    return this.hold.pinFor(task.id)?.rendersCompleted ?? task.isCompleted
  }

  /**
   * The completion date a view should sort and label by. Pinned too, so the
   * Completed section does not resort under a held row — and a pin whose
   * completedAt is null yields null rather than falling through to the stored
   * value.
   */
  renderedCompletionDate(task: TaskItem): Date | null {
    const pin = this.hold.pinFor(task.id)
    return pin === null ? task.completedAt : pin.completedAt
  }

  /** A task spawned inside an open hold window; hidden until it closes. */
  isHeldHidden(task: TaskItem): boolean {
    return this.hold.isSuppressed(task.id)
  }

  /** The rows currently pinned in place. Pins only — never suppressions. */
  get recentlyCompleted(): Set<string> {
    return this.hold.pinnedIDs
  }

  private get queryContext(): QueryContext {
    return {
      data: this.data,
      today: this.today,
      rendersCompleted: (t) => this.rendersCompleted(t),
      renderedCompletionDate: (t) => this.renderedCompletionDate(t),
      isHeldHidden: (t) => this.isHeldHidden(t),
    }
  }

  // MARK: - Smart views

  get activeTasks(): TaskItem[] { return Q.activeTasks(this.queryContext) }
  get todayTasks(): TaskItem[] { return Q.todayTasks(this.queryContext) }
  get overdueTasks(): TaskItem[] { return Q.overdueTasks(this.queryContext) }
  get completedTasks(): TaskItem[] { return Q.completedTasks(this.queryContext) }
  get todayCompletedTasks(): TaskItem[] { return Q.todayCompletedTasks(this.queryContext) }
  get trashedTasks(): TaskItem[] { return Q.trashedTasks(this.queryContext) }

  calendarTasks(bucket: CalendarBucket): TaskItem[] {
    return Q.calendarTasks(this.queryContext, bucket)
  }

  // MARK: - Per-list views

  incompleteTasks(listID: string): TaskItem[] {
    return Q.incompleteTasks(this.queryContext, listID)
  }

  completedTasksIn(listID: string): TaskItem[] {
    return Q.completedTasksIn(this.queryContext, listID)
  }

  moveTargets(excludingListID: string | null): TaskList[] {
    return Q.moveTargets(this.queryContext, excludingListID)
  }

  // MARK: - Task creation

  /**
   * Creation in a stored list lands there; in Today/Calendar it lands in Inbox
   * due today; Completed/Trash have no add bar.
   *
   * Does NOT enforce the deadline-required lists — submitNewTask does — and
   * does not touch selectedTaskID or reminders.
   */
  addTask(title: string, context: SidebarItem | null): TaskItem | null {
    const trimmed = title.trim()
    if (trimmed === '') return null

    let listID: string
    let dueDate: Date | null = null

    if (context === null) return null
    if (context.kind === 'list') {
      listID = context.id
    } else if (context.view === 'today' || context.view === 'calendar') {
      listID = BuiltIn.inbox
      dueDate = this.deadlineDay(this.today)
    } else {
      return null // Completed and Trash have no add bar
    }

    const item: TaskItem = {
      id: newUUID(),
      title: trimmed,
      note: '',
      dueDate,
      reminderDate: null,
      listID,
      isCompleted: false,
      completedAt: null,
      isTrashed: false,
      createdAt: this.now(),
      // Max over ALL tasks including trashed and completed, so a new task
      // always lands last globally.
      order: Math.max(0, ...this.data.tasks.map((t) => t.order)) + 1,
      repeatRule: null,
      trashedAt: null,
    }
    this.data.tasks.push(item)
    this.persist()
    return item
  }
}

/** Uppercase, matching the wire format. crypto.randomUUID is lowercase. */
function newUUID(): string {
  return crypto.randomUUID().toUpperCase()
}
