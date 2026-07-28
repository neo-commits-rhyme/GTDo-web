/**
 * Search. Port of Sources/GTDo/Store/AppStore+Search.swift.
 *
 * Deliberately NOT filtered by the completion hold: search is a different
 * screen from the one you were tapping down, and a result that lies about its
 * completion state would be worse than one that reflows.
 */

import type { AppData, TaskItem } from './models'
import { sameID } from './models'

/**
 * How much of the store a search may reach. The default everywhere is
 * `includeCompleted`: completed tasks are results, trashed tasks are not.
 */
export type SearchScope = 'activeOnly' | 'includeCompleted' | 'includeTrashed'
export const SEARCH_SCOPES: SearchScope[] = ['activeOnly', 'includeCompleted', 'includeTrashed']

export function searchScopeLabel(scope: SearchScope): string {
  switch (scope) {
    case 'activeOnly': return 'Active'
    case 'includeCompleted': return 'Completed'
    case 'includeTrashed': return 'Trash'
  }
}

/** Case- and diacritic-insensitive containment, matching
 *  localizedCaseInsensitiveContains closely enough for search. */
function contains(haystack: string, needle: string): boolean {
  return haystack.localeCompare !== undefined
    ? normalize(haystack).includes(normalize(needle))
    : haystack.toLowerCase().includes(needle.toLowerCase())
}

function normalize(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

export type SearchOptions = {
  scope?: SearchScope
  /** Restrict to one list — drives the "This list / All lists" scope. */
  listID?: string | null
  /**
   * Off by default. A sidebar search field that is always visible would
   * otherwise return an entire built-in list on the first keystroke, because
   * "Inbox", "Notes" and friends match almost anything short.
   */
  matchListNames?: boolean
}

export function searchResults(data: AppData, query: string, opts: SearchOptions = {}): TaskItem[] {
  const q = query.trim()
  if (q === '') return [] // whitespace-only queries match nothing

  const scope = opts.scope ?? 'includeCompleted'
  const listID = opts.listID ?? null

  // Resolved once per search, not once per task.
  const matchingLists = new Set(
    opts.matchListNames === true
      ? data.lists.filter((l) => contains(l.name, q)).map((l) => l.id.toUpperCase())
      : [],
  )

  return data.tasks
    .filter((t) => {
      switch (scope) {
        case 'activeOnly': return !t.isTrashed && !t.isCompleted
        case 'includeCompleted': return !t.isTrashed
        case 'includeTrashed': return true
      }
    })
    .filter((t) => listID === null || sameID(t.listID, listID))
    .filter(
      (t) =>
        contains(t.title, q) || contains(t.note, q) || matchingLists.has(t.listID.toUpperCase()),
    )
    .sort((a, b) => a.order - b.order)
}
