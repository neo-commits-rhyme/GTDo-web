import { useEffect, useRef } from 'react'
import { formatDateInput, parseDateInput } from '../format'
import { ReviewIcon } from './ReviewIcon'
import { useReview } from './useReview'

/**
 * The macOS Review sheet: header with the count, the task, then the step's
 * buttons pinned to the bottom with their key caps.
 *
 * Keys are positional — 1/2/3 in button order — so the same key backs a
 * different action on each step, exactly as the Mac does.
 *
 * Esc is handled here once: it backs out a step, or dismisses at the root. The
 * Back button is therefore pointer-only, so Esc never fires both.
 */
export function ReviewSheet({ onClose }: { onClose: () => void }) {
  const { step, queue, current, rail, canGoBack, deadline, setDeadline, choose } = useReview()
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
      const item = rail[n - 1]
      if (item === undefined) return
      e.preventDefault()
      // Capture-phase plus stopPropagation is what keeps the app's global digit
      // shortcuts from also firing — otherwise 2 would mean both "Next Actions"
      // and "go to Calendar".
      e.stopPropagation()
      choose(item.choice)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [rail, canGoBack, choose, onClose])

  return (
    <div className="prompt" role="dialog" aria-modal="true" aria-label="Inbox Review">
      <div className="prompt__panel review" ref={panel} tabIndex={-1}>
        <div className="review__header">
          <div>
            <h2 className="review__heading">Inbox Review</h2>
            {current !== null && (
              <p className="review__progress">{queue.position} of {queue.total}</p>
            )}
          </div>
          <button type="button" className="review__done" onClick={onClose}>Done</button>
        </div>
        <hr className="review__divider" />

        {current === null ? (
          <div className="review__empty">
            <h3>Inbox Zero</h3>
            <p>Every inbox task has been processed.</p>
          </div>
        ) : (
          <>
            <div className="review__card">
              <h3 className="review__title">{current.title}</h3>
              {current.note !== '' && <p className="review__note">{current.note}</p>}
            </div>

            <div className="review__rail">
              {(step === 'doIt' || step === 'delegate') && (
                <label className="prompt__field">
                  <span>Deadline</span>
                  <input
                    type="date"
                    value={formatDateInput(deadline)}
                    onChange={(e) => {
                      const parsed = parseDateInput(e.target.value)
                      if (parsed !== null) setDeadline(parsed)
                    }}
                  />
                </label>
              )}

              {rail.map((r, i) => (
                <button
                  key={r.choice}
                  type="button"
                  className={`review__choice${r.destructive ? ' review__choice--destructive' : ''}`}
                  onClick={() => choose(r.choice)}
                >
                  <span className="review__choice-label">
                    <ReviewIcon name={r.icon} />
                    {r.title}
                  </span>
                  {/* Overlaid at the trailing edge so the key cap does not push
                      the centred title off-centre, as on the Mac. */}
                  <kbd className="review__key">{i + 1}</kbd>
                </button>
              ))}

              {canGoBack && (
                <button type="button" className="review__back" onClick={() => choose('back')}>
                  Back
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
