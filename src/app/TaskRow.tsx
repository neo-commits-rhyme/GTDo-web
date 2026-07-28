import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { TaskItem } from '../core/models'
import { dragID } from './dnd/resolve'
import { deadlineToken } from './format'
import { playCompletionSound } from './sound'
import { useStore } from './useStore'
import { useSwipe } from './swipe/useSwipe'

/**
 * One row. The completion circle is a real button with aria-checked, and the
 * row body is a separate button that opens the detail pane — so both are
 * reachable from the keyboard without one swallowing the other.
 */
export function TaskRow({ task, selected }: { task: TaskItem; selected: boolean }) {
  const store = useStore()
  const completed = store.rendersCompleted(task)
  const token = deadlineToken(task.dueDate, store.today, completed)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: dragID.task(task.id) })
  const { dx, swipeHandlers } = useSwipe(task)

  return (
    <li
      ref={setNodeRef}
      className={`row${selected ? ' row--selected' : ''}${completed ? ' row--done' : ''}${isDragging ? ' row--dragging' : ''}`}
      style={{
        transform: dx === 0 ? CSS.Transform.toString(transform) : `translateX(${dx}px)`,
        transition: dx === 0 ? transition : 'none',
      }}
      {...swipeHandlers}
    >
      {/* A dedicated handle rather than a draggable row: the row body opens the
          detail pane and the circle completes, and both must stay clickable. */}
      <button
        type="button"
        className="row__handle"
        aria-label={`Reorder ${task.title}`}
        // The gesture here belongs to the drag, not to the swipe: see useSwipe.
        data-drag-handle=""
        {...attributes}
        {...listeners}
      >
        <span aria-hidden="true">⠿</span>
      </button>
      <button
        type="button"
        className="row__circle"
        role="checkbox"
        aria-checked={completed}
        aria-label={`${completed ? 'Un-complete' : 'Complete'} ${task.title}`}
        onClick={() => {
          // Sound only on the way to complete, never on un-complete —
          // matching the macOS behaviour.
          if (!completed) playCompletionSound()
          store.toggleCompletedHolding(task.id)
        }}
      >
        <span aria-hidden="true">{completed ? '●' : '○'}</span>
      </button>

      <button
        type="button"
        className="row__body"
        aria-current={selected ? 'true' : undefined}
        onClick={() => store.setSelectedTask(task.id)}
      >
        <span className={`row__title${completed ? ' row__title--done' : ''}`}>{task.title}</span>
        {task.note !== '' && <span className="row__note" aria-hidden="true">{task.note}</span>}
      </button>

      {token !== null && (
        // Never colour alone: overdue changes the word and adds a glyph.
        <span className={`row__gutter${token.overdue ? ' row__gutter--overdue' : ''}`}>
          {token.overdue && <span aria-hidden="true">! </span>}
          {token.text}
        </span>
      )}
      {task.repeatRule !== null && (
        <span className="row__repeat" title="Repeats" aria-label="Repeats">↻</span>
      )}
    </li>
  )
}
