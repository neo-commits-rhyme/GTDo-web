import { useEffect, useRef, useState } from 'react'
import { repeatDisplayName, type RepeatRule } from '../core/models'
import { deadlinePromptWillOpen } from './DeadlinePrompt'
import {
  formatDateInput, formatDateTimeInput, ISO_DATE_MAX, ISO_DATE_MIN,
  parseDateInput, parseDateTimeInput,
} from './format'
import { useStore, useStoreTick } from './useStore'
import { useUndoCenter } from './undo/useUndo'
import { undoLabel } from '../core/undo'
import { notificationPermission, requestNotificationPermission, type PermissionState } from './reminders/scheduler'

/**
 * The limit, stated where the user is relying on it rather than in a README
 * they will never read. See spec §3.
 */
function reminderHint(permission: PermissionState): string {
  switch (permission) {
    case 'granted':
      return 'Fires only while GTDo is open in a tab. Anything missed is listed next time you open it.'
    case 'denied':
      return 'Notifications are blocked in your browser, and they would only fire while GTDo is open in a tab anyway. Anything missed is listed next time you open it.'
    case 'unsupported':
      return 'This browser has no notifications. Reminders would only fire while GTDo is open in a tab; anything missed is listed next time you open it.'
    case 'default':
      return 'Fires only while GTDo is open in a tab. Your browser will ask permission when you set this, and anything missed is listed next time you open it.'
  }
}

const REPEAT_OPTIONS: { label: string; rule: RepeatRule | null }[] = [
  { label: 'Never', rule: null },
  { label: 'Daily', rule: { unit: 'day', interval: 1 } },
  { label: 'Weekdays', rule: { unit: 'weekday', interval: 1 } },
  { label: 'Weekly', rule: { unit: 'week', interval: 1 } },
  { label: 'Monthly', rule: { unit: 'month', interval: 1 } },
  { label: 'Yearly', rule: { unit: 'year', interval: 1 } },
]

/**
 * The detail pane. Closing it returns focus to the row that opened it — a
 * pane that swallows focus on close strands anyone navigating by keyboard.
 */
/**
 * Open the native calendar on a click anywhere in the field.
 *
 * A bare <input type="date"> only opens its picker from the small calendar
 * glyph; clicking the text just focuses, so the field reads as inert. Guarded:
 * showPicker throws without user activation and is missing on older Safari, and
 * either way the field still types.
 */
/** Already due today — the star has nothing left to do. */
function isDueToday(store: { today: Date }, task: { dueDate: Date | null }): boolean {
  if (task.dueDate === null) return false
  const d = task.dueDate
  const t = store.today
  return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth()
    && d.getDate() === t.getDate()
}

function openPicker(e: { currentTarget: HTMLInputElement }): void {
  try { e.currentTarget.showPicker?.() } catch { /* not supported here */ }
}

export function DetailPane({ taskID, onClose }: { taskID: string; onClose: () => void }) {
  useStoreTick()
  const store = useStore()
  const undo = useUndoCenter()
  const task = store.task(taskID)
  const heading = useRef<HTMLHeadingElement>(null)
  const [permission, setPermission] = useState<PermissionState>(notificationPermission)

  useEffect(() => { heading.current?.focus() }, [taskID])

  if (task === null) return null

  const move = (listID: string) => {
    // requestMove, not moveTask: a deadline-required target must raise the
    // prompt rather than silently accepting an undated task.
    //
    // Undoable, because moving into Someday strips the deadline and the repeat
    // rule — the exact case snapshots exist for. Except when the target only
    // raises the prompt: nothing has moved yet, and DeadlinePrompt records the
    // move once a deadline is chosen.
    const go = () => store.requestMove([task.id], listID)
    if (deadlinePromptWillOpen(store, task.id, listID)) go()
    else undo.perform(undoLabel('moved', 1), [task.id], store, go)
  }

  return (
    <aside className="detail" aria-label="Task detail">
      <div className="detail__header">
        <h2 className="detail__heading" tabIndex={-1} ref={heading}>Task detail</h2>
        <button type="button" onClick={onClose} aria-label="Close detail">✕</button>
      </div>

      <label className="detail__field">
        <span>Title</span>
        <input
          type="text"
          value={task.title}
          onChange={(e) => store.renameTask(task.id, e.target.value)}
        />
      </label>

      <label className="detail__field">
        <span>Deadline</span>
        <input
          type="date"
          min={ISO_DATE_MIN}
          max={ISO_DATE_MAX}
          value={formatDateInput(task.dueDate)}
          onClick={openPicker}
          onChange={(e) => store.setDueDate(task.id, parseDateInput(e.target.value))}
        />
      </label>

      <label className="detail__field">
        <span>Reminder</span>
        <input
          type="datetime-local"
          // A hint is a description, not part of the name: folding it into the
          // label would have every screen reader announce the whole paragraph
          // before the field.
          aria-describedby="reminder-hint"
          value={formatDateTimeInput(task.reminderDate)}
          onClick={openPicker}
          onChange={(e) => {
            const at = parseDateTimeInput(e.target.value)
            store.setReminder(task.id, at)
            // Asked on the FIRST reminder, never on load: a prompt before the
            // user has asked for anything is the one people deny reflexively,
            // and a denial here is effectively permanent.
            if (at !== null && permission === 'default') {
              void requestNotificationPermission().then(setPermission)
            }
          }}
        />
        <span className="detail__hint" id="reminder-hint">{reminderHint(permission)}</span>
      </label>

      {/* No deadline, no repeat — a repeat rule needs a day to repeat from. */}
      {task.dueDate !== null && (
        <label className="detail__field">
          <span>Repeat</span>
          <select
            value={task.repeatRule === null ? 'Never' : repeatDisplayName(task.repeatRule)}
            onChange={(e) => {
              const chosen = REPEAT_OPTIONS.find((o) => o.label === e.target.value)
              store.setRepeatRule(task.id, chosen?.rule ?? null)
            }}
          >
            {REPEAT_OPTIONS.map((o) => (
              <option key={o.label} value={o.label}>{o.label}</option>
            ))}
          </select>
        </label>
      )}

      {/* A trashed task's listID is where Restore puts it back, so the store
          refuses to move it. The control used to be offered anyway: changing it
          silently did nothing and the pane went on showing the old list, which
          reads as the app losing the edit rather than declining it. Disabled and
          explained instead — the destination is worth seeing even when it cannot
          be changed. */}
      <label className="detail__field">
        <span>List</span>
        <select
          value={task.listID}
          disabled={task.isTrashed}
          onChange={(e) => move(e.target.value)}
        >
          {store.data.lists.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
      </label>
      {task.isTrashed && (
        <p className="detail__hint">Restore this task to move it — this is where it goes back to.</p>
      )}

      <label className="detail__field detail__field--note">
        <span>Note</span>
        <textarea value={task.note} onChange={(e) => store.setNote(task.id, e.target.value)} />
      </label>

      <div className="detail__actions">
        {/* One click for the commonest deadline there is. Disabled once it is
            already due today, so the button states the fact rather than
            silently doing nothing — and on a trashed task, whose dueDate is
            not the user's to change from here. */}
        <button
          type="button"
          disabled={task.isTrashed || isDueToday(store, task)}
          onClick={() => store.addToToday(task.id)}
        >
          {isDueToday(store, task) ? 'Added to Today' : 'Add to Today'}
        </button>
        {/* Same lie as the List field above: convertToProject bails on a trashed
            task and returns null, so the button did nothing at all — no project,
            no error, no change. Nothing is left behind (the guard runs before
            the list is created); the click simply vanished. */}
        <button type="button" disabled={task.isTrashed} onClick={() => store.convertToProject(task.id)}>
          Convert to project
        </button>
        {task.isTrashed ? (
          <>
            <button
              type="button"
              onClick={() => {
                undo.perform(undoLabel('restored', 1), [task.id], store, () => store.restoreTask(task.id))
              }}
            >
              Restore
            </button>
            <button
              type="button"
              className="detail__destructive"
              onClick={() => { store.deleteTaskPermanently(task.id); onClose() }}
            >
              Delete permanently
            </button>
          </>
        ) : (
          <button
            type="button"
            className="detail__destructive"
            onClick={() => {
              undo.perform(undoLabel('trashed', 1), [task.id], store, () => store.trashTask(task.id))
              onClose()
            }}
          >
            Move to trash
          </button>
        )}
      </div>
    </aside>
  )
}
