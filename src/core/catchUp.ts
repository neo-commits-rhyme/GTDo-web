/**
 * What you missed while GTDo was closed.
 *
 * A web page cannot wake itself, so a reminder due while the app is shut simply
 * does not fire. Catch-up is what stops that being a silent failure: the
 * reminder arrives late, which is honest, rather than never, which is a broken
 * promise. See spec §1 and §4.
 */

import type { AppData, TaskItem } from './models'

/**
 * Reminders that came due since `since`, on tasks still worth reminding about.
 *
 * @param since the last time the user had the app open, or null on a first
 *   run — in which case everything already past counts, because the user has
 *   never been told about any of it.
 */
export function missedReminders(data: AppData, since: Date | null, now: Date): TaskItem[] {
  return data.tasks
    .filter((t) => t.reminderDate !== null)
    // Completed and trashed tasks are not worth a late reminder; the store
    // would not have scheduled them live either.
    .filter((t) => !t.isCompleted && !t.isTrashed)
    .filter((t) => t.reminderDate! <= now)
    .filter((t) => since === null || t.reminderDate! > since)
    .sort((a, b) => a.reminderDate!.getTime() - b.reminderDate!.getTime())
}
