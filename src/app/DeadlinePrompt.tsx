import { useState } from 'react'
import { formatDateInput, parseDateInput } from './format'
import { useStore, useStoreTick } from './useStore'

/**
 * Next actions and Waiting for… require a deadline. A move or create into one
 * waits here rather than producing an undated task in a list whose whole point
 * is that everything in it is dated.
 */
export function DeadlinePrompt() {
  useStoreTick()
  const store = useStore()
  const pending = store.pendingDeadline
  const [value, setValue] = useState(() => formatDateInput(store.today))

  if (pending === null) return null

  const target = store.list(pending.target)?.name ?? 'that list'
  const what = pending.kind === 'create' ? `“${pending.title}”` : `${pending.taskIDs.length} task${pending.taskIDs.length === 1 ? '' : 's'}`

  return (
    <div className="prompt" role="dialog" aria-modal="true" aria-label="Choose a deadline">
      <div className="prompt__panel">
        <h2>Deadline required</h2>
        <p>{target} needs a deadline for {what}.</p>
        <label className="prompt__field">
          <span>Deadline</span>
          <input type="date" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
        </label>
        <div className="prompt__actions">
          <button type="button" onClick={() => store.cancelPendingDeadline()}>Cancel</button>
          <button
            type="button"
            onClick={() => {
              const parsed = parseDateInput(value)
              if (parsed !== null) store.completePendingDeadline(parsed)
            }}
          >
            Set deadline
          </button>
        </div>
      </div>
    </div>
  )
}
