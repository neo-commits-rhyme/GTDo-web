import { useEffect, useRef } from 'react'
import { repeatDisplayName, type RepeatRule } from '../core/models'
import {
  formatDateInput, formatDateTimeInput, parseDateInput, parseDateTimeInput,
} from './format'
import { useStore, useStoreTick } from './useStore'

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
export function DetailPane({ taskID, onClose }: { taskID: string; onClose: () => void }) {
  useStoreTick()
  const store = useStore()
  const task = store.task(taskID)
  const heading = useRef<HTMLHeadingElement>(null)

  useEffect(() => { heading.current?.focus() }, [taskID])

  if (task === null) return null

  const move = (listID: string) => {
    // requestMove, not moveTask: a deadline-required target must raise the
    // prompt rather than silently accepting an undated task.
    store.requestMove([task.id], listID)
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
          value={formatDateInput(task.dueDate)}
          onChange={(e) => store.setDueDate(task.id, parseDateInput(e.target.value))}
        />
      </label>

      <label className="detail__field">
        <span>Reminder</span>
        <input
          type="datetime-local"
          value={formatDateTimeInput(task.reminderDate)}
          onChange={(e) => store.setReminder(task.id, parseDateTimeInput(e.target.value))}
        />
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

      <label className="detail__field">
        <span>List</span>
        <select value={task.listID} onChange={(e) => move(e.target.value)}>
          {store.data.lists.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
      </label>

      <label className="detail__field detail__field--note">
        <span>Note</span>
        <textarea value={task.note} onChange={(e) => store.setNote(task.id, e.target.value)} />
      </label>

      <div className="detail__actions">
        <button type="button" onClick={() => store.convertToProject(task.id)}>
          Convert to project
        </button>
        {task.isTrashed ? (
          <>
            <button type="button" onClick={() => store.restoreTask(task.id)}>Restore</button>
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
            onClick={() => { store.trashTask(task.id); onClose() }}
          >
            Move to trash
          </button>
        )}
      </div>
    </aside>
  )
}
