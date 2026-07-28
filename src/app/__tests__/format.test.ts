import { describe, it, expect } from 'vitest'
import { formatDateInput, ISO_DATE_MIN, parseDateInput, parseDateTimeInput } from '../format'
import { AppStore } from '../../core/store'
import { MemoryAdapter } from '../../storage/memoryAdapter'
import { decodeAppData, encodeAppData } from '../../core/codec'
import { BuiltIn } from '../../core/models'

describe('Date input parsing', () => {
  it('testOrdinaryDayRoundTrips', () => {
    const parsed = parseDateInput('2026-07-28')
    expect(formatDateInput(parsed)).toBe('2026-07-28')
    expect(parsed!.getHours()).toBe(0)
  })

  it('testEmptyValueClearsTheDate', () => {
    expect(parseDateInput('')).toBeNull()
    expect(parseDateInput('2026-07')).toBeNull()
  })

  it('testYearBeyondFourDigitsIsRefused', () => {
    // <input type="date"> has no max, so a five-digit year reaches us intact.
    // Storing it writes an expanded-form ISO string the decoder rejects, and
    // the whole document is quarantined on the next launch.
    expect(parseDateInput('20266-01-05')).toBeNull()
    expect(parseDateInput('10000-01-01')).toBeNull()
    expect(parseDateInput('9999-12-31')).not.toBeNull()
  })

  it('testGarbageIsRefusedRatherThanBecomingAnInvalidDate', () => {
    // An Invalid Date reaching the store makes toISOString() throw inside
    // persist(), where nothing catches it.
    expect(parseDateInput('not-a-date')).toBeNull()
    expect(parseDateInput('2026-xx-01')).toBeNull()
    expect(parseDateInput('2026-07-28.5')).toBeNull()
  })

  it('testTwoDigitYearIsNotMappedIntoThe1900s', () => {
    // new Date(26, 0, 5) is 1926 — the constructor's two-digit-year mapping
    // silently rewrites a date the user typed.
    expect(parseDateInput('0026-01-05')?.getFullYear()).toBe(26)
    expect(parseDateInput(ISO_DATE_MIN)?.getFullYear()).toBe(1)
  })

  it.each(['0026-01-05', ISO_DATE_MIN])('testTwoDigitYearSurvivesTheStore(%s)', async (typed) => {
    // Escaping the constructor inside parseDateInput is not enough: setDueDate
    // re-pins the day through atNoon, which rebuilt the date with the very
    // constructor the parse escaped, so 0026-01-05 was stored as 1926-01-05.
    const store = await AppStore.create({
      adapter: new MemoryAdapter(), now: () => new Date(2026, 6, 28), scheduler: (_ms, fn) => fn(),
    })
    const t = store.addTask('low year', { kind: 'list', id: BuiltIn.inbox })!
    store.setDueDate(t.id, parseDateInput(typed))
    const stored = store.task(t.id)!.dueDate!
    expect(formatDateInput(stored)).toBe(typed)
    expect(stored.getHours()).toBe(12)
  })

  it('testALowYearDeadlineRoundTripsThroughTheCodec', async () => {
    // The stored year only matters if it survives a save/load: DATE_RE accepts
    // 0001..9999, and noon-pinning keeps the ±11h of slack that stops the day
    // from sliding across the UTC boundary at either end of that span.
    const store = await AppStore.create({
      adapter: new MemoryAdapter(), now: () => new Date(2026, 6, 28), scheduler: (_ms, fn) => fn(),
    })
    const t = store.addTask('low year', { kind: 'list', id: BuiltIn.inbox })!
    store.setDueDate(t.id, parseDateInput('0026-01-05'))
    const reloaded = decodeAppData(encodeAppData(store.data))
    expect(formatDateInput(reloaded.tasks.find((x) => x.id === t.id)!.dueDate)).toBe('0026-01-05')
  })

  it('testDateTimeParsingStillGuardsNaN', () => {
    expect(parseDateTimeInput('')).toBeNull()
    expect(parseDateTimeInput('nonsense')).toBeNull()
    expect(parseDateTimeInput('2026-07-28T09:30')).not.toBeNull()
  })
})
