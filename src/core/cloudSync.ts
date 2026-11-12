/**
 * Mirrors a data.json document into a small key-value store with Telegram
 * CloudStorage's limits: 1024 keys, values of at most 4096 characters, keys
 * made of [A-Za-z0-9_-].
 *
 * This module never interprets the document beyond "an object whose `tasks`
 * is an array of objects carrying an `id`" — it takes and returns the encoded
 * text, so core/codec stays the one implementation of the wire format.
 *
 * Layout. Every value is ASCII-only JSON text cut into pieces of at most
 * CLOUD_CHUNK characters:
 *
 *   ft_meta       CloudMeta
 *   ft_h_<i>      the document without its tasks
 *   ft_o_<i>      the task ids, in document order
 *   ft_t_<b>_<j>  the tasks whose id hashes to bucket b of n
 *
 * Buckets are what keep one edit from rewriting the whole document: it touches
 * one bucket and the meta key. The id list is what keeps the round trip exact —
 * buckets alone would hand the tasks back in hash order.
 */

export interface CloudKV {
  /** A missing key comes back as '' or is absent. */
  getItems(keys: string[]): Promise<Record<string, string>>
  setItem(key: string, value: string): Promise<void>
  removeItems(keys: string[]): Promise<void>
  getKeys(): Promise<string[]>
}

export const CLOUD_META_KEY = 'ft_meta'
export const CLOUD_PREFIX = 'ft_'
export const CLOUD_CHUNK = 4000
export const CLOUD_MAX_KEYS = 1000
const MAX_BUCKETS = 256
/** Grow the bucket count once buckets average more than this, so most stay within one value. */
const BUCKET_TARGET = 2400
const READ_BATCH = 100
const WRITE_PARALLEL = 6

export type CloudMeta = {
  v: 1
  /** Number of task buckets: a power of two that only grows while there are tasks. */
  n: number
  /** Revision: the millisecond timestamp of the write, strictly increasing. */
  rev: number
  /** Device that wrote this revision. */
  dev: string
  /** Number of ft_h_ pieces. */
  h: number
  /** Number of ft_o_ pieces. */
  o: number
  /** Number of pieces per bucket. */
  t: number[]
  /** Checksum of every piece named by h, o and t. */
  sum: string
}

/** The cloud copy is mid-write or damaged. Nothing was adopted. */
export class CloudBusyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CloudBusyError'
  }
}

/** The document does not fit into the cloud store. */
export class CloudFullError extends Error {
  constructor() {
    super('There is more data than Telegram cloud storage can hold.')
    this.name = 'CloudFullError'
  }
}

function fnv1a(text: string, seed = 0x811c9dc5): number {
  let h = seed
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** JSON with every non-ASCII character escaped, so characters and bytes count the same. */
function asciiJSON(value: unknown): string {
  return JSON.stringify(value).replace(
    /[\u007f-￿]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  )
}

function pieces(text: string): string[] {
  const out: string[] = []
  for (let i = 0; i < text.length; i += CLOUD_CHUNK) out.push(text.slice(i, i + CLOUD_CHUNK))
  return out
}

const headKey = (i: number) => `ft_h_${i}`
const orderKey = (i: number) => `ft_o_${i}`
const bucketKey = (b: number, j: number) => `ft_t_${b}_${j}`

type Shape = Pick<CloudMeta, 'h' | 'o' | 't'>

function dataKeys(shape: Shape): string[] {
  const keys: string[] = []
  for (let i = 0; i < shape.h; i += 1) keys.push(headKey(i))
  for (let i = 0; i < shape.o; i += 1) keys.push(orderKey(i))
  shape.t.forEach((count, b) => {
    for (let j = 0; j < count; j += 1) keys.push(bucketKey(b, j))
  })
  return keys
}

function checksum(keys: string[], entries: Record<string, string | undefined>): string {
  let h = 0x811c9dc5
  for (const k of keys) h = fnv1a(`${k}=${entries[k] ?? ''}\n`, h)
  return h.toString(16).padStart(8, '0')
}

type Item = { id: string }

function splitDocument(raw: string): { head: Record<string, unknown>; tasks: Item[] } {
  const root = JSON.parse(raw) as Record<string, unknown>
  const { tasks, ...head } = root
  if (!Array.isArray(tasks)) throw new Error('The document has no task array.')
  return { head, tasks: tasks as Item[] }
}

/**
 * Lays an encoded document out as cloud entries, without the meta key.
 * `prevN` keeps the bucket count stable from one write to the next.
 */
export function encodeCloud(raw: string, prevN = 1): { entries: Record<string, string>; n: number } & Shape {
  const { head, tasks } = splitDocument(raw)
  const entries: Record<string, string> = {}

  const headPieces = pieces(asciiJSON(head))
  headPieces.forEach((p, i) => { entries[headKey(i)] = p })
  const orderPieces = pieces(asciiJSON(tasks.map((t) => t.id)))
  orderPieces.forEach((p, i) => { entries[orderKey(i)] = p })

  const encoded = tasks.map((t) => ({ id: t.id, json: asciiJSON(t) }))
  let n = 1
  if (encoded.length > 0) {
    const total = encoded.reduce((sum, e) => sum + e.json.length + 1, 0)
    n = Math.max(1, prevN)
    while (n < MAX_BUCKETS && total / n > BUCKET_TARGET) n *= 2
  }
  const buckets: string[][] = Array.from({ length: n }, () => [])
  for (const e of encoded) buckets[fnv1a(e.id) % n]!.push(e.json)
  const t = buckets.map((items, b) => {
    if (items.length === 0) return 0
    const parts = pieces(`[${items.join(',')}]`)
    parts.forEach((p, j) => { entries[bucketKey(b, j)] = p })
    return parts.length
  })
  return { entries, n, h: headPieces.length, o: orderPieces.length, t }
}

export function parseCloudMeta(raw: string | undefined): CloudMeta | null {
  if (raw === undefined || raw === '') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new CloudBusyError('The cloud copy could not be read.')
  }
  const m = parsed as Partial<CloudMeta> | null
  if (
    m === null || typeof m !== 'object' || m.v !== 1
    || typeof m.rev !== 'number' || typeof m.n !== 'number'
    || typeof m.h !== 'number' || typeof m.o !== 'number'
    || !Array.isArray(m.t) || typeof m.sum !== 'string'
  ) {
    throw new CloudBusyError('The cloud copy was written by a newer version of GTDo.')
  }
  return m as CloudMeta
}

/**
 * Rebuilds the encoded document from cloud entries. Throws CloudBusyError when
 * the pieces do not add up to what the meta key describes.
 */
export function decodeCloud(meta: CloudMeta, entries: Record<string, string | undefined>): string {
  if (checksum(dataKeys(meta), entries) !== meta.sum) throw new CloudBusyError('The cloud copy is incomplete.')
  try {
    const join = (count: number, key: (i: number) => string): string => {
      let text = ''
      for (let i = 0; i < count; i += 1) text += entries[key(i)] ?? ''
      return text
    }
    const head = JSON.parse(join(meta.h, headKey)) as Record<string, unknown>
    const order = JSON.parse(join(meta.o, orderKey)) as string[]
    const byID = new Map<string, Item>()
    meta.t.forEach((count, b) => {
      if (count === 0) return
      for (const item of JSON.parse(join(count, (j) => bucketKey(b, j))) as Item[]) byID.set(item.id, item)
    })
    const tasks = order.map((id) => {
      const item = byID.get(id)
      if (item === undefined) throw new Error('missing task')
      return item
    })
    return JSON.stringify({ tasks, ...head })
  } catch {
    throw new CloudBusyError('The cloud copy could not be read.')
  }
}

// ---------------------------------------------------------------- sync engine

export type SyncState = {
  /** Cloud revision this device last pushed or pulled; null = never synced. */
  rev: number | null
  /** Timestamp of the latest local edit that has not reached the cloud; null = clean. */
  dirtyAt: number | null
  /** Bucket count last seen. */
  n: number
}

export const initialSyncState: SyncState = { rev: null, dirtyAt: null, n: 1 }

export interface SyncStateStore {
  load(): SyncState
  save(state: SyncState): void
}

export type SyncResult =
  | { action: 'none' | 'pushed' }
  | {
    action: 'pulled'
    /** The encoded document from the cloud. */
    raw: string
    /** The local document held something that never reached the cloud. */
    replacedUnsynced: boolean
    /**
     * Call once the document has actually replaced the local one. Until then
     * this device still counts as behind, so a declined adoption is retried
     * rather than silently skipped.
     */
    commit(): void
  }

export type CloudSyncDeps = {
  kv: CloudKV
  state: SyncStateStore
  device: string
  /** Injected clock in milliseconds — core/ never reads the wall clock itself. */
  now: () => number
  /** Whether an encoded document holds nothing worth uploading. */
  isEmpty: (raw: string) => boolean
}

/** Unsynced local edits beat a cloud revision only when this device has synced before and edited later. */
function localWins(st: SyncState, meta: CloudMeta): boolean {
  return st.rev !== null && st.dirtyAt !== null && st.dirtyAt > meta.rev
}

export class CloudSync {
  /** Cloud contents as last seen; an undefined value means "exists, content unknown". */
  private known: Record<string, string | undefined> | null = null
  /** The cloud revision `known` describes; another device's write makes it stale. */
  private knownRev: number | null = null

  constructor(private readonly deps: CloudSyncDeps) {}

  /** Call on every local edit. */
  markDirty(): void {
    this.deps.state.save({ ...this.deps.state.load(), dirtyAt: this.deps.now() })
  }

  /**
   * Reconciles the local document with the cloud: whole-document, last write
   * wins. `force: 'push'` uploads this device's document whatever the cloud holds.
   *
   * Throws CloudBusyError (the cloud is mid-write: try again shortly),
   * CloudFullError, or whatever the store itself rejected with.
   */
  async sync(getLocal: () => string, force?: 'push'): Promise<SyncResult> {
    const { kv, state, isEmpty } = this.deps
    let meta: CloudMeta | null
    try {
      meta = parseCloudMeta((await kv.getItems([CLOUD_META_KEY]))[CLOUD_META_KEY])
    } catch (e) {
      if (force === 'push' && e instanceof CloudBusyError) meta = null
      else throw e
    }
    if (force === 'push') return this.push(getLocal(), meta)

    const st = state.load()
    if (meta === null) {
      if (isEmpty(getLocal()) && st.dirtyAt === null) return { action: 'none' }
      return this.push(getLocal(), null)
    }
    if (meta.rev === st.rev) return st.dirtyAt === null ? { action: 'none' } : this.push(getLocal(), meta)
    if (localWins(st, meta)) return this.push(getLocal(), meta)

    // The cloud is ahead: fetch it, then decide again in case an edit landed meanwhile.
    const keys = dataKeys(meta)
    const entries: Record<string, string | undefined> = {}
    for (let i = 0; i < keys.length; i += READ_BATCH) {
      Object.assign(entries, await kv.getItems(keys.slice(i, i + READ_BATCH)))
    }
    const raw = decodeCloud(meta, entries)
    const after = state.load()
    if (localWins(after, meta)) return this.push(getLocal(), meta)

    const pulled = meta
    return {
      action: 'pulled',
      raw,
      replacedUnsynced: !isEmpty(getLocal()) && (after.rev === null || after.dirtyAt !== null),
      commit: () => {
        this.known = { ...entries, [CLOUD_META_KEY]: undefined }
        this.knownRev = pulled.rev
        state.save({ rev: pulled.rev, dirtyAt: null, n: pulled.n })
      },
    }
  }

  private async push(local: string, meta: CloudMeta | null): Promise<SyncResult> {
    const { kv, state, device, now } = this.deps
    const before = state.load()
    const { entries, n, h, o, t } = encodeCloud(local, Math.max(before.n, meta?.n ?? 1))
    const keys = Object.keys(entries)
    if (keys.length > CLOUD_MAX_KEYS) throw new CloudFullError()

    if (this.known === null || this.knownRev !== (meta?.rev ?? null)) {
      this.known = {}
      for (const k of await kv.getKeys()) if (k.startsWith(CLOUD_PREFIX)) this.known[k] = undefined
    }
    const known = this.known
    const changed = keys.filter((k) => known[k] !== entries[k])
    // Until the meta key lands, what we know about the cloud is unreliable.
    this.known = null
    for (let i = 0; i < changed.length; i += WRITE_PARALLEL) {
      await Promise.all(changed.slice(i, i + WRITE_PARALLEL).map((k) => kv.setItem(k, entries[k]!)))
    }
    const rev = Math.max(now(), (meta?.rev ?? 0) + 1, (before.rev ?? 0) + 1)
    const next: CloudMeta = { v: 1, n, rev, dev: device, h, o, t, sum: checksum(dataKeys({ h, o, t }), entries) }
    const metaText = asciiJSON(next)
    await kv.setItem(CLOUD_META_KEY, metaText)

    const after = state.load()
    state.save({ rev, n, dirtyAt: after.dirtyAt === before.dirtyAt ? null : after.dirtyAt })

    const stale = Object.keys(known).filter((k) => k !== CLOUD_META_KEY && !(k in entries))
    const nowKnown: Record<string, string | undefined> = { ...entries, [CLOUD_META_KEY]: metaText }
    this.known = nowKnown
    this.knownRev = rev
    if (stale.length > 0) {
      // Leftovers are harmless — the meta names every piece in use — so a
      // failure here only means a later push tries again.
      try {
        await kv.removeItems(stale)
      } catch {
        for (const k of stale) nowKnown[k] = undefined
      }
    }
    return { action: 'pushed' }
  }
}
