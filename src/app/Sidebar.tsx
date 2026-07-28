import { SMART_VIEWS, sidebarItemsEqual, type SidebarItem, type SmartView } from '../core/models'
import { useStore, useStoreTick } from './useStore'

const SMART_LABELS: Record<SmartView, string> = {
  today: 'Today',
  calendar: 'Calendar',
  completed: 'Completed',
  trash: 'Trash',
}

/**
 * Sidebar: the four smart views, the GTD block (which is reorderable and
 * deliberately excludes Inbox), Inbox itself, then My Lists.
 *
 * Reordering is exposed as menu buttons here. Sub-project 3 layers drag over
 * these — it does not replace them, which is what keeps reordering reachable
 * from the keyboard.
 */
export function Sidebar({ onNavigate }: { onNavigate: (item: SidebarItem) => void }) {
  useStoreTick()
  const store = useStore()

  const isSelected = (item: SidebarItem) => sidebarItemsEqual(store.selection, item)

  const link = (item: SidebarItem, label: string, count?: number) => (
    <li key={label + (item.kind === 'list' ? item.id : item.view)}>
      <button
        type="button"
        className={`nav__item${isSelected(item) ? ' nav__item--selected' : ''}`}
        aria-current={isSelected(item) ? 'page' : undefined}
        onClick={() => onNavigate(item)}
      >
        <span className="nav__label">{label}</span>
        {count !== undefined && count > 0 && <span className="nav__count">{count}</span>}
      </button>
    </li>
  )

  const gtdEntries = store.gtdSectionItems()
  const userEntries = store.userSectionItems()

  return (
    <nav className="nav" aria-label="Lists">
      <ul className="nav__group">
        {SMART_VIEWS.map((view) => link({ kind: 'smart', view }, SMART_LABELS[view]))}
      </ul>

      <h2 className="nav__heading">GTD</h2>
      <ul className="nav__group">
        {link(
          { kind: 'list', id: store.data.lists[0]!.id },
          'Inbox',
          store.incompleteTasks(store.data.lists[0]!.id).length,
        )}
        {gtdEntries.map((entry, i) =>
          entry.kind === 'list' ? (
            <li key={entry.list.id}>
              <button
                type="button"
                className={`nav__item${isSelected({ kind: 'list', id: entry.list.id }) ? ' nav__item--selected' : ''}`}
                aria-current={isSelected({ kind: 'list', id: entry.list.id }) ? 'page' : undefined}
                onClick={() => onNavigate({ kind: 'list', id: entry.list.id })}
              >
                <span className="nav__label">{entry.list.name}</span>
                <span className="nav__count">{store.incompleteTasks(entry.list.id).length || ''}</span>
              </button>
              <ReorderButtons
                label={entry.list.name}
                index={i}
                count={gtdEntries.length}
                onMove={(from, to) => store.moveGTDEntries([from], to)}
              />
            </li>
          ) : (
            <li key={entry.group.id} className="nav__group-row">
              <span className="nav__label nav__label--group">{entry.group.name}</span>
              <ReorderButtons
                label={entry.group.name}
                index={i}
                count={gtdEntries.length}
                onMove={(from, to) => store.moveGTDEntries([from], to)}
              />
              <ul className="nav__nested">
                {store.listsInGroup(entry.group.id).map((l) =>
                  link({ kind: 'list', id: l.id }, l.name, store.incompleteTasks(l.id).length),
                )}
              </ul>
            </li>
          ),
        )}
      </ul>

      <h2 className="nav__heading">My lists</h2>
      <ul className="nav__group">
        {userEntries.length === 0 && <li className="nav__empty">No lists yet.</li>}
        {userEntries.map((entry, i) =>
          entry.kind === 'list' ? (
            <li key={entry.list.id}>
              <button
                type="button"
                className={`nav__item${isSelected({ kind: 'list', id: entry.list.id }) ? ' nav__item--selected' : ''}`}
                onClick={() => onNavigate({ kind: 'list', id: entry.list.id })}
              >
                <span className="nav__label">{entry.list.name}</span>
                <span className="nav__count">{store.incompleteTasks(entry.list.id).length || ''}</span>
              </button>
              <ReorderButtons
                label={entry.list.name}
                index={i}
                count={userEntries.length}
                onMove={(from, to) => store.moveUserEntries([from], to)}
              />
            </li>
          ) : (
            <li key={entry.group.id} className="nav__group-row">
              <span className="nav__label nav__label--group">{entry.group.name}</span>
              <ReorderButtons
                label={entry.group.name}
                index={i}
                count={userEntries.length}
                onMove={(from, to) => store.moveUserEntries([from], to)}
              />
              <ul className="nav__nested">
                {store.listsInGroup(entry.group.id).map((l) =>
                  link({ kind: 'list', id: l.id }, l.name, store.incompleteTasks(l.id).length),
                )}
              </ul>
            </li>
          ),
        )}
      </ul>

      <NewListButton />
    </nav>
  )
}

/** onMove takes SwiftUI onMove semantics: destination is an index into the
 *  PRE-removal array, so moving down one means index + 2. */
function ReorderButtons({
  label, index, count, onMove,
}: { label: string; index: number; count: number; onMove: (from: number, to: number) => void }) {
  return (
    <span className="nav__reorder">
      <button
        type="button"
        aria-label={`Move ${label} up`}
        disabled={index === 0}
        onClick={() => onMove(index, index - 1)}
      >
        ↑
      </button>
      <button
        type="button"
        aria-label={`Move ${label} down`}
        disabled={index >= count - 1}
        onClick={() => onMove(index, index + 2)}
      >
        ↓
      </button>
    </span>
  )
}

function NewListButton() {
  const store = useStore()
  return (
    <button
      type="button"
      className="nav__new"
      onClick={() => {
        const name = window.prompt('New list name')
        if (name !== null) store.addList(name, null)
      }}
    >
      + New list
    </button>
  )
}
