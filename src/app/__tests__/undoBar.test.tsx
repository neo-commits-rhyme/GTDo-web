import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, cleanup, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppStore } from '../../core/store'
import { MemoryAdapter } from '../../storage/memoryAdapter'
import { UndoCenter, undoLabel } from '../../core/undo'
import { BuiltIn } from '../../core/models'
import { StoreContext } from '../useStore'
import { UndoContext } from '../undo/useUndo'
import { RootShell } from '../RootShell'

const NOW = new Date(2026, 6, 28, 9, 0, 0)

async function mount(scheduler: (ms: number, fn: () => void) => void = () => {}) {
  window.innerWidth = 1280
  window.location.hash = ''
  const store = await AppStore.create({
    adapter: new MemoryAdapter(), now: () => NOW, scheduler: (_m, f) => f(),
  })
  const undo = new UndoCenter(scheduler)
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

describe('Undo bar', () => {
  it('showsTheLabelAndAnUndoButton', async () => {
    const { store, undo } = await mount()
    const t = store.addTask('thing', { kind: 'list', id: BuiltIn.notes })!
    undo.perform(undoLabel('trashed', 1), [t.id], store, () => store.trashTask(t.id))

    const bar = await screen.findByRole('status', { name: 'Undo available' })
    expect(bar.textContent).toContain('1 task trashed')
    expect(within(bar).getByRole('button', { name: 'Undo' })).toBeTruthy()
  })

  it('isAPoliteStatusNotAnAlert', async () => {
    // An undo offer is information; interrupting a screen reader mid-sentence
    // would be worse than the mutation it offers to reverse.
    const { store, undo } = await mount()
    const t = store.addTask('thing', { kind: 'list', id: BuiltIn.notes })!
    undo.perform(undoLabel('trashed', 1), [t.id], store, () => store.trashTask(t.id))
    const bar = await screen.findByRole('status', { name: 'Undo available' })
    expect(bar.getAttribute('aria-live')).toBe('polite')
  })

  it('undoingFromTheBarReversesTheMutation', async () => {
    const user = userEvent.setup()
    const { store, undo } = await mount()
    const t = store.addTask('thing', { kind: 'list', id: BuiltIn.notes })!
    undo.perform(undoLabel('trashed', 1), [t.id], store, () => store.trashTask(t.id))

    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(store.task(t.id)!.isTrashed).toBe(false)
    expect(screen.queryByRole('status', { name: 'Undo available' })).toBeNull()
  })

  it('dismissingLeavesTheMutationInPlace', async () => {
    const user = userEvent.setup()
    const { store, undo } = await mount()
    const t = store.addTask('thing', { kind: 'list', id: BuiltIn.notes })!
    undo.perform(undoLabel('trashed', 1), [t.id], store, () => store.trashTask(t.id))

    await user.click(await screen.findByRole('button', { name: 'Dismiss undo' }))
    expect(store.task(t.id)!.isTrashed).toBe(true)
    expect(screen.queryByRole('status', { name: 'Undo available' })).toBeNull()
  })

  it('theBarDisappearsAfterTheWindow', async () => {
    const queued: (() => void)[] = []
    const { store, undo } = await mount((_ms, fn) => { queued.push(fn) })
    const t = store.addTask('thing', { kind: 'list', id: BuiltIn.notes })!
    undo.perform(undoLabel('trashed', 1), [t.id], store, () => store.trashTask(t.id))
    expect(await screen.findByRole('status', { name: 'Undo available' })).toBeTruthy()

    // Firing the expiry mutates the centre outside React's knowledge.
    act(() => { queued.forEach((f) => f()) })
    expect(screen.queryByRole('status', { name: 'Undo available' })).toBeNull()
  })

  it('cmdZUndoesWithoutTouchingTheBar', async () => {
    // The whole point of the keyboard path: nobody has to reach a moving target.
    const user = userEvent.setup()
    const { store, undo } = await mount()
    const t = store.addTask('thing', { kind: 'list', id: BuiltIn.notes })!
    undo.perform(undoLabel('trashed', 1), [t.id], store, () => store.trashTask(t.id))

    await user.keyboard('{Meta>}z{/Meta}')
    expect(store.task(t.id)!.isTrashed).toBe(false)
  })

  it('ctrlZWorksToo', async () => {
    const user = userEvent.setup()
    const { store, undo } = await mount()
    const t = store.addTask('thing', { kind: 'list', id: BuiltIn.notes })!
    undo.perform(undoLabel('trashed', 1), [t.id], store, () => store.trashTask(t.id))

    await user.keyboard('{Control>}z{/Control}')
    expect(store.task(t.id)!.isTrashed).toBe(false)
  })

  it('cmdZIsIgnoredWhileATextFieldHasFocus', async () => {
    // Otherwise it would steal undo from the field the user is typing in.
    const user = userEvent.setup()
    const { store, undo } = await mount()
    const t = store.addTask('thing', { kind: 'list', id: BuiltIn.notes })!
    undo.perform(undoLabel('trashed', 1), [t.id], store, () => store.trashTask(t.id))

    await user.click(screen.getByLabelText('Search'))
    await user.keyboard('{Meta>}z{/Meta}')
    expect(store.task(t.id)!.isTrashed).toBe(true)
  })

  it('aSecondActionSupersedesTheFirst', async () => {
    const { store, undo } = await mount()
    const a = store.addTask('a', { kind: 'list', id: BuiltIn.notes })!
    const b = store.addTask('b', { kind: 'list', id: BuiltIn.notes })!
    undo.perform(undoLabel('trashed', 1), [a.id], store, () => store.trashTask(a.id))
    undo.perform(undoLabel('completed', 1), [b.id], store, () => store.toggleCompleted(b.id))

    const bar = await screen.findByRole('status', { name: 'Undo available' })
    expect(bar.textContent).toContain('1 task completed')
  })
})
