import { createContext, useCallback, useContext, useSyncExternalStore } from 'react'
import type { AppStore } from '../core/store'

/**
 * The only binding between React and the store.
 *
 * The store mutates synchronously and notifies subscribers; useSyncExternalStore
 * turns that into a render. Components read state and call methods — no
 * business logic lives above core/.
 */
export const StoreContext = createContext<AppStore | null>(null)

export function useStore(): AppStore {
  const store = useContext(StoreContext)
  if (store === null) throw new Error('useStore must be used inside a StoreProvider')
  return store
}

/**
 * Re-renders when the store notifies. The selector runs on every notification,
 * so it must return a value that compares stable-enough with Object.is —
 * prefer ids, counts and primitives over freshly-built arrays where it matters.
 */
export function useStoreValue<T>(select: (store: AppStore) => T): T {
  const store = useStore()
  const subscribe = useCallback((fn: () => void) => store.subscribe(fn), [store])
  const snapshot = useCallback(() => select(store), [store, select])
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

/**
 * Re-renders on every store change without comparing anything. Used by the
 * list views, which derive fresh arrays each render by design — the store is
 * the source of truth and the arrays are cheap.
 */
export function useStoreTick(): number {
  const store = useStore()
  const subscribe = useCallback((fn: () => void) => store.subscribe(fn), [store])
  return useSyncExternalStore(subscribe, () => tick(store), () => tick(store))
}

const ticks = new WeakMap<AppStore, { n: number; seen: unknown }>()

/** A monotonically increasing counter per store, bumped whenever the store's
 *  identity-bearing state changes. Cheap and stable under Object.is. */
function tick(store: AppStore): number {
  const state = ticks.get(store) ?? { n: 0, seen: null }
  const fingerprint = fingerprintOf(store)
  if (fingerprint !== state.seen) {
    state.n += 1
    state.seen = fingerprint
    ticks.set(store, state)
  }
  return state.n
}

function fingerprintOf(store: AppStore): string {
  // Cheap but sufficient: any mutation changes at least one of these.
  const t = store.data.tasks
  return [
    t.length,
    store.data.lists.length,
    store.data.groups.length,
    store.searchQuery,
    // Selection must be here: changing view is not a persisted mutation, and
    // without it the list never re-renders when you navigate.
    store.selection === null ? '' : store.selection.kind === 'smart' ? store.selection.view : store.selection.id,
    store.selectedTaskID ?? '',
    store.saveError?.message ?? '',
    store.pendingDeadline === null ? '' : store.pendingDeadline.kind,
    store.recentlyCompleted.size,
    // Field edits change no length, so fold the mutable fields in — weighted by
    // position, because a reorder is a permutation and an unweighted sum of
    // `order` is identical before and after it. That cost a silent
    // never-re-renders bug.
    t.reduce((acc, x, i) => acc + (i + 1) * (x.order + 1) + x.title.length + x.note.length +
      (x.isCompleted ? 1 : 0) + (x.isTrashed ? 2 : 0) +
      (x.dueDate?.getTime() ?? 0) + (x.reminderDate?.getTime() ?? 0) +
      (x.repeatRule === null ? 0 : x.repeatRule.interval + x.repeatRule.unit.length), 0),
    store.data.lists.reduce((acc, l) => acc + l.name.length + l.order + (l.colorHex?.length ?? 0) + (l.symbol?.length ?? 0), 0),
  ].join('|')
}
