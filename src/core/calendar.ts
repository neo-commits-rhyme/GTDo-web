/**
 * The parts of Foundation's `Calendar` the core relies on. Swift gets month
 * clamping, weekend detection and DST-safe day arithmetic from the system
 * calendar; JavaScript's Date needs it spelled out.
 *
 * Everything here is local-time. Deadlines are days, not instants (spec §5.1).
 */

/** Local midnight. Every day comparison in core/ goes through this. */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/**
 * The given date's day, pinned to local noon.
 *
 * A deadline stored at midnight serializes to the previous day in UTC and can
 * shift again across a timezone change; noon leaves ±11h of slack.
 */
export function atNoon(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0)
}

export function sameDay(a: Date, b: Date): boolean {
  return startOfDay(a).getTime() === startOfDay(b).getTime()
}

/**
 * Calendar-day arithmetic, not 86_400_000ms arithmetic — so a day added across
 * a DST boundary keeps its wall-clock time, the way Calendar.date(byAdding:) does.
 */
export function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

/**
 * Clamps like Foundation: Jan 31 + 1 month is Feb 28 (or 29 in a leap year),
 * never Mar 3. Setting the day to 1 first stops the overflow that
 * `setMonth` alone would produce.
 */
export function addMonths(d: Date, n: number): Date {
  const day = d.getDate()
  const r = new Date(d)
  r.setDate(1)
  r.setMonth(r.getMonth() + n)
  const lastDayOfTargetMonth = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate()
  r.setDate(Math.min(day, lastDayOfTargetMonth))
  return r
}

/** Via addMonths so Feb 29 + 1 year clamps to Feb 28. */
export function addYears(d: Date, n: number): Date {
  return addMonths(d, n * 12)
}

/**
 * Saturday and Sunday. Foundation reads this from the locale; a locale whose
 * weekend falls elsewhere would need this replaced, which the Swift app has
 * the same exposure to.
 */
export function isWeekend(d: Date): boolean {
  const day = d.getDay()
  return day === 0 || day === 6
}
