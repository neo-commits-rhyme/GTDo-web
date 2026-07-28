import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppStore } from '../../core/store'
import { MemoryAdapter } from '../../storage/memoryAdapter'
import { UndoCenter } from '../../core/undo'
import { BuiltIn } from '../../core/models'
import { StoreContext } from '../useStore'
import { UndoContext } from '../undo/useUndo'
import { RootShell } from '../RootShell'
import { applyDrop } from '../dnd/DragProvider'
import type { DropContext } from '../dnd/resolve'

const NOW = new Date(2026, 6, 28, 9, 0, 0)

/** A clock the test can move, for the tab left open past midnight. */
function makeClock() {
  let at = NOW
  return { now: () => at, set: (d: Date) => { at = d } }
}

async function mount(clock = makeClock()) {
  window.innerWidth = 1280
  window.location.hash = ''
  const store = await AppStore.create({
    adapter: new MemoryAdapter(), now: clock.now, scheduler: (_m, f) => f(),
  })
  // A no-op expiry scheduler: the undo window never closes on its own, so a
  // test that finds no bar has genuinely never been offered one.
  const undo = new UndoCenter(() => {})
  render(
    <StoreContext.Provider value={store}>
      <UndoContext.Provider value={undo}>
        <RootShell />
      </UndoContext.Provider>
    </StoreContext.Provider>,
  )
  return { store, undo, clock }
}

const dropContext: DropContext = {
  taskOrder: [], listID: BuiltIn.notes, gtdOrder: [], userOrder: [], groupMembers: {},
}

const dateField = () => screen.getByLabelText('Deadline') as HTMLInputElement
const setButton = () => screen.getByRole('button', { name: 'Set deadline' }) as HTMLButtonElement

beforeEach(() => { cleanup(); window.location.hash = '' })

describe('The deadline field is seeded per prompt, not per app launch', () => {
  it('forgetsTheDateChosenByThePreviousPrompt', async () => {
    // The prompt is mounted for the life of the app and only renders when a
    // request is pending, so state kept in it survives every close: the field
    // kept re-offering the deadline picked days ago.
    const user = userEvent.setup()
    const { store } = await mount()
    const first = store.addTask('first', { kind: 'list', id: BuiltIn.notes })!
    const second = store.addTask('second', { kind: 'list', id: BuiltIn.notes })!

    store.requestMove([first.id], BuiltIn.nextActions)
    await user.clear(await screen.findByLabelText('Deadline'))
    await user.type(dateField(), '2026-12-25')
    await user.click(setButton())
    expect(store.task(first.id)!.dueDate!.getMonth()).toBe(11)

    store.requestMove([second.id], BuiltIn.nextActions)
    expect(await screen.findByLabelText('Deadline')).toBeTruthy()
    expect(dateField().value).toBe('2026-07-28')
  })

  it('followsTodayAcrossMidnight', async () => {
    // A tab left open overnight defaulted to yesterday.
    const user = userEvent.setup()
    const { store, clock } = await mount()
    const t = store.addTask('undated', { kind: 'list', id: BuiltIn.notes })!

    store.requestMove([t.id], BuiltIn.nextActions)
    expect((await screen.findByLabelText('Deadline') as HTMLInputElement).value).toBe('2026-07-28')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    clock.set(new Date(2026, 6, 29, 9, 0, 0))
    store.requestMove([t.id], BuiltIn.nextActions)
    expect(await screen.findByLabelText('Deadline')).toBeTruthy()
    expect(dateField().value).toBe('2026-07-29')
  })

  it('doesNotSwallowTheClickWhenTheFieldIsEmpty', async () => {
    // Clearing the field and pressing the button did nothing at all — no move,
    // no message, no closed dialog.
    const user = userEvent.setup()
    const { store } = await mount()
    const t = store.addTask('undated', { kind: 'list', id: BuiltIn.notes })!

    store.requestMove([t.id], BuiltIn.nextActions)
    await user.clear(await screen.findByLabelText('Deadline'))
    expect(setButton().disabled).toBe(true)
  })

  it('stillCreatesTheTaskAPromptWasRaisedFor', async () => {
    // The create path takes no snapshot — nothing exists yet to snapshot — so
    // it must keep working unchanged.
    const user = userEvent.setup()
    const { store } = await mount()
    store.submitNewTask('call the bank', { kind: 'list', id: BuiltIn.nextActions })

    await user.click(await screen.findByRole('button', { name: 'Set deadline' }))
    const created = store.incompleteTasks(BuiltIn.nextActions).find((t) => t.title === 'call the bank')
    expect(created).toBeTruthy()
    expect(created!.dueDate!.getDate()).toBe(28)
  })
})

describe('An undo bar is only offered for a mutation that happened', () => {
  it('aDropThatOnlyRaisesThePromptOffersNoUndo', async () => {
    // requestMove moved nothing here; a bar reading "1 task moved" over an
    // untouched task, with an Undo that does nothing, is worse than no bar.
    const { store, undo } = await mount()
    const t = store.addTask('undated', { kind: 'list', id: BuiltIn.notes })!

    applyDrop({ kind: 'move-task', taskID: t.id, listID: BuiltIn.nextActions }, dropContext, store, undo)

    expect(await screen.findByRole('dialog', { name: 'Choose a deadline' })).toBeTruthy()
    expect(undo.pending).toBeNull()
    expect(screen.queryByRole('status', { name: 'Undo available' })).toBeNull()
  })

  it('aDropThatActuallyMovesIsStillUndoable', async () => {
    const { store, undo } = await mount()
    const t = store.addTask('thing', { kind: 'list', id: BuiltIn.notes })!

    applyDrop({ kind: 'move-task', taskID: t.id, listID: BuiltIn.someday }, dropContext, store, undo)

    expect(store.task(t.id)!.listID).toBe(BuiltIn.someday)
    expect(undo.pending!.label).toBe('1 task moved')
  })

  it('theMoveMenuOffersNoUndoForAMoveThatOnlyPrompts', async () => {
    const user = userEvent.setup()
    const { store, undo } = await mount()
    const t = store.addTask('undated', { kind: 'list', id: BuiltIn.notes })!
    store.setSelectedTask(t.id)

    await user.selectOptions(await screen.findByLabelText('List'), BuiltIn.nextActions)

    expect(screen.getByRole('dialog', { name: 'Choose a deadline' })).toBeTruthy()
    expect(undo.pending).toBeNull()
  })

  it('theMoveMenuStillOffersUndoForAMoveThatHappens', async () => {
    const user = userEvent.setup()
    const { store, undo } = await mount()
    const t = store.addTask('thing', { kind: 'list', id: BuiltIn.notes })!
    store.setSelectedTask(t.id)

    await user.selectOptions(await screen.findByLabelText('List'), BuiltIn.someday)

    expect(store.task(t.id)!.listID).toBe(BuiltIn.someday)
    expect(undo.pending!.label).toBe('1 task moved')
  })
})

describe('The move the prompt was raised for is the undoable one', () => {
  it('confirmingADeadlineIsUndoableAfterTheDropsWindowIsGone', async () => {
    const user = userEvent.setup()
    const { store, undo } = await mount()
    const t = store.addTask('undated', { kind: 'list', id: BuiltIn.notes })!

    applyDrop({ kind: 'move-task', taskID: t.id, listID: BuiltIn.nextActions }, dropContext, store, undo)
    // Stands in for the eight seconds elapsing, or the user dismissing the bar,
    // before the deadline is chosen: whatever the drop offered is gone, and the
    // real move has not happened yet.
    undo.dismiss()

    await user.click(await screen.findByRole('button', { name: 'Set deadline' }))
    expect(store.task(t.id)!.listID).toBe(BuiltIn.nextActions)
    expect(store.task(t.id)!.dueDate!.getDate()).toBe(28)

    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(store.task(t.id)!.listID).toBe(BuiltIn.notes)
    expect(store.task(t.id)!.dueDate).toBeNull()
  })
})
