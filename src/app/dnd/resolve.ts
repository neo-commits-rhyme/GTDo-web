/**
 * What a drop means, as pure functions over ids and indices.
 *
 * Written without React or dnd-kit types on purpose: this is where the index
 * arithmetic bites — the store's move methods take SwiftUI onMove semantics,
 * where the destination is an index into the PRE-removal array — and that is
 * far easier to get right, and to test, without a DOM in the way.
 */

export type DropTarget =
  | { kind: 'reorder-task'; listID: string; from: number; to: number }
  | { kind: 'move-task'; taskID: string; listID: string }
  | { kind: 'reorder-sidebar'; scope: 'gtd' | 'user'; from: number; to: number }
  | { kind: 'reorder-in-group'; groupID: string; from: number; to: number }
  /** Dropped on the Today row: date it today rather than move it. */
  | { kind: 'date-today'; taskID: string }
  /** Dropped on the Trash row. */
  | { kind: 'trash-task'; taskID: string }
  /** Dropped on the Projects header: turn the task into a project. */
  | { kind: 'convert-to-project'; taskID: string }
  | null

/** Draggable and droppable ids are namespaced so a drop is unambiguous. */
export const dragID = {
  task: (id: string) => `task:${id}`,
  listDrop: (id: string) => `listdrop:${id}`,
  sidebar: (scope: 'gtd' | 'user', id: string) => `sidebar:${scope}:${id}`,
  /** A smart view as a drop target. Only today and trash accept anything. */
  smartDrop: (view: string) => `smartdrop:${view}`,
  /** The Projects section header. */
  projectsHeaderDrop: () => 'projectsheader',
  groupMember: (groupID: string, id: string) => `member:${groupID}:${id}`,
}

export type DropContext = {
  /** Ordered ids of the tasks currently shown in the active list. */
  taskOrder: string[]
  /** The list those tasks belong to. */
  listID: string | null
  /** Ordered ids of each sidebar scope. */
  gtdOrder: string[]
  userOrder: string[]
  /** Ordered member ids per group. */
  groupMembers: Record<string, string[]>
  /**
   * False while the active list is sorted by date. A reorder redistributes the
   * list's stored `order` slots to match the DISPLAY sequence, so one drag
   * under a date sort would overwrite the hand-dragged arrangement with date
   * order — and in Next actions it would do it to tasks living in projects.
   * Moving a task to another list stays allowed; only reordering is refused.
   */
  reorderable: boolean
}

/**
 * Converts a plain "landed at index `to`" into the destination the store's
 * move methods expect. Moving item 0 down one is destination 2, not 1, because
 * the index is resolved before the item is removed.
 */
export function toOnMoveDestination(from: number, to: number): number {
  return to > from ? to + 1 : to
}

function parse(id: string): { kind: string; parts: string[] } {
  const parts = id.split(':')
  return { kind: parts[0] ?? '', parts: parts.slice(1) }
}

export function resolveDrop(active: string, over: string | null, ctx: DropContext): DropTarget {
  // A drop that lands on nothing is a no-op, never a move to the end.
  if (over === null || over === active) return null

  const a = parse(active)
  const o = parse(over)

  if (a.kind === 'task') {
    const taskID = a.parts[0]!

    // Onto a smart view. Today dates the task; Trash trashes it. Calendar,
    // Completed and Completed projects are computed from fields a drop cannot
    // meaningfully set, so they refuse.
    if (o.kind === 'smartdrop') {
      if (o.parts[0] === 'today') return { kind: 'date-today', taskID }
      if (o.parts[0] === 'trash') return { kind: 'trash-task', taskID }
      return null
    }

    // Onto the Projects header: the task becomes a project of its own.
    if (o.kind === 'projectsheader') return { kind: 'convert-to-project', taskID }

    // Onto a sidebar list: a move, not a reorder.
    if (o.kind === 'listdrop') {
      const listID = o.parts[0]!
      // Dropping a task back on the list it already lives in changes nothing.
      if (ctx.listID !== null && listID.toUpperCase() === ctx.listID.toUpperCase()) return null
      return { kind: 'move-task', taskID, listID }
    }

    // Onto another task: a reorder, and only within the list on screen —
    // crossing lists is a move, which arrives as a listdrop instead.
    if (o.kind === 'task') {
      if (ctx.listID === null || !ctx.reorderable) return null
      const from = ctx.taskOrder.indexOf(taskID)
      const to = ctx.taskOrder.indexOf(o.parts[0]!)
      if (from < 0 || to < 0 || from === to) return null
      return { kind: 'reorder-task', listID: ctx.listID, from, to: toOnMoveDestination(from, to) }
    }
    return null
  }

  if (a.kind === 'sidebar' && o.kind === 'sidebar') {
    const scope = a.parts[0] as 'gtd' | 'user'
    // Entries only reorder within their own section.
    if (o.parts[0] !== scope) return null
    const order = scope === 'gtd' ? ctx.gtdOrder : ctx.userOrder
    const from = order.indexOf(a.parts[1]!)
    const to = order.indexOf(o.parts[1]!)
    if (from < 0 || to < 0 || from === to) return null
    return { kind: 'reorder-sidebar', scope, from, to: toOnMoveDestination(from, to) }
  }

  if (a.kind === 'member' && o.kind === 'member') {
    const groupID = a.parts[0]!
    if (o.parts[0] !== groupID) return null
    const order = ctx.groupMembers[groupID] ?? []
    const from = order.indexOf(a.parts[1]!)
    const to = order.indexOf(o.parts[1]!)
    if (from < 0 || to < 0 || from === to) return null
    return { kind: 'reorder-in-group', groupID, from, to: toOnMoveDestination(from, to) }
  }

  return null
}
