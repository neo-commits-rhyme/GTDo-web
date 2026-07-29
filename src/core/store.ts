/**
 * The mutation surface. Port of Sources/GTDo/Store/AppStore+Mutations.swift
 * plus the mutating half of AppStore.swift.
 *
 * Every mutation ends in persist(); the destructive ones force a backup, so
 * there is always a way back from an irreversible action.
 */

import { startOfDay } from './calendar'
import { COMPLETION_HOLD_WINDOW_MS, loadInitialState, StoreBase, type StoreDeps } from './storeBase'
import { taskTitles } from './taskImport'
import {
  BuiltIn, sameID, seededAppData, sidebarItemsEqual,
  type ListGroup, type SidebarItem, type TaskItem, type TaskList, type RepeatRule,
} from './models'
import { nextOccurrence } from './recurrence'
import { searchResults, type SearchOptions } from './search'
import {
  entryFor, entryID, GTD_BLOCK_IDS, GTD_OWN_SECTION_IDS, has, healOrder, moveWithinArray,
  type SidebarEntry,
} from './reorder'
import { makeSampleData } from './seed'

export { COMPLETION_HOLD_WINDOW_MS } from './storeBase'
export type { StoreDeps } from './storeBase'

/** Lists whose tasks must have a deadline; manual moves/creates into them
 *  prompt for one first. Someday is deliberately NOT here — it is the opposite
 *  rule, stripping deadlines. */
export const DEADLINE_REQUIRED_LISTS: readonly string[] = [BuiltIn.nextActions, BuiltIn.waitingFor]

export class AppStore extends StoreBase {
  static async create(deps: StoreDeps): Promise<AppStore> {
    return new AppStore(deps, await loadInitialState(deps))
  }

  private withTask(id: string, mutate: (t: TaskItem) => void): void {
    const i = this.taskIndex(id)
    if (i < 0) return
    mutate(this.data.tasks[i]!)
    this.persist()
  }

  private withList(id: string, mutate: (l: TaskList) => void): void {
    const i = this.data.lists.findIndex((l) => sameID(l.id, id))
    if (i < 0) return
    mutate(this.data.lists[i]!)
    this.persist()
  }

  // MARK: - Task field mutations

  /**
   * A deadline is a day, not an instant, so it is pinned to local noon.
   * Clearing it also clears the repeat rule — a repeat needs a deadline.
   */
  setDueDate(id: string, date: Date | null): void {
    this.withTask(id, (t) => {
      t.dueDate = date === null ? null : this.deadlineDay(date)
      if (date === null) t.repeatRule = null
    })
  }

  addToToday(id: string): void {
    if (this.task(id)?.isTrashed !== false) return
    this.setDueDate(id, this.today)
  }

  /** Reminders are instants, stored exactly as given — no noon pinning. */
  setReminder(id: string, date: Date | null): void {
    this.withTask(id, (t) => { t.reminderDate = date })
    this.syncReminder(id)
  }

  /** Notes are stored verbatim; an empty note is legal, unlike a title. */
  setNote(id: string, note: string): void {
    this.withTask(id, (t) => { t.note = note })
  }

  renameTask(id: string, title: string): void {
    const trimmed = title.trim()
    if (trimmed === '') return
    this.withTask(id, (t) => { t.title = trimmed })
    // The scheduled notification body carries the title.
    this.syncReminder(id)
  }

  /**
   * THE SOMEDAY RULE: moving into Someday strips both the deadline and the
   * repeat rule. No other list mutates fields on move.
   *
   * Does not enforce the deadline-required lists (requestMove does), does not
   * validate that the target exists, and does not change `order`.
   */
  moveTask(id: string, listID: string): void {
    // A trashed task's listID is its restore destination — moving it would
    // silently corrupt where Restore puts it back.
    if (this.task(id)?.isTrashed !== false) return
    this.withTask(id, (t) => {
      t.listID = listID
      if (sameID(listID, BuiltIn.someday)) {
        t.dueDate = null
        t.repeatRule = null
      }
    })
  }

  /**
   * Reorders a list's incomplete tasks by redistributing their existing global
   * `order` slots among themselves — no other task is affected, and there is no
   * renumbering or compaction.
   *
   * `destination` follows SwiftUI's onMove semantics: an insertion index into
   * the PRE-removal array, so moving item 0 down one requires destination 2.
   */
  moveIncompleteTasks(listID: string, from: number[], destination: number): void {
    this.moveTasksInSlots(this.incompleteTasks(listID), from, destination)
  }

  /**
   * Reorder across the Next actions mirror. There is one `order` field per
   * task, so dragging a project row here also moves it within its project — the
   * same slot redistribution a plain list does, over the rows actually on
   * screen.
   */
  moveNextActions(from: number[], destination: number): void {
    this.moveTasksInSlots(this.nextActionsTasks, from, destination)
  }

  /** The shared body: redistributes an existing set of `order` slots among the
   *  displayed tasks, so a view that shows tasks from more than one list can
   *  reorder its rows without disturbing anything it doesn't show. */
  private moveTasksInSlots(tasks: TaskItem[], from: number[], destination: number): void {
    const slots = tasks.map((t) => t.order).sort((a, b) => a - b)

    const moving = from.map((i) => tasks[i]).filter((t): t is TaskItem => t !== undefined)
    const movingIDs = new Set(moving.map((t) => t.id))
    const remaining = tasks.filter((t) => !movingIDs.has(t.id))
    // The insertion point is expressed against the pre-removal array, so shift
    // it back by however many moved items sat before it.
    const removedBefore = from.filter((i) => i < destination).length
    const insertAt = Math.max(0, Math.min(destination - removedBefore, remaining.length))
    remaining.splice(insertAt, 0, ...moving)

    remaining.forEach((task, n) => {
      const i = this.taskIndex(task.id)
      const slot = slots[n]
      if (i >= 0 && slot !== undefined) this.data.tasks[i]!.order = slot
    })
    this.persist()
  }

  /**
   * Puts a task back at a specific slot. Exists for undo: a reorder is
   * expressed through moveIncompleteTasks, which has no inverse, so restoring
   * a snapshot needs to write the slot directly.
   */
  setTaskOrder(id: string, order: number): void {
    this.withTask(id, (t) => { t.order = order })
  }

  // MARK: - Completion

  toggleCompleted(id: string): void {
    const i = this.taskIndex(id)
    if (i < 0) return
    const t = this.data.tasks[i]!
    if (t.isTrashed) return // trashed tasks cannot be toggled at all

    t.isCompleted = !t.isCompleted
    t.completedAt = t.isCompleted ? this.now() : null

    // Un-completing does NOT delete a previously spawned occurrence and does
    // not restore the old dueDate; the original keeps its rule, so re-completing
    // spawns another one. Ported as-is from the macOS behaviour.
    if (t.isCompleted && t.repeatRule !== null) this.spawnNextOccurrence(t, t.repeatRule)

    this.syncReminder(id)
    this.persist()
  }

  /**
   * Complete/un-complete from a tap on the circle: toggle now, migrate later.
   * The row keeps its place for the hold window, and every tap restarts the
   * window, so a run down the column never reflows mid-run.
   *
   * A full swipe calls toggleCompleted directly and migrates immediately — the
   * swipe has already given its own spatial confirmation.
   */
  toggleCompletedHolding(id: string): void {
    const before = this.task(id)
    if (before === null || before.isTrashed) return

    const existing = new Set(this.data.tasks.map((t) => t.id))
    this.toggleCompleted(id)
    // A recurrence spawn appeared: hide it for the rest of the window.
    this.hold.suppress(this.data.tasks.map((t) => t.id).filter((tid) => !existing.has(tid)))

    const generation = this.hold.pin(id, before.isCompleted, before.completedAt)
    this.scheduler(COMPLETION_HOLD_WINDOW_MS, () => {
      this.releaseCompletionHold(generation)
    })
  }

  /** Close the hold window if nothing has happened since `generation`.
   *  Does NOT persist — the hold is pure view state. */
  releaseCompletionHold(generation: number): boolean {
    const released = this.hold.release(generation)
    if (released) this.notify()
    return released
  }

  /** Drop the hold immediately — the screen went away or a full swipe wants
   *  its row gone now. */
  flushCompletionHold(): boolean {
    const released = this.hold.releaseNow()
    if (released) this.notify()
    return released
  }

  // MARK: - Recurrence

  setRepeatRule(id: string, rule: RepeatRule | null): void {
    this.withTask(id, (t) => {
      if (rule === null) {
        // Asymmetric with setDueDate(null), which DOES clear the rule.
        t.repeatRule = null
        return
      }
      t.repeatRule = { ...rule, interval: Math.max(1, rule.interval) }
      // Setting a rule can silently create a deadline of today-noon.
      if (t.dueDate === null) t.dueDate = this.deadlineDay(this.today)
    })
  }

  nextOccurrence(after: Date, rule: RepeatRule): Date {
    return nextOccurrence(after, rule, this.today)
  }

  /** Copies title, note and list only — not the reminder, not the deadline's
   *  time-of-day, not completion state. Does not persist; the caller does. */
  private spawnNextOccurrence(task: TaskItem, rule: RepeatRule): void {
    this.data.tasks.push({
      id: newUUID(),
      title: task.title,
      note: task.note,
      dueDate: this.deadlineDay(this.nextOccurrence(task.dueDate ?? this.today, rule)),
      reminderDate: null,
      listID: task.listID,
      isCompleted: false,
      completedAt: null,
      isTrashed: false,
      createdAt: this.now(),
      order: Math.max(0, ...this.data.tasks.map((t) => t.order)) + 1,
      repeatRule: rule,
      trashedAt: null,
    })
  }

  // MARK: - Trash

  trashTask(id: string): void {
    const i = this.taskIndex(id)
    if (i < 0) return
    const t = this.data.tasks[i]!
    t.isTrashed = true
    // Trashing an already-trashed task refreshes the stamp, resetting its
    // purge clock. Does not clear listID (the restore destination) and does not
    // change completion state.
    t.trashedAt = this.now()
    if (this.selectedTaskID !== null && sameID(this.selectedTaskID, id)) this.selectedTaskID = null
    this.syncReminder(id)
    this.persist()
  }

  /** Deliberately bypasses the Someday and deadline-required rules. */
  restoreTask(id: string): void {
    const item = this.task(id)
    if (item === null) return
    // The list may have been deleted while the task sat in the trash.
    const target = this.list(item.listID) === null ? BuiltIn.inbox : item.listID
    this.withTask(id, (t) => {
      t.isTrashed = false
      t.trashedAt = null
      t.listID = target
    })
    this.syncReminder(id)
  }

  /** No guard at all: works on non-trashed tasks and on unknown ids. */
  deleteTaskPermanently(id: string): void {
    this.cancelReminder(id)
    this.data.tasks = this.data.tasks.filter((t) => !sameID(t.id, id))
    if (this.selectedTaskID !== null && sameID(this.selectedTaskID, id)) this.selectedTaskID = null
    this.persist({ forceBackup: true })
  }

  /** Unconditional: persists and force-backs-up even when the trash was empty,
   *  and does not clear selectedTaskID. */
  emptyTrash(): void {
    for (const t of this.data.tasks) if (t.isTrashed) this.cancelReminder(t.id)
    this.data.tasks = this.data.tasks.filter((t) => !t.isTrashed)
    this.persist({ forceBackup: true })
  }

  /**
   * Auto-empty. Tasks trashed before the stamp existed (trashedAt === null) are
   * NEVER auto-purged, and the cutoff is strict. The early return prevents a
   * save and a backup on every launch.
   */
  purgeTrash(olderThanDays: number): void {
    const cutoff = new Date(this.now())
    cutoff.setDate(cutoff.getDate() - olderThanDays)
    const expired = this.data.tasks.filter(
      (t) => t.isTrashed && t.trashedAt !== null && t.trashedAt < cutoff,
    )
    if (expired.length === 0) return
    const ids = new Set(expired.map((t) => t.id))
    for (const id of ids) this.cancelReminder(id)
    this.data.tasks = this.data.tasks.filter((t) => !ids.has(t.id))
    this.persist({ forceBackup: true })
  }

  // MARK: - Projects

  /**
   * A new list in the Projects group named after the task, with the task itself
   * moved in as the project's first item.
   *
   * This MOVES and never deletes. An earlier macOS version removed the task
   * here, destroying its note, deadline, reminder and completion history with
   * no Trash recovery, from a one-click menu item. Moving keeps every field,
   * keeps the reminder live, and makes the operation reversible.
   */
  convertToProject(id: string): TaskList | null {
    const item = this.task(id)
    if (item === null || item.isTrashed) return null
    const project: TaskList = {
      id: newUUID(),
      name: item.title, // the raw title, not trimmed here
      isBuiltIn: false,
      groupID: BuiltIn.projectsGroup,
      order: Math.max(0, ...this.data.lists.map((l) => l.order)) + 1,
      colorHex: null,
      symbol: null,
    }
    this.data.lists.push(project)
    this.moveTask(id, project.id)
    this.syncReminder(id)
    this.persist()
    return project
  }

  // MARK: - List CRUD

  addList(name: string, groupID: string | null): TaskList | null {
    const trimmed = name.trim()
    if (trimmed === '') return null
    const list: TaskList = {
      id: newUUID(),
      name: trimmed,
      isBuiltIn: false,
      groupID,
      // Global max+1. Note moveListsInGroup renumbers 0..n WITHIN a group, so
      // orders can tie across groups — safe only because every read sorts
      // within a single group scope.
      order: Math.max(0, ...this.data.lists.map((l) => l.order)) + 1,
      colorHex: null,
      symbol: null,
    }
    this.data.lists.push(list)
    this.persist()
    return list
  }

  renameList(id: string, name: string): void {
    const trimmed = name.trim()
    if (trimmed === '' || this.list(id)?.isBuiltIn !== false) return
    this.withList(id, (l) => { l.name = trimmed })
  }

  /** Deleting a list trashes its live tasks rather than destroying them. */
  deleteList(id: string): void {
    if (this.list(id)?.isBuiltIn !== false) return
    for (const t of this.data.tasks) {
      if (sameID(t.listID, id) && !t.isTrashed) {
        t.isTrashed = true
        t.trashedAt = this.now()
        this.cancelReminder(t.id)
      }
    }
    this.data.lists = this.data.lists.filter((l) => !sameID(l.id, id))
    if (sidebarItemsEqual(this.selection, { kind: 'list', id })) {
      this.selection = { kind: 'smart', view: 'today' }
    }
    this.persist({ forceBackup: true })
  }

  moveList(id: string, groupID: string | null): void {
    if (this.list(id)?.isBuiltIn !== false) return
    this.withList(id, (l) => { l.groupID = groupID })
  }

  /** Customization — user lists only; built-ins keep their fixed look. */
  setListColor(id: string, hex: string | null): void {
    if (this.list(id)?.isBuiltIn !== false) return
    this.withList(id, (l) => { l.colorHex = hex })
  }

  setListSymbol(id: string, symbol: string | null): void {
    if (this.list(id)?.isBuiltIn !== false) return
    this.withList(id, (l) => { l.symbol = symbol })
  }

  // MARK: - Group CRUD

  addGroup(name: string): ListGroup | null {
    const trimmed = name.trim()
    if (trimmed === '') return null
    const group: ListGroup = {
      id: newUUID(),
      name: trimmed,
      isBuiltIn: false,
      // Projects is order 0, so user groups start at 1.
      order: Math.max(0, ...this.data.groups.map((g) => g.order)) + 1,
    }
    this.data.groups.push(group)
    this.persist()
    return group
  }

  renameGroup(id: string, name: string): void {
    const trimmed = name.trim()
    const i = this.data.groups.findIndex((g) => sameID(g.id, id))
    if (trimmed === '' || i < 0 || this.data.groups[i]!.isBuiltIn) return
    this.data.groups[i]!.name = trimmed
    this.persist()
  }

  /** Deleting a group keeps its lists — they become ungrouped. */
  deleteGroup(id: string): void {
    const group = this.data.groups.find((g) => sameID(g.id, id))
    if (group === undefined || group.isBuiltIn) return
    for (const l of this.data.lists) if (l.groupID !== null && sameID(l.groupID, id)) l.groupID = null
    this.data.groups = this.data.groups.filter((g) => !sameID(g.id, id))
    this.persist({ forceBackup: true })
  }

  // MARK: - Whole-store operations

  /** Wipe back to the seeded defaults. Deliberately does NOT re-arm reminders —
   *  only importData does. */
  resetAllData(): void {
    for (const t of this.data.tasks) this.cancelReminder(t.id)
    this.data = seededAppData()
    this.selection = { kind: 'smart', view: 'today' }
    this.selectedTaskID = null
    this.searchQuery = ''
    this.persist({ forceBackup: true })
  }

  /** Sample reminders are metadata only, so loading demo data never fires alerts. */
  loadSampleData(): void {
    for (const t of this.data.tasks) this.cancelReminder(t.id)
    this.data = makeSampleData(this.now())
    this.selection = { kind: 'smart', view: 'today' }
    this.selectedTaskID = null
    this.searchQuery = ''
    this.persist({ forceBackup: true })
  }

  // MARK: - Text import

  /** Append a plain-text / CSV list to the Inbox, one line per task.
   *  @returns how many tasks were created. */
  importTasksFromText(text: string): number {
    return this.importTasks(taskTitles(text))
  }

  /**
   * Everything lands in the Inbox regardless of the current selection — an
   * imported list is unprocessed capture, which is what the Inbox is for.
   *
   * One save for the whole file, not one per line: a 500-line list would
   * otherwise write (and snapshot) the store 500 times. The save forces a
   * backup, so a bulk import stays recoverable from a snapshot.
   *
   * @returns how many tasks were created.
   */
  importTasks(titles: string[]): number {
    const clean = titles.map((t) => t.trim()).filter((t) => t !== '')
    if (clean.length === 0) return 0
    let order = Math.max(0, ...this.data.tasks.map((t) => t.order))
    const createdAt = this.now()
    for (const title of clean) {
      order += 1
      this.data.tasks.push({
        id: newUUID(),
        title,
        note: '',
        dueDate: null,
        reminderDate: null,
        listID: BuiltIn.inbox,
        isCompleted: false,
        completedAt: null,
        isTrashed: false,
        createdAt,
        order,
        repeatRule: null,
        trashedAt: null,
      })
    }
    this.persist({ forceBackup: true })
    return clean.length
  }

  // MARK: - Deadline-required moves

  /**
   * Which of `ids` a requestMove to `target` would move *right now*: a trashed
   * task is refused outright, a task already in `target` has nothing to change,
   * and an undated one bound for a deadline-required list only raises the
   * prompt — it moves later, from completePendingDeadline.
   *
   * Callers need the answer BEFORE they mutate, because UndoCenter.perform
   * snapshots first. A bar offered over a move that never happened reads
   * “1 task moved” with an Undo that does nothing, and — the part that hurt —
   * evicts whatever real action was still pending in the centre's single slot,
   * so a live “1 task trashed” became unreachable from the bar and from Cmd+Z.
   */
  movesNow(ids: string[], target: string): string[] {
    return ids.filter((id) => {
      const task = this.task(id)
      if (task === null || task.isTrashed) return false
      // Someday is the one target that still changes a task already sitting in
      // it — THE SOMEDAY RULE strips the deadline and the repeat wherever they
      // came from, and one can be set on a task that is already there.
      if (sameID(task.listID, target)) {
        return sameID(target, BuiltIn.someday) && (task.dueDate !== null || task.repeatRule !== null)
      }
      return task.dueDate != null || !DEADLINE_REQUIRED_LISTS.some((l) => sameID(l, target))
    })
  }

  /**
   * Move tasks to `target`, requiring a deadline when the target demands one.
   * Tasks that already have one move immediately; those without raise the
   * prompt and move once it is set.
   *
   * Returns the ids it actually moved — never the ids it was handed — so a
   * caller cannot mistake an accepted request for a mutation.
   */
  requestMove(ids: string[], target: string): string[] {
    const moving = this.movesNow(ids, target)
    for (const id of moving) this.moveTask(id, target)
    if (!DEADLINE_REQUIRED_LISTS.some((l) => sameID(l, target))) return moving

    const needing = ids.filter((id) => {
      const task = this.task(id)
      return task !== null && !task.isTrashed && task.dueDate == null
    })
    if (needing.length > 0) {
      this.pendingDeadline = { kind: 'move', taskIDs: needing, target }
      // Raising the prompt is not a persisted mutation, so nothing else would
      // tell the UI to render it.
      this.notify()
    }
    return moving
  }

  /**
   * Add-bar submission. With a `deadline` supplied the task is created and
   * dated in one call; without one, creating directly in a deadline-required
   * list creates nothing and raises the prompt instead.
   */
  submitNewTask(title: string, context: SidebarItem | null, deadline: Date | null = null): TaskItem | null {
    if (
      context !== null && context.kind === 'list' &&
      DEADLINE_REQUIRED_LISTS.some((l) => sameID(l, context.id)) && deadline === null
    ) {
      const trimmed = title.trim()
      if (trimmed === '') return null
      // The stored title is already trimmed.
      this.pendingDeadline = { kind: 'create', title: trimmed, target: context.id }
      this.notify()
      return null
    }

    const created = this.addTask(title, context)
    if (created === null) return null
    if (deadline !== null) this.setDueDate(created.id, deadline)
    return this.task(created.id)
  }

  completePendingDeadline(deadline: Date): void {
    const pending = this.pendingDeadline
    if (pending === null) return
    if (pending.kind === 'move') {
      for (const id of pending.taskIDs) {
        this.setDueDate(id, deadline)
        this.moveTask(id, pending.target)
      }
    } else {
      const created = this.addTask(pending.title, { kind: 'list', id: pending.target })
      if (created !== null) this.setDueDate(created.id, deadline)
    }
    this.pendingDeadline = null
    this.notify()
  }

  cancelPendingDeadline(): void {
    this.pendingDeadline = null
    this.notify()
  }

  // MARK: - Inbox Review

  /**
   * Incomplete, non-trashed Inbox tasks — oldest first, since incompleteTasks
   * is already order-sorted.
   */
  inboxReviewQueue(): TaskItem[] {
    return this.incompleteTasks(BuiltIn.inbox)
  }

  /** "Do it": give the task a deadline and move it to Next actions, which
   *  preserves the deadline — only Someday strips it. */
  reviewDoIt(id: string, deadline: Date): void {
    this.setDueDate(id, deadline)
    this.moveTask(id, BuiltIn.nextActions)
  }

  /** "Delegate it": give the task a deadline and move it to Waiting for. */
  reviewDelegate(id: string, deadline: Date): void {
    this.setDueDate(id, deadline)
    this.moveTask(id, BuiltIn.waitingFor)
  }

  // MARK: - Sidebar queries

  userGroups(): ListGroup[] {
    return this.data.groups.filter((g) => !g.isBuiltIn).sort((a, b) => a.order - b.order)
  }

  listsInGroup(groupID: string | null): TaskList[] {
    return this.data.lists
      .filter((l) => (groupID === null ? l.groupID === null : l.groupID !== null && sameID(l.groupID, groupID)))
      .sort((a, b) => a.order - b.order)
  }

  ungroupedUserLists(): TaskList[] {
    return this.data.lists
      .filter((l) => l.groupID === null && !l.isBuiltIn)
      .sort((a, b) => a.order - b.order)
  }

  // MARK: - Search

  /** Reads isCompleted/isTrashed directly — never through the completion hold. */
  searchResults(opts: SearchOptions = {}): TaskItem[] {
    return searchResults(this.data, this.searchQuery, opts)
  }

  // MARK: - Sidebar order

  /** Healed on read; the stored value is only rewritten by an explicit move. */
  healedGTDOrder(): string[] {
    return healOrder(this.data.gtdOrder, GTD_BLOCK_IDS)
  }

  healedUserOrder(): string[] {
    const canonical = [...this.userGroups().map((g) => g.id), ...this.ungroupedUserLists().map((l) => l.id)]
    return healOrder(this.data.userOrder, canonical)
  }

  gtdSectionItems(): SidebarEntry[] {
    return this.healedGTDOrder()
      .map((id) => entryFor(id, this.data.lists, this.data.groups))
      .filter((e): e is SidebarEntry => e !== null)
  }

  userSectionItems(): SidebarEntry[] {
    return this.healedUserOrder()
      .map((id) => entryFor(id, this.data.lists, this.data.groups))
      .filter((e): e is SidebarEntry => e !== null)
  }

  moveGTDEntries(from: number[], destination: number): void {
    this.data.gtdOrder = moveWithinArray(this.healedGTDOrder(), from, destination)
    this.persist()
  }

  /**
   * The GTD block as the sidebar actually draws it. Projects and Notes each get
   * their own section, so they are not among these.
   */
  visibleGTDEntries(): SidebarEntry[] {
    return this.gtdSectionItems().filter((e) => !has(GTD_OWN_SECTION_IDS, entryID(e)))
  }

  /**
   * Reorder from indices into `visibleGTDEntries()`.
   *
   * Mapping a visible index back into the full order and calling
   * moveGTDEntries does NOT work: the destination would land relative to
   * entries the user cannot see, so dragging the last visible row down would
   * step over a hidden section and appear to do nothing. The move happens among
   * the visible ids, then each hidden id goes back at the index it held.
   */
  moveVisibleGTDEntries(from: number[], destination: number): void {
    const order = this.healedGTDOrder()
    const hidden = order
      .map((id, index) => ({ id, index }))
      .filter(({ id }) => has(GTD_OWN_SECTION_IDS, id))
    const moved = moveWithinArray(order.filter((id) => !has(GTD_OWN_SECTION_IDS, id)), from, destination)
    // Ascending, so each insertion leaves the later recorded indices valid.
    for (const { id, index } of hidden) moved.splice(Math.min(index, moved.length), 0, id)
    this.data.gtdOrder = moved
    this.persist()
  }

  moveUserEntries(from: number[], destination: number): void {
    this.data.userOrder = moveWithinArray(this.healedUserOrder(), from, destination)
    this.persist()
  }

  /** Renumbers a group's lists 0..n. Orders therefore tie across groups —
   *  safe only because every read sorts within a single group scope. */
  moveListsInGroup(groupID: string | null, from: number[], destination: number): void {
    const members = moveWithinArray(this.listsInGroup(groupID), from, destination)
    members.forEach((member, idx) => {
      const i = this.data.lists.findIndex((l) => sameID(l.id, member.id))
      if (i >= 0) this.data.lists[i]!.order = idx
    })
    this.persist()
  }

  // MARK: - Reminders (scheduling itself lands in sub-project 5)

  /**
   * Cancel-then-reschedule for one task. The single source of truth for when a
   * reminder is live: future date, not completed, not trashed. Strict `>`, so a
   * reminder exactly at now is not scheduled. Does not persist.
   */
  syncReminder(id: string): void {
    this.cancelReminder(id)
    const t = this.task(id)
    if (t === null || t.reminderDate === null) return
    if (t.reminderDate > this.now() && !t.isCompleted && !t.isTrashed) {
      this.scheduleReminder(id, t.title, t.reminderDate)
    }
  }

  protected cancelReminder(id: string): void {
    this.reminders.cancel(id)
  }

  protected scheduleReminder(id: string, title: string, at: Date): void {
    this.reminders.schedule(id, title, at)
  }

  /**
   * Arms every live reminder. Called once after a load, and by importData —
   * which is the only whole-store replacement that re-arms, matching the Swift.
   */
  override armAllReminders(): void {
    this.reminders.cancelAll()
    for (const t of this.data.tasks) this.syncReminder(t.id)
  }
}

/** Uppercase, matching the wire format. crypto.randomUUID is lowercase. */
function newUUID(): string {
  return crypto.randomUUID().toUpperCase()
}

/** Re-exported so callers can compute "today" without a store. */
export { startOfDay }
