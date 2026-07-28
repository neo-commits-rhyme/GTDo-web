import { describe, it, expect } from 'vitest'
import { formatDateInput, parseDateInput, parseDateTimeInput } from '../format'

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
  })

  it('testDateTimeParsingStillGuardsNaN', () => {
    expect(parseDateTimeInput('')).toBeNull()
    expect(parseDateTimeInput('nonsense')).toBeNull()
    expect(parseDateTimeInput('2026-07-28T09:30')).not.toBeNull()
  })
})
