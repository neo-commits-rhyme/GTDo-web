/**
 * Recurring-task date arithmetic. Port of AppStore.swift:368-423.
 *
 * Skip-missed by construction: an overdue chain catches up to the present
 * instead of spawning occurrences into the past.
 */

import { addDays, addMonths, addYears, isWeekend, startOfDay } from './calendar'
import type { RepeatRule } from './models'

/**
 * One rule-step forward. Always returns a date strictly after `date`, falling
 * back to +1 day if the arithmetic ever fails to advance — that guarantee is
 * what stops nextOccurrence from looping forever.
 */
export function advance(date: Date, rule: RepeatRule): Date {
  const interval = Math.max(1, rule.interval)
  let next: Date

  switch (rule.unit) {
    case 'day':
      next = addDays(date, interval)
      break
    case 'week':
      // Implemented as 7*interval days, matching the Swift.
      next = addDays(date, 7 * interval)
      break
    case 'month':
      next = addMonths(date, interval)
      break
    case 'year':
      next = addYears(date, interval)
      break
    case 'weekday': {
      // "Next Mon–Fri day". The interval is ignored entirely — this unit is
      // only reachable via the Weekdays preset.
      let candidate = addDays(date, 1)
      while (isWeekend(candidate)) candidate = addDays(candidate, 1)
      next = candidate
      break
    }
  }

  return next > date ? next : addDays(date, 1)
}

/**
 * First occurrence strictly after `today`, advancing from `dueDate` by the rule.
 *
 * A do-while, so it always advances at least once even when `dueDate` is
 * already in the future, and it keeps advancing while the candidate is <=
 * today (midnight) — which is what makes an overdue chain catch up rather than
 * spawn into the past.
 *
 * Returns a start-of-day instant; callers re-pin it to noon via deadlineDay.
 */
export function nextOccurrence(after: Date, rule: RepeatRule, today: Date): Date {
  let current = startOfDay(after)
  const midnight = startOfDay(today)
  do {
    current = advance(current, rule)
  } while (current <= midnight)
  return current
}
