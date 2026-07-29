/**
 * Port of Sources/GTDo/Models/Models.swift.
 *
 * The field names and their optionality are the wire format (spec §3), so they
 * are not free to change: every non-optional field below is a hard requirement
 * of the macOS app's decoder.
 */

/** Well-known IDs for seeded built-ins, stable across launches and tests. */
export const BuiltIn = {
  inbox: '00000000-0000-0000-0000-000000000001',
  nextActions: '00000000-0000-0000-0000-000000000002',
  waitingFor: '00000000-0000-0000-0000-000000000003',
  someday: '00000000-0000-0000-0000-000000000004',
  notes: '00000000-0000-0000-0000-000000000005',
  projectsGroup: '00000000-0000-0000-0000-0000000000AA',
} as const

export type RepeatUnit = 'day' | 'weekday' | 'week' | 'month' | 'year'

/**
 * Repeat rule for recurring tasks. `weekday` means "next Mon–Fri day" and is
 * reachable only via the Weekdays preset — interval is ignored beyond 1.
 */
export type RepeatRule = { unit: RepeatUnit; interval: number }

export const RepeatPresets = {
  daily: { unit: 'day', interval: 1 },
  weekdays: { unit: 'weekday', interval: 1 },
  weekly: { unit: 'week', interval: 1 },
  monthly: { unit: 'month', interval: 1 },
  yearly: { unit: 'year', interval: 1 },
} as const satisfies Record<string, RepeatRule>

export type TaskItem = {
  id: string
  title: string
  note: string
  dueDate: Date | null
  reminderDate: Date | null
  listID: string
  isCompleted: boolean
  completedAt: Date | null
  isTrashed: boolean
  createdAt: Date
  order: number
  repeatRule: RepeatRule | null
  trashedAt: Date | null
}

export type TaskList = {
  id: string
  name: string
  isBuiltIn: boolean
  groupID: string | null
  order: number
  /** Customization (user lists only; null = default). "#RRGGBB" / SF Symbol. */
  colorHex: string | null
  symbol: string | null
  /**
   * When this project was finished; null while it is still running.
   *
   * Optional on the wire on purpose: a required field would make every
   * data.json written before it existed fail to decode. It doubles as the sort
   * key for the Completed projects view, the way TaskItem.completedAt does for
   * completed tasks.
   */
  completedAt: Date | null
}

/** Computed, never stored, so it can never disagree with the date. */
export function listIsCompleted(list: TaskList): boolean {
  return list.completedAt !== null
}

export type ListGroup = { id: string; name: string; isBuiltIn: boolean; order: number }

/** Entire persisted state. */
export type AppData = {
  tasks: TaskItem[]
  lists: TaskList[]
  groups: ListGroup[]
  /**
   * Sidebar order of the GTD block (4 built-in lists + Projects group) and of
   * the My Lists top level. null = default order; healed on read, never on
   * write (spec §5.7). The real macOS data.json omits both keys.
   */
  gtdOrder: string[] | null
  userOrder: string[] | null
}

/** Smart views are computed, never stored. */
export type SmartView = 'today' | 'calendar' | 'completed' | 'completedProjects' | 'trash'
/** Swift's CaseIterable order — this is the sidebar order. */
export const SMART_VIEWS: SmartView[] = ['today', 'calendar', 'completed', 'completedProjects', 'trash']

/** Sidebar selection: a smart view or a stored list. */
export type SidebarItem = { kind: 'smart'; view: SmartView } | { kind: 'list'; id: string }

/**
 * A move or create into a deadline-required list, held until the user picks a
 * deadline in the prompt. The `create` title is already trimmed when stored.
 */
export type PendingDeadline =
  | { kind: 'move'; taskIDs: string[]; target: string }
  | { kind: 'create'; title: string; target: string }

export function pendingDeadlineTarget(p: PendingDeadline): string {
  return p.target
}

/** Buckets for the Calendar smart view. Capitalised, unlike SmartView. */
export type CalendarBucket = 'Earlier' | 'Today' | 'Tomorrow' | 'Later'
export const CALENDAR_BUCKETS: CalendarBucket[] = ['Earlier', 'Today', 'Tomorrow', 'Later']

/** A renderable sidebar row: a stored list or a group. */
export type SidebarEntry = { kind: 'list'; list: TaskList } | { kind: 'group'; group: ListGroup }

export function sidebarEntryID(e: SidebarEntry): string {
  return e.kind === 'list' ? e.list.id : e.group.id
}

/**
 * BuiltIn.projectsGroup carries uppercase AA, and a decoded file may hold any
 * case, so id comparison is never a bare ===.
 */
export function sameID(a: string, b: string): boolean {
  return a.toUpperCase() === b.toUpperCase()
}

/** Swift compares SidebarItem by value (deleteList tests `selection == .list(id)`). */
export function sidebarItemsEqual(a: SidebarItem | null, b: SidebarItem | null): boolean {
  if (a === null || b === null) return a === b
  if (a.kind === 'smart' && b.kind === 'smart') return a.view === b.view
  if (a.kind === 'list' && b.kind === 'list') return sameID(a.id, b.id)
  return false
}

const UNIT_SINGULAR: Record<Exclude<RepeatUnit, 'weekday'>, string> = {
  day: 'Daily', week: 'Weekly', month: 'Monthly', year: 'Yearly',
}
const UNIT_PLURAL: Record<Exclude<RepeatUnit, 'weekday'>, string> = {
  day: 'days', week: 'weeks', month: 'months', year: 'years',
}

/**
 * The weekday case matches any interval and comes BEFORE the generic n cases,
 * so (weekday, 3) still prints "Weekdays". There is no "Every n weekdays".
 */
export function repeatDisplayName(r: RepeatRule): string {
  if (r.unit === 'weekday') return 'Weekdays'
  if (r.interval === 1) return UNIT_SINGULAR[r.unit]
  return `Every ${r.interval} ${UNIT_PLURAL[r.unit]}`
}

/**
 * A fresh seeded document. The names are load-bearing: search matches list
 * names, so "Next actions" is lowercase-a and "Waiting for..." has three
 * literal dots.
 */
export function seededAppData(): AppData {
  const list = (id: string, name: string, order: number): TaskList => ({
    id, name, isBuiltIn: true, groupID: null, order, colorHex: null, symbol: null,
    completedAt: null,
  })
  return {
    tasks: [],
    lists: [
      list(BuiltIn.inbox, 'Inbox', 0),
      list(BuiltIn.nextActions, 'Next actions', 1),
      list(BuiltIn.waitingFor, 'Waiting for...', 2),
      list(BuiltIn.someday, 'Someday', 3),
      list(BuiltIn.notes, 'Notes', 4),
    ],
    groups: [{ id: BuiltIn.projectsGroup, name: 'Projects', isBuiltIn: true, order: 0 }],
    gtdOrder: null,
    userOrder: null,
  }
}
