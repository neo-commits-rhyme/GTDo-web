import { useEffect, useRef } from 'react'
import { formatDateInput, parseDateInput } from '../format'
import { useReview } from './useReview'

/**
 * Keyboard-first triage: one task, one question.
 *
 * Keys are positional — 1/2/3 in button order for the current step — so the
 * same key backs a different action on each screen, exactly as the macOS
 * defaults do. There is no editor; see spec §1.
 *
 * Delete, File… and Make it a project… have no key. A reflex must not reach an
 * unconfirmed delete, and the two pickers need a decision no accelerator can
 * express. The rail carries that as `acceleratable`, so the rule lives in the
 * data rather than in a comment here.
 */
export function ReviewSheet({ onClose }: { onClose: () => void }) {
  const { step, queue, current, rail, canGoBack, deadline, setDeadline, choose } = useReview(onClose)
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => { panel.current?.focus() }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing = target !== null &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)

      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        if (canGoBack) choose('back')
        else onClose()
        return
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return

      const n = Number(e.key)
      if (!Number.isInteger(n) || n < 1) return
      // Positional over the acceleratable subset, so Delete never lands on a
      // number just because it happens to sit third in the rail.
      const reachable = rail.filter((r) => r.acceleratable)
      const item = reachable[n - 1]
      if (item === undefined) return
      e.preventDefault()
      e.stopPropagation()
      choose(item.choice)
    }
    // Capture, so the app's global digit shortcuts never see these keys while
    // Review is open — otherwise 2 would mean both "Defer" and "go to Calendar".
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [rail, canGoBack, choose, onClose])

  if (current === null) return null

  const reachable = rail.filter((r) => r.acceleratable)
  const keyFor = (choice: string) => {
    const i = reachable.findIndex((r) => r.choice === choice)
    return i < 0 ? null : String(i + 1)
  }

  return (
    <div className="prompt" role="dialog" aria-modal="true" aria-label="Inbox Review">
      <div className="prompt__panel review" ref={panel} tabIndex={-1}>
        <div className="review__header">
          {canGoBack && (
            <button type="button" className="review__back" onClick={() => choose('back')}>
              ‹ Back
            </button>
          )}
          <span className="review__progress">
            {queue.processed + 1} of {queue.total}
          </span>
          <button type="button" onClick={onClose} aria-label="Close review">✕</button>
        </div>

        <h2 className="review__title">{current.title}</h2>
        {current.note !== '' && <p className="review__note">{current.note}</p>}

        {(step === 'doIt' || step === 'delegate') && (
          <label className="prompt__field">
            <span>Deadline</span>
            <input
              type="date"
              defaultValue={formatDateInput(deadline)}
              onChange={(e) => {
                const parsed = parseDateInput(e.target.value)
                if (parsed !== null) setDeadline(parsed)
              }}
            />
          </label>
        )}

        <div className="review__rail">
          {rail.map((r) => (
            <button
              key={r.choice}
              type="button"
              className={`review__choice${r.prominent ? ' review__choice--prominent' : ''}${r.destructive ? ' review__choice--destructive' : ''}`}
              onClick={() => choose(r.choice)}
            >
              <span>{r.title}</span>
              {keyFor(r.choice) !== null && (
                <kbd className="review__key">{keyFor(r.choice)}</kbd>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
