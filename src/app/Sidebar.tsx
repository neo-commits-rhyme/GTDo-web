import { BuiltIn, SMART_VIEWS, sameID, sidebarItemsEqual, type ListGroup, type SidebarItem, type SmartView } from '../core/models'
import { groupCountLabel } from '../core/queries'
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
  completedProjects: 'Completed projects',
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
    return <SmartLink key={view} view={view} item={item} selected={isSelected(item)} onNavigate={onNavigate} />
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
  const projects = projectsGroup !== undefined && projectsGroup.kind === 'group'
    ? store.listsInGroup(projectsGroup.group.id)
    : []
  // Dropping a task on the header turns it into a project — the same gesture
  // macOS offers, and the only sidebar route to a project there.
  const { setNodeRef: projectsHeaderRef, isOver: projectsHeaderOver } =
    useDroppable({ id: dragID.projectsHeaderDrop() })
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
          <h2 ref={projectsHeaderRef} className={`nav__heading${projectsHeaderOver ? ' nav__heading--over' : ''}`}>
            Projects
            {groupCountLabel(projects.length) !== null && (
              <span className="nav__heading-count">{groupCountLabel(projects.length)}</span>
            )}
          </h2>
          <ul className="nav__group">
            {projects.map((l) => listLink(l.id))}
            {projects.length === 0 && (
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
            <GroupRow
              key={entry.group.id}
              group={entry.group}
              index={i}
              siblingCount={userEntries.length}
              renderList={listLink}
            />
          ),
        )}
      </ul>

      {/* Trash sits at the bottom, away from the views you navigate by. It is
          somewhere you go to recover something, not somewhere you work. */}
      <ul className="nav__group nav__group--foot">
        {smartLink('trash')}
      </ul>

      <div className="nav__new-row">
        <NewListButton />
        <NewGroupButton />
      </div>
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

function NewGroupButton() {
  const store = useStore()
  return (
    <button
      type="button"
      className="nav__new"
      onClick={() => {
        const name = window.prompt('New group name')
        if (name !== null) store.addGroup(name)
      }}
    >
      + New group
    </button>
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


/** Today and Trash accept a dropped task; the computed views do not, so they
 *  register no droppable at all and never light up. */
function SmartLink({ view, item, selected, onNavigate }: {
  view: SmartView
  item: SidebarItem
  selected: boolean
  onNavigate: (item: SidebarItem) => void
}) {
  const accepts = view === 'today' || view === 'trash'
  const { setNodeRef, isOver } = useDroppable({ id: dragID.smartDrop(view), disabled: !accepts })
  return (
    <li>
      <button
        ref={accepts ? setNodeRef : undefined}
        type="button"
        className={`nav__item${selected ? ' nav__item--selected' : ''}${isOver ? ' nav__item--over' : ''}`}
        aria-current={selected ? 'page' : undefined}
        onClick={() => onNavigate(item)}
      >
        <span className="nav__icon"><ListIcon symbol={SMART_SYMBOLS[view]} /></span>
        <span className="nav__label">{SMART_LABELS[view]}</span>
      </button>
    </li>
  )
}


/**
 * A user group: collapsible, renameable, deletable, and a drop target so a
 * list dragged onto it is filed there.
 *
 * Collapsed state is component state, not stored: it is a view preference, and
 * data.json is shared with two other apps through a fixed-key encoder that
 * would drop it.
 */
function GroupRow({ group, index, siblingCount, renderList }: {
  group: ListGroup
  index: number
  siblingCount: number
  renderList: (listID: string) => React.ReactNode
}) {
  const store = useStore()
  const [collapsed, setCollapsed] = useState(false)
  const members = store.listsInGroup(group.id)
  const count = groupCountLabel(members.length)
  return (
    <li className="nav__group-row">
      <div className="nav__group-head">
        <button
          type="button"
          className="nav__disclose"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((c) => !c)}
        >
          <span aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
          <span className="nav__label nav__label--group">
            {group.name}
            {count !== null && <span className="nav__heading-count">{count}</span>}
          </span>
        </button>
        <button
          type="button"
          className="nav__row-action"
          aria-label={`Rename ${group.name}`}
          onClick={() => {
            const name = window.prompt('Rename group', group.name)
            if (name !== null) store.renameGroup(group.id, name)
          }}
        >
          Rename
        </button>
        <button
          type="button"
          className="nav__row-action"
          aria-label={`Delete ${group.name}`}
          onClick={() => {
            // Deleting a group keeps its lists — they become ungrouped — so the
            // wording promises exactly that and no backup scare is warranted.
            const ok = window.confirm(
              `Delete “${group.name}”? Its ${members.length} list`
              + `${members.length === 1 ? '' : 's'} will move out of the group, not be deleted.`,
            )
            if (ok) store.deleteGroup(group.id)
          }}
        >
          Delete
        </button>
      </div>
      <ReorderButtons
        label={group.name}
        index={index}
        count={siblingCount}
        onMove={(from, to) => store.moveUserEntries([from], to)}
      />
      {!collapsed && (
        <ul className="nav__nested">
          {members.map((l) => renderList(l.id))}
          {members.length === 0 && <li className="nav__empty">No lists in this group.</li>}
        </ul>
      )}
    </li>
  )
}
