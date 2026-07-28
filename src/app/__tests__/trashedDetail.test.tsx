import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppStore } from '../../core/store'
import { MemoryAdapter } from '../../storage/memoryAdapter'
import { UndoCenter } from '../../core/undo'
import { BuiltIn } from '../../core/models'
import { StoreContext } from '../useStore'
import { UndoContext } from '../undo/useUndo'
import { DetailPane } from '../DetailPane'

/**
 * A trashed task's listID is its restore destination, so the store refuses to
 * move it and convertToProject bails — both by design. The detail pane offered
 * the controls anyway, so changing the List dropdown or pressing Convert to
 * project did nothing at all: no change, no error, no explanation. A control
 * that silently swallows the interaction reads as the app losing the edit.
 *
 * These assert the pane declines visibly. They are not asserting the store's
 * refusal, which is correct and covered in core.
 */

const NOW = new Date(2026, 6, 28, 9, 0, 0)

async function mountTrashed() {
  const store = await AppStore.create({
    adapter: new MemoryAdapter(), now: () => NOW, scheduler: (_m, f) => f(),
  })
  const t = store.addTask('binned thing', { kind: 'list', id: BuiltIn.inbox })!
  store.trashTask(t.id)
  render(
    <StoreContext.Provider value={store}>
      <UndoContext.Provider value={new UndoCenter(() => {})}>
        <DetailPane taskID={t.id} onClose={() => {}} />
      </UndoContext.Provider>
    </StoreContext.Provider>,
  )
  return { store, task: t }
}

async function mountLive() {
  const store = await AppStore.create({
    adapter: new MemoryAdapter(), now: () => NOW, scheduler: (_m, f) => f(),
  })
  const t = store.addTask('live thing', { kind: 'list', id: BuiltIn.inbox })!
  render(
    <StoreContext.Provider value={store}>
      <UndoContext.Provider value={new UndoCenter(() => {})}>
        <DetailPane taskID={t.id} onClose={() => {}} />
      </UndoContext.Provider>
    </StoreContext.Provider>,
  )
  return { store, task: t }
}

const listSelect = () => screen.getByRole('combobox', { name: /list/i })
const convertButton = () => screen.getByRole('button', { name: /convert to project/i })

beforeEach(() => { cleanup() })

describe('A trashed task declines visibly instead of silently', () => {
  it('doesNotOfferAListDropdownItWillNotHonour', async () => {
    await mountTrashed()
    expect((listSelect() as HTMLSelectElement).disabled).toBe(true)
  })

  it('saysWhyTheListCannotBeChanged', async () => {
    await mountTrashed()
    // Naming Restore matters: it is the action that makes the field usable.
    expect(screen.getByText(/Restore this task to move it/i)).toBeTruthy()
  })

  it('doesNotOfferConvertToProjectItWillNotHonour', async () => {
    await mountTrashed()
    expect((convertButton() as HTMLButtonElement).disabled).toBe(true)
  })

  it('stillShowsWhichListItWouldBeRestoredInto', async () => {
    // Disabled, not hidden — the destination is the useful part of the field.
    const { store, task } = await mountTrashed()
    expect((listSelect() as HTMLSelectElement).value).toBe(store.task(task.id)!.listID)
  })

  it('leavesBothControlsWorkingForATaskThatIsNotTrashed', async () => {
    // The guard must key on isTrashed, not on the detail pane generally.
    const { store, task } = await mountLive()
    expect((listSelect() as HTMLSelectElement).disabled).toBe(false)
    expect((convertButton() as HTMLButtonElement).disabled).toBe(false)

    await userEvent.selectOptions(listSelect(), BuiltIn.someday)
    expect(store.task(task.id)!.listID).toBe(BuiltIn.someday)
  })
})
