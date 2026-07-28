import { useCallback, useRef, useState } from 'react'
import { BuiltIn } from '../../core/models'
import { ReviewQueue, parentStep, railFor, stepTarget, type ReviewChoice, type ReviewStep } from '../../core/review'
import { undoLabel } from '../../core/undo'
import { useStore } from '../useStore'
import { useUndoCenter } from '../undo/useUndo'

/**
 * The Review session. Owns the step and the frozen queue.
 *
 * The queue is seeded ONCE from the store and never re-derived: this hook
 * re-renders on every store mutation, and a freshly computed, now-smaller queue
 * would corrupt the position.
 */
export function useReview(onFinish: () => void) {
  const store = useStore()
  const undo = useUndoCenter()
  const [step, setStep] = useState<ReviewStep>('root')
  const [queue, setQueue] = useState(() => new ReviewQueue(store.inboxReviewQueue().map((t) => t.id)))
  const deadline = useRef<Date>(store.deadlineDay(store.today))

  const currentID = queue.current
  const current = currentID === null ? null : store.task(currentID)

  // A task can vanish mid-review — deleted in another tab, or by an undo.
  if (currentID !== null && current === null) {
    setQueue(queue.drop(currentID))
  }

  const advance = useCallback((next: ReviewQueue) => {
    setQueue(next)
    setStep('root')
    if (next.isFinished) onFinish()
  }, [onFinish])

  const choose = useCallback((choice: ReviewChoice) => {
    const id = queue.current
    if (id === null) return

    const target = stepTarget(choice)
    if (target !== null) { setStep(target); return }

    if (choice === 'back') {
      setStep(parentStep(step) ?? 'root')
      return
    }

    if (choice === 'skip') {
      // Rotates, never consumes — the counter must not count a skip.
      setQueue(queue.rotate())
      setStep('root')
      return
    }

    const commit = (label: string, mutate: () => void) => {
      undo.perform(undoLabel(label, 1), [id], store, mutate)
      advance(queue.consume())
    }

    switch (choice) {
      case 'someday': commit('filed', () => store.moveTask(id, BuiltIn.someday)); break
      case 'notes': commit('filed', () => store.moveTask(id, BuiltIn.notes)); break
      case 'delete': commit('trashed', () => store.trashTask(id)); break
      case 'makeProject': commit('filed', () => { store.convertToProject(id) }); break
      case 'file': commit('filed', () => store.moveTask(id, BuiltIn.notes)); break
      case 'commitDeadline':
        commit('filed', () => {
          if (step === 'doIt') store.reviewDoIt(id, deadline.current)
          else store.reviewDelegate(id, deadline.current)
        })
        break
    }
  }, [queue, step, store, undo, advance])

  return {
    step,
    queue,
    current,
    rail: railFor(step),
    canGoBack: parentStep(step) !== null,
    deadline: deadline.current,
    setDeadline: (d: Date) => { deadline.current = d },
    choose,
  }
}
