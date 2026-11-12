import { useSyncExternalStore } from 'react'
import {
  CloudBusyError, CloudSync, initialSyncState, type CloudKV, type SyncState, type SyncStateStore,
} from '../../core/cloudSync'
import { encodeAppData, decodeAppData } from '../../core/codec'
import type { AppStore } from '../../core/store'

/**
 * Decides WHEN to sync with Telegram's cloud storage; core/cloudSync decides
 * what a sync does. One runner per page — there is one store and one cloud.
 */

export type SyncStatus = {
  /** Whether this session can sync at all: inside Telegram, on a client with cloud storage. */
  available: boolean
  phase: 'idle' | 'syncing' | 'error'
  lastSyncedAt: number | null
  error: string | null
  /** The cloud copy stayed unreadable after several tries; offer to upload this device's over it. */
  incomplete: boolean
}

const OFF: SyncStatus = { available: false, phase: 'idle', lastSyncedAt: null, error: null, incomplete: false }

const STATE_KEY = 'gtdo.sync'
const DEVICE_KEY = 'gtdo.device'
/** Long enough to coalesce a burst of edits, short enough to land before the app is closed. */
const PUSH_DELAY_MS = 1200
const BUSY_RETRY_MS = 3000
const BUSY_RETRIES = 3
/** An undo offer lasts eight seconds, and the store declines to adopt under one. */
const DECLINED_RETRY_MS = 9000

const localState: SyncStateStore = {
  load(): SyncState {
    try {
      const s = JSON.parse(localStorage.getItem(STATE_KEY) ?? 'null') as Partial<SyncState> | null
      if (s !== null && typeof s.n === 'number') {
        return {
          rev: typeof s.rev === 'number' ? s.rev : null,
          dirtyAt: typeof s.dirtyAt === 'number' ? s.dirtyAt : null,
          n: s.n,
        }
      }
    } catch {
      // Unreadable state is the same as none: this device syncs as if for the first time.
    }
    return { ...initialSyncState }
  },
  save(state) {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(state))
    } catch {
      // Without it the next launch re-reads the cloud, which is safe.
    }
  },
}

function deviceID(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY)
    if (id === null) {
      id = crypto.randomUUID().slice(0, 8)
      localStorage.setItem(DEVICE_KEY, id)
    }
    return id
  } catch {
    return 'device'
  }
}

/** Nothing the user made: no tasks, and only the lists and groups every document is seeded with. */
function isEmptyDocument(raw: string): boolean {
  const d = decodeAppData(raw)
  return d.tasks.length === 0 && d.lists.every((l) => l.isBuiltIn) && d.groups.every((g) => g.isBuiltIn)
}

let status: SyncStatus = OFF
const listeners = new Set<() => void>()
let run: ((force?: 'push') => Promise<void>) | null = null

function setStatus(patch: Partial<SyncStatus>): void {
  status = { ...status, ...patch }
  for (const fn of listeners) fn()
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => listeners.delete(fn) },
    () => status,
    () => status,
  )
}

/** `force: 'push'` uploads this device's document over whatever the cloud holds. */
export function syncNow(force?: 'push'): void {
  void run?.(force)
}

/**
 * Starts syncing `store` through `kv` and resolves once the first attempt has
 * settled either way — so launch-time housekeeping can wait for the cloud's
 * document instead of editing a stale one and then outranking it.
 */
export function startSync(store: AppStore, kv: CloudKV, onLocalEdit: () => void): Promise<void> {
  const engine = new CloudSync({ kv, state: localState, device: deviceID(), now: () => Date.now(), isEmpty: isEmptyDocument })
  let running = false
  let again: { force?: 'push' } | null = null
  let pushTimer: number | undefined
  let retryTimer: number | undefined
  let busyCount = 0

  const retryIn = (ms: number) => {
    window.clearTimeout(retryTimer)
    retryTimer = window.setTimeout(() => { void attempt() }, ms)
  }

  const attempt = async (force?: 'push'): Promise<void> => {
    if (running) {
      again = { force: force ?? again?.force }
      return
    }
    running = true
    window.clearTimeout(pushTimer)
    pushTimer = undefined
    window.clearTimeout(retryTimer)
    setStatus({ phase: 'syncing' })
    try {
      const result = await engine.sync(() => encodeAppData(store.data), force)
      if (result.action === 'pulled') {
        if (store.adoptRemote(result.raw)) result.commit()
        // Declined — an undo is on offer, or a save failed. Not committed, so
        // the same document is offered again once that has passed.
        else retryIn(DECLINED_RETRY_MS)
      }
      busyCount = 0
      setStatus({ phase: 'idle', lastSyncedAt: Date.now(), error: null, incomplete: false })
    } catch (e) {
      busyCount += 1
      if (e instanceof CloudBusyError && busyCount <= BUSY_RETRIES) {
        // Most likely another device mid-save: look again shortly.
        retryIn(BUSY_RETRY_MS)
      } else {
        busyCount = 0
        setStatus({
          phase: 'error',
          incomplete: e instanceof CloudBusyError,
          error: e instanceof Error ? e.message : 'Sync failed.',
        })
      }
    } finally {
      running = false
      if (again !== null) {
        const next = again
        again = null
        void attempt(next.force)
      }
    }
  }

  store.onDocumentChange = () => {
    engine.markDirty()
    onLocalEdit()
    window.clearTimeout(pushTimer)
    pushTimer = window.setTimeout(() => { void attempt() }, PUSH_DELAY_MS)
  }

  document.addEventListener('visibilitychange', () => {
    // Coming back: another device may have saved. Leaving with a save still
    // queued: send it now rather than when (if) the timer gets to run.
    if (document.visibilityState === 'visible' || pushTimer !== undefined) void attempt()
  })

  status = { ...OFF, available: true }
  run = attempt
  return attempt()
}
