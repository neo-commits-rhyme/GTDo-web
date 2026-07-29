import { BuiltIn, SMART_VIEWS, sameID, sidebarItemsEqual, type SidebarItem, type SmartView } from '../core/models'
import { useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { dragID } from './dnd/resolve'
import { BUILT_IN_SYMBOLS, ListIcon, SMART_SYMBOLS } from './ListIcon'
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
          <span className="nav__icon"><ListIcon symbol={SMART_SYMBOLS[view]} /></span>
          <span className="nav__label">{SMART_LABELS[view]}</span>
        </button>
      </li>
    )
  }

  /** What the row's badge counts: the rows the list actually opens with. Next
   *  actions also shows every deadlined project task, and a badge that
   *  disagrees with the list it opens reads as a bug. */
  const rowCount = (id: string) => store.tasksInView(id).length

  const listLink = (id: string) => {
    const list = store.list(id)
    if (list === null) return null
    return (
      <li key={id}>
        <ListRow
          list={list}
          selected={isSelected({ kind: 'list', id })}
          count={rowCount(id)}
          onNavigate={() => onNavigate({ kind: 'list', id })}
          onEdit={() => setEditing(id)}
        />
      </li>
    )
  }

  const allGTD = store.gtdSectionItems()
  // Projects and Notes each get their own section rather than sitting among the
  // GTD lists. Both stay in gtdOrder so the macOS sidebar order is untouched —
  // this is a rendering split, not a data one — and the reorder buttons work in
  // visible indices, which is why they call moveVisibleGTDEntries rather than
  // mapping a position back into an order containing rows nobody can see.
  const gtdEntries = store.visibleGTDEntries()
  const projectsGroup = allGTD.find((e) => e.kind === 'group' && sameID(e.group.id, BuiltIn.projectsGroup))
  const userEntries = store.userSectionItems()

  return (
    <nav className="nav" aria-label="Lists">
      <ul className="nav__group">
        {SMART_VIEWS.filter((v) => v !== 'trash').map(smartLink)}
      </ul>

      <h2 className="nav__heading">GTD</h2>
      <ul className="nav__group">
        {/* By id, never by position: an imported document keeps its own list
            order and healingBuiltIns appends a missing Inbox at the END, so
            lists[0] is any list at all — which rendered that list twice and
            left Inbox with no row anywhere. */}
        {listLink(BuiltIn.inbox)}
        {gtdEntries.map((entry, i) =>
          entry.kind === 'list' ? (
            <li key={entry.list.id}>
              <ListRow
                list={entry.list}
                selected={isSelected({ kind: 'list', id: entry.list.id })}
                count={rowCount(entry.list.id)}
                onNavigate={() => onNavigate({ kind: 'list', id: entry.list.id })}
                onEdit={() => setEditing(entry.list.id)}
              />
              <ReorderButtons
                label={entry.list.name}
                index={i}
                count={gtdEntries.length}
                onMove={(from, to) => store.moveVisibleGTDEntries([from], to)}
              />
            </li>
          ) : null,
        )}
      </ul>

      {projectsGroup !== undefined && projectsGroup.kind === 'group' && (
        <>
          <h2 className="nav__heading">Projects</h2>
          <ul className="nav__group">
            {store.listsInGroup(projectsGroup.group.id).map((l) => listLink(l.id))}
            {store.listsInGroup(projectsGroup.group.id).length === 0 && (
              <li className="nav__empty">
                No projects yet. Turn a task into one from its detail pane.
              </li>
            )}
          </ul>
        </>
      )}

      {/* Notes is reference material, not something you act on, so it reads
          better below the doing-lists than among them.
          The heading says Reference, not Notes: the section holds exactly one
          list, already called Notes, and a NOTES / Notes pair reads as a
          stutter. Reference is also what GTD calls this material. Dropping the
          heading instead was worse — with nothing between them the row looks
          like it belongs to Projects. */}
      <h2 className="nav__heading">Reference</h2>
      <ul className="nav__group">
        {listLink(BuiltIn.notes)}
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
                count={rowCount(entry.list.id)}
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

      {/* Trash sits at the bottom, away from the views you navigate by. It is
          somewhere you go to recover something, not somewhere you work. */}
      <ul className="nav__group nav__group--foot">
        {smartLink('trash')}
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
  // Every stored list is a drop target: dragging a task onto one files it.
  const { setNodeRef, isOver } = useDroppable({ id: dragID.listDrop(list.id) })

  return (
    <>
      <button
        ref={setNodeRef}
        type="button"
        className={`nav__item${selected ? ' nav__item--selected' : ''}${isOver ? ' nav__item--over' : ''}`}
        aria-current={selected ? 'page' : undefined}
        onClick={onNavigate}
      >
        <span
          className="nav__icon"
          style={list.colorHex === null ? undefined : ({ color: list.colorHex } as React.CSSProperties)}
        >
          {/* Built-ins all store symbol: null, matching macOS, so the icon
              they show is chosen here by id rather than written to the file. */}
          <ListIcon symbol={list.symbol ?? BUILT_IN_SYMBOLS[list.id] ?? null} />
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
