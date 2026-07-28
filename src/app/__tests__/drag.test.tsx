import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppStore } from '../../core/store'
import { MemoryAdapter } from '../../storage/memoryAdapter'
import { UndoCenter, undoLabel } from '../../core/undo'
import { BuiltIn } from '../../core/models'
import { StoreContext } from '../useStore'
import { UndoContext } from '../undo/useUndo'
import { RootShell } from '../RootShell'

const NOW = new Date(2026, 6, 28, 9, 0, 0)

async function mount() {
  window.innerWidth = 1280
  window.location.hash = ''
  const store = await AppStore.create({
    adapter: new MemoryAdapter(), now: () => NOW, scheduler: (_m, f) => f(),
  })
  const undo = new UndoCenter(() => {})
  render(
    <StoreContext.Provider value={store}>
      <UndoContext.Provider value={undo}>
        <RootShell />
      </UndoContext.Provider>
    </StoreContext.Provider>,
  )
  return { store, undo }
}

beforeEach(() => { cleanup(); window.location.hash = '' })

describe('Drag layers over the keyboard paths', () => {
  it('everyRowGainsAHandleWithoutLosingItsOtherButtons', async () => {
    const { store } = await mount()
    store.addTask('reachable', { kind: 'smart', view: 'today' })
    store.setSelectedTask(null)
    // Circle, body and handle are three distinct, focusable controls.
    expect(await screen.findByRole('checkbox', { name: /reachable/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'reachable' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reorder reachable' })).toBeTruthy()
  })

  it('theBracketShortcutsStillWork', async () => {
    // Sub-project 1 shipped these on the promise drag would layer over them.
    const user = userEvent.setup()
    const { store } = await mount()
    const a = store.addTask('a', { kind: 'list', id: BuiltIn.notes })!
    const b = store.addTask('b', { kind: 'list', id: BuiltIn.notes })!
    store.setSelectedTask(a.id)
    await user.keyboard(']')
    expect(store.incompleteTasks(BuiltIn.notes).map((t) => t.id)).toEqual([b.id, a.id])
  })

  it('theSidebarReorderButtonsStillExist', async () => {
    await mount()
    expect(screen.getByRole('button', { name: 'Move Someday up' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Move Someday down' })).toBeTruthy()
  })

  it('theHandleIsLabelledPerTaskNotGenerically', async () => {
    const { store } = await mount()
    store.addTask('buy milk', { kind: 'smart', view: 'today' })
    store.addTask('walk dog', { kind: 'smart', view: 'today' })
    store.setSelectedTask(null)
    expect(await screen.findByRole('button', { name: 'Reorder buy milk' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reorder walk dog' })).toBeTruthy()
  })
})

describe('Drop semantics through the store', () => {
  it('aMoveOntoADeadlineRequiredListRaisesThePrompt', async () => {
    // The reason the drop handler calls requestMove and never moveTask.
    const { store, undo } = await mount()
    const t = store.addTask('undated', { kind: 'list', id: BuiltIn.notes })!
    undo.perform(undoLabel('moved', 1), [t.id], store, () => {
      store.requestMove([t.id], BuiltIn.nextActions)
    })
    expect(await screen.findByRole('dialog', { name: 'Choose a deadline' })).toBeTruthy()
    expect(store.task(t.id)!.listID).toBe(BuiltIn.notes) // not moved yet
  })

  it('aMoveOntoAnUnconstrainedListHappensImmediately', async () => {
    const { store, undo } = await mount()
    const t = store.addTask('thing', { kind: 'list', id: BuiltIn.notes })!
    undo.perform(undoLabel('moved', 1), [t.id], store, () => {
      store.requestMove([t.id], BuiltIn.someday)
    })
    expect(store.task(t.id)!.listID).toBe(BuiltIn.someday)
  })

  it('aMoveByDragIsUndoable', async () => {
    const user = userEvent.setup()
    const { store, undo } = await mount()
    const t = store.addTask('thing', { kind: 'list', id: BuiltIn.notes })!
    store.setDueDate(t.id, new Date(2026, 7, 5))
    undo.perform(undoLabel('moved', 1), [t.id], store, () => {
      store.requestMove([t.id], BuiltIn.someday)
    })
    // Someday stripped the deadline; undo must bring it back, not just the list.
    expect(store.task(t.id)!.dueDate).toBeNull()
    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(store.task(t.id)!.listID).toBe(BuiltIn.notes)
    expect(store.task(t.id)!.dueDate!.getDate()).toBe(5)
  })

  it('aReorderByDragIsUndoable', async () => {
    const user = userEvent.setup()
    const { store, undo } = await mount()
    const a = store.addTask('a', { kind: 'list', id: BuiltIn.notes })!
    const b = store.addTask('b', { kind: 'list', id: BuiltIn.notes })!
    store.setSelection({ kind: 'list', id: BuiltIn.notes })

    undo.perform(undoLabel('moved', 1), [a.id, b.id], store, () => {
      store.moveIncompleteTasks(BuiltIn.notes, [0], 2)
    })
    expect(store.incompleteTasks(BuiltIn.notes).map((t) => t.id)).toEqual([b.id, a.id])
    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(store.incompleteTasks(BuiltIn.notes).map((t) => t.id)).toEqual([a.id, b.id])
  })
})

describe('The list actually re-renders', () => {
  it('aReorderChangesTheRenderedOrder', async () => {
    // A reorder is a permutation, so any fingerprint that sums `order`
    // unweighted is identical before and after — and the list silently never
    // re-renders. Found by E2E, guarded here.
    const { store } = await mount()
    const a = store.addTask('alpha', { kind: 'list', id: BuiltIn.notes })!
    store.addTask('beta', { kind: 'list', id: BuiltIn.notes })!
    store.setSelection({ kind: 'list', id: BuiltIn.notes })

    const rendered = () =>
      Array.from(document.querySelectorAll('.row__title')).map((e) => e.textContent)
    expect(await screen.findByText('alpha')).toBeTruthy()
    expect(rendered()).toEqual(['alpha', 'beta'])

    store.setSelectedTask(a.id)
    await userEvent.setup().keyboard(']')
    expect(rendered()).toEqual(['beta', 'alpha'])
  })
})

describe('The keyboard paths are as reversible as the drag ones', () => {
  it('aKeyboardReorderIsUndoable', async () => {
    const user = userEvent.setup()
    const { store, undo } = await mount()
    const a = store.addTask('a', { kind: 'list', id: BuiltIn.notes })!
    const b = store.addTask('b', { kind: 'list', id: BuiltIn.notes })!
    store.setSelection({ kind: 'list', id: BuiltIn.notes })
    store.setSelectedTask(a.id)

    await user.keyboard(']')
    expect(store.incompleteTasks(BuiltIn.notes).map((t) => t.id)).toEqual([b.id, a.id])
    expect(undo.pending).not.toBeNull()
    undo.undo(store)
    expect(store.incompleteTasks(BuiltIn.notes).map((t) => t.id)).toEqual([a.id, b.id])
  })

  it('aKeyboardTrashIsUndoable', async () => {
    const user = userEvent.setup()
    const { store, undo } = await mount()
    const t = store.addTask('doomed', { kind: 'list', id: BuiltIn.notes })!
    store.setSelectedTask(t.id)

    await user.keyboard('{Delete}')
    expect(store.task(t.id)!.isTrashed).toBe(true)
    undo.undo(store)
    expect(store.task(t.id)!.isTrashed).toBe(false)
  })
})
