import { describe, it, expect, vi } from 'vitest'
import { AppStore } from '../store'
import { MemoryAdapter } from '../../storage/memoryAdapter'
import { FailingAdapter } from '../../storage/failingAdapter'
import type { StoragePort } from '../ports'
import { encodeAppData } from '../codec'
import { seededAppData, BuiltIn } from '../models'

const NOW = new Date(2026, 6, 28, 9, 0, 0)

/** Fires scheduled work immediately, so hold windows resolve synchronously. */
const immediate = (_ms: number, fn: () => void) => fn()

const deps = (adapter: StoragePort = new MemoryAdapter(), now: () => Date = () => NOW) => ({
  adapter,
  now,
  scheduler: immediate,
})

const seeded = () => encodeAppData(seededAppData())

describe('AppStore lifecycle', () => {
  it('testFirstRunSeedsWithoutTasks', async () => {
    const s = await AppStore.create(deps())
    expect(s.data.tasks).toEqual([])
    expect(s.data.lists.length).toBe(5)
    expect(s.data.groups.length).toBe(1)
    expect(s.selection).toEqual({ kind: 'smart', view: 'today' })
    expect(s.saveError).toBeNull()
  })

  it('testUnreadableRefusesToOverwriteForever', async () => {
    const a = new FailingAdapter()
    const spy = vi.spyOn(a, 'persist')
    const s = await AppStore.create(deps(a))
    expect(s.saveError).not.toBeNull()

    s.persist()
    await s.flushWrites()
    expect(s.saveError).not.toBeNull()
    expect(spy).not.toHaveBeenCalled() // never writes over recoverable bytes
  })

  it('testUndecodableQuarantinesBeforeSeeding', async () => {
    const a = new MemoryAdapter()
    await a.persist('{ not json')
    const spy = vi.spyOn(a, 'quarantine')
    const s = await AppStore.create(deps(a))
    expect(spy).toHaveBeenCalledOnce()
    expect(spy.mock.calls[0]![0]).toBe('{ not json') // the user's bytes, kept
    expect(s.data.lists.length).toBe(5)
    expect(s.saveError).not.toBeNull()
  })

  it('testDecodableLoadIsUsed', async () => {
    const a = new MemoryAdapter()
    const d = seededAppData()
    d.lists.push({
      id: '11111111-2222-3333-4444-555555555555', name: 'Work',
      isBuiltIn: false, groupID: null, order: 5, colorHex: null, symbol: null,
      completedAt: null,
    })
    await a.persist(encodeAppData(d))
    const s = await AppStore.create(deps(a))
    expect(s.data.lists.map((l) => l.name)).toContain('Work')
  })

  it('testLaunchBackupHappensOnlyOnSuccessfulLoad', async () => {
    const a = new MemoryAdapter()
    await a.persist(seeded())
    const spy = vi.spyOn(a, 'writeSnapshot')
    await AppStore.create(deps(a))
    expect(spy).toHaveBeenCalledOnce()

    const empty = new MemoryAdapter()
    const spy2 = vi.spyOn(empty, 'writeSnapshot')
    await AppStore.create(deps(empty))
    expect(spy2).not.toHaveBeenCalled() // nothing on disk to snapshot
  })

  it('testBackupThrottleAndForce', async () => {
    const a = new MemoryAdapter()
    await a.persist(seeded())
    let clock = new Date(2026, 6, 28, 9, 0, 0)
    const s = await AppStore.create(deps(a, () => clock))
    const spy = vi.spyOn(a, 'writeSnapshot')

    s.persist() // within 5 minutes of the launch backup
    await s.flushWrites()
    expect(spy).not.toHaveBeenCalled()

    s.persist({ forceBackup: true })
    await s.flushWrites()
    expect(spy).toHaveBeenCalledOnce()

    clock = new Date(2026, 6, 28, 9, 6, 0)
    s.persist()
    await s.flushWrites()
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('testClockMovingBackwardsCountsAsDue', async () => {
    // DST, NTP or a manual change. Treating negative elapsed as "too soon"
    // would suspend backups until real time caught up.
    const a = new MemoryAdapter()
    await a.persist(seeded())
    let clock = new Date(2026, 6, 28, 9, 0, 0)
    const s = await AppStore.create(deps(a, () => clock))
    const spy = vi.spyOn(a, 'writeSnapshot')
    clock = new Date(2026, 6, 28, 8, 0, 0)
    s.persist()
    await s.flushWrites()
    expect(spy).toHaveBeenCalledOnce()
  })

  it('testFailedBackupIsRetriedNotThrottledAway', async () => {
    // The launch snapshot fails, so lastBackupAt is never armed and the very
    // next save is still due — rather than the failure being throttled away.
    const a = new MemoryAdapter()
    await a.persist(seeded())
    vi.spyOn(a, 'writeSnapshot').mockResolvedValueOnce(false)
    const s = await AppStore.create(deps(a))

    const spy = vi.spyOn(a, 'writeSnapshot')
    s.persist()
    await s.flushWrites()
    expect(spy).toHaveBeenCalled()
  })

  it('testSnapshotCopiesThePreMutationStateNotThePendingOne', async () => {
    // A snapshot must always be a state the app previously considered good.
    const a = new MemoryAdapter()
    const original = seeded()
    await a.persist(original)
    let clock = new Date(2026, 6, 28, 9, 0, 0)
    const s = await AppStore.create(deps(a, () => clock))

    s.data.lists.push({
      id: '77777777-2222-3333-4444-555555555555', name: 'Added after launch',
      isBuiltIn: false, groupID: null, order: 6, colorHex: null, symbol: null,
      completedAt: null,
    })
    clock = new Date(2026, 6, 28, 9, 6, 0)
    s.persist()
    await s.flushWrites()

    const snaps = await a.listSnapshots()
    const newest = await a.readSnapshot(snaps[0]!.id)
    expect(newest).toBe(original)
    expect(newest).not.toContain('Added after launch')
  })

  it('testFirstRunHasNothingGoodToSnapshot', async () => {
    const a = new MemoryAdapter()
    const spy = vi.spyOn(a, 'writeSnapshot')
    const s = await AppStore.create(deps(a))
    s.persist()
    await s.flushWrites()
    expect(spy).not.toHaveBeenCalled()
  })

  it('testHealingBuiltInsAppendsAndMatchesByIDOnly', async () => {
    const s = await AppStore.create(deps())
    const imported = seededAppData()
    imported.lists = imported.lists.filter((l) => l.id !== BuiltIn.notes)
    imported.lists[0] = { ...imported.lists[0]!, name: 'Renamed inbox' }
    const healed = s.healingBuiltIns(imported)
    expect(healed.lists.length).toBe(5)
    expect(healed.lists.at(-1)!.id).toBe(BuiltIn.notes) // appended at the end
    expect(healed.lists[0]!.name).toBe('Renamed inbox') // matched by id, not renamed
  })

  it('testHealingRestoresAMissingProjectsGroup', async () => {
    const s = await AppStore.create(deps())
    const imported = { ...seededAppData(), groups: [] }
    expect(s.healingBuiltIns(imported).groups.map((g) => g.id)).toEqual([BuiltIn.projectsGroup])
  })

  it('testSuccessfulSaveClearsAPreviousError', async () => {
    const a = new MemoryAdapter()
    const s = await AppStore.create(deps(a))
    const fail = vi.spyOn(a, 'persist').mockRejectedValueOnce(new Error('QuotaExceededError'))
    s.persist()
    await s.flushWrites()
    expect(s.saveError).not.toBeNull()

    fail.mockRestore()
    s.persist()
    await s.flushWrites()
    expect(s.saveError).toBeNull()
  })

  it('testImportReplacesEverythingAndResetsViewState', async () => {
    const a = new MemoryAdapter()
    await a.persist(seeded())
    const s = await AppStore.create(deps(a))
    s.selection = { kind: 'list', id: BuiltIn.someday }
    s.selectedTaskID = 'whatever'
    s.searchQuery = 'query'
    s.pendingDeadline = { kind: 'create', title: 't', target: BuiltIn.nextActions }

    const incoming = seededAppData()
    incoming.lists.push({
      id: '99999999-2222-3333-4444-555555555555', name: 'Imported',
      isBuiltIn: false, groupID: null, order: 9, colorHex: null, symbol: null,
      completedAt: null,
    })
    s.importData(incoming)

    expect(s.data.lists.map((l) => l.name)).toContain('Imported')
    expect(s.selection).toEqual({ kind: 'smart', view: 'today' })
    expect(s.selectedTaskID).toBeNull()
    expect(s.searchQuery).toBe('')
    expect(s.pendingDeadline).toBeNull()
  })

  it('testImportTakesABackupFirstSoItIsUndoable', async () => {
    const a = new MemoryAdapter()
    await a.persist(seeded())
    const s = await AppStore.create(deps(a))
    const spy = vi.spyOn(a, 'writeSnapshot')
    s.importData(seededAppData())
    await s.flushWrites()
    expect(spy).toHaveBeenCalled()
  })

  it('testTaskAndListAccessorsReturnCopies', async () => {
    // toggleCompletedHolding snapshots `before` and reads it AFTER mutating —
    // a live reference would silently break that.
    const a = new MemoryAdapter()
    const d = seededAppData()
    d.tasks = [{
      id: 'aaaaaaaa-1111-2222-3333-444444444444', title: 'x', note: '',
      dueDate: null, reminderDate: null, listID: BuiltIn.inbox,
      isCompleted: false, completedAt: null, isTrashed: false,
      createdAt: NOW, order: 1, repeatRule: null, trashedAt: null,
    }]
    await a.persist(encodeAppData(d))
    const s = await AppStore.create(deps(a))

    const before = s.task('AAAAAAAA-1111-2222-3333-444444444444')!
    expect(Object.isFrozen(before)).toBe(true)
    expect(s.list(BuiltIn.inbox)).not.toBeNull()
    expect(s.task('nope')).toBeNull()
  })

  it('testSubscribersAreNotifiedOnMutation', async () => {
    const s = await AppStore.create(deps())
    const seen: number[] = []
    const unsubscribe = s.subscribe(() => seen.push(1))
    s.importData(seededAppData())
    expect(seen.length).toBeGreaterThan(0)
    unsubscribe()
    const count = seen.length
    s.importData(seededAppData())
    expect(seen.length).toBe(count)
  })

  it('testTodayIsMidnightAndDeadlineDayIsNoon', async () => {
    const s = await AppStore.create(deps())
    expect(s.today.getHours()).toBe(0)
    expect(s.deadlineDay(NOW).getHours()).toBe(12)
  })
})
