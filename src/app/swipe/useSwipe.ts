import { useRef, useState } from 'react'
import { useDndContext } from '@dnd-kit/core'
import type { TaskItem } from '../../core/models'
import { undoLabel } from '../../core/undo'
import { useStore } from '../useStore'
import { useUndoCenter } from '../undo/useUndo'
import { playCompletionSound } from '../sound'
import { swipeActionsFor, swipeCommit } from './swipePlan'

/**
 * The drag handle's marker. An attribute rather than the CSS class, so that
 * renaming a styling hook cannot silently re-arm the swipe under a drag.
 */
export const DRAG_HANDLE_ATTR = 'data-drag-handle'

/**
 * Touch-only swipe.
 *
 * Deliberately not wired to the mouse: a mouse drag is a drag, and overloading
 * the same gesture would make reordering ambiguous. `pointerType === 'touch'`
 * is the whole gate.
 *
 * Every commit goes through UndoCenter.perform, so nothing a reflex does is
 * unrecoverable.
 */
export function useSwipe(task: TaskItem) {
  const store = useStore()
  const undo = useUndoCenter()
  const { active: drag } = useDndContext()
  const [dx, setDx] = useState(0)
  const start = useRef<number | null>(null)
  // The authoritative displacement. State drives the visual transform, but the
  // commit decision must not depend on a re-render having landed first.
  const travel = useRef(0)
  const plan = swipeActionsFor(store.selection)

  const active = plan.leading !== null || plan.trailing !== null

  const disarm = () => {
    start.current = null
    travel.current = 0
    setDx(0)
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (!active || e.pointerType !== 'touch') return
    // Never from the handle. Touch gives the handle implicit pointer capture, so
    // every move of a dnd-kit drag still bubbles through the row — and a drag to
    // the sidebar always clears 72px, so the drop trashed the task.
    if (e.target instanceof Element && e.target.closest(`[${DRAG_HANDLE_ATTR}]`) !== null) return
    start.current = e.clientX
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (start.current === null) return
    // A drag can also win the gesture afterwards (the keyboard sensor, say).
    // Whoever is dragging owns the row's position from here on.
    if (drag !== null) return disarm()
    travel.current = e.clientX - start.current
    setDx(travel.current)
  }

  const finish = () => {
    if (drag !== null) return disarm()
    const committed = swipeCommit(travel.current, plan)
    disarm()
    if (committed === null) return // below the threshold: snap back, commit nothing

    if (committed === 'complete') {
      if (!store.rendersCompleted(task)) playCompletionSound()
      undo.perform(undoLabel('completed', 1), [task.id], store, () => {
        // The direct path, not the holding one: a swipe has already given its
        // own spatial confirmation, so holding the row would read as a hang.
        store.toggleCompleted(task.id)
      })
    } else {
      undo.perform(undoLabel('trashed', 1), [task.id], store, () => store.trashTask(task.id))
    }
  }

  return {
    dx,
    swipeHandlers: active
      ? {
          onPointerDown,
          onPointerMove,
          onPointerUp: finish,
          onPointerCancel: disarm,
        }
      : {},
  }
}
