/**
 * The parts of Foundation's `Calendar` the core relies on. Swift gets month
 * clamping, weekend detection and DST-safe day arithmetic from the system
 * calendar; JavaScript's Date needs it spelled out.
 *
 * Everything here is local-time. Deadlines are days, not instants (spec §5.1).
 */

/**
 * Rebuilds a date from its own local fields at the given hour.
 *
 * new Date(26, 0, 5) is 1926: the two-digit-year mapping lives in the
 * constructor, and only setFullYear escapes it. parseDateInput escapes it on
 * the way in, but every deadline is re-pinned through here on its way to the
 * store — so without the same escape a date typed as 0026-01-05 was stored,
 * encoded and redisplayed as 1926-01-05.
 */
function rebuiltAt(d: Date, hours: number): Date {
  const year = d.getFullYear()
  const r = new Date(year, d.getMonth(), d.getDate(), hours, 0, 0, 0)
  r.setFullYear(year)
  return r
}

/** Local midnight. Every day comparison in core/ goes through this. */
export function startOfDay(d: Date): Date {
  return rebuiltAt(d, 0)
}

/**
 * The given date's day, pinned to local noon.
 *
 * A deadline stored at midnight serializes to the previous day in UTC and can
 * shift again across a timezone change; noon leaves ±11h of slack.
 */
export function atNoon(d: Date): Date {
  return rebuiltAt(d, 12)
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
  // Measured by walking r (already day 1 of the target month) forward a month
  // and back a day, not by rebuilding it from fields: the constructor would
  // map year 0 to 1900, and 1900 is not a leap year where year 0 is, so a
  // Jan 31 deadline there clamped to Feb 28.
  const probe = new Date(r)
  probe.setMonth(probe.getMonth() + 1)
  probe.setDate(0)
  r.setDate(Math.min(day, probe.getDate()))
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
