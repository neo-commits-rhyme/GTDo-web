import { describe, it, expect } from 'vitest'
import { startOfDay, addDays, addMonths, addYears, isWeekend, atNoon, sameDay } from '../calendar'

describe('calendar', () => {
  it('startOfDayIsLocalMidnight', () => {
    const d = startOfDay(new Date(2026, 6, 28, 17, 45, 3, 250))
    expect([d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()]).toEqual([0, 0, 0, 0])
    expect(d.getDate()).toBe(28)
    expect(d.getMonth()).toBe(6)
  })

  it('atNoonPinsToLocalNoon', () => {
    const d = atNoon(new Date(2026, 6, 28, 23, 59, 59))
    expect([d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()]).toEqual([12, 0, 0, 0])
    expect(d.getDate()).toBe(28)
  })

  it('atNoonSurvivesSerialisationAsTheSameDay', () => {
    // The whole point of noon-pinning: ±11h of slack, so no timezone shifts the
    // day across a UTC date boundary.
    const d = atNoon(new Date(2026, 6, 28))
    expect(d.toISOString().slice(0, 10)).toBe('2026-07-28')
  })

  it('yearsBelow100AreNotMappedIntoThe1900s', () => {
    // new Date(26, 0, 5) is 1926. Both helpers tear the date down to its
    // fields and rebuild it with that constructor, so every deadline below
    // year 100 used to gain 1900 years on its way into the store.
    const y26 = new Date(2026, 0, 5)
    y26.setFullYear(26)
    expect(startOfDay(y26).getFullYear()).toBe(26)
    expect(atNoon(y26).getFullYear()).toBe(26)
    const y1 = new Date(2026, 0, 1)
    y1.setFullYear(1)
    expect(startOfDay(y1).getFullYear()).toBe(1)
    expect(atNoon(y1).getFullYear()).toBe(1)
  })

  it('addMonthsClampsShortMonths', () => {
    const feb = addMonths(new Date(2026, 0, 31), 1)
    expect(feb.getMonth()).toBe(1)
    expect(feb.getDate()).toBe(28)
    expect(addMonths(new Date(2024, 0, 31), 1).getDate()).toBe(29) // leap year
    expect(addMonths(new Date(2026, 0, 15), 1).getDate()).toBe(15) // no clamping needed
  })

  it('addMonthsClampsAgainstTheRealYearNot1900', () => {
    // The month-length probe used to be built from fields too, so it measured
    // 1900 — which is not a leap year, where year 0 (the codec's floor, and so
    // a year a decoded file can carry) is.
    const jan31 = new Date(2000, 0, 31)
    jan31.setFullYear(0)
    const feb = addMonths(jan31, 1)
    expect([feb.getFullYear(), feb.getMonth(), feb.getDate()]).toEqual([0, 1, 29])
  })

  it('addYearsClampsLeapDay', () => {
    const y = addYears(new Date(2024, 1, 29), 1)
    expect(y.getMonth()).toBe(1)
    expect(y.getDate()).toBe(28)
    expect(y.getFullYear()).toBe(2025)
  })

  it('isWeekendIsSaturdayAndSunday', () => {
    expect(isWeekend(new Date(2026, 6, 25))).toBe(true)  // Sat
    expect(isWeekend(new Date(2026, 6, 26))).toBe(true)  // Sun
    expect(isWeekend(new Date(2026, 6, 27))).toBe(false) // Mon
    expect(isWeekend(new Date(2026, 6, 31))).toBe(false) // Fri
  })

  it('addDaysKeepsTheWallClockAcrossDST', () => {
    // US spring-forward 2026-03-08. A naive +86_400_000 would land at 13:00.
    const before = new Date(2026, 2, 7, 12, 0, 0)
    const after = addDays(before, 1)
    expect(after.getHours()).toBe(12)
    expect(after.getDate()).toBe(8)
  })

  it('addDaysHandlesNegativeAndMonthBoundaries', () => {
    expect(addDays(new Date(2026, 6, 1), -1).getMonth()).toBe(5)
    expect(addDays(new Date(2026, 6, 1), -1).getDate()).toBe(30)
    expect(addDays(new Date(2026, 11, 31), 1).getFullYear()).toBe(2027)
  })

  it('sameDayComparesCalendarDaysNotInstants', () => {
    expect(sameDay(new Date(2026, 6, 28, 0, 0, 1), new Date(2026, 6, 28, 23, 59))).toBe(true)
    expect(sameDay(new Date(2026, 6, 28, 23, 59), new Date(2026, 6, 29, 0, 1))).toBe(false)
  })
})
