import type { TaskItem } from '../core/models'
import { deadlineToken } from './format'
import { useStore } from './useStore'

/**
 * One row. The completion circle is a real button with aria-checked, and the
 * row body is a separate button that opens the detail pane — so both are
 * reachable from the keyboard without one swallowing the other.
 */
export function TaskRow({ task, selected }: { task: TaskItem; selected: boolean }) {
  const store = useStore()
  const completed = store.rendersCompleted(task)
  const token = deadlineToken(task.dueDate, store.today)

  return (
    <li className={`row${selected ? ' row--selected' : ''}`}>
      <button
        type="button"
        className="row__circle"
        role="checkbox"
        aria-checked={completed}
        aria-label={`${completed ? 'Un-complete' : 'Complete'} ${task.title}`}
        onClick={() => store.toggleCompletedHolding(task.id)}
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
