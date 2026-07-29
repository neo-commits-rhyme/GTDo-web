/**
 * Where each list's chosen sort is remembered.
 *
 * localStorage, not data.json: the sort is a view preference, and data.json is
 * shared with the macOS and iPhone apps through a fixed-key encoder — a new
 * field there is dropped on the next round-trip, silently resetting the choice.
 * This mirrors ListSortPreference.swift, which keeps it in UserDefaults for the
 * same reason.
 *
 * Consequence, by design: the sort does not cross tabs. adoptExternalWrite
 * carries the document only, so two tabs can show one list differently.
 */

import { useCallback, useState } from 'react'
import type { ListSort } from '../core/sorting'

export const LIST_SORT_PREFIX = 'gtdo.listSort.'

const keyFor = (listID: string) => LIST_SORT_PREFIX + listID

const isSort = (v: string | null): v is ListSort =>
  v === 'manual' || v === 'dueDate' || v === 'dateAdded'

export function listSortFor(listID: string): ListSort {
  try {
    const raw = localStorage.getItem(keyFor(listID))
    return isSort(raw) ? raw : 'manual'
  } catch {
    return 'manual' // private mode, disabled storage
  }
}

/** Manual is the default, so choosing it removes the key rather than storing
 *  it — an untouched list leaves no trace at all. */
export function setListSort(listID: string, sort: ListSort): void {
  try {
    if (sort === 'manual') localStorage.removeItem(keyFor(listID))
    else localStorage.setItem(keyFor(listID), sort)
  } catch {
    /* nothing to do: the sort simply will not persist */
  }
}

/** Drop keys for lists that no longer exist. Called at launch: nothing removes
 *  a preference when its list is deleted, and a recycled id would otherwise
 *  inherit a stranger's sort. */
export function pruneListSorts(liveListIDs: string[]): void {
  try {
    const live = new Set(liveListIDs.map(keyFor))
    const stale: string[] = []
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i)
      if (k !== null && k.startsWith(LIST_SORT_PREFIX) && !live.has(k)) stale.push(k)
    }
    for (const k of stale) localStorage.removeItem(k)
  } catch {
    /* nothing to prune if storage is unavailable */
  }
}

/** The sort of one list, as component state so a change re-renders the view. */
export function useListSort(listID: string | null): [ListSort, (s: ListSort) => void] {
  const [sort, setSortState] = useState<ListSort>(
    () => (listID === null ? 'manual' : listSortFor(listID)),
  )
  const [seenID, setSeenID] = useState(listID)
  // Navigating to another list re-reads that list's own preference, without an
  // effect: deriving during render avoids a frame showing the previous sort.
  if (seenID !== listID) {
    setSeenID(listID)
    setSortState(listID === null ? 'manual' : listSortFor(listID))
  }

  const setSort = useCallback((next: ListSort) => {
    setSortState(next)
    if (listID !== null) setListSort(listID, next)
  }, [listID])

  return [sort, setSort]
}
