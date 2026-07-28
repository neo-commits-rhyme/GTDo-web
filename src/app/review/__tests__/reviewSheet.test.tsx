import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, cleanup, within, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppStore } from '../../../core/store'
import { MemoryAdapter } from '../../../storage/memoryAdapter'
import { UndoCenter } from '../../../core/undo'
import { BuiltIn } from '../../../core/models'
import { StoreContext } from '../../useStore'
import { UndoContext } from '../../undo/useUndo'
import { RootShell } from '../../RootShell'

const NOW = new Date(2026, 6, 28, 9, 0, 0)

async function mount(titles: string[] = ['alpha', 'beta', 'gamma']) {
  window.innerWidth = 1280
  // Select Inbox through the router BEFORE rendering. Setting it on the store
  // afterwards mutates outside act(), so React never re-renders and the tests
  // only pass when an earlier test happens to have left the DOM in the right
  // state — which is exactly the false green this had.
  window.location.hash = `#/list/${BuiltIn.inbox}`
  const store = await AppStore.create({
    adapter: new MemoryAdapter(), now: () => NOW, scheduler: (_m, f) => f(),
  })
  for (const t of titles) store.addTask(t, { kind: 'list', id: BuiltIn.inbox })
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

const openReview = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole('button', { name: /^Review/ }))
  return await screen.findByRole('dialog', { name: 'Inbox Review' })
}

beforeEach(() => { cleanup(); window.location.hash = '' })

describe('The Review entry point', () => {
  it('appearsOnInboxWithACount', async () => {
    await mount()
    expect(await screen.findByRole('button', { name: 'Review (3)' })).toBeTruthy()
  })

  it('isDisabledWhenTheInboxIsEmpty', async () => {
    await mount([])
    const button = await screen.findByRole('button', { name: 'Review' })
    expect(button).toHaveProperty('disabled', true)
  })

  it('doesNotAppearOnOtherLists', async () => {
    const user = userEvent.setup()
    await mount()
    expect(await screen.findByRole('button', { name: /^Review/ })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /^Notes/ }))
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Review/ })).toBeNull())
  })
})

describe('The Review sheet', () => {
  it('showsTheFirstTaskAndItsProgress', async () => {
    const user = userEvent.setup()
    await mount()
    const sheet = await openReview(user)
    expect(within(sheet).getByText('alpha')).toBeTruthy()
    expect(within(sheet).getByText('1 of 3')).toBeTruthy()
  })

  it('positionalKeysActivateTheStepsChoices', async () => {
    const user = userEvent.setup()
    const { store } = await mount(['alpha'])
    const sheet = await openReview(user)
    // Root: 1 = Next actions, 2 = Defer. Then defer: 1 = Someday.
    await user.keyboard('2')
    expect(within(sheet).getByRole('button', { name: /Someday/ })).toBeTruthy()
    await user.keyboard('1')
    expect(store.data.tasks[0]!.listID).toBe(BuiltIn.someday)
  })

  it('escapeGoesBackAStepThenLeaves', async () => {
    const user = userEvent.setup()
    await mount(['alpha'])
    const sheet = await openReview(user)
    await user.keyboard('2') // into Defer
    expect(within(sheet).getByRole('button', { name: /Someday/ })).toBeTruthy()

    await user.keyboard('{Escape}')
    expect(within(sheet).getByRole('button', { name: /Next actions/ })).toBeTruthy() // back at root
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Inbox Review' })).toBeNull()
  })

  it('deleteHasNoKeyAtAll', async () => {
    // A reflex must not reach an unconfirmed delete. Defer's rail is Someday,
    // Notes, Delete — so only two keys exist, and 3 does nothing.
    const user = userEvent.setup()
    const { store } = await mount(['alpha'])
    await openReview(user)
    await user.keyboard('2') // into Defer
    await user.keyboard('3')
    expect(store.data.tasks[0]!.isTrashed).toBe(false)
    expect(screen.getByRole('dialog', { name: 'Inbox Review' })).toBeTruthy()
  })

  it('deleteStillWorksByClick', async () => {
    const user = userEvent.setup()
    const { store } = await mount(['alpha'])
    const sheet = await openReview(user)
    await user.keyboard('2') // into Defer
    await user.click(within(sheet).getByRole('button', { name: /Delete/ }))
    expect(store.data.tasks[0]!.isTrashed).toBe(true)
  })

  it('skipRotatesAndTheCounterDoesNotAdvance', async () => {
    const user = userEvent.setup()
    await mount(['alpha', 'beta'])
    const sheet = await openReview(user)
    expect(within(sheet).getByText('1 of 2')).toBeTruthy()

    await user.click(within(sheet).getByRole('button', { name: /Skip/ }))
    expect(within(sheet).getByText('beta')).toBeTruthy()
    expect(within(sheet).getByText('1 of 2')).toBeTruthy() // not 2 of 2
  })

  it('theGlobalDigitShortcutsAreSuppressedWhileOpen', async () => {
    // Otherwise 2 would mean both "Defer" and "go to Calendar".
    const user = userEvent.setup()
    const { store } = await mount(['alpha'])
    await openReview(user)
    await user.keyboard('2')
    expect(store.selection).toEqual({ kind: 'list', id: BuiltIn.inbox })
  })

  it('everyTerminalActionIsUndoable', async () => {
    const user = userEvent.setup()
    const { store, undo } = await mount(['alpha'])
    await openReview(user)
    await user.keyboard('2') // Defer
    await user.keyboard('1') // Someday
    expect(store.data.tasks[0]!.listID).toBe(BuiltIn.someday)
    expect(undo.pending).not.toBeNull()
    undo.undo(store)
    expect(store.data.tasks[0]!.listID).toBe(BuiltIn.inbox)
  })

  it('doItDatesAndMovesToNextActions', async () => {
    const user = userEvent.setup()
    const { store } = await mount(['alpha'])
    await openReview(user)
    await user.keyboard('1') // Next actions
    await user.keyboard('1') // Do It
    await user.keyboard('1') // Set deadline & move
    expect(store.data.tasks[0]!.listID).toBe(BuiltIn.nextActions)
    expect(store.data.tasks[0]!.dueDate).not.toBeNull()
  })

  it('closesWhenTheQueueEmpties', async () => {
    const user = userEvent.setup()
    await mount(['alpha'])
    await openReview(user)
    await user.keyboard('2')
    await user.keyboard('1')
    expect(screen.queryByRole('dialog', { name: 'Inbox Review' })).toBeNull()
  })

  it('theQueueIsFrozenSoAddingATaskMidReviewDoesNotChangeTheTotal', async () => {
    const user = userEvent.setup()
    const { store } = await mount(['alpha', 'beta'])
    const sheet = await openReview(user)
    expect(within(sheet).getByText('1 of 2')).toBeTruthy()
    act(() => { store.addTask('gamma', { kind: 'list', id: BuiltIn.inbox }) })
    expect(within(sheet).getByText('1 of 2')).toBeTruthy()
  })
})
