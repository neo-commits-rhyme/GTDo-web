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
import { StaleWriteError } from '../core/ports'
import type { LoadResult, SnapshotMeta, StoragePort } from '../core/ports'

const DB_VERSION = 1
const DATA_KEY = 'appdata'
const STORES = { data: 'data', snapshots: 'snapshots', quarantine: 'quarantine', meta: 'meta' } as const
const CHANNEL_PREFIX = 'gtdo-writes:'

/**
 * The document plus the revision that stamps it.
 *
 * Two tabs is ordinary usage, and each holds its own full copy loaded at boot.
 * Every save rewrites the whole record, so without a revision the second tab to
 * save deletes everything the first one did, silently. The revision is what
 * makes that detectable — see persist().
 *
 * The value shape changed but the schema did not, so DB_VERSION stays at 1: a
 * bump would fire onversionchange in every open tab, which is a far bigger
 * event than reading one extra field. Records written before this existed are
 * bare strings and must keep loading — asRecord() is the only reader.
 */
type DataRecord = { raw: string; revision: number }

function asRecord(value: unknown): DataRecord | null {
  if (typeof value === 'string') return { raw: value, revision: 0 }
  if (typeof value !== 'object' || value === null) return null
  const record = value as Partial<DataRecord>
  if (typeof record.raw !== 'string') return null
  return { raw: record.raw, revision: typeof record.revision === 'number' ? record.revision : 0 }
}


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
  /**
   * The revision this tab's in-memory document came from. 0 means nothing has
   * been seen yet, which is also what an empty database reads as.
   */
  private seenRevision = 0
  private readonly channel: BroadcastChannel | null

  /**
   * Set by the store, to take the document another tab just wrote. It answers
   * whether it took it: only an adopted revision counts as seen, because a tab
   * that kept its own document has still not seen the other one's and must not
   * be allowed to write over it.
   */
  onExternalWrite: ((raw: string, revision: number) => boolean) | null = null

  constructor(private readonly name = 'gtdo') {
    // Feature-detected. Without a channel the compare-and-swap still refuses a
    // stale write; the tab just cannot learn about the other one's save.
    this.channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(`${CHANNEL_PREFIX}${name}`)
    if (this.channel !== null) this.channel.onmessage = (e: MessageEvent) => this.receive(e.data)
  }

  private receive(message: unknown): void {
    const record = asRecord(message)
    if (record === null || record.revision <= this.seenRevision) return
    if (this.onExternalWrite?.(record.raw, record.revision) === true) this.seenRevision = record.revision
  }

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
      const stored = await this.read<unknown>(STORES.data, DATA_KEY)
      if (stored === undefined) return { kind: 'absent' }
      const record = asRecord(stored)
      // A record of some shape nobody recognises is not absent, and seeding
      // over it would destroy whatever it is.
      if (record === null) throw new Error('the stored record has an unrecognised shape')
      this.seenRevision = record.revision
      return { kind: 'ok', raw: record.raw }
    } catch (e) {
      // The database is there but unreadable — corrupt, blocked, or evicted
      // mid-session. NOT the same as absent, and the store must not overwrite.
      return { kind: 'unreadable', error: e instanceof Error ? e : new Error(String(e)) }
    }
  }

  async persist(raw: string): Promise<void> {
    const db = await this.open()
    const tx = db.transaction([STORES.data, STORES.meta], 'readwrite')
    const data = tx.objectStore(STORES.data)
    // The check and the write share one transaction. Read the revision in a
    // separate one and another tab can land its save in between, which is
    // exactly the race this is here to close.
    const stored = asRecord(await promisify<unknown>(data.get(DATA_KEY) as IDBRequest<unknown>))
    const storedRevision = stored?.revision ?? 0
    if (storedRevision !== this.seenRevision) {
      tx.abort()
      throw new StaleWriteError(storedRevision, this.seenRevision)
    }

    const revision = storedRevision + 1
    const record: DataRecord = { raw, revision }
    data.put(record, DATA_KEY)
    tx.objectStore(STORES.meta).put(DB_VERSION, 'schemaVersion')
    await txDone(tx)
    this.seenRevision = revision
    this.channel?.postMessage(record)
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
