/**
 * Smart views and per-list queries. Port of AppStore.swift:227-299.
 *
 * Pure functions over a context, so the store stays a thin facade and every
 * view rule is testable without constructing a store.
 *
 * The sort key differs per view and that is deliberate, not an accident of the
 * original: `calendarTasks` sorts by dueDate, everything else by `order`, and
 * the Completed views start from the raw task array rather than the
 * order-sorted one — so they have no stable secondary order to rely on.
 */

import { addDays, startOfDay } from './calendar'
import type { AppData, CalendarBucket, TaskItem, TaskList } from './models'
import { sameID } from './models'

export type QueryContext = {
  data: AppData
  /** Local midnight. */
  today: Date
  /** What a view should render, honouring the completion hold. */
  rendersCompleted(t: TaskItem): boolean
  /** The completion date a view should sort and label by. */
  renderedCompletionDate(t: TaskItem): Date | null
  /** A task spawned inside an open hold window; hidden until it closes. */
  isHeldHidden(t: TaskItem): boolean
}

const dayOf = (d: Date) => startOfDay(d).getTime()

/** Active = not trashed, not held out of sight. Ordered by `order`, NOT by
 *  createdAt — the two coincide only because addTask assigns max+1. Completed
 *  tasks are included; each view filters them with rendersCompleted. */
export function activeTasks(c: QueryContext): TaskItem[] {
  return c.data.tasks
    .filter((t) => !t.isTrashed && !c.isHeldHidden(t))
    .sort((a, b) => a.order - b.order)
}

export function todayTasks(c: QueryContext): TaskItem[] {
  const today = dayOf(c.today)
  return activeTasks(c).filter(
    (t) => !c.rendersCompleted(t) && t.dueDate !== null && dayOf(t.dueDate) === today,
  )
}

/** A separate list from todayTasks, not merged into it. Sorted by `order`,
 *  not by how overdue the task is. */
export function overdueTasks(c: QueryContext): TaskItem[] {
  const today = dayOf(c.today)
  return activeTasks(c).filter(
    (t) => !c.rendersCompleted(t) && t.dueDate !== null && dayOf(t.dueDate) < today,
  )
}

/** The one view sorted by dueDate. All deadlines sit at noon, so ties break on
 *  the order-sorted input via a stable sort. */
export function calendarTasks(c: QueryContext, bucket: CalendarBucket): TaskItem[] {
  const scheduled = activeTasks(c)
    .filter((t) => !c.rendersCompleted(t) && t.dueDate !== null)
    .sort((a, b) => a.dueDate!.getTime() - b.dueDate!.getTime())

  const today = dayOf(c.today)
  const tomorrow = dayOf(addDays(c.today, 1))

  return scheduled.filter((t) => {
    const due = dayOf(t.dueDate!)
    switch (bucket) {
      case 'Earlier': return due < today
      case 'Today': return due === today
      case 'Tomorrow': return due === tomorrow
      case 'Later': return due > tomorrow
    }
  })
}

/** Completed-but-dateless tasks sort to the very bottom of every descending
 *  Completed list. */
function completionSortKey(c: QueryContext, t: TaskItem): number {
  return c.renderedCompletionDate(t)?.getTime() ?? -Infinity
}

function byCompletionNewestFirst(c: QueryContext) {
  return (a: TaskItem, b: TaskItem) => completionSortKey(c, b) - completionSortKey(c, a)
}

/** Starts from the raw task array, NOT from activeTasks — so it is not
 *  order-sorted first and has no stable secondary order. */
export function completedTasks(c: QueryContext): TaskItem[] {
  return c.data.tasks
    .filter((t) => c.rendersCompleted(t) && !t.isTrashed && !c.isHeldHidden(t))
    .sort(byCompletionNewestFirst(c))
}

/**
 * The "Completed" tail of the Today view. Filters on DUE date, not completion
 * date: a task completed today but due next week is excluded, and one due last
 * month completed months ago is included. Undated completions never appear.
 */
export function todayCompletedTasks(c: QueryContext): TaskItem[] {
  const today = dayOf(c.today)
  return c.data.tasks
    .filter((t) => c.rendersCompleted(t) && !t.isTrashed && !c.isHeldHidden(t))
    .filter((t) => t.dueDate !== null && dayOf(t.dueDate) <= today)
    .sort(byCompletionNewestFirst(c))
}

/** Unaffected by the completion hold and by completion state; includes
 *  completed trashed tasks. */
export function trashedTasks(c: QueryContext): TaskItem[] {
  return c.data.tasks.filter((t) => t.isTrashed).sort((a, b) => a.order - b.order)
}

/** The source of truth for the drag-reorder slot set and the review queue, so
 *  hold pins and suppressions change which tasks participate in a reorder. */
export function incompleteTasks(c: QueryContext, listID: string): TaskItem[] {
  return activeTasks(c).filter((t) => sameID(t.listID, listID) && !c.rendersCompleted(t))
}

export function completedTasksIn(c: QueryContext, listID: string): TaskItem[] {
  return c.data.tasks
    .filter(
      (t) =>
        sameID(t.listID, listID) && c.rendersCompleted(t) && !t.isTrashed && !c.isHeldHidden(t),
    )
    .sort(byCompletionNewestFirst(c))
}

/** All stored lists a task can move to, current list excluded. Returned
 *  UNSORTED, in raw insertion order. Passing null excludes nothing. */
export function moveTargets(c: QueryContext, listID: string | null): TaskList[] {
  return c.data.lists.filter((l) => listID === null || !sameID(l.id, listID))
}
