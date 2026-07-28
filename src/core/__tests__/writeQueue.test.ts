import { describe, it, expect, vi } from 'vitest'
import { WriteQueue } from '../writeQueue'
import { MemoryAdapter } from '../../storage/memoryAdapter'
import { FailingAdapter } from '../../storage/failingAdapter'

describe('WriteQueue', () => {
  it('coalescesABurstIntoOneWrite', async () => {
    const a = new MemoryAdapter()
    const spy = vi.spyOn(a, 'persist')
    const q = new WriteQueue(a)
    q.enqueue('1')
    q.enqueue('2')
    q.enqueue('3')
    await q.flush()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('3') // last value wins
  })

  it('preservesOrderAcrossFlushes', async () => {
    const a = new MemoryAdapter()
    const q = new WriteQueue(a)
    q.enqueue('1')
    await q.flush()
    q.enqueue('2')
    await q.flush()
    expect(await a.load()).toEqual({ kind: 'ok', raw: '2' })
  })

  it('doesNotWriteWhenNothingIsPending', async () => {
    const a = new MemoryAdapter()
    const spy = vi.spyOn(a, 'persist')
    await new WriteQueue(a).flush()
    expect(spy).not.toHaveBeenCalled()
  })

  it('surfacesRejectionWithoutLatchingOff', async () => {
    const a = new FailingAdapter()
    const q = new WriteQueue(a)
    const errors: Error[] = []
    q.onError = (e) => errors.push(e)
    q.enqueue('1')
    await q.flush()
    expect(errors.length).toBe(1)
    q.enqueue('2')
    await q.flush()
    expect(errors.length).toBe(2) // still trying
  })

  it('reportsSuccessAfterAFailureSoTheBannerCanClear', async () => {
    const a = new MemoryAdapter()
    const q = new WriteQueue(a)
    const seen: (Error | null)[] = []
    q.onError = (e) => seen.push(e)
    q.onSuccess = () => seen.push(null)
    vi.spyOn(a, 'persist').mockRejectedValueOnce(new Error('QuotaExceededError'))
    q.enqueue('1')
    await q.flush()
    q.enqueue('2')
    await q.flush()
    expect(seen.map((s) => s === null)).toEqual([false, true])
  })

  it('aWriteEnqueuedDuringAnInFlightWriteStillLands', async () => {
    const a = new MemoryAdapter()
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => { release = r })
    const original = a.persist.bind(a)
    vi.spyOn(a, 'persist').mockImplementationOnce(async (raw) => {
      await gate
      return original(raw)
    })
    const q = new WriteQueue(a)
    q.enqueue('first')
    const inFlight = q.flush()
    q.enqueue('second')
    release()
    await inFlight
    await q.flush()
    expect(await a.load()).toEqual({ kind: 'ok', raw: 'second' })
  })
})
