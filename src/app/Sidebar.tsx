import { SMART_VIEWS, sidebarItemsEqual, type SidebarItem, type SmartView } from '../core/models'
import { useState } from 'react'
import { ListIcon } from './ListIcon'
import { ListEditor } from './ListEditor'
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
  const [editing, setEditing] = useState<string | null>(null)

  const isSelected = (item: SidebarItem) => sidebarItemsEqual(store.selection, item)

  /** Smart views have no list record, so they render plainly. */
  const smartLink = (view: SmartView) => {
    const item: SidebarItem = { kind: 'smart', view }
    return (
      <li key={view}>
        <button
          type="button"
          className={`nav__item${isSelected(item) ? ' nav__item--selected' : ''}`}
          aria-current={isSelected(item) ? 'page' : undefined}
          onClick={() => onNavigate(item)}
        >
          <span className="nav__label">{SMART_LABELS[view]}</span>
        </button>
      </li>
    )
  }

  const listLink = (id: string) => {
    const list = store.list(id)
    if (list === null) return null
    return (
      <li key={id}>
        <ListRow
          list={list}
          selected={isSelected({ kind: 'list', id })}
          count={store.incompleteTasks(id).length}
          onNavigate={() => onNavigate({ kind: 'list', id })}
          onEdit={() => setEditing(id)}
        />
      </li>
    )
  }

  const gtdEntries = store.gtdSectionItems()
  const userEntries = store.userSectionItems()

  return (
    <nav className="nav" aria-label="Lists">
      <ul className="nav__group">
        {SMART_VIEWS.map(smartLink)}
      </ul>

      <h2 className="nav__heading">GTD</h2>
      <ul className="nav__group">
        {listLink(store.data.lists[0]!.id)}
        {gtdEntries.map((entry, i) =>
          entry.kind === 'list' ? (
            <li key={entry.list.id}>
              <ListRow
                list={entry.list}
                selected={isSelected({ kind: 'list', id: entry.list.id })}
                count={store.incompleteTasks(entry.list.id).length}
                onNavigate={() => onNavigate({ kind: 'list', id: entry.list.id })}
                onEdit={() => setEditing(entry.list.id)}
              />
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
                {store.listsInGroup(entry.group.id).map((l) => listLink(l.id))}
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
              <ListRow
                list={entry.list}
                selected={isSelected({ kind: 'list', id: entry.list.id })}
                count={store.incompleteTasks(entry.list.id).length}
                onNavigate={() => onNavigate({ kind: 'list', id: entry.list.id })}
                onEdit={() => setEditing(entry.list.id)}
              />
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
                {store.listsInGroup(entry.group.id).map((l) => listLink(l.id))}
              </ul>
            </li>
          ),
        )}
      </ul>

      <NewListButton />
      {editing !== null && <ListEditor listID={editing} onClose={() => setEditing(null)} />}
    </nav>
  )
}

/**
 * A user list row: tinted icon, name, count, and an Edit affordance that only
 * exists for lists the store will actually let you customise.
 */
function ListRow({
  list, selected, onNavigate, onEdit, count,
}: {
  list: { id: string; name: string; isBuiltIn: boolean; colorHex: string | null; symbol: string | null }
  selected: boolean
  onNavigate: () => void
  onEdit: () => void
  count: number
}) {
  return (
    <>
      <button
        type="button"
        className={`nav__item${selected ? ' nav__item--selected' : ''}`}
        aria-current={selected ? 'page' : undefined}
        onClick={onNavigate}
      >
        <span
          className="nav__icon"
          style={list.colorHex === null ? undefined : ({ color: list.colorHex } as React.CSSProperties)}
        >
          <ListIcon symbol={list.symbol} />
        </span>
        <span className="nav__label">{list.name}</span>
        <span className="nav__count">{count || ''}</span>
      </button>
      {!list.isBuiltIn && (
        <button
          type="button"
          className="nav__edit"
          aria-label={`Edit ${list.name}`}
          onClick={onEdit}
        >
          ⋯
        </button>
      )}
    </>
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
