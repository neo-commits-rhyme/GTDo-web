/**
 * Sidebar ordering. Port of Sources/GTDo/Store/AppStore+Reorder.swift.
 *
 * Healing is READ-TIME ONLY: a stale stored order is repaired on every read but
 * never written back until an explicit reorder happens. That is why both keys
 * must tolerate being absent — the real macOS data.json omits them entirely.
 */

import { BuiltIn, sameID, type ListGroup, type TaskList } from './models'

/**
 * The GTD block in canonical order: the four reorderable built-in lists plus
 * the Projects group. Inbox is deliberately NOT part of it.
 */
export const GTD_BLOCK_IDS: readonly string[] = [
  BuiltIn.nextActions,
  BuiltIn.waitingFor,
  BuiltIn.projectsGroup,
  BuiltIn.someday,
  BuiltIn.notes,
]

export const has = (ids: readonly string[], id: string) => ids.some((x) => sameID(x, id))

/** Stored order with stale ids dropped and missing ones appended in canonical
 *  order. Pure — it never mutates the data it reads. */
export function healOrder(stored: string[] | null, canonical: readonly string[]): string[] {
  const order = (stored ?? [...canonical]).filter((id) => has(canonical, id))
  for (const id of canonical) if (!has(order, id)) order.push(id)
  return order
}

export type SidebarEntry =
  | { kind: 'list'; list: TaskList }
  | { kind: 'group'; group: ListGroup }

/**
 * Entries that live in gtdOrder but are drawn as their own sidebar sections.
 *
 * They stay in the stored order rather than being removed from it: gtdOrder is
 * shared with the macOS app and the iPhone, and dropping an id here would have
 * every other client heal it back to the end of its own block. This is a
 * rendering split, not a data one.
 */
export const GTD_OWN_SECTION_IDS: readonly string[] = [BuiltIn.projectsGroup, BuiltIn.notes]

export const entryID = (e: SidebarEntry): string => (e.kind === 'list' ? e.list.id : e.group.id)

export function entryFor(
  id: string,
  lists: TaskList[],
  groups: ListGroup[],
): SidebarEntry | null {
  const list = lists.find((l) => sameID(l.id, id))
  if (list !== undefined) return { kind: 'list', list }
  const group = groups.find((g) => sameID(g.id, id))
  if (group !== undefined) return { kind: 'group', group }
  return null
}

/**
 * SwiftUI `onMove` semantics: `destination` is an insertion index into the
 * PRE-removal array, so moving item 0 down one requires destination 2.
 */
export function moveWithinArray<T>(items: T[], from: number[], destination: number): T[] {
  const moving = from
    .slice()
    .sort((a, b) => a - b)
    .map((i) => items[i])
    .filter((x): x is T => x !== undefined)
  const movingSet = new Set(moving)
  const remaining = items.filter((x) => !movingSet.has(x))
  const removedBefore = from.filter((i) => i < destination).length
  const insertAt = Math.max(0, Math.min(destination - removedBefore, remaining.length))
  remaining.splice(insertAt, 0, ...moving)
  return remaining
}
