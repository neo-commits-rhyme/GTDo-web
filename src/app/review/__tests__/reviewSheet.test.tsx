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
  it('showsTheHeadingTheCountAndTheFirstTask', async () => {
    const user = userEvent.setup()
    await mount()
    const sheet = await openReview(user)
    expect(within(sheet).getByRole('heading', { name: 'Inbox Review' })).toBeTruthy()
    expect(within(sheet).getByText('1 of 3')).toBeTruthy()
    expect(within(sheet).getByText('alpha')).toBeTruthy()
  })

  it('theRootRailMatchesTheMac', async () => {
    const user = userEvent.setup()
    await mount(['alpha'])
    const sheet = await openReview(user)
    for (const name of ['Defer', 'Next Actions', 'Projects']) {
      expect(within(sheet).getByRole('button', { name: new RegExp(name) }), name).toBeTruthy()
    }
    // The iPhone-only choices must not be here.
    expect(within(sheet).queryByRole('button', { name: /File/ })).toBeNull()
    expect(within(sheet).queryByRole('button', { name: /Skip/ })).toBeNull()
  })

  it('positionalKeysActivateTheStepsChoices', async () => {
    const user = userEvent.setup()
    const { store } = await mount(['alpha'])
    const sheet = await openReview(user)
    // Root: 1 = Defer. Then defer: 2 = Someday.
    await user.keyboard('1')
    expect(within(sheet).getByRole('button', { name: /Someday/ })).toBeTruthy()
    await user.keyboard('2')
    expect(store.data.tasks[0]!.listID).toBe(BuiltIn.someday)
  })

  it('deleteIsKeyOneInDeferAndMovesToTrashNotOblivion', async () => {
    const user = userEvent.setup()
    const { store } = await mount(['alpha'])
    await openReview(user)
    await user.keyboard('1') // Defer
    await user.keyboard('1') // Delete
    expect(store.data.tasks[0]!.isTrashed).toBe(true)
    expect(store.task(store.data.tasks[0]!.id)).not.toBeNull() // recoverable
  })

  it('projectsConvertsImmediately', async () => {
    // The Mac converts on click; there is no confirmation step.
    const user = userEvent.setup()
    const { store } = await mount(['alpha'])
    await openReview(user)
    await user.keyboard('3')
    expect(store.data.lists.some((l) => l.name === 'alpha')).toBe(true)
  })

  it('escapeGoesBackAStepThenLeaves', async () => {
    const user = userEvent.setup()
    await mount(['alpha'])
    const sheet = await openReview(user)
    await user.keyboard('1') // into Defer
    expect(within(sheet).getByRole('button', { name: /Someday/ })).toBeTruthy()

    await user.keyboard('{Escape}')
    expect(within(sheet).getByRole('button', { name: /Next Actions/ })).toBeTruthy()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Inbox Review' })).toBeNull()
  })

  it('backReturnsFromADeadlineStepToNextActionsNotTheRoot', async () => {
    const user = userEvent.setup()
    await mount(['alpha'])
    const sheet = await openReview(user)
    await user.keyboard('2') // Next Actions
    await user.keyboard('1') // Do It
    await user.click(within(sheet).getByRole('button', { name: 'Back' }))
    expect(within(sheet).getByRole('button', { name: /Delegate It/ })).toBeTruthy()
  })

  it('theRootHasNoBackButton', async () => {
    const user = userEvent.setup()
    await mount(['alpha'])
    const sheet = await openReview(user)
    expect(within(sheet).queryByRole('button', { name: 'Back' })).toBeNull()
  })

  it('theGlobalDigitShortcutsAreSuppressedWhileOpen', async () => {
    // Otherwise 2 would mean both "Next Actions" and "go to Calendar".
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
    await user.keyboard('1') // Defer
    await user.keyboard('2') // Someday
    expect(store.data.tasks[0]!.listID).toBe(BuiltIn.someday)
    undo.undo(store)
    expect(store.data.tasks[0]!.listID).toBe(BuiltIn.inbox)
  })

  it('doItDatesAndMovesToNextActions', async () => {
    const user = userEvent.setup()
    const { store } = await mount(['alpha'])
    await openReview(user)
    await user.keyboard('2') // Next Actions
    await user.keyboard('1') // Do It
    await user.keyboard('1') // Set deadline & move
    expect(store.data.tasks[0]!.listID).toBe(BuiltIn.nextActions)
    expect(store.data.tasks[0]!.dueDate).not.toBeNull()
  })

  it('showsInboxZeroWhenTheQueueEmpties', async () => {
    const user = userEvent.setup()
    await mount(['alpha'])
    const sheet = await openReview(user)
    await user.keyboard('1')
    await user.keyboard('2')
    expect(within(sheet).getByText('Inbox Zero')).toBeTruthy()
    expect(within(sheet).getByText(/Every inbox task has been processed/)).toBeTruthy()
  })

  it('theCountIsFrozenAtOpen', async () => {
    const user = userEvent.setup()
    const { store } = await mount(['alpha', 'beta'])
    const sheet = await openReview(user)
    expect(within(sheet).getByText('1 of 2')).toBeTruthy()
    act(() => { store.addTask('gamma', { kind: 'list', id: BuiltIn.inbox }) })
    expect(within(sheet).getByText('1 of 2')).toBeTruthy()
  })
})
