import { startOfDay } from '../core/calendar'

/**
 * The trailing gutter token — one right-aligned answer to "when".
 *
 * Overdue is never colour alone: the word itself changes ("Fri" → "3d late"),
 * which is what makes it readable to someone who cannot see the red.
 */
export type DeadlineToken = { text: string; overdue: boolean } | null

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function deadlineToken(due: Date | null, today: Date, completed = false): DeadlineToken {
  if (due === null) return null
  const day = startOfDay(due).getTime()
  const base = startOfDay(today).getTime()
  const days = Math.round((day - base) / 86_400_000)

  // A finished task is not late, however long ago it was due. Showing "40d
  // late" against a struck-through row reads as an unresolved problem.
  if (days < 0) return completed
    ? { text: due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), overdue: false }
    : { text: `${-days}d late`, overdue: true }
  if (days === 0) return { text: 'Today', overdue: false }
  if (days === 1) return { text: 'Tomorrow', overdue: false }
  if (days < 7) return { text: WEEKDAYS[startOfDay(due).getDay()]!, overdue: false }
  return {
    text: due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    overdue: false,
  }
}

export function formatDateInput(d: Date | null): string {
  if (d === null) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function parseDateInput(value: string): Date | null {
  if (value === '') return null
  const [y, m, d] = value.split('-').map(Number)
  if (y === undefined || m === undefined || d === undefined) return null
  return new Date(y, m - 1, d)
}

export function formatDateTimeInput(d: Date | null): string {
  if (d === null) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${formatDateInput(d)}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export function parseDateTimeInput(value: string): Date | null {
  if (value === '') return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}
