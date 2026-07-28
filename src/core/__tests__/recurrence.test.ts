import { describe, it, expect } from 'vitest'
import { advance, nextOccurrence } from '../recurrence'
import { repeatDisplayName, type RepeatRule } from '../models'
import { atNoon, startOfDay } from '../calendar'
import { decodeAppData, encodeAppData } from '../codec'
import { seededAppData, BuiltIn } from '../models'

/**
 * Ports the date-math and serialisation half of RecurrenceTests.swift. The
 * spawn-on-complete tests need toggleCompleted and are in mutations.test.ts.
 *
 * "Today" is Tue 2026-07-21 throughout, matching the Swift fixture.
 */

const day = (y: number, m: number, d: number) => atNoon(new Date(y, m - 1, d))
const dayStart = (y: number, m: number, d: number) => startOfDay(new Date(y, m - 1, d))
const TODAY = day(2026, 7, 21)

const daily: RepeatRule = { unit: 'day', interval: 1 }
const weekly: RepeatRule = { unit: 'week', interval: 1 }
const monthly: RepeatRule = { unit: 'month', interval: 1 }
const yearly: RepeatRule = { unit: 'year', interval: 1 }
const weekdays: RepeatRule = { unit: 'weekday', interval: 1 }

describe('Recurrence', () => {
  it('v1JSONWithoutRepeatRuleDecodes', () => {
    // Forward compatibility in reverse: a file written before repeatRule
    // existed must still load, because the field is optional.
    const d = seededAppData()
    d.tasks = [{
      id: '00000000-0000-0000-0000-00000000000A', title: 'legacy', note: '',
      dueDate: null, reminderDate: null, listID: BuiltIn.inbox,
      isCompleted: false, completedAt: null, isTrashed: false,
      createdAt: new Date(Date.UTC(2026, 6, 21, 9, 0, 0)), order: 1,
      repeatRule: null, trashedAt: null,
    }]
    const raw = encodeAppData(d)
    expect(raw).not.toContain('repeatRule')
    expect(decodeAppData(raw).tasks[0]!.repeatRule).toBeNull()
  })

  it('roundTripWithRule', () => {
    const d = seededAppData()
    d.tasks = [{
      id: '00000000-0000-0000-0000-00000000000A', title: 'repeats', note: '',
      dueDate: day(2026, 7, 21), reminderDate: null, listID: BuiltIn.inbox,
      isCompleted: false, completedAt: null, isTrashed: false,
      createdAt: new Date(Date.UTC(2026, 6, 21, 9, 0, 0)), order: 1,
      repeatRule: { unit: 'week', interval: 3 }, trashedAt: null,
    }]
    const back = decodeAppData(encodeAppData(d))
    expect(back.tasks[0]!.repeatRule).toEqual({ unit: 'week', interval: 3 })
  })

  it('displayNames', () => {
    expect(repeatDisplayName(daily)).toBe('Daily')
    expect(repeatDisplayName(weekdays)).toBe('Weekdays')
    expect(repeatDisplayName(weekly)).toBe('Weekly')
    expect(repeatDisplayName(monthly)).toBe('Monthly')
    expect(repeatDisplayName(yearly)).toBe('Yearly')
    expect(repeatDisplayName({ unit: 'day', interval: 2 })).toBe('Every 2 days')
    expect(repeatDisplayName({ unit: 'week', interval: 2 })).toBe('Every 2 weeks')
    expect(repeatDisplayName({ unit: 'month', interval: 3 })).toBe('Every 3 months')
    expect(repeatDisplayName({ unit: 'year', interval: 4 })).toBe('Every 4 years')
    // No "Every n weekdays" string exists — the weekday case precedes the
    // generic ones and matches any interval.
    expect(repeatDisplayName({ unit: 'weekday', interval: 5 })).toBe('Weekdays')
  })

  it('dailyOverdueSkipsMissed', () => {
    expect(nextOccurrence(day(2026, 7, 15), daily, TODAY)).toEqual(dayStart(2026, 7, 22))
  })

  it('dailyDueTodayGoesTomorrow', () => {
    expect(nextOccurrence(day(2026, 7, 21), daily, TODAY)).toEqual(dayStart(2026, 7, 22))
  })

  it('weeklyFromYesterday', () => {
    expect(nextOccurrence(day(2026, 7, 20), weekly, TODAY)).toEqual(dayStart(2026, 7, 27))
  })

  it('monthlyClampAndCatchUpFromJan31', () => {
    // Jan 31 → Feb 28 → Mar 28 → … → Jul 28 (first date after Jul 21).
    expect(nextOccurrence(day(2026, 1, 31), monthly, TODAY)).toEqual(dayStart(2026, 7, 28))
  })

  it('yearlyCatchUp', () => {
    // 2025-07-20 → 2026-07-20 (not after today) → 2027-07-20.
    expect(nextOccurrence(day(2025, 7, 20), yearly, TODAY)).toEqual(dayStart(2027, 7, 20))
  })

  it('customEveryTwoWeeks', () => {
    expect(nextOccurrence(day(2026, 7, 20), { unit: 'week', interval: 2 }, TODAY))
      .toEqual(dayStart(2026, 8, 3))
  })

  it('weekdaysFromOverdueFriday', () => {
    // Fri 17 → Mon 20 → Tue 21 (today, not after) → Wed 22.
    expect(nextOccurrence(day(2026, 7, 17), weekdays, TODAY)).toEqual(dayStart(2026, 7, 22))
  })

  it('weekdaysSkipWeekend', () => {
    // Today = Fri 2026-07-24; due today → next weekday = Mon 27.
    expect(nextOccurrence(day(2026, 7, 24), weekdays, day(2026, 7, 24)))
      .toEqual(dayStart(2026, 7, 27))
  })

  it('weekdayIgnoresIntervalEntirely', () => {
    expect(nextOccurrence(day(2026, 7, 21), { unit: 'weekday', interval: 9 }, TODAY))
      .toEqual(dayStart(2026, 7, 22))
  })

  it('alwaysAdvancesAtLeastOnceEvenFromAFutureDate', () => {
    // Do-while: a rule set on a task already due next month still moves.
    expect(nextOccurrence(day(2026, 9, 1), monthly, TODAY)).toEqual(dayStart(2026, 10, 1))
  })

  it('advanceAlwaysMovesStrictlyForward', () => {
    const rules: RepeatRule[] = [daily, weekly, monthly, yearly, weekdays,
      { unit: 'day', interval: 0 }, { unit: 'week', interval: -3 }]
    for (const rule of rules) {
      const from = dayStart(2026, 7, 21)
      expect(advance(from, rule).getTime()).toBeGreaterThan(from.getTime())
    }
  })

  it('intervalBelowOneIsClampedNotHonoured', () => {
    // max(1, interval) — a zero interval would otherwise never advance.
    expect(advance(dayStart(2026, 7, 21), { unit: 'day', interval: 0 }))
      .toEqual(dayStart(2026, 7, 22))
  })

  it('weekIsSevenTimesIntervalDays', () => {
    expect(advance(dayStart(2026, 7, 21), { unit: 'week', interval: 3 }))
      .toEqual(dayStart(2026, 8, 11))
  })

  it('resultIsStartOfDayForCallersToRePinToNoon', () => {
    const next = nextOccurrence(day(2026, 7, 15), daily, TODAY)
    expect([next.getHours(), next.getMinutes(), next.getSeconds()]).toEqual([0, 0, 0])
    expect(atNoon(next).getHours()).toBe(12)
  })
})
