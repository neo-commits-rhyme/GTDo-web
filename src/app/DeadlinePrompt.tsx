import { useState } from 'react'
import { DEADLINE_REQUIRED_LISTS, type AppStore } from '../core/store'
import { sameID, type PendingDeadline } from '../core/models'
import { undoLabel } from '../core/undo'
import { formatDateInput, ISO_DATE_MAX, ISO_DATE_MIN, parseDateInput } from './format'
import { useStore, useStoreTick } from './useStore'
import { useUndoCenter } from './undo/useUndo'

/**
 * Whether requestMove will stop at the prompt rather than move now. Callers
 * need the answer BEFORE they mutate: a move that only raises the prompt
 * changes nothing, and wrapping it in UndoCenter.perform offered a bar reading
 * “1 task moved” over an untouched task.
 */
export function deadlinePromptWillOpen(store: AppStore, taskID: string, target: string): boolean {
  const task = store.task(taskID)
  if (task === null || task.isTrashed) return false
  return DEADLINE_REQUIRED_LISTS.some((l) => sameID(l, target)) && task.dueDate == null
}

/**
 * Next actions and Waiting for… require a deadline. A move or create into one
 * waits here rather than producing an undated task in a list whose whole point
 * is that everything in it is dated.
 */
export function DeadlinePrompt() {
  useStoreTick()
  const store = useStore()
  const pending = store.pendingDeadline

  if (pending === null) return null
  // The panel is its own component so the date field mounts with the prompt
  // rather than with the app: this one is mounted for the whole session, so a
  // field seeded here kept re-offering the deadline picked days ago — and, in a
  // tab left open overnight, yesterday.
  return <DeadlinePromptPanel pending={pending} />
}

function DeadlinePromptPanel({ pending }: { pending: PendingDeadline }) {
  const store = useStore()
  const undo = useUndoCenter()
  const [value, setValue] = useState(() => formatDateInput(store.today))

  const target = store.list(pending.target)?.name ?? 'that list'
  const what = pending.kind === 'create' ? `“${pending.title}”` : `${pending.taskIDs.length} task${pending.taskIDs.length === 1 ? '' : 's'}`

  const confirm = () => {
    const parsed = parseDateInput(value)
    if (parsed === null) return
    if (pending.kind === 'create') {
      // Nothing exists yet to snapshot, and the add bar's own creates are not
      // undoable either.
      store.completePendingDeadline(parsed)
      return
    }
    // The move happens HERE, not when the prompt was raised — requestMove moved
    // nothing — so this is the only place it can be snapshotted. Without it the
    // one mutation you reach by dragging into a dated list had no way back.
    undo.perform(undoLabel('moved', pending.taskIDs.length), pending.taskIDs, store, () => {
      store.completePendingDeadline(parsed)
    })
  }

  return (
    <div className="prompt" role="dialog" aria-modal="true" aria-label="Choose a deadline">
      <div className="prompt__panel">
        <h2>Deadline required</h2>
        <p>{target} needs a deadline for {what}.</p>
        <label className="prompt__field">
          <span>Deadline</span>
          <input
            type="date"
            min={ISO_DATE_MIN}
            max={ISO_DATE_MAX}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
          />
        </label>
        <div className="prompt__actions">
          <button type="button" onClick={() => store.cancelPendingDeadline()}>Cancel</button>
          {/* Disabled rather than inert: an empty field used to swallow the
              click, leaving the dialog open with nothing to explain it. */}
          <button type="button" disabled={parseDateInput(value) === null} onClick={confirm}>
            Set deadline
          </button>
        </div>
      </div>
    </div>
  )
}
