import { describe, it, expect } from 'vitest'
import {
  CLOUD_META_KEY, CloudBusyError, CloudFullError, CloudSync, decodeCloud, encodeCloud, initialSyncState,
  parseCloudMeta, type CloudKV, type SyncState, type SyncStateStore,
} from '../cloudSync'
import { decodeAppData, encodeAppData } from '../codec'
import { seededAppData, BuiltIn, type AppData, type TaskItem } from '../models'
import { makeSampleData } from '../seed'

// ---------------------------------------------------------------- fakes

/** In-memory store that enforces Telegram CloudStorage's limits and records every write. */
class FakeKV implements CloudKV {
  items = new Map<string, string>()
  writes: string[] = []
  removed: string[] = []
  /** Throw on the Nth setItem from now (1-based); 0 = never. */
  failOnWrite = 0

  async getItems(keys: string[]) {
    const out: Record<string, string> = {}
    for (const k of keys) out[k] = this.items.get(k) ?? ''
    return out
  }

  async setItem(key: string, value: string) {
    if (this.failOnWrite > 0) {
      this.failOnWrite -= 1
      if (this.failOnWrite === 0) throw new Error('network')
    }
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(key)) throw new Error(`bad key ${key}`)
    if (value.length > 4096 || /[^\x00-\x7e]/.test(value)) throw new Error(`bad value for ${key}`)
    this.items.set(key, value)
    this.writes.push(key)
    if (this.items.size > 1024) throw new Error('too many keys')
  }

  async removeItems(keys: string[]) {
    for (const k of keys) {
      this.items.delete(k)
      this.removed.push(k)
    }
  }

  async getKeys() { return [...this.items.keys()] }
}

function memoryState(): SyncStateStore & { current: SyncState } {
  const box = {
    current: { ...initialSyncState },
    load: () => ({ ...box.current }),
    save: (s: SyncState) => { box.current = { ...s } },
  }
  return box
}

const REFERENCE = new Date(Date.UTC(2026, 10, 12, 9, 0, 0))
const sample = () => encodeAppData(makeSampleData(REFERENCE))
const empty = () => encodeAppData(seededAppData())

let nextID = 1
function task(title: string, extra: Partial<TaskItem> = {}): TaskItem {
  const id = `00000000-0000-4000-8000-${String(nextID).padStart(12, '0')}`
  nextID += 1
  return {
    id, title, note: '', dueDate: null, reminderDate: null, listID: BuiltIn.inbox, isCompleted: false,
    completedAt: null, isTrashed: false, createdAt: REFERENCE, order: nextID, repeatRule: null, trashedAt: null,
    ...extra,
  }
}

/** Applies a change to an encoded document, the way a store mutation would. */
function edited(raw: string, change: (d: AppData) => void): string {
  const data = decodeAppData(raw)
  change(data)
  return encodeAppData(data)
}

const withTask = (raw: string, ...tasks: TaskItem[]) => edited(raw, (d) => { d.tasks.push(...tasks) })

function isEmpty(raw: string): boolean {
  const d = decodeAppData(raw)
  return d.tasks.length === 0 && d.lists.every((l) => l.isBuiltIn) && d.groups.every((g) => g.isBuiltIn)
}

/** A device: its own document, sync state and view of the clock, sharing one cloud. */
function device(kv: FakeKV, name: string, clock: { t: number }, raw: string = empty()) {
  const state = memoryState()
  const engine = new CloudSync({ kv, state, device: name, now: () => clock.t, isEmpty })
  const d = {
    raw,
    state,
    engine,
    edit(next: string) { d.raw = next; engine.markDirty() },
    async sync(force?: 'push') {
      const r = await engine.sync(() => d.raw, force)
      if (r.action === 'pulled') {
        // Through the codec, as the app does, so this is the byte-level claim.
        d.raw = encodeAppData(decodeAppData(r.raw))
        r.commit()
      }
      return r
    },
  }
  return d
}

const metaOf = (kv: FakeKV) => parseCloudMeta(kv.items.get(CLOUD_META_KEY))!

// ---------------------------------------------------------------- layout

describe('CloudLayout', () => {
  it('testSampleDocumentRoundTripsByteIdentical', async () => {
    const raw = sample()
    const kv = new FakeKV()
    await device(kv, 'a', { t: 1 }, raw).sync('push')
    const back = decodeCloud(metaOf(kv), Object.fromEntries(kv.items))
    expect(encodeAppData(decodeAppData(back))).toBe(raw)
  })

  it('testTaskOrderSurvivesBucketing', async () => {
    // Buckets alone would hand tasks back in hash order; the id list restores it.
    const raw = withTask(empty(), ...Array.from({ length: 60 }, (_, i) => task(`t${i}`)))
    const { n } = encodeCloud(raw)
    expect(n).toBeGreaterThan(1)
    const kv = new FakeKV()
    await device(kv, 'a', { t: 1 }, raw).sync('push')
    const b = device(kv, 'b', { t: 2 })
    await b.sync()
    expect(decodeAppData(b.raw).tasks.map((t) => t.title)).toEqual(decodeAppData(raw).tasks.map((t) => t.title))
  })

  it('testEveryValueIsAsciiAndWithinTheLimit', async () => {
    // FakeKV rejects anything Telegram would: this passes only if nothing was rejected.
    const raw = withTask(empty(), task('Кофе “Oʻzbek” ☕️', { note: 'ж'.repeat(9000) }), task('soʻm'))
    const kv = new FakeKV()
    await device(kv, 'a', { t: 1 }, raw).sync('push')
    const b = device(kv, 'b', { t: 2 })
    await b.sync()
    expect(b.raw).toBe(raw)
  })

  it('testDamagedCopyIsRejected', async () => {
    const kv = new FakeKV()
    await device(kv, 'a', { t: 1 }, sample()).sync('push')
    const entries = Object.fromEntries(kv.items)
    const victim = Object.keys(entries).find((k) => k.startsWith('ft_t_'))!
    entries[victim] = entries[victim]!.slice(0, -3)
    expect(() => decodeCloud(metaOf(kv), entries)).toThrow(CloudBusyError)
  })

  it('testDocumentTooLargeIsRefused', async () => {
    const raw = withTask(empty(), ...Array.from({ length: 1100 }, (_, i) => task(`t${i}`, { note: 'x'.repeat(4000) })))
    await expect(device(new FakeKV(), 'a', { t: 1 }, raw).sync('push')).rejects.toBeInstanceOf(CloudFullError)
  })
})

// ---------------------------------------------------------------- reconciliation

describe('CloudSync', () => {
  it('testNothingHappensWhenBothSidesAreEmpty', async () => {
    const kv = new FakeKV()
    expect(await device(kv, 'a', { t: 1 }).sync()).toEqual({ action: 'none' })
    expect(kv.items.size).toBe(0)
  })

  it('testLocalDocumentIsPushedToAnEmptyCloud', async () => {
    const kv = new FakeKV()
    const a = device(kv, 'a', { t: 100 }, sample())
    expect((await a.sync()).action).toBe('pushed')
    expect(a.state.current).toMatchObject({ rev: 100, dirtyAt: null })
    expect((await a.sync()).action).toBe('none')
  })

  it('testSecondDevicePullsWhatTheFirstPushed', async () => {
    const kv = new FakeKV()
    const clock = { t: 100 }
    const a = device(kv, 'a', clock, sample())
    await a.sync()
    const b = device(kv, 'b', clock)
    expect(await b.sync()).toMatchObject({ action: 'pulled', replacedUnsynced: false })
    expect(b.raw).toBe(a.raw)
    expect((await b.sync()).action).toBe('none')
  })

  it('testEditsTravelBothWays', async () => {
    const kv = new FakeKV()
    const clock = { t: 100 }
    const a = device(kv, 'a', clock, sample())
    await a.sync()
    const b = device(kv, 'b', clock)
    await b.sync()

    clock.t = 200
    b.edit(withTask(b.raw, task('from b')))
    expect((await b.sync()).action).toBe('pushed')
    expect((await a.sync()).action).toBe('pulled')
    expect(a.raw).toBe(b.raw)

    clock.t = 300
    a.edit(edited(a.raw, (d) => { d.tasks.shift() }))
    await a.sync()
    await b.sync()
    expect(b.raw).toBe(a.raw)
  })

  it('testEditingOneTaskRewritesOneBucketAndTheMeta', async () => {
    const kv = new FakeKV()
    const clock = { t: 100 }
    const a = device(kv, 'a', clock, withTask(empty(), ...Array.from({ length: 80 }, (_, i) => task(`t${i}`))))
    await a.sync()
    expect(kv.items.size).toBeGreaterThan(4)
    kv.writes = []
    clock.t = 200
    a.edit(edited(a.raw, (d) => { d.tasks[40]!.title = 'renamed' }))
    await a.sync()
    expect(kv.writes.length).toBe(2)
    expect(kv.writes.at(-1)).toBe(CLOUD_META_KEY)
  })

  it('testWhenBothChangedTheLaterEditWins', async () => {
    const kv = new FakeKV()
    const clock = { t: 100 }
    const a = device(kv, 'a', clock, sample())
    await a.sync()
    const b = device(kv, 'b', clock)
    await b.sync()

    clock.t = 200
    a.edit(withTask(a.raw, task('older, from a')))
    clock.t = 300
    b.edit(withTask(b.raw, task('newer, from b')))
    await b.sync()
    // a's edit (200) is older than the cloud (300): a adopts, and is told it lost something.
    expect(await a.sync()).toMatchObject({ action: 'pulled', replacedUnsynced: true })
    expect(a.raw).toBe(b.raw)

    // The reverse: a edits after the cloud's revision without having seen it.
    clock.t = 400
    b.edit(withTask(b.raw, task('b at 400')))
    await b.sync()
    clock.t = 600
    a.edit(withTask(a.raw, task('a at 600')))
    expect((await a.sync()).action).toBe('pushed')
    await b.sync()
    expect(b.raw).toBe(a.raw)
  })

  it('testNeverSyncedDeviceAdoptsTheCloud', async () => {
    const kv = new FakeKV()
    const clock = { t: 100 }
    const a = device(kv, 'a', clock, sample())
    await a.sync()
    clock.t = 900
    const b = device(kv, 'b', clock, withTask(empty(), task('local only')))
    b.engine.markDirty()
    expect(await b.sync()).toMatchObject({ action: 'pulled', replacedUnsynced: true })
    expect(b.raw).toBe(a.raw)
  })

  it('testUncommittedPullIsOfferedAgain', async () => {
    // The app may decline to adopt (an undo is pending): the device must stay behind.
    const kv = new FakeKV()
    const clock = { t: 100 }
    await device(kv, 'a', clock, sample()).sync()
    const b = device(kv, 'b', clock)
    const first = await b.engine.sync(() => b.raw)
    expect(first.action).toBe('pulled')
    expect(b.state.current.rev).toBeNull()
    const second = await b.engine.sync(() => b.raw)
    expect(second.action).toBe('pulled')
    if (second.action === 'pulled') second.commit()
    expect(b.state.current.rev).toBe(100)
  })

  it('testResetPropagates', async () => {
    const kv = new FakeKV()
    const clock = { t: 100 }
    const a = device(kv, 'a', clock, sample())
    await a.sync()
    const b = device(kv, 'b', clock)
    await b.sync()
    clock.t = 200
    a.edit(empty())
    await a.sync()
    expect([...kv.items.keys()].filter((k) => k.startsWith('ft_t_'))).toEqual([])
    await b.sync()
    expect(b.raw).toBe(empty())
  })

  it('testInterruptedWriteIsNotAdoptedAndRecovers', async () => {
    const kv = new FakeKV()
    const clock = { t: 100 }
    const a = device(kv, 'a', clock, sample())
    await a.sync()
    const b = device(kv, 'b', clock)
    await b.sync()

    clock.t = 200
    a.edit(withTask(a.raw, task('interrupted')))
    kv.failOnWrite = 2 // a data piece lands, a later write does not
    await expect(a.sync()).rejects.toThrow('network')
    expect(a.state.current.dirtyAt).toBe(200)

    const c = device(kv, 'c', clock)
    await expect(c.sync()).rejects.toBeInstanceOf(CloudBusyError)
    expect(c.raw).toBe(empty())

    expect((await a.sync()).action).toBe('pushed')
    await c.sync()
    await b.sync()
    expect(c.raw).toBe(a.raw)
    expect(b.raw).toBe(a.raw)
  })

  it('testEditDuringPushStaysDirty', async () => {
    const kv = new FakeKV()
    const clock = { t: 100 }
    const a = device(kv, 'a', clock, sample())
    a.engine.markDirty()
    const original = kv.setItem.bind(kv)
    let once = true
    kv.setItem = async (k, v) => {
      if (once) {
        once = false
        clock.t = 150
        a.edit(withTask(a.raw, task('during push')))
      }
      return original(k, v)
    }
    await a.sync()
    expect(a.state.current.dirtyAt).toBe(150)
    clock.t = 200
    expect((await a.sync()).action).toBe('pushed')
    const b = device(kv, 'b', clock)
    await b.sync()
    expect(b.raw).toBe(a.raw)
  })

  it('testForcePushRepairsADamagedCopy', async () => {
    const kv = new FakeKV()
    const clock = { t: 100 }
    const a = device(kv, 'a', clock, sample())
    await a.sync()
    kv.items.set([...kv.items.keys()].find((k) => k.startsWith('ft_t_'))!, '[]')
    const b = device(kv, 'b', clock)
    await expect(b.sync()).rejects.toBeInstanceOf(CloudBusyError)
    clock.t = 200
    expect((await device(kv, 'a2', clock, a.raw).sync('push')).action).toBe('pushed')
    await b.sync()
    expect(b.raw).toBe(a.raw)
  })

  it('testUnusedPiecesAreRemoved', async () => {
    const kv = new FakeKV()
    const clock = { t: 100 }
    const a = device(kv, 'a', clock, withTask(empty(), task('big', { note: 'x'.repeat(9000) })))
    await a.sync()
    const before = kv.items.size
    clock.t = 200
    a.edit(withTask(empty(), task('small')))
    await a.sync()
    expect(kv.items.size).toBeLessThan(before)
    expect(kv.removed.length).toBeGreaterThan(0)
  })
})
