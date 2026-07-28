import { useCallback, useState } from 'react'
import { BuiltIn } from '../../core/models'
import { ReviewQueue, parentStep, stepTarget, railFor, type ReviewChoice, type ReviewStep } from '../../core/review'
import { undoLabel } from '../../core/undo'
import { useStore } from '../useStore'
import { useUndoCenter } from '../undo/useUndo'

/**
 * The Review session: the step, the frozen queue, and the deadline the two
 * commit steps use.
 *
 * The queue is seeded ONCE from the store and never re-derived — this hook
 * re-renders on every store mutation, and a freshly computed, now-smaller
 * queue would make the position walk an unstable list.
 */
export function useReview() {
  const store = useStore()
  const undo = useUndoCenter()
  const [step, setStep] = useState<ReviewStep>('root')
  const [queue, setQueue] = useState(() => new ReviewQueue(store.inboxReviewQueue().map((t) => t.id)))
  const [deadline, setDeadline] = useState<Date>(() => store.deadlineDay(store.today))

  const currentID = queue.current
  const current = currentID === null ? null : store.task(currentID)

  /** A terminal action: step on, return to the root, reset the deadline. */
  const advance = useCallback(() => {
    setQueue((q) => q.advance())
    setStep('root')
    setDeadline(store.deadlineDay(store.today))
  }, [store])

  const choose = useCallback((choice: ReviewChoice) => {
    const id = queue.current
    if (id === null) return

    const target = stepTarget(choice)
    if (target !== null) { setStep(target); return }

    if (choice === 'back') { setStep(parentStep(step) ?? 'root'); return }

    // Every terminal action is undoable. The Mac has no undo here; this is the
    // one addition, and it costs the flow nothing.
    const commit = (label: string, mutate: () => void) => {
      undo.perform(undoLabel(label, 1), [id], store, mutate)
      advance()
    }

    switch (choice) {
      case 'projects': commit('filed', () => { store.convertToProject(id) }); break
      case 'delete': commit('trashed', () => store.trashTask(id)); break
      case 'someday': commit('filed', () => store.moveTask(id, BuiltIn.someday)); break
      case 'notes': commit('filed', () => store.moveTask(id, BuiltIn.notes)); break
      case 'commitDeadline':
        commit('filed', () => {
          if (step === 'doIt') store.reviewDoIt(id, deadline)
          else store.reviewDelegate(id, deadline)
        })
        break
    }
  }, [queue, step, deadline, store, undo, advance])

  return {
    step,
    queue,
    current,
    rail: railFor(step),
    canGoBack: parentStep(step) !== null,
    deadline,
    setDeadline,
    choose,
  }
}
