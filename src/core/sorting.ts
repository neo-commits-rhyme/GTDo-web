/**
 * Ordering a list's rows. Port of Sources/GTDo/Store/AppStore+Sorting.swift.
 *
 * Pure: the sort is a view over the stored `order`, never a mutation of it, so
 * switching back to 'manual' returns the hand-dragged arrangement exactly as it
 * was.
 */

import type { TaskItem } from './models'

export type ListSort = 'manual' | 'dueDate' | 'dateAdded'

export const LIST_SORTS: ListSort[] = ['manual', 'dueDate', 'dateAdded']

export const LIST_SORT_LABELS: Record<ListSort, string> = {
  manual: 'Manual',
  dueDate: 'Due date',
  dateAdded: 'Date added',
}

/** Manual is the only sort that leaves rows draggable. */
export function allowsReordering(sort: ListSort): boolean {
  return sort === 'manual'
}

/**
 * Rows in the chosen order.
 *
 * Every sort falls back to `order` on a tie. That is not decoration:
 * setDueDate pins every deadline to local noon, so all same-day tasks compare
 * equal, and an import stamps a whole file with one createdAt. Array.sort is
 * stable in modern engines, but the input is already order-sorted only by
 * accident of the caller — making the tie-break explicit keeps the comparator
 * a total order, which is what the row animations key off.
 */
export function sortTasks(tasks: TaskItem[], sort: ListSort): TaskItem[] {
  const byOrder = (a: TaskItem, b: TaskItem) => a.order - b.order
  switch (sort) {
    case 'manual':
      return [...tasks].sort(byOrder)
    case 'dateAdded':
      return [...tasks].sort((a, b) => {
        const d = a.createdAt.getTime() - b.createdAt.getTime()
        return d !== 0 ? d : byOrder(a, b)
      })
    case 'dueDate':
      // Undated last. "What is due soonest" is not answered by a screenful of
      // rows that have no date at all.
      return [...tasks].sort((a, b) => {
        if (a.dueDate === null && b.dueDate === null) return byOrder(a, b)
        if (a.dueDate === null) return 1
        if (b.dueDate === null) return -1
        const d = a.dueDate.getTime() - b.dueDate.getTime()
        return d !== 0 ? d : byOrder(a, b)
      })
  }
}
