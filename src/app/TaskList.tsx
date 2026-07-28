import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CALENDAR_BUCKETS, type SidebarItem, type TaskItem } from '../core/models'
import { dragID } from './dnd/resolve'
import { AddBar } from './AddBar'
import { TaskRow } from './TaskRow'
import { useState } from 'react'
import { BuiltIn, sameID } from '../core/models'
import { ReviewSheet } from './review/ReviewSheet'
import { useStore, useStoreTick } from './useStore'

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
      case 'trash':
        return { title: 'Trash', canAdd: false, sections: [{ title: null, tasks: store.trashedTasks }] }
    }
  }

  const list = store.list(selection.id)
  return {
    title: list?.name ?? 'List',
    canAdd: true,
    sections: [
      { title: null, tasks: store.incompleteTasks(selection.id) },
      { title: 'Completed', tasks: store.completedTasksIn(selection.id) },
    ],
  }
}

export function TaskList() {
  useStoreTick()
  const store = useStore()
  const [reviewing, setReviewing] = useState(false)

  const isInbox =
    store.selection !== null && store.selection.kind === 'list' &&
    sameID(store.selection.id, BuiltIn.inbox)
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
      {populated.length === 0 && <p className="list__empty">Nothing here yet.</p>}
      {populated.map((section, i) => (
        <section key={section.title ?? `main-${i}`} className="list__section">
          {section.title !== null && <h2 className="list__section-title">{section.title}</h2>}
          <Rows tasks={section.tasks} />
        </section>
      ))}
      {canAdd && <AddBar />}
    </div>
  )
}

function Rows({ tasks }: { tasks: TaskItem[] }) {
  const store = useStore()
  return (
    <SortableContext items={tasks.map((t) => dragID.task(t.id))} strategy={verticalListSortingStrategy}>
      <ul className="rows">
        {tasks.map((t) => (
          <TaskRow key={t.id} task={t} selected={store.selectedTaskID === t.id} />
        ))}
      </ul>
    </SortableContext>
  )
}
