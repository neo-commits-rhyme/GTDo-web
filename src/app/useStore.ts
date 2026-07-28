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

/** djb2. Cheap, and unlike a length it actually changes when the content does. */
function hash(text: string): number {
  let h = 5381
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return h
}

/**
 * A cheap value that changes whenever anything renderable changes.
 *
 * Three bugs came from this being an under-specified sum: `selection` was
 * missing, so changing view never re-rendered; `order` was summed unweighted,
 * so a reorder — being a permutation — left the total identical; and `listID`
 * was absent with `title` reduced to its length, so moving a task between
 * lists, or renaming it to a same-length title, did nothing.
 *
 * Hashing the mutable fields by position kills that whole class.
 */
function fingerprintOf(store: AppStore): string {
  const t = store.data.tasks
  return [
    t.length,
    store.data.lists.length,
    store.data.groups.length,
    store.searchQuery,
    store.selection === null
      ? ''
      : store.selection.kind === 'smart' ? store.selection.view : store.selection.id,
    store.selectedTaskID ?? '',
    store.saveError?.message ?? '',
    store.pendingDeadline === null ? '' : store.pendingDeadline.kind,
    store.recentlyCompleted.size,
    t.reduce(
      (acc, x, i) =>
        (acc +
          (i + 1) *
            (x.order + 1 + hash(x.id) + hash(x.listID) + hash(x.title) + hash(x.note) +
              (x.isCompleted ? 1 : 0) + (x.isTrashed ? 2 : 0) +
              (x.dueDate?.getTime() ?? 0) + (x.reminderDate?.getTime() ?? 0) +
              (x.completedAt?.getTime() ?? 0) +
              (x.repeatRule === null ? 0 : x.repeatRule.interval + hash(x.repeatRule.unit)))) |
        0,
      0,
    ),
    store.data.lists.reduce(
      (acc, l) => (acc + hash(l.id) + hash(l.name) + l.order + hash(l.colorHex ?? '') + hash(l.symbol ?? '')) | 0,
      0,
    ),
    store.data.groups.reduce((acc, g) => (acc + hash(g.id) + hash(g.name) + g.order) | 0, 0),
  ].join('|')
}
