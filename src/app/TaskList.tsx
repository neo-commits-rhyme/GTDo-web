import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CALENDAR_BUCKETS, type SidebarItem, type TaskItem } from '../core/models'
import { dragID } from './dnd/resolve'
import { AddBar } from './AddBar'
import { ImportTasksButton } from './ImportTasks'
import { TaskRow } from './TaskRow'
import { useState } from 'react'
import { BuiltIn, sameID } from '../core/models'
import { ReviewSheet } from './review/ReviewSheet'
import { useStore, useStoreTick } from './useStore'
import {
  allowsReordering, sortTasks, LIST_SORTS, LIST_SORT_LABELS, type ListSort,
} from '../core/sorting'

type Section = { title: string | null; tasks: TaskItem[] }

/** Which sections a selection renders, and whether it has an add bar. */
function sectionsFor(store: ReturnType<typeof useStore>, selection: SidebarItem | null): {
  title: string
  sections: Section[]
  canAdd: boolean
} {
  if (selection === null) return { title: 'Today', sections: [], canAdd: false }

  if (selection.kind === 'smart') {
    switch (selection.view) {
      case 'today':
        return {
          title: 'Today',
          canAdd: true,
          sections: [
            { title: 'Overdue', tasks: store.overdueTasks },
            { title: null, tasks: store.todayTasks },
            { title: 'Completed', tasks: store.todayCompletedTasks },
          ],
        }
      case 'calendar':
        return {
          title: 'Calendar',
          canAdd: true,
          sections: CALENDAR_BUCKETS.map((b) => ({ title: b, tasks: store.calendarTasks(b) })),
        }
      case 'completed':
        // No add bar in Completed or Trash.
        return { title: 'Completed', canAdd: false, sections: [{ title: null, tasks: store.completedTasks }] }
      case 'completedProjects':
        // Rows here are PROJECTS, not tasks, so this view carries no task
        // sections at all — CompletedProjects renders it instead.
        return { title: 'Completed projects', canAdd: false, sections: [] }
      case 'trash':
        return { title: 'Trash', canAdd: false, sections: [{ title: null, tasks: store.trashedTasks }] }
    }
  }

  const list = store.list(selection.id)
  // tasksInView, not incompleteTasks: Next actions also shows every deadlined
  // project task, and the drag context reads the same method.
  return {
    title: list?.name ?? 'List',
    canAdd: true,
    sections: [
      { title: null, tasks: store.tasksInView(selection.id) },
      { title: 'Completed', tasks: store.completedInView(selection.id) },
    ],
  }
}

export function TaskList({ sort, setSort, sortableListID }: {
  sort: ListSort
  setSort: (s: ListSort) => void
  /** Non-null only where a manual order exists to sort against. */
  sortableListID: string | null
}) {
  useStoreTick()
  const store = useStore()
  const [reviewing, setReviewing] = useState(false)
  // Owned here, not by the button: a successful import fills the Inbox, which
  // unmounts the empty state the button lives in.
  const [importMessage, setImportMessage] = useState<string | null>(null)

  const isInbox =
    store.selection !== null && store.selection.kind === 'list' &&
    sameID(store.selection.id, BuiltIn.inbox)
  const isNextActions =
    store.selection !== null && store.selection.kind === 'list' &&
    sameID(store.selection.id, BuiltIn.nextActions)
  const reviewable = store.inboxReviewQueue().length

  const query = store.searchQuery.trim()
  if (query !== '') {
    const results = store.searchResults()
    return (
      <div className="list">
        <h1 className="list__title">Search</h1>
        <p className="list__meta">{results.length} result{results.length === 1 ? '' : 's'} for “{query}”</p>
        <Rows tasks={results} />
      </div>
    )
  }

  const { title, sections, canAdd } = sectionsFor(store, store.selection)
  const populated = sections.filter((s) => s.tasks.length > 0)

  return (
    <div className="list">
      <div className="list__head">
        <h1 className="list__title">{title}</h1>
        {sortableListID !== null && (
          <label className="list__sort">
            <span className="visually-hidden">Sort {title}</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as ListSort)}>
              {LIST_SORTS.map((s) => (
                <option key={s} value={s}>{LIST_SORT_LABELS[s]}</option>
              ))}
            </select>
          </label>
        )}
        {isInbox && (
          <button
            type="button"
            className="list__review"
            disabled={reviewable === 0}
            onClick={() => setReviewing(true)}
          >
            Review{reviewable > 0 ? ` (${reviewable})` : ''}
          </button>
        )}
      </div>
      {reviewing && <ReviewSheet onClose={() => setReviewing(false)} />}
      {importMessage !== null && (
        <p className="list__meta" role="status">{importMessage}</p>
      )}
      {populated.length === 0 && (
        <>
          <p className="list__empty">Nothing here yet.</p>
          {/* The Inbox is where an imported list lands, so that is the one
              empty state where the offer is worth making. */}
          {isInbox && <ImportTasksButton store={store} onDone={setImportMessage} />}
        </>
      )}
      {populated.map((section, i) => (
        <section key={section.title ?? `main-${i}`} className="list__section">
          {section.title !== null && <h2 className="list__section-title">{section.title}</h2>}
          {/* Only the live rows sort. The Completed tail stays newest-first: it
              answers "what did I just finish", and resorting it would scatter
              a just-ticked row away from the top. */}
          <Rows
            tasks={section.title === null && sortableListID !== null
              ? sortTasks(section.tasks, sort)
              : section.tasks}
            tagProjects={isNextActions}
            reorderable={section.title === null && allowsReordering(sort)}
          />
        </section>
      ))}
      {canAdd && <AddBar />}
    </div>
  )
}

function Rows({ tasks, tagProjects = false, reorderable = true }: {
  tasks: TaskItem[]; tagProjects?: boolean; reorderable?: boolean
}) {
  const store = useStore()
  return (
    // disabled={{ droppable }} rather than dropping the SortableContext or
    // disabling each row: the rows stay registered, so nothing remounts and the
    // keyboard sensor keeps its announcements — the context simply refuses to
    // be a reorder destination.
    <SortableContext
      items={tasks.map((t) => dragID.task(t.id))}
      strategy={verticalListSortingStrategy}
      disabled={{ draggable: !reorderable, droppable: !reorderable }}
    >
      <ul className="rows">
        {tasks.map((t) => (
          <TaskRow
            key={t.id}
            task={t}
            selected={store.selectedTaskID === t.id}
            // Only in Next actions, where a mirrored row has to say which
            // project it came from. Everywhere else the row already sits under
            // the list it belongs to.
            projectTag={tagProjects ? store.projectOf(t) : null}
          />
        ))}
      </ul>
    </SortableContext>
  )
}
