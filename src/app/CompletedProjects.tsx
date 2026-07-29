/**
 * The Completed projects view. Port of the macOS TaskListView's
 * completedProjectsContent.
 *
 * Rows here are PROJECTS, not tasks: thirty finished projects flattened into
 * their tasks would be unreadable, and the question this view answers is "what
 * have I finished", not "which tasks did it contain". Opening a row selects the
 * project, whose own completed section holds its tasks.
 */

import type { SidebarItem, TaskList } from '../core/models'
import { ListIcon } from './ListIcon'
import { useStore, useStoreTick } from './useStore'

function completedOn(list: TaskList): string {
  return list.completedAt === null
    ? ''
    : list.completedAt.toLocaleDateString(undefined, {
        day: 'numeric', month: 'short', year: 'numeric',
      })
}

export function CompletedProjects({ onNavigate }: { onNavigate: (item: SidebarItem) => void }) {
  useStoreTick()
  const store = useStore()
  const projects = store.completedProjects

  if (projects.length === 0) {
    return (
      <div className="list">
        <div className="list__head">
          <h1 className="list__title">Completed projects</h1>
        </div>
        <p className="list__empty">
          Nothing finished yet. Complete a project from its row in the sidebar and it lands here.
        </p>
      </div>
    )
  }

  return (
    <div className="list">
      <div className="list__head">
        <h1 className="list__title">Completed projects</h1>
      </div>
      <ul className="project-list">
        {projects.map((project) => {
          const done = store.completedTasksIn(project.id).length
          return (
            <li key={project.id} className="project-row">
              <button
                type="button"
                className="project-row__open"
                onClick={() => onNavigate({ kind: 'list', id: project.id })}
              >
                <span className="project-row__icon" style={project.colorHex === null ? undefined : { color: project.colorHex }}>
                  <ListIcon symbol={project.symbol ?? 'gtdo.list'} />
                </span>
                <span className="project-row__text">
                  <span className="project-row__name">{project.name}</span>
                  <span className="project-row__date">{completedOn(project)}</span>
                </span>
                <span className="project-row__count">
                  {done} task{done === 1 ? '' : 's'}
                </span>
              </button>
              <button
                type="button"
                className="project-row__reopen"
                onClick={() => store.uncompleteList(project.id)}
              >
                Un-complete
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
