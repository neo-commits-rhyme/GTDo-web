/**
 * The adapter the app actually runs on.
 *
 * Four object stores:
 * - `data`       one record, the whole AppData document
 * - `snapshots`  rotating backups, keyed by UTC stamp
 * - `quarantine` bytes that failed to decode — never deleted
 * - `meta`       schema version
 *
 * IndexedDB was chosen over localStorage on measured quota (spec §11 /
 * docs/assumptions.md): 5.00 GiB Chromium, 10.00 GiB Firefox, 0.98 GiB WebKit,
 * against localStorage's ~5 MB shared with the snapshot history.
 */

import { keepSet, snapshotStamp } from '../core/snapshotPolicy'
import type { LoadResult, SnapshotMeta, StoragePort } from '../core/ports'

const DB_VERSION = 1
const DATA_KEY = 'appdata'
const STORES = { data: 'data', snapshots: 'snapshots', quarantine: 'quarantine', meta: 'meta' } as const

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
  })
}

export class IndexedDbAdapter implements StoragePort {
  private db: Promise<IDBDatabase> | null = null

  constructor(private readonly name = 'gtdo') {}

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(this.name, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        for (const store of Object.values(STORES)) {
          if (!db.objectStoreNames.contains(store)) db.createObjectStore(store)
        }
      }
      request.onsuccess = () => {
        const db = request.result
        // A version change from another tab invalidates this handle.
        db.onversionchange = () => { db.close(); this.db = null }
        resolve(db)
      }
      request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
      request.onblocked = () => reject(new Error('IndexedDB open blocked by another tab'))
    })
    return this.db
  }

  private async read<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
    const db = await this.open()
    const tx = db.transaction(store, 'readonly')
    const value = await promisify<T | undefined>(tx.objectStore(store).get(key) as IDBRequest<T | undefined>)
    await txDone(tx)
    return value
  }

  private async write(store: string, key: IDBValidKey, value: unknown): Promise<void> {
    const db = await this.open()
    const tx = db.transaction(store, 'readwrite')
    tx.objectStore(store).put(value, key)
    await txDone(tx)
  }

  async load(): Promise<LoadResult> {
    try {
      const raw = await this.read<string>(STORES.data, DATA_KEY)
      return raw === undefined ? { kind: 'absent' } : { kind: 'ok', raw }
    } catch (e) {
      // The database is there but unreadable — corrupt, blocked, or evicted
      // mid-session. NOT the same as absent, and the store must not overwrite.
      return { kind: 'unreadable', error: e instanceof Error ? e : new Error(String(e)) }
    }
  }

  async persist(raw: string): Promise<void> {
    await this.write(STORES.data, DATA_KEY, raw)
    await this.write(STORES.meta, 'schemaVersion', DB_VERSION)
  }

  async writeSnapshot(raw: string, at: Date): Promise<boolean> {
    try {
      const id = snapshotStamp(at)
      // The first snapshot of a stamp wins, mirroring `if !fm.fileExists`.
      const existing = await this.read<string>(STORES.snapshots, id)
      if (existing === undefined) await this.write(STORES.snapshots, id, raw)
      await this.prune()
      return true
    } catch {
      // Best-effort: a failed backup must never block a save, and reporting
      // false means the store retries rather than throttling it away.
      return false
    }
  }

  async listSnapshots(): Promise<SnapshotMeta[]> {
    const db = await this.open()
    const tx = db.transaction(STORES.snapshots, 'readonly')
    const store = tx.objectStore(STORES.snapshots)
    const keys = await promisify(store.getAllKeys())
    const values = await promisify(store.getAll())
    await txDone(tx)
    return keys
      .map((key, i) => ({
        id: String(key),
        at: new Date(0),
        bytes: typeof values[i] === 'string' ? (values[i] as string).length : 0,
      }))
      .sort((a, b) => (a.id > b.id ? -1 : a.id < b.id ? 1 : 0))
  }

  async readSnapshot(id: string): Promise<string> {
    const raw = await this.read<string>(STORES.snapshots, id)
    if (raw === undefined) throw new Error(`no snapshot ${id}`)
    return raw
  }

  async quarantine(raw: string, reason: string): Promise<void> {
    // Keyed by insertion count so a second failure never overwrites the first.
    const db = await this.open()
    const tx = db.transaction(STORES.quarantine, 'readwrite')
    const store = tx.objectStore(STORES.quarantine)
    const count = await promisify(store.count())
    store.put({ raw, reason }, `quarantine-${count}`)
    await txDone(tx)
  }

  private async prune(): Promise<void> {
    const all = await this.listSnapshots()
    const keep = keepSet(all)
    const stale = all.filter((s) => !keep.has(s.id))
    if (stale.length === 0) return
    const db = await this.open()
    const tx = db.transaction(STORES.snapshots, 'readwrite')
    for (const s of stale) tx.objectStore(STORES.snapshots).delete(s.id)
    await txDone(tx)
  }
}

/**
 * Ask the browser not to evict this origin.
 *
 * MUST stay fire-and-forget. Measured (docs/assumptions.md §3): Firefox never
 * settles this promise — it raises a permission prompt — while Chromium and
 * WebKit resolve false in an unengaged context. Awaiting it hangs the caller,
 * and denial is the normal case, so nothing may depend on it succeeding.
 */
export function requestPersistentStorage(onResult?: (granted: boolean) => void): void {
  if (typeof navigator === 'undefined' || navigator.storage?.persist === undefined) return
  void navigator.storage.persist().then(
    (granted) => onResult?.(granted),
    () => onResult?.(false),
  )
}
