import { useStore } from '../useStore'
import { usePendingUndo, useUndoCenter } from './useUndo'

/**
 * The transient bar. `role="status"` and polite, not an alert: an undo offer is
 * information, and interrupting a screen reader mid-sentence to announce one
 * would be worse than the mutation it is offering to reverse.
 *
 * The keyboard path (Cmd/Ctrl+Z) covers the whole window, so nobody has to
 * reach this button in time — see spec §4.1.
 */
export function UndoBar() {
  const pending = usePendingUndo()
  const centre = useUndoCenter()
  const store = useStore()

  if (pending === null) return null

  return (
    <div className="undobar" role="status" aria-live="polite" aria-label="Undo available">
      <span className="undobar__label">{pending.label}</span>
      <button type="button" className="undobar__action" onClick={() => centre.undo(store)}>
        Undo
      </button>
      <button
        type="button"
        className="undobar__dismiss"
        aria-label="Dismiss undo"
        onClick={() => centre.dismiss()}
      >
        ✕
      </button>
    </div>
  )
}
