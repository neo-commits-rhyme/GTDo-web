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

/** djb2, xor variant, threaded rather than returned per value so that hashing a
 *  whole document allocates nothing. */
function step(h: number, n: number): number {
  return (((h << 5) + h) ^ n) | 0
}

/**
 * Hashes anything reachable from AppData — string, number, boolean, null, Date,
 * array, plain object — folding an array element's INDEX in before the element.
 * Every reorder is a permutation, so a position-blind hash is byte-identical
 * before and after one.
 *
 * Object keys are walked but not hashed: a field is identified by its position
 * in the walk, which is stable because these objects are mutated in place and
 * never rebuilt.
 */
function hashDeep(h: number, value: unknown): number {
  if (value === null || value === undefined) return step(h, 1)
  if (typeof value === 'string') {
    let acc = step(h, 2)
    for (let i = 0; i < value.length; i += 1) acc = step(acc, value.charCodeAt(i))
    return acc
  }
  // Both halves: the mixer works in int32 and a timestamp is far wider, so
  // truncating would merge instants exactly 2^32 ms apart.
  if (typeof value === 'number') return step(step(h, value | 0), Math.floor(value / 4294967296))
  if (typeof value === 'boolean') return step(h, value ? 3 : 4)
  if (value instanceof Date) return hashDeep(step(h, 5), value.getTime())
  if (Array.isArray(value)) {
    let acc = step(h, 6)
    for (let i = 0; i < value.length; i += 1) acc = hashDeep(step(acc, i), value[i])
    return acc
  }
  const record = value as Record<string, unknown>
  let acc = step(h, 7)
  for (const key in record) acc = hashDeep(acc, record[key])
  return acc
}

/**
 * A cheap value that changes whenever anything renderable changes.
 *
 * Four bugs came from this enumerating the document field by field: `selection`
 * was missing, so changing view never re-rendered; `order` was summed
 * unweighted, so a reorder — being a permutation — left the total identical;
 * `listID` was absent with `title` reduced to its length; and `gtdOrder` and
 * `userOrder` were never read at all, so no sidebar reorder ever reached the
 * screen even though the store had already changed.
 *
 * So the document is not enumerated any more. hashDeep walks store.data whole,
 * which covers every persisted field by construction and every field added
 * later for free. Only the view state, which is not part of the document, is
 * still listed by hand.
 *
 * The walk measures ~1.7x the hand-written sum it replaces and ~1/11th of
 * re-encoding the document — the other way to get the same guarantee, and far
 * too slow to run on every notification.
 */
function fingerprintOf(store: AppStore): string {
  return [
    store.searchQuery,
    store.selection === null
      ? ''
      : store.selection.kind === 'smart' ? store.selection.view : store.selection.id,
    store.selectedTaskID ?? '',
    store.saveError?.message ?? '',
    store.pendingDeadline === null ? '' : store.pendingDeadline.kind,
    store.recentlyCompleted.size,
    // Both halves of the hold, because recentlyCompleted is pins-only: a window
    // left holding just a recurrence spawn released with the pin count already
    // at zero, so nothing here changed and the spawn never appeared.
    store.holdIsEmpty,
    hashDeep(5381, store.data),
  ].join('|')
}
