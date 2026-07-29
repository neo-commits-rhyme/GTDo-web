import { useState } from 'react'
import { LIST_COLORS, LIST_SYMBOLS } from './theme/listPalette'
import { readableInkOn } from './theme/contrast'
import { ListIcon } from './ListIcon'
import { useStore, useStoreTick } from './useStore'
import { BuiltIn } from '../core/models'

/**
 * Rename, recolour and re-icon a user list.
 *
 * The pickers offer exactly the twelve hexes and sixteen SF Symbol names the
 * Swift app knows — see theme/listPalette.ts for why that is a hard limit and
 * not a starting point.
 *
 * Built-in lists never reach here, matching the guards already in the store.
 */
export function ListEditor({ listID, onClose }: { listID: string; onClose: () => void }) {
  useStoreTick()
  const store = useStore()
  const list = store.list(listID)
  const [name, setName] = useState(list?.name ?? '')

  if (list === null || list.isBuiltIn) return null

  const commitName = () => {
    // renameList already rejects a blank; keeping the field's own text lets the
    // user recover rather than silently reverting under them.
    if (name.trim() !== '') store.renameList(list.id, name)
  }

  return (
    <div className="prompt" role="dialog" aria-modal="true" aria-label={`Edit ${list.name}`}>
      <div className="prompt__panel">
        <div className="detail__header">
          <h2>Edit list</h2>
          <button type="button" onClick={onClose} aria-label="Close list editor">✕</button>
        </div>

        <label className="prompt__field">
          <span>Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            autoFocus
          />
        </label>

        <h3>Colour</h3>
        <div className="swatches" role="radiogroup" aria-label="List colour">
          {LIST_COLORS.map((c) => {
            const selected = list.colorHex === c.hex
            return (
              <button
                key={c.hex}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={c.name}
                className={`swatch${selected ? ' swatch--selected' : ''}`}
                style={{ '--swatch': c.hex, '--swatch-ink': readableInkOn(c.hex) } as React.CSSProperties}
                onClick={() => store.setListColor(list.id, selected ? null : c.hex)}
              >
                {/* A checkmark as well as the ring: colour alone may not
                    indicate selection, least of all in a colour picker. */}
                {selected && <span className="swatch__check" aria-hidden="true">✓</span>}
              </button>
            )
          })}
        </div>

        <h3>Icon</h3>
        <div className="icons" role="radiogroup" aria-label="List icon">
          {LIST_SYMBOLS.map((s) => {
            const selected = list.symbol === s.name
            return (
              <button
                key={s.name}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={s.label}
                className={`icon-choice${selected ? ' icon-choice--selected' : ''}`}
                onClick={() => store.setListSymbol(list.id, selected ? null : s.name)}
              >
                <ListIcon symbol={s.name} />
              </button>
            )
          })}
        </div>

        {/* Where the list lives. macOS offers this as a "Move to group"
            submenu; a select is the same choice, reachable from the keyboard,
            and it is the only route into a group until sidebar rows become
            draggable. Projects is included because moving a list there is what
            makes it a project. */}
        <label className="prompt__field">
          <span>Group</span>
          <select
            value={list.groupID ?? ''}
            onChange={(e) => store.moveList(list.id, e.target.value === '' ? null : e.target.value)}
          >
            <option value="">None</option>
            <option value={BuiltIn.projectsGroup}>Projects</option>
            {store.userGroups().map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </label>

        <div className="prompt__actions">
          {/* Completing is the headline action for a project, and it is hidden —
              not shown and inert — on every list that is not a live project.
              It confirms only when there are open tasks to close: finishing an
              already-empty project is a no-op that deserves no ceremony. */}
          {store.canCompleteList(listID) && (
            <button
              type="button"
              className="prompt__complete"
              onClick={() => {
                const open = store.openTaskCount(listID)
                const ok = open === 0 || window.confirm(
                  `“${store.list(listID)?.name ?? 'This project'}” and its ${open} open `
                  + `task${open === 1 ? '' : 's'} will be marked complete. `
                  + 'You can un-complete it from Completed projects.',
                )
                if (!ok) return
                commitName()
                store.completeList(listID)
                onClose()
              }}
            >
              Complete project
            </button>
          )}
          <button type="button" onClick={() => { commitName(); onClose() }}>Done</button>
        </div>
      </div>
    </div>
  )
}
